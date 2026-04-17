/**
 * Depth Scanner OSS — After Effects ExtendScript host
 * Handles frame export and depth map import via render queue.
 */

// ── Utilities ────────────────────────────────────────────────────────────────

function getTempDir() {
    var tmp = Folder.temp;
    var dir = new Folder(tmp.fsName + "/DepthScannerOSS");
    if (!dir.exists) dir.create();
    return dir;
}

function getActiveComp() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
        return JSON.stringify({ error: "No active composition. Click a comp first." });
    }
    return null; // no error
}

// ── Export current frame ─────────────────────────────────────────────────────

function exportCurrentFrame() {
    var err = getActiveComp();
    if (err) return err;

    var comp = app.project.activeItem;
    var dir  = getTempDir();
    var outFile = new File(dir.fsName + "/frame_export.png");

    try {
        // Add to render queue as single frame
        app.beginUndoGroup("DepthScanner Export Frame");
        var rqItem = app.project.renderQueue.items.add(comp);
        rqItem.timeSpanStart = comp.time;
        rqItem.timeSpanDuration = comp.frameDuration;

        var om = rqItem.outputModules[1];
        try { om.format = "PNG"; } catch(e) {}
        om.file = outFile;

        rqItem.render();
        rqItem.remove();
        app.endUndoGroup();

        return JSON.stringify({
            success: true,
            path: outFile.fsName,
            width: comp.width,
            height: comp.height,
            frameRate: comp.frameRate,
            currentTime: comp.time,
            compName: comp.name
        });
    } catch (e) {
        app.endUndoGroup();
        // Fallback: try File > Export > Save frame as file approach
        try { rqItem.remove(); } catch(e2) {}
        return JSON.stringify({ error: "Export failed: " + e.message });
    }
}

// ── Export frame range ───────────────────────────────────────────────────────

function exportFrameRange(startFrame, endFrame, every) {
    var err = getActiveComp();
    if (err) return err;

    var comp = app.project.activeItem;
    var dir  = getTempDir();
    var fps  = comp.frameRate;
    every    = every || 1;

    var exported = [];
    app.beginUndoGroup("DepthScanner Export Range");

    try {
        for (var f = startFrame; f <= endFrame; f += every) {
            var t = f / fps;
            if (t > comp.duration) break;

            var padded = ("0000" + f).slice(-4);
            var outFile = new File(dir.fsName + "/frame_" + padded + ".png");

            var rqItem = app.project.renderQueue.items.add(comp);
            rqItem.timeSpanStart = t;
            rqItem.timeSpanDuration = comp.frameDuration;

            var om = rqItem.outputModules[1];
            try { om.format = "PNG"; } catch(e) {}
            om.file = outFile;

            rqItem.render();
            rqItem.remove();
            exported.push({ frame: f, path: outFile.fsName });
        }

        app.endUndoGroup();
        return JSON.stringify({
            success: true,
            dir: dir.fsName,
            frames: exported,
            compName: comp.name,
            fps: fps
        });
    } catch (e) {
        app.endUndoGroup();
        return JSON.stringify({ error: "Range export failed: " + e.message });
    }
}

// ── Import depth map into project ────────────────────────────────────────────

function importDepthMap(filePath, addToComp, layerName) {
    var f = new File(filePath);
    if (!f.exists) {
        return JSON.stringify({ error: "File not found: " + filePath });
    }

    try {
        var importOptions = new ImportOptions(f);
        importOptions.sequence = false;

        var item = app.project.importFile(importOptions);
        item.name = layerName || "Depth Map";

        if (addToComp) {
            var err = getActiveComp();
            if (!err) {
                var comp = app.project.activeItem;
                var layer = comp.layers.add(item);
                layer.name = item.name;
                layer.blendingMode = BlendingMode.NORMAL;
            }
        }

        return JSON.stringify({ success: true, itemName: item.name });
    } catch (e) {
        return JSON.stringify({ error: "Import failed: " + e.message });
    }
}

// ── Import EXR sequence ───────────────────────────────────────────────────────

function importDepthSequence(firstFilePath, addToComp) {
    var f = new File(firstFilePath);
    if (!f.exists) {
        return JSON.stringify({ error: "File not found: " + firstFilePath });
    }

    try {
        var importOptions = new ImportOptions(f);
        importOptions.sequence = true;
        importOptions.forceAlphabetical = true;

        var item = app.project.importFile(importOptions);
        item.name = "Depth Sequence";

        if (addToComp) {
            var err = getActiveComp();
            if (!err) {
                var comp = app.project.activeItem;
                var layer = comp.layers.add(item);
                layer.name = item.name;
            }
        }

        return JSON.stringify({ success: true, itemName: item.name });
    } catch (e) {
        return JSON.stringify({ error: "Sequence import failed: " + e.message });
    }
}

// ── Comp info ────────────────────────────────────────────────────────────────

function getCompInfo() {
    var err = getActiveComp();
    if (err) return err;

    var comp = app.project.activeItem;
    var fps  = comp.frameRate;
    var dur  = comp.duration;
    var start = comp.workAreaStart;
    var end   = comp.workAreaStart + comp.workAreaDuration;

    return JSON.stringify({
        name:        comp.name,
        width:       comp.width,
        height:      comp.height,
        fps:         fps,
        duration:    dur,
        currentTime: comp.time,
        currentFrame: Math.round(comp.time * fps),
        workStart:   Math.round(start * fps),
        workEnd:     Math.round(end * fps),
        totalFrames: Math.round(dur * fps),
        tempDir:     getTempDir().fsName
    });
}

// ── Set current time ─────────────────────────────────────────────────────────

function setCurrentTime(frame) {
    var err = getActiveComp();
    if (err) return err;
    var comp = app.project.activeItem;
    comp.time = frame / comp.frameRate;
    return JSON.stringify({ success: true });
}
