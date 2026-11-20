const { app, BrowserWindow, dialog, session } = require('electron');
const path = require('path');
const isDev = require('electron-is-dev');

// Optimize for Linux audio capture and speech
app.commandLine.appendSwitch('enable-speech-dispatcher');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function createWindow() {
  const isKiosk = process.argv.includes('--kiosk') || process.env.SAFESPEAK_KIOSK === '1';

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    kiosk: isKiosk,
    autoHideMenuBar: true,
    title: 'SafeSpeak - Student Reporting Platform',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    }
  });

  // Ensure microphone & media permissions are automatically granted on Linux / Raspberry Pi
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'microphone', 'audioCapture'];
    if (allowedPermissions.includes(permission)) {
      return callback(true);
    }
    callback(false);
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const allowedPermissions = ['media', 'microphone', 'audioCapture'];
    return allowedPermissions.includes(permission);
  });

  // In dev, load the vite dev server. In prod, load the built index.html
  const devUrl = process.env.ELECTRON_START_URL || 'http://localhost:8080';
  const fallbackDevUrl = 'http://localhost:5173';

  if (isDev) {
    win.loadURL(devUrl).catch(() => win.loadURL(fallbackDevUrl));
    win.webContents.openDevTools({ mode: 'right' });
  } else {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'));
  }

  win.on('closed', () => {
    // Dereference window
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Simple dialog on uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception in Electron main:', err);
  try { dialog.showErrorBox('Electron error', err?.message || String(err)); } catch (e) {}
});
