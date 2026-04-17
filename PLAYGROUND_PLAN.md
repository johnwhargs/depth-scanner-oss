# Playground Demo — Plan

Status: **Planning**

---

## Concept

Free browser-based demo showcasing Depth Scanner's capabilities. No backend, no downloads, no API keys. User picks from 5 pre-computed clips, manipulates depth effects in real-time.

**Goal:** Let users experience the output before downloading the desktop app.

---

## How it works

1. 5 short clips pre-processed (source + depth map pairs)
2. Hosted as static files (Netlify/Vercel/GitHub Pages)
3. All effects run client-side in JS/Canvas/WebGL
4. User picks a clip, adjusts effect parameters, sees result live

---

## Demo clips needed (from you)

| # | Description | Duration | Resolution |
|---|-------------|----------|------------|
| 1 | | ~3-5s | 1080p |
| 2 | | ~3-5s | 1080p |
| 3 | | ~3-5s | 1080p |
| 4 | | ~3-5s | 1080p |
| 5 | | ~3-5s | 1080p |

**For each clip, provide:**
- Source video (MP4 H.264)
- Depth map video (MP4 grayscale, same frame count/fps)

---

## Features to replicate client-side

### Core (canvas-based, no backend)
- [x] Side-by-side view (source | depth)
- [x] Wipe/split view with draggable divider
- [x] Overlay blend view
- [ ] Depth of Field — focal depth slider, blur amount
- [ ] Depth Fog — near/far color, density
- [ ] Depth Grade — near/far color tint by depth
- [ ] Depth Slice — isolate depth band, transparent bg
- [ ] Parallax wiggle — fake 3D displacement loop

### Stretch
- [ ] Wigglegram export (GIF)
- [ ] Download processed frame as PNG
- [ ] Custom depth colormap selector

---

## Tech stack

- **Static HTML/CSS/JS** — single page, no framework
- **Canvas 2D** or **WebGL** for real-time effects
- **Pre-loaded video** — source + depth synced via dual `<video>` elements drawn to canvas each frame
- **requestAnimationFrame** loop composites effects per-frame

---

## Architecture

```
Browser
├── index.html (UI + all JS inline)
├── clips/
│   ├── clip1_source.mp4
│   ├── clip1_depth.mp4
│   ├── clip2_source.mp4
│   ├── clip2_depth.mp4
│   └── ...
└── (hosted on Netlify/Vercel/GH Pages)
```

**Per frame:**
1. Read source pixel from source video → canvas
2. Read depth value from depth video → canvas
3. Apply selected effect using depth as control
4. Draw result to output canvas

---

## Effect implementation (client-side)

### Depth of Field (Canvas 2D)
```js
// Per pixel: blur amount = |depth - focalDepth| * maxBlur
// Use pre-blurred versions at 3-4 levels, blend by depth
```

### Depth Fog
```js
// Per pixel: mix(sourceColor, fogColor, depth * density)
```

### Depth Grade
```js
// Per pixel: tint = mix(nearColor, farColor, depth)
// Blend with source using opacity
```

### Depth Slice
```js
// Per pixel: alpha = smoothstep(near, near+feather, depth) * smoothstep(far+feather, far, depth)
```

### Parallax Wiggle
```js
// Displace pixels by depth * amplitude * sin(time)
// 3-5 frame loop, export as GIF
```

---

## UI Layout

```
┌─────────────────────────────────────────────┐
│  DEPTH SCANNER OSS — Playground             │
├──────┬──────────────────────────────────────┤
│ Clip │                                      │
│  1   │     [Canvas — live effect output]     │
│  2   │                                      │
│  3   │                                      │
│  4   │     Source | Depth | Effect           │
│  5   │                                      │
├──────┤                                      │
│Effect│                                      │
│ DoF  ├──────────────────────────────────────┤
│ Fog  │  [Sliders: focal depth, blur, etc.]  │
│Grade │                                      │
│Slice │  [View: Source | Depth | Split | FX] │
│Wiggle│                                      │
├──────┴──────────────────────────────────────┤
│  ↓ Download Desktop App                     │
└─────────────────────────────────────────────┘
```

---

## CTA

- "Download Depth Scanner" button → links to GitHub releases
- "Process your own footage" → links to desktop app download
- "Works with After Effects" → links to AE plugin page

---

## Next steps

- [ ] Select 5 demo clips
- [ ] Process each through desktop app (source + depth MP4 pairs)
- [ ] Build playground page
- [ ] Deploy to Netlify/Vercel
- [ ] Add CTA links
