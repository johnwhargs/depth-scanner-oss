# CLAUDE.md — Depth Scanner OSS

Project context for Claude Code. Read this before touching any file.

---

## What this project is

An open-source After Effects depth map plugin powered by Depth Anything V2.
Two components that work together:

- **`backend/`** — Python FastAPI server running on `localhost:7842`
- **`panel/`** — Adobe CEP panel (HTML/JS + ExtendScript) that talks to the backend

The user runs the backend manually. The AE panel connects to it over HTTP.

---

## Architecture

```
After Effects
  └── CEP Panel (panel/index.html + panel/js/panel.js)
        ├── ExtendScript bridge (panel/jsx/host.jsx)
        │     └── Exports frames via AE render queue
        │     └── Imports depth maps back into project
        └── HTTP → localhost:7842
              └── FastAPI (backend/server.py)
                    ├── depth_engine.py   — Depth Anything V2 inference
                    ├── exporters.py      — PNG / EXR output
                    └── effects.py        — DoF, grading, slicing
```

---

## Backend files — what each one does

### `backend/depth_engine.py`
- `DepthEngine` class wraps HuggingFace `pipeline("depth-estimation")`
- `load_model(size)` — hot-swaps Small / Base / Large without restarting server
- `process_frame(image)` — single PIL Image → float32 depth [0,1]
- `process_video_frames(frames, temporal_smooth, align_scale)` — batch with temporal stability
- **`_align_depth(ref, target)`** — the key flicker-fix function. Solves least-squares to find affine transform (scale + bias) mapping each new frame onto the previous frame's depth space. DO NOT simplify this into plain EMA — it's specifically here because raw EMA causes severe flickering from frame-to-frame depth scale drift.
- `COLORMAPS` dict — 20+ LUT arrays built at import time, no matplotlib dependency

### `backend/exporters.py`
- `export(depth, format, colormap)` — dispatcher returning raw bytes
- `export_png_grayscale(depth)` — 8-bit L-mode PNG
- `export_png_colorized(depth, colormap)` — RGB PNG via COLORMAPS LUT
- `export_exr(depth)` — 32-bit float EXR. Uses OpenEXR lib if installed, otherwise falls back to `_write_minimal_exr()` which is a hand-rolled EXR writer compatible with After Effects and DaVinci Resolve. DO NOT remove the fallback — most users won't have OpenEXR installed.

### `backend/effects.py`
Three depth-driven image effects. All take `(image: PIL.Image, depth: np.ndarray, **params)`.
- `depth_slice` — masks pixels to a depth band [near, far] with feathered edges. Outputs RGBA (transparent bg) or RGB composite.
- `depth_grade` — blends a near→far colour ramp over the image. Supports overlay / multiply / screen / add / normal blend modes.
- `depth_of_field` — layered Gaussian/disc blur keyed to distance from focal plane. Uses multiple blur levels and blends between them per-pixel. The layered approach (not a single blur) is intentional — it approximates the way real DoF spreads blur continuously.
- `apply_effect(effect, image, depth, params)` — dispatcher called by server

### `backend/server.py`
- `SessionCache` — LRU cache (max 20 entries) storing `(PIL.Image, np.ndarray)` pairs keyed by 8-char UUID. Lets effects reuse depth without re-inference.
- `POST /process/frame` — infer depth, return bytes, cache session
- `POST /process/batch` — accept ZIP of frames, return ZIP of depth maps
- `POST /effect/{name}` — apply effect using `session_id` (fast) or fresh `file` upload
- `POST /effect/{name}/preview` — returns side-by-side PNG (depth | result) for panel preview
- `_coerce_params()` — converts FormData strings to proper Python types (bool, int). Required because FormData sends everything as strings.

---

## Panel files — what each one does

### `panel/jsx/host.jsx`
ExtendScript (ES3). Runs inside After Effects.
- `exportCurrentFrame()` — adds comp to render queue, renders single frame as PNG to temp dir, removes rq item
- `exportFrameRange(start, end, every)` — same but loops over frame range
- `importDepthMap(path, addToComp, name)` — imports a single file into AE project
- `importDepthSequence(firstPath, addToComp)` — imports as image sequence
- `getCompInfo()` — returns comp metadata as JSON string (name, size, fps, work area)
- `getTempDir()` — returns/creates `{os_temp}/DepthScannerOSS/`
- All functions return JSON strings (AE ExtendScript bridge is string-only)

### `panel/js/panel.js`
- Polls `/health` every 4s, updates status dot
- `processCurrentFrame()` — orchestrates: evalScript export → readLocalFile → POST to server → writeLocalFile → showPreview
- `processRange()` — same but builds ZIP of frames, sends to `/process/batch`, extracts result ZIP
- `runEffect(previewMode)` — sends session_id + params_json to `/effect/{name}` or `/effect/{name}/preview`
- `buildRawZip(entries)` — hand-rolled STORE ZIP (no compression). No JSZip dependency — intentional, keeps the panel self-contained
- `extractZip(zipBuffer, dir)` — minimal ZIP parser for server responses
- `readLocalFile / writeLocalFile` — use `window.cep.fs` with Base64 encoding (CEP file I/O)

### `panel/index.html`
All CSS is inline in `<style>` block. No external stylesheets. All JS is in `panel/js/panel.js`.
- Main tabs: Frame / Video / Effects / About
- Effects sub-tabs: DoF / Grading / Slice
- Each effect has a Preview button (calls `/preview` endpoint, no disk write) and Apply button (saves result)

---

## Constraints — do not break these

**Temporal alignment** (`depth_engine.py`)
The `_align_depth()` least-squares solve is the primary defence against depth flickering in video. Do not replace it with simple frame averaging or clipping. If you touch `process_video_frames`, the `align_scale` parameter must remain and default to `True`.

**EXR fallback** (`exporters.py`)
`_write_minimal_exr()` must stay. Do not gate EXR output on `_HAS_OPENEXR`. The fallback produces valid single-channel 32-bit EXR that After Effects can import.

**Session cache** (`server.py`)
Effects depend on the session cache. The `X-Session-Id` header returned from `/process/frame` is stored in `state.sessionId` in the panel JS and sent with effect requests. If you change the session flow, update both sides.

**FormData boolean coercion** (`server.py`)
FastAPI receives FormData values as strings. `_coerce_params()` converts `"true"/"false"` to Python bools and string integers to int. Any new effect params that are bool or int need to be added here.

**CEP file I/O** (`panel.js`)
`readLocalFile` and `writeLocalFile` use `window.cep.fs` with Base64 encoding. Do not replace with `fetch()` file:// URLs — CEP panels block file:// fetch. Do not use the Node.js `fs` module — not available in CEP panels.

**ExtendScript compatibility** (`host.jsx`)
host.jsx runs in AE's ExtendScript engine (ES3 subset). No arrow functions, no `const`/`let`, no template literals, no `Array.prototype.forEach`. Use `var` and `for` loops only.

**No external JS dependencies in the panel**
The panel has no npm, no bundler, no CDN imports. Keep it that way — CEP panels can run offline and users shouldn't need node or internet access to install.

---

## Running locally

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --host 127.0.0.1 --port 7842

# Panel (install into AE)
# macOS — enable unsigned extensions first:
defaults write com.adobe.CSXS.11 PlayerDebugMode 1
# Then symlink or copy panel/ to:
# ~/Library/Application Support/Adobe/CEP/extensions/DepthScannerOSS/
```

---

## Adding a new effect

1. Add the function to `backend/effects.py` following the `(image, depth, **params)` signature
2. Add it to the `apply_effect()` dispatcher in `effects.py`
3. Add the effect name to the `valid_effects` set in `server.py`
4. Add any bool/int params to `_coerce_params()` in `server.py`
5. Add an `fx-tab` button and `fx-pane` div to `panel/index.html`
6. Add a `getEffectParams()` branch in `panel/js/panel.js`

---

## Adding a new model

Add an entry to `MODEL_MAP` in `backend/depth_engine.py`:
```python
MODEL_MAP = {
    "small":  "depth-anything/Depth-Anything-V2-Small-hf",
    "base":   "depth-anything/Depth-Anything-V2-Base-hf",
    "large":  "depth-anything/Depth-Anything-V2-Large-hf",
    "v3":     "depth-anything/Depth-Anything-V3-Large-hf",  # example
}
```
Add the corresponding `<option>` to the model `<select>` in `panel/index.html`.

---

## Known limitations

- No Premiere Pro support (AE only by design for now)
- Depth Anything V3 not yet on HuggingFace — V2 is the ceiling
- DoF effect uses layered Gaussian blur, not true scattering — looks good, not physically accurate
- EXR fallback writer is uncompressed (larger files) — acceptable for single frames, verbose for sequences
- CEP panels require PlayerDebugMode for unsigned installs — document this clearly for users
