# Import, saved-field and version audit (draft)

Audit date: 2026-10-18 JST. Baseline: review branch commit
`2078ffafe58405af91308b1ef0a70f7db065aaef`. No scientific measurement
formula, contour solver, training configuration, source record or production
workflow is changed by this patch.

## JSON and image selection

A selected annotation/record is validated and held in memory when no image is
ready. After image decoding, the user must confirm the JSON/image pairing before
the working copy is applied. Import never inherits LT confirmation. Original
record bytes and saved masks remain unchanged. The file input is reset after
capture so cancelled/failed imports can select the same file again. Latest-file
sequence checks prevent out-of-order reads/decodes applying stale selections.
Supported imported geometry/metadata are validated before applying a record; malformed input cannot partially replace the current working copy. Save/cache/export are blocked during decoding and after failure, and the new image file identity is committed only on successful decode.
Image decode failure keeps the queued JSON; selecting a replacement JSON replaces
that pending entry. Cancelling an image picker leaves current work intact.

This is not automated image-identity verification. The confirmation displays the
selected JSON, loaded image filename and recorded source filename. Renamed source
images remain supported; the operator still verifies the actual image pair.

## Existing MCI and displayed Mod MCI are different quantities

All distances below use LT = 0, distal positive, proximal negative.

- Existing Data Dictionary `discrete_parameters.mci` is outer width at +20 mm
  divided by canal width at +70 mm. Its formula and numeric field are unchanged.
- The existing screen's **Mod MCI** is canal width at 0 divided by canal width at
  +70 mm. It is not a display of the dictionary's `mci`.
- The existing screen's **P10D20** is canal width at -10 divided by canal width at
  +20 mm. The previous hidden P10D30 is canal width at -10 divided by canal width
  at +30 mm.

The latter three ratios previously had no explicit fields in the structured
record or measurement CSV. They now appear in the additive
`displayed_ratio_metrics` object, including exact formula strings and direction
convention, and in formula-named appended CSV columns. Missing or unconfirmed
inputs remain null/blank. Existing keys, formulas and historic saved files are
not relabelled or rewritten. This does not select any ratio as a formal study
endpoint, validate its literature equivalence, or revise the frozen protocol.

## Version and LT state

The page, annotation and record identify the local build separately from the
algorithm family and exact Git commit. An unstamped checkout reports a null
commit rather than implying that it is a deployed build. Reference documents
(Protocol v2.1, Annotation Rule v1.1, Dictionary v1.2; 2026-10-16 LT update) are
identified separately from the existing v1.1-shaped record and additive fields.
Whole-rule conformance is explicitly unverified; the historical
`annotation_rule_ver` field is not promoted. LT confirmation is an explicit
runtime state that becomes false when dependent inputs change or a record is
imported. The completed-input guide no longer implies confirmation.

The previous help text promised a continuous profile with LT occluded. That is
not what the current bone-axis implementation does: no valid LT-dependent axis
means its dependent measurements remain unavailable. The help text now describes
the actual behavior; no alternate axis or missing-data rule is introduced.
The desired future LT-occluded behavior remains a protocol/implementation review
item, not a resolved scientific change.

## Version separation and remaining release gates

- Production GAS source remains on its existing baseline; this draft does not
  merge or deploy it.
- The private axis test site's saved version 4 corresponds to its hosting-source
  commit `fb716436bd60a36b025c3e7d2a6636fb67d1c731` and app-source stamp
  `2078ffafe58405af91308b1ef0a70f7db065aaef`. These are distinct repositories.
- The separately distributed `local-label-validity-v4` app adds the full implant
  label/validity pipeline. It is not present in the private axis test site or
  this PR. Its app family still reads v2.2-axis-split and it has no exact Git
  build stamp. This audit does not establish the user's currently opened desktop
  file's identity.
- The supplied Colab notebook has app-matched, aspect-preserving letterboxing,
  but no paired-validity/ignore-loss implementation. Its five code cells have no
  execution counts or saved outputs; code inspection does not prove a past run.
  It must not consume new validity-schema output unchanged.
- The separate label app's optional browser fixture predates its full-outline
  requirements; it needs a fully valid synthetic fixture before a browser pass
  can mean anything. Label gates must not be disabled to pass that test.
- The separately fetched label package passed its original five Python tests in
  an isolated official CPU Torch environment (torch 2.14.1+cpu, torchvision
  0.29.1+cpu), including loss/gradient/metric ignore behavior and paired
  augmentation. No training ran. Browser PNG encode/decode remains a separately
  reported gate. A JavaScript command recorder is not PNG testing.
- Patient-level adoption, anatomical contour review, acquisition evidence and
  untouched final-test partitioning are not established by software tests.

No patient records, radiographs, masks or study identifiers are included here.
