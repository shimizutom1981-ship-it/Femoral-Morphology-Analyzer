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

/**
 * HTML側から呼び出される一括クラウド保存関数
 * 1) {rid}_mask512.png
 * 2) {rid}_profile.csv
 * 3) {rid}_overlay.png
 * 4) {rid}_annotation.json
 * 5) {rid}_fma_record.json
 * 6) case_list の行を自動追加・更新
 */
function saveFmaRecordToCloud(payload) {
  const folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName('case_list');

  if (!sheet) {
    sheet = ss.insertSheet('case_list');
    sheet.appendRow([
      'research_id', 'patient_id', 'image_stage', 'stem_family',
      'calib_known_mm', 'collar_status', 'exclusion_flag',
      'calibrated_mm_per_px', 'stem_alignment_deg', 'mean_stem_fill_total',
      'cfi', 'ccr', 'cbr', 'cti_minus100', 'lt_visibility_status', 'double_cortex_grade',
      'updated_at', 'json_file_url', 'mask512_url', 'profile_csv_url'
    ]);
    sheet.setFrozenRows(1);
  }

  const rid = payload.provenance_and_split.research_id;
  const overlayBase64 = payload.overlay_png_base64 || null;
  const mask512Base64 = payload.mask512_png_base64 || null;
  const profileCsvText = payload.profile_csv_text || null;
  delete payload.overlay_png_base64;
  delete payload.mask512_png_base64;
  delete payload.profile_csv_text;

  let maskFileUrl = '';
  if (mask512Base64) {
    const maskName = `${rid}_mask512.png`;
    const maskData = mask512Base64.replace(/^data:image\/png;base64,/, '');
    const maskBlob = Utilities.newBlob(Utilities.base64Decode(maskData), MimeType.PNG, maskName);
    const maskFile = saveOrUpdateBlobFile(folder, maskName, maskBlob);
    maskFileUrl = maskFile.getUrl();
  }

  let csvFileUrl = '';
  if (profileCsvText) {
    const csvName = `${rid}_profile.csv`;
    const csvFile = saveOrUpdateTextFile(folder, csvName, profileCsvText, MimeType.CSV);
    csvFileUrl = csvFile.getUrl();
  }

  if (overlayBase64) {
    const pngName = `${rid}_overlay.png`;
    const base64Data = overlayBase64.replace(/^data:image\/png;base64,/, '');
    const overlayBlob = Utilities.newBlob(Utilities.base64Decode(base64Data), MimeType.PNG, pngName);
    saveOrUpdateBlobFile(folder, pngName, overlayBlob);
  }

  if (payload.raw_annotations) {
    const annFileName = `${rid}_annotation.json`;
    const annContent = JSON.stringify(payload.raw_annotations, null, 2);
    saveOrUpdateTextFile(folder, annFileName, annContent, MimeType.PLAIN_TEXT);
  }

  const jsonFileName = `${rid}_fma_record.json`;
  const jsonContent = JSON.stringify(payload, null, 2);
  const jsonFile = saveOrUpdateTextFile(folder, jsonFileName, jsonContent, MimeType.PLAIN_TEXT);

  const rowData = [
    rid,
    payload.provenance_and_split.patient_id || '',
    payload.meta_input?.image_stage || 'postop_ap',
    payload.meta_input?.stem_family || '',
    payload.calibration_metrics?.calib_known_mm || 32.0,
    payload.meta_input?.collar_status || '',
    payload.meta_input?.exclusion_flag || 'eligible',
    payload.calibration_metrics?.calibrated_mm_per_px ?? '',
    payload.discrete_parameters?.stem_alignment_deg ?? '',
    payload.continuous_profile?.exploratory_summary?.mean_stem_fill_total ?? '',
    payload.discrete_parameters?.cfi ?? '',
    payload.discrete_parameters?.ccr ?? '',
    payload.discrete_parameters?.cbr ?? '',
    payload.discrete_parameters?.cti_minus100 ?? '',
    payload.segmentation_qc?.lt_visibility_status || 'clear',
    payload.segmentation_qc?.double_cortex_grade || 'none',
    new Date(),
    jsonFile.getUrl(),
    maskFileUrl,
    csvFileUrl
  ];

  const data = sheet.getDataRange().getValues();
  let targetRow = -1;
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(rid)) {
      targetRow = i + 1;
      break;
    }
  }

  if (targetRow > 0) {
    sheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);
  } else {
    sheet.appendRow(rowData);
  }

  return {
    status: 'success',
    research_id: rid,
    fileUrl: jsonFile.getUrl(),
    maskUrl: maskFileUrl,
    csvUrl: csvFileUrl
  };
}
