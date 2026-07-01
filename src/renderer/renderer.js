'use strict';

const api = window.x32api;

// 자동 인식된 역할 → 한글 라벨
const ROLE_KO = { speech: '설교', vocal: '찬양', inst: '악기', playback: '반주' };

// ---- DOM ----
const $ = (id) => document.getElementById(id);
const ipInput = $('ip');
const portInput = $('port');
const connectBtn = $('connectBtn');
const statusBadge = $('statusBadge');
const statusText = $('statusText');
const infoStrip = $('info');
const refreshBtn = $('refreshBtn');
const chCount = $('chCount');
const chBody = $('chBody');
const feedbackBtn = $('feedbackBtn');
const sensitivity = $('sensitivity');
const fbState = $('fbState');
const spectrumEl = $('spectrum');
const alertList = $('alertList');
const sceneList = $('sceneList');
const eqModal = $('eqModal');
const eqTitle = $('eqTitle');
const eqBody = $('eqBody');
const eqClose = $('eqClose');
const toast = $('toast');

let connected = false;
let feedbackOn = false;
let lastHost = null;
const activeAlerts = new Map(); // freq -> li element

// ---- 토스트 ----
let toastTimer = null;
function showToast(msg, kind = '') {
  toast.textContent = msg;
  toast.className = `toast ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
}

// ---- 연결 상태 UI ----
function setStatus(state, text) {
  statusBadge.className = `badge ${state}`;
  statusText.textContent = text;
}

function setConnected(info) {
  connected = true;
  setStatus('on', '연결됨');
  connectBtn.textContent = '연결 해제';
  refreshBtn.disabled = false;
  feedbackBtn.disabled = false;
  if (autoSuppress) autoSuppress.disabled = false;
  if (saveStateBtn) saveStateBtn.disabled = false;
  if (liveSync) liveSync.disabled = false;
  setServiceEnabled(true);
  updateCueButtons();
  updateUndo();
  applyI18n();
  if (info) {
    if (info.ip) lastHost = info.ip;
    infoStrip.classList.remove('hidden');
    infoStrip.innerHTML =
      `콘솔: <b>${esc(info.name || '-')}</b> · 모델: <b>${esc(info.model || '-')}</b> · ` +
      `펌웨어: <b>${esc(info.firmware || '-')}</b> · IP: <b>${esc(info.ip || '-')}</b>`;
  }
  updateOrigButton();
}

function setDisconnected() {
  connected = false;
  feedbackOn = false;
  setStatus('off', '연결 안 됨');
  connectBtn.textContent = '연결';
  refreshBtn.disabled = true;
  feedbackBtn.disabled = true;
  feedbackBtn.classList.remove('active');
  feedbackBtn.textContent = '감지 시작';
  fbState.textContent = '중지됨';
  fbState.classList.remove('alarm');
  infoStrip.classList.add('hidden');
  if (autoSuppress) { autoSuppress.checked = false; autoSuppress.disabled = true; }
  if (saveStateBtn) saveStateBtn.disabled = true;
  if (suppressInfo) { suppressInfo.textContent = ''; suppressInfo.classList.remove('active'); }
  if (liveSync) { liveSync.checked = false; liveSync.disabled = true; }
  setServiceEnabled(false);
  updateCueButtons();
  updateUndo();
  updateOrigButton();
  applyI18n();
}

function esc(str) {
  return String(str).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---- 연결 / 해제 ----
connectBtn.addEventListener('click', async () => {
  if (connected) {
    await api.disconnect();
    return;
  }
  const host = ipInput.value.trim();
  const port = parseInt(portInput.value, 10) || 10023;
  if (!host) return showToast('X32 IP 주소를 입력하세요.', 'err');

  setStatus('connecting', '연결 중…');
  connectBtn.disabled = true;
  try {
    const info = await api.connect(host, port);
    lastHost = (info && info.ip) || host;
    setConnected(info);
    showToast('X32 에 연결되었습니다.', 'ok');
    loadChannels().then(() => autoBackupOriginal(lastHost));
  } catch (err) {
    setDisconnected();
    showToast(errMsg(err), 'err');
  } finally {
    connectBtn.disabled = false;
  }
});

function errMsg(err) {
  const m = err && err.message ? err.message : String(err);
  return m.replace(/^Error:\s*/, '');
}

// ---- 채널 상태 ----
refreshBtn.addEventListener('click', loadChannels);

async function loadChannels() {
  if (!connected) return;
  refreshBtn.disabled = true;
  refreshBtn.textContent = '읽는 중…';
  chBody.innerHTML = '<tr class="empty"><td colspan="6">채널 상태를 읽는 중…</td></tr>';
  try {
    const count = parseInt(chCount.value, 10);
    const channels = await api.readChannels(count);
    renderChannels(channels);
  } catch (err) {
    showToast('채널 읽기 실패: ' + errMsg(err), 'err');
    chBody.innerHTML = '<tr class="empty"><td colspan="6">읽기에 실패했습니다.</td></tr>';
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = '상태 읽기';
  }
}

function renderChannels(channels) {
  if (!channels.length) {
    chBody.innerHTML = '<tr class="empty"><td colspan="6">채널이 없습니다.</td></tr>';
    return;
  }
  chBody.innerHTML = '';
  chRows.clear();
  for (const c of channels) {
    const row = document.createElement('tr');
    const faderVal = c.fader == null ? 0 : c.fader;
    const roleTag = c.role ? ` <span class="role-tag role-${c.role}">${ROLE_KO[c.role] || ''}</span>` : '';
    row.innerHTML =
      `<td>${String(c.ch).padStart(2, '0')}</td>` +
      `<td>${esc(c.name)}${roleTag}</td>` +
      `<td class="lvl"><input class="fader" type="range" min="0" max="1" step="0.001" value="${faderVal}"${c.fader == null ? ' disabled' : ''} /><span class="lvltext">${esc(c.dbText)} dB</span></td>` +
      `<td><span class="pill ${c.on ? 'on' : 'off'} mutebtn" role="button" title="클릭하여 음소거 전환">${c.on ? 'ON' : 'MUTE'}</span></td>` +
      `<td><span class="pill ${c.eqOn ? 'eq-on' : 'eq-off'}">${c.eqOn ? 'EQ' : 'OFF'}</span></td>` +
      `<td><button class="btn small ghost eqbtn">EQ 보기</button></td>`;
    chBody.appendChild(row);

    const slider = row.querySelector('.fader');
    const lvltext = row.querySelector('.lvltext');
    const pill = row.querySelector('.mutebtn');
    const ch = c.ch;
    chRows.set(ch, { tr: row, slider, lvltext, pill, data: c });

    // 앱 → 콘솔: 페이더 드래그
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      lvltext.textContent = `${faderToText(v)} dB`;
      queueFader(ch, v);
    });
    slider.addEventListener('pointerdown', () => draggingCh.add(ch));
    // 앱 → 콘솔: 음소거 토글
    pill.addEventListener('click', async () => {
      if (!connected) return;
      const newOn = pill.classList.contains('off');
      try {
        await api.setMute(ch, newOn);
        pill.className = `pill ${newOn ? 'on' : 'off'} mutebtn`;
        pill.textContent = newOn ? 'ON' : 'MUTE';
      } catch (err) { showToast(errMsg(err), 'err'); }
    });
    row.querySelector('.eqbtn').addEventListener('click', () => openEq(ch));
  }
}

// 페이더 드래그 → 콘솔 전송 (프레임당 1회로 합침)
const draggingCh = new Set();
const faderPending = new Map();
let faderRAF = null;
function queueFader(ch, val) {
  if (!connected) return;
  faderPending.set(ch, val);
  if (!faderRAF) faderRAF = requestAnimationFrame(flushFaders);
}
function flushFaders() {
  faderRAF = null;
  for (const [ch, val] of faderPending) api.setFader(ch, val).catch(() => {});
  faderPending.clear();
}
document.addEventListener('pointerup', () => draggingCh.clear());

// ---- EQ 상세 ----
async function openEq(ch) {
  currentEqCh = ch;
  eqTitle.textContent = `채널 ${String(ch).padStart(2, '0')} · EQ 상세`;
  eqBody.innerHTML = '<p class="muted">EQ 상태를 읽는 중…</p>';
  renderPresets();
  eqModal.classList.remove('hidden');
  try {
    const eq = await api.readEq(ch);
    let rows = eq.bands.map((b) =>
      `<tr><td>밴드 ${b.band}</td><td>${b.hzText} Hz</td>` +
      `<td>${b.gainDb == null ? '—' : (b.gainDb > 0 ? '+' : '') + b.gainDb} dB</td>` +
      `<td>Q ${b.q == null ? '—' : b.q}</td></tr>`).join('');
    eqBody.innerHTML =
      `<div class="eq-on-row">EQ: <span class="pill ${eq.eqOn ? 'eq-on' : 'eq-off'}">${eq.eqOn ? '켜짐' : '꺼짐'}</span></div>` +
      `<table class="eq-table"><thead><tr><th>밴드</th><th>주파수</th><th>게인</th><th>Q</th></tr></thead><tbody>${rows}</tbody></table>`;
  } catch (err) {
    eqBody.innerHTML = `<p class="muted">EQ 읽기 실패: ${esc(errMsg(err))}</p>`;
  }
}
eqClose.addEventListener('click', () => eqModal.classList.add('hidden'));
eqModal.addEventListener('click', (e) => { if (e.target === eqModal) eqModal.classList.add('hidden'); });

// ---- 피드백 감지 ----
feedbackBtn.addEventListener('click', async () => {
  if (!connected) return;
  if (feedbackOn) {
    await api.stopFeedback();
    feedbackOn = false;
    feedbackBtn.classList.remove('active');
    feedbackBtn.textContent = tr('startDetect');
    fbState.textContent = '중지됨';
    fbState.classList.remove('alarm');
    clearSpectrum();
  } else {
    await api.startFeedback(sensitivityOptions());
    feedbackOn = true;
    feedbackBtn.classList.add('active');
    feedbackBtn.textContent = tr('stopDetect');
    fbState.textContent = '감지 중…';
  }
});

sensitivity.addEventListener('input', () => {
  if (feedbackOn) api.startFeedback(sensitivityOptions());
});

// 민감도 슬라이더(1~10) → 감지 파라미터
function sensitivityOptions() {
  const s = parseInt(sensitivity.value, 10); // 1(둔감) ~ 10(민감)
  return {
    levelThreshold: 0.8 - s * 0.04,   // 0.76 ~ 0.40
    peakRatio: 3.5 - s * 0.15,        // 3.35 ~ 2.0
    sustainFrames: Math.max(3, 9 - s), // 8 ~ 3
  };
}

function clearSpectrum() {
  spectrumEl.innerHTML = '';
}

function renderSpectrum(spectrum) {
  // 막대가 너무 많으면 다운샘플
  const MAX_BARS = 60;
  const step = Math.max(1, Math.ceil(spectrum.length / MAX_BARS));
  if (spectrumEl.children.length !== Math.ceil(spectrum.length / step)) {
    spectrumEl.innerHTML = '';
    for (let k = 0; k < spectrum.length; k += step) {
      const bar = document.createElement('div');
      bar.className = 'bar';
      spectrumEl.appendChild(bar);
    }
  }
  let bi = 0;
  for (let k = 0; k < spectrum.length; k += step) {
    let v = 0;
    for (let j = k; j < k + step && j < spectrum.length; j++) v = Math.max(v, spectrum[j]);
    const bar = spectrumEl.children[bi++];
    if (!bar) break;
    bar.style.height = `${Math.round(v * 100)}%`;
    bar.classList.toggle('hot', v > 0.85);
  }
}

function addAlert(alert) {
  fbState.textContent = `⚠ 피드백 감지! ${alert.freq} Hz`;
  fbState.classList.add('alarm');
  if (alertList.querySelector('.empty')) alertList.innerHTML = '';
  if (activeAlerts.has(alert.freq)) return;
  const li = document.createElement('li');
  li.className = 'alert';
  li.innerHTML = `<span><b class="freq">${alert.freq} Hz</b> 부근 피드백 의심</span>` +
    `<span class="muted">해당 주파수 감쇠 권장</span>`;
  alertList.prepend(li);
  activeAlerts.set(alert.freq, li);
  showToast(`⚠ 피드백 감지: 약 ${alert.freq} Hz`, 'err');
}

function clearAlert(info) {
  const li = activeAlerts.get(info.freq);
  if (li) { li.remove(); activeAlerts.delete(info.freq); }
  if (activeAlerts.size === 0) {
    fbState.textContent = feedbackOn ? '감지 중…' : '중지됨';
    fbState.classList.remove('alarm');
    if (!alertList.children.length) {
      alertList.innerHTML = '<li class="muted empty">감지된 피드백이 없습니다.</li>';
    }
  }
}

// ---- Scene 템플릿 ----
async function loadScenes() {
  const scenes = await api.getScenes();
  templateScenes = scenes;
  sceneList.innerHTML = '';
  for (const sc of scenes) {
    const div = document.createElement('div');
    div.className = `scene${sc.danger ? ' danger' : ''}`;
    div.innerHTML =
      `<span class="ico">${sc.icon || '🎚️'}</span>` +
      `<div class="meta"><div class="name">${esc(sc.name)}</div>` +
      `<div class="desc">${esc(sc.description)}</div></div>`;
    div.addEventListener('click', () => applyScene(sc));
    sceneList.appendChild(div);
  }
  rebuildCueAddOptions();
}

async function applyScene(sc) {
  if (!connected) return showToast('먼저 X32 에 연결하세요.', 'err');
  const ok = confirm(`'${sc.name}' Scene 을 적용할까요?\n\n${sc.description}`);
  if (!ok) return;
  try {
    await snapshotForUndo();
    const count = await api.applyScene(sc.id);
    showToast(`'${sc.name}' 적용 완료 (${count}개 명령 전송)`, 'ok');
    setTimeout(loadChannels, 250); // 변경 반영 후 새로고침
  } catch (err) {
    showToast('Scene 적용 실패: ' + errMsg(err), 'err');
  }
}

// ---- main → renderer 이벤트 ----
api.on('connected', (info) => setConnected(info));
api.on('disconnected', () => { setDisconnected(); showToast('연결이 해제되었습니다.'); });
api.on('error', (msg) => showToast('오류: ' + msg, 'err'));
api.on('meters', (spectrum) => renderSpectrum(spectrum));
api.on('feedback', (alert) => addAlert(alert));
api.on('feedback-clear', (info) => clearAlert(info));
api.on('channelmap', (map) => {
  if (Array.isArray(map) && map.length) {
    showToast(`채널 이름으로 역할 자동 인식 (${map.length}개)`, 'ok');
    if (connected && chRows.size) loadChannels(); // 표가 떠있으면 역할 표시 갱신
  }
});

// ==== 자동 억제 · 사용자 정의 Scene · 예배 순서 큐 ====
const autoSuppress = $('autoSuppress');
const fxSlot = $('fxSlot');
const suppressInfo = $('suppressInfo');
const saveStateBtn = $('saveStateBtn');
const customList = $('customList');
const cueAdd = $('cueAdd');
const cueListEl = $('cueList');
const cuePrev = $('cuePrev');
const cueNext = $('cueNext');
const cueReset = $('cueReset');
const cuePos = $('cuePos');

const CUSTOM_KEY = 'x32_custom_scenes';
const CUE_KEY = 'x32_cue_list';

let templateScenes = [];
let customScenes = loadJson(CUSTOM_KEY, []); // [{id,name,states:[{ch,on,fader}]}]
let cue = loadJson(CUE_KEY, []);             // [{kind:'template'|'custom', id, name, icon}]
let cueIndex = -1;

function loadJson(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
  catch (_) { return fallback; }
}
function saveJson(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) { /* ignore */ } }
function uid() { return Math.random().toString(36).slice(2, 9); }

// ---- 자동 피드백 억제 ----
autoSuppress.addEventListener('change', async () => {
  const slot = parseInt(fxSlot.value, 10) || 1;
  try {
    await api.setAutoSuppress(autoSuppress.checked, { slot });
    if (autoSuppress.checked) {
      showToast('🛡️ 자동 억제 켜짐 — 피드백 시 해당 주파수를 자동 감쇠합니다.', 'ok');
    } else {
      showToast('자동 억제 꺼짐 — 감쇠했던 밴드를 0dB로 복원했습니다.');
      suppressInfo.textContent = '';
      suppressInfo.classList.remove('active');
    }
  } catch (err) { showToast(errMsg(err), 'err'); }
});
fxSlot.addEventListener('change', () => {
  if (autoSuppress.checked) api.setAutoSuppress(true, { slot: parseInt(fxSlot.value, 10) || 1 });
});
api.on('suppress-info', (info) => {
  const hz = info.bandFreq >= 1000 ? `${info.bandFreq / 1000}k` : info.bandFreq;
  suppressInfo.textContent = `🛡️ ${hz}Hz ${info.cutDb}dB 감쇠`;
  suppressInfo.classList.add('active');
});

// ---- 사용자 정의 Scene ----
saveStateBtn.addEventListener('click', async () => {
  if (!connected) return;
  const name = (prompt('저장할 Scene 이름을 입력하세요', '주일예배 1부') || '').trim();
  if (!name) return;
  saveStateBtn.disabled = true;
  saveStateBtn.textContent = '저장 중…';
  try {
    const count = parseInt(chCount.value, 10);
    const states = await api.captureState(count);
    customScenes.push({ id: uid(), name, states });
    saveJson(CUSTOM_KEY, customScenes);
    renderCustom();
    rebuildCueAddOptions();
    showToast(`'${name}' 저장 완료 (${states.length}개 채널)`, 'ok');
  } catch (err) {
    showToast('저장 실패: ' + errMsg(err), 'err');
  } finally {
    saveStateBtn.disabled = !connected;
    saveStateBtn.textContent = '💾 현재 상태 저장';
  }
});

function renderCustom() {
  if (!customScenes.length) {
    customList.innerHTML = '<div class="muted empty-cust">저장된 사용자 정의 Scene이 없습니다.</div>';
    return;
  }
  customList.innerHTML = '';
  for (const cs of customScenes) {
    const div = document.createElement('div');
    div.className = 'scene';
    div.innerHTML =
      `<span class="ico">💾</span><div class="meta"><div class="name">${esc(cs.name)}</div>` +
      `<div class="desc">${cs.states.length}개 채널 상태</div></div>`;
    const actions = document.createElement('div');
    actions.className = 'row-actions';
    const applyB = document.createElement('button');
    applyB.className = 'btn small';
    applyB.textContent = '적용';
    applyB.addEventListener('click', (e) => { e.stopPropagation(); applyCustom(cs); });
    const delB = document.createElement('button');
    delB.className = 'btn small ghost';
    delB.textContent = '삭제';
    delB.addEventListener('click', (e) => { e.stopPropagation(); deleteCustom(cs); });
    actions.append(applyB, delB);
    div.appendChild(actions);
    customList.appendChild(div);
  }
}

async function applyCustom(cs) {
  if (!connected) return showToast('먼저 X32에 연결하세요.', 'err');
  try {
    await snapshotForUndo();
    const n = await api.applyStates(cs.states);
    showToast(`'${cs.name}' 적용 (${n}개 명령)`, 'ok');
    setTimeout(loadChannels, 250);
  } catch (err) { showToast('적용 실패: ' + errMsg(err), 'err'); }
}

function deleteCustom(cs) {
  if (!confirm(`'${cs.name}' 을(를) 삭제할까요?`)) return;
  customScenes = customScenes.filter((x) => x.id !== cs.id);
  saveJson(CUSTOM_KEY, customScenes);
  cue = cue.filter((c) => !(c.kind === 'custom' && c.id === cs.id));
  saveJson(CUE_KEY, cue);
  if (cueIndex >= cue.length) cueIndex = cue.length - 1;
  renderCustom();
  renderCue();
  rebuildCueAddOptions();
}

// ---- 예배 순서 큐 ----
function rebuildCueAddOptions() {
  cueAdd.innerHTML = '<option value="">＋ 장면 추가…</option>';
  const og1 = document.createElement('optgroup');
  og1.label = '기본 템플릿';
  for (const s of templateScenes) {
    const o = document.createElement('option');
    o.value = 't:' + s.id;
    o.textContent = `${s.icon || ''} ${s.name}`;
    og1.appendChild(o);
  }
  cueAdd.appendChild(og1);
  if (customScenes.length) {
    const og2 = document.createElement('optgroup');
    og2.label = '사용자 정의';
    for (const c of customScenes) {
      const o = document.createElement('option');
      o.value = 'c:' + c.id;
      o.textContent = '💾 ' + c.name;
      og2.appendChild(o);
    }
    cueAdd.appendChild(og2);
  }
}

cueAdd.addEventListener('change', () => {
  const v = cueAdd.value;
  cueAdd.value = '';
  if (!v) return;
  const kind = v[0];
  const id = v.slice(2);
  if (kind === 't') {
    const s = templateScenes.find((x) => x.id === id);
    if (s) cue.push({ kind: 'template', id: s.id, name: s.name, icon: s.icon || '🎬' });
  } else {
    const c = customScenes.find((x) => x.id === id);
    if (c) cue.push({ kind: 'custom', id: c.id, name: c.name, icon: '💾' });
  }
  saveJson(CUE_KEY, cue);
  renderCue();
});

function renderCue() {
  if (!cue.length) {
    cueListEl.innerHTML =
      '<li class="empty muted">큐가 비어 있습니다. 위 <b>＋ 장면 추가</b>로 예배 순서를 만들어 보세요.</li>';
    updateCueButtons();
    return;
  }
  cueListEl.innerHTML = '';
  cue.forEach((c, idx) => {
    const li = document.createElement('li');
    li.className = 'cue-item' + (idx === cueIndex ? ' current' : '');
    li.innerHTML =
      `<span class="ico">${c.icon || '🎬'}</span>` +
      `<span class="cname">${esc(c.name)} <span class="ctag">${c.kind === 'custom' ? '사용자' : '템플릿'}</span></span>`;
    const btns = document.createElement('span');
    btns.className = 'cbtns';
    btns.append(
      mkIcon('▲', idx === 0, () => moveCue(idx, -1)),
      mkIcon('▼', idx === cue.length - 1, () => moveCue(idx, 1)),
      mkIcon('▶', false, () => gotoCue(idx), '이 장면 적용'),
      mkIcon('✕', false, () => removeCue(idx), '큐에서 제거'),
    );
    li.appendChild(btns);
    cueListEl.appendChild(li);
  });
  updateCueButtons();
}

function mkIcon(text, disabled, fn, title) {
  const b = document.createElement('button');
  b.className = 'iconbtn';
  b.textContent = text;
  b.disabled = disabled;
  if (title) b.title = title;
  b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
  return b;
}

function moveCue(idx, dir) {
  const j = idx + dir;
  if (j < 0 || j >= cue.length) return;
  [cue[idx], cue[j]] = [cue[j], cue[idx]];
  if (cueIndex === idx) cueIndex = j;
  else if (cueIndex === j) cueIndex = idx;
  saveJson(CUE_KEY, cue);
  renderCue();
}

function removeCue(idx) {
  cue.splice(idx, 1);
  if (cueIndex >= cue.length) cueIndex = cue.length - 1;
  else if (cueIndex > idx) cueIndex -= 1;
  saveJson(CUE_KEY, cue);
  renderCue();
}

async function applyCueItem(c) {
  if (c.kind === 'template') return api.applyScene(c.id);
  const cs = customScenes.find((x) => x.id === c.id);
  if (!cs) throw new Error('삭제된 사용자 Scene입니다.');
  return api.applyStates(cs.states);
}

async function gotoCue(idx) {
  if (!connected) return showToast('먼저 X32에 연결하세요.', 'err');
  if (idx < 0 || idx >= cue.length) return;
  cueIndex = idx;
  renderCue();
  try {
    await snapshotForUndo();
    await applyCueItem(cue[idx]);
    showToast(`▶ ${idx + 1}. ${cue[idx].name} 적용`, 'ok');
    setTimeout(loadChannels, 250);
  } catch (err) { showToast('적용 실패: ' + errMsg(err), 'err'); }
}

function nextCue() { if (cueIndex < cue.length - 1) gotoCue(cueIndex + 1); }
function prevCue() { if (cueIndex > 0) gotoCue(cueIndex - 1); }
cueNext.addEventListener('click', nextCue);
cuePrev.addEventListener('click', prevCue);
cueReset.addEventListener('click', () => { cueIndex = -1; renderCue(); });

function updateCueButtons() {
  const has = cue.length > 0;
  if (cuePos) cuePos.textContent = has ? `${cueIndex >= 0 ? cueIndex + 1 : '–'} / ${cue.length}` : '– / –';
  if (cueNext) cueNext.disabled = !connected || !has || cueIndex >= cue.length - 1;
  if (cuePrev) cuePrev.disabled = !connected || cueIndex <= 0;
  if (cueReset) cueReset.disabled = !has || cueIndex < 0;
  syncRemoteCue();
}

// 원격 조작용으로 큐 상태를 메인에 동기화 (사용자 정의는 채널 상태까지 포함)
function syncRemoteCue() {
  const items = cue.map((c) => (c.kind === 'custom'
    ? { kind: 'custom', name: c.name, states: (customScenes.find((x) => x.id === c.id) || {}).states || [] }
    : { kind: 'template', name: c.name, id: c.id }));
  try { api.remoteSetCue(items, cueIndex); } catch (_) { /* ignore */ }
}

// 원격에서 큐를 넘기면 앱 포인터도 따라간다
api.on('remote-cue', (e) => {
  if (!e || typeof e.index !== 'number') return;
  cueIndex = e.index;
  renderCue();
  showToast(`📱 원격: ${e.index + 1}. ${e.name || ''} 적용`, 'ok');
  setTimeout(loadChannels, 250);
});

// 스페이스바 = 다음 큐 적용
document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  if (!tour.classList.contains('hidden')) return;
  const tag = (e.target.tagName || '').toLowerCase();
  if (['input', 'select', 'textarea', 'button'].includes(tag)) return;
  if (!connected || !cue.length) return;
  e.preventDefault();
  nextCue();
});

// ==== 다국어 · 되돌리기 · 백업/복원 · 프리셋 · 실시간 · 쉬운모드 · 원격 ====
const undoBtn = $('undoBtn');
const backupBtn = $('backupBtn');
const restoreBtn = $('restoreBtn');
const restoreFile = $('restoreFile');
const remoteBtn = $('remoteBtn');
const simpleMode = $('simpleMode');
const langSel = $('langSel');
const liveSync = $('liveSync');
const savePresetBtn = $('savePresetBtn');
const presetList = $('presetList');
const remoteModal = $('remoteModal');
const remoteBody = $('remoteBody');
const remoteClose = $('remoteClose');

const PRESET_KEY = 'x32_mic_presets';
let presets = loadJson(PRESET_KEY, []); // [{id,name,preset}]
let undoStack = [];
let currentEqCh = null;
const chRows = new Map(); // ch -> { tr, data }

// ---- 다국어(i18n) ----
const I18N = {
  ko: {
    mixerSelect: '믹서 선택',
    undo: '되돌리기', backup: '백업', restore: '복원', restoreOriginal: '원본 복구', remote: '원격 조작', simple: '쉬운 모드',
    channels: '채널 상태', live: '실시간', chCount: '채널 수', cue: '예배 순서 큐', feedback: '피드백 감지',
    scenes: 'Scene 템플릿', custom: '사용자 정의 Scene', close: '닫기', micPreset: '인물별 마이크 프리셋',
    savePreset: '이 채널 저장', remoteTitle: '태블릿/폰 원격 조작', ipAddr: 'X32 IP 주소', port: '포트',
    guide: '사용 가이드', sensitivity: '민감도', autoSuppress: '자동 억제', findMixer: '믹서 찾기',
    connect: '연결', disconnect: '연결 해제', readState: '상태 읽기',
    startDetect: '감지 시작', stopDetect: '감지 중지', cuePrev: '◀ 이전', cueNext: '▶ 다음 (Space)',
    cueReset: '처음으로', saveState: '💾 현재 상태 저장', connected: '연결됨', notConnected: '연결 안 됨',
    serviceOps: '예배 운영 · 3개 출력', serviceStart: '예배 시작', outMain: '본당 스피커',
    outBroadcast: '유튜브/방송', outMonitor: '찬양팀 모니터',
    sermonMode: '설교 모드(방송 악기 ↓)', loudnessMode: '방송 자동 레벨 (LUFS −14)',
  },
  en: {
    mixerSelect: 'Mixer',
    undo: 'Undo', backup: 'Backup', restore: 'Restore', restoreOriginal: 'Restore original', remote: 'Remote', simple: 'Simple mode',
    channels: 'Channels', live: 'Live', chCount: 'Count', cue: 'Service Cue', feedback: 'Feedback',
    scenes: 'Scene Templates', custom: 'Custom Scenes', close: 'Close', micPreset: 'Mic Presets (per person)',
    savePreset: 'Save channel', remoteTitle: 'Tablet/Phone Remote', ipAddr: 'X32 IP', port: 'Port',
    guide: 'Guide', sensitivity: 'Sensitivity', autoSuppress: 'Auto-suppress', findMixer: 'Find mixer',
    connect: 'Connect', disconnect: 'Disconnect', readState: 'Read state',
    startDetect: 'Start', stopDetect: 'Stop', cuePrev: '◀ Prev', cueNext: '▶ Next (Space)',
    cueReset: 'Reset', saveState: '💾 Save current', connected: 'Connected', notConnected: 'Not connected',
    serviceOps: 'Service · 3 Outputs', serviceStart: 'Start Service', outMain: 'Main speakers',
    outBroadcast: 'YouTube/Stream', outMonitor: 'Worship monitor',
    sermonMode: 'Sermon mode (duck inst.)', loudnessMode: 'Auto level (LUFS −14)',
  },
};
let lang = (() => { try { return localStorage.getItem('x32_lang') || 'ko'; } catch (_) { return 'ko'; } })();
function tr(key) { return (I18N[lang] && I18N[lang][key]) || I18N.ko[key] || key; }

function applyI18n() {
  lang = langSel.value || 'ko';
  try { localStorage.setItem('x32_lang', lang); } catch (_) { /* ignore */ }
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = tr(el.dataset.i18n); });
  connectBtn.textContent = connected ? tr('disconnect') : tr('connect');
  refreshBtn.textContent = tr('readState');
  feedbackBtn.textContent = feedbackOn ? tr('stopDetect') : tr('startDetect');
  cuePrev.textContent = tr('cuePrev');
  cueNext.textContent = tr('cueNext');
  cueReset.textContent = tr('cueReset');
  saveStateBtn.textContent = tr('saveState');
  statusText.textContent = connected ? tr('connected') : tr('notConnected');
}
langSel.addEventListener('change', applyI18n);

// ---- 되돌리기(Undo) ----
async function snapshotForUndo() {
  if (!connected) return;
  try {
    const count = parseInt(chCount.value, 10);
    const states = await api.captureState(count);
    undoStack.push(states);
    if (undoStack.length > 20) undoStack.shift();
  } catch (_) { /* ignore */ }
  updateUndo();
}
function updateUndo() { undoBtn.disabled = !connected || undoStack.length === 0; }
undoBtn.addEventListener('click', async () => {
  const snap = undoStack.pop();
  if (!snap) return;
  try {
    await api.applyStates(snap);
    showToast('↩ 직전 상태로 되돌렸습니다.', 'ok');
    setTimeout(loadChannels, 250);
  } catch (err) { showToast(errMsg(err), 'err'); }
  updateUndo();
});

// ---- 백업 / 복원 ----
backupBtn.addEventListener('click', async () => {
  const data = {
    app: 'x32-church-audio', version: 1,
    customScenes, cue, presets,
  };
  if (connected) {
    showToast('콘솔 세팅을 읽는 중… 잠시만요.', 'ok');
    try { data.console = await api.captureFull(32); } catch (_) {
      try { data.console = await api.captureState(32); } catch (_2) { /* ignore */ }
    }
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'x32-church-backup.json';
  a.click();
  URL.revokeObjectURL(a.href);
  showToast('백업 파일을 저장했습니다.', 'ok');
});
restoreBtn.addEventListener('click', () => restoreFile.click());
restoreFile.addEventListener('change', async () => {
  const file = restoreFile.files[0];
  restoreFile.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'x32-church-audio') throw new Error('형식이 올바르지 않습니다.');
    if (!confirm('백업으로 사용자 정의 Scene·큐·프리셋을 덮어씁니다. 계속할까요?')) return;
    customScenes = data.customScenes || [];
    cue = data.cue || [];
    presets = data.presets || [];
    saveJson(CUSTOM_KEY, customScenes);
    saveJson(CUE_KEY, cue);
    saveJson(PRESET_KEY, presets);
    cueIndex = -1;
    renderCustom(); renderCue(); rebuildCueAddOptions();
    showToast('복원 완료.', 'ok');
    if (connected && Array.isArray(data.console) &&
        confirm('백업에 콘솔 채널 상태가 있습니다. 지금 콘솔에 적용할까요?')) {
      await snapshotForUndo();
      await api.applyFull(data.console, { withFader: true });
      setTimeout(loadChannels, 300);
    }
  } catch (err) { showToast('복원 실패: ' + errMsg(err), 'err'); }
});

// ---- 연결 시 원본 세팅 자동 저장 / 복구 ----
// 믹서에 이미 설정돼 있던 값(이름·페이더·음소거·EQ 등)을 연결 직후 통째로 저장해
// 언제든 "원래대로" 되돌릴 수 있는 안전장치. 같은 콘솔의 첫 연결본을 원본으로 보존한다.
const ORIGINAL_KEY = 'x32_original';
const origRestoreBtn = $('origRestoreBtn');

function loadOriginals() {
  try { return JSON.parse(localStorage.getItem(ORIGINAL_KEY)) || {}; } catch (_) { return {}; }
}
function saveOriginals(obj) {
  try { localStorage.setItem(ORIGINAL_KEY, JSON.stringify(obj)); } catch (_) { /* ignore */ }
}
function origKey() { return lastHost || 'default'; }

function fmtWhen(iso) {
  try {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch (_) { return iso || ''; }
}

function updateOrigButton() {
  if (!origRestoreBtn) return;
  const snap = connected ? loadOriginals()[origKey()] : null;
  origRestoreBtn.disabled = !snap;
  origRestoreBtn.title = snap
    ? `연결 시 저장한 원본 세팅으로 되돌립니다 (저장: ${fmtWhen(snap.savedAt)})`
    : '연결하면 믹서의 원본 세팅이 자동으로 저장됩니다';
}

// 연결 직후 호출: 이 콘솔의 원본이 아직 없으면 지금 상태를 원본으로 저장한다.
async function autoBackupOriginal(host) {
  if (!connected || !api.captureFull) return;
  const store = loadOriginals();
  const key = host || 'default';
  if (store[key]) { updateOrigButton(); return; } // 이미 원본 보관 중 → 덮어쓰지 않음
  try {
    const states = await api.captureFull(32);
    if (!connected) return; // 저장 도중 연결 해제되면 무시
    store[key] = { savedAt: new Date().toISOString(), host: key, states };
    saveOriginals(store);
    updateOrigButton();
    showToast('연결 시점의 믹서 원본 세팅을 자동 저장했습니다. 언제든 "🔒 원본 복구"로 되돌릴 수 있어요.', 'ok');
  } catch (_) { /* 조용히 무시 (미연결 등) */ }
}

if (origRestoreBtn) origRestoreBtn.addEventListener('click', async () => {
  if (!connected) return showToast('먼저 믹서에 연결하세요.', 'err');
  const snap = loadOriginals()[origKey()];
  if (!snap || !Array.isArray(snap.states)) return showToast('저장된 원본 세팅이 없습니다.', 'err');
  if (!confirm(`이 믹서를 처음 연결했을 때(${fmtWhen(snap.savedAt)})의 원본 세팅으로 되돌립니다.\n페이더·음소거·EQ가 그때 값으로 바뀝니다. 계속할까요?`)) return;
  origRestoreBtn.disabled = true;
  try {
    await snapshotForUndo();
    const n = await api.applyFull(snap.states, { withFader: true });
    showToast(`원본 세팅으로 되돌렸습니다 (${n}개 값 적용).`, 'ok');
    setTimeout(loadChannels, 350);
  } catch (err) {
    showToast('원본 복구 실패: ' + errMsg(err), 'err');
  } finally {
    updateOrigButton();
  }
});

// ---- 인물별 마이크 프리셋 (EQ 모달 내) ----
function renderPresets() {
  if (!presets.length) {
    presetList.innerHTML =
      '<div class="muted" style="font-size:12.5px">저장된 프리셋이 없습니다. [이 채널 저장]으로 현재 채널의 EQ·로우컷을 사람 이름으로 저장하세요.</div>';
    return;
  }
  presetList.innerHTML = '';
  for (const p of presets) {
    const div = document.createElement('div');
    div.className = 'preset-item';
    div.innerHTML = `<span class="pname">🎙️ ${esc(p.name)}</span><span class="pmeta">EQ·로우컷</span>`;
    const ap = document.createElement('button');
    ap.className = 'btn small';
    ap.textContent = '적용';
    ap.addEventListener('click', () => applyPreset(p));
    const del = document.createElement('button');
    del.className = 'btn small ghost';
    del.textContent = '삭제';
    del.addEventListener('click', () => {
      presets = presets.filter((x) => x.id !== p.id);
      saveJson(PRESET_KEY, presets);
      renderPresets();
    });
    div.append(ap, del);
    presetList.appendChild(div);
  }
}
async function applyPreset(p) {
  if (!connected) return showToast('먼저 X32에 연결하세요.', 'err');
  if (!currentEqCh) return;
  try {
    const n = await api.applyPreset(currentEqCh, p.preset);
    showToast(`'${p.name}' → 채널 ${String(currentEqCh).padStart(2, '0')} 적용 (${n}개)`, 'ok');
  } catch (err) { showToast('적용 실패: ' + errMsg(err), 'err'); }
}
savePresetBtn.addEventListener('click', async () => {
  if (!connected || !currentEqCh) return showToast('연결 후 채널을 선택하세요.', 'err');
  const name = (prompt('프리셋 이름(사람)을 입력하세요', '목사님') || '').trim();
  if (!name) return;
  try {
    const preset = await api.capturePreset(currentEqCh);
    presets.push({ id: uid(), name, preset });
    saveJson(PRESET_KEY, presets);
    renderPresets();
    showToast(`'${name}' 프리셋 저장`, 'ok');
  } catch (err) { showToast('저장 실패: ' + errMsg(err), 'err'); }
});

// ---- 실시간 동기화 ----
liveSync.addEventListener('change', () => {
  showToast(liveSync.checked ? '🔄 실시간 동기화 켜짐' : '실시간 동기화 꺼짐');
});
api.on('param', (msg) => {
  if (!liveSync.checked || !msg) return;
  updateRowFromParam(msg.address, msg.args);
});
function updateRowFromParam(address, args) {
  const m = /^\/ch\/(\d\d)\/mix\/(fader|on)$/.exec(address);
  if (!m) return;
  const ch = parseInt(m[1], 10);
  const entry = chRows.get(ch);
  if (!entry) return;
  if (m[2] === 'on') {
    const on = args[0] === 1 || args[0] === true;
    if (entry.pill) {
      entry.pill.className = `pill ${on ? 'on' : 'off'} mutebtn`;
      entry.pill.textContent = on ? 'ON' : 'MUTE';
    }
  } else if (m[2] === 'fader' && typeof args[0] === 'number') {
    if (draggingCh.has(ch)) return; // 사용자가 조작 중이면 덮어쓰지 않음
    if (entry.slider) entry.slider.value = String(args[0]);
    if (entry.lvltext) entry.lvltext.textContent = `${faderToText(args[0])} dB`;
  }
}
// 페이더 float → dB 텍스트 (메인 변환식의 렌더러 측 복제)
function faderToText(f) {
  let db;
  if (f <= 0) return '-∞';
  if (f >= 0.5) db = f * 40 - 30;
  else if (f >= 0.25) db = f * 80 - 50;
  else if (f >= 0.0625) db = f * 160 - 70;
  else db = f * 480 - 90;
  if (db <= -90) return '-∞';
  return (db > 0 ? '+' : '') + db.toFixed(1);
}

// ---- 쉬운 모드 ----
simpleMode.addEventListener('change', () => {
  document.body.classList.toggle('simple', simpleMode.checked);
  try { localStorage.setItem('x32_simple', simpleMode.checked ? '1' : '0'); } catch (_) { /* ignore */ }
});

// ---- 원격 조작 ----
remoteBtn.addEventListener('click', openRemote);
remoteClose.addEventListener('click', () => remoteModal.classList.add('hidden'));
remoteModal.addEventListener('click', (e) => { if (e.target === remoteModal) remoteModal.classList.add('hidden'); });
async function openRemote() { remoteModal.classList.remove('hidden'); await renderRemote(); }
async function renderRemote() {
  let st;
  try { st = await api.remoteStatus(); } catch (_) { st = { running: false }; }
  if (st.running && st.info) {
    remoteBody.innerHTML =
      '<p>같은 와이파이의 태블릿/폰 브라우저에서 아래 주소를 여세요:</p>' +
      st.info.urls.map((u) => `<div class="url">${esc(u)}</div>`).join('') +
      '<p class="hint">기기에서 큰 버튼으로 Scene을 전환할 수 있습니다.</p>' +
      '<button id="remoteToggle" class="btn danger">서버 중지</button>';
  } else {
    remoteBody.innerHTML =
      '<p>내장 서버를 켜면 같은 네트워크의 태블릿/폰에서 Scene을 원격으로 전환할 수 있습니다.</p>' +
      '<button id="remoteToggle" class="btn primary">서버 시작</button>';
  }
  document.getElementById('remoteToggle').addEventListener('click', async () => {
    try {
      if (st.running) await api.remoteStop();
      else await api.remoteStart();
    } catch (err) { showToast('원격 서버 오류: ' + errMsg(err), 'err'); }
    renderRemote();
  });
}

// ==== 예배 운영 · 3개 출력 ====
const serviceStartBtn = $('serviceStartBtn');
const sermonMode = $('sermonMode');
const loudnessMode = $('loudnessMode');
const lufsVal = $('lufsVal');
const outMain = $('outMain');
const outBroadcast = $('outBroadcast');
const outMonitor = $('outMonitor');

serviceStartBtn.addEventListener('click', async () => {
  if (!connected) return;
  if (!confirm('Main LR(본당) · Bus 1(방송) · Bus 2(모니터) 세 출력을 예배 시작 프리셋으로 동시에 설정합니다. 진행할까요?')) return;
  try {
    await snapshotForUndo();
    const n = await api.serviceStart();
    [outMain, outBroadcast, outMonitor].forEach((e) => e.classList.add('active'));
    showToast(`예배 시작: 3개 출력 적용 (${n}개 명령 전송)`, 'ok');
    setTimeout(loadChannels, 300);
  } catch (err) { showToast('적용 실패: ' + errMsg(err), 'err'); }
});

sermonMode.addEventListener('change', async () => {
  try {
    await api.sermonDuck(sermonMode.checked);
    showToast(sermonMode.checked
      ? '🎤 설교 모드: 방송 버스의 악기 레벨을 낮췄습니다.'
      : '설교 모드 해제: 방송 악기 레벨을 복원했습니다.', 'ok');
  } catch (err) {
    showToast(errMsg(err), 'err');
    sermonMode.checked = !sermonMode.checked;
  }
});

loudnessMode.addEventListener('change', async () => {
  try {
    if (loudnessMode.checked) {
      await api.loudnessStart({ target: -14 });
      outBroadcast.classList.add('active');
      showToast('📊 방송 자동 레벨 시작 (목표 −14 LUFS)', 'ok');
    } else {
      await api.loudnessStop();
      lufsVal.textContent = '—';
      lufsVal.parentElement.classList.remove('on-target');
      showToast('방송 자동 레벨 중지');
    }
  } catch (err) {
    showToast(errMsg(err), 'err');
    loudnessMode.checked = !loudnessMode.checked;
  }
});

api.on('loudness', (e) => {
  if (!e || typeof e.lufs !== 'number') return;
  lufsVal.textContent = e.lufs.toFixed(1);
  const onTarget = Math.abs(e.lufs - (e.target || -14)) <= 1.5;
  lufsVal.parentElement.classList.toggle('on-target', onTarget);
});
api.on('sermon-duck', (r) => { if (r) sermonMode.checked = !!r.on; });

function setServiceEnabled(on) {
  serviceStartBtn.disabled = !on;
  sermonMode.disabled = !on;
  loudnessMode.disabled = !on;
  if (!on) {
    sermonMode.checked = false;
    loudnessMode.checked = false;
    lufsVal.textContent = '—';
    lufsVal.parentElement.classList.remove('on-target');
    [outMain, outBroadcast, outMonitor].forEach((e) => e.classList.remove('active'));
  }
}

// ==== 믹서 선택 + 아날로그 믹서 가이드 ====
const mixerBtn = $('mixerBtn');
const mixerSelect = $('mixerSelect');
const msDigital = $('msDigital');
const msAnalog = $('msAnalog');
const analogGuide = $('analogGuide');
const agBack = $('agBack');
const agMic = $('agMic');
const agLevel = $('agLevel');
const agFreq = $('agFreq');
const agBalance = $('agBalance');
const agAdvice = $('agAdvice');
const audioDevice = $('audioDevice');
const sourceNote = $('sourceNote');
const agToDigital = $('agToDigital');
const MIXER_KEY = 'x32_mixer_type';

mixerBtn.addEventListener('click', () => { renderMixerOptions(); mixerSelect.classList.remove('hidden'); });

// 디지털 업그레이드 유도 → 믹서 선택 화면으로
agToDigital.addEventListener('click', () => {
  stopAnalog();
  analogGuide.classList.add('hidden');
  renderMixerOptions();
  mixerSelect.classList.remove('hidden');
});

// ---- 오디오 입력 장치 선택 ----
function looksBuiltIn(label) {
  return !label || /built-?in|내장|macbook|imac|기본|default/i.test(label);
}
function updateSourceNote() {
  const opt = audioDevice.options[audioDevice.selectedIndex];
  const label = opt ? opt.textContent : '';
  if (looksBuiltIn(label)) {
    sourceNote.classList.remove('iface');
    sourceNote.innerHTML = '🎤 내장 마이크 — 기본 분석. <b>더 정확한 분석을 위해 USB 오디오 인터페이스를 권장합니다.</b>';
  } else {
    sourceNote.classList.add('iface');
    sourceNote.innerHTML = '🎛️ 오디오 인터페이스 — 정확한 분석 ✓';
  }
}
async function refreshDevices() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === 'audioinput');
    const cur = audioDevice.value;
    audioDevice.innerHTML = '<option value="">기본 입력 (자동)</option>';
    inputs.forEach((d, idx) => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || `마이크 ${idx + 1}`;
      audioDevice.appendChild(o);
    });
    if (cur) audioDevice.value = cur;
  } catch (_) { /* ignore */ }
  updateSourceNote();
}
audioDevice.addEventListener('change', () => {
  updateSourceNote();
  if (agStream) { stopAnalog(); startAnalog(); } // 장치 바꾸면 다시 시작
});
refreshDevices();

// 믹서 목록을 레지스트리에서 받아 동적으로 그린다 (브랜드 추가 시 자동 반영)
async function renderMixerOptions() {
  let list = [];
  try { list = await api.mixerList(); } catch (_) { /* ignore */ }
  const digital = list.filter((m) => m.kind === 'digital');
  msDigital.innerHTML = '';
  for (const m of digital) {
    const b = document.createElement('button');
    b.className = 'ms-opt' + (m.supported ? '' : ' disabled');
    if (!m.supported) b.disabled = true;
    b.innerHTML =
      `<span class="ms-ic">🎚️</span><b>${esc(m.brand)} ${esc(m.name)}</b>` +
      `<span class="ms-badge ${m.supported ? 'ok' : 'soon'}">${m.supported ? '지원' : '추후 지원 예정'}</span>` +
      `<p>${esc(m.note || '')}</p>`;
    if (m.supported) b.addEventListener('click', () => selectDigital(m.id));
    msDigital.appendChild(b);
  }
}

async function selectDigital(id) {
  try {
    const r = await api.mixerSelect(id);
    if (!r.ok) { showToast(`${r.name || '해당 믹서'}는 추후 지원 예정입니다.`, 'err'); return; }
  } catch (err) { showToast(errMsg(err), 'err'); return; }
  try { localStorage.setItem(MIXER_KEY, 'digital-' + id); } catch (_) { /* ignore */ }
  mixerSelect.classList.add('hidden');
  analogGuide.classList.add('hidden');
  showToast('믹서를 선택했습니다.', 'ok');
}
msAnalog.addEventListener('click', () => {
  try { localStorage.setItem(MIXER_KEY, 'analog'); } catch (_) { /* ignore */ }
  mixerSelect.classList.add('hidden');
  analogGuide.classList.remove('hidden');
});
agBack.addEventListener('click', () => {
  stopAnalog();
  analogGuide.classList.add('hidden');
  mixerSelect.classList.remove('hidden');
});

// 마이크 실시간 분석
let agStream = null;
let agCtx = null;
let agAnalyser = null;
let agRAF = null;
let agLevelSmoothed = 0;

agMic.addEventListener('click', () => { if (agStream) stopAnalog(); else startAnalog(); });

async function startAnalog() {
  const deviceId = audioDevice.value;
  const audio = { echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  if (deviceId) audio.deviceId = { exact: deviceId };
  try {
    agStream = await navigator.mediaDevices.getUserMedia({ audio });
  } catch (err) {
    showToast('마이크를 사용할 수 없습니다: ' + errMsg(err), 'err');
    return;
  }
  refreshDevices(); // 권한 허용 후에야 장치 이름이 보임
  agCtx = new (window.AudioContext || window.webkitAudioContext)();
  const srcNode = agCtx.createMediaStreamSource(agStream);
  agAnalyser = agCtx.createAnalyser();
  agAnalyser.fftSize = 2048;
  agAnalyser.smoothingTimeConstant = 0.6;
  srcNode.connect(agAnalyser);
  agMic.textContent = '■ 마이크 중지';
  agMic.classList.add('active');
  const freqData = new Uint8Array(agAnalyser.frequencyBinCount);
  const loop = () => {
    if (!agAnalyser) return;
    agAnalyser.getByteFrequencyData(freqData);
    const m = window.AnalogAdvice.analyze(freqData, agCtx.sampleRate);
    const adv = window.AnalogAdvice.adviceFor(m);
    renderAnalog(m, adv);
    agRAF = requestAnimationFrame(loop);
  };
  loop();
}

function stopAnalog() {
  if (agRAF) { cancelAnimationFrame(agRAF); agRAF = null; }
  if (agStream) { agStream.getTracks().forEach((t) => t.stop()); agStream = null; }
  if (agCtx) { agCtx.close().catch(() => {}); agCtx = null; }
  agAnalyser = null;
  agMic.textContent = '🎤 마이크 시작';
  agMic.classList.remove('active');
  if (knobHi) knobHi.classList.add('hidden');
}

function renderAnalog(m, adv) {
  agLevelSmoothed = agLevelSmoothed * 0.7 + m.level * 0.3;
  agLevel.style.width = `${Math.min(100, Math.round(agLevelSmoothed * 180))}%`;
  const quiet = m.level < 0.02;
  agFreq.textContent = quiet ? '—' : (m.domHz >= 1000 ? `${(m.domHz / 1000).toFixed(1)}kHz` : `${m.domHz}Hz`);
  agBalance.textContent = quiet ? '—' : balanceText(m);
  agAdvice.textContent = adv.text;
  agAdvice.className = `ag-advice status-${adv.status}`;
  highlightKnob(adv);
}

// 활성 노브를 믹서 그림/사진 위 좌표에 하이라이트
function highlightKnob(adv) {
  const c = adv.knob && mixerCoords[adv.knob];
  if (!c) { knobHi.classList.add('hidden'); return; }
  knobHi.style.left = `${c.x * 100}%`;
  knobHi.style.top = `${c.y * 100}%`;
  knobHi.classList.remove('hidden');
  knobHi.classList.toggle('alarm', adv.status === 'alarm');
  const arrow = knobHi.querySelector('.khi-arrow');
  if (arrow) arrow.textContent = adv.dir === 'down' ? '↺' : '↻';
}

function balanceText(m) {
  const mx = Math.max(m.lowProp, m.midProp, m.highProp);
  if (mx === m.lowProp) return '저음 우세';
  if (mx === m.highProp) return '고음 우세';
  if (m.midProp > 0.4) return '중음 우세';
  return '균형';
}

// ---- 믹서 그림/사진 + 노브 위치 매핑 ----
const mixerModel = $('mixerModel');
const mixerPhoto = $('mixerPhoto');
const uploadPhoto = $('uploadPhoto');
const calibBtn = $('calibBtn');
const agMixer = $('agMixer');
const mixerCanvas = $('mixerCanvas');
const knobHi = $('knobHi');
const calibHint = $('calibHint');
const mixerNote = $('mixerNote');
const PHOTO_KEY = 'x32_mixer_photo';

// 브랜드별 믹서 채널 스트립 그림(SVG). 모두 GAIN/HIGH/MID/LOW + 페이더 배치로
// 같은 노브 좌표(BUILTIN_COORDS)를 쓰되, 색/라벨로 모델 느낌을 낸다.
const MIXER_MODELS = {
  generic: { title: '채널 1', panel: '#262c3d', edge: '#38415c', knob: '#3a425c', knobIn: '#2b3147', tick: '#e8ecf5', label: '#9aa3bd' },
  yamaha: { title: 'Yamaha MG', panel: '#23272f', edge: '#3a4350', knob: '#c9ccd2', knobIn: '#e7e9ec', tick: '#1a1e2a', label: '#aeb6c4' },
  behringer: { title: 'BEHRINGER XENYX', panel: '#15171c', edge: '#2a2f38', knob: '#2b2f36', knobIn: '#1c1f25', tick: '#d8b24a', label: '#c9a24b' },
  mackie: { title: 'Mackie ProFX', panel: '#141a1b', edge: '#2a3433', knob: '#242a2b', knobIn: '#1a1f20', tick: '#3fae6b', label: '#7fcf9e' },
};
function buildModelSVG(modelKey) {
  const m = MIXER_MODELS[modelKey] || MIXER_MODELS.generic;
  const knob = (cx, cy, label) =>
    `<circle cx="${cx}" cy="${cy}" r="30" fill="${m.knob}" stroke="#11141d" stroke-width="3"/>` +
    `<circle cx="${cx}" cy="${cy}" r="23" fill="${m.knobIn}"/>` +
    `<line x1="${cx}" y1="${cy - 21}" x2="${cx}" y2="${cy - 9}" stroke="${m.tick}" stroke-width="3" stroke-linecap="round"/>` +
    `<text x="${cx}" y="${cy + 48}" fill="${m.label}" font-size="15" font-weight="700" text-anchor="middle" font-family="sans-serif">${label}</text>`;
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="624" viewBox="0 0 300 520">' +
    `<rect x="6" y="6" width="288" height="508" rx="14" fill="${m.panel}" stroke="${m.edge}" stroke-width="2"/>` +
    `<rect x="40" y="20" width="220" height="24" rx="4" fill="#0e1016"/>` +
    `<text x="150" y="37" fill="${m.label}" font-size="13" font-weight="700" text-anchor="middle" font-family="sans-serif">${m.title}</text>` +
    knob(150, 82, 'GAIN') + knob(150, 182, 'HIGH') + knob(150, 266, 'MID') + knob(150, 350, 'LOW') +
    `<rect x="142" y="398" width="16" height="104" rx="6" fill="#0e1016" stroke="${m.edge}"/>` +
    `<rect x="126" y="432" width="48" height="18" rx="4" fill="${m.knob}" stroke="#11141d"/>` +
    `<text x="150" y="514" fill="${m.label}" font-size="12" text-anchor="middle" font-family="sans-serif">FADER</text>` +
    '</svg>';
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}
const BUILTIN_COORDS = {
  gain: { x: 0.5, y: 0.158 }, high: { x: 0.5, y: 0.350 },
  mid: { x: 0.5, y: 0.512 }, low: { x: 0.5, y: 0.673 },
};

let customPhoto = loadJson(PHOTO_KEY, null); // { dataUrl, coords }
let mixerCoords = BUILTIN_COORDS;

function setMixerModel(model) {
  knobHi.classList.add('hidden');
  if (model === 'custom') {
    uploadPhoto.classList.remove('hidden');
    calibBtn.classList.remove('hidden');
    if (customPhoto && customPhoto.dataUrl) {
      mixerCanvas.src = customPhoto.dataUrl;
      mixerCoords = customPhoto.coords && Object.keys(customPhoto.coords).length ? customPhoto.coords : {};
      mixerNote.textContent = Object.keys(mixerCoords).length
        ? '내 믹서 사진 위에서 안내합니다. 위치를 바꾸려면 [노브 위치 지정].'
        : '노브 위치가 아직 지정되지 않았습니다. [📍 노브 위치 지정]을 눌러 GAIN·HIGH·MID·LOW를 찍어주세요.';
    } else {
      mixerCanvas.removeAttribute('src');
      mixerCoords = {};
      mixerNote.textContent = '내 믹서 사진을 올려주세요. [📷 사진 업로드]';
    }
  } else {
    uploadPhoto.classList.add('hidden');
    calibBtn.classList.add('hidden');
    mixerCanvas.src = buildModelSVG(model);
    mixerCoords = BUILTIN_COORDS;
    mixerNote.textContent = '내 믹서와 비슷한 모델을 골랐어요. 정확히 맞추려면 [📷 내 믹서 사진]을 선택해 직접 올릴 수 있어요.';
  }
}
mixerModel.addEventListener('change', () => setMixerModel(mixerModel.value));
uploadPhoto.addEventListener('click', () => mixerPhoto.click());
mixerPhoto.addEventListener('change', async () => {
  const file = mixerPhoto.files[0];
  mixerPhoto.value = '';
  if (!file) return;
  let dataUrl;
  try {
    dataUrl = await loadAndDownscale(file, 1280); // 큰 사진도 자동으로 줄여 안정적으로 표시/저장
  } catch (err) {
    showToast('이 사진은 표시할 수 없어요. JPG 또는 PNG 파일로 올려주세요.', 'err');
    return;
  }
  customPhoto = { dataUrl, coords: {} };
  saveJson(PHOTO_KEY, customPhoto);
  mixerModel.value = 'custom';
  setMixerModel('custom');
  showToast('사진 업로드 완료. 이제 노브 위치를 지정하세요.', 'ok');
  startCalibration();
});

// 업로드 이미지를 캔버스로 다시 그려 가로 maxW 이하 JPEG 로 축소 (용량·렌더링 문제 방지)
function loadAndDownscale(file, maxW) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode'));
      img.onload = () => {
        try {
          const scale = Math.min(1, maxW / (img.naturalWidth || maxW));
          const w = Math.max(1, Math.round((img.naturalWidth || maxW) * scale));
          const h = Math.max(1, Math.round((img.naturalHeight || maxW) * scale));
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        } catch (e) { reject(e); }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// 노브 위치 보정 (사진 위 4점 클릭)
const CALIB_ORDER = [['gain', 'GAIN(게인)'], ['high', 'HIGH(고음)'], ['mid', 'MID(중음)'], ['low', 'LOW(저음)']];
const KNOB_LETTER = { gain: 'G', high: 'H', mid: 'M', low: 'L' };
let calibActive = false;
let calibQueue = [];
let calibCoords = {};
function clearCalibDots() {
  agMixer.querySelectorAll('.calib-dot').forEach((d) => d.remove());
}
function addCalibDot(k, x, y) {
  const d = document.createElement('div');
  d.className = 'calib-dot';
  d.textContent = KNOB_LETTER[k] || '•';
  d.style.left = `${x * 100}%`;
  d.style.top = `${y * 100}%`;
  agMixer.appendChild(d);
}
function startCalibration() {
  if (mixerModel.value !== 'custom' || !customPhoto || !customPhoto.dataUrl) {
    return showToast('먼저 내 믹서 사진을 업로드하세요.', 'err');
  }
  calibActive = true;
  calibQueue = CALIB_ORDER.slice();
  calibCoords = {};
  knobHi.classList.add('hidden');
  clearCalibDots();
  nextCalib();
}
function nextCalib() {
  if (!calibQueue.length) {
    calibActive = false;
    calibHint.classList.add('hidden');
    customPhoto.coords = calibCoords;
    saveJson(PHOTO_KEY, customPhoto);
    mixerCoords = calibCoords;
    mixerNote.textContent = '내 믹서 사진 위에서 안내합니다. 위치를 바꾸려면 [노브 위치 지정].';
    showToast('노브 위치 저장 완료!', 'ok');
    return;
  }
  const step = CALIB_ORDER.length - calibQueue.length + 1;
  calibHint.textContent = `(${step}/4) ${calibQueue[0][1]} 노브를 사진에서 클릭하세요`;
  calibHint.classList.remove('hidden');
}
calibBtn.addEventListener('click', startCalibration);
agMixer.addEventListener('click', (e) => {
  if (!calibActive) return;
  const rect = mixerCanvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;
  if (x < 0 || x > 1 || y < 0 || y > 1) return;
  const [k] = calibQueue.shift();
  calibCoords[k] = { x, y };
  addCalibDot(k, x, y);
  nextCalib();
});

setMixerModel('generic');

// ---- 사용 가이드 투어 ----
const guideBtn = $('guideBtn');
const tour = $('tour');
const tourSpot = $('tourSpot');
const tourCard = $('tourCard');
const tourStepNo = $('tourStepNo');
const tourTitle = $('tourTitle');
const tourText = $('tourText');
const tourPrev = $('tourPrev');
const tourNext = $('tourNext');
const tourSkip = $('tourSkip');
const GUIDE_SEEN_KEY = 'x32_guide_seen';

const TOUR_STEPS = [
  {
    sel: '.conn',
    title: '1단계 · X32에 연결',
    text: '먼저 X32의 IP 주소를 입력하고 [연결]을 누르세요.\nX32의 IP는 콘솔 Setup → Network 에서 확인할 수 있어요.\n연결되면 콘솔 모델·펌웨어 정보가 표시됩니다.',
  },
  {
    sel: '.channels',
    title: '2단계 · 채널 상태 읽기',
    text: '[상태 읽기]를 누르면 각 채널의 이름·레벨(dB)·음소거·EQ 상태를 불러옵니다.\n각 줄의 [EQ 보기]로 4밴드 EQ(주파수·게인·Q) 상세도 확인할 수 있어요.',
  },
  {
    sel: '.feedback',
    title: '3단계 · 피드백(하울링) 감지',
    text: '[감지 시작]을 누르면 "삐—" 하는 하울링을 실시간으로 감시합니다.\n의심되는 주파수를 경고로 알려줘요. 오른쪽 [민감도]로 감도를 조절하세요.\n(콘솔 RTA 소스를 메인 L/R로 두면 가장 정확합니다.)',
  },
  {
    sel: '.scenes',
    title: '4단계 · Scene 템플릿',
    text: '예배 순서에 맞는 버튼을 누르면 채널이 한 번에 세팅됩니다.\n설교 / 찬양팀 / 기도·묵상 / 광고 / 전체 음소거 등.\n긴급할 때는 [전체 음소거]로 바로 소리를 끌 수 있어요.',
  },
  {
    sel: '#guideBtn',
    title: '준비 완료! 🎉',
    text: '이제 시작해 보세요.\n언제든 이 [❓ 사용 가이드] 버튼을 눌러 안내를 다시 볼 수 있습니다.',
  },
];

let tourIdx = 0;

function openTour(start = 0) {
  tourIdx = start;
  tour.classList.remove('hidden');
  showTourStep();
}

function closeTour() {
  tour.classList.add('hidden');
  try { localStorage.setItem(GUIDE_SEEN_KEY, '1'); } catch (_) { /* ignore */ }
}

function showTourStep() {
  const step = TOUR_STEPS[tourIdx];
  const el = document.querySelector(step.sel);
  tourStepNo.textContent = `${tourIdx + 1} / ${TOUR_STEPS.length}`;
  tourTitle.textContent = step.title;
  tourText.textContent = step.text;
  tourPrev.disabled = tourIdx === 0;
  tourNext.textContent = tourIdx === TOUR_STEPS.length - 1 ? '시작하기' : '다음';

  if (!el) return;
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  requestAnimationFrame(() => positionTour(el));
}

function positionTour(el) {
  const r = el.getBoundingClientRect();
  const pad = 6;
  tourSpot.style.top = `${r.top - pad}px`;
  tourSpot.style.left = `${r.left - pad}px`;
  tourSpot.style.width = `${r.width + pad * 2}px`;
  tourSpot.style.height = `${r.height + pad * 2}px`;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardR = tourCard.getBoundingClientRect();
  const cardW = cardR.width || 320;
  const cardH = cardR.height || 160;

  // 아래에 공간이 있으면 아래, 없으면 위에 배치
  let top = r.bottom + 14;
  if (top + cardH + 12 > vh) top = r.top - cardH - 14;
  if (top < 12) top = Math.max(12, (vh - cardH) / 2);

  let left = r.left;
  if (left + cardW + 12 > vw) left = vw - cardW - 12;
  if (left < 12) left = 12;

  tourCard.style.top = `${top}px`;
  tourCard.style.left = `${left}px`;
}

tourNext.addEventListener('click', () => {
  if (tourIdx >= TOUR_STEPS.length - 1) return closeTour();
  tourIdx += 1;
  showTourStep();
});
tourPrev.addEventListener('click', () => {
  if (tourIdx === 0) return;
  tourIdx -= 1;
  showTourStep();
});
tourSkip.addEventListener('click', closeTour);
guideBtn.addEventListener('click', () => openTour(0));
window.addEventListener('resize', () => {
  if (!tour.classList.contains('hidden')) {
    const el = document.querySelector(TOUR_STEPS[tourIdx].sel);
    if (el) positionTour(el);
  }
});
document.addEventListener('keydown', (e) => {
  if (tour.classList.contains('hidden')) return;
  if (e.key === 'Escape') closeTour();
  else if (e.key === 'ArrowRight') tourNext.click();
  else if (e.key === 'ArrowLeft') tourPrev.click();
});

// ---- 연결 도움말 / 믹서 자동 찾기 ----
const findBtn = $('findBtn');
const netHelp = $('netHelp');
const netClose = $('netClose');
const netRun = $('netRun');
const netStatus = $('netStatus');
const netResults = $('netResults');
const myIP = $('myIP');

function openNetHelp() {
  netHelp.classList.remove('hidden');
  // 내 컴퓨터 IP 표시 (앞 3자리 비교용)
  if (api.localIPs) {
    api.localIPs().then((ips) => {
      myIP.textContent = (ips && ips.length) ? ips.join(', ') : '확인 불가';
    }).catch(() => { myIP.textContent = '확인 불가'; });
  } else {
    myIP.textContent = '확인 불가';
  }
  // 열자마자 자동 검색
  runDiscover();
}

async function runDiscover() {
  if (!api.discover) { netStatus.textContent = '이 버전에서는 자동 찾기를 지원하지 않습니다.'; return; }
  netResults.innerHTML = '';
  netRun.disabled = true;
  netStatus.textContent = '찾는 중… (약 3초)';
  try {
    const port = parseInt(portInput.value, 10) || undefined;
    const found = await api.discover({ port });
    renderNetResults(found || []);
  } catch (err) {
    netStatus.textContent = '검색 실패: ' + errMsg(err);
  } finally {
    netRun.disabled = false;
  }
}

function renderNetResults(list) {
  netResults.innerHTML = '';
  if (!list.length) {
    netStatus.textContent = '';
    const empty = document.createElement('div');
    empty.className = 'net-empty';
    empty.innerHTML = '⚠️ 같은 네트워크에서 믹서를 찾지 못했어요.<br>'
      + '아래 설명대로 <b>맥을 믹서와 같은 공유기</b>에 연결한 뒤 다시 찾아보세요.';
    netResults.appendChild(empty);
    return;
  }
  netStatus.textContent = list.length + '대 발견';
  list.forEach((c) => {
    const row = document.createElement('div');
    row.className = 'net-hit';
    const label = [c.model, c.name].filter(Boolean).join(' · ') || '믹서';
    row.innerHTML = '<div class="nh-info"><b>' + escapeHtml(label) + '</b>'
      + '<span class="nh-ip">' + escapeHtml(c.ip) + '</span></div>';
    const use = document.createElement('button');
    use.className = 'btn primary small';
    use.textContent = '이 믹서 연결';
    use.addEventListener('click', async () => {
      ipInput.value = c.ip;
      netHelp.classList.add('hidden');
      connectBtn.click();
    });
    row.appendChild(use);
    netResults.appendChild(row);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

if (findBtn) findBtn.addEventListener('click', openNetHelp);
if (netClose) netClose.addEventListener('click', () => netHelp.classList.add('hidden'));
if (netRun) netRun.addEventListener('click', runDiscover);
if (netHelp) netHelp.addEventListener('click', (e) => { if (e.target === netHelp) netHelp.classList.add('hidden'); });

// ---- 초기화 ----
(async function init() {
  // 언어 · 쉬운 모드 복원
  langSel.value = (I18N[lang] ? lang : 'ko');
  let simple = false;
  try { simple = localStorage.getItem('x32_simple') === '1'; } catch (_) { /* ignore */ }
  simpleMode.checked = simple;
  document.body.classList.toggle('simple', simple);

  await loadScenes();
  renderCustom();
  renderCue();
  applyI18n();
  const status = await api.getStatus();
  if (status.connected) {
    setConnected(status.info);
    loadChannels().then(() => autoBackupOriginal(lastHost));
  } else setDisconnected();

  // 처음 실행 시: 믹서 선택 화면 먼저, 이후 가이드 투어
  let mixerType = null;
  try { mixerType = localStorage.getItem(MIXER_KEY); } catch (_) { /* ignore */ }
  if (!mixerType) {
    renderMixerOptions();
    mixerSelect.classList.remove('hidden');
  } else {
    let seen = false;
    try { seen = localStorage.getItem(GUIDE_SEEN_KEY) === '1'; } catch (_) { /* ignore */ }
    if (!seen && mixerType === 'digital-x32') setTimeout(() => openTour(0), 400);
  }
})();
