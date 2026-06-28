'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { MockX32 } = require('./mock-x32');
const { X32Manager } = require('../src/main/x32');

test('가짜 X32 에 연결하고 정보를 받아온다', async () => {
  const mock = new MockX32();
  const port = await mock.start();
  const x32 = new X32Manager();
  try {
    const info = await x32.connect('127.0.0.1', port);
    assert.strictEqual(info.name, 'TestX32');
    assert.strictEqual(info.model, 'X32RACK');
    assert.strictEqual(x32.connected, true);
  } finally {
    x32.disconnect();
    mock.stop();
  }
});

test('잘못된 포트로 연결 시 시간 초과 오류', async () => {
  const x32 = new X32Manager();
  await assert.rejects(
    () => x32.connect('127.0.0.1', 1), // 응답 없는 포트
    /응답이 없습니다/
  );
  x32.disconnect();
});

test('채널 상태(레벨/뮤트/EQ)를 읽어온다', async () => {
  const mock = new MockX32();
  const port = await mock.start();
  mock.set('/ch/01/config/name', ['설교 마이크']);
  mock.set('/ch/01/mix/fader', [0.75]); // 0dB
  mock.set('/ch/02/mix/on', [0]);       // 뮤트
  const x32 = new X32Manager();
  try {
    await x32.connect('127.0.0.1', port);
    const channels = await x32.readChannels(4);
    assert.strictEqual(channels.length, 4);
    assert.strictEqual(channels[0].name, '설교 마이크');
    assert.ok(Math.abs(channels[0].db - 0) < 0.01, '0dB 근처');
    assert.strictEqual(channels[0].dbText, '0.0');
    assert.strictEqual(channels[1].on, false, 'ch2 뮤트');
  } finally {
    x32.disconnect();
    mock.stop();
  }
});

test('EQ 4밴드를 사람이 읽는 값으로 변환', async () => {
  const mock = new MockX32();
  const port = await mock.start();
  mock.set('/ch/01/eq/1/f', [0.5]); // 중간 주파수
  mock.set('/ch/01/eq/1/g', [1]);   // +15dB
  const x32 = new X32Manager();
  try {
    await x32.connect('127.0.0.1', port);
    const eq = await x32.readChannelEq(1);
    assert.strictEqual(eq.bands.length, 4);
    assert.strictEqual(eq.bands[0].gainDb, 15);
    assert.ok(eq.bands[0].hz > 20 && eq.bands[0].hz < 20000);
  } finally {
    x32.disconnect();
    mock.stop();
  }
});

test('Scene 적용이 X32 파라미터를 변경한다', async () => {
  const mock = new MockX32();
  const port = await mock.start();
  const x32 = new X32Manager();
  try {
    await x32.connect('127.0.0.1', port);
    const count = x32.applyScene('allmute');
    assert.ok(count > 0);
    // 명령 전파 대기
    await new Promise((r) => setTimeout(r, 150));
    // 모든 알려진 채널이 뮤트(0) 되었는지 확인
    assert.deepStrictEqual(mock.get('/ch/01/mix/on'), [0]);
    assert.deepStrictEqual(mock.get('/ch/05/mix/on'), [0]);
  } finally {
    x32.disconnect();
    mock.stop();
  }
});

test('설교 Scene 적용: ch1 ON, ch5 OFF, fader 반영', async () => {
  const mock = new MockX32();
  const port = await mock.start();
  const x32 = new X32Manager();
  try {
    await x32.connect('127.0.0.1', port);
    x32.applyScene('sermon');
    await new Promise((r) => setTimeout(r, 150));
    assert.deepStrictEqual(mock.get('/ch/01/mix/on'), [1]);
    assert.deepStrictEqual(mock.get('/ch/05/mix/on'), [0]);
    // ch1 fader 0dB(0.75)
    const fader = mock.get('/ch/01/mix/fader');
    assert.ok(Math.abs(fader[0] - 0.75) < 0.001);
  } finally {
    x32.disconnect();
    mock.stop();
  }
});

test('미터 구독 → 피드백 감지 이벤트 발생 (실 UDP)', async () => {
  const mock = new MockX32();
  const port = await mock.start();

  // bin 30 에 지속적인 강한 피크가 있는 스펙트럼 제공
  mock.setSpectrumProvider(() => {
    const s = new Array(60).fill(0.08 + Math.random() * 0.04);
    s[30] = 0.97;
    return s;
  });

  const x32 = new X32Manager();
  const feedbacks = [];
  x32.on('feedback', (a) => feedbacks.push(a));
  try {
    await x32.connect('127.0.0.1', port);
    x32.startFeedback({ levelThreshold: 0.6, peakRatio: 2.5, sustainFrames: 5 });
    // 미터 프레임이 충분히 쌓일 때까지 대기
    await new Promise((r) => setTimeout(r, 500));
    assert.ok(feedbacks.length >= 1, '피드백이 감지되어야 함');
    assert.ok(feedbacks[0].freq > 20 && feedbacks[0].freq < 20000);
  } finally {
    x32.stopFeedback();
    x32.disconnect();
    mock.stop();
  }
});
