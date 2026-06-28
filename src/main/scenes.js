'use strict';

const { dbToFader, chId, f, i, s, clamp } = require('./x32-util');

/**
 * 교회용 기본 채널 배치(채널 맵).
 *
 * 교회마다 콘솔 채널 배치가 다르므로 이 맵을 수정해 사용한다.
 * role:
 *   'speech'   설교/사회 등 말소리 마이크 (로우컷 ON)
 *   'vocal'    찬양팀 보컬 (로우컷 ON)
 *   'inst'     악기
 *   'playback' 반주(MR)/노트북 오디오
 */
const DEFAULT_CHANNEL_MAP = [
  { ch: 1, name: '설교 마이크', role: 'speech' },
  { ch: 2, name: '사회자 마이크', role: 'speech' },
  { ch: 3, name: '보조 마이크', role: 'speech' },
  { ch: 4, name: '무선 핸드', role: 'speech' },
  { ch: 5, name: '찬양 리드', role: 'vocal' },
  { ch: 6, name: '찬양 보컬2', role: 'vocal' },
  { ch: 7, name: '찬양 보컬3', role: 'vocal' },
  { ch: 8, name: '찬양 보컬4', role: 'vocal' },
  { ch: 9, name: '어쿠스틱 기타', role: 'inst' },
  { ch: 10, name: '일렉 기타', role: 'inst' },
  { ch: 11, name: '베이스', role: 'inst' },
  { ch: 12, name: '키보드 L', role: 'inst' },
  { ch: 13, name: '키보드 R', role: 'inst' },
  { ch: 14, name: '드럼', role: 'inst' },
  { ch: 15, name: '반주(MR)', role: 'playback' },
  { ch: 16, name: '노트북', role: 'playback' },
];

/** HPF(로우컷) 주파수 Hz → X32 float(0..1). X32 HPF 범위 20~400Hz. */
function hpfHzToFloat(hz) {
  return clamp(Math.log10(hz / 20) / Math.log10(400 / 20), 0, 1);
}

/**
 * Scene 템플릿 정의.
 * targets: role 또는 ch 별 목표 상태 { on: boolean, db: number }
 *   db 가 null 이면 페이더는 건드리지 않는다.
 * 별도로 지정되지 않은(타깃 없는) 채널은 변경하지 않는다.
 */
const SCENES = [
  {
    id: 'setup',
    name: '기본 셋업 / 라벨',
    icon: '🎚️',
    description: '채널 이름표와 로우컷을 적용하고 모든 입력 페이더를 0dB(유니티)로 맞춥니다. 예배 시작 전에 한 번 적용하세요.',
    danger: false,
    labels: true,
    byRole: {
      speech: { on: true, db: 0 },
      vocal: { on: true, db: 0 },
      inst: { on: true, db: 0 },
      playback: { on: true, db: 0 },
    },
  },
  {
    id: 'sermon',
    name: '설교',
    icon: '🎤',
    description: '설교 마이크만 켜고 찬양팀/악기/반주는 음소거합니다.',
    byRole: {
      speech: { on: false, db: null },
      vocal: { on: false, db: null },
      inst: { on: false, db: null },
      playback: { on: false, db: null },
    },
    byCh: {
      1: { on: true, db: 0 }, // 설교 마이크
    },
  },
  {
    id: 'worship',
    name: '찬양팀',
    icon: '🎶',
    description: '찬양팀 보컬·악기·반주를 켜고 설교 마이크는 음소거합니다.',
    byRole: {
      speech: { on: false, db: null },
      vocal: { on: true, db: 0 },
      inst: { on: true, db: -3 },
      playback: { on: true, db: -3 },
    },
  },
  {
    id: 'prayer',
    name: '기도 / 묵상',
    icon: '🙏',
    description: '인도자 마이크만 작게 켜고 나머지는 음소거합니다.',
    byRole: {
      speech: { on: false, db: null },
      vocal: { on: false, db: null },
      inst: { on: false, db: null },
      playback: { on: false, db: null },
    },
    byCh: {
      1: { on: true, db: -6 }, // 설교/인도 마이크 낮게
    },
  },
  {
    id: 'announcement',
    name: '광고 / 안내',
    icon: '📢',
    description: '사회자 마이크만 켜고 나머지는 음소거합니다.',
    byRole: {
      speech: { on: false, db: null },
      vocal: { on: false, db: null },
      inst: { on: false, db: null },
      playback: { on: false, db: null },
    },
    byCh: {
      2: { on: true, db: 0 }, // 사회자 마이크
    },
  },
  {
    id: 'allmute',
    name: '전체 음소거',
    icon: '🔇',
    description: '모든 입력 채널을 즉시 음소거합니다. (피드백 발생 시 비상용)',
    danger: true,
    byRole: {
      speech: { on: false, db: null },
      vocal: { on: false, db: null },
      inst: { on: false, db: null },
      playback: { on: false, db: null },
    },
  },
];

/** 렌더러에 보낼 메타 정보 (actions 제외). */
function listScenes() {
  return SCENES.map(({ id, name, icon, description, danger }) => ({
    id,
    name,
    icon,
    description,
    danger: !!danger,
  }));
}

/**
 * Scene 의 OSC 적용 명령 목록을 생성한다.
 * @returns {Array<{address:string, args:Array}>}
 */
function buildSceneActions(sceneId, channelMap = DEFAULT_CHANNEL_MAP) {
  const scene = SCENES.find((s2) => s2.id === sceneId);
  if (!scene) throw new Error(`알 수 없는 Scene: ${sceneId}`);

  const actions = [];
  for (const entry of channelMap) {
    const id = chId(entry.ch);
    const base = `/ch/${id}`;

    // 채널별 우선, 없으면 역할별 타깃
    const target =
      (scene.byCh && scene.byCh[entry.ch]) ||
      (scene.byRole && scene.byRole[entry.role]) ||
      null;

    // 이름표 적용 (setup scene)
    if (scene.labels) {
      actions.push({ address: `${base}/config/name`, args: [s(entry.name)] });
      const lowcut = entry.role === 'speech' || entry.role === 'vocal';
      actions.push({ address: `${base}/preamp/hpon`, args: [i(lowcut ? 1 : 0)] });
      if (lowcut) {
        actions.push({ address: `${base}/preamp/hpf`, args: [f(hpfHzToFloat(100))] });
      }
    }

    if (!target) continue;

    if (typeof target.on === 'boolean') {
      actions.push({ address: `${base}/mix/on`, args: [i(target.on ? 1 : 0)] });
    }
    if (target.db != null) {
      actions.push({ address: `${base}/mix/fader`, args: [f(dbToFader(target.db))] });
    }
  }
  return actions;
}

module.exports = {
  DEFAULT_CHANNEL_MAP,
  SCENES,
  listScenes,
  buildSceneActions,
  hpfHzToFloat,
};
