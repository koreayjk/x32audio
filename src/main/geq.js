'use strict';

/**
 * X32 31밴드 그래픽 EQ(GEQ) 유틸리티.
 *
 * 자동 피드백 억제는 감지된 주파수를 가장 가까운 GEQ 밴드로 매핑한 뒤
 * 그 밴드의 게인을 조금 깎아(노치) 하울링을 줄인다.
 *
 * 사용 전제: X32 의 한 FX 슬롯에 GEQ(예: GEQ31)를 메인 L/R 인서트로 올려둔다.
 * GEQ 밴드 게인 OSC 주소: /fx/{slot}/par/{NN} (NN = 01..31), 값은 0..1 (0.5 = 0dB).
 */

// ISO 1/3 옥타브 31밴드 중심 주파수(Hz)
const GEQ_FREQS = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630,
  800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000,
  12500, 16000, 20000,
];

/** 주파수(Hz) → 가장 가까운 GEQ 밴드 인덱스(0..30), 로그 거리 기준. */
function bandIndexForFreq(hz) {
  if (!(hz > 0)) return 0;
  let best = 0;
  let bestDist = Infinity;
  for (let k = 0; k < GEQ_FREQS.length; k++) {
    const d = Math.abs(Math.log(hz) - Math.log(GEQ_FREQS[k]));
    if (d < bestDist) { bestDist = d; best = k; }
  }
  return best;
}

/** 밴드 인덱스(0..30) → OSC 파라미터 주소. */
function parAddress(slot, bandIndex) {
  const nn = String(bandIndex + 1).padStart(2, '0');
  return `/fx/${slot}/par/${nn}`;
}

/** GEQ 게인 dB(-15..+15) → float(0..1). */
function geqGainToFloat(db) {
  const clamped = Math.min(15, Math.max(-15, db));
  return (clamped + 15) / 30;
}

/** float(0..1) → GEQ 게인 dB. */
function geqFloatToGain(f) {
  return Math.min(1, Math.max(0, f)) * 30 - 15;
}

module.exports = {
  GEQ_FREQS,
  bandIndexForFreq,
  parAddress,
  geqGainToFloat,
  geqFloatToGain,
};
