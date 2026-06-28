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

function busAddr(bus) {
  return `/bus/${chId(bus)}`;
}

/**
 * 예배 시작: Main LR + 방송 Bus + 모니터 Bus 를 동시에 세팅하는 OSC 명령 목록.
 * @param {Array} channelMap [{ch,name,role}]
 * @param {object} outputs { broadcastBus, monitorBus }
 */
function buildServiceStartActions(channelMap, outputs = DEFAULT_OUTPUTS) {
  const { broadcastBus, monitorBus } = outputs;
  const actions = [];

  // 버스 마스터/메인 켜고 0dB
  actions.push({ address: '/main/st/mix/on', args: [i(1)] });
  actions.push({ address: '/main/st/mix/fader', args: [f(dbToFader(0))] });
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
function buildSermonBroadcastDuck(channelMap, outputs = DEFAULT_OUTPUTS, duck = true, duckDb = SERMON_DUCK_DB) {
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
  buildServiceStartActions,
  buildSermonBroadcastDuck,
};
