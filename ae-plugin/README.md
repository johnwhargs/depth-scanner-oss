# Depth Scanner — AE Automation Script

## Install
Copy `DepthScanner.jsx` to your After Effects Scripts folder:
- **macOS:** `/Applications/Adobe After Effects 2025/Scripts/`
- **Windows:** `C:\Program Files\Adobe\Adobe After Effects 2025\Support Files\Scripts\`

Or run from `File → Scripts → Run Script File...`

## Usage
1. Import your footage + depth map into a comp
2. Run the script: `File → Scripts → DepthScanner.jsx`
3. Select **Source Layer** (your footage)
4. Select **Depth Map** (grayscale depth from Depth Scanner desktop app)
5. Choose an **Effect**
6. Click **Apply**

The script auto-builds the comp structure and creates a **Controller null** with keyframeable sliders.

## Effects

| Effect | What it creates | Controller sliders |
|--------|----------------|-------------------|
| **EZ Matte** | Precomp with depth as luma matte | Depth Cutoff, Feather |
| **Depth of Field** | Camera Lens Blur + depth as blur map | Blur Radius, Focal Distance |
| **Atmospheric Fog** | Fractal Noise solid + depth matte | Fog Density |
| **Parallax / 2.5D** | Displacement Map + blurred depth | Shift X, Shift Y, Depth Blur |
| **Stereo 3D** | Left/Right eye comps + SBS viewer | Eye Separation, Convergence |
| **Depth Transition** | Gradient Wipe driven by depth | Transition, Softness |
| **Color Grade** | FG/BG split grade by depth | Depth Split, FG/BG Tint Amount |

## Tips
- Name your depth map with "depth" in the filename — the script auto-detects it
- All controller sliders are keyframeable for animated effects
- EZ Matte creates a reusable precomp you can drop into any composition
- For Parallax, keyframe Shift X/Y on the controller null for camera moves
