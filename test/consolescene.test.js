'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { MockX32 } = require('./mock-x32');
const { X32Manager } = require('../src/main/x32');

// 앱에서 만든 세팅을 믹서 자체 Scene 메모리(빈 번호)에 저장하는 기능 검증.
test('saveToConsoleScene: 빈 슬롯(0)을 찾아 저장하고 확인한다 (실 UDP)', async () => {
  const mock = new MockX32();
  const port = await mock.start();
  const x32 = new X32Manager();
  try {
    await x32.connect('127.0.0.1', port);
    const r = await x32.saveToConsoleScene({ name: 'SUNDAY' });
    assert.strictEqual(r.index, 0, '첫 빈 슬롯은 0');
    assert.strictEqual(r.name, 'SUNDAY');
    assert.strictEqual(r.verified, true, '저장 후 슬롯 이름 확인');
    assert.deepStrictEqual(mock.get('/-show/showfile/scene/000/hasdata'), [1]);
    assert.deepStrictEqual(mock.get('/-show/showfile/scene/000/name'), ['SUNDAY']);
  } finally {
    x32.disconnect();
    mock.stop();
  }
});

test('saveToConsoleScene: 사용 중인 슬롯은 건너뛰고 다음 빈 번호에 저장', async () => {
  const mock = new MockX32();
  const port = await mock.start();
  // 0, 1번 슬롯은 이미 사용 중이라고 가정
  mock.set('/-show/showfile/scene/000/hasdata', [1]);
  mock.set('/-show/showfile/scene/000/name', ['FOH BASE']);
  mock.set('/-show/showfile/scene/001/hasdata', [1]);
  mock.set('/-show/showfile/scene/001/name', ['EASTER']);
  const x32 = new X32Manager();
  try {
    await x32.connect('127.0.0.1', port);
    const r = await x32.saveToConsoleScene({ name: 'APP-0703' });
    assert.strictEqual(r.index, 2, '0·1 사용 중 → 2번에 저장');
    assert.deepStrictEqual(mock.get('/-show/showfile/scene/002/name'), ['APP-0703']);
    // 기존 슬롯은 덮어쓰지 않음
    assert.deepStrictEqual(mock.get('/-show/showfile/scene/000/name'), ['FOH BASE']);
  } finally {
    x32.disconnect();
    mock.stop();
  }
});

test('loadConsoleScene: /load "scene" idx 를 전송한다', async () => {
  const mock = new MockX32();
  const port = await mock.start();
  const x32 = new X32Manager();
  try {
    await x32.connect('127.0.0.1', port);
    x32.loadConsoleScene(7);
    await new Promise((r) => setTimeout(r, 120));
    assert.deepStrictEqual(mock.get('/load'), ['scene', 7]);
  } finally {
    x32.disconnect();
    mock.stop();
  }
});

test('saveToConsoleScene: 미연결 시 에러', async () => {
  const x32 = new X32Manager();
  await assert.rejects(() => x32.saveToConsoleScene(), /연결/);
});
