/**
 * FMA v2.1 - Automated Google Drive & Spreadsheet Backend (Code.gs)
 * 保存先フォルダ: FMA_Dataset (1BNLTJa4xubwgUTw-xhvCqQIRISuZX-Uz)
 */
const DRIVE_FOLDER_ID = '1BNLTJa4xubwgUTw-xhvCqQIRISuZX-Uz';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Femoral Morphology Analyzer v2.1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function saveOrUpdateTextFile(folder, fileName, content, mimeType) {
  const existing = folder.getFilesByName(fileName);
  if (existing.hasNext()) {
    const file = existing.next();
    file.setContent(content);
    return file;
  } else {
    return folder.createFile(fileName, content, mimeType || MimeType.PLAIN_TEXT);
  }
}

function saveOrUpdateBlobFile(folder, fileName, blob) {
  const existing = folder.getFilesByName(fileName);
  while (existing.hasNext()) {
    existing.next().setTrashed(true);
  }
  return folder.createFile(blob);
}

// Replaced by the deployment workflow; identifies the server actually handling a save.
const SERVER_BUILD_COMMIT = '__FMA_BUILD_COMMIT__';

function validatedRecordKey(payload) {
  const p = payload.provenance_and_split || {};
  for (const field of ['research_id', 'observer_id', 'image_id']) {
    if (typeof p[field] !== 'string' || !p[field].trim()) throw new Error(field + ' is required. Reload the latest app.');
  }
  if (!Number.isInteger(p.repeat_index) || p.repeat_index < 1) throw new Error('repeat_index must be a positive integer.');
  if (!['R','L'].includes(p.side)) throw new Error('side is required.');
  const stage = payload.meta_input?.image_stage;
  if (!['postop_ap','preop_ap'].includes(stage)) throw new Error('image_stage is required.');
  const imageType = stage === 'postop_ap' ? 'postop_THA' : 'native';
  const expected = [p.research_id,p.observer_id,p.repeat_index,p.image_id,p.side,imageType].map(x=>encodeURIComponent(String(x))).join('__');
  if (p.measurement_key !== expected) throw new Error('Measurement identity does not match key.');
  const suffix = String(p.record_key || '').slice(expected.length + 2);
  if (!String(p.record_key || '').startsWith(expected+'__') || !/^[a-f0-9-]{36}$/.test(suffix)) throw new Error('record_key is required. Reload the latest app.');
  return p.record_key;
}

/** Each save is an immutable snapshot; legacy case-only records are left untouched. */
function saveFmaRecordToCloud(payload) {
  const key = validatedRecordKey(payload);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) throw new Error('No bound spreadsheet found.');
    let sheet = ss.getSheetByName('case_list');
    if (!sheet) sheet = ss.insertSheet('case_list');
    const p = payload.provenance_and_split;
    const c = payload.calibration_metrics || {}, q = payload.segmentation_qc || {};
    const d = payload.discrete_parameters || {}, m = payload.meta_input || {};
    const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
    c.calib_known_mm = positive(c.calib_known_mm);
    c.calibrated_mm_per_px = positive(c.calibrated_mm_per_px);
    q.lt_visibility_status = q.lt_visibility_status || null;
    q.double_cortex_grade = q.double_cortex_grade || null;
    p.server_git_hash = /^[a-f0-9]{40}$/.test(SERVER_BUILD_COMMIT) ? SERVER_BUILD_COMMIT : null;
    const row = {
      research_id:p.research_id, patient_id:p.patient_id ?? '', image_stage:m.image_stage,
      stem_family:m.stem_family ?? '', calib_known_mm:c.calib_known_mm,
      collar_status:m.collar_status ?? '', exclusion_flag:m.exclusion_flag ?? '',
      calibrated_mm_per_px:c.calibrated_mm_per_px, stem_alignment_deg:d.stem_alignment_deg,
      mean_stem_fill_total:payload.continuous_profile?.exploratory_summary?.mean_stem_fill_total,
      cfi:d.cfi, ccr:d.ccr, cbr:d.cbr, cti_minus100:d.cti_minus100,
      lt_visibility_status:q.lt_visibility_status, double_cortex_grade:q.double_cortex_grade,
      updated_at:new Date(), json_file_url:'', mask512_url:'', profile_csv_url:'',
      record_key:key, measurement_key:p.measurement_key, observer_id:p.observer_id,
      repeat_index:p.repeat_index, image_id:p.image_id, side:p.side,
      algorithm_git_hash:p.algorithm_git_hash ?? '', server_git_hash:p.server_git_hash,
      app_version:p.app_version ?? '', model_version:p.model_version ?? '',
      model_version_status:p.model_version_status ?? 'unknown',
      calibration_status:c.calibration_status ?? 'missing', calibration_method:c.calibration_method ?? '',
      qc_review_status:q.qc_review_status ?? 'not_reviewed', mask_source_type:p.mask_source_type ?? ''
    };
    let headers = sheet.getLastRow() ? sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0] : [];
    for (const name of Object.keys(row)) if (!headers.includes(name)) headers.push(name);
    sheet.getRange(1,1,1,headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    // A retried request must never overwrite a completed snapshot.
    if (sheet.getLastRow() > 1) {
      const keys = sheet.getRange(2,headers.indexOf('record_key')+1,sheet.getLastRow()-1,1).getValues();
      if (keys.some(r=>r[0]===key)) return {status:'success',research_id:p.research_id,record_key:key,already_saved:true};
    }
    function savePng(value, suffix) {
      if (!value) return '';
      const name = key + suffix;
      const data = value.replace(/^data:image\/png;base64,/, '');
      return saveOrUpdateBlobFile(folder,name,Utilities.newBlob(Utilities.base64Decode(data),MimeType.PNG,name)).getUrl();
    }
    row.mask512_url = savePng(payload.mask512_png_base64,'_mask512.png');
    savePng(payload.overlay_png_base64,'_overlay.png');
    if (payload.profile_csv_text) row.profile_csv_url = saveOrUpdateTextFile(folder,key+'_profile.csv',payload.profile_csv_text,MimeType.CSV).getUrl();
    delete payload.overlay_png_base64; delete payload.mask512_png_base64; delete payload.profile_csv_text;
    if (payload.raw_annotations) saveOrUpdateTextFile(folder,key+'_annotation.json',JSON.stringify(payload.raw_annotations,null,2),MimeType.PLAIN_TEXT);
    const jsonFile = saveOrUpdateTextFile(folder,key+'_fma_record.json',JSON.stringify(payload,null,2),MimeType.PLAIN_TEXT);
    row.json_file_url = jsonFile.getUrl();
    // Treat user-entered values as text, not spreadsheet formulae.
    const cell = value => value == null ? '' : typeof value === 'string' && /^[=+@-]/.test(value) ? "'"+value : value;
    sheet.appendRow(headers.map(name=>cell(row[name])));
    return {status:'success',research_id:p.research_id,record_key:key,fileUrl:row.json_file_url,maskUrl:row.mask512_url,csvUrl:row.profile_csv_url};
  } finally { lock.releaseLock(); }
}
