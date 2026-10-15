"""FMA 512 x 512 image/mask preprocessing (for a PyTorch Dataset loader).

Matches the canvas coordinate transform used in dev/index.html:
  cv.width = 1200
  cv.height = Math.round(1200 * image_height / image_width)
  scale = min(512/cv.width, 512/cv.height)
  offset = ((512-cv.width*scale)/2, (512-cv.height*scale)/2)

NOTE: Browser Canvas and OpenCV resampling filters may differ by a pixel at edges.
For source images use the same letterbox geometry; do NOT stretch to 512x512.
FMA *_mask512.png files are already letterboxed; DO NOT letterbox a second time.
"""

from __future__ import annotations

import math
from typing import Optional

import cv2
import numpy as np

TARGET = 512
CANVAS_WIDTH = 1200


def _transform(image_width: int, image_height: int, target_size: int):
    if image_width <= 0 or image_height <= 0 or target_size <= 0:
        raise ValueError("Image dimensions and target_size must be positive")
    canvas_width = CANVAS_WIDTH
    # JavaScript Math.round for nonnegative values (Python round uses banker's rounding).
    canvas_height = int(math.floor(CANVAS_WIDTH * image_height / image_width + 0.5))
    s = min(target_size / canvas_width, target_size / canvas_height)
    ox = (target_size - canvas_width * s) / 2.0
    oy = (target_size - canvas_height * s) / 2.0
    sx = s * canvas_width / image_width
    sy = s * canvas_height / image_height
    # Align OpenCV pixel centers to Canvas-like drawImage coordinates.
    return np.float32([[sx, 0, ox + (sx - 1) / 2],
                       [0, sy, oy + (sy - 1) / 2]])


def _labels(mask: np.ndarray) -> np.ndarray:
    if mask.ndim == 3:
        if mask.shape[2] not in (3, 4):
            raise ValueError("Mask must have 1, 3 or 4 channels")
        mask = mask[:, :, 0]
    if mask.ndim != 2:
        raise ValueError("Mask must be a 2D label image")
    m = np.asarray(mask, dtype=np.uint8)
    out = np.zeros(m.shape, dtype=np.int64)
    out[(m == 1) | ((m > 40) & (m <= 120))] = 1
    out[(m == 2) | ((m > 120) & (m <= 200))] = 2
    out[(m == 3) | (m > 200)] = 3
    return out


def preprocess_image_and_mask_512(
    img_bgr: np.ndarray,
    mask_raw: Optional[np.ndarray] = None,
    target_size: int = TARGET,
):
    """Return letterboxed BGR image and optional int64 labels (0..3).

    mask_raw can be an existing FMA mask512.png (already target_size squared),
    or a mask in the original image dimensions. In the former case, retain its
    pixels exactly; only the source image is letterboxed.
    """
    if img_bgr is None or img_bgr.ndim != 3 or img_bgr.shape[2] != 3:
        raise ValueError("Expected a BGR image with 3 channels")
    h, w = img_bgr.shape[:2]
    affine = _transform(w, h, target_size)
    aligned_img = cv2.warpAffine(
        img_bgr, affine, (target_size, target_size),
        flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0),
    )
    if mask_raw is None:
        return aligned_img
    mask = mask_raw[:, :, 0] if mask_raw.ndim == 3 else mask_raw
    if mask.shape == (target_size, target_size):
        aligned_mask = mask  # Already encoded in FMA mask512 coordinates.
    elif mask.shape == (h, w):
        aligned_mask = cv2.warpAffine(
            mask, affine, (target_size, target_size),
            flags=cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT,
            borderValue=0,
        )
    else:
        raise ValueError(
            f"Mask size {mask.shape} does not match source {(h, w)} "
            f"or pre-aligned {(target_size, target_size)}"
        )
    return aligned_img, _labels(aligned_mask)
