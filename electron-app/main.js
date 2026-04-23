const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { isSetupDone, runSetup, getVenvPython, getBackendDir } = require('./setup');

const net = require('net');

const PORT = 7843;
let mainWindow = null;

// Prevent EPIPE crashes when stdout/stderr pipe breaks
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE') return; // ignore broken pipe
  console.error('Uncaught:', err);
});
let setupWindow = null;
let backendProcess = null;

// ── Backend ─────────────────────────────────────────────
function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => { server.close(); resolve(true); });
    server.listen(port, '127.0.0.1');
  });
}

async function startBackend() {
  const backendDir = getBackendDir();
  if (!backendDir) {
    console.error('[DS Lab] Backend not found');
    return null;
  }

  // Check for port conflict
  const portFree = await checkPort(PORT);
  if (!portFree) {
    console.warn(`[DS Lab] Port ${PORT} already in use`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('backend:port-conflict', PORT);
    }
    return null;
  }

  // Use setup venv if exists, otherwise try local backend venv
  let python;
  const setupPython = getVenvPython();
  const localVenv = path.join(backendDir, '.venv', 'bin', 'python');

  if (fs.existsSync(localVenv)) {
    python = localVenv;
  } else if (fs.existsSync(setupPython)) {
    python = localVenv;
  } else {
    python = 'python3';
  }

  console.log(`[DS Lab] Backend: ${backendDir}`);
  console.log(`[DS Lab] Python: ${python}`);

  const proc = spawn(python, [
    '-m', 'uvicorn', 'server:app',
    '--host', '127.0.0.1',
    '--port', String(PORT),
    '--log-level', 'warning'
  ], {
    cwd: backendDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Discard backend output (prevents EPIPE when terminal disconnects)
  proc.stdout.on('data', () => {});
  proc.stderr.on('data', () => {});
  proc.on('error', err => console.error('[Backend] Spawn error:', err.message));
  proc.on('exit', code => {
    console.log(`[Backend] Exited (code ${code})`);
    backendProcess = null;
  });

  console.log(`[DS Lab] Backend started (PID ${proc.pid})`);
  return proc;
}

function killBackend() {
  if (backendProcess) {
    console.log('[DS Lab] Stopping backend...');
    backendProcess.kill();
    backendProcess = null;
  }
}

// ── Setup window ────────────────────────────────────────
function showSetupWindow() {
  return new Promise((resolve, reject) => {
    setupWindow = new BrowserWindow({
      width: 540,
      height: 400,
      resizable: false,
      titleBarStyle: 'hiddenInset',
      title: 'Depth Scanner Lab — Setup',
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    setupWindow.loadFile(path.join(__dirname, 'ui', 'setup.html'));

    setupWindow.webContents.on('did-finish-load', async () => {
      const send = (ch, msg) => {
        if (setupWindow && !setupWindow.isDestroyed()) {
          setupWindow.webContents.send(ch, msg);
        }
      };

      let step = 0;
      const totalSteps = 4;

      try {
        await runSetup((status) => {
          send('setup:status', status);
          // Rough progress by keywords
          if (status.includes('Python')) { step = 1; }
          if (status.includes('virtual environment')) { step = 2; }
          if (status.includes('Installing') || status.includes('Collecting') || status.includes('Downloading')) { step = 3; }
          if (status.includes('Verifying') || status.includes('checks passed')) { step = 4; }
          send('setup:progress', Math.round((step / totalSteps) * 100));
        });

        send('setup:done');
        await new Promise(r => setTimeout(r, 1500));
        if (setupWindow && !setupWindow.isDestroyed()) setupWindow.close();
        setupWindow = null;
        resolve();
      } catch (e) {
        send('setup:error', e.message);
        reject(e);
      }
    });

    setupWindow.on('closed', () => { setupWindow = null; });
  });
}

// ── Main window ─────────────────────────────────────────
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Depth Scanner Lab',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── IPC handlers ────────────────────────────────────────
ipcMain.handle('dialog:save', async (event, defaultPath) => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const result = await dialog.showSaveDialog(win, { defaultPath });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('dialog:openFolder', async () => {
  const win = BrowserWindow.getFocusedWindow() || mainWindow;
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory'],
    title: 'Choose save folder',
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('fs:writeFile', async (event, filePath, data) => {
  const buffer = Buffer.from(data);
  fs.writeFileSync(filePath, buffer);
  return { size: buffer.length };
});

ipcMain.handle('backend:restart', async () => {
  killBackend();
  // Brief pause for port to free up
  await new Promise(r => setTimeout(r, 500));
  backendProcess = await startBackend();
  return backendProcess !== null;
});

// ── App lifecycle ───────────────────────────────────────
app.whenReady().then(async () => {
  try {
    // Run setup if first launch
    if (!isSetupDone()) {
      await showSetupWindow();
    }

    // Start backend + main window
    backendProcess = await startBackend();
    createMainWindow();

  } catch (e) {
    console.error('[DS Lab] Setup failed:', e.message);
    // Keep setup window open showing error
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  killBackend();
  app.quit();
});

app.on('before-quit', () => {
  killBackend();
});
