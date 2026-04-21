/**
 * renderer3d.js — Three.js elevation/hologram renderer (clean rewrite)
 * Single shader, multi-pass rendering — matches original WebGL exactly.
 * Depends on: three.min.js, renderer3d-shaders.js
 */
window.Renderer3D = (function() {
  'use strict';

  var S = window.R3D_SHADERS;
  if (!S) { console.error('[R3D] shaders not loaded'); return {}; }
  if (typeof THREE === 'undefined') { console.error('[R3D] three.js not loaded'); return {}; }

  // ── State ──
  var canvas, renderer, scene, camera;
  var material;          // single ShaderMaterial for all passes
  var triGeom, lineGeom, pointGeom;
  var triMesh, lineMesh, pointMesh;
  var depthTex, srcTex;
  var depthLoaded = false, srcLoaded = false;
  var depthDataRaw, depthW, depthH;
  var _videoMode = false; // true when using VideoTexture
  var lastDensity = 0, lastGridType = '', lastSmoothing = -1;
  var holoMode = false, visible = false, initialized = false;
  var loopActive = false, animId = null;

  // Camera
  var camRX = -35, camRY = 15, camRZ = 0, camZoom = 1.2;
  var panX = 0, panY = 0;

  // Animation
  var animType = null, animT = 0, animSpeed = 1, animDir = 1;
  var animBaseRX, animBaseRY, animBaseRZ, animBaseZoom;
  var TWO_PI = Math.PI * 2;

  // Uniforms — single object, shared by one material
  var U = {
    uDepth:        { value: null },
    uSrcTex:       { value: null },
    uElevation:    { value: 0.3 },
    uElevOverride: { value: -100.0 },
    uGapOffset:    { value: 0.0 },
    uRenderMode:   { value: 0.0 },
    uGlowPass:     { value: 0.0 },
    uGridColor:    { value: new THREE.Color(0x00ff88) },
    uGridColor2:   { value: new THREE.Color(0x0044ff) },
    uHoloColor:    { value: new THREE.Color(0x00ff88) },
    uHoloColorMid: { value: new THREE.Color(0x00aa55) },
    uBgColor:      { value: new THREE.Color(0x0a0a14) },
    uGlow:         { value: 0.8 },
    uSrcTint:      { value: new THREE.Color(0xffffff) },
    uSrcTintAmt:   { value: 0.0 },
    uDither:       { value: 0.0 },
    uDitherStyle:  { value: 1.0 },
    uScanLines:    { value: 0.0 },
    uScanDensity:  { value: 3.0 },
    uScanOpacity:  { value: 0.3 },
    uScanSpeed:    { value: 0.5 },
    uScanDir:      { value: 1.0 },
    uTime:         { value: 0.0 }
  };

  // ── Split elevation state (per-pass overrides) ──
  var splitEnabled = false;
  var splitSrcElev = 0, splitGridElev = 0.3;

  // ── Render config (read from adapter each frame) ──
  var showGrid = true, showImage = false, showPoints = false, hideLines = false;

  // ── Init ──
  function init(cvs, opts) {
    if (initialized) return;
    opts = opts || {};
    canvas = cvs;
    var w = opts.width || 1200, h = opts.height || 800;

    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.autoClear = false;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(50, w / h, 0.01, 100);

    material = new THREE.ShaderMaterial({
      uniforms: U,
      vertexShader: S.vertexShader,
      fragmentShader: S.fragmentShader,
      side: THREE.DoubleSide,
      depthTest: true,
      depthWrite: true,
      transparent: false
    });

    initialized = true;
    console.log('[R3D] Init ' + w + 'x' + h);
  }

  // ── Mesh ──
  function buildMesh(density, gridType) {
    gridType = gridType || 'square';
    if (density === lastDensity && gridType === lastGridType) return;
    lastDensity = density; lastGridType = gridType;

    var N = density;
    var pos = new Float32Array(N * N * 3);
    var uvs = new Float32Array(N * N * 2);
    for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
      var i = y * N + x;
      var u = x / (N - 1), v = y / (N - 1);
      pos[i * 3] = (u - 0.5) * 2;
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = (v - 0.5) * 2;
      uvs[i * 2] = u; uvs[i * 2 + 1] = v;
    }

    // Triangles
    var tri = [];
    for (var y = 0; y < N - 1; y++) for (var x = 0; x < N - 1; x++) {
      var tl = y * N + x, tr = tl + 1, bl = tl + N, br = bl + 1;
      tri.push(tl, bl, tr, tr, bl, br);
    }

    // Lines
    var li = [], I = function(x, y) { return y * N + x; };
    if (gridType === 'polygon') {
      for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
        if (x < N - 1) li.push(I(x, y), I(x + 1, y));
        if (y < N - 1) li.push(I(x, y), I(x, y + 1));
        if (x < N - 1 && y < N - 1) { if (y % 2 === 0) li.push(I(x, y), I(x + 1, y + 1)); else li.push(I(x + 1, y), I(x, y + 1)); }
      }
    } else if (gridType === 'hex') {
      for (var y = 0; y < N; y++) { var odd = y % 2; for (var x = 0; x < N; x++) {
        if (x < N - 1 && (x + odd) % 2 === 0) li.push(I(x, y), I(x + 1, y));
        if (y < N - 1 && (x + odd) % 2 === 0) { li.push(I(x, y), I(x, y + 1)); if (x < N - 1) li.push(I(x, y), I(x + 1, y + 1)); }
      }}
    } else if (gridType === 'cross') {
      for (var y = 0; y < N - 1; y++) for (var x = 0; x < N - 1; x++) { li.push(I(x, y), I(x + 1, y + 1)); li.push(I(x + 1, y), I(x, y + 1)); }
    } else if (gridType === 'dotmatrix') {
      // No lines for dotmatrix — points only
    } else if (gridType === 'dot') {
      for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
        if (x < N - 1) li.push(I(x, y), I(x + 1, y));
        if (y < N - 1) li.push(I(x, y), I(x, y + 1));
        if (x < N - 1 && y < N - 1) li.push(I(x, y), I(x + 1, y + 1));
        if (x > 0 && y < N - 1) li.push(I(x, y), I(x - 1, y + 1));
      }
    } else { // square
      for (var y = 0; y < N; y++) for (var x = 0; x < N; x++) {
        if (x < N - 1) li.push(I(x, y), I(x + 1, y));
        if (y < N - 1) li.push(I(x, y), I(x, y + 1));
      }
    }

    // Remove old
    if (triMesh) { scene.remove(triMesh); triMesh.geometry.dispose(); }
    if (lineMesh) { scene.remove(lineMesh); lineMesh.geometry.dispose(); }
    if (pointMesh) { scene.remove(pointMesh); pointMesh.geometry.dispose(); }

    triGeom = new THREE.BufferGeometry();
    triGeom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    triGeom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    triGeom.setIndex(tri);
    triMesh = new THREE.Mesh(triGeom, material);
    triMesh.frustumCulled = false;

    lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute('position', new THREE.BufferAttribute(pos.slice(), 3));
    lineGeom.setAttribute('uv', new THREE.BufferAttribute(uvs.slice(), 2));
    if (li.length > 0) lineGeom.setIndex(li);
    lineMesh = new THREE.LineSegments(lineGeom, material);
    lineMesh.frustumCulled = false;

    pointGeom = new THREE.BufferGeometry();
    pointGeom.setAttribute('position', new THREE.BufferAttribute(pos.slice(), 3));
    pointGeom.setAttribute('uv', new THREE.BufferAttribute(uvs.slice(), 2));
    pointMesh = new THREE.Points(pointGeom, material);
    pointMesh.frustumCulled = false;

    // Add all to scene (visibility controlled per render pass)
    scene.add(triMesh);
    scene.add(lineMesh);
    scene.add(pointMesh);

    showPoints = (gridType === 'dot' || gridType === 'dotmatrix');
    hideLines = (gridType === 'dotmatrix');
  }

  // ── Textures ──
  function setDepthImage(blob, smoothing) {
    smoothing = smoothing || 0;
    return new Promise(function(resolve) {
      var img = new Image();
      img.onload = function() {
        var c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        var ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        var id = ctx.getImageData(0, 0, img.width, img.height);
        depthW = img.width; depthH = img.height;
        depthDataRaw = new Float32Array(depthW * depthH);
        for (var i = 0; i < depthDataRaw.length; i++) depthDataRaw[i] = id.data[i * 4] / 255.0;
        URL.revokeObjectURL(img.src);
        uploadDepthTex(smoothing);
        depthLoaded = true;
        resolve();
      };
      img.src = URL.createObjectURL(blob);
    });
  }

  function setSourceImage(blob) {
    return new Promise(function(resolve) {
      var img = new Image();
      img.onload = function() {
        if (srcTex) srcTex.dispose();
        srcTex = new THREE.Texture(img);
        srcTex.flipY = false;
        srcTex.needsUpdate = true;
        srcTex.minFilter = THREE.LinearFilter;
        srcTex.magFilter = THREE.LinearFilter;
        srcTex.wrapS = THREE.ClampToEdgeWrapping;
        srcTex.wrapT = THREE.ClampToEdgeWrapping;
        U.uSrcTex.value = srcTex;
        srcLoaded = true;
        URL.revokeObjectURL(img.src);
        resolve();
      };
      img.src = URL.createObjectURL(blob);
    });
  }

  function uploadDepthTex(smoothing) {
    if (!depthDataRaw) return;
    var data = smoothing > 0 ? blurDepth(depthDataRaw, depthW, depthH, smoothing) : depthDataRaw;
    var rgba = new Uint8Array(depthW * depthH * 4);
    for (var i = 0; i < depthW * depthH; i++) {
      var v = Math.round(data[i] * 255);
      rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255;
    }
    if (depthTex) depthTex.dispose();
    depthTex = new THREE.DataTexture(rgba, depthW, depthH, THREE.RGBAFormat);
    depthTex.flipY = false;
    depthTex.minFilter = THREE.LinearFilter;
    depthTex.magFilter = THREE.LinearFilter;
    depthTex.wrapS = THREE.ClampToEdgeWrapping;
    depthTex.wrapT = THREE.ClampToEdgeWrapping;
    depthTex.needsUpdate = true;
    U.uDepth.value = depthTex;
    lastSmoothing = smoothing;
  }

  function blurDepth(d, w, h, r) {
    var tmp = new Float32Array(d.length), out = new Float32Array(d.length);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var s = 0, c = 0;
      for (var dx = -r; dx <= r; dx++) { var nx = x + dx; if (nx >= 0 && nx < w) { s += d[y * w + nx]; c++; } }
      tmp[y * w + x] = s / c;
    }
    for (var x = 0; x < w; x++) for (var y = 0; y < h; y++) {
      var s = 0, c = 0;
      for (var dy = -r; dy <= r; dy++) { var ny = y + dy; if (ny >= 0 && ny < h) { s += tmp[ny * w + x]; c++; } }
      out[y * w + x] = s / c;
    }
    return out;
  }

  // ── Camera ──
  function updateCamera() {
    if (!camera) return;
    var dist = 4.0 / camZoom;
    var rx = camRX * Math.PI / 180, ry = camRY * Math.PI / 180;
    camera.position.set(
      dist * Math.sin(ry) * Math.cos(rx) + panX,
      dist * Math.sin(-rx) + panY,
      dist * Math.cos(ry) * Math.cos(rx)
    );
    camera.lookAt(panX, panY, 0);
    var rz = camRZ * Math.PI / 180;
    camera.up.set(Math.sin(rz), Math.cos(rz), 0);
  }

  function setCamera(rx, ry, rz, zoom) { camRX = rx; camRY = ry; camRZ = rz; camZoom = zoom; }
  function getCamera() { return { rx: camRX, ry: camRY, rz: camRZ, zoom: camZoom }; }
  function setPan(x, y) { panX = x; panY = y; }
  function getPan() { return { x: panX, y: panY }; }

  function setCameraPreset(name) {
    var p = { 'default': [-35, 15, 1.2], iso: [-35, 45, 1.2], top: [-90, 0, 1.0], front: [0, 0, 1.2],
              side: [0, 90, 1.2], close: [-60, 30, 1.5], rear: [-20, 160, 1.0], wide: [-70, -45, 0.8] }[name];
    if (p) setCamera(p[0], p[1], 0, p[2]);
  }

  // ── Setters ──
  function setElevation(h) { U.uElevation.value = h; }
  function setGlow(v) { U.uGlow.value = v; }
  var _gapValue = 0;
  function setGap(v) { _gapValue = v * -0.005; }
  function setColors(near, mid, far, bg) {
    U.uGridColor.value.set(near);
    if (mid) U.uHoloColorMid.value.set(mid);
    U.uGridColor2.value.set(far);
    U.uBgColor.value.set(bg);
  }
  function setScanLines(o) {
    U.uScanLines.value = o.enabled ? 1 : 0;
    if (o.density !== undefined) U.uScanDensity.value = o.density;
    if (o.opacity !== undefined) U.uScanOpacity.value = o.opacity;
    if (o.speed !== undefined) U.uScanSpeed.value = o.speed;
    if (o.dir !== undefined) U.uScanDir.value = o.dir;
  }
  function setDither(o) {
    U.uDither.value = o.enabled ? 1 : 0;
    var m = { none: 0, bayer4: 1, bayer8: 2, halftone: 3, crosshatch: 4, noise: 5 };
    U.uDitherStyle.value = m[o.style] || 1;
  }
  function setSrcTint(color, amt) { U.uSrcTint.value.set(color); U.uSrcTintAmt.value = amt; }
  function setHoloMode(v) { holoMode = v; }
  function setSplitElevation(srcE, gridE) { splitEnabled = true; splitSrcElev = srcE; splitGridElev = gridE; }
  function clearSplitElevation() { splitEnabled = false; }
  function setDensity(n) { buildMesh(n, lastGridType || 'square'); }
  function setGridType(t) { buildMesh(lastDensity || 40, t); }
  function setLayerVisible(name, v) {
    if (name === 'grid') showGrid = v;
    if (name === 'source') showImage = v;
  }
  function setBloom() {} // placeholder

  // ── Render (multi-pass, single material) ──
  var _renderCount = 0;
  function render() {
    if (!renderer || !depthLoaded || !material) {
      if (_renderCount === 0) console.warn('[R3D] render skipped: renderer=' + !!renderer + ' depthLoaded=' + depthLoaded + ' material=' + !!material);
      return;
    }
    if (_renderCount < 3) console.log('[R3D] render #' + _renderCount + ' videoMode=' + _videoMode + ' holoMode=' + holoMode + ' showGrid=' + showGrid);
    _renderCount++;

    U.uTime.value = performance.now() / 1000;
    updateCamera();
    renderer.setClearColor(U.uBgColor.value, 1);
    renderer.clear(true, true, true);

    // Hide everything first
    triMesh.visible = false;
    lineMesh.visible = false;
    pointMesh.visible = false;

    // PASS 1: Hologram body OR source image (filled triangles)
    if (holoMode && srcLoaded) {
      U.uRenderMode.value = 2.0;
      U.uGlowPass.value = 0.0;
      U.uElevOverride.value = splitEnabled ? splitSrcElev : -100.0;
      U.uGapOffset.value = 0.0; // source layer at zero gap
      triMesh.visible = true;
      renderer.render(scene, camera);
      triMesh.visible = false;
    } else if (showImage && srcLoaded && !showGrid) {
      U.uRenderMode.value = 1.0;
      U.uGlowPass.value = 0.0;
      U.uElevOverride.value = -100.0;
      U.uGapOffset.value = 0.0;
      triMesh.visible = true;
      renderer.render(scene, camera);
      triMesh.visible = false;
    }

    // PASS 2: Grid wireframe
    if (showGrid && !hideLines && lineGeom.index && lineGeom.index.count > 0) {
      U.uRenderMode.value = 0.0;
      U.uElevOverride.value = splitEnabled ? splitGridElev : -100.0;
      U.uGapOffset.value = _gapValue; // grid gets gap offset

      if (holoMode) {
        material.blending = THREE.AdditiveBlending;
        material.depthWrite = false;
        material.transparent = true;
      }

      // Glow pass
      if (U.uGlow.value > 0) {
        U.uGlowPass.value = 1.0;
        lineMesh.visible = true;
        renderer.render(scene, camera);
        lineMesh.visible = false;
      }

      // Main pass
      U.uGlowPass.value = 0.0;
      lineMesh.visible = true;
      renderer.render(scene, camera);
      lineMesh.visible = false;

      if (holoMode) {
        material.blending = THREE.NormalBlending;
        material.depthWrite = true;
        material.transparent = false;
      }
    }

    // PASS 3: Points (dot/dotmatrix)
    if (showGrid && showPoints) {
      U.uRenderMode.value = 3.0;
      U.uGlowPass.value = 0.0;
      U.uElevOverride.value = splitEnabled ? splitGridElev : -100.0;
      U.uGapOffset.value = _gapValue; // points get gap too

      if (holoMode) {
        material.blending = THREE.AdditiveBlending;
        material.depthWrite = false;
        material.transparent = true;
      }

      pointMesh.visible = true;
      renderer.render(scene, camera);
      pointMesh.visible = false;

      if (holoMode) {
        material.blending = THREE.NormalBlending;
        material.depthWrite = true;
        material.transparent = false;
      }
    }

    // Reset gap for next frame's source pass
    U.uElevOverride.value = -100.0;
  }

  // ── Animation ──
  function tickAnimation() {
    if (!animType) return;
    animT += 0.01 * animSpeed * animDir;
    if (animT >= TWO_PI) animT -= TWO_PI;
    if (animT < 0) animT += TWO_PI;
    var f = animT / TWO_PI, t = animT;
    var bRX = animBaseRX, bRY = animBaseRY, bRZ = animBaseRZ, bZ = animBaseZoom;

    if (animType === 'orbit-y' || animType === 'orbit') { var ry = bRY + f * 360; while (ry > 180) ry -= 360; setCamera(bRX, ry, bRZ, bZ); }
    else if (animType === 'orbit-x') { var rx = bRX + f * 360; while (rx > 180) rx -= 360; setCamera(rx, bRY, bRZ, bZ); }
    else if (animType === 'orbit-z') { var rz = bRZ + f * 360; while (rz > 180) rz -= 360; setCamera(bRX, bRY, rz, bZ); }
    else if (animType === 'wiggle') { setCamera(bRX, bRY - Math.cos(t) * 15, bRZ, bZ); }
    else if (animType === 'spin') { var sry = bRY + f * 360; while (sry > 180) sry -= 360; var srz = bRZ + f * 180; while (srz > 180) srz -= 360; setCamera(bRX + Math.sin(t) * 25, sry, srz, bZ); }
    else if (animType === 'handheld') { setCamera(bRX + Math.sin(t * 2) * 2.5 + Math.sin(t * 5) * 1.2, bRY + Math.sin(t * 3) * 3 + Math.sin(t * 7) * 1, bRZ + Math.sin(t * 4) * 1, bZ); }
    else if (animType === 'dolly') { setCamera(bRX, bRY + Math.sin(t * 2) * 8, bRZ, bZ + Math.sin(t) * 0.8); }
    else if (animType === 'breathe') { setCamera(bRX, bRY + Math.sin(t) * 15, bRZ, bZ); }
    else if (animType === 'tilt') { setCamera(bRX + Math.sin(t) * 30, bRY + Math.sin(t * 2) * 20, bRZ, bZ); }
    else if (animType === 'flyover') { var fry = bRY + f * 360; while (fry > 180) fry -= 360; setCamera(bRX + Math.sin(t) * 25 - 40, fry, bRZ, bZ + Math.sin(t * 2) * 0.3); }
  }

  function startAnimation(type, speed, dir) {
    animType = type; animT = 0; animSpeed = speed || 1; animDir = dir || 1;
    animBaseRX = camRX; animBaseRY = camRY; animBaseRZ = camRZ; animBaseZoom = camZoom;
  }
  function stopAnimation() { animType = null; }
  function setAnimationSpeed(v) { animSpeed = v; }
  function setAnimationDirection(v) { animDir = v; }

  // ── Loop ──
  function startLoop() {
    if (loopActive) return;
    loopActive = true; visible = true;
    function tick() {
      if (!loopActive) return;
      tickAnimation();
      render();
      animId = requestAnimationFrame(tick);
    }
    animId = requestAnimationFrame(tick);
  }
  function stopLoop() { loopActive = false; if (animId) { cancelAnimationFrame(animId); animId = null; } }

  // ── Show/Hide ──
  function show(cvs, asHolo) {
    holoMode = !!asHolo;
    if (!initialized) { init(cvs); buildMesh(40, 'square'); }
    visible = true;
    startLoop();
  }
  function hide() { visible = false; stopLoop(); stopAnimation(); }
  function isVisible() { return visible; }

  function reload(depthBlob, srcBlob, smoothing, cb) {
    depthLoaded = false; srcLoaded = false; lastSmoothing = -1;
    var p = [];
    if (depthBlob) p.push(setDepthImage(depthBlob, smoothing || 0));
    if (srcBlob) p.push(setSourceImage(srcBlob));
    Promise.all(p).then(function() { if (cb) cb(); });
  }

  // ── Export ──
  function captureFrame() {
    return new Promise(function(res) { render(); canvas.toBlob(function(b) { res(b); }, 'image/png'); });
  }
  function captureAnimation(type, fps, dur) {
    fps = fps || 24; dur = dur || 3;
    var total = fps * dur, frames = [], idx = 0;
    var bRX = camRX, bRY = camRY, bRZ = camRZ, bZ = camZoom;
    return new Promise(function(res) {
      function next() {
        if (idx >= total) { res(frames); return; }
        animT = (idx / total) * TWO_PI; animType = type;
        animBaseRX = bRX; animBaseRY = bRY; animBaseRZ = bRZ; animBaseZoom = bZ;
        tickAnimation(); render();
        canvas.toBlob(function(b) { frames.push(b); idx++; setTimeout(next, 0); }, 'image/png');
      }
      next();
    });
  }

  // ── Video Texture Mode ──
  function setVideoTextures(srcVideoEl, depthVideoEl) {
    console.log('[R3D] setVideoTextures src=' + srcVideoEl.readyState + ' depth=' + depthVideoEl.readyState + ' src.dur=' + srcVideoEl.duration + ' depth.dur=' + depthVideoEl.duration);
    if (srcTex) srcTex.dispose();
    if (depthTex) depthTex.dispose();

    srcTex = new THREE.VideoTexture(srcVideoEl);
    srcTex.minFilter = THREE.LinearFilter;
    srcTex.magFilter = THREE.LinearFilter;
    srcTex.format = THREE.RGBFormat;
    U.uSrcTex.value = srcTex;
    srcLoaded = true;

    depthTex = new THREE.VideoTexture(depthVideoEl);
    depthTex.minFilter = THREE.LinearFilter;
    depthTex.magFilter = THREE.LinearFilter;
    depthTex.format = THREE.RGBFormat;
    U.uDepth.value = depthTex;
    depthLoaded = true;

    _videoMode = true;
    console.log('[R3D] VideoTexture mode active');
  }

  function clearVideoTextures() {
    _videoMode = false;
    if (srcTex && srcTex.isVideoTexture) { srcTex.dispose(); srcTex = null; U.uSrcTex.value = null; srcLoaded = false; }
    if (depthTex && depthTex.isVideoTexture) { depthTex.dispose(); depthTex = null; U.uDepth.value = null; depthLoaded = false; }
  }

  function isVideoMode() { return _videoMode; }

  return {
    init: init, show: show, hide: hide, isVisible: isVisible, reload: reload,
    render: render, startLoop: startLoop, stopLoop: stopLoop,
    setCamera: setCamera, getCamera: getCamera, setCameraPreset: setCameraPreset,
    setPan: setPan, getPan: getPan,
    setElevation: setElevation, setGlow: setGlow, setGap: setGap,
    setColors: setColors, setScanLines: setScanLines, setDither: setDither,
    setSrcTint: setSrcTint, setHoloMode: setHoloMode,
    setSplitElevation: setSplitElevation, clearSplitElevation: clearSplitElevation,
    setDensity: setDensity, setGridType: setGridType,
    setLayerVisible: setLayerVisible, setLayerOpacity: function() {},
    setBloom: setBloom,
    startAnimation: startAnimation, stopAnimation: stopAnimation,
    setAnimationSpeed: setAnimationSpeed, setAnimationDirection: setAnimationDirection,
    captureFrame: captureFrame, captureAnimation: captureAnimation,
    setVideoTextures: setVideoTextures, clearVideoTextures: clearVideoTextures, isVideoMode: isVideoMode,
    _buildMesh: buildMesh, _getCanvas: function() { return canvas; }
  };
})();
