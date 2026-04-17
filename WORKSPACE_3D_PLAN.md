# 3D Workspace — Plan

## Architecture

Two-page app:

### Page 1: Depth Map Renderer (current)
- Open image/video
- Process depth map
- 2D effects only: DoF (kernel-based), Grade, Slice, Fog
- Save depth map
- **"Open in 3D Workspace →"** button (sends source + depth to page 2)

### Page 2: 3D Workspace (WebGL)
- Source image/video + depth map as inputs
- WebGL canvas for real-time 3D rendering
- **Back to Renderer** button
- All effects that need 3D/spatial computation

---

## 3D Workspace Features

### Parallax Viewer
- Depth displacement in WebGL — real-time as you move mouse/slider
- Orbit, pan, zoom controls
- Depth exaggeration slider

### Wigglegram Generator
- **Views**: 3–7 slider (how many eye positions)
- **Separation**: eye distance in px
- **Speed/FPS**: playback speed
- **Loop count**: how many cycles
- **Path**: linear / arc / orbit
- **Comb frames**: frames per eye (3 = classic Nishika, 1 = fast flicker)
- **Time estimation**: shows before render based on resolution × views × loop count
- **Export**: GIF / MP4 / image sequence
- **Video wigglegram**: for video input, interleave left/right eye at N-frame intervals ("comb" method from tutorial)

### Video Wigglegram (Comb Method)
From the tutorial research:
1. Generate left + right eye displacement from depth
2. Stack as two video tracks
3. "Comb" cut: switch every N frames (typically 3)
4. Align on focal point (convergence control)
5. Export as single video with built-in 3D wiggle

```
Frame:  1  2  3  4  5  6  7  8  9  ...
Eye:    L  L  L  R  R  R  L  L  L  ...
```

### Spatial Photo/Video
- Side-by-side stereo preview
- Anaglyph preview (red/cyan in WebGL)
- Eye separation + convergence
- Export SBS PNG / MV-HEVC spatial video

### Bokeh (proper WebGL implementation)
- Per-pixel spatially-varying kernels in fragment shader
- Petzval swirl: radial tangential blur varying with distance from center
- Cat-eye: aperture shape varies with position (vignetting simulation)
- Anamorphic: oval kernel + horizontal streak on highlights
- All other shapes from the kernel list work in WebGL too

### Depth Fog (3D)
- Volumetric fog with noise in 3D space
- Light scattering approximation
- God rays through depth

---

## WebGL Implementation

### Tech Stack
- Raw WebGL2 (no Three.js — keep it light)
- Fragment shaders for per-pixel effects
- Two textures bound: source image + depth map
- Uniforms for all slider values
- requestAnimationFrame loop for real-time preview

### Shader Structure
```glsl
uniform sampler2D u_source;
uniform sampler2D u_depth;
uniform float u_focalDepth;
uniform float u_separation;
uniform int u_bokehShape;
// ... all effect params as uniforms

void main() {
    vec2 uv = v_texCoord;
    float depth = texture2D(u_depth, uv).r;
    vec4 color = texture2D(u_source, uv);
    
    // Apply effect based on depth
    // ...
    
    gl_FragColor = color;
}
```

### Data Flow
```
[Source Image] ──→ WebGL Texture 0
[Depth Map]   ──→ WebGL Texture 1
[Sliders]     ──→ Uniforms
                    ↓
              Fragment Shader
                    ↓
              Canvas Output (real-time)
```

---

## Video Wigglegram Pipeline

### For pre-recorded video:
1. User loads video in Depth Renderer (page 1)
2. Processes depth map for all frames
3. Opens 3D Workspace (page 2) with source video + depth video
4. Sets wigglegram params: separation, comb frames, convergence
5. Preview plays in real-time (WebGL displaces per-frame)
6. Export renders the comb-interleaved video

### Frame generation:
```python
# For each output frame:
frame_idx = output_frame_number
comb_cycle = comb_frames * 2  # L-L-L-R-R-R = 6 frames per cycle
position_in_cycle = frame_idx % comb_cycle

if position_in_cycle < comb_frames:
    # Left eye
    shift = -separation / 2
else:
    # Right eye  
    shift = +separation / 2

# Displace source frame using depth * shift
displaced = remap(source[frame_idx], depth[frame_idx], shift)
```

---

## UI Layout — 3D Workspace

```
┌──────────────────────────────────────────────┐
│  ← Back to Renderer    3D WORKSPACE          │
├──────┬───────────────────────────────────────┤
│Effect│                                       │
│ ○ Parallax                                   │
│ ○ Wiggle  │   [WebGL Canvas — real-time]     │
│ ○ Spatial │                                  │
│ ○ Bokeh   │                                  │
│ ○ Fog 3D  │                                  │
├──────┤                                       │
│Params│                                       │
│[sliders]  ├───────────────────────────────────┤
│           │  [Timeline with comb preview]     │
│[Export]   │  L L L R R R L L L R R R          │
│[est.time] │                                   │
└──────┴───────────────────────────────────────┘
```

---

## Input Methods

### From Depth Renderer
- "Open in 3D Workspace" button passes source + depth via:
  - Session ID (server has both cached)
  - Or base64 data URLs for small images

### Direct Load in 3D Workspace
- "Load Source" + "Load Depth Map" file inputs
- Accepts PNG/EXR depth maps from any source (not just Depth Scanner)
- Video: loads source MP4 + depth MP4 (frame-synced)

---

## Estimation Formula (Wigglegram)

```
render_time = num_views × resolution_factor × loop_count × frames_per_view
            ≈ views × (width × height / 2M) × loops × 0.1s

Example: 5 views × (1920×1080 / 2M) × 3 loops × 0.1s ≈ 1.5s for GIF
Example: 5 views × (3840×2160 / 2M) × 1 loop × 0.1s ≈ 2s for single loop
```

For video wigglegram:
```
render_time = total_frames × 2 × displacement_time_per_frame
            ≈ frames × 2 × 0.05s (WebGL is fast)
            
763 frames × 2 eyes × 0.05s ≈ 76s for 4K video wigglegram
```
