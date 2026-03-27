const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const net = require('net');
const http = require('http');


let mainWindow = null;
let backendProcess = null;
let backendPort = 8000;

function findFreePort(startPort = 8000) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(startPort, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
    server.on('error', () => {
      resolve(findFreePort(startPort + 1));
    });
  });
}

function waitForHealth(port, maxRetries = 40, interval = 500) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const check = () => {
      attempts++;
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        if (res.statusCode === 200) {
          resolve(true);
        } else if (attempts < maxRetries) {
          setTimeout(check, interval);
        } else {
          reject(new Error('Backend health check failed after max retries'));
        }
      });
      req.on('error', () => {
        if (attempts < maxRetries) {
          setTimeout(check, interval);
        } else {
          reject(new Error('Backend did not start'));
        }
      });
      req.setTimeout(2000, () => {
        req.destroy();
        if (attempts < maxRetries) {
          setTimeout(check, interval);
        } else {
          reject(new Error('Backend health check timed out'));
        }
      });
    };
    check();
  });
}

function getBackendPath() {
  if (!app.isPackaged) return null;

  const fs = require('fs');
  const resourcesPath = process.resourcesPath;
  const candidates = [
    path.join(resourcesPath, 'backend', 'fx-backend.exe'),
    path.join(resourcesPath, 'backend', 'fx-backend', 'fx-backend.exe'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  console.error('Backend executable not found. Searched:', candidates);
  return null;
}

async function startBackend() {
  backendPort = await findFreePort(8000);

  const backendExe = getBackendPath();
  const env = {
    ...process.env,
    PORT: String(backendPort),
    HOST: '127.0.0.1',
    CORS_ORIGINS: `http://localhost:5173,http://localhost:${backendPort},http://127.0.0.1:${backendPort},null`,
  };

  if (backendExe) {
    const backendDir = path.dirname(backendExe);
    console.log(`Starting packaged backend: ${backendExe} on port ${backendPort}`);
    backendProcess = spawn(backendExe, [], {
      cwd: backendDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } else {
    const backendDir = path.join(__dirname, '..', 'backend');
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    console.log(`Starting dev backend (uvicorn) on port ${backendPort}`);
    backendProcess = spawn(pythonCmd, [
      '-m', 'uvicorn', 'app.main:app',
      '--host', '127.0.0.1',
      '--port', String(backendPort),
    ], {
      cwd: backendDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }

  backendProcess.stdout.on('data', (data) => {
    console.log(`[backend] ${data.toString().trim()}`);
  });
  backendProcess.stderr.on('data', (data) => {
    console.error(`[backend] ${data.toString().trim()}`);
  });
  backendProcess.on('exit', (code) => {
    console.log(`Backend exited with code ${code}`);
    backendProcess = null;
  });

  console.log('Waiting for backend to be ready...');
  await waitForHealth(backendPort);
  console.log(`Backend ready on port ${backendPort}`);
}

function stopBackend() {
  if (backendProcess) {
    console.log('Stopping backend...');
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(backendProcess.pid), '/f', '/t']);
    } else {
      backendProcess.kill('SIGTERM');
    }
    backendProcess = null;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'FX Analytics',
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (!app.isPackaged) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('get-backend-port', () => backendPort);

app.whenReady().then(async () => {
  createWindow();
  try {
    await startBackend();
    if (mainWindow) mainWindow.webContents.send('backend-ready', backendPort);
  } catch (e) {
    console.error('Failed to start backend:', e.message);
  }
});

app.on('window-all-closed', () => {
  stopBackend();
  app.quit();
});

app.on('before-quit', () => {
  stopBackend();
});
