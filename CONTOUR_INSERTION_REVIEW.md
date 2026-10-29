# Open-contour endpoint insertion fix

Base: `v2.1.2-cloud`, commit `70b8b221829c43ffd4a912dc589826ba4ebe3740`.
This change is separate from axis-separation PR #1.

The old nearest-segment rule inserts a click beyond an endpoint *inside* the
terminal segment. Repeated outward clicks can therefore reverse connectivity.
The fix retains nearest-segment insertion, except when the closest location is
an endpoint and the click projects outward along its terminal tangent. That
case prepends/appends. Coincident terminal vertices use the first distinct
neighbour; a closer interior segment wins on curved contours. No axis or
screen-y sorting is introduced. Perpendicular ties retain the old insertion.

Only the insertion index changes. Existing point objects, coordinates, IDs,
manual-anchor chronological history, correction counting, save and undo code
are untouched. Existing malformed contours are not migrated or repaired.
Manual-only tracing continues to append in click order. This is a fix for
endpoint-induced folding, not a general self-intersection prevention algorithm:
arbitrary off-contour clicks, dragging and pre-existing folds still need review.

## Reproducible verification

Run from repository root with Node (verified with v24.22.1):

```
node --test tests/contour-insertion.test.cjs
node tests/save-regression.cjs
git diff --check
```

- New suite: 21 passed, 0 failed, 0 skipped.
- Includes ordinary insertion, both endpoint extensions, reversed/vertical/
  oblique contours, curved interior selection, coincident endpoints and
  degenerate input. Sequential geometry is checked across 24 rotations,
  2 reflections and 3 scales (720 insertion decisions).
- All six contour types run the actual HTML pointer handler in a mocked DOM:
  five successive mixed additions, original AI IDs/coordinates unchanged,
  manual IDs and history in chronological order, unrelated metadata/history
  preserved, local save JSON equality and five ID-based undos.
- Manual-only tracing remains unchanged.
- Existing save-regression suite: all 9 groups passed.
- `git diff --check`: passed.
- These are local Node tests, not a GitHub Actions CI result or a real-browser
  visual test. No patient images, annotations, identifiers or log excerpts are
  included. Test coordinates and metadata are invented.

## Release boundary

No merge, production GAS deployment, private-site update, axis-method change,
or source-data migration is part of this PR. The existing GAS workflow runs
on pushes to `v2.1.2-cloud` (or manual dispatch), so merging this PR would be a
production-release decision. Before release, visually exercise endpoint and
interior clicks in the intended app/browser. Adoption of a separately repaired
annotation does not constitute validation or deployment of this code.
