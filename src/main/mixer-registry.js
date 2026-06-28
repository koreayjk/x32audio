'use strict';

const { X32Manager } = require('./x32');
const { XAirAdapter } = require('./xair');

/**
 * 지원/예정 믹서 레지스트리.
 *
 * 새 브랜드를 추가하려면 어댑터(MixerAdapter 상속)를 만들고 여기에 한 줄 등록하면
 * 된다. status: 'supported'(바로 사용) | 'planned'(추후 지원) | 'guide'(아날로그 가이드).
 * make() 가 있는 항목만 실제로 인스턴스화할 수 있다.
 */
const MIXERS = [
  { id: 'x32', brand: 'Behringer / Midas', name: 'X32 / M32', status: 'supported', kind: 'digital', note: 'OSC로 직접 제어 · 모든 자동화 기능', make: () => new X32Manager() },
  { id: 'xair', brand: 'Behringer', name: 'X-Air (XR12/16/18)', status: 'supported', kind: 'digital', note: 'X32와 동일 계열 OSC (포트 10024) · 베타', make: () => new XAirAdapter() },
  { id: 'wing', brand: 'Behringer', name: 'Wing', status: 'planned', kind: 'digital', note: 'OSC(주소 체계 상이)' },
  { id: 'yamaha', brand: 'Yamaha', name: 'TF / CL / QL', status: 'planned', kind: 'digital', note: '자체 프로토콜' },
  { id: 'allenheath', brand: 'Allen & Heath', name: 'SQ / Avantis / dLive', status: 'planned', kind: 'digital', note: 'TCP 기반 자체 제어' },
  { id: 'presonus', brand: 'PreSonus', name: 'StudioLive', status: 'planned', kind: 'digital', note: 'UCNET' },
];

/** UI 로 보낼 메타 목록 (make 제외). */
function listMixers() {
  return MIXERS.map(({ make, ...m }) => ({ ...m, supported: !!make }));
}

/** id 로 믹서 어댑터 인스턴스를 생성. 지원되지 않으면 throw. */
function createMixer(id) {
  const m = MIXERS.find((x) => x.id === id);
  if (!m) throw new Error(`알 수 없는 믹서: ${id}`);
  if (!m.make) throw new Error(`'${m.name}'는 아직 지원 예정입니다.`);
  return m.make();
}

module.exports = { listMixers, createMixer };
