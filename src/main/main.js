'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { X32Manager } = require('./x32');
const { listScenes } = require('./scenes');

const isDev = process.argv.includes('--dev');
let win = null;
const x32 = new X32Manager();

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 880,
    minHeight: 600,
    title: 'X32 교회 음향',
    backgroundColor: '#1b1f2a',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  if (isDev) win.webContents.openDevTools({ mode: 'detach' });
  win.on('closed', () => { win = null; });
}

// ---- X32 이벤트 → 렌더러 전달 ----
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
x32.on('connected', (info) => send('x32:connected', info));
x32.on('disconnected', () => send('x32:disconnected'));
x32.on('error', (err) => send('x32:error', String(err && err.message ? err.message : err)));
x32.on('feedback', (alert) => send('x32:feedback', alert));
x32.on('feedback-clear', (info) => send('x32:feedback-clear', info));
x32.on('meters', (spectrum) => send('x32:meters', spectrum));
x32.on('scene-applied', (r) => send('x32:scene-applied', r));

// ---- IPC 핸들러 ----
ipcMain.handle('x32:connect', async (_e, { host, port }) => {
  const info = await x32.connect(host, port || 10023);
  return info;
});

ipcMain.handle('x32:disconnect', async () => {
  x32.disconnect();
  return true;
});

ipcMain.handle('x32:read-channels', async (_e, { count }) => {
  return x32.readChannels(count || 16);
});

ipcMain.handle('x32:read-eq', async (_e, { ch }) => {
  return x32.readChannelEq(ch);
});

ipcMain.handle('x32:scenes', async () => listScenes());

ipcMain.handle('x32:apply-scene', async (_e, { sceneId }) => {
  return x32.applyScene(sceneId);
});

ipcMain.handle('x32:start-feedback', async (_e, options) => {
  x32.startFeedback(options || {});
  return true;
});

ipcMain.handle('x32:stop-feedback', async () => {
  x32.stopFeedback();
  return true;
});

ipcMain.handle('x32:status', async () => ({
  connected: x32.connected,
  info: x32.info,
}));

// ---- 앱 생명주기 ----
app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  x32.disconnect();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => x32.disconnect());
