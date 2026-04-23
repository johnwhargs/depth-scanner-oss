# AE Plugin 3D Preview — Plan

## What Exists
- CEP panel with 12 effect builders (EZ Matte, DoF, Fog, Parallax, Stereo, Wigglegram, 3D Mesh, Transition, Blackout, Light Wrap, Depth Glow, Color Grade)
- ExtendScript bridge (`host.jsx`) manipulates AE layers
- No preview, no video, no WebGL — just dropdowns + apply button
- CSXS 11.0, AE 22+, CEF with `--allow-file-access-from-files`

## What's Possible
CEF = Chromium. Same engine as Electron. So:
- Three.js works (WebGL in CEF)
- `<video>` playback works
- `THREE.VideoTexture` works
- All renderer3d.js code reusable
- Canvas capture / export works

## Architecture

```
AE Comp
  ├── Source layer (footage)
  └── Depth layer (depth map)
        ↓ ExtendScript exports frames
        ↓ or reads from disk
        
CEP Panel (Chromium)
  ├── Three.js renderer (renderer3d.js — shared with Electron)
  ├── VideoTexture (source + depth)
  ├── Live 3D preview with all effects
  ├── Slider controls (same as Workshop)
  └── "Apply to Comp" → ExtendScript builds AE effects
```

## Data Flow Options

### Option A: Frame Export (offline preview)
1. ExtendScript exports source + depth as PNG sequences to temp dir
2. Panel loads PNGs as textures into Three.js
3. Scrub = load different frame pair
4. Works but slow — disk I/O per frame

### Option B: Video Export (real-time preview) — RECOMMENDED
1. ExtendScript renders source comp + depth comp as MP4 to temp
2. Panel loads two `<video>` elements
3. `THREE.VideoTexture` for real-time 3D playback
4. Smooth — matches Electron Workshop flow exactly

### Option C: Live Pixel Bridge (true real-time)
1. ExtendScript grabs current frame pixel data via `source.sourceRectAtTime()`
2. Pass Base64 to panel via `evalScript` callback
3. Panel decodes to texture
4. Updates as user scrubs AE timeline
5. Slowest transfer but truly live

## Constraints (from CLAUDE.md)
- ExtendScript = ES3. No arrow functions, no const/let, no template literals.
- No npm in panel. No CDN. Offline-capable.
- `window.cep.fs` for file I/O (not `fetch()` for local files).
- Panel JS and host.jsx are separate runtimes — string-only bridge.

## File Structure

```
ae-plugin/panel/
├── index.html              ← add 3D preview canvas + effect tabs
├── CSXS/manifest.xml       ← increase panel size (800x700)
├── js/
│   ├── main.js             ← existing panel logic
│   ├── panel-3d.js         ← NEW: 3D preview controller
│   └── (symlink or copy from electron-app/ui/js/)
│       ├── renderer3d.js
│       ├── renderer3d-shaders.js
│       ├── renderer3d-adapter.js
│       └── video-effects.js
├── lib/
│   ├── three.min.js        ← same vendor lib
│   └── three-addons/       ← same addons
├── css/
│   └── panel.css           ← adapted from common.css
└── jsx/
    └── host.jsx            ← add: exportPreviewVideo(), getCurrentFrameData()
```

## New ExtendScript Functions (host.jsx)

```javascript
// Export source + depth as temp videos for preview
function exportPreviewVideos() {
  // 1. Get active comp
  // 2. Find source + depth layers
  // 3. Add to render queue as MP4
  // 4. Render to temp dir
  // 5. Return paths as JSON
}

// Get current frame as base64 (for single-frame preview)
function getCurrentFramePixels(layerIdx) {
  // 1. Get layer at current time
  // 2. Export single frame to temp PNG
  // 3. Read back as base64 via cep.fs
  // 4. Return to panel
}

// Apply 3D effect settings back to comp
function apply3DEffect(effectName, paramsJSON) {
  // 1. Parse params (elevation, colors, grid, etc.)
  // 2. Build AE effect chain matching 3D preview
  // 3. Return success
}
```

## UI Layout (updated panel)

```
┌──────────────────────────────────────┐
│  DEPTH SCANNER                       │
├──────────────────────────────────────┤
│  Source: [layer dropdown ▼]          │
│  Depth:  [layer dropdown ▼]  [⟳]    │
├──────────────────────────────────────┤
│  ┌──────────────────────────────┐    │
│  │                              │    │
│  │   Three.js 3D Preview        │    │
│  │   (elevation/hologram/grid)  │    │
│  │                              │    │
│  └──────────────────────────────┘    │
│  [▶ Play] [⏸] [⏹]  0:02/0:10      │
│  [═══════●══════════════════]        │
├──────────────────────────────────────┤
│  Effect: [Elevation ▼]              │
│  Rotate X ────●───── -35°           │
│  Rotate Y ────●───── 15°            │
│  Elevation ───●───── 0.30           │
│  Grid     [✓] Scan [✓]             │
│  Style: [Cyberpunk ▼]              │
│  ...                                │
├──────────────────────────────────────┤
│  [Preview in AE]  [Apply to Comp]   │
│  [Export 3D Video]                   │
└──────────────────────────────────────┘
```

## Implementation Steps

1. **Copy shared JS/CSS** — renderer3d.js, shaders, adapter, video-effects.js, three.min.js into panel/
2. **Update manifest.xml** — bigger panel (800x700), add `<Resources>` for new files
3. **Rewrite index.html** — add canvas, effect tabs, sliders (same markup as workspace.html)
4. **Create panel-3d.js** — bridges CEP ↔ Three.js ↔ ExtendScript
5. **Add host.jsx functions** — exportPreviewVideos, getCurrentFramePixels
6. **Wire "Apply to Comp"** — translate 3D params → AE effect chains
7. **Test in AE** — debug mode, verify WebGL works in CEF

## Prerequisites
- Desktop app (Electron) must be stable first — same code shared
- Fix all renderer3d.js bugs before porting
- Video codec must work (H.264 avc1)

## Timeline Estimate
- Step 1-3: Copy + layout — 1 session
- Step 4-5: Bridge logic — 1 session
- Step 6-7: Apply + test — 1 session
