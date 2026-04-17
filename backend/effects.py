"""
Post-processing effects driven by depth maps.

All functions accept:
  image  — PIL.Image (RGB)
  depth  — float32 ndarray [0,1], same spatial size as image (near=0, far=1)

And return a PIL.Image (RGBA or RGB depending on effect).
"""

import numpy as np
from PIL import Image
from typing import Tuple, Optional
import math


# ── Helpers ───────────────────────────────────────────────────────────────────

def _ensure_same_size(image: Image.Image, depth: np.ndarray) -> np.ndarray:
    h, w = depth.shape[:2]
    if (image.width, image.height) != (w, h):
        from PIL import Image as PILImage
        depth_img = PILImage.fromarray((depth * 255).astype(np.uint8), mode="L")
        depth_img = depth_img.resize((image.width, image.height), Image.BILINEAR)
        depth = np.array(depth_img, dtype=np.float32) / 255.0
    return depth


def _hex_to_rgb(hex_color: str) -> Tuple[int, int, int]:
    hex_color = hex_color.lstrip("#")
    if len(hex_color) == 3:
        hex_color = "".join(c * 2 for c in hex_color)
    r = int(hex_color[0:2], 16)
    g = int(hex_color[2:4], 16)
    b = int(hex_color[4:6], 16)
    return r, g, b


# ── Effect 1: Depth Slicing ───────────────────────────────────────────────────

def depth_slice(
    image: Image.Image,
    depth: np.ndarray,
    near: float = 0.0,
    far: float = 0.5,
    bg_color: str = "#000000",
    bg_alpha: int = 0,
    feather: float = 0.02,
    invert_mask: bool = False,
) -> Image.Image:
    """
    Isolate pixels within a depth band [near, far].

    near, far    — depth thresholds 0–1 (near=0, far=1)
    bg_color     — hex colour for out-of-band pixels (used when bg_alpha > 0)
    bg_alpha     — 0 = transparent bg (RGBA), 255 = opaque bg (RGB composite)
    feather      — soft edge width (fraction of depth range)
    invert_mask  — show what's OUTSIDE the band instead
    """
    depth = _ensure_same_size(image, depth)
    img_arr = np.array(image.convert("RGBA"), dtype=np.uint8)

    # Build soft mask
    mask = np.zeros(depth.shape, dtype=np.float32)
    if feather > 0:
        near_ramp = np.clip((depth - near) / (feather + 1e-8), 0, 1)
        far_ramp  = np.clip((far - depth)  / (feather + 1e-8), 0, 1)
        mask = near_ramp * far_ramp
    else:
        mask = ((depth >= near) & (depth <= far)).astype(np.float32)

    mask = np.clip(mask, 0, 1)
    if invert_mask:
        mask = 1.0 - mask

    if bg_alpha == 0:
        # RGBA output with transparent background
        out = img_arr.copy()
        out[:, :, 3] = (mask * 255).astype(np.uint8)
        return Image.fromarray(out, "RGBA")
    else:
        # Composite over bg_color
        bg = np.array(_hex_to_rgb(bg_color), dtype=np.float32)
        src = img_arr[:, :, :3].astype(np.float32)
        m = mask[:, :, np.newaxis]
        composited = (src * m + bg * (1 - m)).clip(0, 255).astype(np.uint8)
        return Image.fromarray(composited, "RGB")


# ── Effect 2: Depth Grading ───────────────────────────────────────────────────

def depth_grade(
    image: Image.Image,
    depth: np.ndarray,
    near_color: str = "#ff6600",
    far_color: str = "#0044ff",
    opacity: float = 0.5,
    gamma: float = 1.0,
    blend_mode: str = "overlay",
    near_offset: float = 0.0,
    far_offset: float = 1.0,
) -> Image.Image:
    """
    Apply a depth-driven colour grade to the image.

    near_color / far_color — hex colours mapped to depth extremes
    opacity     — grade layer opacity 0–1
    gamma       — depth ramp gamma (>1 = more near, <1 = more far)
    blend_mode  — 'overlay' | 'multiply' | 'screen' | 'add' | 'normal'
    near_offset / far_offset — remap the depth input range
    """
    depth = _ensure_same_size(image, depth)

    # Remap depth range
    d = np.clip((depth - near_offset) / (far_offset - near_offset + 1e-8), 0, 1)
    d = np.power(d, gamma)

    # Build colour ramp
    nr = np.array(_hex_to_rgb(near_color), dtype=np.float32) / 255.0
    fr = np.array(_hex_to_rgb(far_color),  dtype=np.float32) / 255.0
    ramp = (nr * (1 - d[:, :, np.newaxis]) + fr * d[:, :, np.newaxis])  # (H,W,3)

    src = np.array(image.convert("RGB"), dtype=np.float32) / 255.0

    # Blend modes
    if blend_mode == "overlay":
        dark = 2.0 * src * ramp
        lite = 1.0 - 2.0 * (1.0 - src) * (1.0 - ramp)
        blended = np.where(src < 0.5, dark, lite)
    elif blend_mode == "multiply":
        blended = src * ramp
    elif blend_mode == "screen":
        blended = 1.0 - (1.0 - src) * (1.0 - ramp)
    elif blend_mode == "add":
        blended = np.clip(src + ramp, 0, 1)
    else:  # normal
        blended = ramp

    out = src * (1 - opacity) + blended * opacity
    out = np.clip(out * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(out, "RGB")


# ── Effect 3: Depth of Field ──────────────────────────────────────────────────

def depth_of_field(
    image: Image.Image,
    depth: np.ndarray,
    focal_depth: float = 0.3,
    focal_range: float = 0.1,
    max_blur: float = 20.0,
    bokeh_shape: str = "gaussian",
    near_blur: bool = True,
    far_blur: bool = True,
) -> Image.Image:
    """
    Depth-driven depth of field via layered Gaussian blur.

    focal_depth  — depth of the in-focus plane (0=near, 1=far)
    focal_range  — half-width of the in-focus zone
    max_blur     — maximum blur radius in pixels
    bokeh_shape  — 'gaussian' | 'disc' (disc = harder bokeh edges)
    near_blur    — blur pixels closer than focal plane
    far_blur     — blur pixels farther than focal plane
    """
    from PIL import ImageFilter

    depth = _ensure_same_size(image, depth)

    # Build per-pixel blur amount [0, max_blur]
    dist = np.abs(depth - focal_depth) - focal_range
    dist = np.clip(dist, 0, None)
    blur_map = (dist / (0.5 - focal_range + 1e-8)) * max_blur
    blur_map = np.clip(blur_map, 0, max_blur)

    # Mask near/far
    if not near_blur:
        blur_map[depth < focal_depth] = 0
    if not far_blur:
        blur_map[depth > focal_depth] = 0

    # Layered blur: render at N discrete blur levels and blend
    blur_levels = [0, 2, 4, 8, 12, 18, max_blur]
    blur_levels = sorted(set([0, max_blur / 4, max_blur / 2, max_blur * 0.75, max_blur]))

    src = np.array(image.convert("RGB"), dtype=np.float32)
    result = src.copy()

    for i in range(len(blur_levels) - 1):
        lo = blur_levels[i]
        hi = blur_levels[i + 1]
        mid = (lo + hi) / 2.0

        if mid < 0.5:
            continue

        # Blur at this level
        if bokeh_shape == "disc":
            blurred = _box_blur(image, mid)
        else:
            blurred = np.array(
                image.filter(ImageFilter.GaussianBlur(radius=mid)),
                dtype=np.float32
            )

        # Blend mask: pixels whose blur amount falls in [lo, hi]
        blend = np.clip((blur_map - lo) / (hi - lo + 1e-8), 0, 1)
        blend = blend[:, :, np.newaxis]
        result = result * (1 - blend) + blurred * blend

    return Image.fromarray(result.clip(0, 255).astype(np.uint8), "RGB")


def _box_blur(image: Image.Image, radius: float) -> np.ndarray:
    """Approximate disc bokeh with iterated box blurs."""
    from PIL import ImageFilter
    r = max(1, int(radius))
    img = image
    for _ in range(3):
        img = img.filter(ImageFilter.BoxBlur(r))
    return np.array(img, dtype=np.float32)


# ── Convenience dispatcher ────────────────────────────────────────────────────

def apply_effect(
    effect: str,
    image: Image.Image,
    depth: np.ndarray,
    params: dict,
) -> Image.Image:
    """
    effect: 'slice' | 'grade' | 'dof'
    params: dict of kwargs for the effect function
    """
    if effect == "slice":
        return depth_slice(image, depth, **params)
    elif effect == "grade":
        return depth_grade(image, depth, **params)
    elif effect == "dof":
        return depth_of_field(image, depth, **params)
    else:
        raise ValueError(f"Unknown effect: {effect!r}. Choose: slice, grade, dof")
