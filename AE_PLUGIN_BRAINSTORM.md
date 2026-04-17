# AE Depth Map Plugin — Brainstorm

Status: **Planning** — collecting tutorials and reference workflows before building.

---

## Concept

Desktop app generates depth maps. Separate AE plugin consumes them.
No server dependency — pure AE-side processing.

---

## Plugin Features (Candidates)

### Depth Fog / Atmosphere
- Fog, haze, volumetric light falloff driven by depth
- Near/far color + density controls
- Better than AE's built-in fog

### Rack Focus (DoF)
- Camera Lens Blur driven by depth map with keyframeable focal point
- Click-to-focus: pick a point, read depth value, animate focus pull
- Better than manual lens blur masks

### Depth Matte / Isolation
- Rotoscoping by depth — isolate foreground/background without masks
- Feathered depth cutoff, output as track matte
- Like depth slice but native in AE timeline

### Parallax / 2.5D
- Displacement map driven camera moves
- Fake dolly zoom, push-in, orbital from single frame
- Ken Burns on steroids

### Depth-Aware Color Grade
- Separate grade for foreground vs background
- Atmospheric perspective (desaturate + hue shift with distance)
- Teal/orange split by depth instead of luminance

### Stereo 3D / Wigglegram
- Generate left/right eye views from depth + source via displacement
- Output modes: side-by-side, anaglyph (red/cyan), interlaced, VR180
- **Wigglegram**: generate N views (3–7), export as looping GIF/MP4
- Controllable eye separation, convergence point
- Depth-aware inpainting for disoccluded regions (stretch or smear fill)
- Could run entirely in desktop app (no AE needed) or as MisregAE effect

---

## Build Options

### Option A: Expression + Script Bundle (easiest)
- JSX script auto-imports depth map, creates adjustment layers with expressions
- Expressions read pixel values from depth layer to drive native effects
- No compilation, works everywhere, modifiable
- **Ship fast, prove the workflow**

### Option B: .ffx Effect Presets (medium)
- Pre-built effect stacks using AE native effects
- Camera Lens Blur + depth map as blur map
- Fill + depth map as gradient for fog
- Installable presets

### Option C: Native .aex Plugin (most powerful)
- C++ After Effects SDK
- Full pixel access, GPU acceleration
- Custom UI in Effect Controls
- Proper bokeh, displacement, things expressions can't do

### Option D: Integrate into MisregAE (best leverage)
- Already have a shipping native GPU plugin with 6 effects
- Already handles layer inputs, Metal/OpenCL compute, parameter structs
- Add "Depth Map Layer" input to each effect
- Depth modulates existing parameters per-pixel on GPU
- **Fastest path to a real product — no new plugin infrastructure needed**

### Recommended Path
**Option D first** — add depth map support to MisregAE effects. Then Option C for standalone depth-only effects (fog, DoF, parallax) that don't fit MisregAE's scope.

---

## MisregAE Integration — Depth Map Support

### What MisregAE Is
Native C++ GPU plugin (Metal + OpenCL). 6 effects in one `.aeplugin` bundle:
- **Riso** — 6-ink halftone separation (~150 params, per-ink source layers)
- **Halftone** — 5 lattice types, 35+ params
- **Dither** — 16 methods, 20 retro palettes, custom palette layer
- **Stipple** — Luminance-driven particle rendering
- **Grain** — Chunky animated grain with color mapping
- **Memphis** — Pattern generator with 10 shape slots

### How Layer Inputs Already Work
Each effect already checks out optional layers (paper texture, highlight, custom palette) via:
```cpp
PF_CHECKOUT_PARAM → check .u.ld.data != NULL → checkout_layer_pixels → GetGPUWorldData → bind to Metal buffer
```
Adding depth map follows identical pattern.

### What Depth Would Control (per effect)

**Halftone + Depth:**
- LPI varies with depth (finer halftone near camera, coarser far)
- Dot size scales with depth
- Screen angle rotates with depth
- Density/opacity fades with depth

**Riso + Depth:**
- Per-ink misregistration increases with distance
- Ink opacity varies by depth (foreground crisp, background washed)
- LPI per-ink driven by depth
- Bleed amount increases with distance

**Dither + Depth:**
- Dither method changes with depth (e.g. fine near, coarse far)
- Color count reduces with depth (more colors near, fewer far)
- Threshold shifts with depth

**Stipple + Depth:**
- Dot density varies with depth
- Dot size scales with depth
- Jitter/randomness increases with distance

**Grain + Depth:**
- Grain size scales with depth
- Grain amount varies (more grain = farther)
- Color mapping shifts with depth

**Memphis + Depth:**
- Shape density varies with depth
- Shape size scales with depth
- Shapes avoid foreground (depth-aware safe area)

### Implementation Steps (Per Effect)

1. **Misreg.h** — Add `EFFECT_DEPTH_MAP` param enum + `mHasDepthMap` to struct + depth control fields
2. **Misreg.cpp** — Add `PF_ADD_LAYER("Depth Map", ...)` in ParamsSetup, checkout in PreRender
3. **SmartRender** — Bind depth buffer to Metal/OpenCL at new buffer index
4. **Metal kernel** — Sample depth per-pixel, multiply into relevant calculations
5. **OpenCL kernel** — Same changes, identical struct layout

### Example: Depth-Driven Halftone (Metal)

```metal
kernel void HalftoneKernel(
    device const float4 *src [[buffer(0)]],
    device float4 *dst [[buffer(1)]],
    constant HalftoneParams &p [[buffer(2)]],
    device const float4 *depthMap [[buffer(6)]],  // new
    uint2 gid [[thread_position_in_grid]])
{
    uint idx = gid.y * p.mWidth + gid.x;

    float depth = p.mHasDepthMap ? depthMap[idx].x : 0.5f;

    // Depth modulates LPI: near=fine, far=coarse
    float lpi = p.mLPI * mix(1.5f, 0.5f, depth);

    // Depth modulates dot size
    float dotScale = mix(0.7f, 1.3f, depth);

    // ... render halftone with modulated params
}
```

### UI: New "Depth Map" Accordion Per Effect

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

### Struct Sync Rule
C++ struct, Metal struct, OpenCL struct must have **identical field order and types**. GPU receives raw bytes. Any mismatch = garbage rendering or crash.

---

## Workflow

```
Desktop App                    After Effects
┌─────────────┐    depth.exr   ┌──────────────────┐
│ Drop video   │ ──────────►  │ Depth Utility     │
│ Process depth│               │ Plugin            │
│ Export .exr  │               │  ├─ Fog           │
└─────────────┘               │  ├─ Rack Focus    │
                               │  ├─ Depth Matte   │
                               │  ├─ Parallax      │
                               │  └─ Stereo 3D     │
                               └──────────────────┘
```

---

## Tutorial References

_Add tutorial transcripts and reference workflows below. These will inform which features to build first and how to match existing AE depth map workflows._

### Tutorial 1
- **Title:**
- **Source:**
- **Key workflow:**
- **Effects used:**
- **Notes:**

### Tutorial 2
- **Title:**
- **Source:**
- **Key workflow:**
- **Effects used:**
- **Notes:**

### Tutorial 3
- **Title:**
- **Source:**
- **Key workflow:**
- **Effects used:**
- **Notes:**

---

## Decision Log

| Date | Decision | Reason |
|------|----------|--------|
| 2026-04-17 | Desktop app separate from AE plugin | Better UX, no server dependency in AE |
| 2026-04-17 | MisregAE is best integration target | Already shipping GPU plugin with layer inputs, Metal/OpenCL kernels, and parameter infrastructure. Adding depth map layer follows existing pattern exactly. |
| | | |

---

## Next Steps

- [ ] Collect 3-5 tutorial transcripts showing AE depth map workflows
- [ ] Identify most common effects/techniques across tutorials
- [ ] Decide standalone depth plugin vs MisregAE integration vs both
- [ ] Add depth map layer input to one MisregAE effect as proof of concept (Halftone recommended — simplest)
- [ ] Test: Desktop app → export EXR → AE import → MisregAE Halftone with depth map driving LPI
- [ ] If workflow works, roll out to remaining 5 effects
- [ ] Evaluate standalone depth effects (fog, DoF, parallax) as separate plugin
