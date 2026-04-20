/**
 * DS — Depth Scanner shared utilities
 * Used by workspace.js and studio.js
 */
window.DS = (function() {
  'use strict';

  var _params = new URLSearchParams(window.location.search);
  var SERVER = _params.get('server') || 'http://127.0.0.1:7843';
  var _logLines = 0;
  var _serverOnline = false;

  function $(id) { return document.getElementById(id); }

  function on(id, event, handler) {
    var el = typeof id === 'string' ? $(id) : id;
    if (!el) {
      console.warn('[DS] Element not found: ' + id);
      return;
    }
    el.addEventListener(event, function(e) {
      try { handler(e); } catch(err) {
        logMsg('Error in ' + id + '.' + event + ': ' + err.message, 'err');
        console.error(err);
      }
    });
  }

  // ── Logging ────────────────────────────────────────────
  function logMsg(text, level) {
    level = level || 'info';
    var body = $('logBody');
    if (!body) return;
    var line = document.createElement('div');
    line.className = 'log-line ' + level;
    var ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
    line.textContent = '[' + ts + '] ' + text;
    body.appendChild(line);
    body.scrollTop = body.scrollHeight;
    _logLines++;
    var counter = $('logCount');
    if (counter) counter.textContent = _logLines;
  }

  // ── Server health ──────────────────────────────────────
  function checkHealth() {
    fetch(SERVER + '/health', { method: 'GET' })
      .then(function(r) {
        if (!r.ok) throw new Error('Status ' + r.status);
        return r.json();
      })
      .then(function() {
        if (!_serverOnline) {
          _serverOnline = true;
          var dot = $('statusDot');
          if (dot) dot.className = 'dot dot-on';
          var txt = $('statusText');
          if (txt) txt.textContent = 'Online';
          logMsg('Server connected', 'ok');
        }
      })
      .catch(function() {
        if (_serverOnline || _serverOnline === false) {
          _serverOnline = false;
          var dot = $('statusDot');
          if (dot) dot.className = 'dot dot-off';
          var txt = $('statusText');
          if (txt) txt.textContent = 'Offline';
        }
      });
  }
  checkHealth();
  setInterval(checkHealth, 4000);

  // ── Progress ──────────────────────────────────────────
  function showProgress(pct) {
    var el = $('wsProgress'), bar = $('wsProgressBar');
    if (!el || !bar) return;
    el.classList.add('active');
    el.classList.remove('indeterminate');
    bar.style.width = Math.min(100, Math.max(0, pct)) + '%';
  }

  function showIndeterminate() {
    var el = $('wsProgress');
    if (!el) return;
    el.classList.add('active', 'indeterminate');
  }

  function hideProgress() {
    var el = $('wsProgress'), bar = $('wsProgressBar');
    if (!el) return;
    el.classList.remove('active', 'indeterminate');
    if (bar) bar.style.width = '0%';
  }

  // ── Fetch with upload/download progress ───────────────
  function fetchWithProgress(url, options) {
    return new Promise(function(resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open(options.method || 'POST', url);
      xhr.responseType = 'blob';

      xhr.upload.onprogress = function(e) {
        if (e.lengthComputable) {
          var pct = (e.loaded / e.total) * 50;
          showProgress(pct);
          var info = $('infoRight');
          if (info) info.textContent = 'Uploading ' + Math.round(pct * 2) + '%';
        }
      };

      xhr.onprogress = function(e) {
        if (e.lengthComputable) {
          var pct = 50 + (e.loaded / e.total) * 50;
          showProgress(pct);
          var info = $('infoRight');
          if (info) info.textContent = 'Downloading ' + Math.round((pct - 50) * 2) + '%';
        } else {
          showIndeterminate();
          var info = $('infoRight');
          if (info) info.textContent = 'Processing…';
        }
      };

      xhr.onload = function() {
        showProgress(100);
        setTimeout(hideProgress, 500);
        var headers = {};
        var rawHeaders = xhr.getAllResponseHeaders();
        rawHeaders.split('\r\n').forEach(function(line) {
          var parts = line.split(': ');
          if (parts[0]) headers[parts[0].toLowerCase()] = parts[1];
        });
        resolve({
          ok: xhr.status >= 200 && xhr.status < 300,
          status: xhr.status,
          headers: { get: function(k) { return headers[k.toLowerCase()] || null; } },
          blob: function() { return Promise.resolve(xhr.response); },
          json: function() { return xhr.response.text().then(JSON.parse); }
        });
      };
      xhr.onerror = function() { hideProgress(); reject(new Error('Network error')); };
      xhr.ontimeout = function() { hideProgress(); reject(new Error('Timeout')); };
      xhr.send(options.body || null);
    });
  }

  // ── Save blob (Electron native dialog or browser fallback) ──
  async function saveBlob(blob, filename) {
    if (window.electronAPI) {
      try {
        var filePath = await window.electronAPI.saveDialog(filename);
        if (!filePath) return;
        var buf = await blob.arrayBuffer();
        await window.electronAPI.writeFile(filePath, buf);
        logMsg('Saved: ' + filePath.split(/[/\\]/).pop(), 'ok');
        return;
      } catch(e) {
        logMsg('Save error: ' + (e.message || e), 'err');
        return;
      }
    }
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    logMsg('Saved: ' + filename, 'ok');
  }

  // ── Log panel: resize + collapse ───────────────────────
  function initLogPanel() {
    var logDrag = $('logDrag');
    var logBody = $('logBody');
    var logChevron = $('logChevron');
    var logHeader = $('logHeader');
    if (!logDrag || !logBody) return;

    var dragging = false;
    var startY = 0;
    var startH = 0;
    var collapsed = false;
    var lastHeight = 120;
    var MIN_H = 40;
    var MAX_H = 500;

    logDrag.addEventListener('mousedown', function(e) {
      e.preventDefault();
      dragging = true;
      startY = e.clientY;
      startH = logBody.offsetHeight;
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', function(e) {
      if (!dragging) return;
      var delta = startY - e.clientY;
      var newH = Math.min(MAX_H, Math.max(MIN_H, startH + delta));
      logBody.style.height = newH + 'px';
      lastHeight = newH;
    });

    document.addEventListener('mouseup', function() {
      if (!dragging) return;
      dragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    });

    function toggleCollapse() {
      collapsed = !collapsed;
      if (collapsed) {
        logBody.classList.add('collapsed');
        if (logChevron) logChevron.classList.add('collapsed');
      } else {
        logBody.classList.remove('collapsed');
        if (logChevron) logChevron.classList.remove('collapsed');
        logBody.style.height = lastHeight + 'px';
      }
    }

    if (logHeader) logHeader.addEventListener('click', toggleCollapse);
  }

  // ── Range slider binding helper ────────────────────────
  function bindRange(id, suffix) {
    suffix = suffix || '';
    var slider = $(id);
    var valEl = $(id + '-val');
    if (!slider || !valEl) return;
    function update() {
      var v = parseFloat(slider.value);
      var step = parseFloat(slider.step) || 1;
      if (step < 1) {
        valEl.textContent = v.toFixed(step < 0.1 ? 2 : 1) + suffix;
      } else {
        valEl.textContent = Math.round(v) + suffix;
      }
    }
    slider.addEventListener('input', update);
    update();
  }

  // Init on DOMContentLoaded
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initLogPanel);
  } else {
    initLogPanel();
  }

  return {
    SERVER: SERVER,
    $: $,
    on: on,
    logMsg: logMsg,
    isOnline: function() { return _serverOnline; },
    showProgress: showProgress,
    showIndeterminate: showIndeterminate,
    hideProgress: hideProgress,
    fetchWithProgress: fetchWithProgress,
    saveBlob: saveBlob,
    bindRange: bindRange,
    params: _params
  };
})();
