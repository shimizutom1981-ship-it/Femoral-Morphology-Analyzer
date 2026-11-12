# Synthetic verification evidence, 2026-10-18 JST

These results cover two different source artifacts. They are not a claim that
the private test site, an installed desktop copy, or the supplied Colab notebook
has the same implementation. No patient images, records, masks, identifiers,
training runs or clinical validation are included.

## This draft PR: import, save and provenance changes

The tested implementation tree is
`36b5d0a2b017dd1a48d4fb1aee63b4b5d936e47c`, reproduced byte-for-byte in
commit `924c905d659d300f9f902a24a483aa8c9fea692d`.
This report and its logs add documentation only.

- `node --test tests/*.test.js`: 91 discovered, **90 passed**, 0 failed,
  **1 optional real-browser test skipped**.
  [Full test output](docs/qa/2026-10-18/pr-node-tests.txt).
- `node tests/save-regression.cjs`: **all 9 regression groups passed**.
  [Output](docs/qa/2026-10-18/pr-save-regression.txt).
- `git diff --check`: passed. Independent review found no remaining blocker in
  the reviewed implementation. Real-browser validation remains separate.

The added tests exercise JSON-first/image-first pairing; repeat selection after
cancel/error; latest-read/latest-decode ordering; malformed geometry and metadata
rejection without partial state mutation; fixed import field allowlisting;
LT-confirmation reset; explicit build/reference/conformance metadata; additive
displayed-ratio output; and save/cache/export blocking during or after failed
image decoding. Existing scientific formulas and axis solvers are unchanged.
See [the audit and saved-field definitions](IMPORT_SAVE_REVIEW.md).

## Separate local-label-validity-v4 artifact

This artifact is **not included in this draft PR**. Tests below ran against the
fetched, unchanged distribution, not the user's currently opened desktop file.
Source SHA256:

- `index.html`: `c628c6ec31b8333b5e90dc289f1e0fc920be395d20c988aa91e3a4985f991994`
- `training/validity_support.py`: `1a28293958885c4a6fc5fc69a8bf25e1c07728f9d9065ca930140d6340760b0d`
- `training/test_validity_support.py`: `b4e5593ffcb828e8baaa3a15fe686ccf463182d8c081b0239cc04743e56d104a`
- `training/train_fma_jang_ap.py`: `c6b25723a0d7338e8db27f0853706d64de68d7e4df1a43d53a647bbbca3c76ae`
- `training/train_fma_v2.py`: `5f2100b56b6725f33a5a6e0a734a0078677e139edd1493285cf726a277724cb3`

Runtime: Node 24.19.0, Python 3.12.14, NumPy 2.3.5, Pillow 12.3.0;
CPU torch 2.14.1+cpu and torchvision 0.29.1+cpu installed in an isolated
task-local environment from the official PyTorch CPU package registry.

- Existing JS suite: **107 passed**, 0 failed, 1 optional browser skip.
  [Output](docs/qa/2026-10-18/label-node-tests.txt).
- Existing save regressions: **9 groups passed**.
  [Output](docs/qa/2026-10-18/label-save-regression.txt).
- Original Python suite, `python -m unittest -v test_validity_support.py`:
  **5/5 passed**, with actual torch/torchvision.
  [Output](docs/qa/2026-10-18/python-original-tests.txt).
- Extended loader checks: **23/23 passed** using normal import of the original
  full module. Two repeat the original loader checks; 21 are additional.
  [Output](docs/qa/2026-10-18/python-loader-tests.txt).
- Additional CPU torch/torchvision runtime checks: **9/9 passed**.
  [Output](docs/qa/2026-10-18/python-runtime-tests.txt).
- Thus **35 distinct Python checks** passed: 5 + 23 + 9 minus 2 duplicates.
  These extra QA harnesses are separate from this PR's existing training folder;
  the attached outputs are evidence, not a claim that this PR implements the
  label-v4 validity pipeline.

Coverage includes shared ignore pixels for loss and evaluation, zero gradients
on ignored CE and soft-Dice pixels, mixed/all-invalid samples, undefined Dice
denominators, source pairing, categorical-label/binary-validity checks,
aspect-preserving transforms, and paired nearest-neighbor resize/crop/rotate/flip
including twenty seeded augmentation runs. No model training, optimizer step or
pretrained model download ran.

## Browser and release gates

- The PR's optional Chromium test is skipped in the successful 90-test run.
- Explicitly enabling the separate label-v4 browser suite produced 107 passes
  and one environment failure before app execution: Chromium socket creation
  was not permitted. The permitted escalation attempt failed before launch.
- Cloud browser was also tried: local file URLs were unsupported; the supported
  localhost HTTP route returned connection refused because the browser could
  not reach the shell execution namespace. No browser app assertions ran.
- A stale label-v4 optional browser fixture lacks the newly required full
  implant outline/contact/evidence/review. Its failure was reproduced in a Node
  VM. A replacement fixture and six PNG round-trip/invariance checks were
  prepared separately; six VM preflight checks passed, but **actual browser PNG
  encode/decode tests remain unrun**. VM canvas-command recording is not PNG
  verification. Production gates were not disabled to pass a test.
- The supplied Colab notebook has no validity/ignore-loss pipeline. The new
  validity-schema output must not be fed to it unchanged.
- GitHub's current workflow triggers only for the production branch or manual
  dispatch. Local passing tests are not a GitHub CI pass. Keep this PR in draft
  pending browser and scientific review and separate release authorization.

Publication of this report does not deploy the private test site or GAS,
replace teacher data, choose a formal study metric, or authorize a merge.
