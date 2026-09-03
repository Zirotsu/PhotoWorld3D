const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let mainWindow = null;
let engineProcess = null;
let engineLog = '';

function projectRoot() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
}

function engineRoot() {
  return path.join(projectRoot(), 'engine');
}

function findPython() {
  const root = engineRoot();
  const candidates = [
    process.env.PHOTOWORLD_PYTHON,
    path.join(root, '.venv', 'Scripts', 'python.exe'),
    path.join(root, '.venv', 'bin', 'python'),
    'python'
  ].filter(Boolean);
  return candidates.find((candidate) => candidate === 'python' || fs.existsSync(candidate)) || 'python';
}

function startEngine() {
  if (engineProcess && !engineProcess.killed) return;
  const root = engineRoot();
  const python = findPython();
  const server = path.join(root, 'server.py');
  engineProcess = spawn(python, [server], {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, PYTHONUNBUFFERED: '1', PHOTOWORLD_ROOT: projectRoot(), PHOTOWORLD_PORT: '18787' }
  });

  const capture = (prefix) => (chunk) => {
    const text = `${prefix}${chunk.toString()}`;
    engineLog = (engineLog + text).slice(-12000);
    process.stdout.write(text);
  };
  engineProcess.stdout.on('data', capture('[AI] '));
  engineProcess.stderr.on('data', capture('[AI:ERR] '));
  engineProcess.on('error', (error) => capture('[AI:SPAWN] ')(Buffer.from(`${error.message}\n`)));
  engineProcess.on('exit', () => { engineProcess = null; });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 680,
    backgroundColor: '#080b12',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (!app.isPackaged) {
    mainWindow.loadURL('http://127.0.0.1:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

ipcMain.handle('engine:process', () => ({
  pid: engineProcess?.pid || null,
  running: Boolean(engineProcess && !engineProcess.killed),
  logTail: engineLog
}));

app.whenReady().then(() => {
  startEngine();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => {
  if (engineProcess && !engineProcess.killed) engineProcess.kill();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
