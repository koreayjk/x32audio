'use strict';

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { MockX32 } = require('./mock-x32');
const { X32Manager } = require('../src/main/x32');
const { RemoteServer } = require('../src/main/remote-server');
const { listScenes } = require('../src/main/scenes');

// ---- 인물별 마이크 프리셋 ----
test('채널 프리셋 캡처 후 다른 채널에 적용 (실 UDP)', async () => {
  const mock = new MockX32();
  const port = await mock.start();
  // ch1 에 특징적인 EQ 값 설정
  mock.set('/ch/01/eq/on', [1]);
  mock.set('/ch/01/eq/1/g', [0.8]);
  mock.set('/ch/01/eq/1/f', [0.42]);
  mock.set('/ch/01/preamp/hpon', [1]);
  mock.set('/ch/01/preamp/hpf', [0.53]);
  mock.set('/ch/03/mix/fader', [0.3]); // ch3 페이더는 건드리면 안 됨
  const x32 = new X32Manager();
  try {
    await x32.connect('127.0.0.1', port);
    const preset = await x32.captureChannelPreset(1);
    assert.strictEqual(preset.eqOn, true);
    assert.ok(Math.abs(preset.bands[0].g - 0.8) < 1e-6);
    assert.strictEqual(preset.bands.length, 4);

    // ch3 에 적용
    x32.applyChannelPreset(3, preset);
    await new Promise((r) => setTimeout(r, 150));
    assert.deepStrictEqual(mock.get('/ch/03/eq/on'), [1]);
    assert.ok(Math.abs(mock.get('/ch/03/eq/1/g')[0] - 0.8) < 1e-6);
    assert.ok(Math.abs(mock.get('/ch/03/preamp/hpf')[0] - 0.53) < 1e-6);
    // 기본적으로 페이더는 적용 안 함 → ch3 페이더는 그대로 0.3
    assert.ok(Math.abs(mock.get('/ch/03/mix/fader')[0] - 0.3) < 1e-6);
  } finally {
    x32.disconnect();
    mock.stop();
  }
});

// ---- 실시간 동기화: 콘솔이 보낸 파라미터 푸시를 param 이벤트로 받음 ----
test('실시간 동기화: 콘솔 파라미터 푸시를 param 이벤트로 수신 (실 UDP)', async () => {
  const mock = new MockX32();
  const port = await mock.start();
  const x32 = new X32Manager();
  const params = [];
  x32.on('param', (addr, args) => params.push({ addr, args }));
  try {
    await x32.connect('127.0.0.1', port);
    // 콘솔이 페이더 변경을 자발적으로 푸시하는 상황을 흉내
    mock.push('/ch/02/mix/fader', [0.5]);
    await new Promise((r) => setTimeout(r, 150));
    const hit = params.find((p) => p.addr === '/ch/02/mix/fader');
    assert.ok(hit, 'param 이벤트로 전달되어야 함');
    assert.ok(Math.abs(hit.args[0] - 0.5) < 1e-6);
  } finally {
    x32.disconnect();
    mock.stop();
  }
});

// ---- 원격 서버 ----
const TEST_PIN = '1234'; // 원격 서버 PIN (테스트용 고정값)
function httpReq(opts, body) {
  // 기본적으로 PIN 헤더를 붙인다. noPin:true 면 생략, headers 로 덮어쓰기 가능.
  if (!opts.noPin) opts = { ...opts, headers: { 'X-Remote-Pin': TEST_PIN, ...(opts.headers || {}) } };
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

test('원격 서버: 페이지/상태/Scene API 동작 (실 HTTP)', async () => {
  const mock = new MockX32();
  const mport = await mock.start();
  const x32 = new X32Manager();
  const remote = new RemoteServer({
    getScenes: () => listScenes(),
    applyScene: (id) => x32.applyScene(id),
    getStatus: () => ({ connected: x32.connected, info: x32.info }),
  });
  try {
    await x32.connect('127.0.0.1', mport);
    const { port } = await remote.start(0, { pin: TEST_PIN }); // 임의 포트

    // 페이지
    const page = await httpReq({ host: '127.0.0.1', port, path: '/', method: 'GET' });
    assert.strictEqual(page.status, 200);
    assert.ok(page.body.includes('X32 원격'));

    // 상태
    const stat = await httpReq({ host: '127.0.0.1', port, path: '/api/status', method: 'GET' });
    assert.strictEqual(JSON.parse(stat.body).connected, true);

    // Scene 목록
    const scenes = await httpReq({ host: '127.0.0.1', port, path: '/api/scenes', method: 'GET' });
    assert.ok(JSON.parse(scenes.body).scenes.length > 0);

    // Scene 적용 → mock 에 반영
    const apply = await httpReq(
      { host: '127.0.0.1', port, path: '/api/scene', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      JSON.stringify({ id: 'allmute' }),
    );
    assert.strictEqual(apply.status, 200);
    await new Promise((r) => setTimeout(r, 150));
    assert.deepStrictEqual(mock.get('/ch/01/mix/on'), [0]);
  } finally {
    await remote.stop();
    x32.disconnect();
    mock.stop();
  }
});

test('원격 서버: 미연결 시 Scene 적용 거부(409)', async () => {
  const x32 = new X32Manager();
  const remote = new RemoteServer({
    getScenes: () => listScenes(),
    applyScene: (id) => x32.applyScene(id),
    getStatus: () => ({ connected: x32.connected, info: x32.info }),
  });
  try {
    const { port } = await remote.start(0, { pin: TEST_PIN });
    const apply = await httpReq(
      { host: '127.0.0.1', port, path: '/api/scene', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      JSON.stringify({ id: 'sermon' }),
    );
    assert.strictEqual(apply.status, 409);
  } finally {
    await remote.stop();
  }
});

test('원격 서버: PIN 없거나 틀리면 401, 페이지는 PIN 없이 열림', async () => {
  const remote = new RemoteServer({
    getScenes: () => listScenes(),
    applyScene: () => 0,
    getStatus: () => ({ connected: true, info: null }),
  });
  try {
    const { port, pin } = await remote.start(0, { pin: TEST_PIN });
    assert.strictEqual(pin, TEST_PIN, 'info() 에 PIN 포함');
    const page = await httpReq({ host: '127.0.0.1', port, path: '/', method: 'GET', noPin: true });
    assert.strictEqual(page.status, 200, '페이지 자체는 PIN 없이 열림(입력 화면 표시용)');
    const none = await httpReq({ host: '127.0.0.1', port, path: '/api/scenes', method: 'GET', noPin: true });
    assert.strictEqual(none.status, 401, 'PIN 없음 → 401');
    const wrong = await httpReq({ host: '127.0.0.1', port, path: '/api/mute', method: 'POST', headers: { 'X-Remote-Pin': '9999' } });
    assert.strictEqual(wrong.status, 401, '틀린 PIN → 401');
  } finally {
    await remote.stop();
  }
});

test('원격 서버: PIN 5회 틀리면 잠금(429) — 맞는 PIN 도 잠시 거부', async () => {
  const remote = new RemoteServer({
    getScenes: () => listScenes(),
    applyScene: () => 0,
    getStatus: () => ({ connected: true, info: null }),
  });
  try {
    const { port } = await remote.start(0, { pin: TEST_PIN });
    for (let k = 0; k < 5; k++) {
      const r = await httpReq({ host: '127.0.0.1', port, path: '/api/status', method: 'GET', headers: { 'X-Remote-Pin': '0000' } });
      assert.strictEqual(r.status, 401);
    }
    const locked = await httpReq({ host: '127.0.0.1', port, path: '/api/status', method: 'GET' });
    assert.strictEqual(locked.status, 429, '5회 실패 후엔 맞는 PIN 도 잠금');
  } finally {
    await remote.stop();
  }
});

test('원격 서버: 시작할 때마다 4자리 숫자 PIN 생성', async () => {
  const remote = new RemoteServer({ getScenes: () => [], applyScene: () => 0, getStatus: () => ({ connected: false }) });
  try {
    const { pin } = await remote.start(0);
    assert.match(pin, /^\d{4}$/);
  } finally {
    await remote.stop();
  }
  assert.strictEqual(remote.pin, null, '중지하면 PIN 폐기');
});
