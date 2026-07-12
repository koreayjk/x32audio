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

module.exports = { levelToDb, pickActiveChannel, computeFaderStep };
