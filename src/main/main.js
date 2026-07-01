'use strict';

const { app, BrowserWindow, ipcMain, session } = require('electron');
const path = require('path');
const { listScenes } = require('./scenes');
const { RemoteServer } = require('./remote-server');
const { listMixers, createMixer } = require('./mixer-registry');

const isDev = process.argv.includes('--dev');
let win = null;
// 현재 활성 믹서 어댑터 (기본: X32). mixer:select 로 교체 가능.
let x32 = createMixer('x32');

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

// ---- 믹서 이벤트 → 렌더러 전달 ----
function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// 활성 믹서 어댑터에 이벤트 핸들러를 연결 (어댑터 교체 시 재호출)
function wireMixer(m) {
  m.on('connected', (info) => send('x32:connected', info));
  m.on('disconnected', () => send('x32:disconnected'));
  m.on('error', (err) => send('x32:error', String(err && err.message ? err.message : err)));
  m.on('feedback', (alert) => send('x32:feedback', alert));
  m.on('feedback-clear', (info) => send('x32:feedback-clear', info));
  m.on('meters', (spectrum) => send('x32:meters', spectrum));
  m.on('scene-applied', (r) => send('x32:scene-applied', r));
  m.on('suppress-info', (info) => send('x32:suppress-info', info));
  m.on('param', (address, args) => send('x32:param', { address, args }));
  m.on('service-started', (r) => send('x32:service-started', r));
  m.on('sermon-duck', (r) => send('x32:sermon-duck', r));
  m.on('loudness', (r) => send('x32:loudness', r));
  m.on('channelmap', (map) => send('x32:channelmap', map));
}
wireMixer(x32);

// ---- IPC 핸들러 ----
ipcMain.handle('mixer:list', async () => listMixers());

ipcMain.handle('mixer:select', async (_e, { id }) => {
  const entry = listMixers().find((m) => m.id === id);
  if (!entry) return { ok: false, error: '알 수 없는 믹서' };
  if (!entry.supported) return { ok: false, status: entry.status, name: entry.name };
  const currentId = x32.constructor && x32.constructor.meta ? x32.constructor.meta.id : null;
  if (currentId === id) return { ok: true, id };
  try { x32.disconnect(); } catch (_) { /* ignore */ }
  x32 = createMixer(id);
  wireMixer(x32);
  return { ok: true, id };
});

ipcMain.handle('x32:connect', async (_e, { host, port }) => {
  const info = await x32.connect(host, port || 10023);
  return info;
});

ipcMain.handle('x32:disconnect', async () => {
  x32.disconnect();
  return true;
});

ipcMain.handle('x32:discover', async (_e, opts) => x32.discover(opts || {}));

ipcMain.handle('net:localips', async () => {
  const os = require('os');
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const ni of ifs[name] || []) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    }
  }
  return out;
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

ipcMain.handle('x32:capture-full', async (_e, { count } = {}) => {
  return x32.captureFullState(count || 32, (done, total) => send('x32:capture-progress', { done, total }));
});

ipcMain.handle('x32:apply-full', async (_e, { states, opts } = {}) => {
  return x32.applyFullState(states, opts || {});
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
  mixer: x32.constructor && x32.constructor.meta ? x32.constructor.meta : null,
  capabilities: x32.capabilities || null,
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
