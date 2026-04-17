# Depth Scanner OSS

Open-source depth map generator for After Effects, powered by
[Depth Anything V2](https://github.com/DepthAnything/Depth-Anything-V2).  
Runs fully locally — no data leaves your machine. MIT licensed.

---

## Architecture

```
┌─────────────────────────────┐      HTTP      ┌──────────────────────────────┐
│  After Effects CEP Panel    │ ◄───────────── │  Python FastAPI Backend      │
│  panel/index.html + JS      │   localhost     │  backend/server.py           │
│  panel/jsx/host.jsx (ExtSc) │    :7842        │  DepthAnything V2 (torch)    │
└─────────────────────────────┘                └──────────────────────────────┘
```

**Workflow:**
1. AE panel exports the current frame (or range) via ExtendScript render queue
2. Panel POSTs frame(s) to the local FastAPI server
3. Server runs Depth Anything V2 inference, returns depth map bytes
4. Panel saves result to disk and imports back into the AE project

---

## Backend Setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Start the server
uvicorn server:app --host 127.0.0.1 --port 7842
```

**First run** will download the selected model from HuggingFace:
- `small`  ~100 MB — fastest, good for most footage
- `base`   ~400 MB — balanced quality/speed
- `large`  ~800 MB — best quality, needs 8GB+ VRAM or 16GB RAM

### Hardware acceleration
| Platform              | Auto-detected |
|-----------------------|---------------|
| NVIDIA GPU (CUDA)     | ✓             |
| Apple Silicon (MPS)   | ✓             |
| CPU fallback          | ✓ (slow)      |

### Optional: EXR support
```bash
pip install openexr-python
```
Without it, a built-in minimal EXR writer is used (compatible with AE and Resolve).

---

## AE Panel Install

### Development (unsigned)
1. Enable unsigned CEP extensions:
   - **macOS**: `defaults write com.adobe.CSXS.11 PlayerDebugMode 1`
   - **Windows**: Add `PlayerDebugMode = 1` to `HKEY_CURRENT_USER\Software\Adobe\CSXS.11`
2. Copy the `panel/` folder to:
   - **macOS**: `~/Library/Application Support/Adobe/CEP/extensions/DepthScannerOSS/`
   - **Windows**: `%APPDATA%\Adobe\CEP\extensions\DepthScannerOSS\`
3. Restart After Effects
4. Open via **Window → Extensions → Depth Scanner OSS**

### Production
Sign the extension with [ZXPSignCmd](https://github.com/Adobe-CEP/CEP-Resources/tree/master/ZXPSignCMD) for distribution.

---

## API Reference

```
GET  /health              → server status + device + loaded model
GET  /models              → list of available models
GET  /colormaps           → list of 20+ colormaps
POST /load                → preload a model (form: model=small|base|large)
POST /process/frame       → single frame depth (form: file, model, format, colormap)
POST /process/batch       → batch ZIP of frames (form: file, model, format, colormap, smooth)
```

**Output formats:** `png_gray` | `png_color` | `exr`

**Colormaps (20+):** grayscale, grayscale_inv, inferno, viridis, rainbow, turbo,
cool, warm, depth_blue_orange, terrain_green, plasma_purple, ocean, copper,
arctic, red_glow, green_glow, blue_glow, twilight, seafoam, ember

---

## Output Formats

| Format       | Bit depth | Use case                              |
|--------------|-----------|---------------------------------------|
| PNG Grayscale| 8-bit     | Quick preview, matte, AE effects      |
| PNG Colorized| 8-bit RGB | Visual reference, stylistic effects   |
| EXR 32-bit   | 32-bit    | Compositing, DoF, fog, stereo-3D      |

---

## Temporal Smoothing

For video, the batch endpoint applies exponential moving average smoothing
between frames to reduce flickering:

```
depth[t] = smooth × depth[t-1] + (1 - smooth) × raw[t]
```

- `0.0` = no smoothing (sharp, may flicker)
- `0.4` = recommended default
- `0.7` = very stable (slow to respond to fast motion)

---

## Project Structure

```
depth-scanner-oss/
├── backend/
│   ├── server.py          FastAPI server
│   ├── depth_engine.py    Depth Anything V2 wrapper + colormaps
│   ├── exporters.py       PNG / EXR output
│   └── requirements.txt
└── panel/
    ├── CSXS/manifest.xml  CEP extension manifest
    ├── index.html          Panel UI
    ├── js/panel.js         CEP logic, server comms, ZIP I/O
    └── jsx/host.jsx        ExtendScript: frame export + import
```

---

## License

MIT © 2025 — uses [Depth Anything V2](https://github.com/DepthAnything/Depth-Anything-V2) (Apache 2.0).
