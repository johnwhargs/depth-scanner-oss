const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const PORT = 7843;
let mainWindow = null;
let backendProcess = null;

// ── Find + start Python backend ─────────────────────────
function findBackendDir() {
  const candidates = [
    path.join(__dirname, '..', 'backend'),                          // dev: electron-app/../backend
    path.join(process.resourcesPath || '', 'backend'),              // packaged: resources/backend
    path.join(__dirname, 'backend'),                                // alt
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'server.py'))) return dir;
  }
  return null;
}

function startBackend() {
  const dir = findBackendDir();
  if (!dir) {
    console.error('[Depth Scanner] Backend not found');
    return null;
  }

  const venvPython = path.join(dir, '.venv', 'bin', 'python');
  const python = fs.existsSync(venvPython) ? venvPython : 'python3';

  console.log(`[Depth Scanner] Backend: ${dir}`);
  console.log(`[Depth Scanner] Python: ${python}`);

  const proc = spawn(python, [
    '-m', 'uvicorn', 'server:app',
    '--host', '127.0.0.1',
    '--port', String(PORT),
    '--log-level', 'warning'
  ], {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  proc.stdout.on('data', d => process.stdout.write(d));
  proc.stderr.on('data', d => process.stderr.write(d));
  proc.on('error', err => console.error('[Backend] Spawn error:', err.message));
  proc.on('exit', (code) => {
    console.log(`[Backend] Exited with code ${code}`);
    backendProcess = null;
  });

  console.log(`[Depth Scanner] Backend started (PID ${proc.pid})`);
  return proc;
}

function killBackend() {
  if (backendProcess) {
    console.log('[Depth Scanner] Stopping backend...');
    backendProcess.kill();
    backendProcess = null;
  }
}

// ── Window ──────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    title: 'Depth Scanner OSS',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── IPC handlers ────────────────────────────────────────
ipcMain.handle('dialog:save', async (event, defaultPath) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultPath,
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Choose save folder',
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('fs:writeFile', async (event, filePath, data) => {
  // data arrives as ArrayBuffer from renderer
  const buffer = Buffer.from(data);
  fs.writeFileSync(filePath, buffer);
  return { size: buffer.length };
});

// ── App lifecycle ───────────────────────────────────────
app.whenReady().then(() => {
  backendProcess = startBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  killBackend();
  app.quit();
});

app.on('before-quit', () => {
  killBackend();
});
