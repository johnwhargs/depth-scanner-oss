/**
 * Effects Workspace — workspace.js
 * Depends on: common.js (DS namespace)
 */
(function() {
  'use strict';

  var $ = DS.$;
  var on = DS.on;
  var logMsg = DS.logMsg;
  var SERVER = DS.SERVER;

  // ── State ──────────────────────────────────────────────
  var state = {
    sourceFile: null,
    depthFile: null,
    sourceImg: null,
    depthImg: null,
    sessionId: null,
    activeFx: 'parallax',
    logLines: 0
  };

  // ── Canvas ─────────────────────────────────────────────
  var canvas = $('previewCanvas');
  var ctx = canvas.getContext('2d');

  function sizeCanvas() {
    var container = $('canvasContainer');
    var cw = container.clientWidth;
    var ch = container.clientHeight;
    if (cw < 10) cw = window.innerWidth - 320;
    if (ch < 10) ch = window.innerHeight - 200;
    if (state.sourceImg) {
      var iw = state.sourceImg.naturalWidth;
      var ih = state.sourceImg.naturalHeight;
      var scale = Math.min(cw / iw, ch / ih, 1);
      canvas.width = Math.round(iw * scale);
      canvas.height = Math.round(ih * scale);
      ctx.drawImage(state.sourceImg, 0, 0, canvas.width, canvas.height);
    } else {
      canvas.width = cw;
      canvas.height = ch;
    }
  }

  function drawImage(img) {
    var container = $('canvasContainer');
    var cw = container.clientWidth;
    var ch = container.clientHeight;
    if (cw < 10) cw = window.innerWidth - 320;
    if (ch < 10) ch = window.innerHeight - 200;
    var iw = img.naturalWidth || img.width;
    var ih = img.naturalHeight || img.height;
    var scale = Math.min(cw / iw, ch / ih, 1);
    canvas.width = Math.round(iw * scale);
    canvas.height = Math.round(ih * scale);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    $('canvasPlaceholder').style.display = 'none';
  }

  window.addEventListener('resize', function() {
    if (state.sourceImg) drawImage(state.sourceImg);
  });

  // ── File loading ───────────────────────────────────────
  function loadFileAsImage(file, callback) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function() { callback(null, img); };
    img.onerror = function() {
      URL.revokeObjectURL(url);
      callback(new Error('Failed to load image: ' + file.name));
    };
    img.src = url;
  }

  on('btnLoadSource', 'click', function() { $('inputSource').click(); });
  on('inputSource', 'change', function(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    state.sourceFile = file;
    $('sourceFilename').textContent = file.name;
    $('sourceFilename').classList.add('loaded');
    logMsg('Loading source: ' + file.name);
    loadFileAsImage(file, function(err, img) {
      if (err) { logMsg(err.message, 'err'); return; }
      state.sourceImg = img;
      drawImage(img);
      $('infoLeft').textContent = img.naturalWidth + ' x ' + img.naturalHeight;
      logMsg('Source loaded: ' + img.naturalWidth + 'x' + img.naturalHeight, 'ok');
    });
  });

  on('btnLoadDepth', 'click', function() { $('inputDepth').click(); });
  on('inputDepth', 'change', function(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    state.depthFile = file;
    $('depthFilename').textContent = file.name;
    $('depthFilename').classList.add('loaded');
    logMsg('Depth map loaded: ' + file.name, 'ok');
    loadFileAsImage(file, function(err, img) {
      if (!err) state.depthImg = img;
    });
  });

  // ── Effect tabs ────────────────────────────────────────
  var fxTabs = document.querySelectorAll('.fx-tab');
  for (var i = 0; i < fxTabs.length; i++) {
    (function(tab) {
      on(tab, 'click', function() {
        for (var j = 0; j < fxTabs.length; j++) fxTabs[j].classList.remove('active');
        tab.classList.add('active');
        var panes = document.querySelectorAll('.fx-pane');
        for (var k = 0; k < panes.length; k++) panes[k].classList.remove('active');
        var target = $('pane-' + tab.getAttribute('data-fx'));
        if (target) target.classList.add('active');
        state.activeFx = tab.getAttribute('data-fx');
        if (tab.getAttribute('data-fx') !== 'elevation' && tab.getAttribute('data-fx') !== 'hologram' && window._elevRenderer) {
          window._elevRenderer.hide();
        }
      });
    })(fxTabs[i]);
  }

  // ── Range slider bindings ─────────────────────────────
  var bindRange = DS.bindRange;
  bindRange('par-shiftX'); bindRange('par-shiftY'); bindRange('par-scale');
  bindRange('wig-views'); bindRange('wig-sep', 'px'); bindRange('wig-fps');
  bindRange('wig-loops'); bindRange('wig-pivot-x'); bindRange('wig-pivot-y');
  bindRange('wig-comb-interval', 'f');
  bindRange('spa-eyesep', 'px'); bindRange('spa-conv');
  bindRange('bok-focal'); bindRange('bok-range'); bindRange('bok-blur', 'px');
  bindRange('bok-blades'); bindRange('bok-roundness', '%'); bindRange('bok-rotation', '°');
  bindRange('bok-ring', '%'); bindRange('bok-squeeze', '%'); bindRange('bok-swirl', '%');
  bindRange('bok-vignette', '%'); bindRange('bok-highlights', '%');
  bindRange('fog-density'); bindRange('fog-near'); bindRange('fog-far'); bindRange('fog-noise');
  bindRange('grd-opacity'); bindRange('grd-gamma');
  bindRange('slc-near'); bindRange('slc-far'); bindRange('slc-feather'); bindRange('slc-bg-alpha');
  bindRange('ws-grain'); bindRange('ws-grain-opacity'); bindRange('ws-bgblur', 'px'); bindRange('ws-flash');
  bindRange('ws-vignette'); bindRange('ws-leak'); bindRange('ws-halation', 'px');
  bindRange('ws-contrast'); bindRange('ws-saturation'); bindRange('ws-fade');
  bindRange('ws-tint-strength');

  // Bokeh shape visibility
  function updateBokehControls() {
    var shape = $('bok-shape').value;
    var show = function(id, vis) { var el = $(id); if (el) el.style.display = vis ? '' : 'none'; };
    show('bok-blades-row', shape === 'hexagon');
    show('bok-ring-row', shape === 'ring' || shape === 'donut' || shape === 'onion_ring');
    show('bok-squeeze-row', shape === 'anamorphic');
    show('bok-swirl-row', shape === 'petzval');
    show('bok-vignette-row', shape === 'cat_eye');
  }
  on('bok-shape', 'change', updateBokehControls);
  updateBokehControls();

  // ── Film filter preset + gradient preview ─────────────
  var GRAD_COLORS = {
    none: null, warm: [[30, 20, 60], [255, 200, 120]], cool: [[20, 30, 60], [140, 190, 255]],
    vintage: [[50, 30, 20], [240, 220, 180]], neon: [[20, 0, 40], [255, 100, 200]],
    forest: [[10, 30, 20], [180, 220, 140]], sunset: [[40, 10, 50], [255, 160, 60]]
  };

  window.wsDrawGradPreview = function(name) {
    var cv = $('ws-gradmap-preview');
    if (!cv) return;
    var c = GRAD_COLORS[name];
    if (!c) { cv.style.display = 'none'; return; }
    cv.style.display = 'block';
    var gCtx = cv.getContext('2d');
    var g = gCtx.createLinearGradient(0, 0, cv.width, 0);
    g.addColorStop(0, 'rgb(' + c[0].join(',') + ')');
    g.addColorStop(1, 'rgb(' + c[1].join(',') + ')');
    gCtx.fillStyle = g; gCtx.fillRect(0, 0, cv.width, cv.height);
  };

  var _wsPresets = null;
  window.wsApplyFilmPreset = async function(name) {
    if (!_wsPresets) {
      try { var r = await fetch(SERVER + '/film-presets'); if (r.ok) _wsPresets = (await r.json()).presets; } catch(e) {}
    }
    if (!_wsPresets) _wsPresets = { none: { blur_strength: 0, flash_intensity: 0, vignette_strength: 0, light_leak_opacity: 0, grain_amount: 0, halation_radius: 0, contrast: 0, saturation: 0, fade: 0, tint_color: '', tint_strength: 0, gradient_map: 'none' } };
    var p = _wsPresets[name] || _wsPresets.none;
    var sliders = $('ws-film-sliders');
    if (name === 'none') { if (sliders) sliders.style.display = 'none'; } else { if (sliders) sliders.style.display = 'block'; }
    var map = { 'ws-grain': p.grain_amount, 'ws-bgblur': p.blur_strength, 'ws-flash': p.flash_intensity,
      'ws-vignette': p.vignette_strength, 'ws-leak': p.light_leak_opacity, 'ws-halation': p.halation_radius,
      'ws-contrast': p.contrast, 'ws-saturation': p.saturation, 'ws-fade': p.fade, 'ws-tint-strength': p.tint_strength };
    for (var id in map) { var el = $(id); if (el) { el.value = map[id]; el.dispatchEvent(new Event('input')); } }
    if (p.tint_color && $('ws-tint-color')) $('ws-tint-color').value = p.tint_color;
    if (p.gradient_map && $('ws-gradient-map')) { $('ws-gradient-map').value = p.gradient_map; wsDrawGradPreview(p.gradient_map); }
  };

  function getWsFilmFilter() {
    return {
      grain_amount: parseFloat($('ws-grain')?.value || '0'),
      grain_opacity: parseFloat($('ws-grain-opacity')?.value || '1'),
      blur_strength: parseFloat($('ws-bgblur')?.value || '0'),
      flash_intensity: parseFloat($('ws-flash')?.value || '0'),
      vignette_strength: parseFloat($('ws-vignette')?.value || '0'),
      light_leak_opacity: parseFloat($('ws-leak')?.value || '0'),
      light_leak_style: $('ws-leak-style')?.value || 'amber-corner',
      halation_radius: parseFloat($('ws-halation')?.value || '0'),
      contrast: parseFloat($('ws-contrast')?.value || '0'),
      saturation: parseFloat($('ws-saturation')?.value || '0'),
      fade: parseFloat($('ws-fade')?.value || '0'),
      tint_color: $('ws-tint-color')?.value || '',
      tint_strength: parseFloat($('ws-tint-strength')?.value || '0'),
      gradient_map: $('ws-gradient-map')?.value || 'none',
    };
  }

  // ── Effect params ──────────────────────────────────────
  function getEffectParams() {
    switch (state.activeFx) {
      case 'parallax':
        return { shift_x: parseFloat($('par-shiftX').value), shift_y: parseFloat($('par-shiftY').value), depth_scale: parseFloat($('par-scale').value) };
      case 'wiggle':
        return { views: parseInt($('wig-views').value, 10), separation: parseInt($('wig-sep').value, 10), fps: parseInt($('wig-fps').value, 10),
          path: $('wig-path').value, loops: parseInt($('wig-loops').value, 10), pivot_x: parseFloat($('wig-pivot-x').value), pivot_y: parseFloat($('wig-pivot-y').value) };
      case 'spatial':
        return { eye_separation: parseInt($('spa-eyesep').value, 10), convergence: parseFloat($('spa-conv').value), mode: $('spa-mode').value };
      case 'bokeh':
        return { focal_depth: parseFloat($('bok-focal').value), focal_range: parseFloat($('bok-range').value), max_blur: parseInt($('bok-blur').value, 10), bokeh_shape: $('bok-shape').value, near_blur: true, far_blur: true };
      case 'fog':
        return { color: $('fog-color').value, density: parseFloat($('fog-density').value), near: parseFloat($('fog-near').value), far: parseFloat($('fog-far').value), noise: parseFloat($('fog-noise').value) };
      case 'grade':
        return { near_color: $('grd-near').value, far_color: $('grd-far').value, opacity: parseFloat($('grd-opacity').value), gamma: parseFloat($('grd-gamma').value), blend_mode: $('grd-blend').value };
      case 'slice':
        return { near: parseFloat($('slc-near').value), far: parseFloat($('slc-far').value), feather: parseFloat($('slc-feather').value), bg_alpha: parseInt($('slc-bg-alpha').value, 10), invert_mask: $('slc-invert')?.checked || false };
      case 'elevation':
        return { elevation: parseFloat($('elev-height').value), rotate_x: parseInt($('elev-rx').value, 10), rotate_y: parseInt($('elev-ry').value, 10), zoom: parseFloat($('elev-zoom').value),
          grid_density: parseInt($('elev-density').value, 10), line_width: parseInt($('elev-linewidth').value, 10), grid_glow: parseFloat($('elev-glow').value), grid_color: $('elev-grid-color').value,
          bg_color: $('elev-bg-color').value, show_grid: $('elev-grid').checked, show_image: $('elev-image').checked, scan_lines: $('elev-scanlines').checked, scan_line_opacity: parseFloat($('elev-scan-opacity').value) };
      case 'hologram':
        return { style: $('holo-style').value, color: $('holo-color1').value, color2: $('holo-color2').value, bg_color: $('holo-bg').value,
          scan_lines: $('holo-scanlines').checked, scan_density: parseInt($('holo-scan-density').value, 10), scan_opacity: parseFloat($('holo-scan-opacity')?.value || '0.4'),
          dither: $('holo-dither').checked, grid_overlay: $('holo-grid')?.checked || false, density: parseInt($('holo-density')?.value || '40', 10) };
      default:
        return {};
    }
  }

  // ── Server requests ────────────────────────────────────
  function requireFiles() {
    if (!state.sourceFile) { logMsg('No source image loaded', 'warn'); return false; }
    if (!state.depthFile) { logMsg('No depth map loaded', 'warn'); return false; }
    if (!DS.isOnline()) { logMsg('Server is offline', 'err'); return false; }
    return true;
  }

  async function ensureSession() {
    if (state.sessionId) return state.sessionId;
    if (!state.sourceFile) throw new Error('No source image');
    logMsg('Creating session (processing depth)...');
    $('infoRight').textContent = 'Processing depth...';
    var fd = new FormData();
    fd.append('file', state.sourceFile, state.sourceFile.name);
    fd.append('model', 'base');
    fd.append('format', 'png_gray');
    var r = await DS.fetchWithProgress(SERVER + '/process/frame', { method: 'POST', body: fd });
    if (!r.ok) throw new Error('Depth processing failed: ' + r.status);
    var sid = r.headers.get('X-Session-Id');
    if (!sid) throw new Error('No session ID returned');
    state.sessionId = sid;
    logMsg('Session created: ' + sid, 'ok');
    return sid;
  }

  async function runEffect(effectName, preview) {
    if (!requireFiles()) return;
    try {
      var sid = await ensureSession();
      var params = getEffectParams();
      var endpoint = preview ? SERVER + '/effect/' + effectName + '/preview' : SERVER + '/effect/' + effectName;
      logMsg((preview ? 'Preview' : 'Export') + ' ' + effectName + '...');
      $('infoRight').textContent = 'Processing...';
      var fd = new FormData();
      fd.append('session_id', sid);
      fd.append('params_json', JSON.stringify(params));
      var r = await DS.fetchWithProgress(endpoint, { method: 'POST', body: fd });
      if (!r.ok) throw new Error('Server error: ' + r.status);
      var blob = await r.blob();
      var bitmap = await createImageBitmap(blob);
      drawImage(bitmap);
      $('infoRight').textContent = 'Done';
      logMsg(effectName + (preview ? ' preview' : ' export') + ' complete', 'ok');
      if (!preview) DS.saveBlob(blob, effectName + '_result.png');
    } catch(err) {
      logMsg(effectName + ' failed: ' + err.message, 'err');
      $('infoRight').textContent = 'Error';
    }
  }

  async function runWigglegram(format) {
    if (!requireFiles()) return;
    try {
      var sid = await ensureSession();
      var params = getEffectParams();
      logMsg('Generating wigglegram (' + format + ')...');
      $('infoRight').textContent = 'Processing...';
      var fd = new FormData();
      fd.append('session_id', sid);
      fd.append('num_views', params.views.toString());
      fd.append('separation', params.separation.toString());
      fd.append('path', params.path);
      fd.append('format', format);
      fd.append('fps', params.fps.toString());
      fd.append('loops', params.loops.toString());
      fd.append('blur_depth', '5');
      fd.append('pivot_x', params.pivot_x.toString());
      fd.append('pivot_y', params.pivot_y.toString());
      fd.append('film_filter_json', JSON.stringify(getWsFilmFilter()));
      var r = await DS.fetchWithProgress(SERVER + '/wigglegram', { method: 'POST', body: fd });
      if (!r.ok) throw new Error('Server error: ' + r.status);
      var blob = await r.blob();
      DS.saveBlob(blob, 'wigglegram.' + format);
      logMsg('Wigglegram exported as ' + format, 'ok');
      $('infoRight').textContent = 'Done';
    } catch(err) {
      logMsg('Wigglegram failed: ' + err.message, 'err');
      $('infoRight').textContent = 'Error';
    }
  }

  async function runSpatial(preview) {
    if (!requireFiles()) return;
    try {
      var sid = await ensureSession();
      var params = getEffectParams();
      logMsg((preview ? 'Preview' : 'Export') + ' spatial...');
      $('infoRight').textContent = 'Processing...';
      var fd = new FormData();
      fd.append('session_id', sid);
      fd.append('eye_separation', params.eye_separation.toString());
      fd.append('convergence', params.convergence.toString());
      fd.append('output', preview ? 'sbs' : params.mode);
      var r = await DS.fetchWithProgress(SERVER + '/spatial', { method: 'POST', body: fd });
      if (!r.ok) throw new Error('Server error: ' + r.status);
      var blob = await r.blob();
      var url = URL.createObjectURL(blob);
      var img = new Image();
      img.onload = function() {
        drawImage(img);
        $('infoRight').textContent = 'Done';
        logMsg('Spatial ' + (preview ? 'preview' : 'export') + ' complete', 'ok');
        if (!preview) DS.saveBlob(blob, 'spatial_' + $('spa-mode').value + '.png');
      };
      img.src = url;
    } catch(err) {
      logMsg('Spatial failed: ' + err.message, 'err');
      $('infoRight').textContent = 'Error';
    }
  }

  // ── Button bindings ────────────────────────────────────
  on('par-preview', 'click', function() { runEffect('parallax', true); });
  on('par-export', 'click', function() { runEffect('parallax', false); });
  on('wig-preview', 'click', function() { runWigglegram('gif'); });
  on('wig-export-gif', 'click', function() { runWigglegram('gif'); });
  on('wig-export-mp4', 'click', function() { runWigglegram('mp4'); });
  on('spa-preview', 'click', function() { runSpatial(true); });
  on('spa-export', 'click', function() { runSpatial(false); });
  on('bok-preview', 'click', function() { runEffect('dof', true); });
  on('bok-export', 'click', function() { runEffect('dof', false); });
  on('fog-preview', 'click', function() { runEffect('fog', true); });
  on('fog-export', 'click', function() { runEffect('fog', false); });
  on('grd-preview', 'click', function() { runEffect('grade', true); });
  on('grd-export', 'click', function() { runEffect('grade', false); });
  on('slc-preview', 'click', function() { runEffect('slice', true); });
  on('slc-export', 'click', function() { runEffect('slice', false); });

  // ── Video comb ─────────────────────────────────────────
  var combVideoFile = null;
  on('wig-video-load', 'click', function() { $('wig-video-input').click(); });
  on('wig-video-input', 'change', function(e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    combVideoFile = f;
    $('wig-video-name').textContent = f.name;
    $('wig-video-name').style.display = '';
    $('wig-comb-export').disabled = false;
    logMsg('Video loaded for comb: ' + f.name, 'ok');
    e.target.value = '';
  });
  on('wig-comb-export', 'click', async function() {
    if (!combVideoFile) return;
    var params = getEffectParams();
    $('wig-comb-export').disabled = true;
    $('wig-comb-export').textContent = 'Processing…';
    logMsg('Generating comb 3D video...');
    $('infoRight').textContent = 'Processing comb video...';
    try {
      var fd = new FormData();
      fd.append('file', combVideoFile, combVideoFile.name);
      fd.append('separation', params.separation.toString());
      fd.append('interval', parseInt($('wig-comb-interval').value).toString());
      fd.append('blur_depth', '5');
      fd.append('pivot_x', params.pivot_x.toString());
      fd.append('pivot_y', params.pivot_y.toString());
      var r = await DS.fetchWithProgress(SERVER + '/wigglegram/comb', { method: 'POST', body: fd });
      if (!r.ok) throw new Error('Server error: ' + r.status);
      var blob = await r.blob();
      DS.saveBlob(blob, 'comb_3d.mp4');
      logMsg('Comb video export complete', 'ok');
      $('infoRight').textContent = 'Done';
    } catch(err) {
      logMsg('Comb export failed: ' + err.message, 'err');
      $('infoRight').textContent = 'Error';
    }
    $('wig-comb-export').disabled = false;
    $('wig-comb-export').textContent = 'Export Comb Video';
  });

  // ── Navigate to Studio ─────────────────────────────────
  on('btn-studio', 'click', function() {
    var url = 'studio.html?server=' + encodeURIComponent(SERVER);
    if (state.sessionId) url += '&session=' + state.sessionId;
    window.location.href = url;
  });

  // ── Init ───────────────────────────────────────────────
  sizeCanvas();
  logMsg('Effects Workspace ready');

  // Auto-load from session if passed via URL
  (async function loadFromSession() {
    var session = DS.params.get('session');
    if (!session) return;

    state.sessionId = session;
    logMsg('Loading session ' + session + '...');

    try {
      var srcR = await fetch(SERVER + '/session/' + session + '/source');
      if (srcR.ok) {
        var srcBlob = await srcR.blob();
        state.sourceFile = new File([srcBlob], 'session_source.png', { type: srcBlob.type });
        var srcImg = await createImageBitmap(srcBlob);
        state.sourceImg = srcImg;
        drawImage(srcImg);
        $('sourceFilename').textContent = 'session:' + session;
        $('sourceFilename').classList.add('loaded');
        logMsg('Source loaded from session', 'ok');
      }

      var depthR = await fetch(SERVER + '/session/' + session + '/depth');
      if (depthR.ok) {
        var depthBlob = await depthR.blob();
        state.depthFile = new File([depthBlob], 'session_depth.png', { type: depthBlob.type });
        $('depthFilename').textContent = 'session:' + session;
        $('depthFilename').classList.add('loaded');
        logMsg('Depth map loaded from session', 'ok');
      }

      logMsg('Session ' + session + ' ready', 'ok');
    } catch(e) {
      logMsg('Session load failed: ' + e.message + ' — load files manually', 'warn');
    }
  })();

  // ── WebGL elevation renderer ──────────────────────────
  // Three.js renderer available — wire up backward-compat shim
  // Three.js renderer loaded but not ready for takeover yet — use legacy WebGL
  if (false && typeof Renderer3D !== 'undefined' && Renderer3D.init) {
    (function() {
      var elevCanvas = $("elev-canvas");

      function showElevCanvas(asHolo) {
        if (!state.depthFile) return;
        Renderer3D.show(elevCanvas, asHolo);
        elevCanvas.width = 1200; elevCanvas.height = 800;
        $("previewCanvas").style.display = "none";
        elevCanvas.style.display = "block";
        if ($("canvasPlaceholder")) $("canvasPlaceholder").style.display = "none";
        // Load textures if needed
        var depthBlob = state.depthBlob || state.depthFile;
        var srcBlob = state.currentBlob || state.sourceFile;
        var smoothing = parseInt($("elev-smooth")?.value || "3");
        Renderer3D.reload(depthBlob, srcBlob, smoothing);
      }

      function hideElevCanvas() {
        Renderer3D.hide();
        elevCanvas.style.display = "none";
        $("previewCanvas").style.display = "";
      }

      window._elevRenderer = {
        show: function(asHolo) { showElevCanvas(asHolo); },
        hide: function() { hideElevCanvas(); },
        render: function() { Renderer3D.render(); },
        reload: function(cb) {
          var depthBlob = state.depthBlob || state.depthFile;
          var srcBlob = state.currentBlob || state.sourceFile;
          var smoothing = parseInt($("elev-smooth")?.value || "3");
          Renderer3D.reload(depthBlob, srcBlob, smoothing, cb);
        },
        getCanvas: function() { return elevCanvas; },
        setHoloMode: function(v) { Renderer3D.setHoloMode(v); }
      };
      window._elevExport = function(format) {
        var type = $("elev-anim-select")?.value || $("holo-anim-select")?.value;
        if (!type) { logMsg("Select an animation first", "warn"); return; }
        Renderer3D.captureAnimation(type, 24, 3).then(function(frames) {
          logMsg("Encoding " + frames.length + " frames as " + format + "...", "info");
          var fd = new FormData();
          for (var i = 0; i < frames.length; i++) fd.append("frames", frames[i], "frame_" + String(i).padStart(4, "0") + ".png");
          fd.append("fps", "24"); fd.append("format", format); fd.append("loop", "true");
          fetch(SERVER + "/animate/export", { method: "POST", body: fd }).then(function(r) {
            if (!r.ok) throw new Error("Export failed: " + r.status);
            return r.blob();
          }).then(function(blob) {
            var ext = format === "gif" ? ".gif" : ".mp4";
            var name = (state.sourceFile?.name || "animation").replace(/\.[^.]+$/, "") + "_3d" + ext;
            DS.saveBlob(blob, name);
            logMsg("Animation saved: " + name, "ok");
          }).catch(function(e) { logMsg("Export error: " + e.message, "err"); });
        });
      };

      // Slider → Renderer3D adapter (reads DOM, calls API)
      function syncRendererFromDOM() {
        if (!Renderer3D.isVisible()) return;
        var isHolo = document.querySelector(".fx-tab.active")?.dataset?.fx === "hologram";
        Renderer3D.setElevation(parseFloat($("elev-height")?.value || "0.3"));
        Renderer3D.setDensity(parseInt($("elev-density")?.value || "40"));
        Renderer3D.setGridType(isHolo ? ($("holo-grid-type")?.value || "square") : ($("elev-grid-type")?.value || "square"));
        Renderer3D.setGlow(parseFloat($("elev-glow")?.value || "0.8"));
        var bloom = parseFloat($("elev-bloom")?.value || "1.5");
        Renderer3D.setBloom(bloom > 0 ? bloom * 0.5 : 0, 0.4, 0.85);
        Renderer3D.setScanLines({
          enabled: isHolo ? $("holo-scanlines")?.checked : $("elev-scanlines")?.checked,
          density: isHolo ? parseFloat($("holo-scan-density")?.value || "3") : 3.0,
          opacity: isHolo ? parseFloat($("holo-scan-opacity")?.value || "0.5") : parseFloat($("elev-scan-opacity")?.value || "0.3"),
          speed: isHolo ? parseFloat($("holo-scan-speed")?.value || "0.5") : parseFloat($("elev-scan-speed")?.value || "0.5"),
          dir: isHolo ? parseFloat($("holo-scan-dir")?.value || "1") : parseFloat($("elev-scan-dir")?.value || "1")
        });
        if (isHolo) {
          Renderer3D.setColors($("holo-color1")?.value || "#00ff88", $("holo-color-mid")?.value || "#00aa55", $("holo-color2")?.value || "#003322", $("holo-bg")?.value || "#000505");
          Renderer3D.setDither({ enabled: $("holo-dither")?.checked && ($("holo-dither-style")?.value || "none") !== "none" });
          Renderer3D.setSrcTint($("holo-src-color")?.value || "#ffffff", parseFloat($("holo-src-tint")?.value || "0"));
          Renderer3D.setLayerVisible('grid', $("holo-grid")?.checked);
        } else {
          Renderer3D.setColors($("elev-grid-color")?.value || "#00ff88", null, $("elev-grid-color2")?.value || "#0044ff", $("elev-bg-color")?.value || "#0a0a14");
          Renderer3D.setLayerVisible('grid', $("elev-grid")?.checked);
          Renderer3D.setLayerVisible('source', $("elev-image")?.checked);
        }
        Renderer3D.setGap(isHolo ? parseFloat($("holo-gap")?.value || "0") : parseFloat($("elev-gap")?.value || "0"));
      }

      // Listen for slider changes
      var syncDebounce = null;
      function debouncedSync() { clearTimeout(syncDebounce); syncDebounce = setTimeout(syncRendererFromDOM, 50); }
      ["elev-height","elev-density","elev-linewidth","elev-glow","elev-grid-color","elev-grid-color2","elev-bg-color","elev-scan-opacity","elev-scan-speed","elev-gap","elev-bloom","elev-smooth","elev-rz",
       "holo-color1","holo-color2","holo-bg","holo-color-mid","holo-src-color","holo-src-tint","holo-scan-density","holo-scan-opacity","holo-scan-speed","holo-gap","holo-smooth"].forEach(function(id) {
        var el = $(id); if (el) el.addEventListener("input", debouncedSync);
      });
      ["elev-grid","elev-image","elev-scanlines","elev-grid-type","elev-scan-dir",
       "holo-scanlines","holo-dither","holo-grid","holo-grid-type","holo-scan-dir","holo-dither-style"].forEach(function(id) {
        var el = $(id); if (el) el.addEventListener("change", debouncedSync);
      });

      // Camera orbit via mouse drag on elev-canvas
      var orbiting = false, startX = 0, startY = 0, startRX = 0, startRY = 0;
      elevCanvas.addEventListener("mousedown", function(e) {
        orbiting = true; startX = e.clientX; startY = e.clientY;
        var cam = Renderer3D.getCamera();
        startRY = cam.ry; startRX = cam.rx;
        elevCanvas.style.cursor = "grabbing"; e.preventDefault();
      });
      window.addEventListener("mousemove", function(e) {
        if (!orbiting) return;
        var newRY = Math.max(-180, Math.min(180, startRY + (e.clientX - startX) * 0.5));
        var newRX = Math.max(-90, Math.min(90, startRX + (e.clientY - startY) * 0.3));
        Renderer3D.setCamera(newRX, newRY, Renderer3D.getCamera().rz, Renderer3D.getCamera().zoom);
        $("elev-ry").value = newRY; $("elev-rx").value = newRX;
        $("elev-ry-v").textContent = Math.round(newRY) + "\u00B0";
        $("elev-rx-v").textContent = Math.round(newRX) + "\u00B0";
      });
      window.addEventListener("mouseup", function() { if (orbiting) { orbiting = false; elevCanvas.style.cursor = "grab"; } });
      elevCanvas.addEventListener("wheel", function(e) {
        e.preventDefault();
        var cam = Renderer3D.getCamera();
        var newZ = Math.max(0.5, Math.min(3, cam.zoom + (e.deltaY > 0 ? -0.1 : 0.1)));
        Renderer3D.setCamera(cam.rx, cam.ry, cam.rz, newZ);
        $("elev-zoom").value = newZ; $("elev-zoom-v").textContent = newZ.toFixed(2);
      }, { passive: false });

      // Camera/animation presets (reuse existing DOM listeners from below)
      // handled by existing event bindings since _elevRenderer API shape matches

      // Export buttons
      ["elev-export-gif","holo-export-gif"].forEach(function(id) {
        var el = $(id); if (el) el.addEventListener("click", function() { window._elevExport("gif"); });
      });
      ["elev-export-mp4","holo-export-mp4"].forEach(function(id) {
        var el = $(id); if (el) el.addEventListener("click", function() { window._elevExport("mp4"); });
      });

      // Animation select
      ["elev-anim-select","holo-anim-select"].forEach(function(id) {
        var el = $(id); if (el) el.addEventListener("change", function() {
          if ($("elev-anim-select")) $("elev-anim-select").value = this.value;
          if ($("holo-anim-select")) $("holo-anim-select").value = this.value;
          if (this.value) {
            Renderer3D.startAnimation(this.value, parseFloat($("elev-anim-speed")?.value || "1"), parseInt($("elev-anim-dir")?.value || "1"));
          } else {
            Renderer3D.stopAnimation();
          }
        });
      });

      // Camera presets
      ["elev-cam-preset","holo-cam-preset"].forEach(function(id) {
        var el = $(id); if (el) el.addEventListener("change", function() {
          Renderer3D.setCameraPreset(this.value);
          if (!Renderer3D.isVisible()) {
            var isHolo = document.querySelector(".fx-tab.active")?.dataset?.fx === "hologram";
            showElevCanvas(isHolo);
          }
        });
      });

      // Holo style presets, glow presets, gradmap, split-elev — handled by existing DOM bindings
      // that modify input values → trigger syncRendererFromDOM via input events

      logMsg("Three.js renderer active", "ok");
    })();
    // Skip old raw WebGL renderer
    return;
  }
  // ── Legacy raw WebGL fallback (when Three.js not loaded) ──
  (function() {
    if (!state.depthBlob && state.depthFile) state.depthBlob = state.depthFile;
    if (!state.currentBlob && state.sourceFile) state.currentBlob = state.sourceFile;

    var elevCanvas = $("elev-canvas");
    var gl = elevCanvas.getContext("webgl", { antialias: true, alpha: false });
    if (!gl) { console.error("WebGL not available"); return; }

    var depthTex = null, srcTex = null;
    var depthLoaded = false, srcLoaded = false;
    var meshVBO = null, meshLineIBO = null, meshTriIBO = null;
    var meshLineCount = 0, meshTriCount = 0;
    var lastDensity = 0, lastSmoothing = -1;
    var animId = null, animType = null, animT = 0;
    var program = null;
    var depthW = 0, depthH = 0;
    var depthDataRaw = null;
    var holoMode = false;

    var vsSource = [
      "attribute vec2 aGrid;",
      "uniform sampler2D uDepth;",
      "uniform float uElevation;",
      "uniform float uElevOverride;",
      "uniform float uGapOffset;",
      "uniform mat4 uView;",
      "uniform float uZoom;",
      "uniform float uAspect;",
      "uniform float uCamDist;",
      "varying float vDepth;",
      "varying vec2 vUV;",
      "varying vec2 vScreen;",
      "void main() {",
      "  vec4 d = texture2D(uDepth, aGrid);",
      "  float depth = d.r;",
      "  vDepth = depth;",
      "  vUV = aGrid;",
      "  float x = (aGrid.x - 0.5) * 2.0;",
      "  float z = (aGrid.y - 0.5) * 2.0;",
      "  float elev = uElevOverride >= -99.0 ? uElevOverride : uElevation;",
      "  float y = -depth * elev + uGapOffset;",
      "  vec4 viewPos = uView * vec4(x, y, z, 1.0);",
      "  float camZ = viewPos.z + uCamDist;",
      "  float fov = 1.5;",
      "  float persp = fov / max(camZ, 0.1);",
      "  vec4 pos = vec4(viewPos.x * persp * uAspect, viewPos.y * persp, camZ * 0.05, 1.0);",
      "  gl_Position = pos;",
      "  vScreen = pos.xy * 0.5 + 0.5;",
      "  gl_PointSize = 3.0;",
      "}"
    ].join("\n");

    var fsSource = [
      "precision mediump float;",
      "varying float vDepth;",
      "varying vec2 vUV;",
      "varying vec2 vScreen;",
      "uniform vec3 uGridColor;",
      "uniform vec3 uGridColor2;",
      "uniform vec3 uBgColor;",
      "uniform float uGlowPass;",
      "uniform float uGlow;",
      "uniform float uRenderMode;",
      "uniform sampler2D uSrcTex;",
      "uniform vec3 uHoloColor;",
      "uniform vec3 uHoloColorMid;",
      "uniform vec3 uSrcTint;",
      "uniform float uSrcTintAmt;",
      "uniform float uDither;",
      "uniform float uScanLines;",
      "uniform float uScanDensity;",
      "uniform float uScanOpacity;",
      "uniform float uScanSpeed;",
      "uniform float uScanDir;",
      "uniform float uGap;",
      "uniform float uGridType;",
      "uniform float uResY;",
      "uniform float uTime;",
      "float hash(float n) { return fract(sin(n) * 43758.5453); }",
      "float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }",
      "",
      "float animScanLine(float depth, float density, float speed, float time) {",
      "  float pulse = mod(time * speed, 1.0);",
      "  float d = uScanDir > 0.0 ? depth : 1.0 - depth;",
      "  float depthPhase = d * 40.0 / density;",
      "  float contour = mod(depthPhase - pulse * 40.0 / density, 1.0);",
      "  float line = smoothstep(0.4, 0.5, contour) * (1.0 - smoothstep(0.5, 0.6, contour));",
      "  float accel = 0.5 + 0.5 * d;",
      "  return line * accel;",
      "}",
      "",
      "float gapScale(float coord, float gap) {",
      "  float scale = 1.0 + gap * 0.02;",
      "  return coord * scale;",
      "}",
      "",
      "void main() {",
      "  if (uRenderMode > 0.5 && uRenderMode < 1.5) {",
      "    vec3 c = texture2D(uSrcTex, vUV).rgb;",
      "    if (uScanLines > 0.5) {",
      "      float sl = animScanLine(vDepth, uScanDensity, uScanSpeed, uTime);",
      "      c *= 1.0 - sl * uScanOpacity;",
      "    }",
      "    gl_FragColor = vec4(c, 1.0);",
      "    return;",
      "  }",
      "  if (uRenderMode > 1.5) {",
      "    vec2 uv = vUV;",
      "    float glitchLine = floor(vDepth * 200.0 + gl_FragCoord.x * 0.1);",
      "    float glitchRand = hash(glitchLine + floor(uTime * 8.0));",
      "    if (glitchRand > 0.97) {",
      "      uv.x += (hash(glitchLine * 7.0 + uTime) - 0.5) * 0.08 * vDepth;",
      "    }",
      "    vec3 img = texture2D(uSrcTex, uv).rgb;",
      "    float luma = dot(img, vec3(0.299, 0.587, 0.114));",
      "    vec3 depthColor = vDepth < 0.5 ? mix(uGridColor2, uHoloColorMid, vDepth * 2.0) : mix(uHoloColorMid, uHoloColor, (vDepth - 0.5) * 2.0);",
      "    vec3 srcTint = img * uSrcTint * uSrcTintAmt;",
      "    vec3 tinted = depthColor * (0.2 + 0.8 * luma) * (0.4 + 0.6 * vDepth) + srcTint;",
      "    if (glitchRand > 0.97) {",
      "      float rShift = texture2D(uSrcTex, uv + vec2(0.01 * vDepth, 0.0)).r;",
      "      float bShift = texture2D(uSrcTex, uv - vec2(0.01 * vDepth, 0.0)).b;",
      "      tinted.r = uHoloColor.r * (0.2 + 0.8 * rShift) * (0.4 + 0.6 * vDepth);",
      "      tinted.b = uHoloColor.b * (0.2 + 0.8 * bShift) * (0.4 + 0.6 * vDepth);",
      "    }",
      "    if (uDither > 0.5) {",
      "      float px = floor(mod(gl_FragCoord.x / 2.0, 4.0));",
      "      float py = floor(mod(gl_FragCoord.y / 2.0, 4.0));",
      "      float idx = py * 4.0 + px;",
      "      float threshold = 0.0;",
      "      if (idx < 0.5) threshold = 0.0/16.0;",
      "      else if (idx < 1.5) threshold = 8.0/16.0;",
      "      else if (idx < 2.5) threshold = 2.0/16.0;",
      "      else if (idx < 3.5) threshold = 10.0/16.0;",
      "      else if (idx < 4.5) threshold = 12.0/16.0;",
      "      else if (idx < 5.5) threshold = 4.0/16.0;",
      "      else if (idx < 6.5) threshold = 14.0/16.0;",
      "      else if (idx < 7.5) threshold = 6.0/16.0;",
      "      else if (idx < 8.5) threshold = 3.0/16.0;",
      "      else if (idx < 9.5) threshold = 11.0/16.0;",
      "      else if (idx < 10.5) threshold = 1.0/16.0;",
      "      else if (idx < 11.5) threshold = 9.0/16.0;",
      "      else if (idx < 12.5) threshold = 15.0/16.0;",
      "      else if (idx < 13.5) threshold = 7.0/16.0;",
      "      else if (idx < 14.5) threshold = 13.0/16.0;",
      "      else threshold = 5.0/16.0;",
      "      float ditherMask = step(threshold, luma * 0.8 + 0.1);",
      "      tinted *= 0.3 + 0.7 * ditherMask;",
      "    }",
      "    if (uScanLines > 0.5) {",
      "      float sl = animScanLine(vDepth, uScanDensity, uScanSpeed, uTime);",
      "      tinted *= 1.0 - sl * uScanOpacity;",
      "    }",
      "    float sweepPhase = mod(uTime * 0.3, 1.4) - 0.2;",
      "    float sweepDist = abs(vDepth - sweepPhase);",
      "    float sweep = smoothstep(0.15, 0.0, sweepDist) * 0.35;",
      "    tinted += uHoloColor * sweep;",
      "    float grain = (hash2(gl_FragCoord.xy + uTime * 100.0) - 0.5) * 0.06;",
      "    tinted += grain;",
      "    gl_FragColor = vec4(tinted, 1.0);",
      "    return;",
      "  }",
      "  if (uRenderMode > 2.5 && uRenderMode < 3.5) {",
      "    vec2 pc = gl_PointCoord - 0.5;",
      "    if (dot(pc, pc) > 0.25) discard;",
      "    vec3 ptColor = vDepth < 0.5 ? mix(uGridColor2, uHoloColorMid, vDepth * 2.0) : mix(uHoloColorMid, uGridColor, (vDepth - 0.5) * 2.0);",
      "    float ptBright = 0.5 + 0.5 * vDepth;",
      "    gl_FragColor = vec4(ptColor * ptBright, 1.0);",
      "    return;",
      "  }",
      "  vec3 gradColor = vDepth < 0.5 ? mix(uGridColor2, uHoloColorMid, vDepth * 2.0) : mix(uHoloColorMid, uGridColor, (vDepth - 0.5) * 2.0);",
      "  float bright = 0.3 + 0.7 * vDepth;",
      "  if (uScanLines > 0.5) {",
      "    float sl = animScanLine(vDepth, uScanDensity, uScanSpeed, uTime);",
      "    bright *= 1.0 - sl * uScanOpacity;",
      "  }",
      "  if (uGlowPass > 0.5) {",
      "    gl_FragColor = vec4(gradColor * uGlow * 0.3, 1.0);",
      "  } else {",
      "    gl_FragColor = vec4(gradColor * bright, 1.0);",
      "  }",
      "}"
    ].join("\n");

    function compileShader(src, type) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error("Shader error:", gl.getShaderInfoLog(s)); return null; }
      return s;
    }

    function linkProgram(vs, fs) {
      var p = gl.createProgram();
      gl.attachShader(p, vs); gl.attachShader(p, fs);
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error("Program link error:", gl.getProgramInfoLog(p)); return null; }
      return p;
    }

    program = linkProgram(compileShader(vsSource, gl.VERTEX_SHADER), compileShader(fsSource, gl.FRAGMENT_SHADER));

    var lastGridType = "";
    function buildMesh(density, gridType) {
      gridType = gridType || "square";
      if (density === lastDensity && gridType === lastGridType) return;
      lastDensity = density;
      lastGridType = gridType;

      var gridW = density, gridH = density;
      var verts = new Float32Array(gridW * gridH * 2);
      for (var y = 0; y < gridH; y++) {
        for (var x = 0; x < gridW; x++) {
          var i = (y * gridW + x) * 2;
          verts[i] = x / (gridW - 1);
          verts[i + 1] = y / (gridH - 1);
        }
      }

      var lineIdx = [];
      var I = function(x, y) { return y * gridW + x; };

      if (gridType === "polygon" || gridType === "triangle") {
        for (var y2 = 0; y2 < gridH; y2++) {
          for (var x2 = 0; x2 < gridW; x2++) {
            if (x2 < gridW - 1) lineIdx.push(I(x2, y2), I(x2 + 1, y2));
            if (y2 < gridH - 1) lineIdx.push(I(x2, y2), I(x2, y2 + 1));
            if (x2 < gridW - 1 && y2 < gridH - 1) {
              if (y2 % 2 === 0) lineIdx.push(I(x2, y2), I(x2 + 1, y2 + 1));
              else lineIdx.push(I(x2 + 1, y2), I(x2, y2 + 1));
            }
          }
        }
      } else if (gridType === "dot" || gridType === "dotmatrix") {
        for (var y2 = 0; y2 < gridH; y2++) {
          for (var x2 = 0; x2 < gridW; x2++) {
            if (gridType === "dotmatrix") {
              if (x2 < gridW - 1 && x2 % 2 === 0) lineIdx.push(I(x2, y2), I(x2 + 1, y2));
              if (y2 < gridH - 1 && y2 % 2 === 0) lineIdx.push(I(x2, y2), I(x2, y2 + 1));
            } else {
              if (x2 < gridW - 1) lineIdx.push(I(x2, y2), I(x2 + 1, y2));
              if (y2 < gridH - 1) lineIdx.push(I(x2, y2), I(x2, y2 + 1));
              if (x2 < gridW - 1 && y2 < gridH - 1) lineIdx.push(I(x2, y2), I(x2 + 1, y2 + 1));
              if (x2 > 0 && y2 < gridH - 1) lineIdx.push(I(x2, y2), I(x2 - 1, y2 + 1));
            }
          }
        }
      } else if (gridType === "hex") {
        for (var y2 = 0; y2 < gridH; y2++) {
          var odd = y2 % 2;
          for (var x2 = 0; x2 < gridW; x2++) {
            if (x2 < gridW - 1 && (x2 + odd) % 2 === 0) lineIdx.push(I(x2, y2), I(x2 + 1, y2));
            if (y2 < gridH - 1) {
              if ((x2 + odd) % 2 === 0) {
                lineIdx.push(I(x2, y2), I(x2, y2 + 1));
                if (x2 < gridW - 1) lineIdx.push(I(x2, y2), I(x2 + 1, y2 + 1));
              }
            }
          }
        }
      } else if (gridType === "cross") {
        for (var y2 = 0; y2 < gridH - 1; y2++) {
          for (var x2 = 0; x2 < gridW - 1; x2++) {
            lineIdx.push(I(x2, y2), I(x2 + 1, y2 + 1));
            lineIdx.push(I(x2 + 1, y2), I(x2, y2 + 1));
          }
        }
      } else {
        for (var y2 = 0; y2 < gridH; y2++) {
          for (var x2 = 0; x2 < gridW; x2++) {
            if (x2 < gridW - 1) lineIdx.push(I(x2, y2), I(x2 + 1, y2));
            if (y2 < gridH - 1) lineIdx.push(I(x2, y2), I(x2, y2 + 1));
          }
        }
      }

      var triIdx = [];
      for (var y3 = 0; y3 < gridH - 1; y3++) {
        for (var x3 = 0; x3 < gridW - 1; x3++) {
          var tl = y3 * gridW + x3, tr = tl + 1, bl = tl + gridW, br = bl + 1;
          triIdx.push(tl, bl, tr, tr, bl, br);
        }
      }

      if (meshVBO) gl.deleteBuffer(meshVBO);
      if (meshLineIBO) gl.deleteBuffer(meshLineIBO);
      if (meshTriIBO) gl.deleteBuffer(meshTriIBO);

      meshVBO = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, meshVBO);
      gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);

      meshLineIBO = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshLineIBO);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(lineIdx), gl.STATIC_DRAW);
      meshLineCount = lineIdx.length;

      meshTriIBO = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshTriIBO);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(triIdx), gl.STATIC_DRAW);
      meshTriCount = triIdx.length;
    }

    function createTexFromImage(img) {
      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    }

    function createTexFromData(data, w, h) {
      var rgba = new Uint8Array(w * h * 4);
      for (var i = 0; i < w * h; i++) {
        var v = Math.round(data[i] * 255);
        rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255;
      }
      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    }

    function blurDepth(d, w, h, radius) {
      if (radius <= 0) return d;
      var tmp = new Float32Array(d.length);
      var out = new Float32Array(d.length);
      for (var y = 0; y < h; y++) {
        for (var x = 0; x < w; x++) {
          var sum = 0, count = 0;
          for (var dx = -radius; dx <= radius; dx++) {
            var nx = x + dx;
            if (nx >= 0 && nx < w) { sum += d[y * w + nx]; count++; }
          }
          tmp[y * w + x] = sum / count;
        }
      }
      for (var x2 = 0; x2 < w; x2++) {
        for (var y2 = 0; y2 < h; y2++) {
          var sum2 = 0, count2 = 0;
          for (var dy = -radius; dy <= radius; dy++) {
            var ny = y2 + dy;
            if (ny >= 0 && ny < h) { sum2 += tmp[ny * w + x2]; count2++; }
          }
          out[y2 * w + x2] = sum2 / count2;
        }
      }
      return out;
    }

    function uploadDepthTex(smoothing) {
      if (!depthDataRaw) return;
      var data = smoothing > 0 ? blurDepth(depthDataRaw, depthW, depthH, smoothing) : depthDataRaw;
      if (depthTex) gl.deleteTexture(depthTex);
      depthTex = createTexFromData(data, depthW, depthH);
      lastSmoothing = smoothing;
    }

    function loadDepth(callback) {
      var blob = state.depthBlob || state.depthFile;
      if (!blob) return;
      var img = new Image();
      img.onload = function() {
        var tc = document.createElement("canvas");
        tc.width = img.width; tc.height = img.height;
        var tctx = tc.getContext("2d");
        tctx.drawImage(img, 0, 0);
        var id = tctx.getImageData(0, 0, img.width, img.height);
        depthW = img.width; depthH = img.height;
        depthDataRaw = new Float32Array(depthW * depthH);
        for (var i = 0; i < depthDataRaw.length; i++) {
          depthDataRaw[i] = id.data[i * 4] / 255.0;
        }
        URL.revokeObjectURL(img.src);
        uploadDepthTex(parseInt($("elev-smooth").value));
        depthLoaded = true;
        if (callback) callback();
      };
      img.src = URL.createObjectURL(blob);
    }

    function loadSourceImage(callback) {
      var blob = state.currentBlob || state.sourceFile;
      if (!blob) {
        if (callback) callback();
        return;
      }
      var img = new Image();
      img.onload = function() {
        if (srcTex) gl.deleteTexture(srcTex);
        srcTex = createTexFromImage(img);
        srcLoaded = true;
        URL.revokeObjectURL(img.src);
        if (callback) callback();
      };
      img.onerror = function() { if (callback) callback(); };
      img.src = URL.createObjectURL(blob);
    }

    function hexToVec3(hex) {
      hex = hex.replace("#", "");
      return [parseInt(hex.substring(0, 2), 16) / 255, parseInt(hex.substring(2, 4), 16) / 255, parseInt(hex.substring(4, 6), 16) / 255];
    }

    function render() {
      if (!depthLoaded || !program) return;
      if (!gl._uint32ext) { gl._uint32ext = gl.getExtension("OES_element_index_uint"); }

      var elevation = parseFloat($("elev-height").value);
      var rx = parseFloat($("elev-rx").value) * Math.PI / 180;
      var ry = parseFloat($("elev-ry").value) * Math.PI / 180;
      var zoom = parseFloat($("elev-zoom").value);
      var density = parseInt($("elev-density").value);
      var lineWidth = parseInt($("elev-linewidth").value);
      var glow = parseFloat($("elev-glow").value);
      var showGrid = $("elev-grid").checked;
      var showImage = $("elev-image").checked;
      var smoothing = parseInt($("elev-smooth").value);
      var gc = hexToVec3($("elev-grid-color").value);
      var gc2 = hexToVec3($("elev-grid-color2").value);
      var bg = hexToVec3($("elev-bg-color").value);

      var holoColor = gc;
      var holoDither = false;
      var holoScan = $("elev-scanlines")?.checked || false;
      var holoScanDensity = 3.0;
      if (holoMode) {
        holoColor = hexToVec3($("holo-color1")?.value || "#00ff88");
        gc = hexToVec3($("holo-color1")?.value || "#00ff88");
        gc2 = hexToVec3($("holo-color2")?.value || "#003322");
        bg = hexToVec3($("holo-bg")?.value || "#000505");
        var ditherStyle = $("holo-dither-style")?.value || "none";
        holoDither = $("holo-dither")?.checked && ditherStyle !== "none";
        holoScan = $("holo-scanlines")?.checked;
        holoScanDensity = parseFloat($("holo-scan-density")?.value || "3");
        showGrid = $("holo-grid")?.checked;
        showImage = true;
      }

      if (smoothing !== lastSmoothing) uploadDepthTex(smoothing);
      var curGridType = holoMode ? ($("holo-grid-type")?.value || "square") : ($("elev-grid-type")?.value || "square");
      buildMesh(density, curGridType);

      var w = elevCanvas.width, h = elevCanvas.height;
      gl.viewport(0, 0, w, h);
      gl.clearColor(bg[0], bg[1], bg[2], 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.useProgram(program);

      var rz = parseFloat($("elev-rz")?.value || "0") * Math.PI / 180;
      var cx = Math.cos(rx), sx = Math.sin(rx);
      var cy = Math.cos(ry), sy = Math.sin(ry);
      var cz = Math.cos(rz), sz = Math.sin(rz);
      var viewMat = new Float32Array([
        cy * cz + sy * sx * sz, cx * sz, -sy * cz + cy * sx * sz, 0,
        -cy * sz + sy * sx * cz, cx * cz, sy * sz + cy * sx * cz, 0,
        sy * cx, -sx, cy * cx, 0,
        0, 0, 0, 1
      ]);

      var splitElev = holoMode && $("holo-split-elev")?.checked;
      var srcElevVal = splitElev ? parseFloat($("holo-src-elev")?.value || "0") : -100;
      var gridElevVal = splitElev ? parseFloat($("holo-grid-elev")?.value || "0.3") : -100;

      gl.uniform1f(gl.getUniformLocation(program, "uElevation"), elevation);
      gl.uniform1f(gl.getUniformLocation(program, "uElevOverride"), -100.0);
      gl.uniform1f(gl.getUniformLocation(program, "uGapOffset"), 0.0);
      gl.uniformMatrix4fv(gl.getUniformLocation(program, "uView"), false, viewMat);
      gl.uniform1f(gl.getUniformLocation(program, "uZoom"), zoom);
      gl.uniform1f(gl.getUniformLocation(program, "uCamDist"), 4.0 / zoom);
      gl.uniform1f(gl.getUniformLocation(program, "uAspect"), h / w);
      gl.uniform3fv(gl.getUniformLocation(program, "uGridColor"), gc);
      gl.uniform3fv(gl.getUniformLocation(program, "uGridColor2"), gc2);
      gl.uniform3fv(gl.getUniformLocation(program, "uBgColor"), bg);
      gl.uniform1f(gl.getUniformLocation(program, "uGlow"), glow);
      gl.uniform3fv(gl.getUniformLocation(program, "uHoloColor"), holoColor);
      var midColor = holoMode ? hexToVec3($("holo-color-mid")?.value || "#00aa55") : [gc[0] * 0.5 + gc2[0] * 0.5, gc[1] * 0.5 + gc2[1] * 0.5, gc[2] * 0.5 + gc2[2] * 0.5];
      gl.uniform3fv(gl.getUniformLocation(program, "uHoloColorMid"), midColor);
      var srcTintColor = holoMode ? hexToVec3($("holo-src-color")?.value || "#ffffff") : [1, 1, 1];
      var srcTintAmt = holoMode ? parseFloat($("holo-src-tint")?.value || "0") : 0;
      gl.uniform3fv(gl.getUniformLocation(program, "uSrcTint"), srcTintColor);
      gl.uniform1f(gl.getUniformLocation(program, "uSrcTintAmt"), srcTintAmt);
      gl.uniform1f(gl.getUniformLocation(program, "uDither"), holoDither ? 1.0 : 0.0);
      var scanOpacity = holoMode ? parseFloat($("holo-scan-opacity")?.value || "0.5") : parseFloat($("elev-scan-opacity")?.value || "0.3");
      gl.uniform1f(gl.getUniformLocation(program, "uScanLines"), holoScan ? 1.0 : 0.0);
      gl.uniform1f(gl.getUniformLocation(program, "uScanDensity"), holoScanDensity);
      gl.uniform1f(gl.getUniformLocation(program, "uScanOpacity"), scanOpacity);
      var scanSpeed = holoMode ? parseFloat($("holo-scan-speed")?.value || "0.5") : parseFloat($("elev-scan-speed")?.value || "0.5");
      gl.uniform1f(gl.getUniformLocation(program, "uScanSpeed"), scanSpeed);
      var scanDir = holoMode ? parseFloat($("holo-scan-dir")?.value || "1") : parseFloat($("elev-scan-dir")?.value || "1");
      gl.uniform1f(gl.getUniformLocation(program, "uScanDir"), scanDir);
      var gap = holoMode ? parseFloat($("holo-gap")?.value || "0") : parseFloat($("elev-gap")?.value || "0");
      gl.uniform1f(gl.getUniformLocation(program, "uGap"), gap);
      var gridTypeMap = { square: 0, polygon: 1, dot: 2, dotmatrix: 3, hex: 4, cross: 5 };
      var gridTypeVal = holoMode ? (gridTypeMap[$("holo-grid-type")?.value] || 0) : (gridTypeMap[$("elev-grid-type")?.value] || 0);
      gl.uniform1f(gl.getUniformLocation(program, "uGridType"), gridTypeVal);
      gl.uniform1f(gl.getUniformLocation(program, "uResY"), h);
      gl.uniform1f(gl.getUniformLocation(program, "uTime"), performance.now() / 1000.0);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, depthTex);
      gl.uniform1i(gl.getUniformLocation(program, "uDepth"), 0);

      if (srcTex) {
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, srcTex);
        gl.uniform1i(gl.getUniformLocation(program, "uSrcTex"), 1);
      }

      var aGrid = gl.getAttribLocation(program, "aGrid");
      gl.bindBuffer(gl.ARRAY_BUFFER, meshVBO);
      gl.enableVertexAttribArray(aGrid);
      gl.vertexAttribPointer(aGrid, 2, gl.FLOAT, false, 0, 0);
      gl.lineWidth(lineWidth);

      // PASS 1: Hologram body or source image
      if (holoMode && srcLoaded) {
        if (splitElev) gl.uniform1f(gl.getUniformLocation(program, "uElevOverride"), srcElevVal);
        gl.uniform1f(gl.getUniformLocation(program, "uRenderMode"), 2.0);
        gl.uniform1f(gl.getUniformLocation(program, "uGlowPass"), 0.0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshTriIBO);
        gl.drawElements(gl.TRIANGLES, meshTriCount, gl.UNSIGNED_INT, 0);
      } else if (showImage && srcLoaded && !showGrid) {
        gl.uniform1f(gl.getUniformLocation(program, "uRenderMode"), 1.0);
        gl.uniform1f(gl.getUniformLocation(program, "uGlowPass"), 0.0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshTriIBO);
        gl.drawElements(gl.TRIANGLES, meshTriCount, gl.UNSIGNED_INT, 0);
      }

      if (splitElev) gl.uniform1f(gl.getUniformLocation(program, "uElevOverride"), gridElevVal);
      else gl.uniform1f(gl.getUniformLocation(program, "uElevOverride"), -100.0);
      gl.uniform1f(gl.getUniformLocation(program, "uGapOffset"), gap * -0.005);

      // PASS 2: Wireframe grid
      if (showGrid) {
        if (holoMode) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false); }
        gl.uniform1f(gl.getUniformLocation(program, "uRenderMode"), 0.0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshLineIBO);
        if (glow > 0) { gl.uniform1f(gl.getUniformLocation(program, "uGlowPass"), 1.0); gl.drawElements(gl.LINES, meshLineCount, gl.UNSIGNED_INT, 0); }
        gl.uniform1f(gl.getUniformLocation(program, "uGlowPass"), 0.0);
        gl.drawElements(gl.LINES, meshLineCount, gl.UNSIGNED_INT, 0);
        if (holoMode) { gl.disable(gl.BLEND); gl.depthMask(true); }
      }

      // PASS 3: Points for dot/dotmatrix
      if (showGrid && (curGridType === "dot" || curGridType === "dotmatrix")) {
        if (holoMode) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false); }
        gl.uniform1f(gl.getUniformLocation(program, "uRenderMode"), 3.0);
        gl.uniform1f(gl.getUniformLocation(program, "uGlowPass"), 0.0);
        gl.drawArrays(gl.POINTS, 0, lastDensity * lastDensity);
        if (holoMode) { gl.disable(gl.BLEND); gl.depthMask(true); }
      }

      gl.disableVertexAttribArray(aGrid);
      drawGizmo(rx, ry, parseFloat($("elev-rz")?.value || "0") * Math.PI / 180);
    }

    function drawGizmo(rx, ry, rz) {
      var gc = $("gizmo-canvas");
      if (!gc || elevCanvas.style.display === "none") { gc.style.display = "none"; return; }
      gc.style.display = "";
      var s = 100 * (window.devicePixelRatio || 1);
      gc.width = s; gc.height = s;
      var g = gc.getContext("2d");
      g.clearRect(0, 0, s, s);
      var gCx = s * 0.45, gCy = s * 0.5, len = s * 0.3;
      var cRx = Math.cos(rx), sRx = Math.sin(rx);
      var cRy = Math.cos(ry), sRy = Math.sin(ry);
      var cRz = Math.cos(rz), sRz = Math.sin(rz);

      function project(x, y, z) {
        var x1 = (cRy * cRz + sRy * sRx * sRz) * x + cRx * sRz * y + (-sRy * cRz + cRy * sRx * sRz) * z;
        var y1 = (-cRy * sRz + sRy * sRx * cRz) * x + cRx * cRz * y + (sRy * sRz + cRy * sRx * cRz) * z;
        return { x: gCx + x1 * len, y: gCy - y1 * len };
      }

      var axes = [
        { dx: 1, dy: 0, dz: 0, color: "#ff4466", label: "X" },
        { dx: 0, dy: 1, dz: 0, color: "#88dd00", label: "Y" },
        { dx: 0, dy: 0, dz: 1, color: "#4488ff", label: "Z" }
      ];
      axes.forEach(function(a) {
        var p = project(a.dx, a.dy, a.dz);
        a.p = p; a.depth = sRy * cRx * a.dx + (-sRx) * a.dy + cRy * cRx * a.dz;
      });
      axes.sort(function(a, b) { return a.depth - b.depth; });
      var origin = project(0, 0, 0);
      axes.forEach(function(a) {
        g.beginPath(); g.moveTo(origin.x, origin.y); g.lineTo(a.p.x, a.p.y);
        g.strokeStyle = a.color; g.lineWidth = 2.5; g.stroke();
        g.beginPath(); g.arc(a.p.x, a.p.y, s * 0.08, 0, Math.PI * 2);
        g.fillStyle = a.color; g.fill();
        g.fillStyle = "#fff"; g.font = "bold " + Math.round(s * 0.12) + "px sans-serif";
        g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(a.label, a.p.x, a.p.y);
      });
      g.beginPath(); g.arc(origin.x, origin.y, s * 0.04, 0, Math.PI * 2);
      g.fillStyle = "#aaa"; g.fill();
    }

    // CRT continuous render loop
    var crtLoopId = null;
    function startCrtLoop() {
      if (crtLoopId) return;
      function crtTick() {
        var needsAnim = holoMode || (parseFloat($("elev-scan-speed")?.value || "0") > 0 && $("elev-scanlines")?.checked);
        if (needsAnim && elevCanvas.style.display !== "none" && !animId) render();
        crtLoopId = requestAnimationFrame(crtTick);
      }
      crtLoopId = requestAnimationFrame(crtTick);
    }
    function stopCrtLoop() { if (crtLoopId) { cancelAnimationFrame(crtLoopId); crtLoopId = null; } }

    function showElevCanvas() {
      if (!depthLoaded) { loadDepth(function() { loadSourceImage(function() { showElevCanvas(); }); }); return; }
      if (holoMode && !srcLoaded) { loadSourceImage(function() { showElevCanvas(); }); return; }
      elevCanvas.width = 1200; elevCanvas.height = 800;
      $("previewCanvas").style.display = "none";
      elevCanvas.style.display = "block";
      if ($("canvasPlaceholder")) $("canvasPlaceholder").style.display = "none";
      render();
      startCrtLoop();
    }

    function hideElevCanvas() {
      stopCrtLoop();
      elevCanvas.style.display = "none";
      $("previewCanvas").style.display = "";
      stopAnimation();
    }

    window._elevRenderer = {
      show: function(asHolo) { holoMode = !!asHolo; showElevCanvas(); },
      hide: function() { holoMode = false; hideElevCanvas(); },
      render: render,
      reload: function(cb) { depthLoaded = false; srcLoaded = false; lastSmoothing = -1; loadDepth(function() { loadSourceImage(cb); }); },
      getCanvas: function() { return elevCanvas; },
      setHoloMode: function(v) { holoMode = v; }
    };

    // Drag orbit
    var orbiting = false, startX = 0, startY = 0, startRX = 0, startRY = 0;
    elevCanvas.addEventListener("mousedown", function(e) {
      orbiting = true; startX = e.clientX; startY = e.clientY;
      startRY = parseFloat($("elev-ry").value); startRX = parseFloat($("elev-rx").value);
      elevCanvas.style.cursor = "grabbing"; e.preventDefault();
    });
    window.addEventListener("mousemove", function(e) {
      if (!orbiting) return;
      var dx = e.clientX - startX, dy = e.clientY - startY;
      var newRY = Math.max(-180, Math.min(180, startRY + dx * 0.5));
      var newRX = Math.max(-90, Math.min(90, startRX + dy * 0.3));
      $("elev-ry").value = newRY; $("elev-rx").value = newRX;
      $("elev-ry-v").textContent = Math.round(newRY) + "\u00B0";
      $("elev-rx-v").textContent = Math.round(newRX) + "\u00B0";
      render();
    });
    window.addEventListener("mouseup", function() { if (orbiting) { orbiting = false; elevCanvas.style.cursor = "grab"; } });
    elevCanvas.addEventListener("wheel", function(e) {
      e.preventDefault();
      var z = $("elev-zoom"); var cur = parseFloat(z.value);
      var delta = e.deltaY > 0 ? -0.1 : 0.1;
      var newZ = Math.max(0.5, Math.min(3, cur + delta));
      z.value = newZ; $("elev-zoom-v").textContent = newZ.toFixed(2); render();
    }, { passive: false });

    // Slider listeners
    ["elev-height", "elev-density", "elev-linewidth", "elev-glow", "elev-grid-color", "elev-grid-color2", "elev-bg-color", "elev-scan-opacity", "elev-scan-speed", "elev-gap", "elev-bloom", "elev-smooth", "elev-rz"].forEach(function(id) {
      var el = $(id); if (el) el.addEventListener("input", function() { if (elevCanvas.style.display !== "none") render(); });
    });
    ["elev-grid", "elev-image", "elev-scanlines", "elev-grid-type", "elev-scan-dir"].forEach(function(id) {
      var el = $(id); if (el) el.addEventListener("change", function() { if (elevCanvas.style.display !== "none") render(); });
    });
    ["holo-color1", "holo-color2", "holo-bg", "holo-color-mid", "holo-src-color", "holo-src-tint", "holo-edges", "holo-chromatic", "holo-noise", "holo-bloom", "holo-transparency", "holo-scan-density", "holo-scan-opacity", "holo-scan-speed", "holo-gap", "holo-dither-size", "holo-grid-density", "holo-smooth"].forEach(function(id) {
      var el = $(id); if (el) el.addEventListener("input", function() { if (elevCanvas.style.display !== "none" && holoMode) render(); });
    });
    ["holo-scanlines", "holo-dither", "holo-grid", "holo-grid-type", "holo-scan-dir", "holo-dither-style"].forEach(function(id) {
      var el = $(id); if (el) el.addEventListener("change", function() { if (elevCanvas.style.display !== "none" && holoMode) render(); });
    });

    // Animations
    function stopAnimation() {
      if (animId) { cancelAnimationFrame(animId); animId = null; }
      animType = null;
      if ($("elev-anim-select")) $("elev-anim-select").value = "";
      if ($("holo-anim-select")) $("holo-anim-select").value = "";
    }

    var TWO_PI = Math.PI * 2;
    function getAnimSpeed() { return parseFloat($("elev-anim-speed")?.value || $("holo-anim-speed")?.value || "1"); }
    function getAnimDir() { return parseInt($("elev-anim-dir")?.value || $("holo-anim-dir")?.value || "1"); }

    function setCamera(rx, ry, rz, zm) {
      $("elev-rx").value = rx; $("elev-rx-v").textContent = Math.round(rx) + "\u00B0";
      $("elev-ry").value = ry; $("elev-ry-v").textContent = Math.round(ry) + "\u00B0";
      if ($("elev-rz")) { $("elev-rz").value = rz; $("elev-rz-v").textContent = Math.round(rz) + "\u00B0"; }
      $("elev-zoom").value = zm; $("elev-zoom-v").textContent = zm.toFixed(2);
      if ($("holo-rx")) { $("holo-rx").value = rx; $("holo-rx-v").textContent = Math.round(rx) + "\u00B0"; }
      if ($("holo-ry")) { $("holo-ry").value = ry; $("holo-ry-v").textContent = Math.round(ry) + "\u00B0"; }
      if ($("holo-rz")) { $("holo-rz").value = rz; $("holo-rz-v").textContent = Math.round(rz) + "\u00B0"; }
      if ($("holo-zoom")) $("holo-zoom").value = zm;
    }

    function applyAnimFrame(type, t, baseRX, baseRY, baseRZ, baseZoom) {
      var frac = t / TWO_PI;
      if (type === "orbit-y" || type === "orbit") {
        var ry = baseRY + frac * 360; while (ry > 180) ry -= 360; setCamera(baseRX, ry, baseRZ, baseZoom);
      } else if (type === "orbit-x") {
        var rx = baseRX + frac * 360; while (rx > 180) rx -= 360; setCamera(rx, baseRY, baseRZ, baseZoom);
      } else if (type === "orbit-z") {
        var rz = baseRZ + frac * 360; while (rz > 180) rz -= 360; setCamera(baseRX, baseRY, rz, baseZoom);
      } else if (type === "wiggle") {
        setCamera(baseRX, baseRY - Math.cos(t) * 15, baseRZ, baseZoom);
      } else if (type === "spin") {
        var sry = baseRY + frac * 360; var srx = baseRX + Math.sin(t) * 25; var srz = baseRZ + frac * 180;
        while (sry > 180) sry -= 360; while (srz > 180) srz -= 360; setCamera(srx, sry, srz, baseZoom);
      } else if (type === "handheld") {
        setCamera(baseRX + Math.sin(t * 2) * 2.5 + Math.sin(t * 5) * 1.2, baseRY + Math.sin(t * 3) * 3.0 + Math.sin(t * 7) * 1.0, baseRZ + Math.sin(t * 4) * 1.0, baseZoom);
      } else if (type === "dolly") {
        var dz = baseZoom + Math.sin(t) * 0.8;
        $("elev-zoom").value = dz; $("elev-zoom-v").textContent = dz.toFixed(2);
        if ($("holo-zoom")) $("holo-zoom").value = dz;
        setCamera(baseRX, baseRY + Math.sin(t * 2) * 8, baseRZ, dz);
      } else if (type === "breathe") {
        var baseElev = parseFloat($("elev-height").value);
        var pulseElev = baseElev + Math.sin(t * 2) * 0.05;
        $("elev-height").value = pulseElev; $("elev-height-v").textContent = pulseElev.toFixed(2);
        if ($("holo-elev-height")) $("holo-elev-height").value = pulseElev;
        setCamera(baseRX, baseRY + Math.sin(t) * 15, baseRZ, baseZoom);
      } else if (type === "tilt") {
        setCamera(baseRX + Math.sin(t) * 30, baseRY + Math.sin(t * 2) * 20, baseRZ, baseZoom);
      } else if (type === "flyover") {
        var fzm = baseZoom + Math.sin(t * 2) * 0.3;
        var fry = baseRY + frac * 360; while (fry > 180) fry -= 360;
        setCamera(baseRX + Math.sin(t) * 25 - 40, fry, baseRZ, fzm);
        $("elev-zoom").value = fzm; $("elev-zoom-v").textContent = fzm.toFixed(2);
        if ($("holo-zoom")) $("holo-zoom").value = fzm;
      }
    }

    function startAnimation(type) {
      stopAnimation();
      animType = type; animT = 0;
      var baseRX = parseFloat($("elev-rx").value);
      var baseRY = parseFloat($("elev-ry").value);
      var baseRZ = parseFloat($("elev-rz")?.value || "0");
      var baseZoom = parseFloat($("elev-zoom").value);
      if (elevCanvas.style.display === "none") {
        var isHolo = document.querySelector(".fx-tab.active")?.dataset.fx === "hologram";
        showElevCanvas(); if (isHolo) holoMode = true;
      }
      function tick() {
        var speed = getAnimSpeed(); var dir = getAnimDir();
        animT += 0.01 * speed * dir;
        if (animT >= TWO_PI) animT -= TWO_PI;
        if (animT < 0) animT += TWO_PI;
        applyAnimFrame(animType, animT, baseRX, baseRY, baseRZ, baseZoom);
        render();
        animId = requestAnimationFrame(tick);
      }
      animId = requestAnimationFrame(tick);
    }

    function exportAnimation(format) {
      if (!animType && !$("elev-anim-select").value && !$("holo-anim-select").value) { logMsg("Select an animation first", "warn"); return; }
      var type = animType || $("elev-anim-select").value || $("holo-anim-select").value;
      if (!type) { logMsg("Select an animation first", "warn"); return; }
      stopAnimation();
      logMsg("Capturing animation frames...", "info");
      var fps = 24, duration = 3, totalFrames = fps * duration;
      var baseRX = parseFloat($("elev-rx").value), baseRY = parseFloat($("elev-ry").value);
      var baseRZ = parseFloat($("elev-rz")?.value || "0"), baseZoom = parseFloat($("elev-zoom").value);
      var frames = [], frameIdx = 0;
      function captureNext() {
        if (frameIdx >= totalFrames) { sendFramesForExport(frames, fps, format); return; }
        applyAnimFrame(type, (frameIdx / totalFrames) * TWO_PI, baseRX, baseRY, baseRZ, baseZoom);
        render();
        elevCanvas.toBlob(function(blob) { frames.push(blob); frameIdx++; setTimeout(captureNext, 0); }, "image/png");
      }
      captureNext();
    }

    async function sendFramesForExport(frames, fps, format) {
      try {
        logMsg("Encoding " + frames.length + " frames as " + format + "...", "info");
        var fd = new FormData();
        for (var i = 0; i < frames.length; i++) fd.append("frames", frames[i], "frame_" + String(i).padStart(4, "0") + ".png");
        fd.append("fps", fps.toString()); fd.append("format", format); fd.append("loop", "true");
        var r = await fetch(SERVER + "/animate/export", { method: "POST", body: fd });
        if (!r.ok) throw new Error("Export failed: " + r.status);
        var blob = await r.blob();
        var ext = format === "gif" ? ".gif" : ".mp4";
        var name = (state.sourceFile?.name || "animation").replace(/\.[^.]+$/, "") + "_3d" + ext;
        await DS.saveBlob(blob, name);
        logMsg("Animation saved: " + name, "ok");
      } catch(e) { logMsg("Export error: " + e.message, "err"); }
    }

    window._elevExport = exportAnimation;

    // Glow style presets
    var glowPresets = {
      "cyber": { near: "#00ff88", far: "#0044ff", bg: "#0a0a14", glow: 0.8, bloom: 1.5 },
      "neon-pink": { near: "#ff00ff", far: "#ff6ec7", bg: "#0d0015", glow: 0.9, bloom: 2.0 },
      "vaporwave": { near: "#ff71ce", far: "#01cdfe", bg: "#120025", glow: 0.7, bloom: 1.8 },
      "matrix": { near: "#00ff41", far: "#008f11", bg: "#000000", glow: 0.6, bloom: 1.2 },
      "fire": { near: "#ffff00", far: "#ff2200", bg: "#0a0000", glow: 0.8, bloom: 2.2 },
      "ice": { near: "#ffffff", far: "#00b4d8", bg: "#001220", glow: 0.7, bloom: 1.6 },
      "gold": { near: "#ffd700", far: "#b8860b", bg: "#0a0800", glow: 0.9, bloom: 1.8 },
      "sunset": { near: "#ff6b35", far: "#9b2335", bg: "#0a0510", glow: 0.7, bloom: 1.5 },
      "ocean": { near: "#00ffff", far: "#000080", bg: "#000510", glow: 0.8, bloom: 1.4 },
      "toxic": { near: "#39ff14", far: "#ccff00", bg: "#050a00", glow: 1.0, bloom: 2.5 },
      "plasma": { near: "#ff00ff", far: "#0000ff", bg: "#050005", glow: 0.9, bloom: 2.0 },
      "hologram": { near: "#00ffff", far: "#ff00ff", bg: "#000008", glow: 0.8, bloom: 2.2 },
      "midnight": { near: "#4169e1", far: "#191970", bg: "#000005", glow: 0.5, bloom: 1.0 },
      "lava": { near: "#ff4500", far: "#8b0000", bg: "#0a0000", glow: 1.0, bloom: 2.8 },
      "aurora": { near: "#00ff88", far: "#8b00ff", bg: "#000a10", glow: 0.7, bloom: 1.6 }
    };

    $("elev-glow-preset").addEventListener("change", function() {
      var p = glowPresets[this.value]; if (!p) return;
      $("elev-grid-color").value = p.near; $("elev-grid-color2").value = p.far; $("elev-bg-color").value = p.bg;
      $("elev-glow").value = p.glow; $("elev-glow-v").textContent = p.glow.toFixed(2);
      $("elev-bloom").value = p.bloom; $("elev-bloom-v").textContent = p.bloom.toFixed(1);
      if (elevCanvas.style.display !== "none") render();
    });
    ["elev-grid-color", "elev-grid-color2", "elev-bg-color"].forEach(function(id) {
      $(id).addEventListener("input", function() { $("elev-glow-preset").value = ""; });
    });

    // Camera presets
    var camPresets = {
      "default": { rx: -35, ry: 15, zoom: 1.2 }, "iso": { rx: -35, ry: 45, zoom: 1.2 },
      "top": { rx: -90, ry: 0, zoom: 1.0 }, "front": { rx: 0, ry: 0, zoom: 1.2 },
      "side": { rx: 0, ry: 90, zoom: 1.2 }, "close": { rx: -60, ry: 30, zoom: 1.5 },
      "rear": { rx: -20, ry: 160, zoom: 1.0 }, "wide": { rx: -70, ry: -45, zoom: 0.8 }
    };

    function applyCamPreset(val) {
      var p = camPresets[val]; if (!p) return;
      stopAnimation();
      setCamera(p.rx, p.ry, p.rz || 0, p.zoom);
      if (elevCanvas.style.display === "none") {
        var isHolo = document.querySelector(".fx-tab.active")?.dataset.fx === "hologram";
        if (isHolo) holoMode = true;
        showElevCanvas();
      } else { render(); }
    }

    ["elev-cam-preset", "holo-cam-preset"].forEach(function(id) {
      var el = $(id); if (el) el.addEventListener("change", function() { applyCamPreset(this.value); });
    });
    ["elev-anim-select", "holo-anim-select"].forEach(function(id) {
      var el = $(id); if (el) el.addEventListener("change", function() {
        if ($("elev-anim-select")) $("elev-anim-select").value = this.value;
        if ($("holo-anim-select")) $("holo-anim-select").value = this.value;
        if (this.value) startAnimation(this.value); else stopAnimation();
      });
    });
    ["elev-anim-speed", "holo-anim-speed"].forEach(function(id) {
      var el = $(id); if (el) el.addEventListener("input", function() {
        if ($("elev-anim-speed")) $("elev-anim-speed").value = this.value;
        if ($("holo-anim-speed")) $("holo-anim-speed").value = this.value;
        if ($("elev-anim-speed-v")) $("elev-anim-speed-v").textContent = parseFloat(this.value).toFixed(1) + "\u00D7";
        if ($("holo-anim-speed-v")) $("holo-anim-speed-v").textContent = parseFloat(this.value).toFixed(1) + "\u00D7";
      });
    });
    ["elev-anim-dir", "holo-anim-dir"].forEach(function(id) {
      var el = $(id); if (el) el.addEventListener("change", function() {
        if ($("elev-anim-dir")) $("elev-anim-dir").value = this.value;
        if ($("holo-anim-dir")) $("holo-anim-dir").value = this.value;
      });
    });

    // Plus/minus buttons
    document.querySelectorAll(".pm-btn").forEach(function(btn) {
      btn.addEventListener("click", function() {
        var target = $(btn.dataset.target); if (!target) return;
        var step = parseFloat(btn.dataset.step);
        var min = parseFloat(target.min), max = parseFloat(target.max);
        var val = Math.max(min, Math.min(max, parseFloat(target.value) + step));
        target.value = val; target.dispatchEvent(new Event("input"));
        if (elevCanvas.style.display !== "none") render();
      });
    });

    // Hologram style presets
    var holoStyles = {
      "gits": { c1: "#00ff88", c2: "#003322", mid: "#00aa55", bg: "#000505" },
      "akira": { c1: "#ff6600", c2: "#441100", mid: "#cc3300", bg: "#050000", gridType: "polygon", scanSpeed: 0.8 },
      "eva": { c1: "#9933ff", c2: "#220066", mid: "#6622cc", bg: "#050008", gridType: "hex", dither: true, ditherStyle: "bayer4" },
      "blade": { c1: "#00ccff", c2: "#003366", mid: "#006699", bg: "#000510", scanSpeed: 0.3, scanDir: -1, gap: 15 },
      "nerv": { c1: "#ff0066", c2: "#330015", mid: "#990033", bg: "#050005", gridType: "cross", scanSpeed: 1.0 },
      "tron": { c1: "#00dfff", c2: "#004466", mid: "#0088cc", bg: "#000008", gridType: "square", gap: 10 },
      "robocop": { c1: "#00ff44", c2: "#004411", mid: "#00aa22", bg: "#000800", splitElev: true, srcElev: 0, gridElev: 0.15, scanSpeed: 1.5, scanDensity: 4, gap: 20, dither: false, ditherStyle: "none", gridType: "square" },
      "predator": { c1: "#ffff00", c2: "#ff0000", mid: "#ff8800", bg: "#000400", srcTint: 0.6, srcColor: "#ff4400", dither: true, ditherStyle: "noise", gridType: "dot", scanSpeed: 0.2, gap: -30 },
      "ironman": { c1: "#00ccff", c2: "#ff8800", mid: "#44aaff", bg: "#040810", splitElev: true, srcElev: 0.05, gridElev: 0.25, gridType: "hex", scanSpeed: 2.0, scanDensity: 3, gap: 30, dither: false, ditherStyle: "none" },
      "matrix": { c1: "#00ff00", c2: "#003300", mid: "#008800", bg: "#000200", gridType: "dotmatrix", scanSpeed: 2.5, scanDir: 1, dither: true, ditherStyle: "bayer4", gap: 5 },
      "terminator": { c1: "#ff0000", c2: "#440000", mid: "#cc0000", bg: "#080000", splitElev: true, srcElev: 0, gridElev: 0.1, srcTint: 0.4, srcColor: "#ff2200", gridType: "cross", scanSpeed: 0.5, dither: false, ditherStyle: "none" },
      "alien": { c1: "#33ff66", c2: "#003310", mid: "#118833", bg: "#000800", gridType: "square", scanSpeed: 0.4, scanDensity: 6, dither: true, ditherStyle: "halftone", gap: 0 },
      "minority": { c1: "#aaccff", c2: "#002244", mid: "#4488cc", bg: "#000208", splitElev: true, srcElev: 0.08, gridElev: 0.2, gridType: "polygon", srcTint: 0.3, srcColor: "#88bbff", scanSpeed: 0.6, scanDir: -1, gap: 25 },
      "cyberpunk": { c1: "#ff00ff", c2: "#00ffff", mid: "#ff44aa", bg: "#080010", gridType: "polygon", scanSpeed: 1.8, dither: true, ditherStyle: "crosshatch", gap: -10 },
      "westworld": { c1: "#ffffff", c2: "#444444", mid: "#999999", bg: "#0a0a0a", gridType: "polygon", dither: false, ditherStyle: "none", scanSpeed: 0.1, gap: 0, srcTint: 0.15, srcColor: "#ffffff" },
      "prometheus": { c1: "#4488ff", c2: "#001133", mid: "#2266cc", bg: "#000108", splitElev: true, srcElev: 0, gridElev: 0.3, gridType: "dot", scanSpeed: 1.2, scanDir: -1, gap: 40, dither: false, ditherStyle: "none" }
    };

    $("holo-style").addEventListener("change", function() {
      var s = holoStyles[this.value]; if (!s) return;
      $("holo-color1").value = s.c1; $("holo-color2").value = s.c2; $("holo-bg").value = s.bg;
      if (s.splitElev) {
        $("holo-split-elev").checked = true; $("holo-split-controls").style.display = "";
        $("holo-src-elev").value = s.srcElev; $("holo-src-elev-v").textContent = s.srcElev.toFixed(2);
        $("holo-grid-elev").value = s.gridElev; $("holo-grid-elev-v").textContent = s.gridElev.toFixed(2);
      } else { $("holo-split-elev").checked = false; $("holo-split-controls").style.display = "none"; }
      if (s.mid) $("holo-color-mid").value = s.mid;
      if (s.dither !== undefined) $("holo-dither").checked = s.dither;
      if (s.ditherStyle) $("holo-dither-style").value = s.ditherStyle;
      if (s.scanSpeed !== undefined) { $("holo-scan-speed").value = s.scanSpeed; $("holo-scan-speed-v").textContent = s.scanSpeed.toFixed(1); }
      if (s.scanDensity !== undefined) { $("holo-scan-density").value = s.scanDensity; $("holo-scan-density-v").textContent = s.scanDensity + "px"; }
      if (s.scanDir !== undefined && $("holo-scan-dir")) $("holo-scan-dir").value = s.scanDir;
      if (s.gap !== undefined) { $("holo-gap").value = s.gap; $("holo-gap-v").textContent = s.gap; }
      if (s.gridType && $("holo-grid-type")) $("holo-grid-type").value = s.gridType;
      if (s.srcTint !== undefined) { $("holo-src-tint").value = s.srcTint; $("holo-src-tint-v").textContent = s.srcTint.toFixed(2); }
      if (s.srcColor) $("holo-src-color").value = s.srcColor;
      drawHoloGradmap();
      if (elevCanvas.style.display !== "none") render();
    });
    ["holo-color1", "holo-color2", "holo-bg", "holo-color-mid", "holo-src-color"].forEach(function(id) {
      $(id).addEventListener("input", function() { $("holo-style").value = "custom"; if (elevCanvas.style.display !== "none") render(); });
    });

    // Gradient map builder
    var holoGradPresets = {
      none: null, matrix: ["#001100", "#003300", "#00ff44"], infrared: ["#000040", "#ff0040", "#ffff00"],
      ocean: ["#000820", "#0044aa", "#00ffcc"], fire: ["#100000", "#ff4400", "#ffee00"],
      neon: ["#ff00ff", "#00ffff", "#ffff00"], thermal: ["#000040", "#ff0000", "#ffff00"],
      midnight: ["#0a0020", "#2244aa", "#88aaff"]
    };
    function drawHoloGradmap() {
      var cv = $("holo-gradmap"); if (!cv) return;
      var ctx2 = cv.getContext("2d");
      var c1 = $("holo-color2").value, c2 = $("holo-color-mid").value, c3 = $("holo-color1").value;
      var g = ctx2.createLinearGradient(0, 0, cv.width, 0);
      g.addColorStop(0, c1); g.addColorStop(0.5, c2); g.addColorStop(1, c3);
      ctx2.fillStyle = g; ctx2.fillRect(0, 0, cv.width, cv.height);
    }
    drawHoloGradmap();
    ["holo-color1", "holo-color2", "holo-color-mid"].forEach(function(id) { $(id).addEventListener("input", drawHoloGradmap); });
    $("holo-gradmap-preset").addEventListener("change", function() {
      var p = holoGradPresets[this.value]; if (!p) return;
      $("holo-color2").value = p[0]; $("holo-color-mid").value = p[1]; $("holo-color1").value = p[2];
      drawHoloGradmap(); $("holo-style").value = "custom";
      if (elevCanvas.style.display !== "none") render();
    });

    // Split elevation toggle
    $("holo-split-elev").addEventListener("change", function() {
      $("holo-split-controls").style.display = this.checked ? "" : "none";
      if (elevCanvas.style.display !== "none") render();
    });
    ["holo-src-elev", "holo-grid-elev"].forEach(function(id) {
      var el = $(id); if (el) el.addEventListener("input", function() { if (elevCanvas.style.display !== "none") render(); });
    });
    ["holo-density", "holo-glow", "holo-smooth", "holo-elev-height", "holo-rx", "holo-ry", "holo-rz", "holo-zoom", "holo-linewidth", "holo-bloom2"].forEach(function(id) {
      var el = $(id); if (el) el.addEventListener("input", function() { if (elevCanvas.style.display !== "none") render(); });
    });

    // Export buttons
    ["elev-export-gif", "holo-export-gif"].forEach(function(id) {
      var el = $(id); if (el) el.addEventListener("click", function() { exportAnimation("gif"); });
    });
    ["elev-export-mp4", "holo-export-mp4"].forEach(function(id) {
      var el = $(id); if (el) el.addEventListener("click", function() { exportAnimation("mp4"); });
    });
  })();

})();
