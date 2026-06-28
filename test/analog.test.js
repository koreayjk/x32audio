'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { analyze, adviceFor, bandKnob } = require('../src/renderer/analog-advice');

const SR = 48000;
const BINS = 1024;

function flat(level) { return new Array(BINS).fill(level); }
function withPeak(baseline, binIndex, val) {
  const a = new Array(BINS).fill(baseline);
  a[binIndex] = val;
  return a;
}

test('bandKnob 주파수 → 노브', () => {
  assert.strictEqual(bandKnob(100), 'low');
  assert.strictEqual(bandKnob(1000), 'mid');
  assert.strictEqual(bandKnob(5000), 'high');
});

test('입력 과다 → GAIN 줄이기', () => {
  const m = analyze(flat(200), SR); // 매우 큰 전체 레벨
  const a = adviceFor(m);
  assert.strictEqual(a.knob, 'gain');
  assert.strictEqual(a.dir, 'down');
  assert.strictEqual(a.status, 'alarm');
});

test('입력 과소 → GAIN 올리기', () => {
  const m = analyze(flat(12), SR); // 작은 레벨 (level ~0.047)
  const a = adviceFor(m);
  assert.strictEqual(a.knob, 'gain');
  assert.strictEqual(a.dir, 'up');
});

test('무음 → 안내만', () => {
  const a = adviceFor(analyze(flat(2), SR));
  assert.strictEqual(a.knob, null);
  assert.strictEqual(a.status, 'good');
});

test('하울링(좁은 강한 피크) → 해당 대역 EQ 줄이기', () => {
  // 2kHz 이상 영역에 강한 피크 → high
  const binHz = (SR / 2) / BINS;
  const idx = Math.round(5000 / binHz);
  const m = analyze(withPeak(20, idx, 255), SR);
  assert.strictEqual(m.feedback, true);
  const a = adviceFor(m);
  assert.strictEqual(a.knob, 'high');
  assert.strictEqual(a.dir, 'down');
  assert.strictEqual(a.status, 'alarm');
});

test('저음 과다 → LOW 줄이기', () => {
  // 충분한 레벨 + 저역이 평균적으로 우세
  const binHz = (SR / 2) / BINS;
  const a = new Array(BINS).fill(0);
  for (let i = 1; i < BINS; i++) {
    const hz = i * binHz;
    if (hz < 250) a[i] = 200;
    else if (hz < 2000) a[i] = 60;
    else a[i] = 50;
  }
  const m = analyze(a, SR);
  assert.ok(m.level > 0.06 && m.level < 0.45, `레벨 범위 (${m.level})`);
  assert.ok(m.lowProp > 0.55, `저음 우세 (${m.lowProp})`);
  const adv = adviceFor(m);
  assert.strictEqual(adv.knob, 'low');
  assert.strictEqual(adv.dir, 'down');
});

test('균형 양호 → 유지', () => {
  // 적당한 레벨 + 고른 분포
  const binHz = (SR / 2) / BINS;
  const a = new Array(BINS).fill(0);
  for (let i = 1; i < BINS; i++) {
    const hz = i * binHz;
    if (hz < 250) a[i] = 30;
    else if (hz < 2000) a[i] = 30;
    else a[i] = 28;
  }
  const adv = adviceFor(analyze(a, SR));
  assert.strictEqual(adv.status, 'good');
  assert.strictEqual(adv.knob, null);
});
