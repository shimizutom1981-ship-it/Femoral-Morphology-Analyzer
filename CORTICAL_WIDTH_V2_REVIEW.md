# Femoral-axis-normal cortical width candidate (2026-11-13)

User decision: measure cortical width perpendicular to the femoral axis, not the stem axis. Do not add radiolucent-line width. Draft implementation; **not clinical accuracy validation**.

## Scope and coordinates
- New `measureCorticalWidth()` and `fma_gruen_zones_v2` export. Raw annotation/save schema is unchanged.
- Require currently confirmed femoral axis/LT and matching positive mm/px calibration. No fallback to the stem axis.
- Retain implant-referenced AP Gruen partition and baseline zone 7 rules. Candidate section anchors are the existing stem-reference interval midpoint grid; the **direction** of each section is normal to the femoral axis. Samples are assigned by their fixed stem-anchor level/side so missing boundaries cannot change region denominators; the actual cortical midpoint is also saved. A slanted femoral-normal section may extend beyond its anchor region; this choice needs real-image review. This is an implementation proposal, not a frozen clinical endpoint or proof that identical bone tissue is followed after subsidence.
- Save each section anchor, side, region, projected width in mm, and explicit missing reason, plus normalized axis and calibration. Width = outer boundary distance minus endosteal boundary distance on the sampled side. This is 2D projected width, not local-normal/3D cortical thickness.
- Existing canal labels must still be verified as suitable endosteal boundaries on real images; no anatomical truth is inferred from them.

## Safety/compatibility
- Stem **contour** not required for cortical width. Stem axis/shoulder/tip remain required to define the existing Gruen regions.
- Missing or multiple crossings and reversed inner/outer boundaries produce null, not negative or zero. Exactly coincident valid boundaries remain numerical zero; zero does not imply absent cortex clinically.
- No new gap/RLL output in the new UI or v2 measurement. Old `measure()` unchanged for historical reproduction, retaining its old schema and known limitations. Old v1 result files remain usable only for region baseline carryover; their measured values are never relabeled as v2 width or compared automatically.
- Legacy v1 contains stem-normal widths/gaps. Never pool with v2 without an explicit method reconciliation. Main merge, public Pages, GAS, protocol/SAP and original patient records are outside this change.

## Verification
- Existing 101 node tests: 100 pass, 1 browser test skipped.
- New 9 synthetic tests: known widths without stem contour; femoral-vs-stem direction; negative-order QC; missing/multiple/coincident boundaries; unknown/unconfirmed/degenerate/nonfinite axis and scale mismatch; rotation/reflection/translation/scaling; legacy identity; invalid inputs.
- Mock app: compute/table/export, baseline v1/v2 loading, stale input invalidation, missing axis gate; save regression and longitudinal AP tests.
- Real browser end-to-end, clinical image precision, observer repeatability, projection sensitivity, and longitudinal same-bone-region correspondence remain **unverified**. The synthetic invariance tests are not patient repositioning tests.
