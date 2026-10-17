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

// ---------- 자동 사운드체크 세션 (믹서 없이 가짜 연주 신호로 검증) ----------
const {
  computeFaderTarget, SoundcheckSession, SOUNDCHECK_TARGETS,
} = require('../src/main/soundcheck');
const { MockX32 } = require('./mock-x32');
const { X32Manager } = require('../src/main/x32');

const lin = (db) => Math.pow(10, db / 20);
const tick = () => new Promise((r) => setImmediate(r));
const FAST = { windowFrames: 8, switchFrames: 3, quietResetFrames: 10, noDataMs: 50 };

const CHS = [
  { ch: 1, name: '설교 마이크', role: 'speech' },
  { ch: 2, name: '키보드', role: 'inst' },
  { ch: 3, name: '드럼', role: 'inst' },
];

function makeSession({ faders = {}, on = {}, options = {} } = {}) {
  const f = { 1: dbToFader(0), 2: dbToFader(0), 3: dbToFader(0), ...faders };
  const sets = [];
  const snaps = [];
  const io = {
    getFader: async (ch) => f[ch],
    isOn: async (ch) => (on[ch] === undefined ? true : on[ch]),
    setFader: (ch, v) => { f[ch] = v; sets.push([ch, v]); },
  };
  const s = new SoundcheckSession({ channels: CHS, io, emit: (x) => snaps.push(x), options: { ...FAST, ...options } });
  return { s, f, sets, snaps, last: () => snaps[snaps.length - 1] };
}

/** ch(1~3) 하나만 연주 중인 프레임을 n 번 밀어 넣는다. 잠금 직후엔 IO(await) 시간을 준다. */
async function play(s, ch, db, n) {
  for (let i = 0; i < n; i++) {
    const lv = [lin(-70), lin(-70), lin(-70)];
    lv[ch - 1] = lin(db);
    s.push(lv);
    if (i === FAST.switchFrames - 1) await tick();
  }
  await tick();
}

test('computeFaderTarget: pre-fader 측정 → 목표 페이더를 직접 계산하고 한 걸음씩 이동', () => {
  // 측정 -26, 목표 -20 → 페이더 +6 필요하지만 상한 +5(clamp). 현재 0dB, 스텝 4 → +4
  const r = computeFaderTarget(dbToFader(0), -26, -20, { stepDb: 4, maxFaderDb: 5 });
  assert.ok(Math.abs(r.nextDb - 4) < 0.2, `다음 ${r.nextDb}`);
  assert.strictEqual(r.done, false);
  // 측정 -30, 목표 -20 → +10 필요 > 상한(+5)+허용 → limit 'high'
  assert.strictEqual(computeFaderTarget(dbToFader(5), -30, -20).limit, 'high');
  // 측정이 너무 큼: -5 → 목표 -20 → -15 필요
  const loud = computeFaderTarget(dbToFader(0), -5, -20, { stepDb: 4 });
  assert.ok(loud.nextDb < 0 && loud.nextDb >= -4.2);
  // 이미 맞음
  assert.strictEqual(computeFaderTarget(dbToFader(2), -22, -20).done, true);
});

test('computeFaderTarget: post-fader 미터면 현재 페이더를 빼서 환산', () => {
  // 현재 페이더 +2dB, 측정(post) -18 → pre = -20 → 목표 -20 이면 페이더 0dB
  const r = computeFaderTarget(dbToFader(2), -18, -20, { meterPostFader: true, stepDb: 10 });
  assert.ok(Math.abs(r.desiredDb - 0) < 0.2, `desired ${r.desiredDb}`);
});

test('사운드체크: 연주하는 채널을 찾아 목표 음량에 맞추고 완료(✓) 표시', async () => {
  const { s, f, last } = makeSession();
  s.start();
  // 키보드(inst 목표 -20)가 -22dB 로 연주 → 페이더 +2dB 필요 (스텝 4 이내라 한 번에)
  await play(s, 2, -22, 40);
  const c = last().channels.find((x) => x.ch === 2);
  assert.strictEqual(c.status, 'done', `상태 ${c.status}`);
  assert.ok(Math.abs(faderToDb(f[2]) - 2) < 0.3, `페이더 ${faderToDb(f[2]).toFixed(1)}dB`);
  assert.ok(Math.abs(c.faderDb - 2) < 0.3);
  assert.strictEqual(c.startFaderDb, 0, '시작 값을 기억');
  assert.match(last().message, /완료/);
  // 연주하지 않은 채널은 건드리지 않음
  assert.strictEqual(f[1], dbToFader(0));
  assert.strictEqual(f[3], dbToFader(0));
});

test('사운드체크: 악기를 차례로 연주하면 각각 맞추고, 완료된 채널은 다시 건드리지 않음', async () => {
  const { s, f, sets, last } = makeSession();
  s.start();
  await play(s, 1, -10, 40);                 // 설교(speech -14): 4dB 내려야 함 → 한 번에 -4
  await play(s, 3, -26, 80);                 // 드럼(inst -20): +6 → 상한 +5 이내, 2번에 걸쳐
  const done = last().channels.filter((x) => x.status === 'done').map((x) => x.ch);
  assert.deepStrictEqual(done.sort(), [1, 3]);
  assert.ok(Math.abs(faderToDb(f[1]) - (-4)) < 0.3, `설교 ${faderToDb(f[1]).toFixed(1)}`);
  // 드럼은 +6 이 필요하지만 안전 상한이 +5: 한 번에 +4 로 올린 뒤, 상한과 허용오차(1.5dB) 이내라 완료
  assert.ok(Math.abs(faderToDb(f[3]) - 4) < 0.3, `드럼 ${faderToDb(f[3]).toFixed(1)}`);
  assert.ok(faderToDb(f[3]) <= 5.01, '안전 상한(+5dB) 초과 금지');
  // 설교 채널이 완료된 뒤 계속 말해도 추가 조정 없음
  const before = sets.length;
  await play(s, 1, -10, 40);
  assert.strictEqual(sets.length, before, '완료 채널 재조정 없음');
});

test('사운드체크: 음소거(MUTE) 채널은 건드리지 않고 이유를 알려줌', async () => {
  const { s, sets, last } = makeSession({ on: { 2: false } });
  s.start();
  await play(s, 2, -22, 40);
  assert.strictEqual(last().channels.find((x) => x.ch === 2).status, 'muted');
  assert.match(last().message, /음소거/);
  assert.strictEqual(sets.length, 0, '페이더를 움직이지 않음');
});

test('사운드체크: 페이더 한계에 걸리면 입력 게인 안내 (limit)', async () => {
  const { s, last } = makeSession({ faders: { 2: dbToFader(5) } });
  s.start();
  await play(s, 2, -40, 40); // -40 → +20 필요 > 상한
  const c = last().channels.find((x) => x.ch === 2);
  assert.strictEqual(c.status, 'limit');
  assert.strictEqual(c.limit, 'high');
  assert.match(last().message, /게인/);
});

test('사운드체크: 여러 채널이 비슷하게 크면 단독 아님 → 잠그지 않고 듣는 중', async () => {
  const { s, sets, last } = makeSession();
  s.start();
  for (let i = 0; i < 40; i++) s.push([lin(-20), lin(-21), lin(-70)]);
  await tick();
  assert.strictEqual(last().state, 'listening');
  assert.strictEqual(sets.length, 0);
});

test('사운드체크: 미터 신호가 안 오면 안내(nodata), 이후 신호 오면 복귀', async () => {
  let t = 0;
  const snaps = [];
  const s = new SoundcheckSession({
    channels: CHS, io: { getFader: async () => 0.75, isOn: async () => true, setFader() {} },
    emit: (x) => snaps.push(x), options: FAST, now: () => t,
  });
  s.start();
  t = 100; s.checkStale();
  assert.strictEqual(snaps[snaps.length - 1].state, 'nodata');
  s.push([lin(-70), lin(-70), lin(-70)]);
  assert.notStrictEqual(snaps[snaps.length - 1].state, 'nodata');
});

test('사운드체크: 종료 시 요약(맞춘 채널 수)을 돌려준다', async () => {
  const { s, last } = makeSession();
  s.start();
  await play(s, 2, -22, 40);
  const sum = s.stop();
  assert.strictEqual(sum.done, 1);
  assert.strictEqual(sum.results[0].name, '키보드');
  assert.match(last().message, /1개 채널/);
});

// ---------- 실 UDP: 가짜 X32 로 끝까지 ----------
test('사운드체크(실 UDP): 가짜 믹서에서 연주 신호 → 해당 채널 페이더가 실제로 바뀐다', async () => {
  const mock = new MockX32();
  const port = await mock.start();
  mock.set('/ch/03/mix/on', [1]);
  mock.set('/ch/03/mix/fader', [dbToFader(0)]);
  mock.set('/ch/01/mix/fader', [dbToFader(0)]);
  // CH3(보조 마이크, speech 목표 -14)가 -18dB 로 연주 중, 나머지는 무음. 앞 32개가 채널 미터.
  mock.setSpectrumProvider(() => {
    const a = new Array(96).fill(0.0001);
    a[2] = Math.pow(10, -18 / 20);
    return a;
  });
  const x32 = new X32Manager();
  const snaps = [];
  x32.on('soundcheck', (s) => snaps.push(s));
  try {
    await x32.connect('127.0.0.1', port);
    x32.startSoundcheck({ windowFrames: 8, switchFrames: 3, quietResetFrames: 50 });
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) {
      const s = snaps[snaps.length - 1];
      if (s && s.channels.find((c) => c.ch === 3 && c.status === 'done')) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const done = snaps[snaps.length - 1].channels.find((c) => c.ch === 3);
    assert.strictEqual(done.status, 'done', `상태 ${done.status}`);
    // -18 → 목표 -14 : 페이더 +4dB
    assert.ok(Math.abs(faderToDb(mock.get('/ch/03/mix/fader')[0]) - 4) < 0.5,
      `믹서의 CH3 페이더 ${faderToDb(mock.get('/ch/03/mix/fader')[0]).toFixed(1)}dB`);
    assert.ok(Math.abs(faderToDb(mock.get('/ch/01/mix/fader')[0])) < 0.2, 'CH1 은 그대로');
    const sum = x32.stopSoundcheck();
    assert.strictEqual(sum.done, 1);
  } finally {
    x32.disconnect();
    mock.stop();
  }
});

test('사운드체크: X-Air 는 미지원 안내, 미연결이면 에러', async () => {
  const { XAirAdapter } = require('../src/main/xair');
  const xa = new XAirAdapter();
  assert.throws(() => xa.startSoundcheck(), /연결/);
  const x32 = new X32Manager();
  assert.throws(() => x32.startSoundcheck(), /연결/);
});
