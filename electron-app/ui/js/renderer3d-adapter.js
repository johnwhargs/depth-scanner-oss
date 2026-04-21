/**
 * renderer3d-adapter.js — Wires DOM sliders/presets/drag to Renderer3D
 * Call R3DAdapter.init(elevCanvas, stateObj) after DOM ready.
 * Depends on: renderer3d.js (Renderer3D), DS or $ function
 */
window.R3DAdapter = (function() {
  'use strict';

  var $ = typeof DS !== 'undefined' ? DS.$ : function(id) { return document.getElementById(id); };
  var _canvas = null;
  var _state = null;
  var panX = 0, panY = 0;
  var _logFn = typeof DS !== 'undefined' ? DS.logMsg : (window.log || console.log);
  var _saveFn = typeof DS !== 'undefined' ? DS.saveBlob : window.saveBlob;
  var _SERVER = typeof DS !== 'undefined' ? DS.SERVER : (window.SERVER || 'http://127.0.0.1:7843');

  // ── Glow presets ──
  var glowPresets = {
    "cyber":      { near: "#00ff88", far: "#0044ff", bg: "#0a0a14", glow: 0.8, bloom: 1.5 },
    "neon-pink":  { near: "#ff00ff", far: "#ff6ec7", bg: "#0d0015", glow: 0.9, bloom: 2.0 },
    "vaporwave":  { near: "#ff71ce", far: "#01cdfe", bg: "#120025", glow: 0.7, bloom: 1.8 },
    "matrix":     { near: "#00ff41", far: "#008f11", bg: "#000000", glow: 0.6, bloom: 1.2 },
    "fire":       { near: "#ffff00", far: "#ff2200", bg: "#0a0000", glow: 0.8, bloom: 2.2 },
    "ice":        { near: "#ffffff", far: "#00b4d8", bg: "#001220", glow: 0.7, bloom: 1.6 },
    "gold":       { near: "#ffd700", far: "#b8860b", bg: "#0a0800", glow: 0.9, bloom: 1.8 },
    "sunset":     { near: "#ff6b35", far: "#9b2335", bg: "#0a0510", glow: 0.7, bloom: 1.5 },
    "ocean":      { near: "#00ffff", far: "#000080", bg: "#000510", glow: 0.8, bloom: 1.4 },
    "toxic":      { near: "#39ff14", far: "#ccff00", bg: "#050a00", glow: 1.0, bloom: 2.5 },
    "plasma":     { near: "#ff00ff", far: "#0000ff", bg: "#050005", glow: 0.9, bloom: 2.0 },
    "hologram":   { near: "#00ffff", far: "#ff00ff", bg: "#000008", glow: 0.8, bloom: 2.2 },
    "midnight":   { near: "#4169e1", far: "#191970", bg: "#000005", glow: 0.5, bloom: 1.0 },
    "lava":       { near: "#ff4500", far: "#8b0000", bg: "#0a0000", glow: 1.0, bloom: 2.8 },
    "aurora":     { near: "#00ff88", far: "#8b00ff", bg: "#000a10", glow: 0.7, bloom: 1.6 }
  };

  // ── Camera presets ──
  var camPresets = {
    "default": { rx: -35, ry: 15, zoom: 1.2 },
    "iso":     { rx: -35, ry: 45, zoom: 1.2 },
    "top":     { rx: -90, ry: 0, zoom: 1.0 },
    "front":   { rx: 0, ry: 0, zoom: 1.2 },
    "side":    { rx: 0, ry: 90, zoom: 1.2 },
    "close":   { rx: -60, ry: 30, zoom: 1.5 },
    "rear":    { rx: -20, ry: 160, zoom: 1.0 },
    "wide":    { rx: -70, ry: -45, zoom: 0.8 }
  };

  // ── Hologram style presets ──
  var holoStyles = {
    "gits":       { c1: "#00ff88", c2: "#003322", mid: "#00aa55", bg: "#000505" },
    "akira":      { c1: "#ff6600", c2: "#441100", mid: "#cc3300", bg: "#050000", gridType: "polygon", scanSpeed: 0.8 },
    "eva":        { c1: "#9933ff", c2: "#220066", mid: "#6622cc", bg: "#050008", gridType: "hex", dither: true, ditherStyle: "bayer4" },
    "blade":      { c1: "#00ccff", c2: "#003366", mid: "#006699", bg: "#000510", scanSpeed: 0.3, scanDir: -1, gap: 15 },
    "nerv":       { c1: "#ff0066", c2: "#330015", mid: "#990033", bg: "#050005", gridType: "cross", scanSpeed: 1.0 },
    "tron":       { c1: "#00dfff", c2: "#004466", mid: "#0088cc", bg: "#000008", gridType: "square", gap: 10 },
    "robocop":    { c1: "#00ff44", c2: "#004411", mid: "#00aa22", bg: "#000800", splitElev: true, srcElev: 0, gridElev: 0.15, scanSpeed: 1.5, scanDensity: 4, gap: 20, dither: false, ditherStyle: "none", gridType: "square" },
    "predator":   { c1: "#ffff00", c2: "#ff0000", mid: "#ff8800", bg: "#000400", srcTint: 0.6, srcColor: "#ff4400", dither: true, ditherStyle: "noise", gridType: "dot", scanSpeed: 0.2, gap: -30 },
    "ironman":    { c1: "#00ccff", c2: "#ff8800", mid: "#44aaff", bg: "#040810", splitElev: true, srcElev: 0.05, gridElev: 0.25, gridType: "hex", scanSpeed: 2.0, scanDensity: 3, gap: 30, dither: false, ditherStyle: "none" },
    "matrix":     { c1: "#00ff00", c2: "#003300", mid: "#008800", bg: "#000200", gridType: "dotmatrix", scanSpeed: 2.5, scanDir: 1, dither: true, ditherStyle: "bayer4", gap: 5 },
    "terminator": { c1: "#ff0000", c2: "#440000", mid: "#cc0000", bg: "#080000", splitElev: true, srcElev: 0, gridElev: 0.1, srcTint: 0.4, srcColor: "#ff2200", gridType: "cross", scanSpeed: 0.5, dither: false, ditherStyle: "none" },
    "alien":      { c1: "#33ff66", c2: "#003310", mid: "#118833", bg: "#000800", gridType: "square", scanSpeed: 0.4, scanDensity: 6, dither: true, ditherStyle: "halftone", gap: 0 },
    "minority":   { c1: "#aaccff", c2: "#002244", mid: "#4488cc", bg: "#000208", splitElev: true, srcElev: 0.08, gridElev: 0.2, gridType: "polygon", srcTint: 0.3, srcColor: "#88bbff", scanSpeed: 0.6, scanDir: -1, gap: 25 },
    "cyberpunk":  { c1: "#ff00ff", c2: "#00ffff", mid: "#ff44aa", bg: "#080010", gridType: "polygon", scanSpeed: 1.8, dither: true, ditherStyle: "crosshatch", gap: -10 },
    "westworld":  { c1: "#ffffff", c2: "#444444", mid: "#999999", bg: "#0a0a0a", gridType: "polygon", dither: false, ditherStyle: "none", scanSpeed: 0.1, gap: 0, srcTint: 0.15, srcColor: "#ffffff" },
    "prometheus": { c1: "#4488ff", c2: "#001133", mid: "#2266cc", bg: "#000108", splitElev: true, srcElev: 0, gridElev: 0.3, gridType: "dot", scanSpeed: 1.2, scanDir: -1, gap: 40, dither: false, ditherStyle: "none" }
  };

  // ── Gradient map presets ──
  var holoGradPresets = {
    none: null, matrix: ["#001100","#003300","#00ff44"], infrared: ["#000040","#ff0040","#ffff00"],
    ocean: ["#000820","#0044aa","#00ffcc"], fire: ["#100000","#ff4400","#ffee00"],
    neon: ["#ff00ff","#00ffff","#ffff00"], thermal: ["#000040","#ff0000","#ffff00"],
    midnight: ["#0a0020","#2244aa","#88aaff"]
  };

  // ── Read all params from DOM → push to Renderer3D ──
  function syncAll() {
    if (!Renderer3D.isVisible()) return;
    var isHolo = _isHoloActive();

    // Ensure correct mode + material swap
    Renderer3D.setHoloMode(isHolo);

    Renderer3D.setElevation(parseFloat($("elev-height")?.value || "0.3"));
    Renderer3D.setDensity(parseInt($("elev-density")?.value || "40"));
    Renderer3D.setGridType(isHolo ? ($("holo-grid-type")?.value || "square") : ($("elev-grid-type")?.value || "square"));
    Renderer3D.setGlow(parseFloat($("elev-glow")?.value || "0.8"));

    var bloom = parseFloat($("elev-bloom")?.value || "1.5");
    Renderer3D.setBloom(bloom > 0 ? bloom * 0.5 : 0, 0.4, 0.85);

    // Camera from sliders
    Renderer3D.setCamera(
      parseFloat($("elev-rx")?.value || "-35"),
      parseFloat($("elev-ry")?.value || "15"),
      parseFloat($("elev-rz")?.value || "0"),
      parseFloat($("elev-zoom")?.value || "1.2")
    );

    // Scan lines
    Renderer3D.setScanLines({
      enabled: isHolo ? !!$("holo-scanlines")?.checked : !!$("elev-scanlines")?.checked,
      density: isHolo ? parseFloat($("holo-scan-density")?.value || "3") : 3.0,
      opacity: isHolo ? parseFloat($("holo-scan-opacity")?.value || "0.5") : parseFloat($("elev-scan-opacity")?.value || "0.3"),
      speed: isHolo ? parseFloat($("holo-scan-speed")?.value || "0.5") : parseFloat($("elev-scan-speed")?.value || "0.5"),
      dir: isHolo ? parseFloat($("holo-scan-dir")?.value || "1") : parseFloat($("elev-scan-dir")?.value || "1")
    });

    // Colors
    if (isHolo) {
      Renderer3D.setColors(
        $("holo-color1")?.value || "#00ff88",
        $("holo-color-mid")?.value || "#00aa55",
        $("holo-color2")?.value || "#003322",
        $("holo-bg")?.value || "#000505"
      );
      var ditherStyle = $("holo-dither-style")?.value || "none";
      Renderer3D.setDither({ enabled: ditherStyle !== "none", style: ditherStyle });
      Renderer3D.setSrcTint($("holo-src-color")?.value || "#ffffff", parseFloat($("holo-src-tint")?.value || "0"));
      Renderer3D.setLayerVisible('grid', !!$("holo-grid")?.checked);
    } else {
      var midColor = _mixColors($("elev-grid-color")?.value || "#00ff88", $("elev-grid-color2")?.value || "#0044ff");
      Renderer3D.setColors(
        $("elev-grid-color")?.value || "#00ff88",
        midColor,
        $("elev-grid-color2")?.value || "#0044ff",
        $("elev-bg-color")?.value || "#0a0a14"
      );
      Renderer3D.setLayerVisible('grid', !!$("elev-grid")?.checked);
      Renderer3D.setLayerVisible('source', !!$("elev-image")?.checked);
    }

    // Gap
    Renderer3D.setGap(isHolo ? parseFloat($("holo-gap")?.value || "0") : parseFloat($("elev-gap")?.value || "0"));

    // Split elevation
    var splitElev = isHolo && !!$("holo-split-elev")?.checked;
    if (splitElev) {
      Renderer3D.setSplitElevation(
        parseFloat($("holo-src-elev")?.value || "0"),
        parseFloat($("holo-grid-elev")?.value || "0.3")
      );
    } else {
      Renderer3D.clearSplitElevation();
    }

    Renderer3D.render();
  }

  function _isHoloActive() {
    var tab = document.querySelector(".fx-tab.active");
    return tab && tab.dataset && tab.dataset.fx === "hologram";
  }

  function _mixColors(hex1, hex2) {
    function p(h) { h = h.replace("#",""); return [parseInt(h.substr(0,2),16), parseInt(h.substr(2,2),16), parseInt(h.substr(4,2),16)]; }
    var a = p(hex1), b = p(hex2);
    return "#" + [0,1,2].map(function(i) { return Math.round((a[i]+b[i])/2).toString(16).padStart(2,"0"); }).join("");
  }

  // ── Show/hide elevation canvas ──
  function showElevCanvas(asHolo) {
    console.log('[R3DAdapter] showElevCanvas holo=' + asHolo + ' videoFxActive=' + (typeof VideoFX !== 'undefined' && VideoFX.isActive()));
    var depthBlob = _state._latestDepthBlob || _state.depthBlob || _state.depthFile;
    var srcBlob = _state._latestSrcBlob || _state.currentBlob || _state.sourceFile || _state.currentFile;
    if (!depthBlob) return;

    // Already visible — just switch mode and re-sync
    if (Renderer3D.isVisible()) {
      Renderer3D.setHoloMode(!!asHolo);
      syncAll();
      return;
    }

    // First show — init, load textures, start loop
    Renderer3D.init(_canvas, { width: 1200, height: 800 });
    Renderer3D._buildMesh(parseInt($("elev-density")?.value || "40"), $("elev-grid-type")?.value || "square");
    Renderer3D.setHoloMode(!!asHolo);

    var smoothing = parseInt($("elev-smooth")?.value || "3");
    Renderer3D.reload(depthBlob, srcBlob, smoothing, function() {
      syncAll();
      Renderer3D.startLoop();
    });

    // Show canvas, hide preview
    _canvas.style.display = "block";
    var prevImg = $("preview-img"); if (prevImg) prevImg.style.display = "none";
    var compCv = $("compare-canvas"); if (compCv) compCv.style.display = "none";
    var placeholder = $("canvasPlaceholder"); if (placeholder) placeholder.style.display = "none";
    var gizmo = $("gizmo-canvas"); if (gizmo) gizmo.style.display = "";
  }

  function hideElevCanvas() {
    Renderer3D.hide();
    _canvas.style.display = "none";
    var prevImg = $("preview-img"); if (prevImg) prevImg.style.display = "";
    var gizmo = $("gizmo-canvas"); if (gizmo) gizmo.style.display = "none";
  }

  // ── Blender-style controls ──
  // LMB drag = orbit, MMB drag = pan, Shift+LMB = pan, Scroll = zoom
  function setupDrag() {
    var mode = null; // 'orbit' | 'pan'
    var startX = 0, startY = 0, startRX = 0, startRY = 0;
    var startPanX = 0, startPanY = 0;

    _canvas.addEventListener("mousedown", function(e) {
      e.preventDefault();
      startX = e.clientX; startY = e.clientY;
      var cam = Renderer3D.getCamera();
      startRX = cam.rx; startRY = cam.ry;
      startPanX = panX; startPanY = panY;

      // MMB or Shift+LMB = pan
      if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
        mode = 'pan';
        _canvas.style.cursor = "move";
      } else if (e.button === 0) {
        mode = 'orbit';
        _canvas.style.cursor = "grabbing";
      }
    });

    window.addEventListener("mousemove", function(e) {
      if (!mode) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;

      if (mode === 'orbit') {
        var newRY = startRY + dx * 0.5;
        // Wrap Y rotation instead of clamping
        while (newRY > 180) newRY -= 360;
        while (newRY < -180) newRY += 360;
        var newRX = Math.max(-90, Math.min(90, startRX + dy * 0.3));
        var cam = Renderer3D.getCamera();
        Renderer3D.setCamera(newRX, newRY, cam.rz, cam.zoom);
        _syncCameraToDOM(newRX, newRY, cam.rz, cam.zoom);
      } else if (mode === 'pan') {
        // Pan moves the scene target (translates all layers)
        panX = startPanX + dx * 0.003;
        panY = startPanY - dy * 0.003;
        _applyPan();
      }
    });

    window.addEventListener("mouseup", function() {
      if (mode) { mode = null; _canvas.style.cursor = "grab"; }
    });

    // Scroll = zoom (smooth)
    _canvas.addEventListener("wheel", function(e) {
      e.preventDefault();
      var cam = Renderer3D.getCamera();
      var zoomSpeed = 0.1 * (cam.zoom / 1.2); // proportional zoom
      var newZ = Math.max(0.3, Math.min(5, cam.zoom + (e.deltaY > 0 ? -zoomSpeed : zoomSpeed)));
      Renderer3D.setCamera(cam.rx, cam.ry, cam.rz, newZ);
      if ($("elev-zoom")) { $("elev-zoom").value = newZ; $("elev-zoom-v").textContent = newZ.toFixed(2); }
      if ($("holo-zoom")) { $("holo-zoom").value = newZ; }
    }, { passive: false });

    // Prevent context menu on canvas
    _canvas.addEventListener("contextmenu", function(e) { e.preventDefault(); });
  }

  function _applyPan() {
    Renderer3D.setPan(panX, panY);
  }

  // ── Slider listeners ──
  function setupSliderListeners() {
    var syncDebounce = null;
    function debouncedSync() { clearTimeout(syncDebounce); syncDebounce = setTimeout(syncAll, 30); }

    // Elevation sliders
    ["elev-height","elev-density","elev-linewidth","elev-glow","elev-grid-color","elev-grid-color2",
     "elev-bg-color","elev-scan-opacity","elev-scan-speed","elev-gap","elev-bloom","elev-smooth",
     "elev-rz","elev-rx","elev-ry","elev-zoom"].forEach(function(id) {
      var el = $(id); if (el) el.addEventListener("input", debouncedSync);
    });
    ["elev-grid","elev-image","elev-scanlines","elev-grid-type","elev-scan-dir"].forEach(function(id) {
      var el = $(id); if (el) el.addEventListener("change", debouncedSync);
    });

    // Hologram sliders
    ["holo-color1","holo-color2","holo-bg","holo-color-mid","holo-src-color","holo-src-tint",
     "holo-scan-density","holo-scan-opacity","holo-scan-speed","holo-gap","holo-smooth",
     "holo-elev-height","holo-rx","holo-ry","holo-rz","holo-zoom","holo-density",
     "holo-linewidth","holo-glow","holo-bloom2","holo-src-elev","holo-grid-elev"].forEach(function(id) {
      var el = $(id); if (el) el.addEventListener("input", debouncedSync);
    });
    ["holo-scanlines","holo-dither","holo-grid","holo-grid-type","holo-scan-dir",
     "holo-dither-style","holo-split-elev"].forEach(function(id) {
      var el = $(id); if (el) el.addEventListener("change", debouncedSync);
    });

    // Plus/minus buttons
    document.querySelectorAll(".pm-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var target = $(btn.dataset.target); if (!target) return;
        var step = parseFloat(btn.dataset.step);
        var min = parseFloat(target.min), max = parseFloat(target.max);
        var val = Math.max(min, Math.min(max, parseFloat(target.value) + step));
        target.value = val; target.dispatchEvent(new Event("input"));
      });
    });
  }

  // ── Preset handlers ──
  function setupPresets() {
    // Glow presets
    var gp = $("elev-glow-preset");
    if (gp) gp.addEventListener("change", function() {
      var p = glowPresets[this.value]; if (!p) return;
      $("elev-grid-color").value = p.near; $("elev-grid-color2").value = p.far; $("elev-bg-color").value = p.bg;
      $("elev-glow").value = p.glow; $("elev-glow-v").textContent = p.glow.toFixed(2);
      $("elev-bloom").value = p.bloom; $("elev-bloom-v").textContent = p.bloom.toFixed(1);
      syncAll();
    });

    // Custom color → clear preset
    ["elev-grid-color","elev-grid-color2","elev-bg-color"].forEach(function(id) {
      var el = $(id); if (el) el.addEventListener("input", function() { if ($("elev-glow-preset")) $("elev-glow-preset").value = ""; });
    });

    // Camera presets
    ["elev-cam-preset","holo-cam-preset"].forEach(function(id) {
      var el = $(id); if (el) el.addEventListener("change", function() {
        var p = camPresets[this.value]; if (!p) return;
        Renderer3D.stopAnimation();
        Renderer3D.setCamera(p.rx, p.ry, p.rz || 0, p.zoom);
        _syncCameraToDOM(p.rx, p.ry, p.rz || 0, p.zoom);
        if (!Renderer3D.isVisible()) {
          showElevCanvas(_isHoloActive());
        } else {
          Renderer3D.render();
        }
      });
    });

    // Hologram style presets
    var hs = $("holo-style");
    if (hs) hs.addEventListener("change", function() {
      var s = holoStyles[this.value]; if (!s) return;
      $("holo-color1").value = s.c1; $("holo-color2").value = s.c2; $("holo-bg").value = s.bg;
      if (s.mid) $("holo-color-mid").value = s.mid;
      if (s.splitElev) {
        $("holo-split-elev").checked = true;
        if ($("holo-split-controls")) $("holo-split-controls").style.display = "";
        $("holo-src-elev").value = s.srcElev; $("holo-src-elev-v").textContent = s.srcElev.toFixed(2);
        $("holo-grid-elev").value = s.gridElev; $("holo-grid-elev-v").textContent = s.gridElev.toFixed(2);
      } else {
        $("holo-split-elev").checked = false;
        if ($("holo-split-controls")) $("holo-split-controls").style.display = "none";
      }
      if (s.dither !== undefined) $("holo-dither").checked = s.dither;
      if (s.ditherStyle) $("holo-dither-style").value = s.ditherStyle;
      if (s.scanSpeed !== undefined) { $("holo-scan-speed").value = s.scanSpeed; $("holo-scan-speed-v").textContent = s.scanSpeed.toFixed(1); }
      if (s.scanDensity !== undefined) { $("holo-scan-density").value = s.scanDensity; $("holo-scan-density-v").textContent = s.scanDensity + "px"; }
      if (s.scanDir !== undefined && $("holo-scan-dir")) $("holo-scan-dir").value = s.scanDir;
      if (s.gap !== undefined) { $("holo-gap").value = s.gap; $("holo-gap-v").textContent = s.gap; }
      if (s.gridType && $("holo-grid-type")) $("holo-grid-type").value = s.gridType;
      if (s.srcTint !== undefined) { $("holo-src-tint").value = s.srcTint; $("holo-src-tint-v").textContent = s.srcTint.toFixed(2); }
      if (s.srcColor) $("holo-src-color").value = s.srcColor;
      _drawHoloGradmap();
      syncAll();
    });

    // Custom holo color → set style to custom
    ["holo-color1","holo-color2","holo-bg","holo-color-mid","holo-src-color"].forEach(function(id) {
      var el = $(id); if (el) el.addEventListener("input", function() { if ($("holo-style")) $("holo-style").value = "custom"; });
    });

    // Gradient map presets
    var gmp = $("holo-gradmap-preset");
    if (gmp) gmp.addEventListener("change", function() {
      var p = holoGradPresets[this.value]; if (!p) return;
      $("holo-color2").value = p[0]; $("holo-color-mid").value = p[1]; $("holo-color1").value = p[2];
      _drawHoloGradmap();
      if ($("holo-style")) $("holo-style").value = "custom";
      syncAll();
    });

    // Split elevation toggle
    var se = $("holo-split-elev");
    if (se) se.addEventListener("change", function() {
      if ($("holo-split-controls")) $("holo-split-controls").style.display = this.checked ? "" : "none";
      syncAll();
    });

    // Draw gradient map preview
    ["holo-color1","holo-color2","holo-color-mid"].forEach(function(id) {
      var el = $(id); if (el) el.addEventListener("input", _drawHoloGradmap);
    });
    _drawHoloGradmap();
  }

  function _drawHoloGradmap() {
    var cv = $("holo-gradmap"); if (!cv) return;
    var ctx = cv.getContext("2d");
    var c1 = $("holo-color2")?.value || "#003322";
    var c2 = $("holo-color-mid")?.value || "#00aa55";
    var c3 = $("holo-color1")?.value || "#00ff88";
    var g = ctx.createLinearGradient(0, 0, cv.width, 0);
    g.addColorStop(0, c1); g.addColorStop(0.5, c2); g.addColorStop(1, c3);
    ctx.fillStyle = g; ctx.fillRect(0, 0, cv.width, cv.height);
  }

  function _syncCameraToDOM(rx, ry, rz, zm) {
    if ($("elev-rx")) { $("elev-rx").value = rx; $("elev-rx-v").textContent = Math.round(rx) + "\u00B0"; }
    if ($("elev-ry")) { $("elev-ry").value = ry; $("elev-ry-v").textContent = Math.round(ry) + "\u00B0"; }
    if ($("elev-rz")) { $("elev-rz").value = rz; $("elev-rz-v").textContent = Math.round(rz) + "\u00B0"; }
    if ($("elev-zoom")) { $("elev-zoom").value = zm; $("elev-zoom-v").textContent = zm.toFixed(2); }
    if ($("holo-rx")) { $("holo-rx").value = rx; $("holo-rx-v").textContent = Math.round(rx) + "\u00B0"; }
    if ($("holo-ry")) { $("holo-ry").value = ry; $("holo-ry-v").textContent = Math.round(ry) + "\u00B0"; }
    if ($("holo-rz")) { $("holo-rz").value = rz; $("holo-rz-v").textContent = Math.round(rz) + "\u00B0"; }
    if ($("holo-zoom")) { $("holo-zoom").value = zm; }
  }

  // ── Animation controls ──
  function setupAnimations() {
    ["elev-anim-select","holo-anim-select"].forEach(function(id) {
      var el = $(id); if (el) el.addEventListener("change", function() {
        // Sync both selects
        if ($("elev-anim-select")) $("elev-anim-select").value = this.value;
        if ($("holo-anim-select")) $("holo-anim-select").value = this.value;
        if (this.value) {
          var speed = parseFloat($("elev-anim-speed")?.value || $("holo-anim-speed")?.value || "1");
          var dir = parseInt($("elev-anim-dir")?.value || $("holo-anim-dir")?.value || "1");
          Renderer3D.startAnimation(this.value, speed, dir);
        } else {
          Renderer3D.stopAnimation();
        }
      });
    });

    // Speed sync
    ["elev-anim-speed","holo-anim-speed"].forEach(function(id) {
      var el = $(id); if (el) el.addEventListener("input", function() {
        if ($("elev-anim-speed")) $("elev-anim-speed").value = this.value;
        if ($("holo-anim-speed")) $("holo-anim-speed").value = this.value;
        if ($("elev-anim-speed-v")) $("elev-anim-speed-v").textContent = parseFloat(this.value).toFixed(1) + "\u00D7";
        if ($("holo-anim-speed-v")) $("holo-anim-speed-v").textContent = parseFloat(this.value).toFixed(1) + "\u00D7";
        Renderer3D.setAnimationSpeed(parseFloat(this.value));
      });
    });

    // Direction sync
    ["elev-anim-dir","holo-anim-dir"].forEach(function(id) {
      var el = $(id); if (el) el.addEventListener("change", function() {
        if ($("elev-anim-dir")) $("elev-anim-dir").value = this.value;
        if ($("holo-anim-dir")) $("holo-anim-dir").value = this.value;
        Renderer3D.setAnimationDirection(parseInt(this.value));
      });
    });
  }

  // ── Export ──
  function setupExport() {
    ["elev-export-gif","holo-export-gif"].forEach(function(id) {
      var el = $(id); if (el) el.addEventListener("click", function() { exportAnim("gif"); });
    });
    ["elev-export-mp4","holo-export-mp4"].forEach(function(id) {
      var el = $(id); if (el) el.addEventListener("click", function() { exportAnim("mp4"); });
    });
  }

  function exportAnim(format) {
    var type = $("elev-anim-select")?.value || $("holo-anim-select")?.value;
    if (!type) { _logFn("Select an animation first", "warn"); return; }
    _logFn("Capturing animation frames...", "info");
    Renderer3D.captureAnimation(type, 24, 3).then(function(frames) {
      _logFn("Encoding " + frames.length + " frames as " + format + "...", "info");
      var fd = new FormData();
      for (var i = 0; i < frames.length; i++) fd.append("frames", frames[i], "frame_" + String(i).padStart(4, "0") + ".png");
      fd.append("fps", "24"); fd.append("format", format); fd.append("loop", "true");
      fetch(_SERVER + "/animate/export", { method: "POST", body: fd }).then(function(r) {
        if (!r.ok) throw new Error("Export failed: " + r.status);
        return r.blob();
      }).then(function(blob) {
        var ext = format === "gif" ? ".gif" : ".mp4";
        var name = (_state.currentFile?.name || _state.sourceFile?.name || "animation").replace(/\.[^.]+$/, "") + "_3d" + ext;
        _saveFn(blob, name);
        _logFn("Animation saved: " + name, "ok");
      }).catch(function(e) { _logFn("Export error: " + e.message, "err"); });
    });
  }

  // ── Public API ──
  function init(elevCanvas, stateObj) {
    _canvas = elevCanvas;
    _state = stateObj;
    // Resolve $ for index.html (uses global $)
    if (typeof DS === 'undefined' && typeof window.$ === 'function') $ = window.$;

    setupDrag();
    setupSliderListeners();
    setupPresets();
    setupAnimations();
    setupExport();

    // Wire _elevRenderer backward compat
    window._elevRenderer = {
      show: function(asHolo) { showElevCanvas(asHolo); },
      hide: function() { hideElevCanvas(); },
      render: function() { Renderer3D.render(); },
      reload: function(cb) {
        var depthBlob = _state._latestDepthBlob || _state.depthBlob || _state.depthFile;
        var srcBlob = _state._latestSrcBlob || _state.currentBlob || _state.sourceFile || _state.currentFile;
        var smoothing = parseInt($("elev-smooth")?.value || "3");
        Renderer3D.reload(depthBlob, srcBlob, smoothing, function() { syncAll(); if (cb) cb(); });
      },
      getCanvas: function() { return _canvas; },
      setHoloMode: function(v) { Renderer3D.setHoloMode(v); }
    };

    window._elevExport = exportAnim;

    console.log("[R3D] Adapter initialized — all listeners wired");
  }

  return {
    init: init,
    syncAll: syncAll,
    showElevCanvas: showElevCanvas,
    hideElevCanvas: hideElevCanvas
  };
})();
