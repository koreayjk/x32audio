'use strict';

const { X32Manager } = require('./x32');

/**
 * Behringer X‑Air (XR12 / XR16 / XR18, X18, Midas MR18) 어댑터.
 *
 * X‑Air 는 X32 와 거의 같은 OSC 프로토콜을 쓰므로 X32Manager 를 그대로 상속하고,
 * 다른 부분(주소 프로파일)만 교체한다.
 *
 *  - UDP 포트: 10024 (X32 는 10023)
 *  - 메인 출력: /lr/...        (X32 는 /main/st/...)
 *  - 버스 마스터: /bus/1..6    (X32 는 /bus/01..16, 2자리)
 *  - 입력 채널: /ch/01..16     (XR18 기준 16채널, 주소는 X32 와 동일)
 *
 * 채널/EQ/페이더/뮤트/Scene 주소는 X32 와 동일해 그대로 재사용된다.
 *
 * ⚠ 미터 뱅크 인덱스 등 일부 값은 펌웨어/모델에 따라 다를 수 있어, 실제 X‑Air
 *    하드웨어에서 한 번 확인하는 것을 권장한다.
 */
const XAIR_PROFILE = {
  id: 'xair',
  port: 10024,
  channelCount: 16,
  feedbackBank: '/meters/15',
  loudnessBank: '/meters/5',
  main: { fader: '/lr/mix/fader', on: '/lr/mix/on' },
  busPrefix: (bus) => `/bus/${bus}`, // X-Air: 1자리 (/bus/1 .. /bus/6)
};

class XAirAdapter extends X32Manager {
  static get meta() {
    return { id: 'xair', brand: 'Behringer', name: 'X-Air (XR12/16/18)', status: 'supported', kind: 'digital' };
  }

  constructor() {
    super(XAIR_PROFILE);
    // X-Air 는 보통 6개 버스 — 모니터 버스 기본값은 그대로 두되 범위 안에서 사용
  }
}

module.exports = { XAirAdapter, XAIR_PROFILE };
