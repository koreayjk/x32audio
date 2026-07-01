'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { MockX32 } = require('./mock-x32');
const { X32Manager } = require('../src/main/x32');

test('discover: 응답한 콘솔의 IP/모델을 찾는다 (실 UDP)', async () => {
  const mock = new MockX32();
  const port = await mock.start();
  mock.set('/xinfo', ['192.168.0.10', 'TestX32', 'X32RACK', '4.06']);
  const x32 = new X32Manager();
  try {
    // 브로드캐스트 + 루프백 타깃으로 검색 (테스트 환경)
    const found = await x32.discover({ port, timeoutMs: 500, targets: ['127.0.0.1'] });
    const hit = found.find((f) => f.ip === '127.0.0.1');
    assert.ok(hit, '루프백 콘솔을 찾아야 함');
    assert.strictEqual(hit.name, 'TestX32');
    assert.strictEqual(hit.model, 'X32RACK');
  } finally {
    mock.stop();
  }
});

test('discover: 아무 콘솔도 없으면 빈 배열 (다른 네트워크 상황)', async () => {
  const x32 = new X32Manager();
  const found = await x32.discover({ port: 1, timeoutMs: 400, targets: [] });
  assert.deepStrictEqual(found, []);
});