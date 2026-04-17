"""
Export depth arrays to PNG (8-bit grayscale), 32-bit EXR, and colourised PNGs.
EXR requires: pip install openexr-python  OR  imageio[freeimage]
Falls back gracefully if OpenEXR is unavailable.
"""

import io
import struct
import zlib
import numpy as np
from PIL import Image
from typing import Optional
from depth_engine import COLORMAPS

# ── EXR availability check ──────────────────────────────────────────────────
try:
    import OpenEXR
    import Imath
    _HAS_OPENEXR = True
except ImportError:
    _HAS_OPENEXR = False
    try:
        import imageio
        _HAS_IMAGEIO_EXR = True
    except ImportError:
        _HAS_IMAGEIO_EXR = False


# ── Helpers ──────────────────────────────────────────────────────────────────

def depth_to_uint8(depth: np.ndarray) -> np.ndarray:
    """Float32 [0,1] → uint8 [0,255]"""
    return (np.clip(depth, 0, 1) * 255).astype(np.uint8)


def apply_colormap(depth: np.ndarray, colormap: str = "inferno") -> np.ndarray:
    """Float32 [0,1] depth → (H,W,3) uint8 via LUT."""
    lut = COLORMAPS.get(colormap, COLORMAPS["inferno"])
    idx = depth_to_uint8(depth)
    return lut[idx]  # fancy indexing → (H,W,3)


# ── PNG (8-bit grayscale) ────────────────────────────────────────────────────

def export_png_grayscale(depth: np.ndarray) -> bytes:
    """Return PNG bytes of 8-bit grayscale depth map."""
    img = Image.fromarray(depth_to_uint8(depth), mode="L")
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=False, compress_level=1)
    return buf.getvalue()


def export_png_colorized(depth: np.ndarray, colormap: str = "inferno") -> bytes:
    """Return PNG bytes of colourised depth map."""
    rgb = apply_colormap(depth, colormap)
    img = Image.fromarray(rgb, mode="RGB")
    buf = io.BytesIO()
    img.save(buf, format="PNG", compress_level=1)
    return buf.getvalue()


# ── 32-bit EXR ───────────────────────────────────────────────────────────────

def _write_minimal_exr(depth: np.ndarray) -> bytes:
    """
    Write a minimal single-channel 32-bit float EXR without external libs.
    Implements the bare EXR spec (scanline, FLOAT, uncompressed).
    Compatible with After Effects / DaVinci Resolve.
    """
    h, w = depth.shape
    depth_f32 = depth.astype(np.float32)

    def pack_str(s: str) -> bytes:
        return s.encode("ascii") + b"\x00"

    def pack_attr(name: str, typ: str, data: bytes) -> bytes:
        return pack_str(name) + pack_str(typ) + struct.pack("<I", len(data)) + data

    def pack_chlist(channels) -> bytes:
        out = b""
        for name, ptype, sampling in channels:
            out += pack_str(name)
            out += struct.pack("<I", ptype)   # FLOAT=2
            out += struct.pack("<B", 0)        # linear=0
            out += b"\x00\x00\x00"            # reserved
            out += struct.pack("<II", sampling, sampling)
        out += b"\x00"
        return out

    # Header attributes
    attrs  = pack_attr("channels",      "chlist",  pack_chlist([("Y", 2, 1)]))
    attrs += pack_attr("compression",   "compression", struct.pack("<B", 0))  # NO_COMPRESSION
    attrs += pack_attr("dataWindow",    "box2i",   struct.pack("<iiii", 0,0,w-1,h-1))
    attrs += pack_attr("displayWindow", "box2i",   struct.pack("<iiii", 0,0,w-1,h-1))
    attrs += pack_attr("lineOrder",     "lineOrder", struct.pack("<B", 0))    # INCREASING_Y
    attrs += pack_attr("pixelAspectRatio","float",  struct.pack("<f", 1.0))
    attrs += pack_attr("screenWindowCenter","v2f",  struct.pack("<ff", 0.0, 0.0))
    attrs += pack_attr("screenWindowWidth", "float",struct.pack("<f", 1.0))
    attrs += b"\x00"  # end of header

    magic   = struct.pack("<I", 20000630)   # EXR magic
    version = struct.pack("<I", 2)           # version=2, single-part scanline
    header_bytes = magic + version + attrs

    # Scanline offset table
    bytes_per_scanline = 2*4 + w*4  # y(4) + pixelDataSize(4) + w floats
    offsets_start = len(header_bytes) + h * 8
    offsets = b""
    for y in range(h):
        offsets += struct.pack("<Q", offsets_start + y * bytes_per_scanline)

    # Pixel data — one scanline at a time
    pixels = b""
    for y in range(h):
        row = depth_f32[y].tobytes()
        pixels += struct.pack("<i", y)
        pixels += struct.pack("<I", len(row))
        pixels += row

    return header_bytes + offsets + pixels


def export_exr(depth: np.ndarray) -> bytes:
    """Return EXR bytes (32-bit float, single channel Y). Works without OpenEXR."""
    if _HAS_OPENEXR:
        h, w = depth.shape
        hdr = OpenEXR.Header(w, h)
        hdr["channels"] = {"Y": Imath.Channel(Imath.PixelType(Imath.PixelType.FLOAT))}
        buf = io.BytesIO()
        exr = OpenEXR.OutputFile(buf, hdr)
        exr.writePixels({"Y": depth.astype(np.float32).tobytes()})
        exr.close()
        return buf.getvalue()
    else:
        return _write_minimal_exr(depth)


# ── Convenience wrapper ───────────────────────────────────────────────────────

def export(
    depth: np.ndarray,
    output_format: str = "png_gray",
    colormap: str = "inferno",
) -> bytes:
    """
    output_format: 'png_gray' | 'png_color' | 'exr'
    Returns raw bytes ready to write to disk or send over HTTP.
    """
    if output_format == "png_gray":
        return export_png_grayscale(depth)
    elif output_format == "png_color":
        return export_png_colorized(depth, colormap)
    elif output_format == "exr":
        return export_exr(depth)
    else:
        raise ValueError(f"Unknown output_format: {output_format!r}")
