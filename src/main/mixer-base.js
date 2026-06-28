'use strict';

const { EventEmitter } = require('events');

/**
 * 믹서 어댑터 공통 인터페이스.
 *
 * 앱의 UI/자동화 로직은 이 계약(메서드)에만 의존한다. 브랜드(콘솔 계열)마다
 * 통신 프로토콜과 주소 체계가 다르므로, 새 믹서를 지원하려면 이 클래스를 상속해
 * 해당 콘솔에 맞게 메서드를 구현하면 된다. (예: X32Manager → X-Air/Wing/Yamaha…)
 *
 * 지원하지 않는 기능은 기본적으로 "지원하지 않음" 오류를 던지며,
 * `capabilities` 로 UI 가 어떤 기능을 켤지 판단할 수 있다.
 *
 * 공통 이벤트: connected, disconnected, error, param, feedback, feedback-clear,
 *             meters, suppressed, suppress-info, service-started, sermon-duck, loudness
 */
class MixerAdapter extends EventEmitter {
  constructor() {
    super();
    this.connected = false;
    this.info = null;
  }

  /** 어댑터 메타정보 (레지스트리/선택 화면용). 하위 클래스에서 재정의. */
  static get meta() {
    return { id: 'base', brand: '', name: 'Mixer', status: 'planned', kind: 'digital' };
  }

  /** 이 믹서가 제공하는 기능 플래그. 하위 클래스에서 재정의. */
  get capabilities() {
    return {
      read: false, faderControl: false, mute: false, scenes: false, presets: false,
      feedback: false, autoSuppress: false, outputs: false, loudness: false,
    };
  }

  _ns(feature) {
    const name = (this.constructor.meta && this.constructor.meta.name) || '이 믹서';
    throw new Error(`${name}에서는 '${feature}' 기능을 아직 지원하지 않습니다.`);
  }

  // 연결
  async connect() { this._ns('연결'); }
  disconnect() { /* no-op by default */ }

  // 읽기
  async readChannels() { this._ns('채널 읽기'); }
  async readChannelEq() { this._ns('EQ 읽기'); }
  async captureState() { this._ns('상태 캡처'); }
  async captureChannelPreset() { this._ns('프리셋 캡처'); }

  // 쓰기
  applyScene() { this._ns('Scene 적용'); }
  applyChannelStates() { this._ns('상태 적용'); }
  setChannelFader() { this._ns('페이더 제어'); }
  setChannelMute() { this._ns('음소거 제어'); }
  applyChannelPreset() { this._ns('프리셋 적용'); }

  // 피드백
  startFeedback() { this._ns('피드백 감지'); }
  stopFeedback() { /* no-op */ }
  setAutoSuppress() { this._ns('자동 피드백 억제'); }

  // 3개 출력 / 방송
  applyServiceStart() { this._ns('예배 시작'); }
  setSermonBroadcastDuck() { this._ns('설교 모드'); }
  async startBroadcastLoudness() { this._ns('방송 자동 레벨'); }
  stopBroadcastLoudness() { /* no-op */ }
}

module.exports = { MixerAdapter };
