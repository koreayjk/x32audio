'use strict';

const { EventEmitter } = require('events');
const { OscBus } = require('./osc-bus');
const { FeedbackDetector } = require('./feedback');
const { FeedbackSuppressor } = require('./suppressor');
const { LoudnessController } = require('./loudness');
const { buildSceneActions, DEFAULT_CHANNEL_MAP } = require('./scenes');
const {
  DEFAULT_OUTPUTS, buildServiceStartActions, buildSermonBroadcastDuck,
} = require('./outputs');
const util = require('./x32-util');

const KEEPALIVE_MS = 8000;       // /xremote, 미터 재구독 주기 (X32 구독은 10초 후 만료)
const DEFAULT_METER_BANK = '/meters/15'; // RTA (피드백 감지에 사용)
const LOUDNESS_BANK = '/meters/5';       // 믹스 버스 미터 (방송 LUFS 측정에 사용)
const LOUDNESS_FRAMES_PER_TICK = 40;     // 약 2초마다 보정 (미터 ~50ms 가정)

/**
 * X32 미터/RTA 블롭 파싱.
 * X32 미터 블롭은 [int32 count][float32 × count] 의 "리틀 엔디안" 구조다.
 */
function parseMeterBlob(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return [];
  const count = buf.readInt32LE(0);
  const avail = Math.floor((buf.length - 4) / 4);
  const n = Math.max(0, Math.min(count, avail));
  const vals = new Array(n);
  for (let k = 0; k < n; k++) vals[k] = buf.readFloatLE(4 + k * 4);
  return vals;
}

/** 미터 원시값을 피드백 감지용 0..1 레벨로 정규화. (dB 또는 0..1 모두 처리) */
function normalizeSpectrum(vals) {
  if (vals.length === 0) return vals;
  let min = Infinity;
  for (const v of vals) if (v < min) min = v;
  const looksLikeDb = min < -1; // 음수가 크면 dB 로 간주
  return vals.map((v) => {
    if (looksLikeDb) return util.clamp((v + 90) / 90, 0, 1); // -90..0 dB → 0..1
    return util.clamp(v, 0, 1);
  });
}

class X32Manager extends EventEmitter {
  constructor() {
    super();
    this.bus = new OscBus();
    this.detector = new FeedbackDetector();
    this.suppressor = new FeedbackSuppressor((addr, args) => {
      if (this.bus.isOpen) this.bus.send(addr, args);
    });
    this.autoSuppress = false;
    this.connected = false;
    this.info = null;
    this.host = null;
    this.port = 10023;
    this.channelMap = DEFAULT_CHANNEL_MAP;
    this.meterBank = DEFAULT_METER_BANK;
    this.outputs = { ...DEFAULT_OUTPUTS };
    this.sermonDucked = false;
    this.loudness = new LoudnessController();
    this._loudActive = false;
    this._loudMasterDb = 0;
    this._loudFrames = 0;
    this._keepAlive = null;
    this._meterHandlers = new Map(); // bankPath -> (values:number[]) => void

    this.bus.on('message', (address, args) => this._onMessage(address, args));
    this.bus.on('error', (err) => this.emit('error', err));

    this.detector.on('feedback', (alert) => {
      if (this.autoSuppress) {
        const result = this.suppressor.suppress(alert.freq);
        if (result) this.emit('suppressed', result);
      }
      this.emit('feedback', alert);
    });
    this.detector.on('clear', (info) => this.emit('feedback-clear', info));
    this.suppressor.on('suppressed', (info) => this.emit('suppress-info', info));
  }

  /** X32 에 연결하고 정보를 확인한다. 실패 시 throw. */
  async connect(host, port = 10023) {
    this.disconnect();
    this.host = host;
    this.port = port;
    await this.bus.open(host, port, 0);

    // /xinfo 로 연결 확인 (응답 없으면 시간 초과)
    let info;
    try {
      const args = await this.bus.query('/xinfo', 2000);
      info = {
        ip: args[0],
        name: args[1],
        model: args[2],
        firmware: args[3],
      };
    } catch (err) {
      this.bus.close();
      throw new Error(`X32 응답이 없습니다 (${host}:${port}). IP와 네트워크를 확인하세요.`);
    }

    this.info = info;
    this.connected = true;
    this._startKeepAlive();
    this.emit('connected', info);
    return info;
  }

  disconnect() {
    this._stopKeepAlive();
    this.stopFeedback();
    this.stopBroadcastLoudness();
    this.sermonDucked = false;
    this.autoSuppress = false;
    this.suppressor.reset();
    if (this.bus.isOpen) this.bus.close();
    const was = this.connected;
    this.connected = false;
    this.info = null;
    if (was) this.emit('disconnected');
  }

  _startKeepAlive() {
    this._stopKeepAlive();
    const tick = () => {
      if (!this.bus.isOpen) return;
      try {
        this.bus.send('/xremote');           // 파라미터 변경 푸시 유지
        if (this._meterHandlers.size > 0) this._subscribeMeters();
      } catch (_) { /* ignore */ }
    };
    tick();
    this._keepAlive = setInterval(tick, KEEPALIVE_MS);
  }

  _stopKeepAlive() {
    if (this._keepAlive) {
      clearInterval(this._keepAlive);
      this._keepAlive = null;
    }
  }

  // ---- 채널 상태 읽기 ----

  /** 채널 한 개의 기본 스트립 상태를 읽는다. */
  async readChannelStrip(ch) {
    const id = util.chId(ch);
    const base = `/ch/${id}`;
    const [nameA, onA, faderA, eqOnA] = await Promise.all([
      this.bus.query(`${base}/config/name`).catch(() => [null]),
      this.bus.query(`${base}/mix/on`).catch(() => [null]),
      this.bus.query(`${base}/mix/fader`).catch(() => [null]),
      this.bus.query(`${base}/eq/on`).catch(() => [null]),
    ]);
    const fader = typeof faderA[0] === 'number' ? faderA[0] : null;
    const role = (this.channelMap.find((c) => c.ch === ch) || {}).name;
    return {
      ch,
      name: nameA[0] || role || `CH ${id}`,
      on: onA[0] === 1 || onA[0] === true,
      fader,
      db: fader == null ? null : util.faderToDb(fader),
      dbText: fader == null ? '—' : util.formatDb(util.faderToDb(fader)),
      eqOn: eqOnA[0] === 1 || eqOnA[0] === true,
    };
  }

  /** 채널의 4밴드 EQ 상태를 읽어 사람이 읽을 수 있는 값으로 변환한다. */
  async readChannelEq(ch) {
    const id = util.chId(ch);
    const base = `/ch/${id}/eq`;
    const eqOnA = await this.bus.query(`${base}/on`).catch(() => [null]);
    const bands = [];
    for (let b = 1; b <= 4; b++) {
      const [typeA, fA, gA, qA] = await Promise.all([
        this.bus.query(`${base}/${b}/type`).catch(() => [null]),
        this.bus.query(`${base}/${b}/f`).catch(() => [null]),
        this.bus.query(`${base}/${b}/g`).catch(() => [null]),
        this.bus.query(`${base}/${b}/q`).catch(() => [null]),
      ]);
      const fr = typeof fA[0] === 'number' ? fA[0] : null;
      const gn = typeof gA[0] === 'number' ? gA[0] : null;
      const qv = typeof qA[0] === 'number' ? qA[0] : null;
      bands.push({
        band: b,
        type: typeof typeA[0] === 'number' ? typeA[0] : null,
        hz: fr == null ? null : Math.round(util.eqFreqToHz(fr)),
        hzText: fr == null ? '—' : util.formatHz(util.eqFreqToHz(fr)),
        gainDb: gn == null ? null : Number(util.eqGainToDb(gn).toFixed(1)),
        q: qv == null ? null : Number(util.eqQToValue(qv).toFixed(2)),
      });
    }
    return { ch, eqOn: eqOnA[0] === 1 || eqOnA[0] === true, bands };
  }

  /** 여러 채널을 (과도한 트래픽을 피하려 소량 동시) 읽는다. */
  async readChannels(count = 16, onProgress) {
    const result = [];
    const CONCURRENCY = 4;
    for (let start = 1; start <= count; start += CONCURRENCY) {
      const batch = [];
      for (let ch = start; ch < start + CONCURRENCY && ch <= count; ch++) {
        batch.push(this.readChannelStrip(ch));
      }
      const strips = await Promise.all(batch);
      for (const s of strips) result.push(s);
      if (onProgress) onProgress(result.length, count);
    }
    return result;
  }

  // ---- 미터 구독 (다중 뱅크) ----

  _addMeterBank(bank, handler) {
    this._meterHandlers.set(bank, handler);
    this._subscribeMeters();
  }

  _removeMeterBank(bank) {
    this._meterHandlers.delete(bank);
  }

  _subscribeMeters() {
    if (!this.bus.isOpen) return;
    // /subscribe ,si "<bank>" <timefactor>  → X32 가 주기적으로 블롭 전송 (10초 후 만료)
    for (const bank of this._meterHandlers.keys()) {
      this.bus.send('/subscribe', [util.s(bank), util.i(1)]);
    }
  }

  _onMessage(address, args) {
    // 미터 블롭 → 해당 뱅크 핸들러로 라우팅
    const handler = this._meterHandlers.get(address);
    if (handler) {
      const blob = args[0];
      if (Buffer.isBuffer(blob)) {
        const raw = parseMeterBlob(blob);
        if (raw.length) handler(raw);
      }
      return;
    }
    // 그 외 파라미터 푸시 (xremote)
    this.emit('param', address, args);
  }

  // ---- 피드백 감지 ----

  startFeedback(options) {
    if (options) this.detector.setOptions(options);
    this.detector.reset();
    this._addMeterBank(this.meterBank, (raw) => {
      const spectrum = normalizeSpectrum(raw);
      this.detector.push(spectrum);
      this.emit('meters', spectrum);
    });
  }

  stopFeedback() {
    this._removeMeterBank(this.meterBank);
    this.detector.reset();
  }

  // ---- Scene 적용 ----

  /**
   * Scene 템플릿을 X32 에 적용한다.
   * @returns {number} 전송한 명령 개수
   */
  applyScene(sceneId) {
    if (!this.connected) throw new Error('연결되지 않았습니다.');
    const actions = buildSceneActions(sceneId, this.channelMap);
    for (const a of actions) {
      this.bus.send(a.address, a.args);
    }
    this.emit('scene-applied', { sceneId, count: actions.length });
    return actions.length;
  }

  // ---- 3개 출력 관리 (Main LR / 방송 Bus / 모니터 Bus) ----

  /** 예배 시작: 세 출력을 한 번에 세팅. */
  applyServiceStart() {
    if (!this.connected) throw new Error('연결되지 않았습니다.');
    const actions = buildServiceStartActions(this.channelMap, this.outputs);
    for (const a of actions) this.bus.send(a.address, a.args);
    this.sermonDucked = false;
    this.emit('service-started', { count: actions.length, outputs: this.outputs });
    return actions.length;
  }

  /** 설교 모드: 방송 버스에서 악기/반주 레벨을 자동으로 낮추거나 복원. */
  setSermonBroadcastDuck(on, duckDb) {
    if (!this.connected) throw new Error('연결되지 않았습니다.');
    const actions = buildSermonBroadcastDuck(this.channelMap, this.outputs, !!on, duckDb);
    for (const a of actions) this.bus.send(a.address, a.args);
    this.sermonDucked = !!on;
    this.emit('sermon-duck', { on: this.sermonDucked, count: actions.length });
    return actions.length;
  }

  /** 방송 버스 LUFS 자동 레벨 시작 (기본 목표 -14 LUFS). */
  async startBroadcastLoudness(opts = {}) {
    if (!this.connected) throw new Error('연결되지 않았습니다.');
    this.loudness.setTarget(opts.target ?? -14);
    if (opts.calibrationDb != null) this.loudness.calibrationDb = opts.calibrationDb;
    this.loudness.reset();
    this._loudFramesPerTick = opts.framesPerTick ?? LOUDNESS_FRAMES_PER_TICK;
    this._loudFrames = 0;

    // 현재 방송 버스 마스터 dB 로 초기화
    const faderAddr = `/bus/${util.chId(this.outputs.broadcastBus)}/mix/fader`;
    try {
      const a = await this.bus.query(faderAddr);
      this._loudMasterDb = typeof a[0] === 'number' ? util.faderToDb(a[0]) : 0;
    } catch (_) { this._loudMasterDb = 0; }

    this._loudActive = true;
    this._addMeterBank(LOUDNESS_BANK, (raw) => {
      const idx = this.outputs.broadcastBus - 1;
      const lvl = raw[idx] != null ? raw[idx] : 0;
      this.loudness.pushLevel(lvl < 0 ? Math.pow(10, lvl / 20) : lvl);
      if (++this._loudFrames >= this._loudFramesPerTick) {
        this._loudFrames = 0;
        const r = this.loudness.tick(this._loudMasterDb);
        if (r) {
          if (r.deltaDb !== 0) {
            this._loudMasterDb = r.newMasterDb;
            this.bus.send(faderAddr, [util.f(util.dbToFader(r.newMasterDb))]);
          }
          this.emit('loudness', {
            lufs: r.measuredLufs, masterDb: this._loudMasterDb, target: this.loudness.target,
          });
        }
      }
    });
    return true;
  }

  stopBroadcastLoudness() {
    this._loudActive = false;
    this._removeMeterBank(LOUDNESS_BANK);
    this.loudness.reset();
  }

  // ---- 사용자 정의 Scene (채널 on/fader 상태) ----

  /**
   * 현재 채널들의 on/fader 상태를 캡처한다. (사용자 정의 Scene 저장용)
   * @returns {Promise<Array<{ch,on,fader}>>}
   */
  async captureState(count = 16) {
    const strips = await this.readChannels(count);
    return strips.map((s) => ({ ch: s.ch, on: s.on, fader: s.fader }));
  }

  /** 단일 채널 페이더를 직접 제어한다 (앱 → 콘솔, 양방향). */
  setChannelFader(ch, fader) {
    if (!this.connected) throw new Error('연결되지 않았습니다.');
    this.bus.send(`/ch/${util.chId(ch)}/mix/fader`, [util.f(util.clamp(fader, 0, 1))]);
  }

  /** 단일 채널 음소거를 직접 제어한다. */
  setChannelMute(ch, on) {
    if (!this.connected) throw new Error('연결되지 않았습니다.');
    this.bus.send(`/ch/${util.chId(ch)}/mix/on`, [util.i(on ? 1 : 0)]);
  }

  /**
   * 캡처된 채널 상태를 X32 에 적용한다.
   * @param {Array<{ch,on,fader}>} states
   * @returns {number} 전송한 명령 개수
   */
  applyChannelStates(states) {
    if (!this.connected) throw new Error('연결되지 않았습니다.');
    let count = 0;
    for (const st of states || []) {
      const id = util.chId(st.ch);
      if (typeof st.on === 'boolean') {
        this.bus.send(`/ch/${id}/mix/on`, [util.i(st.on ? 1 : 0)]);
        count++;
      }
      if (typeof st.fader === 'number') {
        this.bus.send(`/ch/${id}/mix/fader`, [util.f(st.fader)]);
        count++;
      }
    }
    return count;
  }

  // ---- 인물별 마이크 프리셋 ----

  /**
   * 한 채널의 "소리" 설정(EQ 4밴드·로우컷·트림·페이더)을 원시값으로 캡처한다.
   * 사람별 마이크 프리셋 저장에 사용한다.
   */
  async captureChannelPreset(ch) {
    const id = util.chId(ch);
    const base = `/ch/${id}`;
    const num = (a) => (typeof a[0] === 'number' ? a[0] : null);

    const [eqOn, hpon, hpf, trim, fader] = await Promise.all([
      this.bus.query(`${base}/eq/on`).catch(() => [null]),
      this.bus.query(`${base}/preamp/hpon`).catch(() => [null]),
      this.bus.query(`${base}/preamp/hpf`).catch(() => [null]),
      this.bus.query(`${base}/preamp/trim`).catch(() => [null]),
      this.bus.query(`${base}/mix/fader`).catch(() => [null]),
    ]);
    const bands = [];
    for (let b = 1; b <= 4; b++) {
      const [type, f, g, q] = await Promise.all([
        this.bus.query(`${base}/eq/${b}/type`).catch(() => [null]),
        this.bus.query(`${base}/eq/${b}/f`).catch(() => [null]),
        this.bus.query(`${base}/eq/${b}/g`).catch(() => [null]),
        this.bus.query(`${base}/eq/${b}/q`).catch(() => [null]),
      ]);
      bands.push({ type: num(type), f: num(f), g: num(g), q: num(q) });
    }
    return {
      eqOn: eqOn[0] === 1 || eqOn[0] === true,
      hpon: hpon[0] === 1 || hpon[0] === true,
      hpf: num(hpf),
      trim: num(trim),
      fader: num(fader),
      bands,
    };
  }

  /**
   * 캡처된 채널 프리셋을 특정 채널에 적용한다.
   * @param {boolean} [withFader=false] 페이더까지 적용할지 (보통 EQ만 적용)
   * @returns {number} 전송한 명령 개수
   */
  applyChannelPreset(ch, preset, withFader = false) {
    if (!this.connected) throw new Error('연결되지 않았습니다.');
    if (!preset) return 0;
    const id = util.chId(ch);
    const base = `/ch/${id}`;
    let n = 0;
    const send = (addr, arg) => { this.bus.send(addr, [arg]); n++; };

    send(`${base}/eq/on`, util.i(preset.eqOn ? 1 : 0));
    (preset.bands || []).forEach((bd, idx) => {
      const b = idx + 1;
      if (bd.type != null) send(`${base}/eq/${b}/type`, util.i(bd.type));
      if (bd.f != null) send(`${base}/eq/${b}/f`, util.f(bd.f));
      if (bd.g != null) send(`${base}/eq/${b}/g`, util.f(bd.g));
      if (bd.q != null) send(`${base}/eq/${b}/q`, util.f(bd.q));
    });
    send(`${base}/preamp/hpon`, util.i(preset.hpon ? 1 : 0));
    if (preset.hpf != null) send(`${base}/preamp/hpf`, util.f(preset.hpf));
    if (preset.trim != null) send(`${base}/preamp/trim`, util.f(preset.trim));
    if (withFader && preset.fader != null) send(`${base}/mix/fader`, util.f(preset.fader));
    return n;
  }

  // ---- 자동 피드백 억제 ----

  setAutoSuppress(enabled, options) {
    if (options) this.suppressor.setOptions(options);
    this.autoSuppress = !!enabled;
    if (!enabled) this.suppressor.restoreAll();
    return this.autoSuppress;
  }
}

module.exports = { X32Manager, parseMeterBlob, normalizeSpectrum };
