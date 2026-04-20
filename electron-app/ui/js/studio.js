/**
 * Wigglegram Studio — studio.js
 * Standalone page for timeline-based wigglegram creation.
 * Depends on: common.js (DS namespace)
 */
(function() {
  'use strict';

  var $ = DS.$;
  var on = DS.on;
  var logMsg = DS.logMsg;
  var SERVER = DS.SERVER;

  // ── Canvas ─────────────────────────────────────────────
  var canvas = $('previewCanvas');
  var ctx = canvas.getContext('2d');

  function sizeCanvas() {
    var container = $('canvasContainer');
    canvas.width = container.clientWidth || 640;
    canvas.height = container.clientHeight || 480;
  }

  // ── State ──────────────────────────────────────────────
  var clips = [];
  var selectedIdx = -1;
  var nextId = 0;
  var pb = { active: false, clipIdx: 0, frameIdx: 0, loopNum: 0, lastTime: 0, animId: null, elapsed: 0 };
  var audio = { file: null, buffer: null, audioCtx: null, source: null, duration: 0, offset: 0 };
  var pool = { sources: [], depths: [], gifs: [], nextId: 0 };
  var _wsPresets = null;

  // ── GIF Decode via ImageDecoder (WebCodecs) ────────────
  async function decodeGIF(file) {
    if (typeof ImageDecoder === 'undefined') throw new Error('ImageDecoder not available');
    var buf = await file.arrayBuffer();
    var dec = new ImageDecoder({ data: buf, type: 'image/gif' });
    await dec.tracks.ready;
    var count = dec.tracks.selectedTrack.frameCount;
    var frames = [];
    for (var i = 0; i < count; i++) {
      var res = await dec.decode({ frameIndex: i, completeFramesOnly: true });
      var vf = res.image;
      var cv = document.createElement('canvas');
      cv.width = vf.displayWidth; cv.height = vf.displayHeight;
      cv.getContext('2d').drawImage(vf, 0, 0);
      frames.push({ canvas: cv, delay: Math.max((vf.duration || 100000) / 1000, 20) });
      vf.close();
    }
    dec.close();
    return { width: frames[0].canvas.width, height: frames[0].canvas.height, frames: frames };
  }

  // ── Media pool ─────────────────────────────────────────
  function classifyImage(file) {
    var name = file.name.toLowerCase();
    if (file.type === 'image/gif') return 'gif';
    if (name.includes('depth') || name.includes('_d.') || name.includes('_depth')) return 'depth';
    return 'source';
  }

  async function addToPool(file) {
    var type = classifyImage(file);
    if (type === 'gif') {
      pool.gifs.push({ id: pool.nextId++, file: file, name: file.name, thumbUrl: null });
      logMsg('GIF added to pool: ' + file.name, 'ok');
    } else {
      var url = URL.createObjectURL(file);
      var entry = { id: pool.nextId++, file: file, name: file.name, thumbUrl: url };
      if (type === 'depth') pool.depths.push(entry);
      else pool.sources.push(entry);
      logMsg((type === 'depth' ? 'Depth map' : 'Source') + ' added: ' + file.name, 'ok');
    }
    renderPool();
    updatePairSelects();
  }

  function removeFromPool(type, idx) {
    pool[type].splice(idx, 1);
    renderPool();
    updatePairSelects();
  }

  function renderPool() {
    var el = $('media-pool');
    el.innerHTML = '';
    var all = [];
    pool.sources.forEach(function(s, i) { all.push({ type: 'sources', idx: i, tag: 'source', item: s }); });
    pool.depths.forEach(function(d, i) { all.push({ type: 'depths', idx: i, tag: 'depth', item: d }); });
    pool.gifs.forEach(function(g, i) { all.push({ type: 'gifs', idx: i, tag: 'gif', item: g }); });
    if (!all.length) { el.innerHTML = '<div class="tl-empty" style="padding:8px 0">No media loaded</div>'; return; }
    all.forEach(function(entry) {
      var div = document.createElement('div');
      div.className = 'mp-item';
      var thumbHtml = entry.item.thumbUrl ? '<img class="mp-thumb" src="' + entry.item.thumbUrl + '"/>' : '<div class="mp-thumb"></div>';
      div.innerHTML = thumbHtml +
        '<span class="mp-name">' + entry.item.name + '</span>' +
        '<span class="mp-tag ' + entry.tag + '">' + entry.tag + '</span>' +
        '<button class="mp-remove" title="Remove">&times;</button>';
      div.querySelector('.mp-remove').addEventListener('click', function() { removeFromPool(entry.type, entry.idx); });
      el.appendChild(div);
    });
  }

  function updatePairSelects() {
    var srcSel = $('stc-source');
    var depSel = $('stc-depth');
    if (!srcSel || !depSel) return;
    var srcVal = srcSel.value;
    var depVal = depSel.value;
    srcSel.innerHTML = '<option value="">— select source —</option>';
    depSel.innerHTML = '<option value="">— select depth —</option>';
    pool.sources.forEach(function(s) { srcSel.innerHTML += '<option value="' + s.id + '">' + s.name + '</option>'; });
    pool.depths.forEach(function(d) { depSel.innerHTML += '<option value="' + d.id + '">' + d.name + '</option>'; });
    if (srcVal) srcSel.value = srcVal;
    if (depVal) depSel.value = depVal;
  }

  // ── Film filter ────────────────────────────────────────
  function getStudioFilmFilter() {
    return {
      grain_amount: parseFloat($('stf-grain')?.value || '0'),
      grain_opacity: parseFloat($('stf-grain-opacity')?.value || '1'),
      blur_strength: parseFloat($('stf-bgblur')?.value || '0'),
      flash_intensity: parseFloat($('stf-flash')?.value || '0'),
      vignette_strength: parseFloat($('stf-vignette')?.value || '0'),
      light_leak_opacity: parseFloat($('stf-leak')?.value || '0'),
      light_leak_style: $('stf-leak-style')?.value || 'amber-corner',
      halation_radius: parseFloat($('stf-halation')?.value || '0'),
      contrast: parseFloat($('stf-contrast')?.value || '0'),
      saturation: parseFloat($('stf-saturation')?.value || '0'),
      fade: parseFloat($('stf-fade')?.value || '0'),
      tint_color: $('stf-tint-color')?.value || '',
      tint_strength: parseFloat($('stf-tint-strength')?.value || '0'),
      gradient_map: $('stf-gradient-map')?.value || 'none',
    };
  }

  // ── Wigglegram generation ──────────────────────────────
  async function generateWigglegram(clip) {
    if (!clip.sourceId && clip.sourceId !== 0) { logMsg('Select source image', 'warn'); return; }
    if (!clip.depthId && clip.depthId !== 0) { logMsg('Select depth map', 'warn'); return; }
    var src = pool.sources.find(function(s) { return s.id === clip.sourceId; });
    var dep = pool.depths.find(function(d) { return d.id === clip.depthId; });
    if (!src || !dep) { logMsg('Source or depth missing from pool', 'err'); return; }

    logMsg('Creating session for ' + src.name + '...');
    var fd = new FormData();
    fd.append('source', src.file, src.name);
    fd.append('depth', dep.file, dep.name);
    var r = await DS.fetchWithProgress(SERVER + '/session/create', { method: 'POST', body: fd });
    if (!r.ok) throw new Error('Session create failed: ' + r.status);
    var sData = await r.json();
    var sid = sData.session_id;
    logMsg('Session: ' + sid + ', generating wigglegram...', 'ok');

    var fd2 = new FormData();
    fd2.append('session_id', sid);
    fd2.append('num_views', (clip.views || 5).toString());
    fd2.append('separation', (clip.separation || 15).toString());
    fd2.append('path', clip.path || 'linear');
    fd2.append('format', 'gif');
    fd2.append('fps', '12');
    fd2.append('film_filter_json', JSON.stringify(getStudioFilmFilter()));
    var r2 = await DS.fetchWithProgress(SERVER + '/wigglegram', { method: 'POST', body: fd2 });
    if (!r2.ok) throw new Error('Wigglegram failed: ' + r2.status);
    var blob = await r2.blob();

    var gifFile = new File([blob], src.name.replace(/\.[^.]+$/, '') + '_wiggle.gif', { type: 'image/gif' });
    var gif = await decodeGIF(gifFile);
    var thumbUrl = gif.frames[0].canvas.toDataURL('image/png');
    var totalDur = 0;
    for (var i = 0; i < gif.frames.length; i++) totalDur += gif.frames[i].delay;
    clip.gif = gif; clip.thumbUrl = thumbUrl; clip.totalDur = totalDur; clip.name = gifFile.name;
    logMsg('Generated: ' + gif.frames.length + ' frames', 'ok');
    renderTimeline();
    selectClip(selectedIdx);
  }

  // ── Clip management ────────────────────────────────────
  function addPairClip() {
    clips.push({
      id: nextId++, name: '(not generated)', gif: null, thumbUrl: null, totalDur: 0,
      type: 'pair', sourceId: null, depthId: null, views: 5, separation: 15, path: 'linear',
      settings: { loops: 3, dolly: 'none', zoomPct: 10, crop: 'free', x: 0, y: 0, scale: 100 }
    });
    renderTimeline();
    selectClip(clips.length - 1);
  }

  async function addClip(file) {
    logMsg('Loading: ' + file.name + '...');
    try {
      var gif = await decodeGIF(file);
      var thumbUrl = gif.frames[0].canvas.toDataURL('image/png');
      var totalDur = 0;
      for (var i = 0; i < gif.frames.length; i++) totalDur += gif.frames[i].delay;
      clips.push({
        id: nextId++, name: file.name, gif: gif, thumbUrl: thumbUrl, totalDur: totalDur,
        settings: { loops: 3, dolly: 'none', zoomPct: 10, crop: 'free', x: 0, y: 0, scale: 100 }
      });
      logMsg(file.name + ': ' + gif.frames.length + ' frames, ' + Math.round(totalDur) + 'ms/cycle', 'ok');
      renderTimeline();
      if (clips.length === 1) selectClip(0);
    } catch(e) { logMsg('Failed: ' + file.name + ' — ' + e.message, 'err'); }
  }

  function removeClip(idx) {
    clips.splice(idx, 1);
    if (selectedIdx >= clips.length) selectedIdx = clips.length - 1;
    if (selectedIdx < 0) { selectedIdx = -1; $('studio-controls').style.display = 'none'; }
    renderTimeline();
  }

  function moveClip(from, to) {
    if (from === to) return;
    var c = clips.splice(from, 1)[0];
    clips.splice(to, 0, c);
    if (selectedIdx === from) selectedIdx = to;
    renderTimeline();
  }

  // ── Audio ──────────────────────────────────────────────
  async function loadAudio(file) {
    logMsg('Loading audio: ' + file.name + '...');
    try {
      audio.file = file;
      if (!audio.audioCtx) audio.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var arrayBuf = await file.arrayBuffer();
      audio.buffer = await audio.audioCtx.decodeAudioData(arrayBuf);
      audio.duration = audio.buffer.duration;
      audio.offset = 0;
      $('audio-empty').style.display = 'none';
      $('audio-loaded').style.display = '';
      $('audio-name').textContent = file.name;
      $('audio-dur-label').textContent = audio.duration.toFixed(1) + 's';
      $('stc-audio-offset').max = Math.max(0, audio.duration - 1).toFixed(1);
      $('stc-audio-offset').value = 0;
      $('stc-audio-offset-val').textContent = '0.0s';
      drawWaveform();
      logMsg('Audio loaded: ' + audio.duration.toFixed(1) + 's', 'ok');
    } catch(e) {
      logMsg('Audio load failed: ' + e.message, 'err');
      audio.file = null; audio.buffer = null;
    }
  }

  function removeAudio() {
    if (audio.source) { try { audio.source.stop(); } catch(e) {} audio.source = null; }
    audio.file = null; audio.buffer = null; audio.duration = 0; audio.offset = 0;
    $('audio-empty').style.display = '';
    $('audio-loaded').style.display = 'none';
    logMsg('Audio removed');
  }

  function drawWaveform() {
    if (!audio.buffer) return;
    var cv = $('audio-wave-cv');
    var w = cv.parentElement.clientWidth || 260;
    cv.width = w * 2; cv.height = 80;
    var wCtx = cv.getContext('2d');
    var data = audio.buffer.getChannelData(0);
    var step = Math.ceil(data.length / (w * 2));
    wCtx.clearRect(0, 0, cv.width, cv.height);
    wCtx.fillStyle = 'rgba(91,143,255,0.5)';
    for (var i = 0; i < w * 2; i++) {
      var min = 1.0, max = -1.0;
      for (var j = 0; j < step; j++) {
        var val = data[(i * step) + j] || 0;
        if (val < min) min = val;
        if (val > max) max = val;
      }
      var y1 = (1 + min) * 40, y2 = (1 + max) * 40;
      wCtx.fillRect(i, y1, 1, Math.max(1, y2 - y1));
    }
    updateOffsetMarker();
  }

  function updateOffsetMarker() {
    if (!audio.buffer || !audio.duration) return;
    var dur = parseFloat($('stc-duration').value) || 10;
    var pct = audio.offset / audio.duration * 100;
    var widthPct = Math.min(dur / audio.duration, 1) * 100;
    $('audio-marker').style.left = pct + '%';
    $('audio-marker').style.width = widthPct + '%';
    $('audio-marker').style.background = 'rgba(91,143,255,0.2)';
    $('audio-marker').style.borderLeft = '2px solid var(--accent)';
  }

  function getTargetDuration() { return parseFloat($('stc-duration').value) || 10; }

  // ── Frame sequence builder ─────────────────────────────
  function buildFrameSequence(durationMs) {
    var ready = clips.filter(function(c) { return c.gif && c.gif.frames; });
    if (!ready.length) return [];
    var seq = [];
    var elapsed = 0;
    while (elapsed < durationMs) {
      for (var ci = 0; ci < ready.length; ci++) {
        var clip = ready[ci];
        var totalF = clip.gif.frames.length * clip.settings.loops;
        for (var fi = 0; fi < totalF; fi++) {
          if (elapsed >= durationMs) break;
          var frameIdx = fi % clip.gif.frames.length;
          var progress = totalF > 1 ? fi / (totalF - 1) : 0;
          var delay = clip.gif.frames[frameIdx].delay;
          seq.push({ clip: clip, frameIdx: frameIdx, progress: progress, delay: delay });
          elapsed += delay;
        }
        if (elapsed >= durationMs) break;
      }
    }
    return seq;
  }

  // ── Clip selection & settings ──────────────────────────
  function selectClip(idx) {
    selectedIdx = idx;
    renderTimeline();
    if (idx < 0 || idx >= clips.length) { $('studio-controls').style.display = 'none'; $('stc-pair-controls').style.display = 'none'; return; }
    $('studio-controls').style.display = '';
    var c = clips[idx];
    var s = c.settings;
    var isPair = c.type === 'pair';
    $('stc-pair-controls').style.display = isPair ? '' : 'none';
    if (isPair) {
      updatePairSelects();
      $('stc-source').value = c.sourceId != null ? c.sourceId : '';
      $('stc-depth').value = c.depthId != null ? c.depthId : '';
      $('stc-views').value = c.views || 5; $('stc-views-val').textContent = c.views || 5;
      $('stc-sep').value = c.separation || 15; $('stc-sep-val').textContent = (c.separation || 15) + 'px';
      $('stc-path').value = c.path || 'linear';
    }
    $('stc-loops').value = s.loops; $('stc-loops-val').textContent = s.loops;
    $('stc-dolly').value = s.dolly;
    $('stc-zoom-pct').value = s.zoomPct; $('stc-zoom-pct-val').textContent = s.zoomPct + '%';
    $('stc-crop').value = s.crop;
    $('stc-x').value = s.x; $('stc-x-val').textContent = s.x;
    $('stc-y').value = s.y; $('stc-y-val').textContent = s.y;
    $('stc-scale').value = s.scale; $('stc-scale-val').textContent = s.scale + '%';
    if (!pb.active && c.gif) drawStudioFrame(c, c.gif.frames[0], c.settings, 0);
  }

  function saveSettings() {
    if (selectedIdx < 0 || selectedIdx >= clips.length) return;
    var s = clips[selectedIdx].settings;
    s.loops = parseInt($('stc-loops').value);
    s.dolly = $('stc-dolly').value;
    s.zoomPct = parseInt($('stc-zoom-pct').value);
    s.crop = $('stc-crop').value;
    s.x = parseInt($('stc-x').value);
    s.y = parseInt($('stc-y').value);
    s.scale = parseInt($('stc-scale').value);
  }

  // ── Timeline rendering ─────────────────────────────────
  function renderTimeline() {
    var tl = $('studio-timeline');
    tl.innerHTML = '';
    if (!clips.length) { tl.innerHTML = '<div class="tl-empty">No clips added</div>'; return; }
    for (var i = 0; i < clips.length; i++) {
      (function(idx) {
        var c = clips[idx];
        var el = document.createElement('div');
        el.className = 'tl-item' + (idx === selectedIdx ? ' selected' : '');
        el.draggable = true;
        var hasGif = c.gif && c.gif.frames;
        var thumbHtml = c.thumbUrl ? '<img class="tl-thumb" src="' + c.thumbUrl + '"/>' : '<div class="tl-thumb" style="display:flex;align-items:center;justify-content:center;font-size:8px;color:var(--muted)">?</div>';
        var metaHtml = hasGif
          ? c.gif.frames.length + 'f · ' + c.settings.loops + 'x' +
            (c.settings.dolly !== 'none' ? ' · dolly ' + c.settings.dolly : '') +
            (c.settings.crop !== 'free' ? ' · ' + c.settings.crop : '')
          : '<span style="color:var(--warn)">needs generate</span>';
        el.innerHTML = thumbHtml +
          '<div class="tl-info"><div class="tl-name">' + c.name + '</div>' +
          '<div class="tl-meta">' + metaHtml + '</div></div>' +
          '<button class="tl-remove" title="Remove">&times;</button>';
        el.addEventListener('click', function(e) { if (e.target.classList.contains('tl-remove')) return; selectClip(idx); });
        el.querySelector('.tl-remove').addEventListener('click', function() { removeClip(idx); });
        el.addEventListener('dragstart', function(e) { e.dataTransfer.setData('text/plain', String(idx)); el.style.opacity = '0.4'; });
        el.addEventListener('dragend', function() { el.style.opacity = '1'; });
        el.addEventListener('dragover', function(e) { e.preventDefault(); el.classList.add('drag-over'); });
        el.addEventListener('dragleave', function() { el.classList.remove('drag-over'); });
        el.addEventListener('drop', function(e) { e.preventDefault(); el.classList.remove('drag-over'); moveClip(parseInt(e.dataTransfer.getData('text/plain')), idx); });
        tl.appendChild(el);
      })(i);
    }
  }

  // ── Drawing ────────────────────────────────────────────
  function drawStudioFrame(clip, frame, s, progress) {
    var dolly = 1.0;
    if (s.dolly === 'in') dolly = 1.0 + (s.zoomPct / 100) * progress;
    else if (s.dolly === 'out') dolly = 1.0 + (s.zoomPct / 100) * (1 - progress);
    var totalScale = (s.scale / 100) * dolly;

    var srcW = clip.gif.width, srcH = clip.gif.height;
    var cropW = srcW, cropH = srcH;
    if (s.crop !== 'free') {
      var parts = s.crop.split(':');
      var ar = parseInt(parts[0]) / parseInt(parts[1]);
      if (srcW / srcH > ar) cropW = Math.round(srcH * ar);
      else cropH = Math.round(srcW / ar);
    }

    var cont = $('canvasContainer');
    var maxW = cont.clientWidth || 640, maxH = cont.clientHeight || 480;
    var ds = Math.min(maxW / cropW, maxH / cropH, 2);
    canvas.width = Math.round(cropW * ds);
    canvas.height = Math.round(cropH * ds);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(ds * totalScale, ds * totalScale);
    ctx.translate(s.x, s.y);
    ctx.drawImage(frame.canvas, -srcW / 2, -srcH / 2);
    ctx.restore();
    $('canvasPlaceholder').style.display = 'none';
  }

  // ── Playback ───────────────────────────────────────────
  function startPlayback() {
    if (!clips.length) { logMsg('No clips', 'warn'); return; }
    var durMs = getTargetDuration() * 1000;
    pb.seq = buildFrameSequence(durMs);
    if (!pb.seq.length) { logMsg('No frames', 'warn'); return; }
    pb.active = true; pb.seqIdx = 0; pb.elapsed = 0;
    pb.startTime = performance.now(); pb.lastTime = pb.startTime;
    pb.animId = requestAnimationFrame(tick);
    $('studio-play').disabled = true; $('studio-stop').disabled = false;
    if (audio.buffer && audio.audioCtx) {
      if (audio.audioCtx.state === 'suspended') audio.audioCtx.resume();
      audio.source = audio.audioCtx.createBufferSource();
      audio.source.buffer = audio.buffer;
      audio.source.connect(audio.audioCtx.destination);
      audio.source.start(0, audio.offset);
    }
  }

  function stopPlayback() {
    pb.active = false;
    if (pb.animId) { cancelAnimationFrame(pb.animId); pb.animId = null; }
    $('studio-play').disabled = false; $('studio-stop').disabled = true;
    if (audio.source) { try { audio.source.stop(); } catch(e) {} audio.source = null; }
  }

  function tick(now) {
    if (!pb.active || !pb.seq || !pb.seq.length) { stopPlayback(); return; }
    var durMs = getTargetDuration() * 1000;
    pb.elapsed = now - pb.startTime;
    if (pb.elapsed >= durMs) {
      pb.startTime = now; pb.elapsed = 0; pb.seqIdx = 0;
      if (audio.buffer && audio.audioCtx) {
        if (audio.source) { try { audio.source.stop(); } catch(e) {} }
        audio.source = audio.audioCtx.createBufferSource();
        audio.source.buffer = audio.buffer;
        audio.source.connect(audio.audioCtx.destination);
        audio.source.start(0, audio.offset);
      }
    }
    var dt = now - pb.lastTime;
    if (dt >= pb.seq[pb.seqIdx].delay) {
      pb.lastTime = now; pb.seqIdx++;
      if (pb.seqIdx >= pb.seq.length) pb.seqIdx = 0;
    }
    var f = pb.seq[pb.seqIdx];
    drawStudioFrame(f.clip, f.clip.gif.frames[f.frameIdx], f.clip.settings, f.progress);
    $('infoRight').textContent = (pb.elapsed / 1000).toFixed(1) + 's / ' + getTargetDuration() + 's';
    pb.animId = requestAnimationFrame(tick);
  }

  // ── Export via MediaRecorder ───────────────────────────
  async function exportStudio(format) {
    if (!clips.length) { logMsg('No clips', 'warn'); return; }
    var mime = 'video/webm';
    if (format === 'mp4' && MediaRecorder.isTypeSupported('video/mp4')) mime = 'video/mp4';
    if (!MediaRecorder.isTypeSupported(mime)) { logMsg('Recording not supported', 'err'); return; }

    var durMs = getTargetDuration() * 1000;
    var seq = buildFrameSequence(durMs);
    if (!seq.length) { logMsg('No frames', 'warn'); return; }

    logMsg('Recording ' + getTargetDuration() + 's sequence...');
    $('studio-export-mp4').disabled = true; $('studio-export-webm').disabled = true;

    var f0 = seq[0];
    drawStudioFrame(f0.clip, f0.clip.gif.frames[f0.frameIdx], f0.clip.settings, 0);

    var videoStream = canvas.captureStream(0);
    var combinedStream = new MediaStream(videoStream.getVideoTracks());

    var audioDestNode = null, audioSrcNode = null;
    if (audio.buffer && audio.audioCtx) {
      var actx = audio.audioCtx;
      if (actx.state === 'suspended') await actx.resume();
      audioDestNode = actx.createMediaStreamDestination();
      audioSrcNode = actx.createBufferSource();
      audioSrcNode.buffer = audio.buffer;
      audioSrcNode.connect(audioDestNode);
      var audioTracks = audioDestNode.stream.getAudioTracks();
      for (var t = 0; t < audioTracks.length; t++) combinedStream.addTrack(audioTracks[t]);
    }

    var rec = new MediaRecorder(combinedStream, { mimeType: mime, videoBitsPerSecond: 8000000 });
    var chunks = [];
    rec.ondataavailable = function(e) { if (e.data.size) chunks.push(e.data); };
    var done = new Promise(function(resolve) { rec.onstop = resolve; });
    rec.start();
    if (audioSrcNode) audioSrcNode.start(0, audio.offset);

    var elapsed = 0;
    for (var si = 0; si < seq.length; si++) {
      if (elapsed >= durMs) break;
      var fr = seq[si];
      drawStudioFrame(fr.clip, fr.clip.gif.frames[fr.frameIdx], fr.clip.settings, fr.progress);
      videoStream.getVideoTracks()[0].requestFrame();
      await new Promise(function(r) { setTimeout(r, fr.delay); });
      elapsed += fr.delay;
      if (si % 30 === 0) $('infoRight').textContent = 'Recording... ' + (elapsed / 1000).toFixed(1) + 's / ' + getTargetDuration() + 's';
    }

    if (audioSrcNode) { try { audioSrcNode.stop(); } catch(e) {} }
    rec.stop();
    await done;

    var ext = mime.split('/')[1];
    DS.saveBlob(new Blob(chunks, { type: mime }), 'wigglegram_studio.' + ext);
    logMsg('Export complete (' + ext + ', ' + getTargetDuration() + 's)', 'ok');
    $('infoRight').textContent = 'Done';
    $('studio-export-mp4').disabled = false; $('studio-export-webm').disabled = false;
  }

  // ── GIF export ─────────────────────────────────────────
  async function exportStudioGif() {
    if (!clips.length) { logMsg('No clips', 'warn'); return; }
    var durMs = getTargetDuration() * 1000;
    var seq = buildFrameSequence(durMs);
    if (!seq.length) { logMsg('No frames', 'warn'); return; }

    logMsg('Rendering GIF (' + getTargetDuration() + 's)...');
    $('studio-export-gif').disabled = true;

    var f0 = seq[0];
    drawStudioFrame(f0.clip, f0.clip.gif.frames[f0.frameIdx], f0.clip.settings, 0);
    var w = canvas.width, h = canvas.height;

    var gifFrames = [];
    var elapsed = 0;
    for (var i = 0; i < seq.length; i++) {
      if (elapsed >= durMs) break;
      var fr = seq[i];
      drawStudioFrame(fr.clip, fr.clip.gif.frames[fr.frameIdx], fr.clip.settings, fr.progress);
      gifFrames.push({ data: ctx.getImageData(0, 0, w, h), delay: fr.delay });
      elapsed += fr.delay;
      if (i % 20 === 0) $('infoRight').textContent = 'GIF frame ' + (i + 1) + '/' + seq.length;
    }

    logMsg('Encoding GIF: ' + gifFrames.length + ' frames, ' + w + 'x' + h);
    try {
      var gif = encodeGIF(gifFrames, w, h);
      DS.saveBlob(new Blob([gif], { type: 'image/gif' }), 'wigglegram_studio.gif');
      logMsg('GIF export complete (' + gifFrames.length + ' frames)', 'ok');
    } catch(e) { logMsg('GIF encode failed: ' + e.message, 'err'); }
    $('infoRight').textContent = 'Done';
    $('studio-export-gif').disabled = false;
  }

  // ── Minimal GIF89a encoder ─────────────────────────────
  function encodeGIF(frames, width, height) {
    var buf = [];
    function w16(v) { buf.push(v & 0xff, (v >> 8) & 0xff); }
    function writeByte(v) { buf.push(v & 0xff); }
    function writeBytes(arr) { for (var i = 0; i < arr.length; i++) buf.push(arr[i]); }

    var palette = buildPalette(frames[0].data.data);
    writeBytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
    w16(width); w16(height);
    writeByte(0xf7); writeByte(0); writeByte(0);
    for (var i = 0; i < 256; i++) { writeByte(palette[i * 3]); writeByte(palette[i * 3 + 1]); writeByte(palette[i * 3 + 2]); }
    writeBytes([0x21, 0xff, 0x0b]);
    writeBytes([0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30]);
    writeBytes([0x03, 0x01]); w16(0); writeByte(0);

    for (var f = 0; f < frames.length; f++) {
      var delay = Math.round(frames[f].delay / 10);
      if (delay < 2) delay = 2;
      writeBytes([0x21, 0xf9, 0x04]); writeByte(0x00); w16(delay); writeByte(0); writeByte(0);
      writeByte(0x2c); w16(0); w16(0); w16(width); w16(height); writeByte(0x00);
      var indexed = quantizeFrame(frames[f].data.data, palette);
      var lzw = lzwEncode(indexed, 8);
      writeByte(8);
      var pos = 0;
      while (pos < lzw.length) { var chunk = Math.min(255, lzw.length - pos); writeByte(chunk); for (var j = 0; j < chunk; j++) buf.push(lzw[pos++]); }
      writeByte(0);
    }
    writeByte(0x3b);
    return new Uint8Array(buf);
  }

  function buildPalette() {
    var pal = new Uint8Array(768);
    for (var i = 0; i < 256; i++) { pal[i * 3] = ((i >> 5) & 7) * 36; pal[i * 3 + 1] = ((i >> 2) & 7) * 36; pal[i * 3 + 2] = (i & 3) * 85; }
    return pal;
  }

  function quantizeFrame(pixels, palette) {
    var count = pixels.length / 4;
    var indexed = new Uint8Array(count);
    for (var i = 0; i < count; i++) { indexed[i] = ((pixels[i * 4] / 36) & 7) << 5 | ((pixels[i * 4 + 1] / 36) & 7) << 2 | ((pixels[i * 4 + 2] / 85) & 3); }
    return indexed;
  }

  function lzwEncode(indexed, minCodeSize) {
    var clearCode = 1 << minCodeSize;
    var eoiCode = clearCode + 1;
    var codeSize = minCodeSize + 1;
    var nextCode = eoiCode + 1;
    var maxCode = (1 << codeSize);
    var table = {};
    var output = [];
    var bitBuf = 0, bitCount = 0;

    function emit(code) {
      bitBuf |= (code << bitCount); bitCount += codeSize;
      while (bitCount >= 8) { output.push(bitBuf & 0xff); bitBuf >>= 8; bitCount -= 8; }
    }

    for (var i = 0; i < clearCode; i++) table[String(i)] = i;
    emit(clearCode);
    var prev = String(indexed[0]);

    for (var p = 1; p < indexed.length; p++) {
      var cur = String(indexed[p]);
      var combined = prev + ',' + cur;
      if (table[combined] !== undefined) { prev = combined; }
      else {
        emit(table[prev]);
        if (nextCode < 4096) {
          table[combined] = nextCode++;
          if (nextCode > maxCode && codeSize < 12) { codeSize++; maxCode = 1 << codeSize; }
        } else {
          emit(clearCode); table = {};
          for (var j = 0; j < clearCode; j++) table[String(j)] = j;
          nextCode = eoiCode + 1; codeSize = minCodeSize + 1; maxCode = 1 << codeSize;
        }
        prev = cur;
      }
    }
    emit(table[prev]); emit(eoiCode);
    if (bitCount > 0) output.push(bitBuf & 0xff);
    return output;
  }

  // ── File handling ──────────────────────────────────────
  async function handleStudioFiles(files) {
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (f.type === 'image/gif') { await addClip(f); await addToPool(f); }
      else if (f.type && f.type.startsWith('image/')) { await addToPool(f); }
      else { logMsg('Skipped: ' + f.name, 'warn'); }
    }
  }

  // ── Event bindings ─────────────────────────────────────
  on('studio-drop', 'click', function() { $('studio-file-input').click(); });
  on('studio-file-input', 'change', async function(e) {
    if (e.target.files) await handleStudioFiles(e.target.files);
    e.target.value = '';
  });

  var dropArea = $('studio-drop');
  if (dropArea) {
    dropArea.addEventListener('dragover', function(e) { e.preventDefault(); dropArea.classList.add('drag-over'); });
    dropArea.addEventListener('dragleave', function() { dropArea.classList.remove('drag-over'); });
    dropArea.addEventListener('drop', async function(e) { e.preventDefault(); dropArea.classList.remove('drag-over'); await handleStudioFiles(e.dataTransfer.files); });
  }

  // Clip control bindings
  function bindStudioRange(id, suffix) {
    on(id, 'input', function() {
      $(id + '-val').textContent = $(id).value + (suffix || '');
      saveSettings();
      if (!pb.active && selectedIdx >= 0 && clips[selectedIdx].gif) {
        drawStudioFrame(clips[selectedIdx], clips[selectedIdx].gif.frames[0], clips[selectedIdx].settings, 0);
      }
      renderTimeline();
    });
  }
  bindStudioRange('stc-loops', '');
  bindStudioRange('stc-zoom-pct', '%');
  bindStudioRange('stc-x', '');
  bindStudioRange('stc-y', '');
  bindStudioRange('stc-scale', '%');

  on('stc-dolly', 'change', function() { saveSettings(); renderTimeline(); });
  on('stc-crop', 'change', function() {
    saveSettings();
    if (!pb.active && selectedIdx >= 0 && clips[selectedIdx].gif) {
      drawStudioFrame(clips[selectedIdx], clips[selectedIdx].gif.frames[0], clips[selectedIdx].settings, 0);
    }
    renderTimeline();
  });

  on('btn-add-clip', 'click', function() { addPairClip(); });

  // Pair clip controls
  on('stc-source', 'change', function() {
    if (selectedIdx >= 0 && clips[selectedIdx].type === 'pair')
      clips[selectedIdx].sourceId = $('stc-source').value ? parseInt($('stc-source').value) : null;
  });
  on('stc-depth', 'change', function() {
    if (selectedIdx >= 0 && clips[selectedIdx].type === 'pair')
      clips[selectedIdx].depthId = $('stc-depth').value ? parseInt($('stc-depth').value) : null;
  });
  bindStudioRange('stc-views', '');
  bindStudioRange('stc-sep', 'px');
  on('stc-views', 'input', function() { if (selectedIdx >= 0 && clips[selectedIdx].type === 'pair') clips[selectedIdx].views = parseInt($('stc-views').value); });
  on('stc-sep', 'input', function() { if (selectedIdx >= 0 && clips[selectedIdx].type === 'pair') clips[selectedIdx].separation = parseInt($('stc-sep').value); });
  on('stc-path', 'change', function() { if (selectedIdx >= 0 && clips[selectedIdx].type === 'pair') clips[selectedIdx].path = $('stc-path').value; });
  on('stc-generate', 'click', async function() {
    if (selectedIdx < 0) return;
    var c = clips[selectedIdx];
    if (c.type !== 'pair') return;
    $('stc-generate').disabled = true; $('stc-generate').textContent = 'Generating…';
    try { await generateWigglegram(c); } catch(e) { logMsg('Generate failed: ' + e.message, 'err'); }
    $('stc-generate').disabled = false; $('stc-generate').textContent = 'Generate Wigglegram';
  });

  // Film filter preset
  on('stf-preset', 'change', async function() {
    var name = $('stf-preset').value;
    $('stf-sliders').style.display = name === 'none' ? 'none' : '';
    if (name === 'none') return;
    if (!_wsPresets) {
      try { var r = await fetch(SERVER + '/film-presets'); if (r.ok) _wsPresets = (await r.json()).presets; } catch(e) {}
    }
    if (!_wsPresets) return;
    var p = _wsPresets[name] || {};
    var map = { 'stf-grain': p.grain_amount, 'stf-bgblur': p.blur_strength, 'stf-flash': p.flash_intensity,
      'stf-vignette': p.vignette_strength, 'stf-leak': p.light_leak_opacity, 'stf-halation': p.halation_radius,
      'stf-contrast': p.contrast, 'stf-saturation': p.saturation, 'stf-fade': p.fade, 'stf-tint-strength': p.tint_strength };
    for (var id in map) { var el = $(id); if (el) { el.value = map[id] || 0; el.dispatchEvent(new Event('input')); } }
    if (p.tint_color && $('stf-tint-color')) $('stf-tint-color').value = p.tint_color;
    if (p.gradient_map && $('stf-gradient-map')) $('stf-gradient-map').value = p.gradient_map;
  });

  // Film filter sliders
  ['stf-grain', 'stf-grain-opacity', 'stf-bgblur', 'stf-flash', 'stf-vignette', 'stf-leak', 'stf-halation', 'stf-contrast', 'stf-saturation', 'stf-fade', 'stf-tint-strength'].forEach(function(id) {
    bindStudioRange(id, '');
  });

  // Playback
  on('studio-play', 'click', function() { startPlayback(); });
  on('studio-play-begin', 'click', function() { stopPlayback(); startPlayback(); });
  on('studio-stop', 'click', function() { stopPlayback(); });
  on('studio-export-gif', 'click', function() { exportStudioGif(); });
  on('studio-export-mp4', 'click', function() { exportStudio('mp4'); });
  on('studio-export-webm', 'click', function() { exportStudio('webm'); });

  // Audio bindings
  on('audio-drop', 'click', function() { $('audio-file-input').click(); });
  on('audio-file-input', 'change', function(e) {
    var f = e.target.files && e.target.files[0];
    if (f) loadAudio(f);
    e.target.value = '';
  });
  var audioDrop = $('audio-drop');
  if (audioDrop) {
    audioDrop.addEventListener('dragover', function(e) { e.preventDefault(); audioDrop.classList.add('drag-over'); });
    audioDrop.addEventListener('dragleave', function() { audioDrop.classList.remove('drag-over'); });
    audioDrop.addEventListener('drop', function(e) { e.preventDefault(); audioDrop.classList.remove('drag-over'); var f = e.dataTransfer.files[0]; if (f) loadAudio(f); });
  }
  on('audio-remove', 'click', function() { removeAudio(); });
  on('stc-audio-offset', 'input', function() {
    audio.offset = parseFloat($('stc-audio-offset').value);
    $('stc-audio-offset-val').textContent = audio.offset.toFixed(1) + 's';
    $('audio-offset-label').textContent = 'offset: ' + audio.offset.toFixed(1) + 's';
    updateOffsetMarker();
  });
  on('stc-duration', 'input', function() { updateOffsetMarker(); });

  // Waveform drag to set offset with live audio preview
  var waveEl = $('audio-wave');
  if (waveEl) {
    var dragging = false, previewSrc = null, previewTimeout = null;
    function stopPreview() {
      if (previewSrc) { try { previewSrc.stop(); } catch(e) {} previewSrc = null; }
      if (previewTimeout) { clearTimeout(previewTimeout); previewTimeout = null; }
    }
    function playPreviewSnippet(offset) {
      if (!audio.buffer || !audio.audioCtx) return;
      stopPreview();
      if (audio.audioCtx.state === 'suspended') audio.audioCtx.resume();
      previewSrc = audio.audioCtx.createBufferSource();
      previewSrc.buffer = audio.buffer;
      previewSrc.connect(audio.audioCtx.destination);
      previewSrc.start(0, offset, 0.3);
      previewTimeout = setTimeout(stopPreview, 300);
    }
    function setOffsetFromX(x, preview) {
      if (!audio.buffer) return;
      var rect = waveEl.getBoundingClientRect();
      var pct = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
      audio.offset = Math.round(pct * audio.duration * 10) / 10;
      $('stc-audio-offset').value = audio.offset;
      $('stc-audio-offset-val').textContent = audio.offset.toFixed(1) + 's';
      $('audio-offset-label').textContent = 'offset: ' + audio.offset.toFixed(1) + 's';
      updateOffsetMarker();
      if (preview) playPreviewSnippet(audio.offset);
    }
    waveEl.addEventListener('mousedown', function(e) { dragging = true; setOffsetFromX(e.clientX, true); });
    document.addEventListener('mousemove', function(e) { if (dragging) setOffsetFromX(e.clientX, true); });
    document.addEventListener('mouseup', function() { if (dragging) { dragging = false; stopPreview(); } });
  }

  // ── Back to workspace ──────────────────────────────────
  on('studio-back', 'click', function() {
    var url = 'workspace.html?server=' + encodeURIComponent(SERVER);
    var session = DS.params.get('session');
    if (session) url += '&session=' + session;
    window.location.href = url;
  });

  // ── Init ───────────────────────────────────────────────
  sizeCanvas();
  logMsg('Wigglegram Studio ready');

})();
