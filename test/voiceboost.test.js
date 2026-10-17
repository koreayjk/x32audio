'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { buildBroadcastVoiceBoost, SERVICE_MIX, BROADCAST_VOICE } = require('../src/main/outputs');
const { faderToDb } = require('../src/main/x32-util');

const MAP = [
  { ch: 1, name: '설교마이크', role: 'speech' },
  { ch: 2, name: '싱어', role: 'vocal' },
  { ch: 9, name: '드럼', role: 'inst' },
];

// 유튜브에서 설교 목소리가 작게 나가는 문제: speech 채널의 방송 send 를 키우고 컴프를 켠다.
test('방송 목소리 강조 ON: speech 채널만 방송 send +boost, 컴프 on', () => {
  const { actions, speechCount } = buildBroadcastVoiceBoost(MAP, { broadcastBus: 1, monitorBus: 2 }, true);
  assert.strictEqual(speechCount, 1, 'speech 채널은 1개');

  // 방송 버스(01) send 레벨이 기본 speech(0dB) + boost(4dB) 인지
  const lvl = actions.find((a) => a.address === '/ch/01/mix/01/level');
  assert.ok(lvl, 'ch1 방송 send level 명령 존재');
  const db = faderToDb(lvl.args[0].value);
  const expected = (SERVICE_MIX.broadcast.speech ?? 0) + BROADCAST_VOICE.boostDb;
  assert.ok(Math.abs(db - expected) < 0.3, `방송 send ≈ ${expected}dB (실제 ${db.toFixed(1)})`);

  // 컴프레서 on
  const dynOn = actions.find((a) => a.address === '/ch/01/dyn/on');
  assert.deepStrictEqual(dynOn.args[0].value, 1, '컴프 on');
  assert.ok(actions.some((a) => a.address === '/ch/01/dyn/mgain'), '메이크업 게인 설정됨');

  // 다른 역할(보컬/악기)은 건드리지 않음
  assert.ok(!actions.some((a) => a.address.startsWith('/ch/02/')), '보컬 채널 미변경');
  assert.ok(!actions.some((a) => a.address.startsWith('/ch/09/')), '악기 채널 미변경');
});

test('방송 목소리 강조 OFF: 기본 send 로 되돌리고 컴프 off', () => {
  const { actions } = buildBroadcastVoiceBoost(MAP, { broadcastBus: 1, monitorBus: 2 }, false);
  const lvl = actions.find((a) => a.address === '/ch/01/mix/01/level');
  const db = faderToDb(lvl.args[0].value);
  assert.ok(Math.abs(db - (SERVICE_MIX.broadcast.speech ?? 0)) < 0.3, '기본 send 로 복원');
  const dynOn = actions.find((a) => a.address === '/ch/01/dyn/on');
  assert.deepStrictEqual(dynOn.args[0].value, 0, '컴프 off');
  // off 일 때는 컴프 세부값을 보내지 않음(불필요한 덮어쓰기 방지)
  assert.ok(!actions.some((a) => a.address === '/ch/01/dyn/thr'), 'off 시 thr 미전송');
});

test('speech 채널이 없으면 speechCount 0, 명령 없음', () => {
  const { actions, speechCount } = buildBroadcastVoiceBoost(
    [{ ch: 2, name: '싱어', role: 'vocal' }], { broadcastBus: 1, monitorBus: 2 }, true);
  assert.strictEqual(speechCount, 0);
  assert.strictEqual(actions.length, 0);
});

// 실 UDP: 켰다 끄면 엔지니어가 맞춰둔 원래 컴프레서·방송 레벨로 정확히 복원되는지
const { MockX32 } = require('./mock-x32');
const { X32Manager } = require('../src/main/x32');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b) => Math.abs(a - b) < 1e-4;

test('방송 목소리: 켰다 끄면 원래 컴프레서·방송 레벨로 복원 (실 UDP)', async () => {
  const mock = new MockX32();
  const port = await mock.start();
  const prior = {
    '/ch/01/mix/01/level': 0.5, '/ch/01/dyn/on': 1, '/ch/01/dyn/mode': 0, '/ch/01/dyn/det': 0,
    '/ch/01/dyn/thr': 0.4, '/ch/01/dyn/ratio': 3, '/ch/01/dyn/mgain': 0.1,
    '/ch/01/dyn/att': 0.2, '/ch/01/dyn/rel': 0.3, '/ch/01/dyn/knee': 0.2,
  };
  for (const [a, v] of Object.entries(prior)) mock.set(a, [v]);
  const x32 = new X32Manager();
  try {
    await x32.connect('127.0.0.1', port);
    x32.channelMap = [{ ch: 1, name: '설교', role: 'speech' }];

    await x32.setBroadcastVoiceBoost(true);
    await sleep(100);
    assert.ok(near(mock.get('/ch/01/dyn/thr')[0], BROADCAST_VOICE.comp.thr), '켜면 강조용 컴프 값 적용');

    await x32.setBroadcastVoiceBoost(false);
    await sleep(100);
    for (const [a, v] of Object.entries(prior)) {
      assert.ok(near(mock.get(a)[0], v), `${a} 원래 값(${v})으로 복원 — 실제 ${mock.get(a)[0]}`);
    }
  } finally {
    x32.disconnect();
    mock.stop();
  }
});
