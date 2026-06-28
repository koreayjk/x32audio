'use strict';

const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const { X32Manager } = require('./x32');
const { listScenes } = require('./scenes');
const { RemoteServer } = require('./remote-server');

const isDev = process.argv.includes('--dev');
let win = null;
const x32 = new X32Manager();

// 원격에서 제어할 예배 순서 큐 상태 (렌더러가 동기화)
let cueState = { items: [], index: -1 };

function gotoCueMain(index) {
  if (!x32.connected) return { ok: false, error: '콘솔 미연결' };
  if (index < 0 || index >= cueState.items.length) return { ok: false, error: '범위 초과' };
  const item = cueState.items[index];
  try {
    if (item.kind === 'template') x32.applyScene(item.id);
    else x32.applyChannelStates(item.states || []);
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
  cueState.index = index;
  send('x32:remote-cue', { index, name: item.name });
  return { ok: true, index, name: item.name };
}

const remote = new RemoteServer({
  getScenes: () => listScenes(),
  applyScene: (id) => x32.applyScene(id),
  getStatus: () => ({ connected: x32.connected, info: x32.info }),
  getCue: () => ({
    items: cueState.items.map((c) => ({ name: c.name, kind: c.kind })),
    index: cueState.index,
  }),
  gotoCue: (index) => gotoCueMain(index),
  allMute: () => x32.applyScene('allmute'),
});

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

  // 아날로그 가이드의 마이크 분석을 위해 미디어 권한 허용
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === 'media' || permission === 'audioCapture');
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
x32.on('suppress-info', (info) => send('x32:suppress-info', info));
x32.on('param', (address, args) => send('x32:param', { address, args }));
x32.on('service-started', (r) => send('x32:service-started', r));
x32.on('sermon-duck', (r) => send('x32:sermon-duck', r));
x32.on('loudness', (r) => send('x32:loudness', r));

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

ipcMain.handle('x32:capture-state', async (_e, { count }) => {
  return x32.captureState(count || 16);
});

ipcMain.handle('x32:apply-states', async (_e, { states }) => {
  return x32.applyChannelStates(states);
});

ipcMain.handle('x32:set-fader', async (_e, { ch, fader }) => {
  x32.setChannelFader(ch, fader);
  return true;
});

ipcMain.handle('x32:set-mute', async (_e, { ch, on }) => {
  x32.setChannelMute(ch, on);
  return true;
});

ipcMain.handle('x32:auto-suppress', async (_e, { enabled, options }) => {
  return x32.setAutoSuppress(enabled, options);
});

ipcMain.handle('x32:capture-preset', async (_e, { ch }) => {
  return x32.captureChannelPreset(ch);
});

ipcMain.handle('x32:apply-preset', async (_e, { ch, preset, withFader }) => {
  return x32.applyChannelPreset(ch, preset, withFader);
});

ipcMain.handle('remote:start', async (_e, { port }) => {
  return remote.start(port || 8723);
});

ipcMain.handle('remote:stop', async () => {
  await remote.stop();
  return true;
});

ipcMain.handle('remote:status', async () => ({
  running: remote.running,
  info: remote.running ? remote.info() : null,
}));

ipcMain.handle('remote:set-cue', async (_e, { items, index }) => {
  cueState = { items: Array.isArray(items) ? items : [], index: typeof index === 'number' ? index : -1 };
  return true;
});

ipcMain.handle('x32:service-start', async () => x32.applyServiceStart());

ipcMain.handle('x32:sermon-duck', async (_e, { on, duckDb }) => {
  return x32.setSermonBroadcastDuck(on, duckDb);
});

ipcMain.handle('x32:loudness-start', async (_e, options) => {
  return x32.startBroadcastLoudness(options || {});
});

ipcMain.handle('x32:loudness-stop', async () => {
  x32.stopBroadcastLoudness();
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

app.on('before-quit', () => { x32.disconnect(); remote.stop(); });
