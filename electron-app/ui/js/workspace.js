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

  var VIDEO_EXTS = ['.mp4', '.mov', '.webm', '.avi', '.mkv', '.m4v'];
  function isVideoFile(name) {
    var ext = '.' + name.split('.').pop().toLowerCase();
    return VIDEO_EXTS.indexOf(ext) >= 0;
  }

  on('btnLoadSource', 'click', function() { $('inputSource').click(); });
  on('inputSource', 'change', function(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    state.sourceFile = file;
    state._sourceIsVideo = file.type.startsWith('video/') || isVideoFile(file.name);
    $('sourceFilename').textContent = file.name;
    $('sourceFilename').classList.add('loaded');
    logMsg('Loading source: ' + file.name + (state._sourceIsVideo ? ' (video)' : ''));

    if (state._sourceIsVideo) {
      logMsg('Video source loaded — load matching depth video to enable 3D effects', 'ok');
      _checkVideoReady();
    } else {
      loadFileAsImage(file, function(err, img) {
        if (err) { logMsg(err.message, 'err'); return; }
        state.sourceImg = img;
        drawImage(img);
        $('infoLeft').textContent = img.naturalWidth + ' x ' + img.naturalHeight;
        logMsg('Source loaded: ' + img.naturalWidth + 'x' + img.naturalHeight, 'ok');
      });
    }
  });

  on('btnLoadDepth', 'click', function() { $('inputDepth').click(); });
  on('inputDepth', 'change', function(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    state.depthFile = file;
    state._depthIsVideo = file.type.startsWith('video/') || isVideoFile(file.name);
    $('depthFilename').textContent = file.name;
    $('depthFilename').classList.add('loaded');
    logMsg('Depth map loaded: ' + file.name + (state._depthIsVideo ? ' (video)' : ''), 'ok');

    if (state._depthIsVideo) {
      _checkVideoReady();
    } else {
      loadFileAsImage(file, function(err, img) {
        if (!err) state.depthImg = img;
      });
    }
  });

  // ── Video mode: init when both source + depth videos loaded ──
  function _checkVideoReady() {
    if (!state._sourceIsVideo || !state._depthIsVideo) {
      // Show controls section but indicate need both
      $('ws-video-controls').style.display = 'none';
      return;
    }
    if (!state.sourceFile || !state.depthFile) return;

    logMsg('Both video files loaded — initializing 3D video effects...', 'info');
    $('ws-video-controls').style.display = '';

    // VideoFX will auto-detect FPS from video metadata
    var videoInfo = { fps: 0, duration: 0 };

    // Init VideoFX with both video blobs
    VideoFX.init(state.sourceFile, state.depthFile, videoInfo, $('elev-canvas')).then(function() {
      var dur = VideoFX.getDuration();
      logMsg('Video effects ready: ' + dur.toFixed(1) + 's — use effect tabs + play/scrub', 'ok');
      $('ws-time-total').textContent = _fmtTime(dur);
      $('infoLeft').textContent = 'Video: ' + dur.toFixed(1) + 's';

      // Show export section + enable comb
      $('ws-video-export').style.display = '';
      $('wig-comb-preview').disabled = false;
      $('wig-comb-export').disabled = false;
      $('wig-comb-video-status').textContent = 'Videos loaded ✓';
      $('wig-comb-video-status').style.color = 'var(--ok)';

      // Auto-show elevation
      var fx = state.activeFx || 'elevation';
      VideoFX.show(fx === 'hologram' ? 'hologram' : 'elevation');
      if (window.R3DAdapter) R3DAdapter.syncAll();
    }).catch(function(err) {
      logMsg('Video init failed: ' + err.message, 'err');
    });
  }

  function _fmtTime(s) {
    var m = Math.floor(s / 60);
    var sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }

  // ── Video playback controls ──
  on('ws-play', 'click', function() {
    if (!VideoFX.isActive()) return;
    VideoFX.play();
    $('ws-play').disabled = true;
    $('ws-pause').disabled = false;
    logMsg('Playing', 'ok');
  });

  on('ws-pause', 'click', function() {
    VideoFX.pause();
    $('ws-play').disabled = false;
    $('ws-pause').disabled = true;
  });

  on('ws-stop', 'click', function() {
    VideoFX.pause();
    VideoFX.seek(0);
    $('ws-play').disabled = false;
    $('ws-pause').disabled = true;
  });

  // Timeline scrub
  (function() {
    var track = $('ws-timeline-track');
    if (!track) return;
    var dragging = false;
    function scrub(e) {
      var rect = track.getBoundingClientRect();
      var pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      VideoFX.seekNormalized(pos);
    }
    track.addEventListener('mousedown', function(e) { dragging = true; scrub(e); });
    window.addEventListener('mousemove', function(e) { if (dragging) scrub(e); });
    window.addEventListener('mouseup', function() { dragging = false; });
  })();

  // Update timeline display during playback
  setInterval(function() {
    if (!VideoFX.isActive()) return;
    var t = VideoFX.getPlayhead();
    var dur = VideoFX.getDuration();
    if (dur <= 0) return;
    var pct = (t / dur) * 100;
    $('ws-timeline-fill').style.width = pct + '%';
    $('ws-timeline-head').style.left = pct + '%';
    $('ws-time-current').textContent = _fmtTime(t);
    // Update play/pause state
    if (VideoFX.isPlaying()) {
      $('ws-play').disabled = true;
      $('ws-pause').disabled = false;
    }
  }, 50);

  // ── Video export buttons ──
  on('ws-export-frame', 'click', function() {
    if (!VideoFX.isActive()) return;
    VideoFX.exportFrame().then(function(blob) {
      DS.saveBlob(blob, 'frame_' + VideoFX.getPlayhead().toFixed(2) + 's.png');
      logMsg('Frame exported', 'ok');
    });
  });

  on('ws-export-mp4', 'click', function() { _exportVideo('mp4'); });
  on('ws-export-webm', 'click', function() { _exportVideo('webm'); });

  function _exportVideo(format) {
    if (!VideoFX.isActive()) return;
    $('ws-export-progress').style.display = '';
    $('ws-export-status').textContent = 'Recording...';
    $('ws-export-mp4').disabled = true;
    $('ws-export-webm').disabled = true;
    logMsg('Recording ' + format + '...', 'info');

    VideoFX.exportVideo(format, function(frame, total) {
      var pct = Math.round((frame / total) * 100);
      $('ws-export-bar').style.width = pct + '%';
      $('ws-export-status').textContent = 'Frame ' + frame + '/' + total + ' (' + pct + '%)';
    }).then(function(blob) {
      DS.saveBlob(blob, 'effects_export.' + (format === 'mp4' ? 'mp4' : 'webm'));
      logMsg('Export complete: ' + (blob.size / 1024 / 1024).toFixed(1) + 'MB', 'ok');
      $('ws-export-progress').style.display = 'none';
      $('ws-export-mp4').disabled = false;
      $('ws-export-webm').disabled = false;
    }).catch(function(err) {
      logMsg('Export failed: ' + err.message, 'err');
      $('ws-export-progress').style.display = 'none';
      $('ws-export-mp4').disabled = false;
      $('ws-export-webm').disabled = false;
    });
  }

  // ── Video comb mode ──
  DS.bindRange('wig-comb-sep', 'px');

  on('wig-comb-preview', 'click', function() {
    if (!VideoFX.isActive()) { logMsg('Load source + depth videos first', 'warn'); return; }
    // Comb preview: alternate L/R eye displacement in Three.js
    var sep = parseInt($('wig-comb-sep')?.value || '15');
    var interval = parseInt($('wig-comb-interval')?.value || '3');
    logMsg('Comb preview: sep=' + sep + 'px interval=' + interval + 'f', 'info');
    // Set parallax shift based on comb pattern — the shader already displaces by depth
    // For comb, we toggle elevation sign every N frames during playback
    state._combMode = true;
    state._combInterval = interval;
    state._combSep = sep;
    state._combFrame = 0;
    VideoFX.play();
  });

  on('wig-comb-export', 'click', function() {
    if (!VideoFX.isActive()) { logMsg('Load source + depth videos first', 'warn'); return; }
    var sep = parseInt($('wig-comb-sep')?.value || '15');
    var interval = parseInt($('wig-comb-interval')?.value || '3');
    logMsg('Exporting comb video: sep=' + sep + 'px interval=' + interval + 'f', 'info');
    // Use server-side comb endpoint if source video available
    if (state.sourceFile && state.depthFile) {
      var fd = new FormData();
      fd.append('file', state.sourceFile, state.sourceFile.name);
      fd.append('separation', sep.toString());
      fd.append('interval', interval.toString());
      fd.append('blur_depth', '5');
      fd.append('pivot_x', '0.5');
      fd.append('pivot_y', '0.5');
      DS.fetchWithProgress(SERVER + '/wigglegram/comb', { method: 'POST', body: fd }).then(function(r) {
        if (!r.ok) throw new Error('Server error: ' + r.status);
        return r.blob();
      }).then(function(blob) {
        DS.saveBlob(blob, 'comb_3d.mp4');
        logMsg('Comb video exported', 'ok');
      }).catch(function(err) {
        logMsg('Comb export failed: ' + err.message, 'err');
      });
    }
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
        var fx = tab.getAttribute('data-fx');
        // Video mode: switch 3D effect type
        if (VideoFX.isActive()) {
          if (fx === 'elevation' || fx === 'hologram') {
            VideoFX.show(fx);
            if (window.R3DAdapter) R3DAdapter.syncAll();
          } else {
            VideoFX.hide();
          }
        } else if (fx !== 'elevation' && fx !== 'hologram' && window._elevRenderer) {
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

  // 3D elevation/hologram renderer (Three.js)
  R3DAdapter.init($("elev-canvas"), state);


})();
