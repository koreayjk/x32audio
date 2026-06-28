'use strict';

const { EventEmitter } = require('events');
const { OscBus } = require('./osc-bus');
const { FeedbackDetector } = require('./feedback');
const { buildSceneActions, DEFAULT_CHANNEL_MAP } = require('./scenes');
const util = require('./x32-util');

const KEEPALIVE_MS = 8000;       // /xremote, 미터 재구독 주기 (X32 구독은 10초 후 만료)
const DEFAULT_METER_BANK = '/meters/15'; // RTA (피드백 감지에 사용)

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
    this.connected = false;
    this.info = null;
    this.host = null;
    this.port = 10023;
    this.channelMap = DEFAULT_CHANNEL_MAP;
    this.meterBank = DEFAULT_METER_BANK;
    this._keepAlive = null;
    this._metering = false;

    this.bus.on('message', (address, args) => this._onMessage(address, args));
    this.bus.on('error', (err) => this.emit('error', err));

    this.detector.on('feedback', (alert) => this.emit('feedback', alert));
    this.detector.on('clear', (info) => this.emit('feedback-clear', info));
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
        if (this._metering) this._subscribeMeters();
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

  // ---- 피드백 감지 ----

  startFeedback(options) {
    if (options) this.detector.setOptions(options);
    this.detector.reset();
    this._metering = true;
    this._subscribeMeters();
  }

  stopFeedback() {
    this._metering = false;
    this.detector.reset();
  }

  _subscribeMeters() {
    if (!this.bus.isOpen) return;
    // /subscribe ,si "<bank>" <timefactor>  → X32 가 주기적으로 블롭 전송 (10초 후 만료)
    this.bus.send('/subscribe', [util.s(this.meterBank), util.i(1)]);
  }

  _onMessage(address, args) {
    // 미터/RTA 블롭
    if (this._metering && address.indexOf('meters') !== -1) {
      const blob = args[0];
      if (Buffer.isBuffer(blob)) {
        const raw = parseMeterBlob(blob);
        if (raw.length) {
          const spectrum = normalizeSpectrum(raw);
          this.detector.push(spectrum);
          this.emit('meters', spectrum);
        }
      }
      return;
    }
    // 그 외 파라미터 푸시 (xremote)
    this.emit('param', address, args);
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
}

module.exports = { X32Manager, parseMeterBlob, normalizeSpectrum };
