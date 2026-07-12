'use strict';

const { dbToFader, chId, f, i, s } = require('./x32-util');

/**
 * X32 3개 출력(아웃풋) 분리 관리.
 *
 *  1) Main LR   — 본당 스피커용            (메인 스테레오)
 *  2) Bus 1     — 유튜브/방송용            (믹스 버스 1)
 *  3) Bus 2     — 찬양팀 모니터용          (믹스 버스 2)
 *
 * 각 출력은 채널마다 "보내는 레벨(send level)"이 다르다. 예를 들어 방송용에는
 * 말소리·보컬을 또렷하게, 모니터용에는 찬양팀이 듣고 싶은 악기/보컬을 크게 보낸다.
 *
 * 이 모듈은 순수 함수로 OSC 명령(주소+인자) 목록을 만들기만 한다. (테스트 가능)
 */

// 기본 버스 배정
const DEFAULT_OUTPUTS = {
  broadcastBus: 1, // Bus 1 = 방송(유튜브)
  monitorBus: 2,   // Bus 2 = 찬양팀 모니터
};

const OUTPUT_LABELS = {
  main: 'Main LR · 본당',
  broadcast: 'Bus 1 · 방송(유튜브)',
  monitor: 'Bus 2 · 찬양팀 모니터',
};

/**
 * 예배 시작 시 역할별 기본 보내기 레벨(dB).
 * (role: speech 설교/말, vocal 찬양보컬, inst 악기, playback 반주/노트북)
 */
const SERVICE_MIX = {
  main: { speech: 0, vocal: 0, inst: -3, playback: -3 },        // 본당
  broadcast: { speech: 0, vocal: -1, inst: -4, playback: -2 },  // 방송: 말/보컬 중심
  monitor: { speech: -6, vocal: 0, inst: -2, playback: -10 },   // 모니터: 찬양팀이 듣는 믹스
};

/** 설교 시 방송 버스에서 악기를 낮추는 기본 감쇠량(dB). */
const SERMON_DUCK_DB = -12;

/**
 * 방송(유튜브)에서 설교자 목소리가 작게 나가는 문제 해결 프리셋.
 * 설교(speech) 채널에 대해:
 *  - 방송 버스로 보내는 레벨을 기본보다 +boostDb 만큼 올림
 *  - 컴프레서(목소리 균일화)를 켜서 작게 말할 때도 또렷하게, 메이크업 게인으로
 *    전체 존재감을 끌어올림 → 유튜브에서 목소리가 파묻히지 않음
 *
 * X32 다이나믹스 정규화값(0~1) 및 열거 인덱스는 공식 OSC 매핑 기준.
 *   thr  -22dB → (−22+60)/60 = 0.633
 *   ratio 3:1 → 열거 인덱스 5 [1.1,1.3,1.5,2,2.5,3,4,5,7,10,20,100]
 *   mgain +6dB → 6/24 = 0.25
 *   att ~10ms(0..120) = 0.083, rel ~150ms(로그 5..4000) ≈ 0.51, knee 2/5 = 0.4
 */
const BROADCAST_VOICE = {
  boostDb: 4,
  comp: { mode: 0, det: 1, thr: 0.633, ratio: 5, mgain: 0.25, att: 0.083, rel: 0.51, knee: 0.4 },
};

/**
 * 방송 설교 목소리 강조: speech 채널의 방송 버스 send 를 키우고 컴프레서를 켠다.
 * @param {boolean} on  true=강조, false=원래(기본 send·컴프 off)로
 * @returns {{actions:Array, speechCount:number}}
 */
function buildBroadcastVoiceBoost(channelMap, outputs = DEFAULT_OUTPUTS, on = true, opts = {}, _profile = DEFAULT_PROFILE) {
  const bb = chId(outputs.broadcastBus);
  const boostDb = opts.boostDb != null ? opts.boostDb : BROADCAST_VOICE.boostDb;
  const c = BROADCAST_VOICE.comp;
  const actions = [];
  let speechCount = 0;
  for (const entry of channelMap) {
    if (entry.role !== 'speech') continue;
    speechCount++;
    const id = chId(entry.ch);
    const base = `/ch/${id}`;
    // 방송 버스 send 레벨 (기본 speech + boost, 끄면 기본으로)
    const baseDb = SERVICE_MIX.broadcast.speech ?? 0;
    const targetDb = on ? baseDb + boostDb : baseDb;
    actions.push({ address: `${base}/mix/${bb}/on`, args: [i(1)] });
    actions.push({ address: `${base}/mix/${bb}/level`, args: [f(dbToFader(targetDb))] });
    // 컴프레서
    actions.push({ address: `${base}/dyn/on`, args: [i(on ? 1 : 0)] });
    if (on) {
      actions.push({ address: `${base}/dyn/mode`, args: [i(c.mode)] });
      actions.push({ address: `${base}/dyn/det`, args: [i(c.det)] });
      actions.push({ address: `${base}/dyn/thr`, args: [f(c.thr)] });
      actions.push({ address: `${base}/dyn/ratio`, args: [i(c.ratio)] });
      actions.push({ address: `${base}/dyn/mgain`, args: [f(c.mgain)] });
      actions.push({ address: `${base}/dyn/att`, args: [f(c.att)] });
      actions.push({ address: `${base}/dyn/rel`, args: [f(c.rel)] });
      actions.push({ address: `${base}/dyn/knee`, args: [f(c.knee)] });
    }
  }
  return { actions, speechCount };
}

// 주소 프로파일 기본값(X32). X-Air 등은 어댑터가 다른 프로파일을 넘긴다.
const DEFAULT_PROFILE = {
  main: { fader: '/main/st/mix/fader', on: '/main/st/mix/on' },
  busPrefix: (bus) => `/bus/${chId(bus)}`,
};

/**
 * 예배 시작: Main LR + 방송 Bus + 모니터 Bus 를 동시에 세팅하는 OSC 명령 목록.
 * @param {Array} channelMap [{ch,name,role}]
 * @param {object} outputs { broadcastBus, monitorBus }
 */
function buildServiceStartActions(channelMap, outputs = DEFAULT_OUTPUTS, profile = DEFAULT_PROFILE) {
  const { broadcastBus, monitorBus } = outputs;
  const busAddr = profile.busPrefix;
  const actions = [];

  // 버스 마스터/메인 켜고 0dB
  actions.push({ address: profile.main.on, args: [i(1)] });
  actions.push({ address: profile.main.fader, args: [f(dbToFader(0))] });
  for (const bus of [broadcastBus, monitorBus]) {
    actions.push({ address: `${busAddr(bus)}/mix/on`, args: [i(1)] });
    actions.push({ address: `${busAddr(bus)}/mix/fader`, args: [f(dbToFader(0))] });
  }
  actions.push({ address: `${busAddr(broadcastBus)}/config/name`, args: [s('방송')] });
  actions.push({ address: `${busAddr(monitorBus)}/config/name`, args: [s('찬양모니터')] });

  for (const entry of channelMap) {
    const role = entry.role;
    const id = chId(entry.ch);
    const base = `/ch/${id}`;

    // Main LR
    actions.push({ address: `${base}/mix/on`, args: [i(1)] });
    actions.push({ address: `${base}/mix/fader`, args: [f(dbToFader(SERVICE_MIX.main[role] ?? -3))] });

    // 방송 버스 send
    const bb = chId(broadcastBus);
    actions.push({ address: `${base}/mix/${bb}/on`, args: [i(1)] });
    actions.push({ address: `${base}/mix/${bb}/level`, args: [f(dbToFader(SERVICE_MIX.broadcast[role] ?? -6))] });

    // 모니터 버스 send
    const mb = chId(monitorBus);
    actions.push({ address: `${base}/mix/${mb}/on`, args: [i(1)] });
    actions.push({ address: `${base}/mix/${mb}/level`, args: [f(dbToFader(SERVICE_MIX.monitor[role] ?? -10))] });
  }
  return actions;
}

/**
 * 설교 시간: 방송 버스에서 "악기"(inst)와 반주(playback) 레벨을 낮춘다.
 * (본당/모니터는 그대로 두어 찬양팀과 회중 경험은 유지)
 * @param {boolean} duck  true=낮춤, false=원래대로 복원
 */
function buildSermonBroadcastDuck(channelMap, outputs = DEFAULT_OUTPUTS, duck = true, duckDb = SERMON_DUCK_DB, _profile = DEFAULT_PROFILE) {
  const bb = chId(outputs.broadcastBus);
  const actions = [];
  for (const entry of channelMap) {
    if (entry.role !== 'inst' && entry.role !== 'playback') continue;
    const baseDb = SERVICE_MIX.broadcast[entry.role] ?? -6;
    const targetDb = duck ? baseDb + duckDb : baseDb;
    const id = chId(entry.ch);
    actions.push({ address: `/ch/${id}/mix/${bb}/level`, args: [f(dbToFader(targetDb))] });
  }
  return actions;
}

module.exports = {
  DEFAULT_OUTPUTS,
  OUTPUT_LABELS,
  SERVICE_MIX,
  SERMON_DUCK_DB,
  BROADCAST_VOICE,
  buildServiceStartActions,
  buildSermonBroadcastDuck,
  buildBroadcastVoiceBoost,
};
