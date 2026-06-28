/**
 * 아날로그 믹서 가이드 — 마이크 스펙트럼 분석 + 노브 조작 판정 (순수 로직).
 *
 * 컴퓨터 마이크로 받은 주파수 데이터를 분석해 "어떤 노브를 얼마나 돌려야 하는지"
 * 판정한다. DOM/오디오 API 에 의존하지 않으므로 Node 로 단위 테스트가 가능하다.
 *
 * UMD: 브라우저(window.AnalogAdvice) / Node(require) 양쪽에서 사용.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.AnalogAdvice = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * 주파수 데이터(0..255 크기 배열)를 분석해 지표를 만든다.
   * @param {ArrayLike<number>} freqData  AnalyserNode.getByteFrequencyData 결과(0..255)
   * @param {number} sampleRate           오디오 샘플레이트(Hz)
   */
  function analyze(freqData, sampleRate) {
    const bins = freqData.length;
    const nyquist = sampleRate / 2;
    const binHz = nyquist / bins;
    let low = 0, mid = 0, high = 0, lowN = 0, midN = 0, highN = 0;
    let total = 0, maxV = 0, maxI = 0;
    for (let i = 1; i < bins; i++) {
      const v = freqData[i];
      total += v;
      if (v > maxV) { maxV = v; maxI = i; }
      const hz = i * binHz;
      if (hz < 250) { low += v; lowN++; }
      else if (hz < 2000) { mid += v; midN++; }
      else { high += v; highN++; }
    }
    const avg = total / bins;
    const level = total / (bins * 255); // 0..1 대략적 입력량
    const domHz = Math.round(maxI * binHz);
    const peakRatio = maxV / (avg + 1e-6);
    const feedback = maxV > 200 && peakRatio > 6;
    // 밴드별 "평균 크기"로 비교 (밴드마다 bin 개수가 달라 합계는 편향됨)
    const lowAvg = lowN ? low / lowN : 0;
    const midAvg = midN ? mid / midN : 0;
    const highAvg = highN ? high / highN : 0;
    const sumAvg = lowAvg + midAvg + highAvg || 1;
    return {
      level, domHz, maxV, peakRatio, feedback,
      lowProp: lowAvg / sumAvg, midProp: midAvg / sumAvg, highProp: highAvg / sumAvg,
    };
  }

  /** 주파수(Hz) → 아날로그 EQ 노브 이름. */
  function bandKnob(hz) {
    if (hz < 250) return 'low';
    if (hz < 2000) return 'mid';
    return 'high';
  }

  const KNOB_KO = { gain: 'GAIN(게인)', high: 'HIGH(고음)', mid: 'MID(중음)', low: 'LOW(저음)' };

  /**
   * 지표로부터 조작 가이드를 만든다.
   * @returns {{knob,dir,amount,text,status}}
   *   knob: 돌릴 노브, dir: 'up'|'down'|null, amount: 'small'|'big', status: 'good'|'warn'|'alarm'
   */
  function adviceFor(m) {
    // 1) 무음
    if (m.level < 0.02) {
      return { knob: null, dir: null, amount: null, status: 'good', text: '소리가 거의 없습니다. 마이크에 대고 말하거나 연주해 보세요.' };
    }
    // 2) 입력 과다(클립 위험) → GAIN ↓
    if (m.level > 0.45) {
      return { knob: 'gain', dir: 'down', amount: 'big', status: 'alarm',
        text: '입력이 너무 큽니다. GAIN(게인) 노브를 왼쪽으로 크게 줄이세요.' };
    }
    // 3) 하울링(피드백) → 해당 대역 EQ ↓
    if (m.feedback) {
      const knob = bandKnob(m.domHz);
      return { knob, dir: 'down', amount: 'big', status: 'alarm',
        text: `⚠ 하울링 의심 (약 ${m.domHz}Hz). ${KNOB_KO[knob]} 노브를 왼쪽으로 줄이세요.` };
    }
    // 4) 입력 과소 → GAIN ↑
    if (m.level < 0.06) {
      return { knob: 'gain', dir: 'up', amount: 'small', status: 'warn',
        text: '입력이 작습니다. GAIN(게인) 노브를 오른쪽으로 조금 올리세요.' };
    }
    // 5) 음색 균형
    if (m.lowProp > 0.55) {
      return { knob: 'low', dir: 'down', amount: 'small', status: 'warn',
        text: '저음이 너무 많아 웅웅거립니다. LOW(저음) 노브를 살짝 줄이세요.' };
    }
    if (m.highProp > 0.45) {
      return { knob: 'high', dir: 'down', amount: 'small', status: 'warn',
        text: '고음이 날카롭습니다. HIGH(고음) 노브를 살짝 줄이세요.' };
    }
    if (m.midProp > 0.62) {
      return { knob: 'mid', dir: 'down', amount: 'small', status: 'warn',
        text: '중음이 답답합니다(먹먹/콧소리). MID(중음) 노브를 살짝 줄이세요.' };
    }
    // 6) 양호
    return { knob: null, dir: null, amount: null, status: 'good',
      text: '✓ 균형이 좋습니다. 지금 상태를 유지하세요.' };
  }

  return { analyze, adviceFor, bandKnob, KNOB_KO };
});
