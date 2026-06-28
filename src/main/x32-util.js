'use strict';

/**
 * X32 OSC 값 변환 유틸리티.
 *
 * X32는 대부분의 파라미터를 0.0 ~ 1.0 사이의 float 로 주고받는다.
 * 화면에 dB / Hz 같은 사람이 읽을 수 있는 단위로 보여주려면 변환이 필요하다.
 * (변환 공식은 Behringer X32 OSC 비공식 프로토콜 문서를 따른다.)
 *
 * 이 모듈은 순수 함수만 포함하므로 Electron 없이 단위 테스트가 가능하다.
 */

/** 숫자를 [min, max] 범위로 자른다. */
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 페이더 float(0..1) → dB.
 * X32 페이더는 -oo, -90dB ~ +10dB 구간을 4개 기울기로 나눠 매핑한다.
 */
function faderToDb(f) {
  f = clamp(f, 0, 1);
  if (f >= 0.5) return f * 40 - 30;       // -10 .. +10 dB
  if (f >= 0.25) return f * 80 - 50;      // -30 .. -10 dB
  if (f >= 0.0625) return f * 160 - 70;   // -60 .. -30 dB
  if (f > 0) return f * 480 - 90;         // -90 .. -60 dB
  return -Infinity;                       // 0.0 = -oo (완전 차단)
}

/** dB → 페이더 float(0..1). faderToDb 의 역함수. */
function dbToFader(db) {
  if (db <= -90 || db === -Infinity) return 0;
  let f;
  if (db >= -10) f = (db + 30) / 40;
  else if (db >= -30) f = (db + 50) / 80;
  else if (db >= -60) f = (db + 70) / 160;
  else f = (db + 90) / 480;
  return clamp(f, 0, 1);
}

/** dB 값을 사람이 읽기 좋은 문자열로 (예: "-oo", "+0.0", "-12.3"). */
function formatDb(db) {
  if (db === -Infinity || db <= -90) return '-∞';
  const sign = db > 0 ? '+' : '';
  return `${sign}${db.toFixed(1)}`;
}

/**
 * EQ 주파수 float(0..1) → Hz.
 * 20Hz ~ 20kHz 를 로그 스케일로 매핑한다: 20 * 10^(3f).
 */
function eqFreqToHz(f) {
  f = clamp(f, 0, 1);
  return 20 * Math.pow(10, f * 3);
}

/** EQ 주파수 Hz 를 보기 좋게 (예: "1.2k", "440"). */
function formatHz(hz) {
  if (hz >= 1000) return `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k`;
  return `${Math.round(hz)}`;
}

/** EQ 게인 float(0..1) → dB (-15 .. +15). */
function eqGainToDb(f) {
  return clamp(f, 0, 1) * 30 - 15;
}

/** EQ Q float(0..1) → Q 값 (10 .. 0.3, 로그 스케일). */
function eqQToValue(f) {
  f = clamp(f, 0, 1);
  // 10 (좁음) ~ 0.3 (넓음)
  return 10 * Math.pow(0.3 / 10, f);
}

/**
 * RTA / 미터 bin 인덱스 → 추정 주파수(Hz).
 * binCount 개의 bin 이 20Hz ~ 20kHz 를 로그로 덮는다고 가정한다.
 * (정확한 밴드 정의는 펌웨어마다 다를 수 있어 "추정" 값으로만 사용한다.)
 */
function binToFreq(index, binCount) {
  if (binCount <= 1) return 20;
  const ratio = clamp(index / (binCount - 1), 0, 1);
  return 20 * Math.pow(1000, ratio); // 20 * 1000^ratio = 20 .. 20000
}

/** 채널 번호(1..32) → "01".."32" 2자리 문자열. */
function chId(n) {
  return String(n).padStart(2, '0');
}

/** 명시적 float 타입 OSC 인자 (node-osc 가 1.0 을 int 로 인코딩하는 것을 방지). */
function f(value) {
  return { type: 'f', value };
}

/** 명시적 int 타입 OSC 인자. */
function i(value) {
  return { type: 'i', value: Math.round(value) };
}

/** 명시적 string 타입 OSC 인자. */
function s(value) {
  return { type: 's', value: String(value) };
}

module.exports = {
  clamp,
  faderToDb,
  dbToFader,
  formatDb,
  eqFreqToHz,
  formatHz,
  eqGainToDb,
  eqQToValue,
  binToFreq,
  chId,
  f,
  i,
  s,
};
