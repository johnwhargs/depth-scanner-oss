/**
 * Depth Scanner OSS — After Effects Automation Script
 *
 * Select a source layer and depth map layer, choose an effect,
 * click Apply. Script builds the comp structure and creates
 * a controller null with keyframeable sliders.
 *
 * Effects: EZ Matte, DoF, Fog, Parallax, Stereo 3D, Transition, Color Grade
 */

(function() {

    // ── Helpers ──────────────────────────────────────────────────

    function getCompLayers(comp) {
        var layers = [];
        for (var i = 1; i <= comp.numLayers; i++) {
            layers.push(comp.layer(i));
        }
        return layers;
    }

    function getLayerNames(comp) {
        var names = [];
        for (var i = 1; i <= comp.numLayers; i++) {
            names.push(comp.layer(i).name);
        }
        return names;
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

        // Create precomp
        var precomp = app.project.items.addComp(
            srcLayer.name + " — EZ Matte",
            comp.width, comp.height,
            comp.pixelAspect, comp.duration, comp.frameRate
        );

        // Add source
        var src = precomp.layers.add(srcLayer.source);
        src.name = "Source";

        // Add depth as matte
        var depth = precomp.layers.add(depthLayer.source);
        depth.name = "Depth Matte";
        depth.enabled = false;

        // Set track matte
        src.trackMatteType = TrackMatteType.LUMA;

        // Add Brightness & Contrast to depth for control
        var bc = depth.Effects.addProperty("ADBE Brightness & Contrast 2");
        bc.property("ADBE Brightness & Contrast 2-0001").setValue(0);  // Brightness
        bc.property("ADBE Brightness & Contrast 2-0002").setValue(50); // Contrast
        // Enable legacy
        try { bc.property("ADBE Brightness & Contrast 2-0003").setValue(1); } catch(e) {}

        // Add to Essential Properties
        try {
            var ep = precomp.layer(1).essentialProperty;
            if (ep) {
                // This requires AE 2019+
            }
        } catch(e) {}

        // Bring precomp into original comp
        var preLayer = comp.layers.add(precomp);
        preLayer.name = "EZ Matte — " + srcLayer.name;

        // Create controller null
        var ctrl = comp.layers.addNull();
        ctrl.name = "Depth Controller";
        ctrl.guideLayer = true;

        // Add slider controls
        var sDepth = ctrl.Effects.addProperty("ADBE Slider Control");
        sDepth.name = "Depth Cutoff";
        sDepth.property("ADBE Slider Control-0001").setValue(0);

        var sFeather = ctrl.Effects.addProperty("ADBE Slider Control");
        sFeather.name = "Feather";
        sFeather.property("ADBE Slider Control-0001").setValue(50);

        // Expression link: depth brightness ← controller slider
        var brightnessExpr = 'comp("' + precomp.name + '").layer("Depth Matte").effect("Brightness & Contrast")("Brightness")';
        // Actually link via expression on the precomp depth layer
        depth.effect("Brightness & Contrast")("Brightness").expression =
            'comp("' + comp.name + '").layer("Depth Controller").effect("Depth Cutoff")("Slider")';
        depth.effect("Brightness & Contrast")("Contrast").expression =
            'comp("' + comp.name + '").layer("Depth Controller").effect("Feather")("Slider")';

        app.endUndoGroup();
        return precomp;
    }

    function buildDoF(comp, srcLayer, depthLayer) {
        app.beginUndoGroup("Depth Scanner: DoF");

        // Apply Camera Lens Blur to source
        var blur = srcLayer.Effects.addProperty("ADBE Camera Lens Blur");
        blur.property("ADBE Camera Lens Blur-0001").setValue(15); // Blur Radius
        blur.property("ADBE Camera Lens Blur-0010").setValue(depthLayer.index); // Blur Map Layer

        // Controller null
        var ctrl = comp.layers.addNull();
        ctrl.name = "DoF Controller";
        ctrl.guideLayer = true;

        var sRadius = ctrl.Effects.addProperty("ADBE Slider Control");
        sRadius.name = "Blur Radius";
        sRadius.property("ADBE Slider Control-0001").setValue(15);

        var sFocal = ctrl.Effects.addProperty("ADBE Slider Control");
        sFocal.name = "Focal Distance";
        sFocal.property("ADBE Slider Control-0001").setValue(50);

        // Link
        srcLayer.effect("Camera Lens Blur")("Blur Radius").expression =
            'thisComp.layer("DoF Controller").effect("Blur Radius")("Slider")';
        try {
            srcLayer.effect("Camera Lens Blur")("Blur Focal Distance").expression =
                'thisComp.layer("DoF Controller").effect("Focal Distance")("Slider") / 100';
        } catch(e) {}

        // Hide depth layer
        depthLayer.enabled = false;

        app.endUndoGroup();
    }

    function buildFog(comp, srcLayer, depthLayer) {
        app.beginUndoGroup("Depth Scanner: Fog");

        // Create fog solid
        var fogSolid = comp.layers.addSolid(
            [0.78, 0.78, 0.82], "Fog", comp.width, comp.height, comp.pixelAspect, comp.duration
        );

        // Add Fractal Noise
        var fn = fogSolid.Effects.addProperty("ADBE Fractal Noise");
        fn.property("ADBE Fractal Noise-0001").setValue(3);  // Fractal Type: Turbulent Smooth
        fn.property("ADBE Fractal Noise-0006").setValue(0.3); // Contrast
        fn.property("ADBE Fractal Noise-0007").setValue(200); // Brightness

        // Set depth as luma matte
        var depthCopy = comp.layers.add(depthLayer.source);
        depthCopy.name = "Fog Depth Matte";
        depthCopy.enabled = false;
        depthCopy.moveAfter(fogSolid);

        fogSolid.trackMatteType = TrackMatteType.LUMA;

        // Add opacity control
        fogSolid.opacity.setValue(50);

        // Controller
        var ctrl = comp.layers.addNull();
        ctrl.name = "Fog Controller";
        ctrl.guideLayer = true;

        var sDensity = ctrl.Effects.addProperty("ADBE Slider Control");
        sDensity.name = "Fog Density";
        sDensity.property("ADBE Slider Control-0001").setValue(50);

        var sColor = ctrl.Effects.addProperty("ADBE Color Control");
        sColor.name = "Fog Color";

        // Link fog opacity to controller
        fogSolid.opacity.expression =
            'thisComp.layer("Fog Controller").effect("Fog Density")("Slider")';

        app.endUndoGroup();
    }

    function buildParallax(comp, srcLayer, depthLayer) {
        app.beginUndoGroup("Depth Scanner: Parallax");

        // Add blur to depth layer for smooth displacement
        var blur = depthLayer.Effects.addProperty("ADBE Box Blur2");
        blur.property("ADBE Box Blur2-0001").setValue(5); // Blur Radius
        blur.property("ADBE Box Blur2-0003").setValue(3); // Iterations

        // Apply Displacement Map to source
        var disp = srcLayer.Effects.addProperty("ADBE Displacement Map");
        disp.property("ADBE Displacement Map-0001").setValue(depthLayer.index); // Displacement Map Layer
        disp.property("ADBE Displacement Map-0002").setValue(1); // Use For Horizontal: Luminance
        disp.property("ADBE Displacement Map-0003").setValue(0); // Max Horizontal
        disp.property("ADBE Displacement Map-0004").setValue(1); // Use For Vertical: Luminance
        disp.property("ADBE Displacement Map-0005").setValue(0); // Max Vertical
        // Set to use effects & masks
        try { disp.property("ADBE Displacement Map-0006").setValue(2); } catch(e) {} // Effects & Masks

        // Controller
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

        // Link
        srcLayer.effect("Displacement Map")("Max Horizontal Displacement").expression =
            'thisComp.layer("Parallax Controller").effect("Shift X")("Slider")';
        srcLayer.effect("Displacement Map")("Max Vertical Displacement").expression =
            'thisComp.layer("Parallax Controller").effect("Shift Y")("Slider")';
        depthLayer.effect("Box Blur")("Blur Radius").expression =
            'thisComp.layer("Parallax Controller").effect("Depth Blur")("Slider")';

        // Hide depth
        depthLayer.enabled = false;

        app.endUndoGroup();
    }

    function buildStereo(comp, srcLayer, depthLayer) {
        app.beginUndoGroup("Depth Scanner: Stereo 3D");

        // Create left eye comp
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

        // Create right eye comp
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

        // Create stereo viewer (SBS)
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

        // Controller in original comp
        var ctrl = comp.layers.addNull();
        ctrl.name = "Stereo Controller";
        ctrl.guideLayer = true;

        var sSep = ctrl.Effects.addProperty("ADBE Slider Control");
        sSep.name = "Eye Separation";
        sSep.property("ADBE Slider Control-0001").setValue(15);

        var sConv = ctrl.Effects.addProperty("ADBE Slider Control");
        sConv.name = "Convergence";
        sConv.property("ADBE Slider Control-0001").setValue(0);

        // Link displacement to controller
        lSrc.effect("Displacement Map")("Max Horizontal Displacement").expression =
            'comp("' + comp.name + '").layer("Stereo Controller").effect("Eye Separation")("Slider") * -1';
        rSrc.effect("Displacement Map")("Max Horizontal Displacement").expression =
            'comp("' + comp.name + '").layer("Stereo Controller").effect("Eye Separation")("Slider")';

        // Bring stereo viewer into comp
        var viewerLayer = comp.layers.add(stereoComp);
        viewerLayer.name = "Stereo Viewer (SBS)";
        viewerLayer.scale.setValue([50, 50]);

        // Hide depth
        depthLayer.enabled = false;

        app.endUndoGroup();
    }

    function buildTransition(comp, srcLayer, depthLayer) {
        app.beginUndoGroup("Depth Scanner: Transition");

        // Apply Gradient Wipe to source
        var gw = srcLayer.Effects.addProperty("ADBE Gradient Wipe");
        gw.property("ADBE Gradient Wipe-0001").setValue(0);     // Transition Completion
        gw.property("ADBE Gradient Wipe-0002").setValue(50);    // Transition Softness
        gw.property("ADBE Gradient Wipe-0005").setValue(depthLayer.index); // Gradient Layer

        // Controller
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

        // Link
        srcLayer.effect("Gradient Wipe")("Transition Completion").expression =
            'thisComp.layer("Transition Controller").effect("Transition")("Slider")';
        srcLayer.effect("Gradient Wipe")("Transition Softness").expression =
            'thisComp.layer("Transition Controller").effect("Softness")("Slider")';

        // Hide depth
        depthLayer.enabled = false;

        app.endUndoGroup();
    }

    function buildColorGrade(comp, srcLayer, depthLayer) {
        app.beginUndoGroup("Depth Scanner: Color Grade");

        // Duplicate source for foreground/background grade
        var bgLayer = srcLayer.duplicate();
        bgLayer.name = srcLayer.name + " (Background)";
        srcLayer.name = srcLayer.name + " (Foreground)";

        // Depth matte for foreground
        var fgMatte = comp.layers.add(depthLayer.source);
        fgMatte.name = "FG Depth Matte";
        fgMatte.enabled = false;
        fgMatte.moveAfter(srcLayer);
        srcLayer.trackMatteType = TrackMatteType.LUMA;

        // Add Tint to background
        var tintBg = bgLayer.Effects.addProperty("ADBE Tint");
        tintBg.property("ADBE Tint-0001").setValue([0.0, 0.27, 0.53]); // Map Black To (cool blue)
        tintBg.property("ADBE Tint-0002").setValue([1.0, 0.85, 0.7]);  // Map White To (warm)
        tintBg.property("ADBE Tint-0003").setValue(20); // Amount

        // Add Tint to foreground
        var tintFg = srcLayer.Effects.addProperty("ADBE Tint");
        tintFg.property("ADBE Tint-0001").setValue([0.2, 0.1, 0.0]);  // Warm shadows
        tintFg.property("ADBE Tint-0002").setValue([1.0, 0.95, 0.9]); // Warm highlights
        tintFg.property("ADBE Tint-0003").setValue(15); // Amount

        // Controller
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

        // Add brightness to matte for depth control
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

    // ── Effect map ──────────────────────────────────────────────

    var EFFECTS = {
        "EZ Matte": buildEZMatte,
        "Depth of Field": buildDoF,
        "Atmospheric Fog": buildFog,
        "Parallax / 2.5D": buildParallax,
        "Stereo 3D": buildStereo,
        "Depth Transition": buildTransition,
        "Color Grade": buildColorGrade
    };

    var EFFECT_NAMES = [];
    for (var k in EFFECTS) EFFECT_NAMES.push(k);

    // ── UI ──────────────────────────────────────────────────────

    function showUI() {
        var comp = app.project.activeItem;
        if (!comp || !(comp instanceof CompItem)) {
            alert("Open a composition first.");
            return;
        }

        var layerNames = getLayerNames(comp);
        if (layerNames.length < 2) {
            alert("Need at least 2 layers in the comp (source + depth map).");
            return;
        }

        // Guess which is depth
        var depthGuess = 0;
        for (var i = 0; i < layerNames.length; i++) {
            if (layerNames[i].toLowerCase().indexOf("depth") >= 0) {
                depthGuess = i;
                break;
            }
        }
        var srcGuess = depthGuess === 0 ? 1 : 0;

        // Build dialog
        var dlg = new Window("dialog", "Depth Scanner OSS", undefined, {resizeable: false});
        dlg.orientation = "column";
        dlg.alignChildren = ["fill", "top"];

        // Header
        var header = dlg.add("group");
        header.alignment = ["fill", "top"];
        var title = header.add("statictext", undefined, "DEPTH SCANNER OSS");
        title.graphics.font = ScriptUI.newFont("Menlo", "Bold", 14);

        dlg.add("panel", undefined, "").preferredSize = [300, 1];

        // Source layer
        var grpSrc = dlg.add("group");
        grpSrc.add("statictext", undefined, "Source Layer:");
        grpSrc.preferredSize = [300, 28];
        var ddSrc = grpSrc.add("dropdownlist", undefined, layerNames);
        ddSrc.selection = srcGuess;
        ddSrc.preferredSize = [180, 25];

        // Depth layer
        var grpDepth = dlg.add("group");
        grpDepth.add("statictext", undefined, "Depth Map:");
        grpDepth.preferredSize = [300, 28];
        var ddDepth = grpDepth.add("dropdownlist", undefined, layerNames);
        ddDepth.selection = depthGuess;
        ddDepth.preferredSize = [180, 25];

        dlg.add("panel", undefined, "").preferredSize = [300, 1];

        // Effect
        var grpFx = dlg.add("group");
        grpFx.add("statictext", undefined, "Effect:");
        grpFx.preferredSize = [300, 28];
        var ddFx = grpFx.add("dropdownlist", undefined, EFFECT_NAMES);
        ddFx.selection = 0;
        ddFx.preferredSize = [180, 25];

        // Description
        var desc = dlg.add("statictext", undefined, "", {multiline: true});
        desc.preferredSize = [300, 40];
        desc.graphics.font = ScriptUI.newFont("Menlo", "Regular", 10);

        var DESCRIPTIONS = {
            "EZ Matte": "Depth-driven alpha matte with\ncutoff and feather controls.",
            "Depth of Field": "Camera Lens Blur driven by\ndepth map. Focal distance slider.",
            "Atmospheric Fog": "Fractal noise fog layered by\ndepth. Density + color controls.",
            "Parallax / 2.5D": "Displacement map parallax.\nKeyframe X/Y for camera moves.",
            "Stereo 3D": "Left/right eye views for 3D.\nSBS viewer with separation control.",
            "Depth Transition": "Gradient wipe through Z-space.\nTransition + softness sliders.",
            "Color Grade": "Split FG/BG grade by depth.\nWarm foreground, cool background."
        };

        ddFx.onChange = function() {
            desc.text = DESCRIPTIONS[ddFx.selection.text] || "";
        };
        desc.text = DESCRIPTIONS[EFFECT_NAMES[0]];

        dlg.add("panel", undefined, "").preferredSize = [300, 1];

        // Buttons
        var grpBtn = dlg.add("group");
        grpBtn.alignment = ["center", "bottom"];
        var btnApply = grpBtn.add("button", undefined, "Apply Effect");
        var btnCancel = grpBtn.add("button", undefined, "Cancel");

        btnApply.onClick = function() {
            var srcIdx = ddSrc.selection.index + 1;
            var depthIdx = ddDepth.selection.index + 1;
            var fxName = ddFx.selection.text;

            if (srcIdx === depthIdx) {
                alert("Source and Depth Map must be different layers.");
                return;
            }

            var srcLayer = comp.layer(srcIdx);
            var depthLayer = comp.layer(depthIdx);

            try {
                EFFECTS[fxName](comp, srcLayer, depthLayer);
                dlg.close();
            } catch(e) {
                alert("Error: " + e.message);
            }
        };

        btnCancel.onClick = function() { dlg.close(); };

        dlg.show();
    }

    showUI();

})();
