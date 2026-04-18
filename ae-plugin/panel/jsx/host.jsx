/**
 * Depth Scanner — CEP Host Script (ExtendScript / ES3)
 *
 * Runs inside After Effects. Called from panel JS via CSInterface.evalScript().
 * All 12 effect builder functions are ported from DepthScanner.jsx.
 */

// ── Helpers ──────────────────────────────────────────────────

function getCompLayers() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
        return JSON.stringify({ error: "No active composition" });
    }
    var names = [];
    for (var i = 1; i <= comp.numLayers; i++) {
        names.push(comp.layer(i).name);
    }
    return JSON.stringify({ layers: names });
}

function findLayerByName(comp, name) {
    for (var i = 1; i <= comp.numLayers; i++) {
        if (comp.layer(i).name === name) return comp.layer(i);
    }
    return null;
}

// ── Effect Builders ─────────────────────────────────────────

function buildEZMatte(comp, srcLayer, depthLayer) {
    app.beginUndoGroup("Depth Scanner: EZ Matte");

    var precomp = app.project.items.addComp(
        srcLayer.name + " — EZ Matte",
        comp.width, comp.height,
        comp.pixelAspect, comp.duration, comp.frameRate
    );

    var src = precomp.layers.add(srcLayer.source);
    src.name = "Source";

    var depth = precomp.layers.add(depthLayer.source);
    depth.name = "Depth Matte";
    depth.enabled = false;

    src.trackMatteType = TrackMatteType.LUMA;

    var bc = depth.Effects.addProperty("ADBE Brightness & Contrast 2");
    bc.property("ADBE Brightness & Contrast 2-0001").setValue(0);
    bc.property("ADBE Brightness & Contrast 2-0002").setValue(50);
    try { bc.property("ADBE Brightness & Contrast 2-0003").setValue(1); } catch(e) {}

    try {
        var ep = precomp.layer(1).essentialProperty;
        if (ep) {}
    } catch(e) {}

    var preLayer = comp.layers.add(precomp);
    preLayer.name = "EZ Matte — " + srcLayer.name;

    var ctrl = comp.layers.addNull();
    ctrl.name = "Depth Controller";
    ctrl.guideLayer = true;

    var sDepth = ctrl.Effects.addProperty("ADBE Slider Control");
    sDepth.name = "Depth Cutoff";
    sDepth.property("ADBE Slider Control-0001").setValue(0);

    var sFeather = ctrl.Effects.addProperty("ADBE Slider Control");
    sFeather.name = "Feather";
    sFeather.property("ADBE Slider Control-0001").setValue(50);

    depth.effect("Brightness & Contrast")("Brightness").expression =
        'comp("' + comp.name + '").layer("Depth Controller").effect("Depth Cutoff")("Slider")';
    depth.effect("Brightness & Contrast")("Contrast").expression =
        'comp("' + comp.name + '").layer("Depth Controller").effect("Feather")("Slider")';

    app.endUndoGroup();
    return precomp;
}

function buildDoF(comp, srcLayer, depthLayer) {
    app.beginUndoGroup("Depth Scanner: DoF");

    var blur = srcLayer.Effects.addProperty("ADBE Camera Lens Blur");
    blur.property("ADBE Camera Lens Blur-0001").setValue(15);
    blur.property("ADBE Camera Lens Blur-0010").setValue(depthLayer.index);

    try {
        blur.property("ADBE Camera Lens Blur-0002").setValue(6);
        blur.property("ADBE Camera Lens Blur-0003").setValue(0.5);
        blur.property("ADBE Camera Lens Blur-0005").setValue(100);
        blur.property("ADBE Camera Lens Blur-0006").setValue(200);
    } catch(e) {}

    var ctrl = comp.layers.addNull();
    ctrl.name = "DoF Controller";
    ctrl.guideLayer = true;

    var sRadius = ctrl.Effects.addProperty("ADBE Slider Control");
    sRadius.name = "Blur Radius";
    sRadius.property("ADBE Slider Control-0001").setValue(15);

    var sFocal = ctrl.Effects.addProperty("ADBE Slider Control");
    sFocal.name = "Focal Distance";
    sFocal.property("ADBE Slider Control-0001").setValue(50);

    var sIrisShape = ctrl.Effects.addProperty("ADBE Slider Control");
    sIrisShape.name = "Iris Blades (3-8)";
    sIrisShape.property("ADBE Slider Control-0001").setValue(6);

    var sRoundness = ctrl.Effects.addProperty("ADBE Slider Control");
    sRoundness.name = "Iris Roundness (0-100)";
    sRoundness.property("ADBE Slider Control-0001").setValue(50);

    var sRotation = ctrl.Effects.addProperty("ADBE Slider Control");
    sRotation.name = "Iris Rotation";
    sRotation.property("ADBE Slider Control-0001").setValue(0);

    var sSpecThresh = ctrl.Effects.addProperty("ADBE Slider Control");
    sSpecThresh.name = "Highlight Threshold";
    sSpecThresh.property("ADBE Slider Control-0001").setValue(100);

    var sSpecBright = ctrl.Effects.addProperty("ADBE Slider Control");
    sSpecBright.name = "Highlight Brightness";
    sSpecBright.property("ADBE Slider Control-0001").setValue(200);

    var sAspect = ctrl.Effects.addProperty("ADBE Slider Control");
    sAspect.name = "Anamorphic Stretch (50-200)";
    sAspect.property("ADBE Slider Control-0001").setValue(100);

    var sPreset = ctrl.Effects.addProperty("ADBE Dropdown Control");
    sPreset.name = "Bokeh Preset";
    try {
        var dd = sPreset.property("ADBE Dropdown Control-0001");
        dd.setPropertyParameters([
            "Custom",
            "Gaussian (smooth)",
            "Disc (hard circle)",
            "Hexagon (6-blade)",
            "Pentagon (5-blade)",
            "Octagon (8-blade)",
            "Anamorphic (oval)",
            "Ring / Soap Bubble",
            "Donut (mirror lens)",
            "Cat Eye (vignette)"
        ]);
    } catch(e) {}

    srcLayer.effect("Camera Lens Blur")("Blur Radius").expression =
        'thisComp.layer("DoF Controller").effect("Blur Radius")("Slider")';

    try {
        srcLayer.effect("Camera Lens Blur")("Blur Focal Distance").expression =
            'thisComp.layer("DoF Controller").effect("Focal Distance")("Slider") / 100';
    } catch(e) {}

    try {
        srcLayer.effect("Camera Lens Blur")("Iris Shape").expression =
            'clamp(Math.round(thisComp.layer("DoF Controller").effect("Iris Blades (3-8)")("Slider")), 3, 8)';
    } catch(e) {}

    try {
        srcLayer.effect("Camera Lens Blur")("Iris Roundness").expression =
            'thisComp.layer("DoF Controller").effect("Iris Roundness (0-100)")("Slider") / 100';
    } catch(e) {}

    try {
        srcLayer.effect("Camera Lens Blur")("Iris Rotation").expression =
            'thisComp.layer("DoF Controller").effect("Iris Rotation")("Slider")';
    } catch(e) {}

    try {
        srcLayer.effect("Camera Lens Blur")("Specular Threshold").expression =
            'thisComp.layer("DoF Controller").effect("Highlight Threshold")("Slider")';
    } catch(e) {}

    try {
        srcLayer.effect("Camera Lens Blur")("Specular Brightness").expression =
            'thisComp.layer("DoF Controller").effect("Highlight Brightness")("Slider")';
    } catch(e) {}

    var presetExpr = [
        '// Bokeh Preset Auto-Apply',
        'var p = thisComp.layer("DoF Controller").effect("Bokeh Preset")(1);',
        'var val = value;',
        '// 1=Custom (no change)',
        'if (p == 2) val = __GAUSSIAN__;  // Gaussian',
        'if (p == 3) val = __DISC__;      // Disc',
        'if (p == 4) val = __HEX__;       // Hexagon',
        'if (p == 5) val = __PENT__;      // Pentagon',
        'if (p == 6) val = __OCT__;       // Octagon',
        'if (p == 7) val = __ANAM__;      // Anamorphic',
        'if (p == 8) val = __RING__;      // Ring',
        'if (p == 9) val = __DONUT__;     // Donut',
        'if (p == 10) val = __CAT__;      // Cat Eye',
        'val;'
    ].join('\n');

    try {
        ctrl.effect("Iris Blades (3-8)")("Slider").expression =
            presetExpr
                .replace(/__GAUSSIAN__/g, '8')
                .replace(/__DISC__/g, '8')
                .replace(/__HEX__/g, '6')
                .replace(/__PENT__/g, '5')
                .replace(/__OCT__/g, '8')
                .replace(/__ANAM__/g, '6')
                .replace(/__RING__/g, '8')
                .replace(/__DONUT__/g, '8')
                .replace(/__CAT__/g, '6');
    } catch(e) {}

    try {
        ctrl.effect("Iris Roundness (0-100)")("Slider").expression =
            presetExpr
                .replace(/__GAUSSIAN__/g, '100')
                .replace(/__DISC__/g, '100')
                .replace(/__HEX__/g, '0')
                .replace(/__PENT__/g, '0')
                .replace(/__OCT__/g, '0')
                .replace(/__ANAM__/g, '100')
                .replace(/__RING__/g, '100')
                .replace(/__DONUT__/g, '100')
                .replace(/__CAT__/g, '30');
    } catch(e) {}

    try {
        ctrl.effect("Anamorphic Stretch (50-200)")("Slider").expression =
            presetExpr
                .replace(/__GAUSSIAN__/g, '100')
                .replace(/__DISC__/g, '100')
                .replace(/__HEX__/g, '100')
                .replace(/__PENT__/g, '100')
                .replace(/__OCT__/g, '100')
                .replace(/__ANAM__/g, '55')
                .replace(/__RING__/g, '100')
                .replace(/__DONUT__/g, '100')
                .replace(/__CAT__/g, '100');
    } catch(e) {}

    try {
        ctrl.effect("Highlight Brightness")("Slider").expression =
            presetExpr
                .replace(/__GAUSSIAN__/g, '100')
                .replace(/__DISC__/g, '150')
                .replace(/__HEX__/g, '150')
                .replace(/__PENT__/g, '150')
                .replace(/__OCT__/g, '150')
                .replace(/__ANAM__/g, '200')
                .replace(/__RING__/g, '500')
                .replace(/__DONUT__/g, '500')
                .replace(/__CAT__/g, '200');
    } catch(e) {}

    depthLayer.enabled = false;

    app.endUndoGroup();
}

function buildFog(comp, srcLayer, depthLayer) {
    app.beginUndoGroup("Depth Scanner: Fog");

    var fogSolid = comp.layers.addSolid(
        [0.78, 0.78, 0.82], "Fog", comp.width, comp.height, comp.pixelAspect, comp.duration
    );

    var fn = fogSolid.Effects.addProperty("ADBE Fractal Noise");
    fn.property("ADBE Fractal Noise-0001").setValue(3);
    fn.property("ADBE Fractal Noise-0006").setValue(0.3);
    fn.property("ADBE Fractal Noise-0007").setValue(200);

    var depthCopy = comp.layers.add(depthLayer.source);
    depthCopy.name = "Fog Depth Matte";
    depthCopy.enabled = false;
    depthCopy.moveAfter(fogSolid);

    fogSolid.trackMatteType = TrackMatteType.LUMA;

    fogSolid.opacity.setValue(50);

    var ctrl = comp.layers.addNull();
    ctrl.name = "Fog Controller";
    ctrl.guideLayer = true;

    var sDensity = ctrl.Effects.addProperty("ADBE Slider Control");
    sDensity.name = "Fog Density";
    sDensity.property("ADBE Slider Control-0001").setValue(50);

    var sColor = ctrl.Effects.addProperty("ADBE Color Control");
    sColor.name = "Fog Color";

    fogSolid.opacity.expression =
        'thisComp.layer("Fog Controller").effect("Fog Density")("Slider")';

    app.endUndoGroup();
}

function buildParallax(comp, srcLayer, depthLayer) {
    app.beginUndoGroup("Depth Scanner: Parallax");

    var blur = depthLayer.Effects.addProperty("ADBE Box Blur2");
    blur.property("ADBE Box Blur2-0001").setValue(5);
    blur.property("ADBE Box Blur2-0003").setValue(3);

    var disp = srcLayer.Effects.addProperty("ADBE Displacement Map");
    disp.property("ADBE Displacement Map-0001").setValue(depthLayer.index);
    disp.property("ADBE Displacement Map-0002").setValue(1);
    disp.property("ADBE Displacement Map-0003").setValue(0);
    disp.property("ADBE Displacement Map-0004").setValue(1);
    disp.property("ADBE Displacement Map-0005").setValue(0);
    try { disp.property("ADBE Displacement Map-0006").setValue(2); } catch(e) {}

    var ctrl = comp.layers.addNull();
    ctrl.name = "Parallax Controller";
    ctrl.guideLayer = true;

    var sX = ctrl.Effects.addProperty("ADBE Slider Control");
    sX.name = "Shift X";
    sX.property("ADBE Slider Control-0001").setValue(0);

    var sY = ctrl.Effects.addProperty("ADBE Slider Control");
    sY.name = "Shift Y";
    sY.property("ADBE Slider Control-0001").setValue(0);

    var sBlur = ctrl.Effects.addProperty("ADBE Slider Control");
    sBlur.name = "Depth Blur";
    sBlur.property("ADBE Slider Control-0001").setValue(5);

    srcLayer.effect("Displacement Map")("Max Horizontal Displacement").expression =
        'thisComp.layer("Parallax Controller").effect("Shift X")("Slider")';
    srcLayer.effect("Displacement Map")("Max Vertical Displacement").expression =
        'thisComp.layer("Parallax Controller").effect("Shift Y")("Slider")';
    depthLayer.effect("Box Blur")("Blur Radius").expression =
        'thisComp.layer("Parallax Controller").effect("Depth Blur")("Slider")';

    depthLayer.enabled = false;

    app.endUndoGroup();
}

function buildStereo(comp, srcLayer, depthLayer) {
    app.beginUndoGroup("Depth Scanner: Stereo 3D");

    var leftComp = app.project.items.addComp(
        srcLayer.name + " — Left Eye",
        comp.width, comp.height,
        comp.pixelAspect, comp.duration, comp.frameRate
    );
    var lSrc = leftComp.layers.add(srcLayer.source);
    var lDepth = leftComp.layers.add(depthLayer.source);
    lDepth.enabled = false;
    lSrc.name = "Source";
    lDepth.name = "Depth";

    var lDisp = lSrc.Effects.addProperty("ADBE Displacement Map");
    lDisp.property("ADBE Displacement Map-0001").setValue(lDepth.index);
    lDisp.property("ADBE Displacement Map-0002").setValue(1);
    lDisp.property("ADBE Displacement Map-0003").setValue(-15);
    try { lDisp.property("ADBE Displacement Map-0006").setValue(2); } catch(e) {}

    var rightComp = app.project.items.addComp(
        srcLayer.name + " — Right Eye",
        comp.width, comp.height,
        comp.pixelAspect, comp.duration, comp.frameRate
    );
    var rSrc = rightComp.layers.add(srcLayer.source);
    var rDepth = rightComp.layers.add(depthLayer.source);
    rDepth.enabled = false;
    rSrc.name = "Source";
    rDepth.name = "Depth";

    var rDisp = rSrc.Effects.addProperty("ADBE Displacement Map");
    rDisp.property("ADBE Displacement Map-0001").setValue(rDepth.index);
    rDisp.property("ADBE Displacement Map-0002").setValue(1);
    rDisp.property("ADBE Displacement Map-0003").setValue(15);
    try { rDisp.property("ADBE Displacement Map-0006").setValue(2); } catch(e) {}

    var stereoComp = app.project.items.addComp(
        srcLayer.name + " — Stereo Viewer",
        comp.width * 2, comp.height,
        comp.pixelAspect, comp.duration, comp.frameRate
    );
    var sLeft = stereoComp.layers.add(leftComp);
    sLeft.name = "Left Eye";
    sLeft.position.setValue([comp.width / 2, comp.height / 2]);

    var sRight = stereoComp.layers.add(rightComp);
    sRight.name = "Right Eye";
    sRight.position.setValue([comp.width + comp.width / 2, comp.height / 2]);

    var ctrl = comp.layers.addNull();
    ctrl.name = "Stereo Controller";
    ctrl.guideLayer = true;

    var sSep = ctrl.Effects.addProperty("ADBE Slider Control");
    sSep.name = "Eye Separation";
    sSep.property("ADBE Slider Control-0001").setValue(15);

    var sConv = ctrl.Effects.addProperty("ADBE Slider Control");
    sConv.name = "Convergence";
    sConv.property("ADBE Slider Control-0001").setValue(0);

    lSrc.effect("Displacement Map")("Max Horizontal Displacement").expression =
        'comp("' + comp.name + '").layer("Stereo Controller").effect("Eye Separation")("Slider") * -1';
    rSrc.effect("Displacement Map")("Max Horizontal Displacement").expression =
        'comp("' + comp.name + '").layer("Stereo Controller").effect("Eye Separation")("Slider")';

    var viewerLayer = comp.layers.add(stereoComp);
    viewerLayer.name = "Stereo Viewer (SBS)";
    viewerLayer.scale.setValue([50, 50]);

    depthLayer.enabled = false;

    app.endUndoGroup();
}

function buildTransition(comp, srcLayer, depthLayer) {
    app.beginUndoGroup("Depth Scanner: Transition");

    var gw = srcLayer.Effects.addProperty("ADBE Gradient Wipe");
    gw.property("ADBE Gradient Wipe-0001").setValue(0);
    gw.property("ADBE Gradient Wipe-0002").setValue(50);
    gw.property("ADBE Gradient Wipe-0005").setValue(depthLayer.index);

    var ctrl = comp.layers.addNull();
    ctrl.name = "Transition Controller";
    ctrl.guideLayer = true;

    var sTrans = ctrl.Effects.addProperty("ADBE Slider Control");
    sTrans.name = "Transition";
    sTrans.property("ADBE Slider Control-0001").setValue(0);

    var sSoft = ctrl.Effects.addProperty("ADBE Slider Control");
    sSoft.name = "Softness";
    sSoft.property("ADBE Slider Control-0001").setValue(50);

    var sSteps = ctrl.Effects.addProperty("ADBE Checkbox Control");
    sSteps.name = "Stepped (Posterize)";

    srcLayer.effect("Gradient Wipe")("Transition Completion").expression =
        'thisComp.layer("Transition Controller").effect("Transition")("Slider")';
    srcLayer.effect("Gradient Wipe")("Transition Softness").expression =
        'thisComp.layer("Transition Controller").effect("Softness")("Slider")';

    depthLayer.enabled = false;

    app.endUndoGroup();
}

function buildColorGrade(comp, srcLayer, depthLayer) {
    app.beginUndoGroup("Depth Scanner: Color Grade");

    var bgLayer = srcLayer.duplicate();
    bgLayer.name = srcLayer.name + " (Background)";
    srcLayer.name = srcLayer.name + " (Foreground)";

    var fgMatte = comp.layers.add(depthLayer.source);
    fgMatte.name = "FG Depth Matte";
    fgMatte.enabled = false;
    fgMatte.moveAfter(srcLayer);
    srcLayer.trackMatteType = TrackMatteType.LUMA;

    var tintBg = bgLayer.Effects.addProperty("ADBE Tint");
    tintBg.property("ADBE Tint-0001").setValue([0.0, 0.27, 0.53]);
    tintBg.property("ADBE Tint-0002").setValue([1.0, 0.85, 0.7]);
    tintBg.property("ADBE Tint-0003").setValue(20);

    var tintFg = srcLayer.Effects.addProperty("ADBE Tint");
    tintFg.property("ADBE Tint-0001").setValue([0.2, 0.1, 0.0]);
    tintFg.property("ADBE Tint-0002").setValue([1.0, 0.95, 0.9]);
    tintFg.property("ADBE Tint-0003").setValue(15);

    var ctrl = comp.layers.addNull();
    ctrl.name = "Grade Controller";
    ctrl.guideLayer = true;

    var sDepth = ctrl.Effects.addProperty("ADBE Slider Control");
    sDepth.name = "Depth Split";
    sDepth.property("ADBE Slider Control-0001").setValue(0);

    var sBgAmount = ctrl.Effects.addProperty("ADBE Slider Control");
    sBgAmount.name = "BG Tint Amount";
    sBgAmount.property("ADBE Slider Control-0001").setValue(20);

    var sFgAmount = ctrl.Effects.addProperty("ADBE Slider Control");
    sFgAmount.name = "FG Tint Amount";
    sFgAmount.property("ADBE Slider Control-0001").setValue(15);

    var bc = fgMatte.Effects.addProperty("ADBE Brightness & Contrast 2");
    bc.property("ADBE Brightness & Contrast 2-0002").setValue(50);
    try { bc.property("ADBE Brightness & Contrast 2-0003").setValue(1); } catch(e) {}

    fgMatte.effect("Brightness & Contrast")("Brightness").expression =
        'thisComp.layer("Grade Controller").effect("Depth Split")("Slider")';
    bgLayer.effect("Tint")("Amount to Tint").expression =
        'thisComp.layer("Grade Controller").effect("BG Tint Amount")("Slider")';
    srcLayer.effect("Tint")("Amount to Tint").expression =
        'thisComp.layer("Grade Controller").effect("FG Tint Amount")("Slider")';

    app.endUndoGroup();
}

function buildWigglegram(comp, srcLayer, depthLayer) {
    app.beginUndoGroup("Depth Scanner: Wigglegram");

    var ctrl = comp.layers.addNull();
    ctrl.name = "Wiggle Controller";
    ctrl.guideLayer = true;

    var sSep = ctrl.Effects.addProperty("ADBE Slider Control");
    sSep.name = "Eye Separation";
    sSep.property("ADBE Slider Control-0001").setValue(15);

    var sComb = ctrl.Effects.addProperty("ADBE Slider Control");
    sComb.name = "Comb Frames";
    sComb.property("ADBE Slider Control-0001").setValue(3);

    var sSpeed = ctrl.Effects.addProperty("ADBE Slider Control");
    sSpeed.name = "Speed Multiplier";
    sSpeed.property("ADBE Slider Control-0001").setValue(1);

    var sBlur = ctrl.Effects.addProperty("ADBE Slider Control");
    sBlur.name = "Depth Blur";
    sBlur.property("ADBE Slider Control-0001").setValue(5);

    var dBlur = depthLayer.Effects.addProperty("ADBE Box Blur2");
    dBlur.property("ADBE Box Blur2-0001").setValue(5);
    dBlur.property("ADBE Box Blur2-0003").setValue(3);
    depthLayer.effect("Box Blur")("Blur Radius").expression =
        'thisComp.layer("Wiggle Controller").effect("Depth Blur")("Slider")';

    var disp = srcLayer.Effects.addProperty("ADBE Displacement Map");
    disp.property("ADBE Displacement Map-0001").setValue(depthLayer.index);
    disp.property("ADBE Displacement Map-0002").setValue(1);
    disp.property("ADBE Displacement Map-0003").setValue(0);
    try { disp.property("ADBE Displacement Map-0006").setValue(2); } catch(e) {}

    srcLayer.effect("Displacement Map")("Max Horizontal Displacement").expression = [
        'var ctrl = thisComp.layer("Wiggle Controller");',
        'var sep = ctrl.effect("Eye Separation")("Slider");',
        'var combFrames = Math.max(1, Math.round(ctrl.effect("Comb Frames")("Slider")));',
        'var speed = ctrl.effect("Speed Multiplier")("Slider");',
        'var frame = Math.floor(timeToFrames(time) * speed);',
        'var cycle = combFrames * 2;',
        'var pos = frame % cycle;',
        'var eye = (pos < combFrames) ? -1 : 1;',
        'sep * eye;'
    ].join('\n');

    depthLayer.enabled = false;

    app.endUndoGroup();
}

function build3DMesh(comp, srcLayer, depthLayer) {
    app.beginUndoGroup("Depth Scanner: 3D Mesh");

    var ctrl = comp.layers.addNull();
    ctrl.name = "3D Mesh Controller";
    ctrl.guideLayer = true;
    ctrl.threeDLayer = true;

    var sHeight = ctrl.Effects.addProperty("ADBE Slider Control");
    sHeight.name = "Elevation";
    sHeight.property("ADBE Slider Control-0001").setValue(50);

    var sRotX = ctrl.Effects.addProperty("ADBE Slider Control");
    sRotX.name = "Tilt X";
    sRotX.property("ADBE Slider Control-0001").setValue(-25);

    var sRotY = ctrl.Effects.addProperty("ADBE Slider Control");
    sRotY.name = "Rotate Y";
    sRotY.property("ADBE Slider Control-0001").setValue(0);

    var sScale = ctrl.Effects.addProperty("ADBE Slider Control");
    sScale.name = "Zoom";
    sScale.property("ADBE Slider Control-0001").setValue(100);

    srcLayer.threeDLayer = true;
    depthLayer.threeDLayer = true;

    try {
        var env = srcLayer.Effects.addProperty("CC Environment");
        env.property("CC Environment-0002").setValue(depthLayer.index);
        env.property("CC Environment-0001").setValue(50);
    } catch(e) {
        var disp = srcLayer.Effects.addProperty("ADBE Displacement Map");
        disp.property("ADBE Displacement Map-0001").setValue(depthLayer.index);
        disp.property("ADBE Displacement Map-0002").setValue(1);
        disp.property("ADBE Displacement Map-0003").setValue(50);
        disp.property("ADBE Displacement Map-0004").setValue(1);
        disp.property("ADBE Displacement Map-0005").setValue(50);
        try { disp.property("ADBE Displacement Map-0006").setValue(2); } catch(e2) {}
    }

    var cam = comp.layers.addCamera("3D Camera", [comp.width/2, comp.height/2]);
    cam.property("ADBE Camera Options Group").property("ADBE Camera Zoom").setValue(1200);

    cam.position.expression = [
        'var ctrl = thisComp.layer("3D Mesh Controller");',
        'var zoom = ctrl.effect("Zoom")("Slider") / 100;',
        'var rx = ctrl.effect("Tilt X")("Slider") * Math.PI / 180;',
        'var ry = ctrl.effect("Rotate Y")("Slider") * Math.PI / 180;',
        'var dist = 1500 / zoom;',
        'var x = thisComp.width/2 + Math.sin(ry) * dist;',
        'var y = thisComp.height/2 + Math.sin(rx) * dist * 0.5;',
        'var z = -dist * Math.cos(ry) * Math.cos(rx);',
        '[x, y, z];'
    ].join('\n');

    cam.pointOfInterest.expression =
        '[thisComp.width/2, thisComp.height/2, 0]';

    srcLayer.orientation.expression = [
        'var ctrl = thisComp.layer("3D Mesh Controller");',
        'var rx = ctrl.effect("Tilt X")("Slider");',
        'var ry = ctrl.effect("Rotate Y")("Slider");',
        '[rx, ry, 0];'
    ].join('\n');

    try {
        srcLayer.effect("CC Environment")("Height").expression =
            'thisComp.layer("3D Mesh Controller").effect("Elevation")("Slider")';
    } catch(e) {
        try {
            srcLayer.effect("Displacement Map")("Max Horizontal Displacement").expression =
                'thisComp.layer("3D Mesh Controller").effect("Elevation")("Slider")';
            srcLayer.effect("Displacement Map")("Max Vertical Displacement").expression =
                'thisComp.layer("3D Mesh Controller").effect("Elevation")("Slider")';
        } catch(e2) {}
    }

    var light = comp.layers.addLight("Depth Light", [comp.width * 0.3, 0]);
    light.property("ADBE Light Options Group").property("ADBE Light Intensity").setValue(80);
    light.threeDLayer = true;
    light.position.setValue([comp.width * 0.3, -200, -500]);

    var ambient = comp.layers.addLight("Ambient", [comp.width/2, comp.height/2]);
    ambient.property("ADBE Light Options Group").property("ADBE Light Type").setValue(4);
    ambient.property("ADBE Light Options Group").property("ADBE Light Intensity").setValue(60);

    depthLayer.enabled = false;

    app.endUndoGroup();
}

function buildLightWrap(comp, srcLayer, depthLayer) {
    app.beginUndoGroup("Depth Scanner: Light Wrap");

    var ctrl = comp.layers.addNull();
    ctrl.name = "Light Wrap Controller";
    ctrl.guideLayer = true;

    var sIntensity = ctrl.Effects.addProperty("ADBE Slider Control");
    sIntensity.name = "Wrap Intensity";
    sIntensity.property("ADBE Slider Control-0001").setValue(50);

    var sWidth = ctrl.Effects.addProperty("ADBE Slider Control");
    sWidth.name = "Wrap Width";
    sWidth.property("ADBE Slider Control-0001").setValue(10);

    var sColor = ctrl.Effects.addProperty("ADBE Color Control");
    sColor.name = "Wrap Color";

    var edgeLayer = comp.layers.add(depthLayer.source);
    edgeLayer.name = "Depth Edges";

    var edges = edgeLayer.Effects.addProperty("ADBE Find Edges");

    var glow = edgeLayer.Effects.addProperty("ADBE Glo2");
    try {
        glow.property("ADBE Glo2-0001").setValue(50);
        glow.property("ADBE Glo2-0002").setValue(10);
        glow.property("ADBE Glo2-0003").setValue(50);
    } catch(e) {}

    edgeLayer.blendingMode = BlendingMode.SCREEN;
    edgeLayer.opacity.setValue(50);

    edgeLayer.opacity.expression =
        'thisComp.layer("Light Wrap Controller").effect("Wrap Intensity")("Slider")';
    try {
        edgeLayer.effect("Glow")("Glow Radius").expression =
            'thisComp.layer("Light Wrap Controller").effect("Wrap Width")("Slider")';
    } catch(e) {}

    depthLayer.enabled = false;
    app.endUndoGroup();
}

function buildBlackout(comp, srcLayer, depthLayer) {
    app.beginUndoGroup("Depth Scanner: Blackout");

    var darkLayer = srcLayer.duplicate();
    darkLayer.name = srcLayer.name + " (Dark)";
    srcLayer.name = srcLayer.name + " (Light)";

    var toner = darkLayer.Effects.addProperty("ADBE Tint");
    toner.property("ADBE Tint-0001").setValue([0.0, 0.0, 0.05]);
    toner.property("ADBE Tint-0002").setValue([0.1, 0.08, 0.15]);
    toner.property("ADBE Tint-0003").setValue(80);

    srcLayer.moveBefore(darkLayer);

    var gw = srcLayer.Effects.addProperty("ADBE Gradient Wipe");
    gw.property("ADBE Gradient Wipe-0005").setValue(depthLayer.index);
    gw.property("ADBE Gradient Wipe-0001").setValue(0);
    gw.property("ADBE Gradient Wipe-0002").setValue(30);

    var ctrl = comp.layers.addNull();
    ctrl.name = "Blackout Controller";
    ctrl.guideLayer = true;

    var sTrans = ctrl.Effects.addProperty("ADBE Slider Control");
    sTrans.name = "Blackout Amount";
    sTrans.property("ADBE Slider Control-0001").setValue(0);

    var sSoft = ctrl.Effects.addProperty("ADBE Slider Control");
    sSoft.name = "Softness";
    sSoft.property("ADBE Slider Control-0001").setValue(30);

    var sStepped = ctrl.Effects.addProperty("ADBE Checkbox Control");
    sStepped.name = "Stepped (Posterize)";

    var sStepFPS = ctrl.Effects.addProperty("ADBE Slider Control");
    sStepFPS.name = "Step FPS (if stepped)";
    sStepFPS.property("ADBE Slider Control-0001").setValue(6);

    srcLayer.effect("Gradient Wipe")("Transition Completion").expression = [
        'var ctrl = thisComp.layer("Blackout Controller");',
        'var val = ctrl.effect("Blackout Amount")("Slider");',
        'var stepped = ctrl.effect("Stepped (Posterize)")("Checkbox");',
        'if (stepped) {',
        '  var fps = ctrl.effect("Step FPS (if stepped)")("Slider");',
        '  posterizeTime(fps);',
        '}',
        'val;'
    ].join('\n');

    srcLayer.effect("Gradient Wipe")("Transition Softness").expression =
        'thisComp.layer("Blackout Controller").effect("Softness")("Slider")';

    depthLayer.enabled = false;
    app.endUndoGroup();
}

function buildDepthGlow(comp, srcLayer, depthLayer) {
    app.beginUndoGroup("Depth Scanner: Depth Glow");

    var glowLayer = srcLayer.duplicate();
    glowLayer.name = "Depth Glow Layer";

    var depthCopy = comp.layers.add(depthLayer.source);
    depthCopy.name = "Glow Depth Matte";
    depthCopy.enabled = false;
    depthCopy.moveAfter(glowLayer);
    glowLayer.trackMatteType = TrackMatteType.LUMA;

    var lvl = depthCopy.Effects.addProperty("ADBE Levels2");
    try {
        lvl.property("ADBE Levels2-0003").setValue(200);
    } catch(e) {}

    var tint = glowLayer.Effects.addProperty("ADBE Tint");
    tint.property("ADBE Tint-0001").setValue([0.0, 0.0, 0.5]);
    tint.property("ADBE Tint-0002").setValue([0.5, 0.8, 1.0]);
    tint.property("ADBE Tint-0003").setValue(80);

    var glow = glowLayer.Effects.addProperty("ADBE Glo2");
    try {
        glow.property("ADBE Glo2-0001").setValue(30);
        glow.property("ADBE Glo2-0002").setValue(20);
        glow.property("ADBE Glo2-0003").setValue(100);
    } catch(e) {}

    glowLayer.blendingMode = BlendingMode.ADD;
    glowLayer.opacity.setValue(70);

    var ctrl = comp.layers.addNull();
    ctrl.name = "Glow Controller";
    ctrl.guideLayer = true;

    var sIntensity = ctrl.Effects.addProperty("ADBE Slider Control");
    sIntensity.name = "Glow Intensity";
    sIntensity.property("ADBE Slider Control-0001").setValue(70);

    var sRadius = ctrl.Effects.addProperty("ADBE Slider Control");
    sRadius.name = "Glow Radius";
    sRadius.property("ADBE Slider Control-0001").setValue(20);

    var sThreshold = ctrl.Effects.addProperty("ADBE Slider Control");
    sThreshold.name = "Depth Threshold";
    sThreshold.property("ADBE Slider Control-0001").setValue(128);

    var sInvert = ctrl.Effects.addProperty("ADBE Checkbox Control");
    sInvert.name = "Invert (glow near instead of far)";

    glowLayer.opacity.expression =
        'thisComp.layer("Glow Controller").effect("Glow Intensity")("Slider")';
    try {
        glowLayer.effect("Glow")("Glow Radius").expression =
            'thisComp.layer("Glow Controller").effect("Glow Radius")("Slider")';
    } catch(e) {}

    depthLayer.enabled = false;
    app.endUndoGroup();
}

// ── Dispatcher ──────────────────────────────────────────────

function applyEffect(srcIdx, depthIdx, effectName) {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
        return JSON.stringify({ error: "No active composition" });
    }

    srcIdx = parseInt(srcIdx, 10);
    depthIdx = parseInt(depthIdx, 10);

    if (srcIdx < 1 || srcIdx > comp.numLayers || depthIdx < 1 || depthIdx > comp.numLayers) {
        return JSON.stringify({ error: "Invalid layer index" });
    }

    if (srcIdx === depthIdx) {
        return JSON.stringify({ error: "Source and Depth Map must be different layers" });
    }

    var srcLayer = comp.layer(srcIdx);
    var depthLayer = comp.layer(depthIdx);

    var EFFECTS = {
        "EZ Matte": buildEZMatte,
        "Depth of Field": buildDoF,
        "Atmospheric Fog": buildFog,
        "Parallax / 2.5D": buildParallax,
        "Wigglegram": buildWigglegram,
        "Stereo 3D": buildStereo,
        "3D Mesh": build3DMesh,
        "Depth Transition": buildTransition,
        "Blackout": buildBlackout,
        "Light Wrap": buildLightWrap,
        "Depth Glow": buildDepthGlow,
        "Color Grade": buildColorGrade
    };

    if (!EFFECTS[effectName]) {
        return JSON.stringify({ error: "Unknown effect: " + effectName });
    }

    try {
        EFFECTS[effectName](comp, srcLayer, depthLayer);
        return JSON.stringify({ success: true, effect: effectName });
    } catch(e) {
        return JSON.stringify({ error: e.message });
    }
}
