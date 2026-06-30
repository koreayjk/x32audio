'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { detectRole, buildChannelMap } = require('../src/main/scenes');
const { MockX32 } = require('./mock-x32');
const { X32Manager } = require('../src/main/x32');

test('detectRole: 이름으로 역할 분류', () => {
  assert.strictEqual(detectRole('설교 마이크'), 'speech');
  assert.strictEqual(detectRole('목사님'), 'speech');
  assert.strictEqual(detectRole('찬양 리드'), 'vocal');
  assert.strictEqual(detectRole('보컬2'), 'vocal');
  assert.strictEqual(detectRole('어쿠스틱 기타'), 'inst');
  assert.strictEqual(detectRole('드럼 OH'), 'inst');
  assert.strictEqual(detectRole('반주(MR)'), 'playback');
  assert.strictEqual(detectRole('노트북'), 'playback');
  assert.strictEqual(detectRole('Lead Vocal'), 'vocal');
  assert.strictEqual(detectRole('Bass'), 'inst');
  // 이름 없거나 못 알아보면 null (기본 맵을 유지하도록)
  assert.strictEqual(detectRole(''), null);
  assert.strictEqual(detectRole(null), null);
  assert.strictEqual(detectRole('Aux 7'), null);
});

test('detectRole 우선순위: 반주 > 악기 > 찬양 > 설교', () => {
  assert.strictEqual(detectRole('찬양 반주'), 'playback'); // 반주 우선
  assert.strictEqual(detectRole('찬양 인도'), 'vocal');
});

test('buildChannelMap: 이름 있는 채널만, 역할 포함', () => {
  const map = buildChannelMap([
    { ch: 1, name: '설교 마이크' },
    { ch: 2, name: '' },
    { ch: 3, name: '찬양 리드' },
    { ch: 4, name: null },
  ]);
  assert.strictEqual(map.length, 2);
  assert.deepStrictEqual(map[0], { ch: 1, name: '설교 마이크', role: 'speech' });
  assert.deepStrictEqual(map[1], { ch: 3, name: '찬양 리드', role: 'vocal' });
});

test('연결 시 채널 이름으로 역할 자동 인식 (실 UDP)', async () => {
  const mock = new MockX32();
  const port = await mock.start();
  // 콘솔에 우리 교회식 이름 세팅 (기본 맵과 다른 배치)
  mock.set('/ch/01/config/name', ['키보드']);     // inst
  mock.set('/ch/02/config/name', ['담임목사']);   // speech
  mock.set('/ch/03/config/name', ['찬양 인도']);  // vocal
  mock.set('/ch/04/config/name', ['반주 노트북']); // playback
  for (let ch = 5; ch <= 32; ch++) mock.set(`/ch/${String(ch).padStart(2, '0')}/config/name`, ['']);
  const x32 = new X32Manager();
  const maps = [];
  x32.on('channelmap', (m) => maps.push(m));
  try {
    await x32.connect('127.0.0.1', port);
    await new Promise((r) => setTimeout(r, 250)); // 자동 인식 완료 대기
    const map = x32.channelMap;
    const byCh = Object.fromEntries(map.map((e) => [e.ch, e.role]));
    assert.strictEqual(byCh[1], 'inst');
    assert.strictEqual(byCh[2], 'speech');
    assert.strictEqual(byCh[3], 'vocal');
    assert.strictEqual(byCh[4], 'playback');
    assert.ok(maps.length >= 1, 'channelmap 이벤트 발생');
  } finally {
    x32.disconnect();
    mock.stop();
  }
});

test('자동 인식된 배치로 Scene 이 동작 (찬양팀: 담임목사 채널 음소거)', async () => {
  const mock = new MockX32();
  const port = await mock.start();
  mock.set('/ch/02/config/name', ['담임목사']);   // speech → ch2
  mock.set('/ch/03/config/name', ['찬양 인도']);  // vocal → ch3
  for (const ch of [1, 4, 5, 6, 7, 8, 9, 10]) mock.set(`/ch/${String(ch).padStart(2, '0')}/config/name`, ['']);
  const x32 = new X32Manager();
  try {
    await x32.connect('127.0.0.1', port);
    await new Promise((r) => setTimeout(r, 250));
    x32.applyScene('worship'); // 찬양팀: speech off, vocal on
    await new Promise((r) => setTimeout(r, 150));
    assert.deepStrictEqual(mock.get('/ch/02/mix/on'), [0], '담임목사(speech) 음소거');
    assert.deepStrictEqual(mock.get('/ch/03/mix/on'), [1], '찬양 인도(vocal) 켜짐');
  } finally {
    x32.disconnect();
    mock.stop();
  }
});