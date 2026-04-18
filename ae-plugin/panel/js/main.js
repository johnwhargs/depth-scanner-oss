/**
 * Depth Scanner — CEP Panel Main Script
 *
 * Communicates with host.jsx via CSInterface.evalScript().
 * Populates layer dropdowns, dispatches effect application.
 */

(function() {
    "use strict";

    var csInterface = new CSInterface();

    // ── DOM references ──────────────────────────────────────

    var ddSource   = document.getElementById("dd-source");
    var ddDepth    = document.getElementById("dd-depth");
    var ddEffect   = document.getElementById("dd-effect");
    var descArea   = document.getElementById("effect-desc");
    var btnRefresh = document.getElementById("btn-refresh");
    var btnApply   = document.getElementById("btn-apply");
    var statusArea = document.getElementById("status-log");

    // ── Effect descriptions ─────────────────────────────────

    var DESCRIPTIONS = {
        "EZ Matte":          "Depth-driven alpha matte with cutoff and feather controls.",
        "Depth of Field":    "Camera Lens Blur with 9 bokeh presets. Iris shape, roundness, anamorphic stretch controls.",
        "Atmospheric Fog":   "Fractal noise fog layered by depth. Density + color controls.",
        "Parallax / 2.5D":   "Displacement map parallax. Keyframe X/Y for camera moves.",
        "Wigglegram":        "Comb-style 3D wiggle effect. Alternates L/R eye every N frames. Separation + comb + speed controls.",
        "Stereo 3D":         "Left/right eye views for 3D. SBS viewer with separation control.",
        "3D Mesh":           "3D camera + lighting + depth displacement. Orbit, tilt, zoom. CC Environment or Displacement.",
        "Depth Transition":  "Gradient wipe through Z-space. Transition + softness sliders.",
        "Blackout":          "Rolling blackout from far to near. Stepped posterize option for grid-by-grid power cut effect.",
        "Light Wrap":        "Edge glow at depth boundaries. Find Edges + Glow on depth map. Wrap intensity + width controls.",
        "Depth Glow":        "Depth-driven glow effect. Glow by distance -- sci-fi, lightning, volumetric light. Color + threshold.",
        "Color Grade":       "Split FG/BG grade by depth. Warm foreground, cool background."
    };

    // ── Logging ─────────────────────────────────────────────

    function log(msg) {
        var now = new Date();
        var ts = ("0" + now.getHours()).slice(-2) + ":" +
                 ("0" + now.getMinutes()).slice(-2) + ":" +
                 ("0" + now.getSeconds()).slice(-2);
        statusArea.textContent = "[" + ts + "] " + msg + "\n" + statusArea.textContent;
    }

    // ── Populate dropdowns ──────────────────────────────────

    function clearDropdown(dd) {
        while (dd.firstChild) {
            dd.removeChild(dd.firstChild);
        }
    }

    function addOption(dd, text, value) {
        var opt = document.createElement("option");
        opt.textContent = text;
        opt.value = value;
        dd.appendChild(opt);
        return opt;
    }

    function refreshLayers() {
        log("Scanning layers...");
        csInterface.evalScript("getCompLayers()", function(result) {
            if (!result || result === "EvalScript Error") {
                log("Error: Could not communicate with After Effects.");
                return;
            }

            var data;
            try {
                data = JSON.parse(result);
            } catch(e) {
                log("Error parsing layer data.");
                return;
            }

            if (data.error) {
                log("AE: " + data.error);
                clearDropdown(ddSource);
                clearDropdown(ddDepth);
                addOption(ddSource, "(no comp open)", "0");
                addOption(ddDepth, "(no comp open)", "0");
                return;
            }

            var layers = data.layers;
            if (!layers || layers.length === 0) {
                log("No layers found in active comp.");
                clearDropdown(ddSource);
                clearDropdown(ddDepth);
                addOption(ddSource, "(no layers)", "0");
                addOption(ddDepth, "(no layers)", "0");
                return;
            }

            clearDropdown(ddSource);
            clearDropdown(ddDepth);

            var depthGuess = -1;

            for (var i = 0; i < layers.length; i++) {
                var layerIdx = i + 1; // AE layers are 1-based
                addOption(ddSource, layers[i], String(layerIdx));
                addOption(ddDepth, layers[i], String(layerIdx));

                // Auto-detect depth layer
                if (depthGuess < 0 && layers[i].toLowerCase().indexOf("depth") >= 0) {
                    depthGuess = i;
                }
            }

            // Set depth selection
            if (depthGuess >= 0) {
                ddDepth.selectedIndex = depthGuess;
                // Set source to first non-depth layer
                ddSource.selectedIndex = (depthGuess === 0 && layers.length > 1) ? 1 : 0;
            } else {
                ddSource.selectedIndex = 0;
                ddDepth.selectedIndex = (layers.length > 1) ? 1 : 0;
            }

            log("Found " + layers.length + " layers.");
        });
    }

    // ── Apply effect ────────────────────────────────────────

    function applyEffect() {
        var srcIdx   = ddSource.value;
        var depthIdx = ddDepth.value;
        var fxName   = ddEffect.value;

        if (srcIdx === "0" || depthIdx === "0") {
            log("Error: No valid layers selected.");
            return;
        }

        if (srcIdx === depthIdx) {
            log("Error: Source and Depth Map must be different layers.");
            return;
        }

        log("Applying: " + fxName + "...");
        btnApply.disabled = true;

        // Escape effect name for ExtendScript string
        var escapedName = fxName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        var script = 'applyEffect(' + srcIdx + ', ' + depthIdx + ', "' + escapedName + '")';

        csInterface.evalScript(script, function(result) {
            btnApply.disabled = false;

            if (!result || result === "EvalScript Error") {
                log("Error: Script execution failed.");
                return;
            }

            var data;
            try {
                data = JSON.parse(result);
            } catch(e) {
                log("Error parsing result.");
                return;
            }

            if (data.error) {
                log("Error: " + data.error);
            } else if (data.success) {
                log("Applied: " + data.effect);
                // Refresh layers since effects may have added new ones
                refreshLayers();
            }
        });
    }

    // ── Effect description update ───────────────────────────

    function updateDescription() {
        var fxName = ddEffect.value;
        descArea.textContent = DESCRIPTIONS[fxName] || "";
    }

    // ── Polling for comp changes ────────────────────────────

    var lastLayerCount = -1;

    function pollCompChanges() {
        csInterface.evalScript("getCompLayers()", function(result) {
            if (!result || result === "EvalScript Error") return;
            try {
                var data = JSON.parse(result);
                if (data.layers) {
                    var count = data.layers.length;
                    if (lastLayerCount >= 0 && count !== lastLayerCount) {
                        refreshLayers();
                    }
                    lastLayerCount = count;
                } else {
                    lastLayerCount = -1;
                }
            } catch(e) {}
        });
    }

    // ── Init ────────────────────────────────────────────────

    function init() {
        // Wire up events
        btnRefresh.addEventListener("click", refreshLayers);
        btnApply.addEventListener("click", applyEffect);
        ddEffect.addEventListener("change", updateDescription);

        // Set initial description
        updateDescription();

        // Initial layer scan
        refreshLayers();

        // Poll for comp changes every 3 seconds
        setInterval(pollCompChanges, 3000);

        log("Depth Scanner ready.");
    }

    // Wait for DOM
    if (document.readyState === "complete" || document.readyState === "interactive") {
        init();
    } else {
        document.addEventListener("DOMContentLoaded", init);
    }

})();
