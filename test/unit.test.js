'use strict';

const test = require('node:test');
const assert = require('node:assert');

const util = require('../src/main/x32-util');
const { FeedbackDetector } = require('../src/main/feedback');
const { buildSceneActions, listScenes } = require('../src/main/scenes');

test('faderToDb / dbToFader 왕복 변환', () => {
  for (const db of [-60, -30, -10, 0, 5, 10]) {
    const f = util.dbToFader(db);
    const back = util.faderToDb(f);
    assert.ok(Math.abs(back - db) < 0.01, `${db}dB ≈ ${back}dB`);
  }
  assert.strictEqual(util.dbToFader(-Infinity), 0);
  assert.strictEqual(util.faderToDb(0), -Infinity);
});

test('faderToDb 알려진 기준점', () => {
  assert.ok(Math.abs(util.faderToDb(0.75) - 0) < 0.001, '0.75 = 0dB(유니티)');
  assert.ok(util.faderToDb(1) === 10, '1.0 = +10dB');
});

test('EQ 주파수/게인 변환', () => {
  assert.ok(Math.abs(util.eqFreqToHz(0) - 20) < 0.001);
  assert.ok(Math.abs(util.eqFreqToHz(1) - 20000) < 1);
  assert.ok(Math.abs(util.eqGainToDb(0.5) - 0) < 0.001);
  assert.ok(Math.abs(util.eqGainToDb(1) - 15) < 0.001);
});

test('binToFreq 로그 매핑', () => {
  assert.strictEqual(Math.round(util.binToFreq(0, 100)), 20);
  assert.strictEqual(Math.round(util.binToFreq(99, 100)), 20000);
});

test('타입 헬퍼 f/i/s', () => {
  assert.deepStrictEqual(util.f(0.5), { type: 'f', value: 0.5 });
  assert.deepStrictEqual(util.f(1), { type: 'f', value: 1 }); // 1.0 도 float 유지
  assert.deepStrictEqual(util.i(1), { type: 'i', value: 1 });
  assert.deepStrictEqual(util.s('x'), { type: 's', value: 'x' });
});

test('피드백 감지: 지속된 좁은 피크를 감지', () => {
  const det = new FeedbackDetector({ levelThreshold: 0.6, peakRatio: 2.5, sustainFrames: 5 });
  const alerts = [];
  det.on('feedback', (a) => alerts.push(a));

  const flat = new Array(50).fill(0.1);
  const peak = flat.slice();
  peak[25] = 0.95; // bin 25 에 강한 피크

  // 평탄한 신호 → 감지 안 됨
  for (let k = 0; k < 5; k++) det.push(flat);
  assert.strictEqual(alerts.length, 0);

  // 피크 지속 → sustainFrames 후 감지
  for (let k = 0; k < 5; k++) det.push(peak);
  assert.strictEqual(alerts.length, 1);
  assert.strictEqual(alerts[0].bin, 25);
  assert.ok(alerts[0].freq > 20 && alerts[0].freq < 20000);
});

test('피드백 감지: 일시적 피크는 무시', () => {
  const det = new FeedbackDetector({ sustainFrames: 5 });
  const alerts = [];
  det.on('feedback', (a) => alerts.push(a));
  const flat = new Array(50).fill(0.1);
  const peak = flat.slice(); peak[10] = 0.95;
  // 2 프레임만 피크 → 미만
  det.push(peak); det.push(peak);
  for (let k = 0; k < 6; k++) det.push(flat);
  assert.strictEqual(alerts.length, 0, '짧은 피크는 피드백 아님');
});

test('Scene 목록과 액션 생성', () => {
  const scenes = listScenes();
  assert.ok(scenes.find((s) => s.id === 'sermon'));
  assert.ok(scenes.find((s) => s.id === 'allmute' && s.danger));

  // 설교 Scene: ch1 ON, 나머지 알려진 채널은 OFF
  const sermon = buildSceneActions('sermon');
  const ch1on = sermon.find((a) => a.address === '/ch/01/mix/on');
  assert.deepStrictEqual(ch1on.args, [{ type: 'i', value: 1 }]);
  const ch5on = sermon.find((a) => a.address === '/ch/05/mix/on');
  assert.deepStrictEqual(ch5on.args, [{ type: 'i', value: 0 }]);

  // 전체 음소거: 모든 액션이 on=0
  const mute = buildSceneActions('allmute');
  for (const a of mute) {
    if (a.address.endsWith('/mix/on')) {
      assert.deepStrictEqual(a.args, [{ type: 'i', value: 0 }]);
    }
  }
});

test('Scene: fader 값은 float 타입으로 인코딩', () => {
  const setup = buildSceneActions('setup');
  const fader = setup.find((a) => a.address === '/ch/01/mix/fader');
  assert.strictEqual(fader.args[0].type, 'f', 'fader 는 float 이어야 X32 가 올바로 처리');
  assert.ok(Math.abs(fader.args[0].value - 0.75) < 0.001, '0dB → 0.75');
});
