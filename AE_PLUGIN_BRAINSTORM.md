# Depth Scanner OSS — Research & Plugin Roadmap

Status: **Active research** — tutorials analyzed, references collected, architecture planned.

---

## 1. Product Vision

**Depth Scanner** is an AI depth map generator + creative effects suite. Three delivery channels:

| Channel | Status | Purpose |
|---------|--------|---------|
| Desktop app (Tauri) | Built | Generate depth maps from images/video |
| AE automation plugin (JSX) | Planned | Auto-setup depth workflows inside After Effects |
| MisregAE integration | Planned | Depth-driven halftone/riso/dither effects via GPU plugin |
| Playground demo | Planned | Free browser demo with pre-computed clips |

---

## 2. Effects — What Depth Maps Unlock

### Built (in desktop app backend)
- **Depth of Field** — layered blur, focal depth/range, gaussian/disc bokeh
- **Depth Grade** — near/far color tint, blend modes, gamma
- **Depth Slice** — isolate depth band, feathered matte, transparent/solid bg
- **Depth Fog** — atmospheric haze, density/near/far controls, noise
- **Parallax / 2.5D** — displacement from depth, XY shift, zoom, smoothing

### Planned — Desktop App
- **Wigglegram** — multi-view displacement loop, export GIF/MP4
- **Depth Transition** — wipe between clips through Z-space (Gradient Wipe pattern)
- **Posterize Depth** — stepped depth bands for stylized effects
- **Spatial Photo/Video** — export MV-HEVC for Apple Vision Pro

### Planned — AE Plugin (JSX Automation)
- **EZ Matte** — auto-create precomp with depth as luma matte + Essential Properties (brightness=depth, contrast=feather)
- **Depth DoF** — apply Camera Lens Blur with depth map as blur map, add focal distance control
- **Depth Fog** — create solid + Fractal Noise, depth as luma matte, essential properties for density/color
- **Depth Parallax** — apply Displacement Map, connect depth layer, blur depth for smooth displacement
- **Stereo Comp** — create left/right eye comps with displacement, separation/convergence null
- **Depth Transition** — Gradient Wipe driven by depth pass between two clips

### Planned — MisregAE GPU Integration
- Depth map layer input per effect → modulates LPI, dot size, density, misregistration per-pixel on GPU

---

## 3. Wigglegram — Deep Dive

### What It Is
A Nishika camera takes 4 photos from slightly different viewpoints simultaneously. Flipping between them creates a 3D wiggle effect. We simulate this digitally from a single image + depth map.

### Approaches (from research)

| Method | Quality | Speed | Occlusion Handling |
|--------|---------|-------|--------------------|
| Displacement map (current) | Good | Real-time | Stretchy at edges |
| Monocular Gaussian splat (SHARP) | Great | <1s setup, real-time render | Slightly blurry bg |
| Full Gaussian splat (multi-image) | Best | Minutes | Clean |
| Depth ray marching + smoothing | Good | Real-time | Stretchy |

### Implementation Plan
1. **V1 (now):** Displacement-based parallax — generate 3–7 views by shifting depth, loop as GIF/MP4. Fast, stretchy edges acceptable.
2. **V2 (SHARP):** Apple's monocular splatting — single photo → 3D Gaussians → render novel views. Better occlusion, sub-second.
3. **Controls:** Number of views (3–7), eye separation, curve path (linear/arc/orbit), loop style (bounce/forward), export format (GIF/MP4/image sequence)

### Key Insight from Research
> "Depth Anything is a bit jumpy frame-to-frame because it processes frames independently. So I implemented a per-pixel depth smoother."

We already have this — `_align_depth()` in `depth_engine.py` does exactly this via least-squares affine alignment.

> "For now, there's no way to get a Wigglegram that works both in real-time and doesn't suffer from the occlusion issue."

SHARP solves this — 3D Gaussian representation handles occlusion properly.

---

## 4. AE Plugin Architecture (JSX Automation)

Based on tutorial analysis, most depth workflows in AE follow one pattern:
**Depth map → control layer (luma matte or map input) → native AE effect**

No native C++ plugin needed for most effects. A JSX script that auto-builds the comp structure is faster to ship and works everywhere.

### What the Script Does
```
User has: footage.mp4 + footage_depth.exr (from Depth Scanner)
Script creates:
├── Sources/ (footage + depth)
├── EZ Matte Comps/
│   └── footage_matte (precomp with Essential Properties)
├── Depth Effects/
│   ├── DoF comp (Camera Lens Blur + depth as blur map)
│   ├── Fog comp (solid + fractal noise + depth luma matte)
│   ├── Parallax comp (Displacement Map + blurred depth)
│   └── Stereo comp (left eye + right eye + viewer)
└── Control null with keyframeable depth sliders
```

### AE Effects Mapping

| Our Effect | AE Native Effect | Depth Map Role |
|------------|-----------------|----------------|
| EZ Matte | Brightness & Contrast on depth layer | Luma Matte for source |
| DoF | Camera Lens Blur / Universe Bokeh | Blur Map Layer input |
| Fog | Fractal Noise solid | Luma Matte (depth controls fog density) |
| Parallax | Displacement Map | Displacement Layer input |
| Transition | Gradient Wipe | Gradient Layer input |
| Color grade | Tint / Levels per depth band | Multiple luma mattes at different cutoffs |
| Stereo 3D | Displacement Map (left/right shift) | Displacement Layer input |

### Essential Properties Pattern
Key workflow from tutorials: precomp with brightness/contrast on depth layer, exposed as Essential Properties. This gives user two sliders (depth cutoff + feather) on a single layer that works in any comp.

---

## 5. MisregAE Depth Integration

### Architecture
Native C++ GPU plugin (Metal + OpenCL). 6 effects. Add depth map as optional layer input.

### Per Effect — What Depth Controls

| Effect | Depth → Parameter | Creative Result |
|--------|-------------------|-----------------|
| Halftone | LPI, dot size | Finer halftone near camera, coarser far |
| Riso | Per-ink misreg, opacity, LPI | Foreground crisp, background washed/misaligned |
| Dither | Color count, threshold | More detail near, posterized far |
| Stipple | Dot density, dot size | Dense near, sparse far |
| Grain | Grain size, amount | More grain = farther |
| Memphis | Shape density, size | Depth-aware pattern distribution |

### Implementation (5 steps per effect)
1. `Misreg.h` — Add param enum + struct fields
2. `Misreg.cpp` — `PF_ADD_LAYER("Depth Map")` + checkout in PreRender
3. SmartRender — Bind depth buffer to Metal/OpenCL
4. Metal kernel — Sample depth per-pixel, modulate parameters
5. OpenCL kernel — Mirror Metal changes (identical struct layout)

### UI Per Effect
```
▼ Depth Map
  Depth Map Layer     [None ▾]
  ☑ Depth → Dot Size      Amount: [50%]
  ☑ Depth → LPI           Range:  [-30 to +30]
  ☐ Depth → Angle
  ☐ Depth → Opacity
  Depth Invert        [No ▾]
  Depth Gamma         [1.0]
```

---

## 6. Depth Model Research

### Current: Depth Anything V2
- Relative depth (not metric)
- Small/Base/Large variants
- Good quality, fast on GPU
- Frame-to-frame jitter (solved by our `_align_depth()`)

### Next: Apple SHARP
- **Paper:** `/2512.10685v2.pdf`
- **Repo:** https://github.com/apple/ml-sharp.git
- **Review:** https://www.themoonlight.io/en/review/depth-pro-sharp-monocular-metric-depth-in-less-than-a-second
- Single photo → 3D Gaussian representation in <1 second
- **Metric depth** — absolute scale, correct stereo baseline
- **Novel view rendering** at 100+ fps
- Replaces DA V2 AND enables proper wigglegram/spatial video
- **Upgrade path:** Keep DA V2 as "fast" mode, add SHARP as "quality/3D" mode

---

## 7. Bokeh Research — DoF Upgrade Path

| Tier | Method | Quality | Speed | Reference |
|------|--------|---------|-------|-----------|
| Current | Layered Gaussian blur | Preview | Fast | Built-in |
| Next | Scattering CoC + aperture shapes | Accurate | Medium | CAIP 2015, Bokehlicious |
| Advanced | Real-time gather/scatter with hex shapes | Good | Real-time | MJP post |
| Future | Neural/diffusion bokeh | Photorealistic | Slow | Neural Bokeh, BokehDiff, PyNET |

### References
- **Bokehlicious** — https://github.com/TimSeizinger/Bokehlicious.git — Scatter-based, custom aperture shapes from images. No ML. Best "next" candidate.
- **BokehDiff** — https://github.com/FreeButUselessSoul/bokehdiff.git — Diffusion-based photorealistic bokeh.
- **PyNET-Bokeh** — https://github.com/aiff22/PyNET-Bokeh.git — ML trained on real lens data.
- **Neural Bokeh** — https://immersive-technology-lab.github.io/projects/neuralbokeh/ — Paper: https://immersive-technology-lab.github.io/projects/neuralbokeh/assets/vr24_mandl_paper.pdf
- **CAIP 2015** — `/CAIP_2015.pdf` — Scattering-based CoC from depth. `CoC = f·b/(D+Δ)`. Joint bilateral filter for depth edge refinement.
- **MJP Bokeh** — https://therealmjp.github.io/posts/bokeh/ — Deep technical breakdown: gather vs scatter, real-time techniques.
- **Bokeh types** — https://www.thephoblographer.com/2022/02/02/a-visual-guide-to-the-different-types-of-bokeh/ — Cat-eye, onion ring, soap bubble, swirly, creamy.

---

## 8. Apple Spatial / Vision Pro

### Opportunity
"Convert any photo or video to spatial" — depth map → stereo views → MV-HEVC spatial format → viewable on Vision Pro / iPhone 3D.

### Pipeline
1. Depth Scanner generates depth map
2. SHARP (or displacement) creates left/right eye views
3. Encode as MV-HEVC spatial video or spatial photo with ImageIO metadata
4. View on Vision Pro / iPhone Spatial mode

### References
- **WWDC 2024** — https://developer.apple.com/videos/play/wwdc2024/10166/
- **Creating spatial photos** — https://developer.apple.com/documentation/ImageIO/Creating-spatial-photos-and-videos-with-spatial-metadata
- **Writing spatial photos** — https://developer.apple.com/documentation/ImageIO/writing-spatial-photos
- **SBS to MV-HEVC** — https://developer.apple.com/documentation/AVFoundation/converting-side-by-side-3d-video-to-multiview-hevc-and-spatial-video
- **Spatial forums** — https://developer.apple.com/forums/topics/spatial-computing
- **AVCam** — https://developer.apple.com/documentation/AVFoundation/avcam-building-a-camera-app
- **vision-utils** — https://github.com/studiolanes/vision-utils
- **spatial-image** — https://github.com/orgs/spatial-image/repositories
- **SpatialEdit** — https://github.com/EasonXiao-888/SpatialEdit.git
- **WebXR Viewer** — https://github.com/zfox23/spatial-photo-webxr-viewer.git
- **3D spatial scenes** — https://www.idownloadblog.com/2025/07/25/view-2d-images-3d-spatial-scenes-iphone-ipad-tutorial/
- **ISPR analysis** — https://ispr.info/2025/09/08/apples-3d-spatial-scenes-a-step-toward-a-future-where-all-digital-interactions-are-spatial/

---

## 9. Tutorial Workflows Analyzed

### Tutorial 1: Depth Wish Script (Action Movie Dad)
- EZ Matte precomp with Essential Properties
- Stereo 3D with separation/convergence null
- Trapcode Mir 3D extrusion from depth
- **Pattern:** Depth → luma matte → Essential Properties precomp

### Tutorial 2: Lincoln Parallax (Displacement Map)
- Displacement Map + blurred depth layer
- Keyframe XY displacement for camera move
- Layer with textures, 3D text, spotlight
- **Pattern:** Depth → blur → displacement → keyframe

### Tutorial 3: 3D Lightning (Blender + AE)
- Depth → Blender geometry nodes → 3D mesh
- Light 3D scene → render passes → composite in AE
- **Pattern:** Depth → 3D extrusion → lighting → composite

### Tutorial 4: Comprehensive Depth Compositing (Action Movie Dad)
- Text behind characters (EZ Matte)
- Depth transitions (Gradient Wipe)
- Tilt-shift bokeh (Camera Lens Blur / Universe Bokeh)
- City blackout (Gradient Wipe + posterizeTime)
- Atmospheric fog (Fractal Noise + depth matte)
- Z-space particles (Particular + depth zones)
- Color grading by depth
- **Pattern:** Native AE effect + depth as control layer

### Wigglegram Research (TouchDesigner artist)
- Nishika camera: 4 simultaneous viewpoints → wiggle loop
- Methods: displacement (fast, stretchy), monocular splat (better, blurry bg), full splat (best, slow)
- Depth Anything V2 ray marching with per-pixel depth smoother = real-time but stretchy occlusions
- SHARP monocular splatting = best single-image quality
- **Key insight:** No real-time method fully solves occlusion yet — SHARP is closest

---

## 10. Decision Log

| Date | Decision | Reason |
|------|----------|--------|
| 2026-04-17 | Desktop app separate from AE plugin | Better UX, no server dependency in AE |
| 2026-04-17 | MisregAE is best GPU integration target | Already shipping with layer inputs, Metal/OpenCL, parameter infrastructure |
| 2026-04-17 | JSX script for AE automation (not native plugin) | Most depth workflows = native AE effects + depth as control layer. Script auto-builds comp structure. |
| 2026-04-17 | Tauri for desktop (not Electron/pywebview) | 12MB vs 150MB+. Native WebKit, proper file dialogs. |
| 2026-04-17 | SHARP as V2 depth engine | Metric depth + 3D Gaussians + novel views in <1s. Enables spatial video. |
| 2026-04-17 | Scattering CoC for bokeh V2 | Bokehlicious/CAIP approach — physically accurate, no ML, GPU-friendly |

---

## 11. Next Steps

### Immediate
- [ ] Fix Tauri file picker (label+input approach)
- [ ] Test new effects (fog, parallax) in desktop app
- [ ] Build AE JSX automation script (EZ Matte + DoF + Fog)
- [ ] Add depth map layer to MisregAE Halftone as proof of concept

### Short-term
- [ ] Wigglegram effect (displacement-based V1)
- [ ] Spatial photo export (SBS → MV-HEVC)
- [ ] Playground demo with 5 pre-computed clips
- [ ] Scattering CoC bokeh (Bokehlicious approach)

### Medium-term
- [ ] Integrate Apple SHARP as depth engine option
- [ ] Spatial video export pipeline
- [ ] Roll out depth map to all 6 MisregAE effects
- [ ] Neural bokeh option (PyNET or BokehDiff)

### Long-term
- [ ] Real-time wigglegram via SHARP 3D Gaussians
- [ ] WebXR spatial photo viewer
- [ ] Full AE workflow automation suite
