'use strict';

const test = require('node:test');
const assert = require('node:assert');

const geq = require('../src/main/geq');
const { FeedbackSuppressor } = require('../src/main/suppressor');
const { MockX32 } = require('./mock-x32');
const { X32Manager } = require('../src/main/x32');

// ---- GEQ 매핑 ----
test('GEQ: 주파수를 가장 가까운 밴드로 매핑', () => {
  assert.strictEqual(geq.GEQ_FREQS.length, 31);
  assert.strictEqual(geq.bandIndexForFreq(1000), 17); // 1kHz = 18번째 밴드(0-based 17)
  assert.strictEqual(geq.GEQ_FREQS[geq.bandIndexForFreq(995)], 1000);
  assert.strictEqual(geq.GEQ_FREQS[geq.bandIndexForFreq(20)], 20);
  assert.strictEqual(geq.GEQ_FREQS[geq.bandIndexForFreq(19000)], 20000);
});

test('GEQ: par 주소와 게인 변환', () => {
  assert.strictEqual(geq.parAddress(1, 0), '/fx/1/par/01');
  assert.strictEqual(geq.parAddress(2, 30), '/fx/2/par/31');
  assert.ok(Math.abs(geq.geqGainToFloat(0) - 0.5) < 1e-9);
  assert.ok(Math.abs(geq.geqGainToFloat(-15) - 0) < 1e-9);
  assert.ok(Math.abs(geq.geqGainToFloat(15) - 1) < 1e-9);
});

// ---- 억제기 ----
test('억제기: 단계적으로 깎고 한도에서 멈춘다', () => {
  const sent = [];
  const sup = new FeedbackSuppressor((addr, args) => sent.push({ addr, args }), {
    slot: 1, stepDb: -3, maxCutDb: -9,
  });
  const r1 = sup.suppress(1000);
  assert.strictEqual(r1.cutDb, -3);
  assert.strictEqual(r1.band, 17);
  assert.strictEqual(sent[0].addr, '/fx/1/par/18');
  assert.strictEqual(sent[0].args[0].type, 'f', 'float 타입으로 전송');

  sup.suppress(1000); // -6
  const r3 = sup.suppress(1000); // -9 (한도)
  assert.strictEqual(r3.cutDb, -9);
  assert.strictEqual(r3.atLimit, true);

  const r4 = sup.suppress(1000); // 한도 → null
  assert.strictEqual(r4, null);
  assert.strictEqual(sent.length, 3, '한도 도달 후엔 추가 전송 없음');
});

test('억제기: 복원하면 모든 밴드를 0dB로 되돌린다', () => {
  const sent = [];
  const sup = new FeedbackSuppressor((addr, args) => sent.push({ addr, args }));
  sup.suppress(1000);
  sup.suppress(250);
  const restored = sup.restoreAll();
  assert.strictEqual(restored.length, 2);
  // 마지막 두 전송이 0dB(0.5) 복원
  const last2 = sent.slice(-2);
  for (const m of last2) assert.ok(Math.abs(m.args[0].value - 0.5) < 1e-9);
  assert.strictEqual(sup.activeCuts().length, 0);
});

// ---- 사용자 정의 Scene 적용 (실 UDP) ----
test('사용자 정의 상태 캡처 후 적용 (실 UDP)', async () => {
  const mock = new MockX32();
  const port = await mock.start();
  mock.set('/ch/01/mix/fader', [0.5]);
  mock.set('/ch/02/mix/on', [1]);
  const x32 = new X32Manager();
  try {
    await x32.connect('127.0.0.1', port);
    const state = await x32.captureState(4);
    assert.strictEqual(state.length, 4);

    // 변경할 상태 적용
    x32.applyChannelStates([{ ch: 1, on: false, fader: 0.25 }]);
    await new Promise((r) => setTimeout(r, 120));
    assert.deepStrictEqual(mock.get('/ch/01/mix/on'), [0]);
    assert.ok(Math.abs(mock.get('/ch/01/mix/fader')[0] - 0.25) < 1e-6);
  } finally {
    x32.disconnect();
    mock.stop();
  }
});

// ---- 자동 피드백 억제 통합 (실 UDP) ----
test('자동 억제 켜짐: 피드백 시 GEQ 밴드가 깎인다 (실 UDP)', async () => {
  const mock = new MockX32();
  const port = await mock.start();
  mock.setSpectrumProvider(() => {
    const s = new Array(60).fill(0.08);
    s[40] = 0.97; // 지속 피크
    return s;
  });
  const x32 = new X32Manager();
  const suppressed = [];
  x32.on('suppressed', (info) => suppressed.push(info));
  try {
    await x32.connect('127.0.0.1', port);
    x32.setAutoSuppress(true, { slot: 1, stepDb: -3, maxCutDb: -12 });
    x32.startFeedback({ levelThreshold: 0.6, peakRatio: 2.5, sustainFrames: 5 });
    await new Promise((r) => setTimeout(r, 500));
    assert.ok(suppressed.length >= 1, '자동 억제가 동작해야 함');
    // 해당 밴드 par 가 mock 에 기록됨
    const info = suppressed[0];
    const addr = geq.parAddress(1, info.band);
    assert.ok(mock.get(addr), `${addr} 가 설정되어야 함`);
    assert.ok(mock.get(addr)[0] < 0.5, '0dB(0.5)보다 낮게 감쇠');
  } finally {
    x32.setAutoSuppress(false);
    x32.stopFeedback();
    x32.disconnect();
    mock.stop();
  }
});
