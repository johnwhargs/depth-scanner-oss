/**
 * renderer3d.js — Three.js multi-layer elevation/hologram renderer
 * Replaces raw WebGL renderer. Depends on: three.min.js, three-addons/*, renderer3d-shaders.js
 * Exposes: window.Renderer3D
 */
window.Renderer3D = (function() {
  'use strict';

  var S = window.R3D_SHADERS;
  if (!S) { console.error('[R3D] renderer3d-shaders.js not loaded'); return {}; }
  if (typeof THREE === 'undefined') { console.error('[R3D] three.js not loaded'); return {}; }

  // ── Internal state ──
  var _canvas = null;
  var _renderer = null;
  var _scene = null;
  var _camera = null;
  var _composer = null;
  var _bloomPass = null;
  var _animId = null;
  var _loopActive = false;

  // Layers
  var _sourceGroup = null;
  var _depthGroup = null;
  var _gridGroup = null;
  var _sourceMesh = null;
  var _depthMesh = null;
  var _gridLines = null;
  var _gridPoints = null;

  // Textures
  var _depthTex = null;
  var _srcTex = null;
  var _depthLoaded = false;
  var _srcLoaded = false;
  var _depthDataRaw = null;
  var _depthW = 0, _depthH = 0;

  // Materials
  var _sourceMat = null;
  var _depthMat = null;
  var _gridMat = null;
  var _pointsMat = null;
  var _holoMat = null;

  // Mesh state
  var _lastDensity = 0;
  var _lastGridType = '';
  var _lastSmoothing = -1;

  // Mode
  var _holoMode = false;
  var _visible = false;
  var _initialized = false;

  // Animation
  var _animType = null;
  var _animT = 0;
  var _animSpeed = 1.0;
  var _animDir = 1;
  var _animBaseRX = 0, _animBaseRY = 0, _animBaseRZ = 0, _animBaseZoom = 1.2;
  var TWO_PI = Math.PI * 2;

  // Camera state (degrees)
  var _camRX = -35, _camRY = 15, _camRZ = 0, _camZoom = 1.2;

  // Frame-ahead buffer
  var _frameBuffer = {
    enabled: false,
    capacity: 12,
    targets: [],
    writeHead: 0,
    readHead: 0,
    filled: 0,
    paramVersion: 0,
    state: 'idle'
  };

  // ── Deep-clone uniforms per material (critical — shallow copy shares value refs) ──
  function _cloneUniforms(src) {
    var out = {};
    for (var key in src) {
      var u = src[key];
      if (u.value && u.value.isColor) {
        out[key] = { value: u.value.clone() };
      } else if (u.value && u.value.isVector2) {
        out[key] = { value: u.value.clone() };
      } else {
        out[key] = { value: u.value };
      }
    }
    return out;
  }

  // Base uniform definitions (templates — cloned per material)
  var _uniformDefs = {
    uDepth: { value: null },
    uElevation: { value: 0.3 },
    uElevOverride: { value: -100.0 },
    uGapOffset: { value: 0.0 },
    uGridColor: { value: new THREE.Color(0x00ff88) },
    uGridColor2: { value: new THREE.Color(0x0044ff) },
    uHoloColorMid: { value: new THREE.Color(0x00aa55) },
    uHoloColor: { value: new THREE.Color(0x00ff88) },
    uBgColor: { value: new THREE.Color(0x0a0a14) },
    uGlow: { value: 0.8 },
    uGlowPass: { value: 0.0 },
    uSrcTex: { value: null },
    uSrcTint: { value: new THREE.Color(0xffffff) },
    uSrcTintAmt: { value: 0.0 },
    uDither: { value: 0.0 },
    uScanLines: { value: 0.0 },
    uScanDensity: { value: 3.0 },
    uScanOpacity: { value: 0.3 },
    uScanSpeed: { value: 0.5 },
    uScanDir: { value: 1.0 },
    uTime: { value: 0.0 }
  };

  // ── Update ALL materials' shared uniforms from current values ──
  function _syncUniforms() {
    var mats = [_sourceMat, _depthMat, _gridMat, _pointsMat, _holoMat];
    var t = performance.now() / 1000.0;
    for (var i = 0; i < mats.length; i++) {
      var m = mats[i];
      if (!m) continue;
      var u = m.uniforms;
      u.uDepth.value = _depthTex;
      u.uElevation.value = _uniformDefs.uElevation.value;
      u.uGapOffset.value = _uniformDefs.uGapOffset.value;
      u.uSrcTex.value = _srcTex;
      u.uTime.value = t;
      // Colors (set on Color objects, not replace)
      u.uGridColor.value.copy(_uniformDefs.uGridColor.value);
      u.uGridColor2.value.copy(_uniformDefs.uGridColor2.value);
      u.uHoloColorMid.value.copy(_uniformDefs.uHoloColorMid.value);
      u.uHoloColor.value.copy(_uniformDefs.uHoloColor.value);
      u.uBgColor.value.copy(_uniformDefs.uBgColor.value);
      u.uSrcTint.value.copy(_uniformDefs.uSrcTint.value);
      u.uSrcTintAmt.value = _uniformDefs.uSrcTintAmt.value;
      u.uGlow.value = _uniformDefs.uGlow.value;
      u.uDither.value = _uniformDefs.uDither.value;
      u.uScanLines.value = _uniformDefs.uScanLines.value;
      u.uScanDensity.value = _uniformDefs.uScanDensity.value;
      u.uScanOpacity.value = _uniformDefs.uScanOpacity.value;
      u.uScanSpeed.value = _uniformDefs.uScanSpeed.value;
      u.uScanDir.value = _uniformDefs.uScanDir.value;
      // uElevOverride and uGlowPass are per-material — DON'T overwrite
    }
  }

  // ── Init ──
  function init(canvas, options) {
    if (_initialized && _canvas === canvas) return; // already init'd on this canvas
    options = options || {};
    _canvas = canvas;
    var w = options.width || 1200;
    var h = options.height || 800;

    _renderer = new THREE.WebGLRenderer({ canvas: _canvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
    _renderer.setSize(w, h);
    _renderer.setPixelRatio(window.devicePixelRatio || 1);
    _renderer.autoClear = true;

    _scene = new THREE.Scene();
    _scene.background = new THREE.Color(0x0a0a14);

    _camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
    _camera.position.set(0, 0, 4);
    _camera.lookAt(0, 0, 0);

    // Layer groups
    _sourceGroup = new THREE.Group();
    _sourceGroup.name = 'source';
    _sourceGroup.renderOrder = 0;

    _depthGroup = new THREE.Group();
    _depthGroup.name = 'depth';
    _depthGroup.renderOrder = 1;
    _depthGroup.visible = false;

    _gridGroup = new THREE.Group();
    _gridGroup.name = 'grid';
    _gridGroup.renderOrder = 2;

    _scene.add(_sourceGroup);
    _scene.add(_depthGroup);
    _scene.add(_gridGroup);

    // Post-processing
    _composer = null;
    _bloomPass = null;
    if (typeof THREE.EffectComposer !== 'undefined') {
      _composer = new THREE.EffectComposer(_renderer);
      _composer.addPass(new THREE.RenderPass(_scene, _camera));
      if (typeof THREE.UnrealBloomPass !== 'undefined') {
        _bloomPass = new THREE.UnrealBloomPass(new THREE.Vector2(w, h), 0, 0.4, 0.85);
        _bloomPass.enabled = false;
        _composer.addPass(_bloomPass);
      }
    }

    _initialized = true;
    console.log('[R3D] Initialized ' + w + 'x' + h + (_composer ? ' +bloom' : ' (no post-processing)'));
  }

  // ── Dispose ──
  function dispose() {
    stopLoop();
    if (_renderer) _renderer.dispose();
    if (_depthTex) _depthTex.dispose();
    if (_srcTex) _srcTex.dispose();
    _depthLoaded = false;
    _srcLoaded = false;
    _initialized = false;
  }

  // ── Resize ──
  function resize(w, h) {
    if (!_renderer) return;
    _renderer.setSize(w, h);
    _camera.aspect = w / h;
    _camera.updateProjectionMatrix();
    if (_composer) _composer.setSize(w, h);
    if (_bloomPass) _bloomPass.resolution.set(w, h);
  }

  // ── Texture loading ──
  function setDepthImage(blob, smoothing) {
    smoothing = smoothing || 0;
    return new Promise(function(resolve) {
      var img = new Image();
      img.onload = function() {
        var tc = document.createElement('canvas');
        tc.width = img.width; tc.height = img.height;
        var tctx = tc.getContext('2d');
        tctx.drawImage(img, 0, 0);
        var id = tctx.getImageData(0, 0, img.width, img.height);
        _depthW = img.width; _depthH = img.height;
        _depthDataRaw = new Float32Array(_depthW * _depthH);
        for (var i = 0; i < _depthDataRaw.length; i++) {
          _depthDataRaw[i] = id.data[i * 4] / 255.0;
        }
        URL.revokeObjectURL(img.src);
        _uploadDepthTex(smoothing);
        _depthLoaded = true;
        resolve();
      };
      img.src = URL.createObjectURL(blob);
    });
  }

  function setSourceImage(blob) {
    return new Promise(function(resolve) {
      var img = new Image();
      img.onload = function() {
        if (_srcTex) _srcTex.dispose();
        _srcTex = new THREE.Texture(img);
        _srcTex.needsUpdate = true;
        _srcTex.minFilter = THREE.LinearFilter;
        _srcTex.magFilter = THREE.LinearFilter;
        _srcTex.wrapS = THREE.ClampToEdgeWrapping;
        _srcTex.wrapT = THREE.ClampToEdgeWrapping;
        _srcLoaded = true;
        URL.revokeObjectURL(img.src);
        resolve();
      };
      img.src = URL.createObjectURL(blob);
    });
  }

  function updateFrame(sourceBlob, depthBlob) {
    return Promise.all([
      sourceBlob ? setSourceImage(sourceBlob) : Promise.resolve(),
      depthBlob ? setDepthImage(depthBlob) : Promise.resolve()
    ]);
  }

  function _uploadDepthTex(smoothing) {
    if (!_depthDataRaw) return;
    var data = smoothing > 0 ? _blurDepth(_depthDataRaw, _depthW, _depthH, smoothing) : _depthDataRaw;
    var rgba = new Uint8Array(_depthW * _depthH * 4);
    for (var i = 0; i < _depthW * _depthH; i++) {
      var v = Math.round(data[i] * 255);
      rgba[i * 4] = v; rgba[i * 4 + 1] = v; rgba[i * 4 + 2] = v; rgba[i * 4 + 3] = 255;
    }
    if (_depthTex) _depthTex.dispose();
    _depthTex = new THREE.DataTexture(rgba, _depthW, _depthH, THREE.RGBAFormat);
    _depthTex.minFilter = THREE.LinearFilter;
    _depthTex.magFilter = THREE.LinearFilter;
    _depthTex.wrapS = THREE.ClampToEdgeWrapping;
    _depthTex.wrapT = THREE.ClampToEdgeWrapping;
    _depthTex.needsUpdate = true;
    _lastSmoothing = smoothing;
  }

  function _blurDepth(d, w, h, radius) {
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

  // ── Mesh building ──
  function _buildMesh(density, gridType) {
    gridType = gridType || 'square';
    if (!_initialized) return;
    if (density === _lastDensity && gridType === _lastGridType) return;
    _lastDensity = density;
    _lastGridType = gridType;

    var gridW = density, gridH = density;

    // Build positions + UVs
    var positions = new Float32Array(gridW * gridH * 3);
    var uvs = new Float32Array(gridW * gridH * 2);
    for (var y = 0; y < gridH; y++) {
      for (var x = 0; x < gridW; x++) {
        var idx = y * gridW + x;
        var u = x / (gridW - 1);
        var v = y / (gridH - 1);
        positions[idx * 3] = (u - 0.5) * 2;
        positions[idx * 3 + 1] = 0;
        positions[idx * 3 + 2] = (v - 0.5) * 2;
        uvs[idx * 2] = u;
        uvs[idx * 2 + 1] = v;
      }
    }

    // Triangle indices
    var triIdx = [];
    for (var y3 = 0; y3 < gridH - 1; y3++) {
      for (var x3 = 0; x3 < gridW - 1; x3++) {
        var tl = y3 * gridW + x3, tr = tl + 1, bl = tl + gridW, br = bl + 1;
        triIdx.push(tl, bl, tr, tr, bl, br);
      }
    }

    // Line indices
    var lineIdx = [];
    var I = function(x, y) { return y * gridW + x; };
    _buildGridLines(lineIdx, gridW, gridH, gridType, I);

    // Geometries
    var triGeom = new THREE.BufferGeometry();
    triGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    triGeom.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    triGeom.setIndex(triIdx);

    var lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
    lineGeom.setAttribute('uv', new THREE.BufferAttribute(uvs.slice(), 2));
    lineGeom.setIndex(lineIdx);

    var pointGeom = new THREE.BufferGeometry();
    pointGeom.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
    pointGeom.setAttribute('uv', new THREE.BufferAttribute(uvs.slice(), 2));

    // Materials — each gets DEEP-CLONED uniforms
    _sourceMat = new THREE.ShaderMaterial({
      uniforms: _cloneUniforms(_uniformDefs),
      vertexShader: S.meshVert, fragmentShader: S.sourceFrag,
      side: THREE.DoubleSide, depthTest: true
    });

    _depthMat = new THREE.ShaderMaterial({
      uniforms: _cloneUniforms(_uniformDefs),
      vertexShader: S.meshVert, fragmentShader: S.depthFrag,
      side: THREE.DoubleSide, depthTest: true
    });

    _holoMat = new THREE.ShaderMaterial({
      uniforms: _cloneUniforms(_uniformDefs),
      vertexShader: S.meshVert, fragmentShader: S.holoFrag,
      side: THREE.DoubleSide, depthTest: true
    });

    _gridMat = new THREE.ShaderMaterial({
      uniforms: _cloneUniforms(_uniformDefs),
      vertexShader: S.meshVert, fragmentShader: S.gridFrag,
      depthWrite: false, depthTest: true, transparent: true
    });

    _pointsMat = new THREE.ShaderMaterial({
      uniforms: _cloneUniforms(_uniformDefs),
      vertexShader: S.meshVert, fragmentShader: S.pointsFrag,
      depthWrite: false, depthTest: true, transparent: true
    });

    // Clear and rebuild scene
    _sourceGroup.clear();
    _depthGroup.clear();
    _gridGroup.clear();

    _sourceMesh = new THREE.Mesh(triGeom, _holoMode ? _holoMat : _sourceMat);
    _sourceGroup.add(_sourceMesh);

    _depthMesh = new THREE.Mesh(triGeom.clone(), _depthMat);
    _depthGroup.add(_depthMesh);

    _gridLines = new THREE.LineSegments(lineGeom, _gridMat);
    _gridGroup.add(_gridLines);

    _gridPoints = new THREE.Points(pointGeom, _pointsMat);
    _gridPoints.visible = (gridType === 'dot' || gridType === 'dotmatrix');
    _gridGroup.add(_gridPoints);

    // Set blend mode for hologram grid
    if (_holoMode) {
      _gridMat.blending = THREE.AdditiveBlending;
      _pointsMat.blending = THREE.AdditiveBlending;
    }
  }

  function _buildGridLines(lineIdx, gridW, gridH, gridType, I) {
    if (gridType === 'polygon' || gridType === 'triangle') {
      for (var y = 0; y < gridH; y++) for (var x = 0; x < gridW; x++) {
        if (x < gridW - 1) lineIdx.push(I(x, y), I(x + 1, y));
        if (y < gridH - 1) lineIdx.push(I(x, y), I(x, y + 1));
        if (x < gridW - 1 && y < gridH - 1) {
          if (y % 2 === 0) lineIdx.push(I(x, y), I(x + 1, y + 1));
          else lineIdx.push(I(x + 1, y), I(x, y + 1));
        }
      }
    } else if (gridType === 'dot' || gridType === 'dotmatrix') {
      for (var y = 0; y < gridH; y++) for (var x = 0; x < gridW; x++) {
        if (gridType === 'dotmatrix') {
          if (x < gridW - 1 && x % 2 === 0) lineIdx.push(I(x, y), I(x + 1, y));
          if (y < gridH - 1 && y % 2 === 0) lineIdx.push(I(x, y), I(x, y + 1));
        } else {
          if (x < gridW - 1) lineIdx.push(I(x, y), I(x + 1, y));
          if (y < gridH - 1) lineIdx.push(I(x, y), I(x, y + 1));
          if (x < gridW - 1 && y < gridH - 1) lineIdx.push(I(x, y), I(x + 1, y + 1));
          if (x > 0 && y < gridH - 1) lineIdx.push(I(x, y), I(x - 1, y + 1));
        }
      }
    } else if (gridType === 'hex') {
      for (var y = 0; y < gridH; y++) {
        var odd = y % 2;
        for (var x = 0; x < gridW; x++) {
          if (x < gridW - 1 && (x + odd) % 2 === 0) lineIdx.push(I(x, y), I(x + 1, y));
          if (y < gridH - 1 && (x + odd) % 2 === 0) {
            lineIdx.push(I(x, y), I(x, y + 1));
            if (x < gridW - 1) lineIdx.push(I(x, y), I(x + 1, y + 1));
          }
        }
      }
    } else if (gridType === 'cross') {
      for (var y = 0; y < gridH - 1; y++) for (var x = 0; x < gridW - 1; x++) {
        lineIdx.push(I(x, y), I(x + 1, y + 1));
        lineIdx.push(I(x + 1, y), I(x, y + 1));
      }
    } else {
      for (var y = 0; y < gridH; y++) for (var x = 0; x < gridW; x++) {
        if (x < gridW - 1) lineIdx.push(I(x, y), I(x + 1, y));
        if (y < gridH - 1) lineIdx.push(I(x, y), I(x, y + 1));
      }
    }
  }

  // ── Camera ──
  function setCamera(rx, ry, rz, zoom) {
    _camRX = rx; _camRY = ry; _camRZ = rz; _camZoom = zoom;
    _updateCamera();
  }

  function _updateCamera() {
    if (!_camera) return;
    var dist = 4.0 / _camZoom;
    var rx = _camRX * Math.PI / 180;
    var ry = _camRY * Math.PI / 180;
    _camera.position.set(
      dist * Math.sin(ry) * Math.cos(rx),
      dist * Math.sin(-rx),
      dist * Math.cos(ry) * Math.cos(rx)
    );
    _camera.lookAt(0, 0, 0);
    var rz = _camRZ * Math.PI / 180;
    _camera.up.set(Math.sin(rz), Math.cos(rz), 0);
  }

  function getCamera() { return { rx: _camRX, ry: _camRY, rz: _camRZ, zoom: _camZoom }; }

  function setCameraPreset(name) {
    var presets = {
      'default': { rx: -35, ry: 15, zoom: 1.2 }, 'iso': { rx: -35, ry: 45, zoom: 1.2 },
      'top': { rx: -90, ry: 0, zoom: 1.0 }, 'front': { rx: 0, ry: 0, zoom: 1.2 },
      'side': { rx: 0, ry: 90, zoom: 1.2 }, 'close': { rx: -60, ry: 30, zoom: 1.5 },
      'rear': { rx: -20, ry: 160, zoom: 1.0 }, 'wide': { rx: -70, ry: -45, zoom: 0.8 }
    };
    var p = presets[name];
    if (p) setCamera(p.rx, p.ry, p.rz || 0, p.zoom);
  }

  // ── Layer control ──
  function setLayerVisible(name, visible) {
    var g = name === 'source' ? _sourceGroup : name === 'depth' ? _depthGroup : name === 'grid' ? _gridGroup : null;
    if (g) g.visible = visible;
  }

  function setLayerOpacity(name, opacity) {
    var g = name === 'source' ? _sourceGroup : name === 'depth' ? _depthGroup : name === 'grid' ? _gridGroup : null;
    if (!g) return;
    g.traverse(function(child) {
      if (child.material) { child.material.transparent = true; child.material.opacity = opacity; }
    });
  }

  // ── Appearance setters ──
  function setColors(near, mid, far, bg) {
    _uniformDefs.uGridColor.value.set(near);
    if (mid) _uniformDefs.uHoloColorMid.value.set(mid);
    _uniformDefs.uGridColor2.value.set(far);
    _uniformDefs.uBgColor.value.set(bg);
    if (_scene) _scene.background = _uniformDefs.uBgColor.value.clone();
  }

  function setElevation(h) { _uniformDefs.uElevation.value = h; }
  function setGlow(amount) { _uniformDefs.uGlow.value = amount; }

  function setSplitElevation(srcElev, gridElev) {
    if (_sourceMat) _sourceMat.uniforms.uElevOverride.value = srcElev;
    if (_holoMat) _holoMat.uniforms.uElevOverride.value = srcElev;
    if (_gridMat) _gridMat.uniforms.uElevOverride.value = gridElev;
    if (_pointsMat) _pointsMat.uniforms.uElevOverride.value = gridElev;
  }

  function clearSplitElevation() {
    [_sourceMat, _holoMat, _gridMat, _pointsMat].forEach(function(m) {
      if (m) m.uniforms.uElevOverride.value = -100.0;
    });
  }

  function setDensity(n) {
    if (n !== _lastDensity) _buildMesh(n, _lastGridType || 'square');
  }

  function setGridType(type) {
    if (type !== _lastGridType) _buildMesh(_lastDensity || 40, type);
    if (_gridPoints) _gridPoints.visible = (type === 'dot' || type === 'dotmatrix');
  }

  function setScanLines(opts) {
    _uniformDefs.uScanLines.value = opts.enabled ? 1.0 : 0.0;
    if (opts.density !== undefined) _uniformDefs.uScanDensity.value = opts.density;
    if (opts.opacity !== undefined) _uniformDefs.uScanOpacity.value = opts.opacity;
    if (opts.speed !== undefined) _uniformDefs.uScanSpeed.value = opts.speed;
    if (opts.dir !== undefined) _uniformDefs.uScanDir.value = opts.dir;
  }

  function setDither(opts) {
    _uniformDefs.uDither.value = opts.enabled ? 1.0 : 0.0;
  }

  function setSrcTint(color, amount) {
    _uniformDefs.uSrcTint.value.set(color);
    _uniformDefs.uSrcTintAmt.value = amount;
  }

  function setGap(value) {
    _uniformDefs.uGapOffset.value = value * -0.005;
  }

  // ── Post-processing ──
  function setBloom(intensity, radius, threshold) {
    if (!_bloomPass) return;
    _bloomPass.strength = intensity;
    if (radius !== undefined) _bloomPass.radius = radius;
    if (threshold !== undefined) _bloomPass.threshold = threshold;
    _bloomPass.enabled = intensity > 0;
  }

  // ── Hologram mode ──
  function setHoloMode(enabled) {
    _holoMode = enabled;
    if (_sourceMesh) {
      _sourceMesh.material = _holoMode ? _holoMat : _sourceMat;
    }
    if (_gridMat) _gridMat.blending = _holoMode ? THREE.AdditiveBlending : THREE.NormalBlending;
    if (_pointsMat) _pointsMat.blending = _holoMode ? THREE.AdditiveBlending : THREE.NormalBlending;
  }

  // ── Animation ──
  function startAnimation(type, speed, dir) {
    stopAnimation();
    _animType = type;
    _animT = 0;
    _animSpeed = speed || 1.0;
    _animDir = dir || 1;
    _animBaseRX = _camRX;
    _animBaseRY = _camRY;
    _animBaseRZ = _camRZ;
    _animBaseZoom = _camZoom;
  }

  function stopAnimation() { _animType = null; }
  function setAnimationSpeed(speed) { _animSpeed = speed; }
  function setAnimationDirection(dir) { _animDir = dir; }

  function _tickAnimation() {
    if (!_animType) return;
    _animT += 0.01 * _animSpeed * _animDir;
    if (_animT >= TWO_PI) _animT -= TWO_PI;
    if (_animT < 0) _animT += TWO_PI;

    var frac = _animT / TWO_PI;
    var t = _animT;
    var bRX = _animBaseRX, bRY = _animBaseRY, bRZ = _animBaseRZ, bZoom = _animBaseZoom;

    if (_animType === 'orbit-y' || _animType === 'orbit') {
      var ry = bRY + frac * 360; while (ry > 180) ry -= 360;
      setCamera(bRX, ry, bRZ, bZoom);
    } else if (_animType === 'orbit-x') {
      var rx = bRX + frac * 360; while (rx > 180) rx -= 360;
      setCamera(rx, bRY, bRZ, bZoom);
    } else if (_animType === 'orbit-z') {
      var rz = bRZ + frac * 360; while (rz > 180) rz -= 360;
      setCamera(bRX, bRY, rz, bZoom);
    } else if (_animType === 'wiggle') {
      setCamera(bRX, bRY - Math.cos(t) * 15, bRZ, bZoom);
    } else if (_animType === 'spin') {
      var sry = bRY + frac * 360; while (sry > 180) sry -= 360;
      var srz = bRZ + frac * 180; while (srz > 180) srz -= 360;
      setCamera(bRX + Math.sin(t) * 25, sry, srz, bZoom);
    } else if (_animType === 'handheld') {
      setCamera(bRX + Math.sin(t * 2) * 2.5 + Math.sin(t * 5) * 1.2,
                bRY + Math.sin(t * 3) * 3.0 + Math.sin(t * 7) * 1.0,
                bRZ + Math.sin(t * 4) * 1.0, bZoom);
    } else if (_animType === 'dolly') {
      setCamera(bRX, bRY + Math.sin(t * 2) * 8, bRZ, bZoom + Math.sin(t) * 0.8);
    } else if (_animType === 'breathe') {
      setCamera(bRX, bRY + Math.sin(t) * 15, bRZ, bZoom);
    } else if (_animType === 'tilt') {
      setCamera(bRX + Math.sin(t) * 30, bRY + Math.sin(t * 2) * 20, bRZ, bZoom);
    } else if (_animType === 'flyover') {
      var fry = bRY + frac * 360; while (fry > 180) fry -= 360;
      setCamera(bRX + Math.sin(t) * 25 - 40, fry, bRZ, bZoom + Math.sin(t * 2) * 0.3);
    }
  }

  // ── Frame buffer ──
  function enableFrameAhead(capacity) {
    _frameBuffer.enabled = true;
    _frameBuffer.capacity = capacity || 12;
    var w = _canvas ? _canvas.width : 1200;
    var h = _canvas ? _canvas.height : 800;
    for (var i = _frameBuffer.targets.length; i < _frameBuffer.capacity; i++) {
      _frameBuffer.targets.push(new THREE.WebGLRenderTarget(w, h));
    }
    _frameBuffer.state = 'idle';
  }

  function disableFrameAhead() {
    _frameBuffer.enabled = false;
    _frameBuffer.state = 'idle';
    _frameBuffer.filled = 0;
  }

  function flushBuffer() {
    _frameBuffer.filled = 0;
    _frameBuffer.writeHead = 0;
    _frameBuffer.readHead = 0;
    _frameBuffer.state = 'flushing';
  }

  // ── Render ──
  function render() {
    if (!_renderer || !_scene || !_camera || !_depthLoaded) return;

    _syncUniforms();
    _updateCamera();

    if (_composer && _bloomPass && _bloomPass.enabled) {
      _composer.render();
    } else {
      _renderer.render(_scene, _camera);
    }
  }

  // ── Render loop ──
  function startLoop() {
    if (_loopActive) return;
    _loopActive = true;
    _visible = true;
    function tick() {
      if (!_loopActive) return;
      _tickAnimation();
      render();
      _animId = requestAnimationFrame(tick);
    }
    _animId = requestAnimationFrame(tick);
  }

  function stopLoop() {
    _loopActive = false;
    if (_animId) { cancelAnimationFrame(_animId); _animId = null; }
  }

  // ── Export ──
  function captureFrame() {
    return new Promise(function(resolve) {
      render();
      _canvas.toBlob(function(blob) { resolve(blob); }, 'image/png');
    });
  }

  function captureAnimation(type, fps, duration) {
    fps = fps || 24;
    duration = duration || 3;
    var totalFrames = fps * duration;
    var frames = [];
    var baseRX = _camRX, baseRY = _camRY, baseRZ = _camRZ, baseZoom = _camZoom;
    var idx = 0;

    return new Promise(function(resolve) {
      function next() {
        if (idx >= totalFrames) { resolve(frames); return; }
        _animT = (idx / totalFrames) * TWO_PI;
        _animType = type;
        _animBaseRX = baseRX; _animBaseRY = baseRY; _animBaseRZ = baseRZ; _animBaseZoom = baseZoom;
        _tickAnimation();
        render();
        _canvas.toBlob(function(blob) {
          frames.push(blob);
          idx++;
          setTimeout(next, 0);
        }, 'image/png');
      }
      next();
    });
  }

  // ── Show/Hide ──
  function show(canvas, asHolo) {
    _holoMode = !!asHolo;
    if (!_initialized) {
      init(canvas);
      _buildMesh(40, 'square');
    }
    setHoloMode(_holoMode);
    _visible = true;
    startLoop();
  }

  function hide() {
    _holoMode = false;
    _visible = false;
    stopLoop();
    stopAnimation();
  }

  function isVisible() { return _visible; }

  function reload(depthBlob, sourceBlob, smoothing, callback) {
    _depthLoaded = false;
    _srcLoaded = false;
    _lastSmoothing = -1;
    var promises = [];
    if (depthBlob) promises.push(setDepthImage(depthBlob, smoothing || 0));
    if (sourceBlob) promises.push(setSourceImage(sourceBlob));
    Promise.all(promises).then(function() {
      if (callback) callback();
    });
  }

  // ── Public API ──
  return {
    init: init, dispose: dispose, resize: resize,
    setDepthImage: setDepthImage, setSourceImage: setSourceImage, updateFrame: updateFrame,
    setLayerVisible: setLayerVisible, setLayerOpacity: setLayerOpacity,
    setCamera: setCamera, setCameraPreset: setCameraPreset, getCamera: getCamera,
    setDensity: setDensity, setGridType: setGridType,
    setElevation: setElevation, setSplitElevation: setSplitElevation, clearSplitElevation: clearSplitElevation,
    setColors: setColors, setGlow: setGlow, setScanLines: setScanLines,
    setDither: setDither, setSrcTint: setSrcTint, setGap: setGap, setHoloMode: setHoloMode,
    setBloom: setBloom,
    startAnimation: startAnimation, stopAnimation: stopAnimation,
    setAnimationSpeed: setAnimationSpeed, setAnimationDirection: setAnimationDirection,
    enableFrameAhead: enableFrameAhead, disableFrameAhead: disableFrameAhead, flushBuffer: flushBuffer,
    render: render, startLoop: startLoop, stopLoop: stopLoop,
    captureFrame: captureFrame, captureAnimation: captureAnimation,
    show: show, hide: hide, isVisible: isVisible, reload: reload,
    _getCanvas: function() { return _canvas; },
    _buildMesh: _buildMesh
  };
})();
