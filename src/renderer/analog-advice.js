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
  function turnWord(dir) { return dir === 'down' ? '왼쪽으로' : '오른쪽으로'; }
  function mk(knob, dir, amountDb, freq, status, text) {
    return { knob, dir, amount: Math.abs(amountDb) >= 5 ? 'big' : 'small', amountDb, freq, status, text };
  }

  function adviceFor(m) {
    // 1) 무음
    if (m.level < 0.02) {
      return { knob: null, dir: null, amount: null, amountDb: 0, freq: null, status: 'good',
        text: '소리가 거의 없습니다. 마이크에 대고 말하거나 연주해 보세요.' };
    }
    // 2) 입력 과다(찢어짐 위험) → GAIN ↓
    if (m.level > 0.45) {
      return mk('gain', 'down', -6, null, 'alarm',
        '🔴 소리가 너무 큽니다 — GAIN(게인) 노브를 왼쪽으로 많이 돌리세요 (약 -6dB).');
    }
    // 3) 하울링(피드백) → 해당 대역 EQ ↓
    if (m.feedback) {
      const knob = bandKnob(m.domHz);
      return mk(knob, 'down', -6, m.domHz, 'alarm',
        `⚠ 하울링(삐— 소리) 감지! 약 ${m.domHz}Hz — ${KNOB_KO[knob]} 노브를 왼쪽으로 조금 돌리세요 (약 -6dB).`);
    }
    // 4) 입력 과소 → GAIN ↑
    if (m.level < 0.06) {
      return mk('gain', 'up', 3, null, 'warn',
        '🔉 소리가 작습니다 — GAIN(게인) 노브를 오른쪽으로 조금 올리세요 (약 +3dB).');
    }
    // 5) 음색 균형 — 어느 대역이 센지 알려주고 그 노브를 줄이게
    if (m.lowProp > 0.55) {
      return mk('low', 'down', -3, 120, 'warn',
        '저음이 많아 웅웅거려요 — LOW(저음) 노브를 왼쪽으로 살짝 돌리세요 (약 -3dB).');
    }
    if (m.highProp > 0.45) {
      return mk('high', 'down', -3, (m.domHz >= 2000 ? m.domHz : 4000), 'warn',
        '고음이 날카로워요 — HIGH(고음) 노브를 왼쪽으로 살짝 돌리세요 (약 -3dB).');
    }
    if (m.midProp > 0.62) {
      return mk('mid', 'down', -3, 1000, 'warn',
        '중음이 답답해요(먹먹/콧소리) — MID(중음) 노브를 왼쪽으로 살짝 돌리세요 (약 -3dB).');
    }
    // 6) 양호
    return { knob: null, dir: null, amount: null, amountDb: 0, freq: null, status: 'good',
      text: '✓ 균형이 좋습니다. 지금 상태를 유지하세요.' };
  }

  return { analyze, adviceFor, bandKnob, turnWord, KNOB_KO };
});
