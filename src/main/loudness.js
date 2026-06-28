'use strict';

const { clamp } = require('./x32-util');

/**
 * 방송 버스 라우드니스(LUFS) 자동 레벨 컨트롤러.
 *
 * 유튜브 등 방송 표준인 LUFS -14 에 맞춰 방송 버스 마스터 레벨을 천천히 보정한다.
 *
 * 참고: 정확한 LUFS 는 K-weighting + 게이팅이 필요하지만, 콘솔이 주는 미터 레벨만으로
 * 실시간 보정하기 위해 RMS 기반 근사(+보정 오프셋)를 사용한다. 하드웨어 없이도
 * 동작 검증이 가능하도록 시간/타이머 대신 pushLevel/tick 호출로만 동작한다.
 */
class LoudnessController {
  /**
   * @param {object} opts
   * @param {number} opts.target        목표 LUFS (기본 -14)
   * @param {number} opts.calibrationDb 미터→LUFS 보정 오프셋 (기본 0)
   * @param {number} opts.maxStepDb     한 번에 움직일 최대 dB (기본 1)
   * @param {number} opts.deadbandDb    이 범위 안이면 조정 안 함 (기본 1)
   * @param {number} opts.gateLevel     이보다 작은 신호는 무음으로 보고 무시 (0..1, 기본 0.002)
   * @param {number} opts.minMasterDb   마스터 하한 (기본 -20)
   * @param {number} opts.maxMasterDb   마스터 상한 (기본 +6)
   */
  constructor(opts = {}) {
    this.target = opts.target ?? -14;
    this.calibrationDb = opts.calibrationDb ?? 0;
    this.maxStepDb = opts.maxStepDb ?? 1;
    this.deadbandDb = opts.deadbandDb ?? 1;
    this.gateLevel = opts.gateLevel ?? 0.002;
    this.minMasterDb = opts.minMasterDb ?? -20;
    this.maxMasterDb = opts.maxMasterDb ?? 6;
    this.reset();
  }

  setTarget(lufs) { this.target = lufs; }

  reset() {
    this._sumSq = 0;
    this._count = 0;
  }

  /** 미터 레벨 한 샘플(0..1) 누적. 무음 게이트 이하이면 무시. */
  pushLevel(level01) {
    const v = clamp(level01, 0, 1);
    if (v < this.gateLevel) return;
    this._sumSq += v * v;
    this._count += 1;
  }

  /** 현재까지 누적된 라우드니스 추정값(LUFS) 또는 null(데이터 없음). */
  measure() {
    if (this._count === 0) return null;
    const rms = Math.sqrt(this._sumSq / this._count);
    if (rms <= 0) return null;
    return 20 * Math.log10(rms) + this.calibrationDb;
  }

  /**
   * 누적 데이터로 마스터 보정량을 계산하고 누적을 리셋한다.
   * @param {number} currentMasterDb 현재 방송 버스 마스터 dB
   * @returns {{measuredLufs:number,deltaDb:number,newMasterDb:number}|null}
   */
  tick(currentMasterDb) {
    const measured = this.measure();
    this.reset();
    if (measured == null) return null;

    let delta = this.target - measured;
    if (Math.abs(delta) < this.deadbandDb) delta = 0;
    delta = clamp(delta, -this.maxStepDb, this.maxStepDb);

    const newMasterDb = clamp(currentMasterDb + delta, this.minMasterDb, this.maxMasterDb);
    return {
      measuredLufs: Number(measured.toFixed(1)),
      deltaDb: Number((newMasterDb - currentMasterDb).toFixed(2)),
      newMasterDb: Number(newMasterDb.toFixed(2)),
    };
  }
}

module.exports = { LoudnessController };
