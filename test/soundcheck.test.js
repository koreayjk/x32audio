'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { levelToDb, pickActiveChannel, computeFaderStep } = require('../src/main/soundcheck');
const { dbToFader, faderToDb } = require('../src/main/x32-util');

test('pickActiveChannel: 단독으로 크게 나는 채널을 고른다', () => {
  // ch3 만 크게(0.5≈-6dB), 나머지는 조용
  const levels = [0.001, 0.002, 0.5, 0.001];
  assert.strictEqual(pickActiveChannel(levels), 2);
});

test('pickActiveChannel: 아무도 안 치면 -1', () => {
  assert.strictEqual(pickActiveChannel([0.0005, 0.001, 0.0008]), -1);
});

test('pickActiveChannel: 둘이 동시에 크면 단독 아님 → -1', () => {
  // 두 채널이 비슷하게 큼(마진 미달)
  assert.strictEqual(pickActiveChannel([0.5, 0.45, 0.001]), -1);
});

test('computeFaderStep: 측정이 목표보다 낮으면 페이더를 올린다(스텝 이내)', () => {
  const cur = dbToFader(-10);
  const r = computeFaderStep(cur, -24, -18, { stepDb: 2 }); // 6dB 부족하지만 한 번에 2dB만
  assert.ok(faderToDb(r.nextFader) > -10, '페이더가 올라감');
  assert.ok(faderToDb(r.nextFader) <= -10 + 2 + 0.1, '한 틱에 최대 2dB');
  assert.strictEqual(r.done, false);
});

test('computeFaderStep: 목표 근처면 done=true', () => {
  const cur = dbToFader(-12);
  const r = computeFaderStep(cur, -18.5, -18, { tolDb: 1.5 });
  assert.strictEqual(r.done, true);
});

test('computeFaderStep: 안전 범위(min/max) 밖으로 안 나감', () => {
  const r = computeFaderStep(dbToFader(9), -40, -18, { maxFaderDb: 10, stepDb: 6 });
  assert.ok(faderToDb(r.nextFader) <= 10 + 0.1, '최대 페이더 제한');
});
