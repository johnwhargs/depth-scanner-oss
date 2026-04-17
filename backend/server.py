"""
Depth Scanner OSS — FastAPI backend
uvicorn server:app --host 127.0.0.1 --port 7842
"""

import io
import json
import os
import tempfile
import zipfile
import uuid
from collections import OrderedDict
from typing import Optional

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, FileResponse
from PIL import Image

from depth_engine import engine, COLORMAPS, MODEL_MAP
from exporters import export, apply_colormap
from effects import apply_effect, create_wigglegram, create_spatial_pair, depth_transition, posterize_depth_array

app = FastAPI(title="Depth Scanner OSS", version="1.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"], expose_headers=["X-Session-Id", "X-Width", "X-Height", "X-Frame-Count", "X-FPS", "X-Frame", "X-Total"])

CONTENT_TYPES = {"png_gray": "image/png", "png_color": "image/png", "exr": "image/x-exr"}


# ── Session cache ──────────────────────────────────────────────────────────────
class SessionCache:
    def __init__(self, maxsize=20):
        self._store = OrderedDict()
        self._maxsize = maxsize

    def put(self, key, image, depth):
        self._store[key] = (image, depth)
        self._store.move_to_end(key)
        while len(self._store) > self._maxsize:
            self._store.popitem(last=False)

    def get(self, key):
        return self._store.get(key)

cache = SessionCache()


async def _infer_frame(file, model):
    raw = await file.read()
    try:
        img = Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception as e:
        raise HTTPException(400, f"Could not decode image: {e}")
    engine.load_model(model)
    depth = engine.process_frame(img)
    sid = str(uuid.uuid4())[:8]
    cache.put(sid, img, depth)
    return img, depth, sid


def _coerce_params(params):
    for k in ("invert_mask", "near_blur", "far_blur", "colorize"):
        if k in params and isinstance(params[k], str):
            params[k] = params[k].lower() in ("true", "1", "yes")
    for k in ("bg_alpha", "levels", "num_views"):
        if k in params and isinstance(params[k], str):
            params[k] = int(params[k])
    return params


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "device": engine._detect_device(),
            "model_loaded": engine._model_size, "engine_status": engine._status,
            "version": "1.1.0"}

@app.get("/models")
def list_models():
    return {"models": list(MODEL_MAP.keys())}

@app.get("/colormaps")
def list_colormaps():
    return {"colormaps": list(COLORMAPS.keys())}

@app.get("/effects")
def list_effects():
    return {"effects": ["slice", "grade", "dof", "fog", "parallax", "posterize"]}

@app.post("/load")
def load_model(model: str = Form("small")):
    if model not in MODEL_MAP:
        raise HTTPException(400, f"Unknown model '{model}'.")
    engine.load_model(model)
    return {"loaded": model}

@app.post("/process/frame")
async def process_frame(
    file: UploadFile = File(...),
    model: str = Form("small"),
    format: str = Form("png_gray"),
    colormap: str = Form("inferno"),
):
    if format not in CONTENT_TYPES:
        raise HTTPException(400, f"format must be one of {list(CONTENT_TYPES)}")
    img, depth, sid = await _infer_frame(file, model)
    return Response(
        content=export(depth, format, colormap),
        media_type=CONTENT_TYPES[format],
        headers={"X-Session-Id": sid, "X-Width": str(img.width), "X-Height": str(img.height)},
    )

@app.post("/process/batch")
async def process_batch(
    file: UploadFile = File(...),
    model: str = Form("small"),
    format: str = Form("png_gray"),
    colormap: str = Form("inferno"),
    smooth: float = Form(0.4),
    align_scale: bool = Form(True),
):
    raw = await file.read()
    try:
        zin = zipfile.ZipFile(io.BytesIO(raw))
    except Exception as e:
        raise HTTPException(400, f"Bad ZIP: {e}")

    names = sorted(n for n in zin.namelist() if not n.endswith("/"))
    if not names:
        raise HTTPException(400, "Empty ZIP.")

    frames = [Image.open(io.BytesIO(zin.read(n))).convert("RGB") for n in names]
    engine.load_model(model)
    depths = engine.process_video_frames(frames, temporal_smooth=smooth, align_scale=align_scale)

    ext = "exr" if format == "exr" else "png"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zout:
        for name, depth in zip(names, depths):
            zout.writestr(f"{name.rsplit('.',1)[0]}_depth.{ext}", export(depth, format, colormap))
    return Response(content=buf.getvalue(), media_type="application/zip",
                    headers={"X-Frame-Count": str(len(depths))})


# ── Video session (frame-by-frame with live preview) ──────────────────────────

class VideoSession:
    """Holds video reference and temporal state for frame-by-frame processing.
    Frames loaded lazily from disk — doesn't hold all in RAM."""
    def __init__(self, video_path, frame_indices, fps, width, height, tmp_file=None):
        self.video_path = video_path
        self.frame_indices = frame_indices  # list of original frame numbers to process
        self.fps = fps
        self.width = width
        self.height = height
        self.prev_depth = None
        self.processed = 0
        self.cached_depths = []
        self._tmp_file = tmp_file  # temp file to clean up on session delete
        self._frame_cache = {}  # small LRU for recently accessed frames
        self._cap = None  # persistent VideoCapture
        self._cap_pos = -1  # last read frame number

    def _ensure_cap(self):
        """Keep a persistent VideoCapture open."""
        if self._cap is None or not self._cap.isOpened():
            self._cap = cv2.VideoCapture(self.video_path)
            self._cap_pos = -1

    def get_frame(self, session_idx):
        """Load a single frame from video by session index.
        Sequential reads are reliable; random seek is not.
        For sequential access (idx = prev+1), just read next.
        For random access, seek to nearest keyframe then read forward."""
        if session_idx in self._frame_cache:
            return self._frame_cache[session_idx]

        self._ensure_cap()
        frame_num = self.frame_indices[session_idx]

        # If we need to go backward or jump far, re-seek
        if frame_num != self._cap_pos + 1:
            self._cap.set(cv2.CAP_PROP_POS_FRAMES, frame_num)

        ret, bgr = self._cap.read()
        if not ret:
            # Retry: reopen and seek
            self._cap.release()
            self._cap = cv2.VideoCapture(self.video_path)
            self._cap.set(cv2.CAP_PROP_POS_FRAMES, frame_num)
            ret, bgr = self._cap.read()
            if not ret:
                return None

        self._cap_pos = frame_num

        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        img = Image.fromarray(rgb)

        # Cache last 5 frames
        self._frame_cache[session_idx] = img
        if len(self._frame_cache) > 5:
            oldest = min(self._frame_cache.keys())
            del self._frame_cache[oldest]
        return img

    @property
    def num_frames(self):
        return len(self.frame_indices)

    def cleanup(self):
        if self._cap and self._cap.isOpened():
            self._cap.release()
        if self._tmp_file and os.path.exists(self._tmp_file):
            os.unlink(self._tmp_file)

video_sessions = {}

@app.post("/process/video/start")
async def video_start(
    file: Optional[UploadFile] = File(None),
    file_path: Optional[str] = Form(None),
    model: str = Form("small"),
    every: int = Form(1),
    start_frame: int = Form(0),
    end_frame: int = Form(-1),
):
    """Upload video or provide local path, extract frames within trim range."""
    tmp_name = None
    if file_path and os.path.exists(file_path):
        # Direct disk read — no upload needed for large files
        video_path = file_path
    elif file:
        raw = await file.read()
        suffix = os.path.splitext(file.filename or "video.mp4")[1] or ".mp4"
        tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
        tmp.write(raw)
        tmp.close()
        video_path = tmp.name
        tmp_name = tmp.name
    else:
        raise HTTPException(400, "Provide file or file_path.")

    try:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise HTTPException(400, "Could not open video.")

        fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        if end_frame < 0:
            end_frame = total_frames

        # Build index list of frames to process (don't load into RAM)
        frame_indices = []
        for idx in range(start_frame, min(end_frame, total_frames)):
            if (idx - start_frame) % every == 0:
                frame_indices.append(idx)
        cap.release()
    except Exception as e:
        if tmp_name:
            os.unlink(tmp_name)
        raise

    if not frame_indices:
        if tmp_name:
            os.unlink(tmp_name)
        raise HTTPException(400, "No frames in range.")

    engine.load_model(model)
    sid = str(uuid.uuid4())[:8]
    video_sessions[sid] = VideoSession(
        video_path, frame_indices, fps / every, w, h, tmp_file=tmp_name
    )

    # Limit to 5 active sessions (cleanup old ones)
    while len(video_sessions) > 5:
        oldest = next(iter(video_sessions))
        video_sessions[oldest].cleanup()
        del video_sessions[oldest]

    return {
        "session_id": sid,
        "frames": len(frame_indices),
        "fps": fps / every,
        "width": w,
        "height": h,
    }


@app.get("/process/video/source/{session_id}/{frame_idx}")
def video_source_frame(session_id: str, frame_idx: int):
    """Return the original source frame as PNG."""
    sess = video_sessions.get(session_id)
    if not sess:
        raise HTTPException(404, "Session not found.")
    if frame_idx < 0 or frame_idx >= sess.num_frames:
        raise HTTPException(400, f"Frame {frame_idx} out of range.")
    frame = sess.get_frame(frame_idx)
    if frame is None:
        raise HTTPException(500, f"Could not read frame {frame_idx}.")
    buf = io.BytesIO()
    frame.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


@app.get("/process/video/frame/{session_id}/{frame_idx}")
def video_frame(
    session_id: str,
    frame_idx: int,
    format: str = "png_gray",
    colormap: str = "inferno",
    smooth: float = 0.4,
    align_scale: bool = True,
):
    """Process a single video frame with temporal alignment. Returns depth image."""
    from depth_engine import _align_depth

    sess = video_sessions.get(session_id)
    if not sess:
        raise HTTPException(404, "Session not found.")
    if frame_idx < 0 or frame_idx >= sess.num_frames:
        raise HTTPException(400, f"Frame {frame_idx} out of range 0-{sess.num_frames-1}")

    frame = sess.get_frame(frame_idx)
    if frame is None:
        raise HTTPException(500, f"Could not read frame {frame_idx}.")
    raw = engine._infer(frame)

    if sess.prev_depth is not None and smooth > 0:
        if align_scale:
            aligned = _align_depth(sess.prev_depth, raw)
        else:
            aligned = raw
        depth = sess.prev_depth * smooth + aligned * (1.0 - smooth)
        depth = np.clip(depth, 0.0, 1.0)
    else:
        depth = raw

    sess.prev_depth = depth
    sess.processed = frame_idx + 1
    # Cache for render pass
    while len(sess.cached_depths) <= frame_idx:
        sess.cached_depths.append(None)
    sess.cached_depths[frame_idx] = depth

    out_bytes = export(depth, format, colormap)
    ct = "image/png" if format != "exr" else "image/x-exr"
    return Response(
        content=out_bytes,
        media_type=ct,
        headers={"X-Frame": str(frame_idx), "X-Total": str(sess.num_frames)},
    )


@app.post("/process/video/render/{session_id}")
def video_render(
    session_id: str,
    format: str = Form("png_gray"),
    colormap: str = Form("inferno"),
    smooth: float = Form(0.4),
    align_scale: bool = Form(True),
    output: str = Form("video"),
):
    """Render all remaining frames and return final video/sequence. Uses already-processed temporal state."""
    from depth_engine import _align_depth

    sess = video_sessions.get(session_id)
    if not sess:
        raise HTTPException(404, "Session not found.")

    # Use cached depths from frame-by-frame pass if available
    if len(sess.cached_depths) == sess.num_frames and all(d is not None for d in sess.cached_depths):
        depths = sess.cached_depths
    else:
        # Fallback: re-process frame by frame (lazy loaded)
        prev = None
        depths = []
        for i in range(sess.num_frames):
            frame = sess.get_frame(i)
            if frame is None:
                continue
            raw = engine._infer(frame)
            if prev is not None and smooth > 0:
                aligned = _align_depth(prev, raw) if align_scale else raw
                depth = prev * smooth + aligned * (1.0 - smooth)
                depth = np.clip(depth, 0.0, 1.0)
            else:
                depth = raw
            depths.append(depth)
            prev = depth

    w, h = sess.width, sess.height

    if output == "sequence":
        ext = "exr" if format == "exr" else "png"
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zout:
            for i, d in enumerate(depths):
                zout.writestr(f"depth_{i:05d}.{ext}", export(d, format, colormap))
        return Response(content=buf.getvalue(), media_type="application/zip",
                        headers={"Content-Disposition": "attachment; filename=depth_sequence.zip"})
    else:
        tmp_out = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
        tmp_out.close()
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(tmp_out.name, fourcc, sess.fps, (w, h))
        for d in depths:
            if format == "png_color":
                rgb = apply_colormap(d, colormap)
            else:
                gray = (np.clip(d, 0, 1) * 255).astype(np.uint8)
                rgb = np.stack([gray, gray, gray], axis=-1)
            if rgb.shape[0] != h or rgb.shape[1] != w:
                rgb = cv2.resize(rgb, (w, h), interpolation=cv2.INTER_LINEAR)
            writer.write(cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR))
        writer.release()
        # Clean up session
        video_sessions[session_id].cleanup()
        del video_sessions[session_id]
        return FileResponse(tmp_out.name, media_type="video/mp4", filename="depth_video.mp4")


@app.post("/process/video")
async def process_video(
    file: UploadFile = File(...),
    model: str = Form("small"),
    format: str = Form("png_gray"),
    colormap: str = Form("inferno"),
    smooth: float = Form(0.4),
    align_scale: bool = Form(True),
    output: str = Form("video"),  # "video" or "sequence"
    every: int = Form(1),
):
    """
    Process a video file. Extract frames, run depth inference, return result.
    output="video" → returns MP4 of depth maps
    output="sequence" → returns ZIP of depth map images
    """
    raw = await file.read()

    # Write to temp file for OpenCV
    suffix = os.path.splitext(file.filename or "video.mp4")[1] or ".mp4"
    tmp_in = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    tmp_in.write(raw)
    tmp_in.close()

    try:
        cap = cv2.VideoCapture(tmp_in.name)
        if not cap.isOpened():
            raise HTTPException(400, "Could not open video file.")

        fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        # Extract frames
        frames = []
        frame_idx = 0
        while True:
            ret, bgr = cap.read()
            if not ret:
                break
            if frame_idx % every == 0:
                rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                frames.append(Image.fromarray(rgb))
            frame_idx += 1
        cap.release()

        if not frames:
            raise HTTPException(400, "No frames extracted from video.")

        engine.load_model(model)
        depths = engine.process_video_frames(
            frames, temporal_smooth=smooth, align_scale=align_scale
        )

        if output == "sequence":
            # Return ZIP of depth images
            ext = "exr" if format == "exr" else "png"
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zout:
                for i, depth in enumerate(depths):
                    padded = f"{i:05d}"
                    zout.writestr(
                        f"depth_{padded}.{ext}",
                        export(depth, format, colormap),
                    )
            return Response(
                content=buf.getvalue(),
                media_type="application/zip",
                headers={
                    "X-Frame-Count": str(len(depths)),
                    "X-FPS": str(fps / every),
                    "Content-Disposition": "attachment; filename=depth_sequence.zip",
                },
            )
        else:
            # Return MP4 video of depth maps
            tmp_out = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
            tmp_out.close()

            out_fps = fps / every
            fourcc = cv2.VideoWriter_fourcc(*"mp4v")
            writer = cv2.VideoWriter(tmp_out.name, fourcc, out_fps, (w, h))

            for depth in depths:
                if format == "png_color":
                    rgb = apply_colormap(depth, colormap)
                else:
                    gray = (np.clip(depth, 0, 1) * 255).astype(np.uint8)
                    rgb = np.stack([gray, gray, gray], axis=-1)
                # Resize to match original video dimensions
                if rgb.shape[0] != h or rgb.shape[1] != w:
                    rgb = cv2.resize(rgb, (w, h), interpolation=cv2.INTER_LINEAR)
                bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
                writer.write(bgr)
            writer.release()

            return FileResponse(
                tmp_out.name,
                media_type="video/mp4",
                filename="depth_video.mp4",
                headers={
                    "X-Frame-Count": str(len(depths)),
                    "X-FPS": str(out_fps),
                },
            )
    finally:
        os.unlink(tmp_in.name)


@app.post("/process/video/info")
async def video_info(
    file: Optional[UploadFile] = File(None),
    file_path: Optional[str] = Form(None),
):
    """Get video metadata + first frame thumbnail."""
    tmp_name = None
    if file_path and os.path.exists(file_path):
        video_path = file_path
    elif file:
        raw = await file.read()
        suffix = os.path.splitext(file.filename or "video.mp4")[1] or ".mp4"
        tmp = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
        tmp.write(raw)
        tmp.close()
        video_path = tmp.name
        tmp_name = tmp.name
    else:
        raise HTTPException(400, "Provide file or file_path.")
    try:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise HTTPException(400, "Could not open video.")

        fps = cap.get(cv2.CAP_PROP_FPS)
        info = {
            "fps": fps,
            "frames": int(cap.get(cv2.CAP_PROP_FRAME_COUNT)),
            "width": int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
            "height": int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
            "duration": cap.get(cv2.CAP_PROP_FRAME_COUNT) / max(fps, 1),
        }

        # Extract first frame as base64 thumbnail
        ret, bgr = cap.read()
        if ret:
            import base64
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            thumb = Image.fromarray(rgb)
            # Resize for quick transfer
            max_dim = 800
            if thumb.width > max_dim or thumb.height > max_dim:
                ratio = min(max_dim / thumb.width, max_dim / thumb.height)
                thumb = thumb.resize((int(thumb.width * ratio), int(thumb.height * ratio)), Image.LANCZOS)
            buf = io.BytesIO()
            thumb.save(buf, format="JPEG", quality=80)
            info["thumbnail"] = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()

        cap.release()
        return info
    finally:
        if tmp_name:
            os.unlink(tmp_name)


@app.get("/session/{session_id}/source")
def session_source(session_id: str):
    """Get the source image from a session."""
    data = cache.get(session_id)
    if not data:
        raise HTTPException(404, "Session not found.")
    img, _ = data
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")

@app.get("/session/{session_id}/depth")
def session_depth(session_id: str, colormap: str = "grayscale"):
    """Get the depth map from a session as PNG."""
    data = cache.get(session_id)
    if not data:
        raise HTTPException(404, "Session not found.")
    _, depth = data
    out = export(depth, "png_gray", colormap)
    return Response(content=out, media_type="image/png")

@app.post("/save")
async def save_file(
    file: UploadFile = File(...),
    path: str = Form(...),
):
    """Save uploaded file to disk at the given path."""
    raw = await file.read()
    # Ensure parent directory exists
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "wb") as f:
        f.write(raw)
    return {"saved": path, "size": len(raw)}


@app.post("/effect/{effect_name}")
async def run_effect(
    effect_name: str,
    file: Optional[UploadFile] = File(None),
    session_id: Optional[str] = Form(None),
    model: str = Form("small"),
    params_json: str = Form("{}"),
):
    if effect_name not in {"slice", "grade", "dof", "fog", "parallax", "posterize"}:
        raise HTTPException(404, "Unknown effect.")
    params = _coerce_params(json.loads(params_json))

    # Extract posterize modifier if present
    posterize_on = params.pop("_posterize", False)
    posterize_levels = params.pop("_posterize_levels", 4)
    if isinstance(posterize_on, str):
        posterize_on = posterize_on.lower() in ("true", "1", "yes")
    if isinstance(posterize_levels, str):
        posterize_levels = int(posterize_levels)

    if session_id and cache.get(session_id):
        img, depth = cache.get(session_id)
    elif file:
        img, depth, _ = await _infer_frame(file, model)
    else:
        raise HTTPException(400, "Provide 'file' or valid 'session_id'.")

    if posterize_on:
        depth = posterize_depth_array(depth, posterize_levels)

    result = apply_effect(effect_name, img, depth, params)
    buf = io.BytesIO()
    result.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")

@app.post("/effect/{effect_name}/preview")
async def effect_preview(
    effect_name: str,
    file: Optional[UploadFile] = File(None),
    session_id: Optional[str] = Form(None),
    model: str = Form("small"),
    colormap: str = Form("inferno"),
    params_json: str = Form("{}"),
):
    if effect_name not in {"slice", "grade", "dof", "fog", "parallax", "posterize"}:
        raise HTTPException(404, "Unknown effect.")
    params = _coerce_params(json.loads(params_json))

    # Extract posterize modifier if present
    posterize_on = params.pop("_posterize", False)
    posterize_levels = params.pop("_posterize_levels", 4)
    if isinstance(posterize_on, str):
        posterize_on = posterize_on.lower() in ("true", "1", "yes")
    if isinstance(posterize_levels, str):
        posterize_levels = int(posterize_levels)

    if session_id and cache.get(session_id):
        img, depth = cache.get(session_id)
    elif file:
        img, depth, _ = await _infer_frame(file, model)
    else:
        raise HTTPException(400, "Provide 'file' or valid 'session_id'.")

    if posterize_on:
        depth = posterize_depth_array(depth, posterize_levels)

    depth_vis   = Image.fromarray(apply_colormap(depth, colormap), "RGB")
    effect_out  = apply_effect(effect_name, img, depth, params).convert("RGB")

    h = min(img.height, 480)
    w = int(img.width * h / img.height)
    depth_vis  = depth_vis.resize((w, h), Image.LANCZOS)
    effect_out = effect_out.resize((w, h), Image.LANCZOS)

    combined = Image.new("RGB", (w * 2 + 4, h), (30, 30, 34))
    combined.paste(depth_vis, (0, 0))
    combined.paste(effect_out, (w + 4, 0))

    buf = io.BytesIO()
    combined.save(buf, "PNG")
    return Response(content=buf.getvalue(), media_type="image/png")

# ── Wigglegram endpoint ──────────────────────────────────────────────────────

@app.post("/wigglegram")
async def wigglegram(
    file: Optional[UploadFile] = File(None),
    session_id: Optional[str] = Form(None),
    model: str = Form("small"),
    num_views: int = Form(5),
    separation: float = Form(15),
    blur_depth: float = Form(5),
    path: str = Form("linear"),
    fps: int = Form(12),
    format: str = Form("gif"),
):
    """Generate a wigglegram GIF or MP4 from an image and its depth map."""
    if session_id and cache.get(session_id):
        img, depth = cache.get(session_id)
    elif file:
        img, depth, _ = await _infer_frame(file, model)
    else:
        raise HTTPException(400, "Provide 'file' or valid 'session_id'.")

    views = create_wigglegram(img, depth, num_views=num_views,
                              separation=separation, path=path, blur_depth=blur_depth)

    if format == "mp4":
        # Bounce loop: forward + reverse (minus endpoints to avoid double)
        bounce = views + views[-2:0:-1]
        tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
        tmp.close()
        w, h = views[0].size
        fourcc = cv2.VideoWriter_fourcc(*"mp4v")
        writer = cv2.VideoWriter(tmp.name, fourcc, float(fps), (w, h))
        for frame in bounce:
            bgr = cv2.cvtColor(np.array(frame), cv2.COLOR_RGB2BGR)
            writer.write(bgr)
        writer.release()
        with open(tmp.name, "rb") as f:
            data = f.read()
        os.unlink(tmp.name)
        return Response(content=data, media_type="video/mp4",
                        headers={"Content-Disposition": "attachment; filename=wigglegram.mp4"})
    else:
        # GIF with loop
        buf = io.BytesIO()
        duration = max(1, int(1000 / fps))
        # Bounce loop for GIF too
        bounce = views + views[-2:0:-1]
        bounce[0].save(buf, format="GIF", save_all=True,
                       append_images=bounce[1:], duration=duration, loop=0)
        return Response(content=buf.getvalue(), media_type="image/gif",
                        headers={"Content-Disposition": "attachment; filename=wigglegram.gif"})


# ── Spatial photo endpoint ───────────────────────────────────────────────────

@app.post("/spatial")
async def spatial(
    file: Optional[UploadFile] = File(None),
    session_id: Optional[str] = Form(None),
    model: str = Form("small"),
    eye_separation: float = Form(30),
    convergence: float = Form(0.5),
    output: str = Form("sbs"),
):
    """Generate spatial stereo pair. output='sbs' returns side-by-side PNG, 'zip' returns separate L/R."""
    if session_id and cache.get(session_id):
        img, depth = cache.get(session_id)
    elif file:
        img, depth, _ = await _infer_frame(file, model)
    else:
        raise HTTPException(400, "Provide 'file' or valid 'session_id'.")

    left, right = create_spatial_pair(img, depth, eye_separation=eye_separation,
                                      convergence=convergence)

    if output == "zip":
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zout:
            lbuf = io.BytesIO()
            left.save(lbuf, format="PNG")
            zout.writestr("left.png", lbuf.getvalue())
            rbuf = io.BytesIO()
            right.save(rbuf, format="PNG")
            zout.writestr("right.png", rbuf.getvalue())
        return Response(content=buf.getvalue(), media_type="application/zip",
                        headers={"Content-Disposition": "attachment; filename=spatial_pair.zip"})
    else:
        # Side-by-side
        w, h = left.size
        combined = Image.new("RGB", (w * 2, h))
        combined.paste(left, (0, 0))
        combined.paste(right, (w, 0))
        buf = io.BytesIO()
        combined.save(buf, format="PNG")
        return Response(content=buf.getvalue(), media_type="image/png",
                        headers={"Content-Disposition": "attachment; filename=spatial_sbs.png"})


# ── Transition endpoint ─────────────────────────────────────────────────────

@app.post("/transition")
async def transition(
    file_a: UploadFile = File(...),
    file_b: UploadFile = File(...),
    model: str = Form("small"),
    transition_val: float = Form(0.5),
    softness: float = Form(0.1),
):
    """Depth-driven transition between two images using depth of image A as wipe gradient."""
    raw_a = await file_a.read()
    raw_b = await file_b.read()
    try:
        img_a = Image.open(io.BytesIO(raw_a)).convert("RGB")
        img_b = Image.open(io.BytesIO(raw_b)).convert("RGB")
    except Exception as e:
        raise HTTPException(400, f"Could not decode images: {e}")

    engine.load_model(model)
    depth_a = engine.process_frame(img_a)

    result = depth_transition(img_a, img_b, depth_a,
                              transition=transition_val, softness=softness)
    buf = io.BytesIO()
    result.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


@app.post("/transition/preview")
async def transition_preview(
    file_a: UploadFile = File(...),
    file_b: UploadFile = File(...),
    model: str = Form("small"),
    transition_val: float = Form(0.5),
    softness: float = Form(0.1),
):
    """Preview depth transition — returns the result image."""
    raw_a = await file_a.read()
    raw_b = await file_b.read()
    try:
        img_a = Image.open(io.BytesIO(raw_a)).convert("RGB")
        img_b = Image.open(io.BytesIO(raw_b)).convert("RGB")
    except Exception as e:
        raise HTTPException(400, f"Could not decode images: {e}")

    engine.load_model(model)
    depth_a = engine.process_frame(img_a)

    result = depth_transition(img_a, img_b, depth_a,
                              transition=transition_val, softness=softness)
    buf = io.BytesIO()
    result.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="127.0.0.1", port=7842, reload=False)
