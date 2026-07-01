'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { MockX32 } = require('./mock-x32');
const { X32Manager } = require('../src/main/x32');
const { dbToFader } = require('../src/main/x32-util');

// 연결 시점의 "원본 세팅"을 통째로 캡처하고, 값을 바꾼 뒤 다시 원본으로 복구되는지 검증.
test('captureFullState/applyFullState: 원본 세팅 저장 후 복구 (실 UDP)', async () => {
  const mock = new MockX32();
  const port = await mock.start();
  // 콘솔에 이미 엔지니어가 설정해 둔 값이라고 가정
  mock.set('/ch/01/config/name', ['설교마이크']);
  mock.set('/ch/01/mix/on', [1]);
  mock.set('/ch/01/mix/fader', [dbToFader(-3)]);
  mock.set('/ch/02/mix/on', [1]);
  mock.set('/ch/02/mix/fader', [dbToFader(-9)]);

  const x32 = new X32Manager();
  try {
    await x32.connect('127.0.0.1', port);

    // 1) 원본 캡처
    const original = await x32.captureFullState(3);
    assert.strictEqual(original.length, 3);
    const ch1 = original.find((s) => s.ch === 1);
    assert.strictEqual(ch1.name, '설교마이크');
    assert.strictEqual(ch1.on, true);
    assert.ok(ch1.preset, '소리(EQ/프리앰프) 프리셋도 함께 캡처');
    assert.strictEqual(ch1.preset.bands.length, 4);

    // 2) 앱이 값을 바꿈 (페이더 내리고 음소거)
    x32.setChannelFader(1, dbToFader(-40));
    x32.setChannelMute(1, false);
    x32.setChannelFader(2, dbToFader(-40));
    await new Promise((r) => setTimeout(r, 120));
    assert.deepStrictEqual(mock.get('/ch/01/mix/on'), [0], '변경됨: ch1 음소거');

    // 3) 원본으로 복구
    const n = x32.applyFullState(original, { withFader: true });
    assert.ok(n > 0, '복구 명령을 전송');
    await new Promise((r) => setTimeout(r, 150));

    assert.deepStrictEqual(mock.get('/ch/01/mix/on'), [1], '복구됨: ch1 다시 ON');
    assert.ok(Math.abs(mock.get('/ch/01/mix/fader')[0] - dbToFader(-3)) < 0.01, '복구됨: ch1 원래 페이더');
    assert.ok(Math.abs(mock.get('/ch/02/mix/fader')[0] - dbToFader(-9)) < 0.01, '복구됨: ch2 원래 페이더');
  } finally {
    x32.disconnect();
    mock.stop();
  }
});

test('applyFullState: withFader:false 면 페이더는 건드리지 않고 EQ/음소거만 복구', async () => {
  const mock = new MockX32();
  const port = await mock.start();
  const x32 = new X32Manager();
  try {
    await x32.connect('127.0.0.1', port);
    const original = await x32.captureFullState(1);

    // 페이더만 바꾼 뒤, 페이더 제외 복구 → 페이더는 그대로 유지되어야 함
    x32.setChannelFader(1, dbToFader(-30));
    await new Promise((r) => setTimeout(r, 100));
    x32.applyFullState(original, { withFader: false });
    await new Promise((r) => setTimeout(r, 120));

    assert.ok(Math.abs(mock.get('/ch/01/mix/fader')[0] - dbToFader(-30)) < 0.01,
      'withFader:false → 페이더 미변경');
  } finally {
    x32.disconnect();
    mock.stop();
  }
});

test('captureFullState: 미연결 시 에러', async () => {
  const x32 = new X32Manager();
  await assert.rejects(() => x32.captureFullState(1), /연결/);
});
