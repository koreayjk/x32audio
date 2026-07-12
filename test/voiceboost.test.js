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
