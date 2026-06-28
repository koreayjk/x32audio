'use strict';

const { Server } = require('node-osc');

/**
 * 테스트용 가짜 X32 콘솔.
 *
 * 실제 X32 처럼 UDP 로 OSC 를 받고, 요청을 보낸 "출발 포트"로 응답한다.
 *  - /xinfo            → [ip, name, model, firmware]
 *  - /ch/CC/...        → 채널 파라미터 질의 시 저장된 값 응답
 *  - /subscribe        → 등록된 미터 뱅크를 주기적으로 블롭으로 전송
 *  - /xremote, /renew  → 무시(흡수)
 */
class MockX32 {
  constructor() {
    this.server = null;
    this.port = 0;
    this.params = new Map();
    this._meterTimer = null;
    this._meterTarget = null;     // { addr, port }
    this._spectrumProvider = null;
    this._seedDefaults();
  }

  _seedDefaults() {
    // 채널 1~32 기본값
    for (let ch = 1; ch <= 32; ch++) {
      const id = String(ch).padStart(2, '0');
      this.params.set(`/ch/${id}/config/name`, [`CH${id}`]);
      this.params.set(`/ch/${id}/mix/on`, [1]);
      this.params.set(`/ch/${id}/mix/fader`, [0.75]);
      this.params.set(`/ch/${id}/eq/on`, [1]);
      for (let b = 1; b <= 4; b++) {
        this.params.set(`/ch/${id}/eq/${b}/type`, [2]);
        this.params.set(`/ch/${id}/eq/${b}/f`, [0.5]);
        this.params.set(`/ch/${id}/eq/${b}/g`, [0.5]);
        this.params.set(`/ch/${id}/eq/${b}/q`, [0.5]);
      }
    }
    this.params.set('/xinfo', ['192.168.0.10', 'TestX32', 'X32RACK', '4.06']);
  }

  set(addr, args) { this.params.set(addr, args); }
  get(addr) { return this.params.get(addr); }

  /** 미터 구독 시 보낼 스펙트럼을 제공하는 함수 설정. () => number[] (0..1) */
  setSpectrumProvider(fn) { this._spectrumProvider = fn; }

  start() {
    return new Promise((resolve) => {
      this.server = new Server(0, '127.0.0.1', () => {
        this.port = this.server.port;
        resolve(this.port);
      });
      this.server.on('message', (msg, rinfo) => this._handle(msg, rinfo));
    });
  }

  _reply(addr, args, rinfo) {
    // 출발지(rinfo)로 응답
    this.server.send([addr, ...args], rinfo.port, rinfo.address);
  }

  _handle(msg, rinfo) {
    const addr = msg[0];
    if (addr === '/xremote' || addr === '/renew' || addr === '/unsubscribe') return;

    if (addr === '/subscribe') {
      const bank = msg[1];
      this._meterTarget = { addr: bank, port: rinfo.port, address: rinfo.address };
      this._startMeters();
      return;
    }

    // 설정(인자 포함) vs 질의(인자 없음)는 인자 개수로 구분한다.
    if (msg.length > 1) {
      this.params.set(addr, msg.slice(1)); // 설정
    } else if (this.params.has(addr)) {
      this._reply(addr, this.params.get(addr), rinfo); // 질의 → 저장값 응답
    }
  }

  _startMeters() {
    if (this._meterTimer) return;
    this._meterTimer = setInterval(() => {
      if (!this._meterTarget || !this._spectrumProvider) return;
      const spectrum = this._spectrumProvider();
      const buf = encodeMeterBlob(spectrum);
      // Buffer 인자는 node-osc 가 blob 으로 인코딩한다.
      this.server.send([this._meterTarget.addr, buf],
        this._meterTarget.port, this._meterTarget.address);
    }, 20);
  }

  stop() {
    if (this._meterTimer) { clearInterval(this._meterTimer); this._meterTimer = null; }
    if (this.server) {
      try { this.server.close(); } catch (_) { /* ignore */ }
      this.server = null;
    }
  }
}

/** 스펙트럼(0..1 배열) → X32 형식 미터 블롭 (리틀 엔디안 int32 count + float32×count). */
function encodeMeterBlob(spectrum) {
  const buf = Buffer.alloc(4 + spectrum.length * 4);
  buf.writeInt32LE(spectrum.length, 0);
  for (let k = 0; k < spectrum.length; k++) buf.writeFloatLE(spectrum[k], 4 + k * 4);
  return buf;
}

module.exports = { MockX32, encodeMeterBlob };
