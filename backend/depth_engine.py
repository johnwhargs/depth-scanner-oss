"""
Depth estimation engine using Depth Anything V2.
Supports Small / Base / Large model variants with optional
temporal smoothing for flicker-free video processing.
"""

import gc
import numpy as np
from PIL import Image
from typing import Optional, List
import torch

MODEL_MAP = {
    "small":  "depth-anything/Depth-Anything-V2-Small-hf",
    "base":   "depth-anything/Depth-Anything-V2-Base-hf",
    "large":  "depth-anything/Depth-Anything-V2-Large-hf",
}

# ---------------------------------------------------------------------------
# Colour maps (20+) — pure numpy, no matplotlib required at runtime
# ---------------------------------------------------------------------------
import colorsys

def _build_colormaps() -> dict:
    """Return a dict of name -> (256,3) uint8 LUT arrays."""
    maps = {}

    def linear(start, end, name):
        lut = np.zeros((256, 3), dtype=np.uint8)
        for i in range(256):
            t = i / 255.0
            lut[i] = [int(s + t * (e - s)) for s, e in zip(start, end)]
        maps[name] = lut

    def hsv_range(h0, h1, name):
        lut = np.zeros((256, 3), dtype=np.uint8)
        for i in range(256):
            t = i / 255.0
            h = h0 + t * (h1 - h0)
            r, g, b = colorsys.hsv_to_rgb(h % 1.0, 1.0, 1.0)
            lut[i] = [int(r * 255), int(g * 255), int(b * 255)]
        maps[name] = lut

    # Greyscale variants
    linear((0, 0, 0), (255, 255, 255), "grayscale")
    linear((255, 255, 255), (0, 0, 0), "grayscale_inv")

    # Inferno-like (black → purple → orange → yellow)
    def inferno():
        lut = np.zeros((256, 3), dtype=np.uint8)
        stops = [(0, (0,0,4)), (64, (40,11,84)), (128, (136,33,75)),
                 (192, (229,92,48)), (255, (252,255,164))]
        for i in range(256):
            for j in range(len(stops)-1):
                a_i, a_c = stops[j]; b_i, b_c = stops[j+1]
                if a_i <= i <= b_i:
                    t = (i - a_i) / (b_i - a_i + 1e-9)
                    lut[i] = [int(a_c[k] + t*(b_c[k]-a_c[k])) for k in range(3)]
                    break
        maps["inferno"] = lut
    inferno()

    # Viridis-like
    def viridis():
        lut = np.zeros((256, 3), dtype=np.uint8)
        stops = [(0,(68,1,84)),(64,(58,82,139)),(128,(32,144,140)),
                 (192,(94,201,97)),(255,(253,231,36))]
        for i in range(256):
            for j in range(len(stops)-1):
                a_i,a_c=stops[j]; b_i,b_c=stops[j+1]
                if a_i<=i<=b_i:
                    t=(i-a_i)/(b_i-a_i+1e-9)
                    lut[i]=[int(a_c[k]+t*(b_c[k]-a_c[k])) for k in range(3)]
                    break
        maps["viridis"] = lut
    viridis()

    hsv_range(0.0,  1.0,  "rainbow")
    hsv_range(0.55, 0.0,  "turbo")
    hsv_range(0.66, 0.33, "cool")
    hsv_range(0.0,  0.33, "warm")
    linear((0,0,128),(255,128,0),  "depth_blue_orange")
    linear((0,64,0), (255,255,0),  "terrain_green")
    linear((20,0,50),(255,200,50), "plasma_purple")
    linear((0,32,64),(255,64,32),  "ocean")
    linear((64,0,0),(255,220,180), "copper")
    linear((10,10,40),(40,200,255),"arctic")
    linear((0,0,0),(255,0,64),     "red_glow")
    linear((0,0,0),(0,255,128),    "green_glow")
    linear((0,0,0),(0,128,255),    "blue_glow")
    linear((32,0,64),(255,255,200),"twilight")
    linear((0,10,20),(180,255,220),"seafoam")
    linear((20,0,0),(255,180,60),  "ember")

    return maps

COLORMAPS = _build_colormaps()


class DepthEngine:
    """Wraps Depth Anything V2 with model hot-swapping and temporal smoothing."""

    def __init__(self):
        self._model_size: Optional[str] = None
        self._pipe = None
        self._device: str = self._detect_device()
        self._status: str = "idle"

    # ------------------------------------------------------------------
    @staticmethod
    def _detect_device() -> str:
        if torch.cuda.is_available():
            return "cuda"
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
        return "cpu"

    # ------------------------------------------------------------------
    def load_model(self, model_size: str = "small"):
        if self._model_size == model_size and self._pipe is not None:
            return  # already loaded
        self.unload()
        from transformers import pipeline as hf_pipeline
        self._status = f"Loading {model_size} model on {self._device}…"
        print(f"[DepthEngine] {self._status}")
        self._pipe = hf_pipeline(
            task="depth-estimation",
            model=MODEL_MAP[model_size],
            device=0 if self._device == "cuda" else -1,
        )
        self._model_size = model_size
        self._status = "ready"
        print("[DepthEngine] Model ready.")

    def unload(self):
        self._pipe = None
        self._model_size = None
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

    # ------------------------------------------------------------------
    def _infer(self, image: Image.Image) -> np.ndarray:
        """Run inference; return float32 array normalised 0→1 (near=1, far=0)."""
        result = self._pipe(image)
        raw = np.array(result["depth"], dtype=np.float32)
        lo, hi = raw.min(), raw.max()
        if hi - lo < 1e-8:
            return np.zeros_like(raw)
        return (raw - lo) / (hi - lo)

    def _infer_batch(self, images: List[Image.Image], batch_size: int = 4) -> List[np.ndarray]:
        """Run batched inference for better GPU utilisation."""
        results = []
        for i in range(0, len(images), batch_size):
            batch = images[i:i + batch_size]
            outputs = self._pipe(batch, batch_size=len(batch))
            for out in outputs:
                raw = np.array(out["depth"], dtype=np.float32)
                lo, hi = raw.min(), raw.max()
                if hi - lo < 1e-8:
                    results.append(np.zeros_like(raw))
                else:
                    results.append((raw - lo) / (hi - lo))
        return results

    def process_frame(self, image: Image.Image) -> np.ndarray:
        """Process a single PIL image. Returns float32 depth [0,1]."""
        if self._pipe is None:
            raise RuntimeError("Model not loaded — call load_model() first.")
        return self._infer(image)

    def process_video_frames(
        self,
        frames: List[Image.Image],
        temporal_smooth: float = 0.5,
        align_scale: bool = True,
        batch_size: int = 4,
        on_progress=None,
    ) -> List[np.ndarray]:
        """
        Process a list of frames with scale-invariant temporal alignment.

        The core problem with naive smoothing is that depth models output
        arbitrary scale and shift each frame — so blending raw outputs causes
        violent flickering even on static scenes.

        Fix: before blending, find the affine transform (scale s, bias b) that
        maps the new raw depth onto the previous frame's coordinate space using
        a fast least-squares solve.  Then apply EMA in that aligned space.

        align_scale=True  → scale-invariant (recommended for most footage)
        align_scale=False → raw EMA (legacy, can flicker on scale changes)
        """
        if self._pipe is None:
            raise RuntimeError("Model not loaded — call load_model() first.")

        # Batch inference for all frames first (GPU-optimal)
        raw_depths = self._infer_batch(frames, batch_size=batch_size)

        # Sequential temporal alignment (must be in order)
        results: List[np.ndarray] = []
        prev: Optional[np.ndarray] = None

        for i, raw in enumerate(raw_depths):
            if prev is not None and temporal_smooth > 0:
                if align_scale:
                    aligned = _align_depth(prev, raw)
                else:
                    aligned = raw
                depth = prev * temporal_smooth + aligned * (1.0 - temporal_smooth)
                # Re-normalize to prevent drift over long sequences
                lo, hi = depth.min(), depth.max()
                if hi - lo > 0.01:
                    depth = (depth - lo) / (hi - lo)
                depth = np.clip(depth, 0.0, 1.0)
            else:
                depth = raw

            results.append(depth)
            prev = depth

            if on_progress:
                on_progress(i + 1, len(raw_depths))

        return results


def _align_depth(ref: np.ndarray, target: np.ndarray) -> np.ndarray:
    """
    Find scale s and bias b that minimise ||ref - (s·target + b)||²
    then return the aligned target.  Solves a 2-parameter least squares
    problem — fast even at 4K because we subsample to ≤64k pixels.
    """
    # Subsample for speed
    max_px = 65536
    flat_ref = ref.ravel()
    flat_tgt = target.ravel()
    if flat_ref.size > max_px:
        idx = np.random.choice(flat_ref.size, max_px, replace=False)
        flat_ref = flat_ref[idx]
        flat_tgt = flat_tgt[idx]

    A = np.stack([flat_tgt, np.ones(flat_tgt.size)], axis=1)
    result = np.linalg.lstsq(A, flat_ref, rcond=None)
    s, b = result[0]

    # Guard against degenerate solutions
    if not np.isfinite(s) or not np.isfinite(b) or s <= 0:
        return target

    return np.clip(s * target + b, 0.0, 1.0)


# Module-level singleton
engine = DepthEngine()
