'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { MixerAdapter } = require('../src/main/mixer-base');
const { listMixers, createMixer } = require('../src/main/mixer-registry');
const { X32Manager } = require('../src/main/x32');

test('레지스트리: X32·X-Air 지원, 나머지는 예정', () => {
  const list = listMixers();
  assert.ok(list.length >= 5);
  for (const id of ['x32', 'xair']) {
    const m = list.find((x) => x.id === id);
    assert.strictEqual(m.supported, true, `${id} 지원`);
    assert.strictEqual(m.status, 'supported');
  }
  // 나머지는 추후 지원 예정
  const planned = list.filter((m) => !['x32', 'xair'].includes(m.id));
  assert.ok(planned.length >= 1);
  for (const m of planned) assert.strictEqual(m.supported, false);
});

test('createMixer: x32 는 어댑터 인스턴스, 예정은 throw', () => {
  const x = createMixer('x32');
  assert.ok(x instanceof MixerAdapter);
  assert.ok(x instanceof X32Manager);
  assert.throws(() => createMixer('yamaha'), /지원 예정/);
  assert.throws(() => createMixer('없는믹서'), /알 수 없는/);
});

test('X32Manager 는 어댑터 계약을 만족', () => {
  assert.strictEqual(X32Manager.meta.id, 'x32');
  const x = new X32Manager();
  const c = x.capabilities;
  assert.strictEqual(c.outputs, true);
  assert.strictEqual(c.feedback, true);
  assert.strictEqual(c.faderControl, true);
  // 연결 전 적용 시도는 막힌다
  assert.throws(() => x.applyServiceStart(), /연결/);
});

test('미지원 믹서(기본 어댑터)는 기능 호출 시 안내 오류', () => {
  class StubMixer extends MixerAdapter {
    static get meta() { return { id: 'stub', name: '스텁믹서', status: 'planned', kind: 'digital' }; }
  }
  const s = new StubMixer();
  assert.strictEqual(s.capabilities.outputs, false);
  assert.throws(() => s.setChannelFader(1, 0.5), /스텁믹서.*지원/);
  assert.rejects(() => s.connect(), /지원/);
});
