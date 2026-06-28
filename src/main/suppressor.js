'use strict';

const { EventEmitter } = require('events');
const geq = require('./geq');
const { f } = require('./x32-util');

/**
 * 자동 피드백 억제기.
 *
 * 피드백이 확정된 주파수를 GEQ 밴드로 매핑해, 그 밴드의 게인을 단계적으로
 * 깎는다(노치). 같은 밴드가 계속 울면 한도(maxCutDb)까지 더 깎고,
 * 한도에 도달하면 멈춘다. stop() 시 건드린 밴드를 0dB 로 복원할 수 있다.
 *
 * 하드웨어를 직접 제어하지 않고, 생성자에 주입한 send(address, args) 로만
 * 명령을 보내므로 단위 테스트가 가능하다.
 */
class FeedbackSuppressor extends EventEmitter {
  /**
   * @param {(address:string, args:Array)=>void} send OSC 전송 함수
   * @param {object} opts
   * @param {number} opts.slot     GEQ 가 올라간 FX 슬롯 번호 (기본 1)
   * @param {number} opts.stepDb   한 번에 깎는 양 dB (기본 -3)
   * @param {number} opts.maxCutDb 밴드별 최대 감쇠 dB (기본 -12)
   */
  constructor(send, opts = {}) {
    super();
    this._send = send;
    this.slot = opts.slot ?? 1;
    this.stepDb = opts.stepDb ?? -3;
    this.maxCutDb = opts.maxCutDb ?? -12;
    this._cuts = new Map(); // bandIndex -> 현재 누적 cut(dB, 음수)
  }

  setOptions(opts = {}) {
    if (opts.slot != null) this.slot = opts.slot;
    if (opts.stepDb != null) this.stepDb = opts.stepDb;
    if (opts.maxCutDb != null) this.maxCutDb = opts.maxCutDb;
  }

  /**
   * 주어진 주파수에 대해 억제 1스텝을 적용한다.
   * @returns {object|null} 적용 정보 또는 (한도 도달로) 변화 없으면 null
   */
  suppress(freqHz) {
    const band = geq.bandIndexForFreq(freqHz);
    const prev = this._cuts.get(band) ?? 0;
    if (prev <= this.maxCutDb) {
      // 이미 한도까지 깎음 → 변화 없음
      return null;
    }
    const next = Math.max(this.maxCutDb, prev + this.stepDb);
    this._cuts.set(band, next);
    this._send(geq.parAddress(this.slot, band), [f(geq.geqGainToFloat(next))]);
    const info = {
      band,
      bandFreq: geq.GEQ_FREQS[band],
      cutDb: Number(next.toFixed(1)),
      atLimit: next <= this.maxCutDb,
    };
    this.emit('suppressed', info);
    return info;
  }

  /** 건드린 모든 밴드를 0dB 로 복원한다. */
  restoreAll() {
    for (const band of this._cuts.keys()) {
      this._send(geq.parAddress(this.slot, band), [f(geq.geqGainToFloat(0))]);
    }
    const restored = [...this._cuts.keys()];
    this._cuts.clear();
    if (restored.length) this.emit('restored', restored);
    return restored;
  }

  /** 현재 억제 중인 밴드 목록. */
  activeCuts() {
    return [...this._cuts.entries()].map(([band, cutDb]) => ({
      band,
      bandFreq: geq.GEQ_FREQS[band],
      cutDb: Number(cutDb.toFixed(1)),
    }));
  }

  reset() {
    this._cuts.clear();
  }
}

module.exports = { FeedbackSuppressor };
