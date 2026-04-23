/**
 * video-effects.js — Video effects via Three.js VideoTexture
 * Two <video> elements (source + depth) → real-time 3D playback
 * NO per-frame server fetch. NO borrowed image code.
 * Depends on: renderer3d.js (Renderer3D), renderer3d-adapter.js (R3DAdapter)
 */
window.VideoFX = (function() {
  'use strict';

  var $ = function(id) { return document.getElementById(id); };

  var _srcVideo = null;   // <video> element for source
  var _depthVideo = null; // <video> element for depth
  var _active = false;
  var _playing = false;
  var _duration = 0;
  var _fps = 24;
  var _trimIn = 0;        // seconds
  var _trimOut = 0;        // seconds
  var _canvas = null;
  var _loopInterval = null;

  // ── Init: create video elements, load blobs ──
  function init(srcBlob, depthBlob, videoInfo, elevCanvas) {
    _canvas = elevCanvas;
    _fps = videoInfo.fps || 30; // will auto-detect via requestVideoFrameCallback
    _duration = videoInfo.duration || 1;
    _trimIn = 0;
    _trimOut = _duration;

    // Remove old video elements (clean slate each init)
    var oldSrc = $('vfx-src-video');
    var oldDep = $('vfx-depth-video');
    if (oldSrc) { oldSrc.pause(); oldSrc.src = ''; oldSrc.remove(); }
    if (oldDep) { oldDep.pause(); oldDep.src = ''; oldDep.remove(); }

    _srcVideo = document.createElement('video');
    _srcVideo.id = 'vfx-src-video';
    _srcVideo.muted = true;
    _srcVideo.playsInline = true;
    _srcVideo.preload = 'auto';
    _srcVideo.crossOrigin = 'anonymous';
    _srcVideo.style.display = 'none';
    document.body.appendChild(_srcVideo);

    _depthVideo = document.createElement('video');
    _depthVideo.id = 'vfx-depth-video';
    _depthVideo.muted = true;
    _depthVideo.playsInline = true;
    _depthVideo.preload = 'auto';
    _depthVideo.crossOrigin = 'anonymous';
    _depthVideo.style.display = 'none';
    document.body.appendChild(_depthVideo);

    // Create blob URLs
    if (!srcBlob || !depthBlob) {
      console.error('[VideoFX] Missing blob: src=' + !!srcBlob + ' depth=' + !!depthBlob);
      return Promise.reject(new Error('Missing video blob'));
    }
    var srcUrl = URL.createObjectURL(srcBlob);
    var depthUrl = URL.createObjectURL(depthBlob);

    console.log('[VideoFX] init: srcBlob=' + srcBlob.size + 'B depthBlob=' + depthBlob.size + 'B fps=' + _fps);

    return new Promise(function(resolve, reject) {
      var loaded = 0;
      function checkBoth() {
        loaded++;
        console.log('[VideoFX] video loaded (' + loaded + '/2) src.dur=' + _srcVideo.duration + ' depth.dur=' + _depthVideo.duration);
        if (loaded >= 2) {
          _duration = _srcVideo.duration || _depthVideo.duration || _duration;
          _trimOut = _duration;
          // Detect FPS: use requestVideoFrameCallback if available, else estimate
          if (_srcVideo.requestVideoFrameCallback) {
            var t0 = null, frameCount = 0;
            function countFrame(now, meta) {
              if (!t0) { t0 = meta.mediaTime; }
              frameCount++;
              if (frameCount >= 5) {
                var elapsed = meta.mediaTime - t0;
                if (elapsed > 0) _fps = Math.round(frameCount / elapsed);
                _srcVideo.pause();
                _srcVideo.currentTime = 0;
                console.log('[VideoFX] Detected FPS: ' + _fps);
              } else {
                _srcVideo.requestVideoFrameCallback(countFrame);
              }
            }
            // Brief play to detect FPS, then pause
            _srcVideo.muted = true;
            _srcVideo.requestVideoFrameCallback(countFrame);
            _srcVideo.play().catch(function() {});
            setTimeout(function() { _srcVideo.pause(); _srcVideo.currentTime = 0; }, 500);
          }
          console.log('[VideoFX] Both videos loaded, duration=' + _duration.toFixed(2) + 's fps=' + _fps);
          resolve();
        }
      }

      // Set handlers BEFORE src to avoid race condition
      _srcVideo.onloadedmetadata = function() { console.log('[VideoFX] src metadata: dur=' + _srcVideo.duration + ' w=' + _srcVideo.videoWidth); if (loaded < 2) checkBoth(); };
      _depthVideo.onloadedmetadata = function() { console.log('[VideoFX] depth metadata: dur=' + _depthVideo.duration + ' w=' + _depthVideo.videoWidth); if (loaded < 2) checkBoth(); };
      _srcVideo.onloadeddata = function() { if (loaded < 2) checkBoth(); };
      _depthVideo.onloadeddata = function() { if (loaded < 2) checkBoth(); };
      _srcVideo.oncanplaythrough = function() { if (loaded < 2) checkBoth(); };
      _depthVideo.oncanplaythrough = function() { if (loaded < 2) checkBoth(); };
      // Don't reject on error — log and let timeout handle (one video might have unsupported codec)
      _srcVideo.onerror = function() {
        var err = _srcVideo.error;
        console.error('[VideoFX] src error: code=' + (err ? err.code : '?') + ' msg=' + (err ? err.message : 'unknown'));
      };
      _depthVideo.onerror = function() {
        var err = _depthVideo.error;
        console.error('[VideoFX] depth error: code=' + (err ? err.code : '?') + ' msg=' + (err ? err.message : 'unknown'));
      };

      console.log('[VideoFX] Setting src URLs: src=' + srcUrl + ' depth=' + depthUrl);
      _srcVideo.src = srcUrl;
      _depthVideo.src = depthUrl;
      _srcVideo.load();
      _depthVideo.load();

      // Timeout — if nothing loads in 5s, check what we have
      setTimeout(function() {
        if (loaded < 2) {
          var srcOk = _srcVideo.readyState >= 2;
          var depOk = _depthVideo.readyState >= 2;
          console.warn('[VideoFX] Timeout: srcReady=' + srcOk + '(' + _srcVideo.readyState + ') depReady=' + depOk + '(' + _depthVideo.readyState + ')');
          if (srcOk || depOk) {
            _duration = _srcVideo.duration || _depthVideo.duration || _duration;
            _trimOut = _duration;
            resolve();
          } else {
            reject(new Error('Videos could not be loaded — check codec (needs H.264)'));
          }
        }
      }, 5000);
    });
  }

  // ── Show 3D canvas with video textures ──
  function show(effectType) {
    console.log('[VideoFX] show(' + effectType + ') srcReady=' + !!_srcVideo + ' depthReady=' + !!_depthVideo + ' srcDur=' + (_srcVideo?.duration || 0));
    if (!_srcVideo || !_depthVideo) return;
    if (!Renderer3D.isVisible()) {
      Renderer3D.init(_canvas, { width: 1200, height: 800 });
      Renderer3D._buildMesh(
        parseInt($('elev-density')?.value || '40'),
        $('elev-grid-type')?.value || 'square'
      );
    }

    Renderer3D.setHoloMode(effectType === 'hologram');
    Renderer3D.setVideoTextures(_srcVideo, _depthVideo);
    Renderer3D.startLoop();

    // Show canvas
    _canvas.style.display = 'block';
    var prevImg = $('preview-img'); if (prevImg) prevImg.style.display = 'none';
    var compCv = $('compare-canvas'); if (compCv) compCv.style.display = 'none';
    var ph = $('canvasPlaceholder'); if (ph) ph.style.display = 'none';
    var gc = $('gizmo-canvas'); if (gc) gc.style.display = '';

    _active = true;

    // Sync adapter
    if (window.R3DAdapter) R3DAdapter.syncAll();
  }

  // ── Hide ──
  function hide() {
    pause();
    Renderer3D.clearVideoTextures();
    Renderer3D.hide();
    _canvas.style.display = 'none';
    var prevImg = $('preview-img'); if (prevImg) prevImg.style.display = '';
    var gc = $('gizmo-canvas'); if (gc) gc.style.display = 'none';
    _active = false;
  }

  // ── Playback ──
  function play() {
    console.log('[VideoFX] play() srcTime=' + (_srcVideo?.currentTime || 0) + ' depthTime=' + (_depthVideo?.currentTime || 0));
    if (!_srcVideo || !_depthVideo) return;
    // Start from trim in if at end
    if (_srcVideo.currentTime >= _trimOut - 0.05) {
      seek(_trimIn);
    }
    _srcVideo.play();
    _depthVideo.play();
    _playing = true;

    // Loop check — loop back to trimIn when reaching trimOut
    clearInterval(_loopInterval);
    _loopInterval = setInterval(function() {
      if (_srcVideo.currentTime >= _trimOut) {
        seek(_trimIn);
        _srcVideo.play();
        _depthVideo.play();
      }
      // Keep videos in sync (drift correction)
      if (Math.abs(_srcVideo.currentTime - _depthVideo.currentTime) > 0.05) {
        _depthVideo.currentTime = _srcVideo.currentTime;
      }
    }, 50);
  }

  function pause() {
    if (_srcVideo) _srcVideo.pause();
    if (_depthVideo) _depthVideo.pause();
    _playing = false;
    clearInterval(_loopInterval);
  }

  function seek(time) {
    console.log('[VideoFX] seek(' + time.toFixed(2) + ')');
    time = Math.max(_trimIn, Math.min(_trimOut, time));
    if (_srcVideo) _srcVideo.currentTime = time;
    if (_depthVideo) _depthVideo.currentTime = time;
  }

  function seekNormalized(pos) {
    // pos 0-1 → mapped to trimIn-trimOut range
    seek(_trimIn + pos * (_trimOut - _trimIn));
  }

  function isPlaying() { return _playing; }
  function isActive() { return _active; }
  function getDuration() { return _duration; }
  function getPlayhead() { return _srcVideo ? _srcVideo.currentTime : 0; }
  function getPlayheadNormalized() {
    if (!_srcVideo || _duration <= 0) return 0;
    return (_srcVideo.currentTime - _trimIn) / (_trimOut - _trimIn);
  }

  // ── Trim ──
  function setTrimIn(t) { _trimIn = Math.max(0, t); }
  function setTrimOut(t) { _trimOut = Math.min(_duration, t); }
  function setTrimNormalized(inN, outN) {
    _trimIn = inN * _duration;
    _trimOut = outN * _duration;
  }

  // ── Export ──
  function exportFrame() {
    return Renderer3D.captureFrame();
  }

  function exportVideo(format, onProgress) {
    format = format || 'webm';
    var mime = 'video/webm';
    if (format === 'mp4' && MediaRecorder.isTypeSupported('video/mp4')) mime = 'video/mp4';

    return new Promise(function(resolve, reject) {
      if (!_canvas || !_srcVideo) { reject(new Error('Not initialized')); return; }

      var stream = _canvas.captureStream(0);
      var rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8000000 });
      var chunks = [];
      rec.ondataavailable = function(e) { if (e.data.size) chunks.push(e.data); };
      rec.onstop = function() {
        resolve(new Blob(chunks, { type: mime }));
      };

      // Seek to start, record frame by frame
      seek(_trimIn);
      rec.start();

      var frameTime = 1 / _fps;
      var currentTime = _trimIn;
      var totalFrames = Math.ceil((_trimOut - _trimIn) * _fps);
      var frameIdx = 0;

      function captureNext() {
        if (currentTime >= _trimOut || frameIdx >= totalFrames) {
          rec.stop();
          return;
        }
        seek(currentTime);
        // Wait for seek to complete
        setTimeout(function() {
          Renderer3D.render();
          stream.getVideoTracks()[0].requestFrame();
          frameIdx++;
          currentTime += frameTime;
          if (onProgress) onProgress(frameIdx, totalFrames);
          setTimeout(captureNext, 10);
        }, 30);
      }

      setTimeout(captureNext, 100);
    });
  }

  // ── Cleanup ──
  function dispose() {
    pause();
    if (_srcVideo) { _srcVideo.src = ''; _srcVideo.load(); }
    if (_depthVideo) { _depthVideo.src = ''; _depthVideo.load(); }
    _active = false;
    _playing = false;
  }

  return {
    init: init,
    show: show,
    hide: hide,
    play: play,
    pause: pause,
    seek: seek,
    seekNormalized: seekNormalized,
    isPlaying: isPlaying,
    isActive: isActive,
    getDuration: getDuration,
    getPlayhead: getPlayhead,
    getPlayheadNormalized: getPlayheadNormalized,
    setTrimIn: setTrimIn,
    setTrimOut: setTrimOut,
    setTrimNormalized: setTrimNormalized,
    exportFrame: exportFrame,
    exportVideo: exportVideo,
    dispose: dispose
  };
})();
