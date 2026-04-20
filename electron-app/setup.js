/**
 * Depth Scanner — First-launch setup
 * Downloads Python (if needed), creates venv, installs pip deps.
 * Runs in main process. Shows progress via IPC to a setup window.
 */

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execSync } = require('child_process');
const https = require('https');
const http = require('http');

const PYTHON_VERSION = '3.11.9';
const DATA_DIR = path.join(app.getPath('userData'), 'backend-env');
const VENV_DIR = path.join(DATA_DIR, 'venv');
const PYTHON_DIR = path.join(DATA_DIR, 'python');
const MARKER = path.join(DATA_DIR, '.setup-complete');

function isSetupDone() {
  // Check own managed venv
  if (fs.existsSync(MARKER) && fs.existsSync(path.join(VENV_DIR, 'bin', 'python'))) return true;
  // Also check if backend has local .venv (dev mode)
  const bd = getBackendDir();
  if (bd && fs.existsSync(path.join(bd, '.venv', 'bin', 'python'))) return true;
  return false;
}

function getBackendDir() {
  const candidates = [
    path.join(__dirname, '..', 'backend'),
    path.join(process.resourcesPath || '', 'backend'),
    path.join(__dirname, 'backend'),
  ];
  for (const d of candidates) {
    if (fs.existsSync(path.join(d, 'server.py'))) return d;
  }
  return null;
}

function getVenvPython() {
  return path.join(VENV_DIR, 'bin', 'python');
}

// ── Find system Python 3.9+ ─────────────────────────────
function findSystemPython() {
  const candidates = [
    'python3.12', 'python3.11', 'python3.10', 'python3.9', 'python3', 'python'
  ];
  for (const cmd of candidates) {
    try {
      const ver = execSync(`${cmd} --version 2>&1`, { encoding: 'utf8', timeout: 5000 }).trim();
      const match = ver.match(/Python (\d+)\.(\d+)/);
      if (match) {
        const major = parseInt(match[1]);
        const minor = parseInt(match[2]);
        if (major === 3 && minor >= 9) {
          const fullPath = execSync(`which ${cmd}`, { encoding: 'utf8', timeout: 5000 }).trim();
          return { cmd: fullPath, version: ver };
        }
      }
    } catch (e) {}
  }
  return null;
}

// ── Download file helper ─────────────────────────────────
function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = url.startsWith('https') ? https.get : http.get;
    get(url, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        // Follow redirect
        return downloadFile(res.headers.location, dest, onProgress).then(resolve).catch(reject);
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let downloaded = 0;
      res.on('data', (chunk) => {
        downloaded += chunk.length;
        if (onProgress && total > 0) onProgress(downloaded, total);
      });
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (e) => { fs.unlink(dest, () => {}); reject(e); });
  });
}

// ── Run command with live output ─────────────────────────
function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: opts.cwd || __dirname,
      env: { ...process.env, ...opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    proc.stdout.on('data', d => {
      output += d.toString();
      if (opts.onData) opts.onData(d.toString());
    });
    proc.stderr.on('data', d => {
      output += d.toString();
      if (opts.onData) opts.onData(d.toString());
    });
    proc.on('error', reject);
    proc.on('exit', code => {
      if (code === 0) resolve(output);
      else reject(new Error(`Command failed (${code}): ${cmd} ${args.join(' ')}\n${output.slice(-500)}`));
    });
  });
}

// ── Main setup flow ──────────────────────────────────────
async function runSetup(sendStatus) {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const backendDir = getBackendDir();
  if (!backendDir) throw new Error('Backend directory not found');

  // Step 1: Find or get Python
  sendStatus('Checking Python...');
  let pythonCmd;

  const sys = findSystemPython();
  if (sys) {
    sendStatus(`Found ${sys.version}`);
    pythonCmd = sys.cmd;
  } else {
    // Try to install Python via Homebrew on macOS
    sendStatus('Python 3.9+ not found. Attempting install...');
    if (process.platform === 'darwin') {
      try {
        // Check if Homebrew exists
        execSync('which brew', { timeout: 5000 });
        sendStatus('Installing Python via Homebrew...');
        await runCommand('brew', ['install', 'python@3.11'], {
          onData: (d) => sendStatus('brew: ' + d.trim().slice(0, 80))
        });
        const newSys = findSystemPython();
        if (newSys) {
          pythonCmd = newSys.cmd;
          sendStatus(`Installed ${newSys.version}`);
        }
      } catch (e) {
        throw new Error(
          'Python 3.9+ is required but not installed.\n\n' +
          'Please install Python from https://python.org/downloads/ and restart Depth Scanner.'
        );
      }
    } else {
      throw new Error(
        'Python 3.9+ is required but not installed.\n\n' +
        'Please install Python from https://python.org/downloads/ and restart Depth Scanner.'
      );
    }
  }

  if (!pythonCmd) throw new Error('Could not find Python');

  // Step 2: Create venv
  if (!fs.existsSync(path.join(VENV_DIR, 'bin', 'python'))) {
    sendStatus('Creating virtual environment...');
    await runCommand(pythonCmd, ['-m', 'venv', VENV_DIR]);
    sendStatus('Virtual environment created');
  }

  const venvPython = getVenvPython();

  // Step 3: Install requirements
  sendStatus('Installing dependencies (this may take a few minutes)...');
  const reqFile = path.join(backendDir, 'requirements.txt');

  await runCommand(venvPython, ['-m', 'pip', 'install', '--upgrade', 'pip'], {
    onData: (d) => {
      const line = d.trim();
      if (line && !line.startsWith('Requirement already')) {
        sendStatus('pip: ' + line.slice(0, 100));
      }
    }
  });

  await runCommand(venvPython, ['-m', 'pip', 'install', '-r', reqFile], {
    onData: (d) => {
      const line = d.trim();
      if (line.startsWith('Collecting') || line.startsWith('Downloading') || line.startsWith('Installing')) {
        sendStatus(line.slice(0, 100));
      }
    }
  });

  sendStatus('Dependencies installed');

  // Step 4: Quick verify
  sendStatus('Verifying installation...');
  await runCommand(venvPython, ['-c', 'import torch; import fastapi; import cv2; print("OK")']);
  sendStatus('All checks passed');

  // Mark complete
  fs.writeFileSync(MARKER, new Date().toISOString());
}

module.exports = { isSetupDone, runSetup, getVenvPython, getBackendDir, DATA_DIR };
