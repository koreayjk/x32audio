'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { buildServiceStartActions, buildSermonBroadcastDuck } = require('../src/main/outputs');
const { LoudnessController } = require('../src/main/loudness');
const { DEFAULT_CHANNEL_MAP } = require('../src/main/scenes');
const { MockX32 } = require('./mock-x32');
const { X32Manager } = require('../src/main/x32');
const { dbToFader, faderToDb } = require('../src/main/x32-util');

// ---- 예배 시작: 3개 출력 동시 세팅 ----
test('예배 시작 액션: Main/방송/모니터 send 가 모두 생성됨', () => {
  const actions = buildServiceStartActions(DEFAULT_CHANNEL_MAP, { broadcastBus: 1, monitorBus: 2 });
  // 메인/버스 마스터 켜짐
  assert.ok(actions.find((a) => a.address === '/main/st/mix/on'));
  assert.ok(actions.find((a) => a.address === '/bus/01/mix/on'));
  assert.ok(actions.find((a) => a.address === '/bus/02/mix/on'));
  // ch1: 메인 페이더 + 방송 send + 모니터 send
  assert.ok(actions.find((a) => a.address === '/ch/01/mix/fader'));
  assert.ok(actions.find((a) => a.address === '/ch/01/mix/01/level'), '방송 send');
  assert.ok(actions.find((a) => a.address === '/ch/01/mix/02/level'), '모니터 send');
  // 모든 레벨은 float
  for (const a of actions) {
    if (/level|fader/.test(a.address)) assert.strictEqual(a.args[0].type, 'f');
  }
});

test('예배 시작 적용 (실 UDP)', async () => {
  const mock = new MockX32();
  const port = await mock.start();
  const x32 = new X32Manager();
  try {
    await x32.connect('127.0.0.1', port);
    const n = x32.applyServiceStart();
    assert.ok(n > 0);
    await new Promise((r) => setTimeout(r, 200));
    assert.deepStrictEqual(mock.get('/main/st/mix/on'), [1]);
    assert.deepStrictEqual(mock.get('/bus/01/mix/on'), [1]);
    // ch1(speech) 방송 send 0dB → 0.75
    assert.ok(Math.abs(mock.get('/ch/01/mix/01/level')[0] - dbToFader(0)) < 1e-6);
    // ch9(inst) 방송 send -4dB
    assert.ok(Math.abs(mock.get('/ch/09/mix/01/level')[0] - dbToFader(-4)) < 1e-3);
  } finally {
    x32.disconnect();
    mock.stop();
  }
});

// ---- 설교 시 방송 악기 자동 다운 ----
test('설교 다운: 방송 버스 악기만 낮추고 복원', async () => {
  const mock = new MockX32();
  const port = await mock.start();
  const x32 = new X32Manager();
  try {
    await x32.connect('127.0.0.1', port);
    x32.applyServiceStart();
    await new Promise((r) => setTimeout(r, 150));
    const before = mock.get('/ch/09/mix/01/level')[0]; // inst 방송 send

    x32.setSermonBroadcastDuck(true);
    await new Promise((r) => setTimeout(r, 150));
    const ducked = mock.get('/ch/09/mix/01/level')[0];
    assert.ok(faderToDb(ducked) < faderToDb(before) - 6, '악기가 충분히 낮아져야 함');
    assert.strictEqual(x32.sermonDucked, true);

    // 모니터/메인은 그대로 (모니터 send 변화 없음)
    const monBefore = mock.get('/ch/09/mix/02/level')[0];
    assert.ok(Math.abs(monBefore - dbToFader(-2)) < 1e-3, '모니터는 유지');

    x32.setSermonBroadcastDuck(false);
    await new Promise((r) => setTimeout(r, 150));
    const restored = mock.get('/ch/09/mix/01/level')[0];
    assert.ok(Math.abs(restored - before) < 1e-6, '복원되어야 함');
  } finally {
    x32.disconnect();
    mock.stop();
  }
});

// ---- LUFS 컨트롤러 ----
test('라우드니스 컨트롤러: 작으면 올리고 크면 내린다', () => {
  const c = new LoudnessController({ target: -14, maxStepDb: 1, deadbandDb: 0.5 });
  // 너무 작은 신호(약 -34 dBFS) → 올림(+)
  for (let k = 0; k < 100; k++) c.pushLevel(0.02);
  let r = c.tick(0);
  assert.ok(r.measuredLufs < -14);
  assert.ok(r.deltaDb > 0, '레벨을 올려야 함');

  // 너무 큰 신호(약 -6 dBFS) → 내림(-)
  for (let k = 0; k < 100; k++) c.pushLevel(0.5);
  r = c.tick(0);
  assert.ok(r.measuredLufs > -14);
  assert.ok(r.deltaDb < 0, '레벨을 내려야 함');
});

test('라우드니스 컨트롤러: 무음은 무시(null)', () => {
  const c = new LoudnessController();
  for (let k = 0; k < 50; k++) c.pushLevel(0); // 게이트 이하
  assert.strictEqual(c.tick(0), null);
});

// ---- 실시간 방송 LUFS 자동 레벨 (실 UDP) ----
test('방송 LUFS 자동 레벨: 큰 신호면 버스 마스터를 내린다 (실 UDP)', async () => {
  const mock = new MockX32();
  const port = await mock.start();
  // 방송 버스(인덱스 0)에 큰 레벨이 들어오는 상황
  mock.setSpectrumProvider(() => {
    const v = new Array(16).fill(0.05);
    v[0] = 0.6; // bus1 매우 큼 → -14보다 큼 → 내려야 함
    return v;
  });
  const x32 = new X32Manager();
  const events = [];
  x32.on('loudness', (e) => events.push(e));
  try {
    await x32.connect('127.0.0.1', port);
    mock.set('/bus/01/mix/fader', [dbToFader(0)]); // 시작 0dB
    await x32.startBroadcastLoudness({ target: -14, framesPerTick: 10 });
    await new Promise((r) => setTimeout(r, 600));
    assert.ok(events.length >= 1, 'loudness 이벤트 발생');
    // 버스 마스터가 0dB보다 낮아졌는지
    const masterDb = faderToDb(mock.get('/bus/01/mix/fader')[0]);
    assert.ok(masterDb < 0, `마스터가 내려가야 함 (현재 ${masterDb.toFixed(1)}dB)`);
  } finally {
    x32.stopBroadcastLoudness();
    x32.disconnect();
    mock.stop();
  }
});
