'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { XAirAdapter, XAIR_PROFILE } = require('../src/main/xair');
const { X32Manager } = require('../src/main/x32');
const { MixerAdapter } = require('../src/main/mixer-base');
const { listMixers, createMixer } = require('../src/main/mixer-registry');
const { buildServiceStartActions } = require('../src/main/outputs');
const { DEFAULT_CHANNEL_MAP } = require('../src/main/scenes');
const { MockX32 } = require('./mock-x32');
const { dbToFader } = require('../src/main/x32-util');

test('X-Air 어댑터: X32 계열을 상속하고 프로파일이 다르다', () => {
  const a = new XAirAdapter();
  assert.ok(a instanceof X32Manager);
  assert.ok(a instanceof MixerAdapter);
  assert.strictEqual(XAirAdapter.meta.id, 'xair');
  assert.strictEqual(a.profile.port, 10024);
  assert.strictEqual(a.port, 10024);
  // 기능은 X32 와 동일하게 전부 지원
  assert.strictEqual(a.capabilities.outputs, true);
});

test('X-Air 레지스트리 등록 + 생성', () => {
  const list = listMixers();
  const xair = list.find((m) => m.id === 'xair');
  assert.strictEqual(xair.supported, true);
  assert.ok(createMixer('xair') instanceof XAirAdapter);
});

test('X-Air 주소 차이: 메인 /lr, 버스 /bus/1 (1자리)', () => {
  const actions = buildServiceStartActions(DEFAULT_CHANNEL_MAP, { broadcastBus: 1, monitorBus: 2 }, XAIR_PROFILE);
  assert.ok(actions.find((a) => a.address === '/lr/mix/on'), '메인은 /lr');
  assert.ok(!actions.find((a) => a.address === '/main/st/mix/on'), 'X32 메인 주소 없음');
  assert.ok(actions.find((a) => a.address === '/bus/1/mix/on'), '버스는 1자리');
  assert.ok(!actions.find((a) => a.address === '/bus/01/mix/on'), '2자리 아님');
  // 채널 send 슬롯은 2자리 유지(X32 와 동일)
  assert.ok(actions.find((a) => a.address === '/ch/01/mix/01/level'));
});

test('X-Air 연결 + 예배 시작 (실 UDP, 포트는 모의)', async () => {
  const mock = new MockX32();
  const port = await mock.start();
  // X-Air 메인/버스 주소를 mock 에 시드
  mock.set('/lr/mix/on', [0]);
  const a = new XAirAdapter();
  try {
    await a.connect('127.0.0.1', port); // 테스트에선 포트를 명시
    assert.strictEqual(a.connected, true);
    a.applyServiceStart();
    await new Promise((r) => setTimeout(r, 200));
    assert.deepStrictEqual(mock.get('/lr/mix/on'), [1], '메인 /lr 켜짐');
    assert.deepStrictEqual(mock.get('/bus/1/mix/on'), [1], '버스 /bus/1 켜짐');
    assert.ok(Math.abs(mock.get('/ch/01/mix/01/level')[0] - dbToFader(0)) < 1e-6);
  } finally {
    a.disconnect();
    mock.stop();
  }
});

test('X32 는 그대로 /main/st, /bus/01 사용(회귀 없음)', () => {
  const actions = buildServiceStartActions(DEFAULT_CHANNEL_MAP, { broadcastBus: 1, monitorBus: 2 });
  assert.ok(actions.find((x) => x.address === '/main/st/mix/on'));
  assert.ok(actions.find((x) => x.address === '/bus/01/mix/on'));
});
