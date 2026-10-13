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
