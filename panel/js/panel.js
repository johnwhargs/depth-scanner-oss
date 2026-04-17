/* Depth Scanner OSS — Panel JS v1.1 */

const SERVER = "http://127.0.0.1:7842";
const cs = typeof CSInterface !== "undefined" ? new CSInterface() : null;

const state = {
  connected: false,
  processing: false,
  compInfo: null,
  lastDepthPath: null,
  lastFxPath: null,
  lastBlobUrl: null,
  sessionId: null,    // cached depth session for effects
};

const $ = id => document.getElementById(id);

// ── Server ────────────────────────────────────────────────────────────────────
async function ping() {
  // Try fetch first, fall back to XHR (some CEP versions block fetch to localhost)
  try {
    const r = await fetch(`${SERVER}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok ? await r.json() : null;
  } catch {
    return pingXHR();
  }
}

function pingXHR() {
  return new Promise(resolve => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", `${SERVER}/health`, true);
      xhr.timeout = 2000;
      xhr.onload = function() {
        try { resolve(JSON.parse(xhr.responseText)); } catch { resolve(null); }
      };
      xhr.onerror = function() { resolve(null); };
      xhr.ontimeout = function() { resolve(null); };
      xhr.send();
    } catch { resolve(null); }
  });
}

async function loadColormaps() {
  try {
    const { colormaps } = await (await fetch(`${SERVER}/colormaps`)).json();
    const sel = $("colormap");
    sel.innerHTML = colormaps.map(c =>
      `<option value="${c}"${c === "inferno" ? " selected" : ""}>${c}</option>`
    ).join("");
  } catch {}
}

// ── ExtendScript bridge ───────────────────────────────────────────────────────
function evalScript(fn, ...args) {
  return new Promise(resolve => {
    if (!cs) { resolve(null); return; }
    cs.evalScript(`${fn}(${args.map(a => JSON.stringify(a)).join(",")})`, res => {
      try { resolve(JSON.parse(res)); } catch { resolve(res); }
    });
  });
}

// ── Log ───────────────────────────────────────────────────────────────────────
function log(msg, type = "info") {
  const el = $("log");
  const line = document.createElement("div");
  line.className = `log-line log-${type}`;
  line.textContent = `› ${msg}`;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
  while (el.children.length > 80) el.removeChild(el.firstChild);
}

function setStatus(ok) {
  state.connected = ok;
  $("status-dot").className = "dot " + (ok ? "dot-on" : "dot-off");
  $("status-text").textContent = ok ? "Server running" : "Server offline";
}

// ── Comp info ─────────────────────────────────────────────────────────────────
async function refreshComp() {
  const info = await evalScript("getCompInfo");
  if (!info || info.error) {
    $("comp-name").textContent = "No comp active";
    $("comp-info").textContent = "";
    state.compInfo = null;
    return;
  }
  state.compInfo = info;
  $("comp-name").textContent = info.name;
  $("comp-info").textContent = `${info.width}×${info.height} · ${info.fps.toFixed(2)}fps`;
  $("range-start").value = info.workStart;
  $("range-end").value   = info.workEnd;
}

// ── File I/O (CEP) ────────────────────────────────────────────────────────────
function readLocalFile(path) {
  return new Promise((res, rej) => {
    if (!cs) { rej(new Error("No CEP")); return; }
    const d = window.cep.fs.readFile(path, cep.encoding.Base64);
    if (d.err) { rej(new Error("Read error " + d.err)); return; }
    const bin = atob(d.data);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    res(buf.buffer);
  });
}

function writeLocalFile(path, arrayBuffer) {
  return new Promise((res, rej) => {
    if (!cs) { rej(new Error("No CEP")); return; }
    const bytes = new Uint8Array(arrayBuffer);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const err = window.cep.fs.writeFile(path, btoa(bin), cep.encoding.Base64);
    if (err) rej(new Error("Write error " + err));
    else res();
  });
}

function showPreview(arrayBuffer, imgEl, wrapEl) {
  if (state.lastBlobUrl) URL.revokeObjectURL(state.lastBlobUrl);
  const blob = new Blob([arrayBuffer], { type: "image/png" });
  state.lastBlobUrl = URL.createObjectURL(blob);
  imgEl.src = state.lastBlobUrl;
  wrapEl.classList.add("show");
}

// ── Process frame ─────────────────────────────────────────────────────────────
async function processCurrentFrame() {
  if (state.processing || !state.connected) {
    if (!state.connected) log("Server offline.", "warn");
    return;
  }
  state.processing = true;
  $("btn-frame").disabled = true;
  $("btn-frame").textContent = "Processing…";
  $("frame-progress").classList.add("show");

  try {
    log("Exporting current frame…");
    const exp = await evalScript("exportCurrentFrame");
    if (!exp || exp.error) throw new Error(exp?.error || "Export failed");
    log(`Frame: ${exp.path.split(/[/\\]/).pop()}`);

    const imgBytes = await readLocalFile(exp.path);
    const model    = $("model").value;
    const format   = $("output-format").value;
    const colormap = $("colormap").value;

    log(`Depth Anything V2 (${model})…`);
    const fd = new FormData();
    fd.append("file", new Blob([imgBytes], { type: "image/png" }), "frame.png");
    fd.append("model", model);
    fd.append("format", format);
    fd.append("colormap", colormap);

    const r = await fetch(`${SERVER}/process/frame`, { method: "POST", body: fd });
    if (!r.ok) throw new Error((await r.json()).detail || "Server error");

    // Store session ID for effects
    state.sessionId = r.headers.get("X-Session-Id");

    const result = await r.arrayBuffer();
    const ext = format === "exr" ? "exr" : "png";
    const outPath = exp.path.replace(/\.[^.]+$/, `_depth.${ext}`);
    await writeLocalFile(outPath, result);
    state.lastDepthPath = outPath;

    if (format !== "exr") showPreview(result, $("preview-img"), $("frame-preview"));

    log(`Saved: ${outPath.split(/[/\\]/).pop()}`, "success");
    log(`Session ${state.sessionId} ready for effects`, "info");
    $("btn-import").disabled = false;

  } catch (e) {
    log(`Error: ${e.message}`, "error");
  } finally {
    state.processing = false;
    $("btn-frame").disabled = false;
    $("btn-frame").textContent = "Process Frame";
    $("frame-progress").classList.remove("show");
  }
}

// ── Process range ─────────────────────────────────────────────────────────────
async function processRange() {
  if (state.processing || !state.connected || !state.compInfo) {
    if (!state.connected) log("Server offline.", "warn");
    if (!state.compInfo)  log("No active comp.", "warn");
    return;
  }
  state.processing = true;
  $("btn-range").disabled = true;
  $("btn-range").textContent = "Exporting…";
  $("video-progress").classList.add("show");

  try {
    const start = parseInt($("range-start").value) || 0;
    const end   = parseInt($("range-end").value)   || state.compInfo.workEnd;
    const every = parseInt($("range-every").value) || 1;

    log(`Exporting frames ${start}–${end} (every ${every})…`);
    const exp = await evalScript("exportFrameRange", start, end, every);
    if (!exp || exp.error) throw new Error(exp?.error || "Export failed");
    log(`Exported ${exp.frames.length} frames`);

    const model  = $("model").value;
    const format = $("output-format").value;
    const colormap = $("colormap").value;
    const smooth = parseFloat($("smooth").value) || 0.4;
    const alignScale = $("align-scale").value === "true";

    $("btn-range").textContent = "Building ZIP…";
    const zip = await buildZip(exp.frames);

    $("btn-range").textContent = "Processing…";
    log(`Batch: model=${model}, smooth=${smooth}, align=${alignScale}`);

    const fd = new FormData();
    fd.append("file", new Blob([zip], { type: "application/zip" }), "frames.zip");
    fd.append("model", model);
    fd.append("format", format);
    fd.append("colormap", colormap);
    fd.append("smooth", smooth.toString());
    fd.append("align_scale", alignScale.toString());

    const r = await fetch(`${SERVER}/process/batch`, { method: "POST", body: fd });
    if (!r.ok) throw new Error("Batch failed");
    const resultZip = await r.arrayBuffer();

    const outFiles = await extractZip(resultZip, exp.dir);
    state.lastDepthPath = outFiles[0];
    log(`Saved ${outFiles.length} depth maps`, "success");
    $("btn-import-seq").disabled = false;

  } catch (e) {
    log(`Error: ${e.message}`, "error");
  } finally {
    state.processing = false;
    $("btn-range").disabled = false;
    $("btn-range").textContent = "Process Range";
    $("video-progress").classList.remove("show");
  }
}

// ── Effects ───────────────────────────────────────────────────────────────────
function getActiveFx() {
  return document.querySelector(".fx-tab.active")?.dataset.fx || "dof";
}

function getEffectParams(fx) {
  if (fx === "dof") return {
    focal_depth:  parseFloat($("dof-focal").value),
    focal_range:  parseFloat($("dof-range").value),
    max_blur:     parseFloat($("dof-blur").value),
    bokeh_shape:  $("dof-bokeh").value,
    near_blur:    $("dof-near").value === "true",
    far_blur:     $("dof-far").value  === "true",
  };
  if (fx === "grade") return {
    near_color:   $("grade-near").value,
    far_color:    $("grade-far").value,
    opacity:      parseFloat($("grade-opacity").value),
    gamma:        parseFloat($("grade-gamma").value),
    blend_mode:   $("grade-blend").value,
  };
  if (fx === "slice") return {
    near:         parseFloat($("slice-near").value),
    far:          parseFloat($("slice-far").value),
    feather:      parseFloat($("slice-feather").value),
    invert_mask:  $("slice-invert").value === "true",
    bg_alpha:     $("slice-bg").value === "transparent" ? 0 : 255,
    bg_color:     $("slice-bgcolor").value,
  };
}

async function runEffect(previewMode) {
  if (!state.connected) { log("Server offline.", "warn"); return; }
  if (!state.sessionId) { log("Process a frame first to cache depth.", "warn"); return; }

  const fx = getActiveFx();
  const params = getEffectParams(fx);

  $("fx-progress").classList.add("show");
  $("btn-fx-preview").disabled = true;
  $("btn-fx-apply").disabled = true;

  try {
    const endpoint = previewMode
      ? `${SERVER}/effect/${fx}/preview`
      : `${SERVER}/effect/${fx}`;

    const fd = new FormData();
    fd.append("session_id", state.sessionId);
    fd.append("colormap", $("colormap").value || "inferno");
    fd.append("params_json", JSON.stringify(params));

    const r = await fetch(endpoint, { method: "POST", body: fd });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || "Effect failed");

    const result = await r.arrayBuffer();

    if (previewMode) {
      showPreview(result, $("fx-preview-img"), $("fx-preview"));
      log(`${fx} preview ready`, "success");
    } else {
      // Save to disk
      const info = await evalScript("getCompInfo");
      const dir = info?.tempDir || "/tmp";
      const outPath = `${dir}/effect_${fx}_${Date.now()}.png`;
      await writeLocalFile(outPath, result);
      state.lastFxPath = outPath;
      showPreview(result, $("fx-preview-img"), $("fx-preview"));
      log(`${fx} result saved: ${outPath.split(/[/\\]/).pop()}`, "success");
      $("btn-fx-import").disabled = false;
    }
  } catch (e) {
    log(`Effect error: ${e.message}`, "error");
  } finally {
    $("fx-progress").classList.remove("show");
    $("btn-fx-preview").disabled = false;
    $("btn-fx-apply").disabled = false;
  }
}

// ── Import helpers ────────────────────────────────────────────────────────────
async function importSingle() {
  if (!state.lastDepthPath) return;
  const r = await evalScript("importDepthMap", state.lastDepthPath, true, "Depth Map");
  r?.success ? log("Depth map imported", "success") : log(r?.error || "Import failed", "error");
}

async function importSequence() {
  if (!state.lastDepthPath) return;
  const r = await evalScript("importDepthSequence", state.lastDepthPath, true);
  r?.success ? log("Depth sequence imported", "success") : log(r?.error || "Import failed", "error");
}

async function importFxResult() {
  if (!state.lastFxPath) return;
  const r = await evalScript("importDepthMap", state.lastFxPath, true, "FX Result");
  r?.success ? log("Effect result imported", "success") : log(r?.error || "Import failed", "error");
}

// ── ZIP helpers ───────────────────────────────────────────────────────────────
async function buildZip(frames) {
  const entries = [];
  for (const { path } of frames) {
    const buf = await readLocalFile(path);
    entries.push({ name: path.split(/[/\\]/).pop(), data: new Uint8Array(buf) });
  }
  return buildRawZip(entries);
}

function crc32(data) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) { c ^= data[i]; for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0); }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function buildRawZip(entries) {
  const enc = new TextEncoder();
  const parts = [], cd = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nb = enc.encode(name);
    const crc = crc32(data);
    const lh = new Uint8Array(30 + nb.length);
    const v = new DataView(lh.buffer);
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true);
    v.setUint32(14, crc, true); v.setUint32(18, data.length, true); v.setUint32(22, data.length, true);
    v.setUint16(26, nb.length, true); lh.set(nb, 30);
    parts.push(lh, data);
    const ce = new Uint8Array(46 + nb.length); const cv = new DataView(ce.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, nb.length, true); cv.setUint32(42, offset, true); ce.set(nb, 46);
    cd.push(ce); offset += lh.length + data.length;
  }
  const cdLen = cd.reduce((a, b) => a + b.length, 0);
  const eocd = new Uint8Array(22); const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true); ev.setUint32(12, cdLen, true); ev.setUint32(16, offset, true);
  const all = [...parts, ...cd, eocd];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let pos = 0; for (const c of all) { out.set(c, pos); pos += c.length; }
  return out.buffer;
}

async function extractZip(zipBuffer, dir) {
  const data = new Uint8Array(zipBuffer); const view = new DataView(zipBuffer);
  const paths = []; let i = 0;
  while (i < data.length - 4) {
    if (view.getUint32(i, true) !== 0x04034b50) { i++; continue; }
    const nLen = view.getUint16(i + 26, true); const xLen = view.getUint16(i + 28, true);
    const sz = view.getUint32(i + 18, true);
    const name = new TextDecoder().decode(data.slice(i + 30, i + 30 + nLen));
    const ds = i + 30 + nLen + xLen;
    const outPath = dir.replace(/[/\\]$/, "") + "/" + name;
    await writeLocalFile(outPath, data.slice(ds, ds + sz).buffer);
    paths.push(outPath); i = ds + sz;
  }
  return paths;
}

// ── Polling ───────────────────────────────────────────────────────────────────
async function poll() {
  const data = await ping();
  setStatus(!!data);
  if (data) {
    $("device-info").textContent = `${data.device}`;
    if (!$("colormap").options.length) await loadColormaps();
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", async () => {
  // Try to connect first; auto-start server if offline and we have CEP (Node.js)
  const initial = await ping();
  setStatus(!!initial);
  if (!initial) {
    log("Server offline — start it in Terminal first.", "warn");
  } else if (initial) {
    $("device-info").textContent = initial.device;
    await loadColormaps();
  }

  setInterval(poll, 4000);
  refreshComp();

  $("btn-refresh-comp").addEventListener("click", refreshComp);
  $("btn-frame").addEventListener("click", processCurrentFrame);
  $("btn-range").addEventListener("click", processRange);
  $("btn-import").addEventListener("click", importSingle);
  $("btn-import-seq").addEventListener("click", importSequence);
  $("btn-fx-preview").addEventListener("click", () => runEffect(true));
  $("btn-fx-apply").addEventListener("click",   () => runEffect(false));
  $("btn-fx-import").addEventListener("click",  importFxResult);

  // Main tabs
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      $(`tab-${btn.dataset.tab}`).classList.add("active");
    });
  });

  // FX sub-tabs
  document.querySelectorAll(".fx-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".fx-tab").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".fx-pane").forEach(p => p.classList.remove("active"));
      btn.classList.add("active");
      $(`fx-${btn.dataset.fx}`).classList.add("active");
    });
  });

  // Format → colormap visibility
  $("output-format").addEventListener("change", () => {
    $("colormap-row").style.display = $("output-format").value === "png_color" ? "flex" : "none";
  });

  // Slice BG mode
  $("slice-bg").addEventListener("change", () => {
    $("slice-color-row").style.display = $("slice-bg").value === "color" ? "flex" : "none";
  });
  $("slice-color-row").style.display = "none";

  if (!cs) log("Running outside CEP — AE bridge disabled.", "warn");
});
