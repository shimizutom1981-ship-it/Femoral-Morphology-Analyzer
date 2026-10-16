# Separate femoral and stem references (review branch)

This change integrates into the current `v2.1.2-cloud` source at commit
`70b8b221829c43ffd4a912dc589826ba4ebe3740`. It is published only on a review
branch. Saved source records, existing masks, training code and production
deployment are not modified. The production backend, immutable snapshot IDs,
required observation metadata, calibration validation and mask-extraction fixes
are preserved.

## Workflow

1. Calibrate the image and annotate each wall in proximal-to-distal connected order.
2. Place a provisional LT medial prominence landmark.
3. Review the cyan automatic FEMORAL axis and its perpendicular sections. Adjust
   LT to the medial prominence perpendicular to that axis, then explicitly confirm
   LT. No dependent numerical measurements are valid before confirmation.
4. Place the red manual STEM reference using proximal/distal template-aligned
   points. These determine alignment only. The optional edge-fit diagnostic is
   never substituted for this reference. Native femora need no STEM reference.
5. Review the actual `10 / X mm` levels, fallback reason and quality status.

Bone contours, LT, visibility, calibration and head-calibration inputs invalidate
confirmation and all derived results. STEM point movement cannot change FEMORAL
measurements or contour/mask geometry. An exact-input modern work-session restore
can retain confirmation; imported records require a fresh review.

## Femoral method

`lib/femoral-axis.js` is a pure, deterministic, versioned solver. It uses the same
centripetal smoothed open polylines as rendering and masks, preserving connectivity.
Its initializer is the sum of the walls' proximal-to-distal endpoint directions,
with no implant or image-y seed. It iterates axis-perpendicular sections at LT+10
and LT+100 mm, connecting their medial/lateral wall midpoints, using damped direction
updates until angular residual is below 1e-9 radians (maximum 400 iterations).

Fallback is attempted in order 100 → 90 → 80 mm only with geometrically established absent distal
coverage. The geometric check requires an entire missing wall to lie within the
LT-centered radius for that level. Since a ball is convex, all polyline segments
then also lie inside it and no orientation can provide a crossing. This is
intentionally conservative: some genuinely truncated wide/oblique contours can
return `coverage_unproven` and require review. It is not acceptable to interpret
an initializer failure as image truncation. Multiple crossings, collinear sections,
nonconvergence, invalid scale and missing 10-mm coverage are hard failures.

Fixed-distance parameters remain at their defined levels. In particular, a valid
10/90 or 10/80 axis does not supply a missing 100-mm width, CTI, CFI, CCR or CBR.
Unavailable values are null in JSON, blank in CSV and `--` on screen, with reason
metadata. Missing/ambiguous fixed-level contours are not extrapolated.

## Compatibility and provenance

Axes store schema, method/version, exact input contours and calibration, endpoints,
actual levels, fallback evidence, residual, iterations and review state. Contour
geometry has a separate version. The existing annotation rule remains honestly
`v1.0`; this change does not claim adoption of all rules in a separate v1.1 document.
The algorithm version is `v2.2-axis-split`; the production build-commit injection
is preserved and remains null outside an identified build.

Legacy source files and `FMA_work_v21_*` entries are never rewritten. A working copy
freezes the prior renderer's contour ordering once; original mask bytes are not
regenerated or replaced automatically. Legacy `sap`/`sad` are unverified candidates
and can become STEM references only through explicit confirmation. Same-source-filename
exports are blocked for imported cases; the existing Research ID can be retained
while the production `newSaveKey()` mechanism creates a new immutable UUID snapshot. New work
is stored under `FMA_work_axes_v1_*` and recalculated rather than trusting stored
profiles. Source/calibration absence produces missing measurements, not a guess.

## Verification and limitations

Run all dependency-free numerical and application integration checks:

    node --test tests/*.test.js
    node tests/save-regression.cjs

The app tests execute the actual HTML script with a fake DOM/canvas. They compare
mask drawing-command bytes, not raster pixels. An optional Playwright/Chromium
PNG-byte test is enabled with `FMA_BROWSER_TESTS=1`; it requires an environment
that permits Chromium startup. Browser raster validation remains a release gate
when that test cannot run. This branch is for review, not clinical deployment.

Local read-only validation of ten existing rendered-contour cases found eight
10/100 and two 10/90 solutions, with no failed coverage certificates. No patient
records, images, identifiers or individual results are included in this repository.
Rendered smoothing differed from the earlier straight-polyline calculation by
mean absolute 0.081 degrees (maximum 0.170 degrees) at the selected level; these
are distinct analyses, not an exact equivalence claim. This limited check is not
clinical validation or evidence for automatic source-data migration.

## GAS packaging and deployment safety

The canonical solver is copied inline into the existing single script in
`index.html`. A parity test fails if the inline copy and `lib/femoral-axis.js`
diverge. This works with the unchanged `Code.gs` createHtmlOutputFromFile route
and existing clasp allowlist; no external JavaScript fetch is needed.

The existing GAS workflow triggers only pushes to `v2.1.2-cloud` or manual
dispatch. Publishing this feature branch or draft PR does not deploy. No
workflow or deployment configuration is changed. Merge/release requires separate
explicit authorization after the outstanding browser validation.
