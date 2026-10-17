'use strict';

const { dbToFader, faderToDb, clamp } = require('./x32-util');

/**
 * 자동 사운드체크 로직 (순수 함수 — 테스트 가능).
 *
 * 리허설/예배 전 악기를 한 명씩 돌아가며 소리 낼 때, 미터(채널 레벨)를 보고
 *  1) 지금 "치고 있는" 채널을 찾아내고
 *  2) 그 채널의 페이더를 목표 레벨로 슬슬 맞춘다.
 *
 * 안전: 프리앰프 게인은 건드리지 않고 "페이더"만 조정한다(되돌리기·원본복구로 복구 가능).
 * 값은 실제 하드웨어에서 미세 조정이 필요할 수 있다(베타).
 */

/** 선형 미터값(0~1) → dBFS. */
function levelToDb(lin) {
  if (!(lin > 0.0000001)) return -90;
  return 20 * Math.log10(lin);
}

/**
 * 지금 단독으로 소리 나는(치는 중인) 채널 인덱스를 고른다.
 *  - 최고 레벨이 activeDb 이상이고
 *  - 2등보다 marginDb 이상 커야 "단독 활성"으로 인정 (동시에 여러 개면 -1)
 * @returns {number} 0-based 인덱스, 없으면 -1
 */
function pickActiveChannel(levelsLin, opts = {}) {
  const activeDb = opts.activeDb != null ? opts.activeDb : -45;
  const marginDb = opts.marginDb != null ? opts.marginDb : 8;
  let best = -1, bestDb = -Infinity, secondDb = -Infinity;
  for (let i = 0; i < levelsLin.length; i++) {
    const d = levelToDb(levelsLin[i]);
    if (d > bestDb) { secondDb = bestDb; bestDb = d; best = i; }
    else if (d > secondDb) { secondDb = d; }
  }
  if (bestDb < activeDb) return -1;
  if (bestDb - secondDb < marginDb) return -1;
  return best;
}

/**
 * 현재 페이더(0~1)와 측정 레벨(dB), 목표 레벨(dB)로 다음 페이더값을 계산한다.
 * 목표보다 작으면 올리고 크면 내리되, 한 틱에 stepDb 이내로만 움직여 부드럽게 수렴.
 * @returns {{nextFader:number, nextDb:number, done:boolean}}
 */
function computeFaderStep(currentFader, measuredDb, targetDb, opts = {}) {
  const stepDb = opts.stepDb != null ? opts.stepDb : 2;
  const tolDb = opts.tolDb != null ? opts.tolDb : 1.5;
  const minFaderDb = opts.minFaderDb != null ? opts.minFaderDb : -30;
  const maxFaderDb = opts.maxFaderDb != null ? opts.maxFaderDb : 10;
  const errDb = targetDb - measuredDb;               // +면 올려야 함
  const applyDb = clamp(errDb, -stepDb, stepDb);
  const curDb = faderToDb(currentFader);
  const nextDb = clamp(curDb + applyDb, minFaderDb, maxFaderDb);
  return { nextFader: dbToFader(nextDb), nextDb, done: Math.abs(errDb) <= tolDb };
}


/**
 * 역할별 목표 레벨(dBFS, 연주 중 "큰 소리" 기준). 믹서에서 페이더를 거친 뒤의 레벨 목표.
 * 시작값이다 — 실제 믹서·마이크로 들어보고 조정한다(베타).
 */
const SOUNDCHECK_TARGETS = { speech: -14, vocal: -16, inst: -20, playback: -20 };
const DEFAULT_TARGET_DB = -20;

const SC_DEFAULTS = {
  windowFrames: 30,   // 한 번 측정에 모으는 프레임 수 (미터 ~50ms/프레임 → 약 1.5초)
  switchFrames: 6,    // 다른 채널로 넘어가려면 연속으로 이만큼 "단독 활성"이어야 함
  quietResetFrames: 60, // 이만큼(약 3초) 조용하면 "듣는 중"으로 복귀
  maxTries: 8,        // 채널당 최대 조정 횟수
  stepDb: 4,          // 한 번에 움직이는 최대 페이더 변화
  tolDb: 1.5,         // 목표와 이 이내면 "맞음"
  minFaderDb: -30,
  maxFaderDb: 5,      // 안전상 +10 이 아니라 +5 까지만
  activeDb: -45,
  marginDb: 8,
  meterPostFader: false, // 미터가 페이더 "뒤"의 레벨인지 (X32 채널 미터는 앞(pre)으로 가정)
  noDataMs: 3000,
};

function percentile(arr, p) {
  if (!arr.length) return -90;
  const a = arr.slice().sort((x, y) => x - y);
  const i = Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)));
  return a[i];
}

/**
 * 측정 레벨로 "이 채널 페이더가 몇 dB 이어야 하는지" 를 구해 한 걸음(stepDb 이내) 이동시킨다.
 *  - 미터가 페이더 앞(pre)이면 페이더를 바꿔도 측정값이 안 변하므로, 목표 페이더를 직접 계산한다.
 *  - 미터가 페이더 뒤(post)이면 현재 페이더를 빼서 pre 레벨로 환산한다.
 * @returns {{nextFader:number,nextDb:number,desiredDb:number,done:boolean,limit:('high'|'low'|null)}}
 *   limit: 목표에 도달하려면 페이더 한계를 넘어야 하는 경우 ('high'=더 못 올림, 'low'=더 못 내림)
 */
function computeFaderTarget(currentFader, measuredDb, targetDb, opts = {}) {
  const o = { ...SC_DEFAULTS, ...opts };
  const curDb = Math.max(faderToDb(currentFader), o.minFaderDb - 30); // -oo 방지
  const preDb = o.meterPostFader ? measuredDb - curDb : measuredDb;
  const rawDesired = targetDb - preDb;
  const desiredDb = clamp(rawDesired, o.minFaderDb, o.maxFaderDb);
  const err = desiredDb - curDb;
  const nextDb = clamp(curDb + clamp(err, -o.stepDb, o.stepDb), o.minFaderDb, o.maxFaderDb);
  let limit = null;
  if (rawDesired > o.maxFaderDb + o.tolDb) limit = 'high';
  else if (rawDesired < o.minFaderDb - o.tolDb) limit = 'low';
  return { nextFader: dbToFader(nextDb), nextDb, desiredDb, done: Math.abs(err) <= o.tolDb, limit };
}

/**
 * 자동 사운드체크 세션 (믹서·네트워크와 무관한 순수 로직 — IO 는 주입).
 *
 * 미터 프레임(채널별 선형 레벨 배열, 인덱스 = 채널번호-1)을 push() 하면,
 *  1) 단독으로 소리 나는 채널을 찾아 "잠그고"
 *  2) 약 1.5초 모아 측정 → 목표 페이더를 계산해 한 걸음씩 이동 → 목표에 맞으면 완료(✓)
 *  3) 음소거 채널/페이더 한계/읽기 실패는 건드리지 않고 이유를 알려준다.
 * 상태가 바뀔 때마다 emit(snapshot) 으로 화면용 요약을 내보낸다.
 *
 * io: { getFader(ch)=>Promise<0..1|null>, isOn(ch)=>Promise<boolean|null>, setFader(ch, 0..1) }
 */
class SoundcheckSession {
  constructor({ channels, io, emit, options = {}, now = () => Date.now() }) {
    this.o = { ...SC_DEFAULTS, ...options };
    this.io = io;
    this._emit = emit || (() => {});
    this.now = now;
    this.chs = channels.map((c) => ({
      ch: c.ch, name: c.name || `CH${c.ch}`, role: c.role,
      status: 'waiting', // waiting | measuring | done | limit | muted | error
      measuredDb: null, targetDb: SOUNDCHECK_TARGETS[c.role] ?? DEFAULT_TARGET_DB,
      startFaderDb: null, faderDb: null, tries: 0, limit: null,
    }));
    this.faders = new Map();
    this.running = false;
    this.frames = 0;
    this.cur = -1;          // 잠긴(작업 중) 채널 인덱스
    this.candIdx = -1;      // 잠금 후보
    this.candCount = 0;
    this.quiet = 0;
    this.window = [];
    this.pending = false;
    this.nodata = false;
    this.startedAt = 0;
    this.message = '';
    this._sinceEmit = 0;
  }

  start() {
    this.running = true;
    this.startedAt = this.now();
    this.frames = 0;
    this._setMessage('listening');
    this._emitSnap();
  }

  stop() {
    this.running = false;
    this.cur = -1;
    const done = this.chs.filter((c) => c.status === 'done').length;
    this.message = done > 0 ? `✅ 사운드체크 끝 — ${done}개 채널을 맞췄어요.` : '사운드체크를 끝냈어요.';
    const snap = this.snapshot();
    snap.running = false;
    snap.summary = {
      done,
      total: this.chs.filter((c) => c.status !== 'waiting').length,
      results: this.chs.filter((c) => c.status !== 'waiting').map((c) => ({
        ch: c.ch, name: c.name, status: c.status, startFaderDb: c.startFaderDb, faderDb: c.faderDb,
      })),
    };
    this._emit(snap);
    return snap.summary;
  }

  /** 일정 시간 프레임이 하나도 안 오면 "신호 없음" 안내. (1초마다 호출) */
  checkStale() {
    if (!this.running || this.frames > 0 || this.nodata) return;
    if (this.now() - this.startedAt >= this.o.noDataMs) {
      this.nodata = true;
      this._setMessage('nodata');
      this._emitSnap();
    }
  }

  _levelsFor(levels) { return this.chs.map((c) => levels[c.ch - 1] || 0); }

  push(levels) {
    if (!this.running) return;
    this.frames++;
    if (this.nodata) { this.nodata = false; this._setMessage(this.cur >= 0 ? 'measuring' : 'listening'); this._emitSnap(); }
    const arr = this._levelsFor(levels);
    const idx = pickActiveChannel(arr, this.o);

    if (idx === -1) {
      if (++this.quiet >= this.o.quietResetFrames && this.cur !== -1) this._release();
      return;
    }
    this.quiet = 0;

    if (idx !== this.cur) {
      this.candCount = this.candIdx === idx ? this.candCount + 1 : 1;
      this.candIdx = idx;
      if (this.candCount < this.o.switchFrames) return;
      this._lock(idx);
      return;
    }
    this.candIdx = -1; this.candCount = 0;

    const c = this.chs[idx];
    if (c.status !== 'measuring' || this.pending) return;
    this.window.push(levelToDb(arr[idx]));
    if (this.window.length >= this.o.windowFrames) this._evaluate(idx);
    else if (++this._sinceEmit >= 10) { this._sinceEmit = 0; this._emitSnap(); }
  }

  _release() {
    this.cur = -1; this.window = []; this.candIdx = -1; this.candCount = 0;
    this._setMessage('listening');
    this._emitSnap();
  }

  _lock(idx) {
    this.cur = idx; this.window = []; this.candIdx = -1; this.candCount = 0; this._sinceEmit = 0;
    const c = this.chs[idx];
    if (c.status === 'muted' || c.status === 'error') c.status = 'waiting'; // 다시 확인
    if (c.status === 'done' || c.status === 'limit') {
      this._setMessage('settled', c);
      this._emitSnap();
      return;
    }
    c.status = 'measuring';
    this.pending = true;
    this._setMessage('measuring', c);
    this._emitSnap();
    Promise.all([
      Promise.resolve(this.io.isOn(c.ch)).catch(() => null),
      Promise.resolve(this.io.getFader(c.ch)).catch(() => null),
    ]).then(([on, fader]) => {
      this.pending = false;
      if (!this.running || this.cur !== idx) return;
      if (on === false) { c.status = 'muted'; this._setMessage('muted', c); this._emitSnap(); return; }
      if (typeof fader !== 'number') { c.status = 'error'; this._setMessage('error', c); this._emitSnap(); return; }
      this.faders.set(c.ch, fader);
      if (c.startFaderDb == null) c.startFaderDb = round1(faderDbSafe(fader));
      c.faderDb = round1(faderDbSafe(fader));
      this.window = [];
      this._emitSnap();
    }).catch(() => { this.pending = false; });
  }

  _evaluate(idx) {
    const c = this.chs[idx];
    const db = percentile(this.window, 0.9);
    this.window = [];
    const cur = this.faders.get(c.ch);
    const r = computeFaderTarget(cur, db, c.targetDb, this.o);
    c.measuredDb = round1(db);
    c.tries++;
    if (r.limit) {
      // 한계: 가능한 데까지 이동한 뒤 안내
      if (Math.abs(r.nextDb - faderDbSafe(cur)) > 0.05) this._apply(c, r);
      c.status = 'limit'; c.limit = r.limit;
      this._setMessage('limit', c);
    } else if (r.done) {
      c.status = 'done';
      this._setMessage('settled', c);
    } else if (c.tries >= this.o.maxTries) {
      this._apply(c, r);
      c.status = 'done';
      this._setMessage('settled', c);
    } else {
      this._apply(c, r);
      this._setMessage('measuring', c);
    }
    this._emitSnap();
  }

  _apply(c, r) {
    this.io.setFader(c.ch, r.nextFader);
    this.faders.set(c.ch, r.nextFader);
    c.faderDb = round1(r.nextDb);
  }

  _setMessage(kind, c) {
    const n = c ? `'${c.name}'` : '';
    const M = {
      listening: '🎧 듣는 중… 악기를 연주하거나 마이크에 말해 주세요.',
      measuring: `🎤 ${n} 소리를 듣고 음량을 맞추는 중…`,
      settled: `✓ ${n} 완료! 다음 악기를 소리 내 주세요.`,
      muted: `🔇 ${n} 채널이 음소거(MUTE) 상태예요. 믹서에서 음소거를 풀어 주세요.`,
      limit: c && c.limit === 'low'
        ? `⚠ ${n} 소리가 너무 커서 페이더를 더 못 내려요. 믹서의 입력 게인(GAIN)을 조금 낮춰 주세요.`
        : `⚠ ${n} 소리가 너무 작아 페이더를 더 못 올려요. 믹서의 입력 게인(GAIN)을 올리거나 마이크를 가까이 해 주세요.`,
      error: `⚠ ${n} 채널의 현재 페이더 값을 읽지 못했어요. 연결을 확인해 주세요.`,
      nodata: '⚠ 믹서에서 레벨 신호가 오지 않아요. 연결 상태를 확인해 주세요.',
    };
    this.message = M[kind] || '';
    this.kind = kind;
  }

  snapshot() {
    const cur = this.cur >= 0 ? this.chs[this.cur] : null;
    return {
      running: this.running,
      state: this.nodata ? 'nodata' : (cur ? (cur.status === 'measuring' ? 'measuring' : 'settled') : 'listening'),
      message: this.message,
      active: cur ? { ch: cur.ch, name: cur.name, role: cur.role } : null,
      progress: cur && cur.status === 'measuring' ? Math.min(1, this.window.length / this.o.windowFrames) : 0,
      channels: this.chs.map((c) => ({
        ch: c.ch, name: c.name, role: c.role, status: c.status, measuredDb: c.measuredDb,
        targetDb: c.targetDb, startFaderDb: c.startFaderDb, faderDb: c.faderDb, tries: c.tries, limit: c.limit,
      })),
    };
  }

  _emitSnap() { this._emit(this.snapshot()); }
}

function round1(x) { return Math.round(x * 10) / 10; }
/** 페이더 0(-oo)도 숫자로 (-90 dB 로 취급) — 화면/JSON 에 -Infinity 가 새지 않게. */
function faderDbSafe(f) { return Math.max(-90, faderToDb(f)); }

module.exports = {
  levelToDb, pickActiveChannel, computeFaderStep, computeFaderTarget, percentile,
  SoundcheckSession, SOUNDCHECK_TARGETS, SC_DEFAULTS,
};
