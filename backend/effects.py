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

def _make_bokeh_kernel(shape: str, radius: int, image_shape=None, px=0, py=0) -> np.ndarray:
    """Generate a 2D bokeh kernel of given shape and radius."""
    r = max(1, radius)
    size = r * 2 + 1
    y, x = np.mgrid[-r:r+1, -r:r+1].astype(np.float32)
    dist = np.sqrt(x*x + y*y)

    if shape == "disc":
        # Hard-edged circle
        k = (dist <= r).astype(np.float32)

    elif shape == "ring" or shape == "soap_bubble":
        # Bright outer ring, dim interior (Trioplan style)
        inner = r * 0.7
        k = np.exp(-((dist - r * 0.85) ** 2) / (r * 0.15 + 1e-8) ** 2)
        k += 0.15 * (dist <= r).astype(np.float32)  # dim fill

    elif shape == "donut":
        # Mirror lens — hollow center, bright ring
        inner = r * 0.55
        k = ((dist >= inner) & (dist <= r)).astype(np.float32)

    elif shape == "onion_ring":
        # Concentric rings inside disc
        k = (dist <= r).astype(np.float32)
        rings = 0.5 + 0.5 * np.cos(2 * np.pi * dist / max(r * 0.25, 1))
        k *= rings

    elif shape == "cat_eye":
        # Vignetting: intersect disc with shifted disc based on distance from center
        k = (dist <= r).astype(np.float32)
        if image_shape is not None:
            ih, iw = image_shape[:2]
            cx, cy = iw / 2, ih / 2
            # How far this pixel is from center (0-1)
            radial = math.sqrt((px - cx)**2 + (py - cy)**2) / (math.sqrt(cx**2 + cy**2) + 1e-8)
            if radial > 0.3:
                # Shift direction: toward center
                dx = (cx - px) / (abs(cx - px) + abs(cy - py) + 1e-8)
                dy = (cy - py) / (abs(cx - px) + abs(cy - py) + 1e-8)
                shift = radial * r * 0.6
                shifted_dist = np.sqrt((x - dx * shift)**2 + (y - dy * shift)**2)
                k2 = (shifted_dist <= r).astype(np.float32)
                k = k * k2  # intersection

    elif shape == "anamorphic":
        # Oval: tall, narrow (2:1 vertical stretch)
        oval_dist = np.sqrt((x * 2.0)**2 + y**2)
        k = (oval_dist <= r).astype(np.float32)

    elif shape == "petzval":
        # Swirl: radial motion blur direction based on angle from center
        k = (dist <= r).astype(np.float32)
        # Add tangential smear
        angle = np.arctan2(y, x)
        tangent_x = -np.sin(angle)
        tangent_y = np.cos(angle)
        smear = np.exp(-((x * tangent_y - y * tangent_x)**2) / (r * 0.4 + 1e-8)**2)
        k = k * 0.4 + smear * 0.6 * (dist <= r * 1.2).astype(np.float32)

    elif shape == "hexagon":
        # 6-blade aperture
        k = np.ones((size, size), dtype=np.float32)
        for angle_deg in [0, 60, 120]:
            angle = math.radians(angle_deg)
            proj = np.abs(x * math.cos(angle) + y * math.sin(angle))
            k *= (proj <= r * 0.87).astype(np.float32)

    else:
        # gaussian (default) — smooth falloff
        k = np.exp(-(dist**2) / (2 * (r * 0.45)**2))

    # Normalize
    total = k.sum()
    if total > 0:
        k /= total
    return k


def _convolve_with_kernel(src: np.ndarray, kernel: np.ndarray) -> np.ndarray:
    """Convolve RGB image with a 2D kernel using cv2."""
    import cv2
    result = np.zeros_like(src)
    for c in range(3):
        result[:, :, c] = cv2.filter2D(src[:, :, c], -1, kernel)
    return result


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
    Depth-driven depth of field with multiple bokeh styles.

    focal_depth  — depth of the in-focus plane (0=near, 1=far)
    focal_range  — half-width of the in-focus zone
    max_blur     — maximum blur radius in pixels
    bokeh_shape  — 'gaussian' | 'disc' | 'hexagon' | 'ring' | 'soap_bubble' |
                   'donut' | 'onion_ring' | 'cat_eye' | 'anamorphic' | 'petzval'
    near_blur    — blur pixels closer than focal plane
    far_blur     — blur pixels farther than focal plane
    """
    depth = _ensure_same_size(image, depth)

    # Build per-pixel blur amount [0, max_blur]
    dist = np.abs(depth - focal_depth) - focal_range
    dist = np.clip(dist, 0, None)
    blur_map = (dist / (0.5 - focal_range + 1e-8)) * max_blur
    blur_map = np.clip(blur_map, 0, max_blur)

    if not near_blur:
        blur_map[depth < focal_depth] = 0
    if not far_blur:
        blur_map[depth > focal_depth] = 0

    # Layered blur with shaped kernels
    blur_levels = sorted(set([0, max_blur / 4, max_blur / 2, max_blur * 0.75, max_blur]))

    src = np.array(image.convert("RGB"), dtype=np.float32)
    result = src.copy()
    h, w = src.shape[:2]

    for i in range(len(blur_levels) - 1):
        lo = blur_levels[i]
        hi = blur_levels[i + 1]
        mid = (lo + hi) / 2.0

        if mid < 0.5:
            continue

        radius = max(1, int(mid))
        kernel = _make_bokeh_kernel(bokeh_shape, radius, image_shape=(h, w), px=w//2, py=h//2)
        blurred = _convolve_with_kernel(src, kernel)

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

## ── Film Filter Presets ──────────────────────────────────────────────────────

FILM_PRESETS = {
    "none":        {"blur_strength": 0, "flash_intensity": 0, "vignette_strength": 0, "light_leak_opacity": 0, "grain_amount": 0, "halation_radius": 0, "contrast": 0, "saturation": 0, "fade": 0, "tint_color": "", "tint_strength": 0, "gradient_map": "none"},
    "disposable":  {"blur_strength": 12, "flash_intensity": 0.8, "vignette_strength": 0.6, "light_leak_opacity": 0.3, "grain_amount": 0.25, "halation_radius": 8, "contrast": 0.1, "saturation": -0.1, "fade": 0.05, "tint_color": "#ffe0a0", "tint_strength": 0.1, "gradient_map": "none"},
    "flash":       {"blur_strength": 0, "flash_intensity": 1.5, "vignette_strength": 0.3, "light_leak_opacity": 0, "grain_amount": 0.15, "halation_radius": 12, "contrast": 0.15, "saturation": 0, "fade": 0, "tint_color": "", "tint_strength": 0, "gradient_map": "none"},
    "dreamy":      {"blur_strength": 15, "flash_intensity": 0, "vignette_strength": 0.4, "light_leak_opacity": 0.5, "grain_amount": 0.1, "halation_radius": 20, "contrast": -0.1, "saturation": -0.15, "fade": 0.1, "tint_color": "#c8a0ff", "tint_strength": 0.15, "gradient_map": "none"},
    "lo-fi":       {"blur_strength": 5, "flash_intensity": 0.3, "vignette_strength": 0.8, "light_leak_opacity": 0.6, "grain_amount": 0.4, "halation_radius": 5, "contrast": 0.2, "saturation": 0.1, "fade": 0.08, "tint_color": "#ff8040", "tint_strength": 0.08, "gradient_map": "none"},
    "cinematic":   {"blur_strength": 18, "flash_intensity": 0, "vignette_strength": 0.5, "light_leak_opacity": 0, "grain_amount": 0.08, "halation_radius": 0, "contrast": 0.15, "saturation": -0.05, "fade": 0, "tint_color": "#4080c0", "tint_strength": 0.06, "gradient_map": "none"},
    "noir":        {"blur_strength": 8, "flash_intensity": 0, "vignette_strength": 0.7, "light_leak_opacity": 0, "grain_amount": 0.3, "halation_radius": 0, "contrast": 0.3, "saturation": -0.8, "fade": 0, "tint_color": "", "tint_strength": 0, "gradient_map": "none"},
    "warm-fade":   {"blur_strength": 0, "flash_intensity": 0, "vignette_strength": 0.3, "light_leak_opacity": 0.2, "grain_amount": 0.15, "halation_radius": 0, "contrast": -0.05, "saturation": -0.2, "fade": 0.15, "tint_color": "#ffa060", "tint_strength": 0.12, "gradient_map": "warm"},
    "cool-tone":   {"blur_strength": 0, "flash_intensity": 0, "vignette_strength": 0.2, "light_leak_opacity": 0, "grain_amount": 0.1, "halation_radius": 0, "contrast": 0.1, "saturation": -0.1, "fade": 0, "tint_color": "#6090c0", "tint_strength": 0.1, "gradient_map": "cool"},
}

# Gradient map LUTs: shadow_color → highlight_color
GRADIENT_MAPS = {
    "none": None,
    "warm":    [(30, 20, 60), (255, 200, 120)],    # deep blue shadows → warm highlights
    "cool":    [(20, 30, 60), (140, 190, 255)],     # dark blue → cool sky
    "vintage": [(50, 30, 20), (240, 220, 180)],     # sepia-like
    "neon":    [(20, 0, 40), (255, 100, 200)],       # dark purple → hot pink
    "forest":  [(10, 30, 20), (180, 220, 140)],      # dark green → light green
    "sunset":  [(40, 10, 50), (255, 160, 60)],       # purple → orange
}


def apply_film_filter(
    image: Image.Image,
    depth: np.ndarray,
    blur_strength: float = 0,
    flash_intensity: float = 0,
    vignette_strength: float = 0,
    light_leak_opacity: float = 0,
    light_leak_style: str = "amber-corner",
    grain_amount: float = 0,
    grain_opacity: float = 1.0,
    halation_radius: float = 0,
    contrast: float = 0,
    saturation: float = 0,
    fade: float = 0,
    tint_color: str = "",
    tint_strength: float = 0,
    gradient_map: str = "none",
) -> Image.Image:
    """Apply depth-driven film filter stack to a single image."""
    import cv2

    img = np.array(image, dtype=np.float32) / 255.0
    h, w = img.shape[:2]
    d = depth.copy()
    if d.shape[:2] != (h, w):
        d = np.array(Image.fromarray((d * 255).astype(np.uint8)).resize((w, h), Image.BILINEAR), dtype=np.float32) / 255.0

    # 1. Depth-of-field blur (background blur)
    if blur_strength > 0:
        ksize = int(blur_strength * 2) | 1  # odd kernel
        blurred = cv2.GaussianBlur(img, (ksize, ksize), 0)
        # Blend: near=sharp, far=blurred
        mask = d[:, :, np.newaxis]  # 0=near(sharp), 1=far(blurred)
        img = img * (1 - mask) + blurred * mask

    # 2. Flash simulation — additive light, steep depth falloff
    #    Real flash adds light (washes out near objects), doesn't just multiply
    if flash_intensity > 0:
        falloff = np.power(1.0 - d, 3.0)  # cubic: near=1.0, mid≈0.12, far=0
        flash_light = flash_intensity * falloff
        # Radial hotspot (on-camera flash center bias)
        cy, cx = h / 2, w / 2
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        radial = 1.0 - np.sqrt(((xx - cx) / w) ** 2 + ((yy - cy) / h) ** 2) * 1.2
        radial = np.clip(radial, 0, 1) ** 2
        flash_light += flash_intensity * 0.3 * falloff * radial
        # Additive: white light added on top — washes out foreground
        img = img + flash_light[:, :, np.newaxis]

    # 3. Contrast adjustment
    if contrast != 0:
        mid = img.mean()
        img = mid + (img - mid) * (1.0 + contrast)

    # 4. Saturation adjustment
    if saturation != 0:
        gray = np.mean(img, axis=2, keepdims=True)
        img = gray + (img - gray) * (1.0 + saturation)

    # 5. Gradient map
    gmap = GRADIENT_MAPS.get(gradient_map)
    if gmap is not None:
        shadow = np.array(gmap[0], dtype=np.float32) / 255.0
        highlight = np.array(gmap[1], dtype=np.float32) / 255.0
        lum = np.mean(img, axis=2)
        mapped = shadow[np.newaxis, np.newaxis, :] * (1 - lum[:, :, np.newaxis]) + \
                 highlight[np.newaxis, np.newaxis, :] * lum[:, :, np.newaxis]
        # Blend mapped at 30% with original (subtle)
        img = img * 0.7 + mapped * 0.3

    # 6. Color tint
    if tint_color and tint_strength > 0:
        try:
            tc = tint_color.lstrip("#")
            tr, tg, tb = int(tc[0:2], 16) / 255.0, int(tc[2:4], 16) / 255.0, int(tc[4:6], 16) / 255.0
            tint = np.array([tr, tg, tb], dtype=np.float32)
            img = img * (1 - tint_strength) + img * tint * tint_strength
        except (ValueError, IndexError):
            pass

    # 7. Vignette (depth-aware)
    if vignette_strength > 0:
        cy, cx = h / 2, w / 2
        Y, X = np.mgrid[0:h, 0:w].astype(np.float32)
        dist = np.sqrt((X - cx) ** 2 + (Y - cy) ** 2)
        max_dist = np.sqrt(cx ** 2 + cy ** 2)
        radial = (dist / max_dist) ** 1.5
        # Depth-aware: far objects in corners darkened more
        vig = 1.0 - vignette_strength * radial * (0.5 + 0.5 * d)
        img = img * vig[:, :, np.newaxis]

    # 8. Light leak (multiple styles)
    if light_leak_opacity > 0:
        Y, X = np.mgrid[0:h, 0:w].astype(np.float32)
        style = light_leak_style or "amber-corner"

        if style == "amber-corner":
            # Warm leak from top-right
            leak = np.exp(-((X - w) ** 2 / (w * 0.8) ** 2 + Y ** 2 / (h * 0.8) ** 2))
            leak_color = np.array([1.0, 0.7, 0.3])
        elif style == "red-streak":
            # Horizontal red streak across top
            leak = np.exp(-(Y ** 2 / (h * 0.3) ** 2)) * np.exp(-((X - w * 0.7) ** 2 / (w * 0.5) ** 2))
            leak_color = np.array([1.0, 0.2, 0.1])
        elif style == "rainbow-band":
            # Diagonal rainbow band
            diag = (X / w + Y / h) / 2.0
            leak = np.exp(-((diag - 0.3) ** 2) / 0.02)
            # Shift hue across the band
            hue = (X / w * 6.0) % 6.0
            r = np.clip(np.abs(hue - 3) - 1, 0, 1)
            g = np.clip(2 - np.abs(hue - 2), 0, 1)
            b = np.clip(2 - np.abs(hue - 4), 0, 1)
            leak_rgb = np.stack([r, g, b], axis=2).astype(np.float32)
            leak = leak[:, :, np.newaxis] * leak_rgb * d[:, :, np.newaxis] * light_leak_opacity
            img = img + leak
            leak_color = None  # already applied
        elif style == "cyan-wash":
            # Soft cyan from bottom-left
            leak = np.exp(-((X ** 2) / (w * 0.9) ** 2 + (Y - h) ** 2 / (h * 0.7) ** 2))
            leak_color = np.array([0.3, 0.8, 1.0])
        elif style == "golden-hour":
            # Warm horizontal gradient, stronger on edges
            leak = np.exp(-((Y - h * 0.3) ** 2 / (h * 0.4) ** 2))
            edge = (np.abs(X - w / 2) / (w / 2)) ** 0.5
            leak = leak * (0.3 + 0.7 * edge)
            leak_color = np.array([1.0, 0.85, 0.4])
        elif style == "purple-haze":
            # Radial purple from center-bottom
            dist = np.sqrt((X - w * 0.5) ** 2 + (Y - h * 1.2) ** 2)
            leak = np.exp(-(dist ** 2) / (max(w, h) * 0.6) ** 2)
            leak_color = np.array([0.7, 0.3, 1.0])
        else:
            leak = np.exp(-((X - w) ** 2 / (w * 0.8) ** 2 + Y ** 2 / (h * 0.8) ** 2))
            leak_color = np.array([1.0, 0.7, 0.3])

        if leak_color is not None:
            leak = leak * d * light_leak_opacity
            img = img + leak[:, :, np.newaxis] * leak_color.astype(np.float32)

    # 9. Halation (glow around bright near objects)
    if halation_radius > 0:
        lum = np.mean(img, axis=2)
        bright_near = ((lum > 0.8) & (d < 0.4)).astype(np.float32)
        ksize = int(halation_radius * 2) | 1
        glow = cv2.GaussianBlur(bright_near, (ksize, ksize), 0)
        glow_color = np.array([1.0, 0.85, 0.7], dtype=np.float32)
        img = img + glow[:, :, np.newaxis] * glow_color * 0.4

    # 10. Film grain (amount = size/intensity, opacity = blend strength)
    if grain_amount > 0:
        lum = np.mean(img, axis=2)
        grain_scale = grain_amount * (0.3 + 2.0 * (lum - 0.5) ** 2)
        noise = np.random.randn(h, w).astype(np.float32)
        grain = (noise * grain_scale)[:, :, np.newaxis]
        img = img + grain * max(0, min(1, grain_opacity))

    # 11. Fade to black (lift blacks)
    if fade > 0:
        img = img * (1 - fade) + fade * 0.15  # lift blacks to dark gray

    return Image.fromarray(np.clip(img * 255, 0, 255).astype(np.uint8), "RGB")


def render_elevation(
    image: Image.Image,
    depth: np.ndarray,
    elevation: float = 0.3,
    rotate_x: float = -35,
    rotate_y: float = 15,
    zoom: float = 1.2,
    show_grid: bool = True,
    show_image: bool = False,
    grid_glow: float = 0.8,
    grid_color: str = "#00ff88",
    bg_color: str = "#0a0a14",
    grid_density: int = 40,
    line_width: int = 1,
    scan_lines: bool = False,
    scan_line_opacity: float = 0.3,
    smoothing: int = 0,
) -> Image.Image:
    """Render depth map as cyberpunk wireframe terrain."""
    import cv2

    depth = _ensure_same_size(image, depth)

    # Smooth depth to reduce noise in wireframe
    if smoothing > 0:
        ksize = smoothing * 2 + 1  # ensure odd kernel
        depth = cv2.GaussianBlur(depth, (ksize, ksize), 0)

    h, w = depth.shape
    out_h, out_w = 800, 1200  # output resolution

    # Parse colors
    def hex_to_rgb(c):
        c = c.lstrip("#")
        return tuple(int(c[i:i+2], 16) for i in (0, 2, 4))

    gc = hex_to_rgb(grid_color)
    bg = hex_to_rgb(bg_color)

    # Create output image
    canvas = np.full((out_h, out_w, 3), bg, dtype=np.uint8)

    # Downsample depth for grid
    step_x = max(1, w // grid_density)
    step_y = max(1, h // grid_density)
    grid_h = h // step_y
    grid_w = w // step_x

    # Build 3D points from depth
    # Rotation matrices
    rx = np.radians(rotate_x)
    ry = np.radians(rotate_y)
    cos_x, sin_x = np.cos(rx), np.sin(rx)
    cos_y, sin_y = np.cos(ry), np.sin(ry)

    def project(x3, y3, z3):
        # Rotate around Y
        x = x3 * cos_y - z3 * sin_y
        z = x3 * sin_y + z3 * cos_y
        # Rotate around X
        y = y3 * cos_x - z * sin_x
        z = y3 * sin_x + z * cos_x
        # Orthographic projection with zoom
        px = int(out_w / 2 + x * zoom * out_w * 0.4)
        py = int(out_h / 2 + y * zoom * out_h * 0.4)
        return px, py, z

    # Generate grid points
    points = np.zeros((grid_h, grid_w, 3), dtype=np.float64)
    for gy in range(grid_h):
        for gx in range(grid_w):
            sy, sx = gy * step_y, gx * step_x
            d = depth[min(sy, h-1), min(sx, w-1)]
            x3 = (gx / grid_w - 0.5) * 2
            y3 = -d * elevation
            z3 = (gy / grid_h - 0.5) * 2
            points[gy, gx] = project(x3, y3, z3)

    # Source image for texture
    src = np.array(image.convert("RGB"))

    # Draw grid lines
    if show_grid:
        lw = max(1, line_width)
        # Glow pass (thicker, dimmer)
        if grid_glow > 0:
            glow_color = tuple(int(c * grid_glow * 0.3) for c in gc)
            for gy in range(grid_h):
                for gx in range(grid_w):
                    px, py, _ = int(points[gy,gx,0]), int(points[gy,gx,1]), points[gy,gx,2]
                    if gx < grid_w - 1:
                        nx, ny = int(points[gy,gx+1,0]), int(points[gy,gx+1,1])
                        cv2.line(canvas, (px,py), (nx,ny), glow_color, lw + 3, cv2.LINE_AA)
                    if gy < grid_h - 1:
                        nx, ny = int(points[gy+1,gx,0]), int(points[gy+1,gx,1])
                        cv2.line(canvas, (px,py), (nx,ny), glow_color, lw + 3, cv2.LINE_AA)
        # Main lines
        for gy in range(grid_h):
            for gx in range(grid_w):
                px, py = int(points[gy,gx,0]), int(points[gy,gx,1])
                # Color by depth
                sy, sx = gy * step_y, gx * step_x
                d = depth[min(sy, h-1), min(sx, w-1)]
                if show_image:
                    r, g, b = src[min(sy, h-1), min(sx, w-1)]
                    color = (int(r), int(g), int(b))
                else:
                    # Blend grid color with height
                    bright = 0.3 + 0.7 * d
                    color = tuple(int(c * bright) for c in gc)
                if gx < grid_w - 1:
                    nx, ny = int(points[gy,gx+1,0]), int(points[gy,gx+1,1])
                    cv2.line(canvas, (px,py), (nx,ny), color, lw, cv2.LINE_AA)
                if gy < grid_h - 1:
                    nx, ny = int(points[gy+1,gx,0]), int(points[gy+1,gx,1])
                    cv2.line(canvas, (px,py), (nx,ny), color, lw, cv2.LINE_AA)

    # Scan lines overlay
    if scan_lines:
        for y in range(0, out_h, 3):
            cv2.line(canvas, (0, y), (out_w, y), (0, 0, 0), 1)
        canvas = (canvas * (1 - scan_line_opacity * 0.3)).astype(np.uint8)

    return Image.fromarray(canvas, "RGB")


def create_wigglegram(
    image: Image.Image,
    depth: np.ndarray,
    num_views: int = 5,
    separation: float = 15.0,
    path: str = "linear",
    blur_depth: float = 5.0,
    film_filter: dict = None,
    pivot_x: float = 0.5,
    pivot_y: float = 0.5,
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
    # Sample depth at pivot point — objects at this depth stay still
    px = max(0, min(w - 1, int(pivot_x * w)))
    py = max(0, min(h - 1, int(pivot_y * h)))
    pivot_depth = depth[py, px]
    disp = (1.0 - depth) - (1.0 - pivot_depth)  # relative to pivot

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
        view_img = Image.fromarray(result.clip(0, 255).astype(np.uint8), "RGB")
        if film_filter and any(v for v in film_filter.values() if v and v != "none" and v != ""):
            view_img = apply_film_filter(view_img, depth, **film_filter)
        views.append(view_img)

    return views


def create_comb_frame(
    image: Image.Image,
    depth: np.ndarray,
    frame_idx: int,
    interval: int = 3,
    separation: float = 15.0,
    blur_depth: float = 5.0,
    pivot_x: float = 0.5,
    pivot_y: float = 0.5,
) -> Image.Image:
    """
    Comb method for video wigglegrams.

    For each video frame, generates a left or right eye view based on
    the frame index and interval. The pattern alternates every `interval`
    frames: L L L R R R L L L R R R ...

    This creates a flickering 3D effect when played back at normal speed,
    similar to the technique described by stereoscopic filmmakers using
    beam splitters.

    frame_idx   — which frame number (determines L or R)
    interval    — how many consecutive frames per eye (default 3)
    separation  — max horizontal shift in pixels
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

    px = max(0, min(w - 1, int(pivot_x * w)))
    py = max(0, min(h - 1, int(pivot_y * h)))
    pivot_depth = depth[py, px]
    disp = (1.0 - depth) - (1.0 - pivot_depth)

    # Determine eye: cycle through interval frames per eye
    cycle = (frame_idx // interval) % 2
    t = -1.0 if cycle == 0 else 1.0  # left or right
    shift_x = t * separation

    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    dx = disp * shift_x
    map_x = np.clip(xs - dx, 0, w - 1).astype(np.float32)
    map_y = ys

    result = cv2.remap(
        src, map_x, map_y,
        interpolation=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REFLECT,
    )
    return Image.fromarray(result.clip(0, 255).astype(np.uint8), "RGB")


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


# ── Hologram effect ──────────────────────────────────────────────────────────

def depth_hologram(
    image: Image.Image,
    depth: np.ndarray,
    color: str = "#00ff88",
    color2: str = "#004422",
    style: str = "gits",
    edge_strength: float = 0.8,
    scan_lines: bool = True,
    scan_density: int = 3,
    scan_opacity: float = 0.4,
    dither: bool = True,
    dither_size: int = 2,
    grid_overlay: bool = True,
    grid_density: int = 30,
    chromatic: float = 0.3,
    noise: float = 0.15,
    bloom: float = 1.5,
    transparency: float = 0.6,
    bg_color: str = "#000000",
) -> Image.Image:
    """80s/90s anime hologram effect — Ghost in the Shell / Akira / Evangelion style."""
    import cv2

    depth = _ensure_same_size(image, depth)
    h, w = depth.shape
    src = np.array(image.convert("RGB"), dtype=np.float32) / 255.0

    # Style presets
    styles = {
        "gits":   {"color": "#00ff88", "color2": "#003322", "bg": "#000505"},
        "akira":  {"color": "#ff6600", "color2": "#441100", "bg": "#050000"},
        "eva":    {"color": "#9933ff", "color2": "#220066", "bg": "#050008"},
        "blade":  {"color": "#00ccff", "color2": "#003366", "bg": "#000510"},
        "nerv":   {"color": "#ff0066", "color2": "#330015", "bg": "#050005"},
        "tron":   {"color": "#00dfff", "color2": "#004466", "bg": "#000008"},
    }
    if style in styles and style != "custom":
        s = styles[style]
        color, color2, bg_color = s["color"], s["color2"], s["bg"]

    def hex_rgb(c):
        c = c.lstrip("#")
        return np.array([int(c[i:i+2], 16) for i in (0, 2, 4)], dtype=np.float32) / 255.0

    c1 = hex_rgb(color)
    c2 = hex_rgb(color2)
    bg = hex_rgb(bg_color)

    # Convert to luminance
    luma = src[:, :, 0] * 0.299 + src[:, :, 1] * 0.587 + src[:, :, 2] * 0.114

    # Edge detection from depth (Sobel)
    depth_u8 = (depth * 255).astype(np.uint8)
    edges_x = cv2.Sobel(depth_u8, cv2.CV_64F, 1, 0, ksize=3)
    edges_y = cv2.Sobel(depth_u8, cv2.CV_64F, 0, 1, ksize=3)
    edges = np.sqrt(edges_x**2 + edges_y**2)
    edges = np.clip(edges / edges.max() if edges.max() > 0 else edges, 0, 1).astype(np.float32)

    # Also get image edges for detail
    luma_u8 = (luma * 255).astype(np.uint8)
    img_edges_x = cv2.Sobel(luma_u8, cv2.CV_64F, 1, 0, ksize=3)
    img_edges_y = cv2.Sobel(luma_u8, cv2.CV_64F, 0, 1, ksize=3)
    img_edges = np.sqrt(img_edges_x**2 + img_edges_y**2)
    img_edges = np.clip(img_edges / (img_edges.max() + 1e-6), 0, 1).astype(np.float32)

    # Combine edges
    combined_edges = np.clip(edges * edge_strength + img_edges * 0.5, 0, 1)

    # Color mapping: luminance → hologram color gradient
    # Near depth = bright c1, far = dimmer c2
    depth_color = depth[:, :, None] * c1[None, None, :] + (1 - depth[:, :, None]) * c2[None, None, :]

    # Modulate by luminance
    holo = depth_color * (0.3 + 0.7 * luma[:, :, None])

    # Add bright edges
    edge_glow = combined_edges[:, :, None] * c1[None, None, :] * 1.5
    holo = holo + edge_glow

    # Dither layer (ordered dithering pattern)
    if dither:
        # Bayer matrix 4x4
        bayer = np.array([
            [ 0,  8,  2, 10],
            [12,  4, 14,  6],
            [ 3, 11,  1,  9],
            [15,  7, 13,  5]
        ], dtype=np.float32) / 16.0

        ds = max(1, dither_size)
        # Tile bayer pattern across image
        bayer_tiled = np.tile(bayer, (h // 4 + 1, w // 4 + 1))[:h, :w]
        if ds > 1:
            bayer_tiled = cv2.resize(
                np.tile(bayer, ((h // (4*ds)) + 2, (w // (4*ds)) + 2))[:h//ds+1, :w//ds+1],
                (w, h), interpolation=cv2.INTER_NEAREST
            )

        # Apply dither: threshold luminance against bayer
        dither_mask = (luma > bayer_tiled).astype(np.float32)
        # Blend dithered version
        holo_dithered = holo * dither_mask[:, :, None]
        holo = holo * 0.4 + holo_dithered * 0.6

    # Grid overlay (elevation contour lines)
    if grid_overlay:
        grid = np.zeros((h, w), dtype=np.float32)
        step = max(2, w // grid_density)
        # Vertical lines
        for x in range(0, w, step):
            grid[:, x] = 0.3
        # Horizontal lines
        for y in range(0, h, step):
            grid[y, :] = 0.3
        # Depth contour lines (iso-depth)
        num_contours = 12
        for i in range(num_contours):
            level = i / num_contours
            contour_mask = np.abs(depth - level) < 0.015
            grid[contour_mask] = 0.6
        holo = holo + grid[:, :, None] * c1[None, None, :] * 0.4

    # Scan lines
    if scan_lines:
        scan = np.ones((h, w), dtype=np.float32)
        for y in range(0, h, max(2, scan_density)):
            scan[y, :] = 1.0 - scan_opacity
        holo = holo * scan[:, :, None]

    # Chromatic aberration (RGB channel offset based on depth)
    if chromatic > 0:
        shift = int(chromatic * 8)
        if shift > 0:
            # Shift red channel right, blue channel left
            r_ch = holo[:, :, 0].copy()
            b_ch = holo[:, :, 2].copy()
            r_shifted = np.zeros_like(r_ch)
            b_shifted = np.zeros_like(b_ch)
            r_shifted[:, shift:] = r_ch[:, :-shift]
            b_shifted[:, :-shift] = b_ch[:, shift:]
            # Blend by depth
            holo[:, :, 0] = r_ch * (1 - depth * 0.5) + r_shifted * depth * 0.5
            holo[:, :, 2] = b_ch * (1 - depth * 0.5) + b_shifted * depth * 0.5

    # Noise / grain
    if noise > 0:
        rng = np.random.RandomState(42)
        grain = rng.randn(h, w).astype(np.float32) * noise * 0.1
        holo = holo + grain[:, :, None] * c1[None, None, :]

    # Depth-based transparency (far areas more transparent)
    if transparency > 0:
        alpha = np.clip(depth * (1.0 / max(0.1, 1.0 - transparency)) , 0, 1)
        holo = holo * alpha[:, :, None] + bg[None, None, :] * (1 - alpha[:, :, None])

    # Bloom / glow
    if bloom > 0:
        holo_u8 = np.clip(holo * 255, 0, 255).astype(np.uint8)
        ksize = int(bloom * 15) | 1  # ensure odd
        blurred = cv2.GaussianBlur(holo_u8, (ksize, ksize), 0).astype(np.float32) / 255.0
        holo = holo + blurred * bloom * 0.3

    # Clamp and convert
    result = np.clip(holo * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(result, "RGB")


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
    elif effect == "hologram":
        return depth_hologram(image, depth, **params)
    else:
        raise ValueError(f"Unknown effect: {effect!r}. Choose: slice, grade, dof, fog, parallax, posterize, hologram")
