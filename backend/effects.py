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


# ── Effect 4: Depth Fog ──────────────────────────────────────────────────────

def depth_fog(
    image: Image.Image,
    depth: np.ndarray,
    fog_color: str = "#c8c8d0",
    density: float = 0.7,
    near_start: float = 0.3,
    far_end: float = 1.0,
    noise_amount: float = 0.1,
    noise_scale: float = 50.0,
) -> Image.Image:
    """
    Add atmospheric fog/haze driven by depth.

    fog_color    — hex colour of the fog
    density      — maximum fog opacity (0–1)
    near_start   — depth value where fog begins (0=near, 1=far)
    far_end      — depth value where fog is fully opaque
    noise_amount — adds fractal variation to fog edge (0–1)
    noise_scale  — scale of noise pattern
    """
    depth = _ensure_same_size(image, depth)
    src = np.array(image.convert("RGB"), dtype=np.float32) / 255.0
    fog_rgb = np.array(_hex_to_rgb(fog_color), dtype=np.float32) / 255.0

    # Build fog mask from depth
    fog_mask = np.clip((depth - near_start) / (far_end - near_start + 1e-8), 0, 1)

    # Optional noise for natural fog edge
    if noise_amount > 0:
        h, w = depth.shape
        # Simple deterministic noise pattern
        ys = np.arange(h).reshape(-1, 1) / max(noise_scale, 1)
        xs = np.arange(w).reshape(1, -1) / max(noise_scale, 1)
        noise = np.sin(ys * 12.9898 + xs * 78.233) * 43758.5453
        noise = noise - np.floor(noise)  # fract
        noise = (noise - 0.5) * 2 * noise_amount
        fog_mask = np.clip(fog_mask + noise, 0, 1)

    fog_mask = fog_mask * density
    fog_mask = fog_mask[:, :, np.newaxis]

    out = src * (1 - fog_mask) + fog_rgb * fog_mask
    out = np.clip(out * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(out, "RGB")


# ── Effect 5: Parallax / 2.5D ───────────────────────────────────────────────

def depth_parallax(
    image: Image.Image,
    depth: np.ndarray,
    shift_x: float = 20.0,
    shift_y: float = 0.0,
    zoom: float = 0.0,
    blur_depth: float = 5.0,
) -> Image.Image:
    """
    Displace pixels by depth to simulate camera movement (parallax).

    shift_x      — horizontal displacement in pixels (+ = right)
    shift_y      — vertical displacement in pixels (+ = down)
    zoom         — depth-driven zoom amount (-50 to 50)
    blur_depth   — blur the depth map before displacement to reduce artifacts
    """
    from PIL import ImageFilter
    depth = _ensure_same_size(image, depth)

    # Blur depth for smoother displacement
    if blur_depth > 0:
        depth_img = Image.fromarray((depth * 255).astype(np.uint8), mode="L")
        depth_img = depth_img.filter(ImageFilter.GaussianBlur(radius=blur_depth))
        depth = np.array(depth_img, dtype=np.float32) / 255.0

    h, w = depth.shape
    src = np.array(image.convert("RGB"), dtype=np.float32)

    # Build displacement map: near objects move more, far objects move less
    # Invert so near=1 (moves most), far=0 (moves least)
    disp = 1.0 - depth

    # Create coordinate grids
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)

    # Apply displacement
    dx = disp * shift_x
    dy = disp * shift_y

    # Optional zoom (radial displacement from center)
    if abs(zoom) > 0.1:
        cx, cy = w / 2, h / 2
        rx = (xs - cx) / w
        ry = (ys - cy) / h
        dx += disp * rx * zoom
        dy += disp * ry * zoom

    map_x = np.clip(xs - dx, 0, w - 1).astype(np.float32)
    map_y = np.clip(ys - dy, 0, h - 1).astype(np.float32)

    # Remap using bilinear interpolation
    import cv2
    result = cv2.remap(
        src, map_x, map_y,
        interpolation=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REFLECT,
    )

    return Image.fromarray(result.clip(0, 255).astype(np.uint8), "RGB")


# ── Effect 6: Wigglegram ────────────────────────────────────────────────────

def create_wigglegram(
    image: Image.Image,
    depth: np.ndarray,
    num_views: int = 5,
    separation: float = 15.0,
    path: str = "linear",
    blur_depth: float = 5.0,
) -> list:
    """
    Generate N displaced views by shifting pixels using depth.
    Near objects move more, far objects move less.

    num_views   — number of views to generate (3–7)
    separation  — max horizontal shift in pixels
    path        — 'linear' (horizontal sweep) or 'arc' (slight vertical arc)
    blur_depth  — blur depth map before displacement to reduce artifacts

    Returns a list of PIL Images (the views).
    """
    import cv2
    from PIL import ImageFilter

    depth = _ensure_same_size(image, depth)

    # Blur depth for smoother displacement
    if blur_depth > 0:
        depth_img = Image.fromarray((depth * 255).astype(np.uint8), mode="L")
        depth_img = depth_img.filter(ImageFilter.GaussianBlur(radius=blur_depth))
        depth = np.array(depth_img, dtype=np.float32) / 255.0

    h, w = depth.shape
    src = np.array(image.convert("RGB"), dtype=np.float32)
    disp = 1.0 - depth  # near=1 (moves most), far=0

    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)

    views = []
    for i in range(num_views):
        t = (i / max(num_views - 1, 1)) * 2.0 - 1.0  # -1 to +1
        shift_x = t * separation

        if path == "arc":
            shift_y = (1.0 - t * t) * separation * 0.3  # parabolic arc
        else:
            shift_y = 0.0

        dx = disp * shift_x
        dy = disp * shift_y

        map_x = np.clip(xs - dx, 0, w - 1).astype(np.float32)
        map_y = np.clip(ys - dy, 0, h - 1).astype(np.float32)

        result = cv2.remap(
            src, map_x, map_y,
            interpolation=cv2.INTER_LINEAR,
            borderMode=cv2.BORDER_REFLECT,
        )
        views.append(Image.fromarray(result.clip(0, 255).astype(np.uint8), "RGB"))

    return views


# ── Effect 7: Spatial Photo (stereo pair) ───────────────────────────────────

def create_spatial_pair(
    image: Image.Image,
    depth: np.ndarray,
    eye_separation: float = 30.0,
    convergence: float = 0.5,
    blur_depth: float = 5.0,
) -> tuple:
    """
    Generate left/right eye views for spatial/3D viewing.

    eye_separation — horizontal offset in pixels between eyes
    convergence    — 0–1, depth at which left/right overlap (screen plane)
    blur_depth     — smooth depth before displacement

    Returns (left_img, right_img) as PIL Images.
    """
    import cv2
    from PIL import ImageFilter

    depth = _ensure_same_size(image, depth)

    if blur_depth > 0:
        depth_img = Image.fromarray((depth * 255).astype(np.uint8), mode="L")
        depth_img = depth_img.filter(ImageFilter.GaussianBlur(radius=blur_depth))
        depth = np.array(depth_img, dtype=np.float32) / 255.0

    h, w = depth.shape
    src = np.array(image.convert("RGB"), dtype=np.float32)
    disp = 1.0 - depth  # near=1, far=0

    # Shift relative to convergence plane
    disp_shifted = disp - (1.0 - convergence)

    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    half_sep = eye_separation / 2.0

    # Left eye: shift right
    map_x_l = np.clip(xs - disp_shifted * half_sep, 0, w - 1).astype(np.float32)
    map_y_l = ys.copy()
    left = cv2.remap(src, map_x_l, map_y_l, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)

    # Right eye: shift left
    map_x_r = np.clip(xs + disp_shifted * half_sep, 0, w - 1).astype(np.float32)
    map_y_r = ys.copy()
    right = cv2.remap(src, map_x_r, map_y_r, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)

    left_img = Image.fromarray(left.clip(0, 255).astype(np.uint8), "RGB")
    right_img = Image.fromarray(right.clip(0, 255).astype(np.uint8), "RGB")

    return left_img, right_img


# ── Effect 8: Depth Transition ──────────────────────────────────────────────

def depth_transition(
    image_a: Image.Image,
    image_b: Image.Image,
    depth_a: np.ndarray,
    transition: float = 0.5,
    softness: float = 0.1,
) -> Image.Image:
    """
    Depth-driven wipe: uses depth_a as gradient to blend between two images.

    image_a     — first image (shown where depth < transition)
    image_b     — second image (shown where depth > transition)
    depth_a     — depth map of image_a used as wipe gradient
    transition  — wipe position 0–1
    softness    — feather width 0–0.5
    """
    depth_a = _ensure_same_size(image_a, depth_a)

    # Resize image_b to match image_a
    if image_b.size != image_a.size:
        image_b = image_b.resize(image_a.size, Image.LANCZOS)

    arr_a = np.array(image_a.convert("RGB"), dtype=np.float32) / 255.0
    arr_b = np.array(image_b.convert("RGB"), dtype=np.float32) / 255.0

    if softness > 0.001:
        mask = np.clip((depth_a - transition + softness) / (2 * softness + 1e-8), 0, 1)
    else:
        mask = (depth_a >= transition).astype(np.float32)

    mask = mask[:, :, np.newaxis]
    out = arr_a * (1 - mask) + arr_b * mask
    out = np.clip(out * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(out, "RGB")


# ── Effect 9: Posterize Depth ───────────────────────────────────────────────

def posterize_depth(
    image: Image.Image,
    depth: np.ndarray,
    levels: int = 4,
    colorize: bool = False,
    colormap: str = "inferno",
) -> Image.Image:
    """
    Quantize depth into N discrete bands.

    levels    — number of depth bands (2–10)
    colorize  — if True, apply colormap to posterized depth
    colormap  — colormap name (only used if colorize=True)
    """
    from depth_engine import COLORMAPS

    depth = _ensure_same_size(image, depth)
    levels = max(2, min(10, levels))

    # Quantize
    posterized = np.floor(depth * levels) / levels
    posterized = np.clip(posterized, 0, 1)

    if colorize:
        lut = COLORMAPS.get(colormap, COLORMAPS["inferno"])
        idx = (np.clip(posterized, 0, 1) * 255).astype(np.uint8)
        rgb = lut[idx]
        return Image.fromarray(rgb, "RGB")
    else:
        gray = (posterized * 255).astype(np.uint8)
        return Image.fromarray(gray, "L").convert("RGB")


def posterize_depth_array(depth: np.ndarray, levels: int = 4) -> np.ndarray:
    """Quantize depth array into discrete bands. Returns float32 [0,1]."""
    levels = max(2, min(10, levels))
    posterized = np.floor(depth * levels) / levels
    return np.clip(posterized, 0, 1).astype(np.float32)


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
    elif effect == "fog":
        return depth_fog(image, depth, **params)
    elif effect == "parallax":
        return depth_parallax(image, depth, **params)
    elif effect == "posterize":
        return posterize_depth(image, depth, **params)
    else:
        raise ValueError(f"Unknown effect: {effect!r}. Choose: slice, grade, dof, fog, parallax, posterize")
