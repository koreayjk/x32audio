'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { MockX32 } = require('./mock-x32');
const { X32Manager } = require('../src/main/x32');
const { RemoteServer } = require('../src/main/remote-server');
const { listScenes } = require('../src/main/scenes');
const { dbToFader, faderToDb } = require('../src/main/x32-util');

function httpReq(opts, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.end(body); else req.end();
  });
}

// ---- Part A: 양방향 페이더/뮤트 제어 ----
test('단일 채널 페이더 직접 제어 (실 UDP)', async () => {
  const mock = new MockX32();
  const port = await mock.start();
  const x32 = new X32Manager();
  try {
    await x32.connect('127.0.0.1', port);
    x32.setChannelFader(3, dbToFader(-6));
    x32.setChannelMute(3, false);
    await new Promise((r) => setTimeout(r, 120));
    assert.ok(Math.abs(faderToDb(mock.get('/ch/03/mix/fader')[0]) - (-6)) < 0.1);
    assert.deepStrictEqual(mock.get('/ch/03/mix/on'), [0]);
  } finally {
    x32.disconnect();
    mock.stop();
  }
});

// ---- Part B: 원격 큐 제어 ----
test('원격 큐: next 로 장면 적용, all-mute 동작 (실 HTTP+UDP)', async () => {
  const mock = new MockX32();
  const mport = await mock.start();
  const x32 = new X32Manager();

  let cueState = {
    items: [
      { kind: 'template', id: 'sermon', name: '설교' },
      { kind: 'template', id: 'worship', name: '찬양팀' },
    ],
    index: -1,
  };
  function gotoCue(index) {
    if (!x32.connected) return { ok: false, error: '미연결' };
    if (index < 0 || index >= cueState.items.length) return { ok: false, error: '범위' };
    const item = cueState.items[index];
    if (item.kind === 'template') x32.applyScene(item.id);
    else x32.applyChannelStates(item.states || []);
    cueState.index = index;
    return { ok: true, index };
  }

  const remote = new RemoteServer({
    getScenes: () => listScenes(),
    applyScene: (id) => x32.applyScene(id),
    getStatus: () => ({ connected: x32.connected, info: x32.info }),
    getCue: () => ({ items: cueState.items.map((c) => ({ name: c.name, kind: c.kind })), index: cueState.index }),
    gotoCue,
    allMute: () => x32.applyScene('allmute'),
  });

  try {
    await x32.connect('127.0.0.1', mport);
    const { port } = await remote.start(0);

    // 큐 상태 조회
    let cue = JSON.parse((await httpReq({ host: '127.0.0.1', port, path: '/api/cue', method: 'GET' })).body);
    assert.strictEqual(cue.items.length, 2);
    assert.strictEqual(cue.index, -1);

    // 다음 → 설교 적용
    const next = await httpReq({ host: '127.0.0.1', port, path: '/api/cue/next', method: 'POST', headers: { 'Content-Type': 'application/json' } }, '{}');
    assert.strictEqual(next.status, 200);
    await new Promise((r) => setTimeout(r, 150));
    assert.deepStrictEqual(mock.get('/ch/01/mix/on'), [1], '설교: ch1 ON');
    assert.deepStrictEqual(mock.get('/ch/05/mix/on'), [0], '설교: ch5 OFF');

    cue = JSON.parse((await httpReq({ host: '127.0.0.1', port, path: '/api/cue', method: 'GET' })).body);
    assert.strictEqual(cue.index, 0);

    // 전체 음소거
    const mute = await httpReq({ host: '127.0.0.1', port, path: '/api/mute', method: 'POST' });
    assert.strictEqual(mute.status, 200);
    await new Promise((r) => setTimeout(r, 150));
    assert.deepStrictEqual(mock.get('/ch/01/mix/on'), [0], 'all-mute: ch1 OFF');
  } finally {
    await remote.stop();
    x32.disconnect();
    mock.stop();
  }
});

test('원격 큐: 미연결 시 next 거부(409)', async () => {
  const x32 = new X32Manager();
  const remote = new RemoteServer({
    getScenes: () => listScenes(),
    applyScene: () => 0,
    getStatus: () => ({ connected: false, info: null }),
    getCue: () => ({ items: [{ name: 'a', kind: 'template' }], index: -1 }),
    gotoCue: () => ({ ok: true }),
    allMute: () => 0,
  });
  try {
    const { port } = await remote.start(0);
    const r = await httpReq({ host: '127.0.0.1', port, path: '/api/cue/next', method: 'POST' }, '{}');
    assert.strictEqual(r.status, 409);
  } finally {
    await remote.stop();
  }
});
