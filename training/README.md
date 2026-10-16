# FMA AI training pipeline

This folder contains the reproducible training/inference code for the AI-assisted AP segmentation component of Femoral Morphology Analyzer.

## Data governance
Patient-derived source radiographs, masks, annotations, Research-ID linkage, and trained model weights are **not committed to GitHub**. Keep them in the controlled research storage. GitHub stores code and model specifications only.

## Current frozen development run
FMA-AI-v2-10cases was trained on 10 teacher cases on 2026-10-13 using a small 4-class U-Net:
- 0 background
- 1 femur
- 2 canal
- 3 stem
- grayscale AP image
- 128x128 training input
- 512x512 exported class mask
- 50 epochs
- seed 20261013

The training cases were 02, 05, 10, 11, 12, 13, 14, 123153, 194400, and 258442. These IDs are documented for development traceability only and must not be used as patient identifiers.

## Important evaluation rule
Dice measured on the same cases used for training is **resubstitution QA only**, not validation performance. The next case must remain untouched, be inferred first, and only then may its teacher correction be added to a later training set.

## Example
```bash
python training/train_fma_v2.py --dataset /path/to/FMA_training_10cases --cases 02,05,10,11,12,13,14,123153,194400,258442 --out /path/to/output
python training/infer_fma_v2.py new_case.jpg new_case_mask512.png /path/to/output/FMA_UNet.pt
```

App-side conversion from the predicted class mask to editable contour/JSON suggestions remains a separate integration step.


## Jang-based AP pipeline (next formal development pipeline)
The legacy 10-case pilot code above is intentionally retained for reproducibility. New AP retraining should use `train_fma_jang_ap.py` and `infer_fma_jang_ap.py`.

Reference-method alignment:
- 512x512 input
- adaptive histogram equalization (CLAHE)
- crop, rotate, flip, contrast augmentation
- pretrained ResNet-34 encoder with U-Net decoder
- batch size 4
- 150 epochs
- best checkpoint selected by validation multiclass Dice

FMA-specific deviations are recorded in the model card: postoperative 4-class segmentation and weighted CE + Dice loss; mild augmentation ranges are explicitly fixed in code. Brightness augmentation is not used in the Jang-based baseline.

**Data leakage rule:** supply disjoint Research IDs to `--train-cases` and `--val-cases`; the script refuses overlap. Keep an untouched Research-ID-level test set outside both lists.

Example:
```bash
python training/train_fma_jang_ap.py --dataset /path/to/dataset --train-cases R001,R002,... --val-cases R0XX,R0YY --out /path/to/output
python training/infer_fma_jang_ap.py new_case.jpg new_case_mask512.png /path/to/output/FMA_ResNet34_UNet_best.pt
```
