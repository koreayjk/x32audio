'use strict';

const { EventEmitter } = require('events');
const { binToFreq } = require('./x32-util');

/**
 * 피드백(하울링) 감지기.
 *
 * 음향 피드백은 특정 주파수에서 좁고 날카로운 피크가 "지속적으로" 유지되거나
 * 커지는 형태로 나타난다. 이 감지기는 RTA/미터 스펙트럼 프레임을 연속으로 받아
 * 다음 조건을 모두 만족하는 bin 을 피드백 후보로 판정한다.
 *
 *   1) 절대 레벨이 임계치 이상 (충분히 큼)
 *   2) 주변(중앙값) 대비 두드러진 피크 (좁은 대역)
 *   3) 여러 프레임 연속 유지 (일시적 큰 소리가 아닌 지속음)
 *
 * 단위 테스트가 가능하도록 시간/타이머에 의존하지 않고, push(frame) 호출
 * 횟수로만 "지속" 을 판단한다.
 */
class FeedbackDetector extends EventEmitter {
  /**
   * @param {object} opts
   * @param {number} opts.levelThreshold   정규화 레벨(0..1) 절대 임계치 (기본 0.6)
   * @param {number} opts.peakRatio        중앙값 대비 피크 배수 (기본 2.5)
   * @param {number} opts.sustainFrames    피드백으로 확정할 연속 프레임 수 (기본 5)
   * @param {number} opts.releaseFrames    경보 해제까지 비활성 프레임 수 (기본 8)
   */
  constructor(opts = {}) {
    super();
    this.levelThreshold = opts.levelThreshold ?? 0.6;
    this.peakRatio = opts.peakRatio ?? 2.5;
    this.sustainFrames = opts.sustainFrames ?? 5;
    this.releaseFrames = opts.releaseFrames ?? 8;
    this._streak = new Map();   // binIndex -> 연속 감지 횟수
    this._active = new Map();   // binIndex -> { sinceMiss }
  }

  setOptions(opts = {}) {
    if (opts.levelThreshold != null) this.levelThreshold = opts.levelThreshold;
    if (opts.peakRatio != null) this.peakRatio = opts.peakRatio;
    if (opts.sustainFrames != null) this.sustainFrames = opts.sustainFrames;
    if (opts.releaseFrames != null) this.releaseFrames = opts.releaseFrames;
  }

  reset() {
    this._streak.clear();
    this._active.clear();
  }

  /**
   * 스펙트럼 한 프레임을 처리한다.
   * @param {number[]} spectrum 정규화된 레벨 배열(0..1), 길이 = bin 수
   * @returns {Array} 이번 프레임에서 새로 감지된 피드백 목록
   */
  push(spectrum) {
    if (!Array.isArray(spectrum) || spectrum.length === 0) return [];
    const n = spectrum.length;
    const median = this._median(spectrum);
    const detectedNow = new Set();
    const newAlerts = [];

    for (let idx = 0; idx < n; idx++) {
      const level = spectrum[idx];
      const isPeak =
        level >= this.levelThreshold &&
        level >= median * this.peakRatio &&
        this._isLocalMax(spectrum, idx);

      if (isPeak) {
        detectedNow.add(idx);
        const streak = (this._streak.get(idx) ?? 0) + 1;
        this._streak.set(idx, streak);

        if (streak >= this.sustainFrames && !this._active.has(idx)) {
          this._active.set(idx, { sinceMiss: 0 });
          const alert = {
            bin: idx,
            freq: Math.round(binToFreq(idx, n)),
            level,
          };
          newAlerts.push(alert);
          this.emit('feedback', alert);
        } else if (this._active.has(idx)) {
          this._active.get(idx).sinceMiss = 0;
        }
      }
    }

    // 이번 프레임에 안 잡힌 bin 정리 (streak 감소 / 경보 해제)
    for (const idx of [...this._streak.keys()]) {
      if (!detectedNow.has(idx)) {
        const v = this._streak.get(idx) - 1;
        if (v <= 0) this._streak.delete(idx);
        else this._streak.set(idx, v);
      }
    }
    for (const idx of [...this._active.keys()]) {
      if (!detectedNow.has(idx)) {
        const a = this._active.get(idx);
        a.sinceMiss += 1;
        if (a.sinceMiss >= this.releaseFrames) {
          this._active.delete(idx);
          this.emit('clear', { bin: idx, freq: Math.round(binToFreq(idx, spectrum.length)) });
        }
      }
    }

    return newAlerts;
  }

  /** 현재 활성 경보 중인 bin 목록. */
  activeAlerts(binCount) {
    return [...this._active.keys()].map((idx) => ({
      bin: idx,
      freq: Math.round(binToFreq(idx, binCount)),
    }));
  }

  _isLocalMax(arr, idx) {
    const left = idx > 0 ? arr[idx - 1] : -Infinity;
    const right = idx < arr.length - 1 ? arr[idx + 1] : -Infinity;
    return arr[idx] >= left && arr[idx] >= right;
  }

  _median(arr) {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }
}

module.exports = { FeedbackDetector };
