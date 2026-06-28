'use strict';

const api = window.x32api;

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
  if (info) {
    infoStrip.classList.remove('hidden');
    infoStrip.innerHTML =
      `콘솔: <b>${esc(info.name || '-')}</b> · 모델: <b>${esc(info.model || '-')}</b> · ` +
      `펌웨어: <b>${esc(info.firmware || '-')}</b> · IP: <b>${esc(info.ip || '-')}</b>`;
  }
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
    setConnected(info);
    showToast('X32 에 연결되었습니다.', 'ok');
    loadChannels();
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
  for (const c of channels) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td>${String(c.ch).padStart(2, '0')}</td>` +
      `<td>${esc(c.name)}</td>` +
      `<td class="lvl">${esc(c.dbText)} dB</td>` +
      `<td><span class="pill ${c.on ? 'on' : 'off'}">${c.on ? 'ON' : 'MUTE'}</span></td>` +
      `<td><span class="pill ${c.eqOn ? 'eq-on' : 'eq-off'}">${c.eqOn ? 'EQ' : 'OFF'}</span></td>` +
      `<td><button class="btn small ghost" data-ch="${c.ch}">EQ 보기</button></td>`;
    chBody.appendChild(tr);
  }
  chBody.querySelectorAll('button[data-ch]').forEach((b) =>
    b.addEventListener('click', () => openEq(parseInt(b.dataset.ch, 10))));
}

// ---- EQ 상세 ----
async function openEq(ch) {
  eqTitle.textContent = `채널 ${String(ch).padStart(2, '0')} · EQ 상세`;
  eqBody.innerHTML = '<p class="muted">EQ 상태를 읽는 중…</p>';
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
    feedbackBtn.textContent = '감지 시작';
    fbState.textContent = '중지됨';
    fbState.classList.remove('alarm');
    clearSpectrum();
  } else {
    await api.startFeedback(sensitivityOptions());
    feedbackOn = true;
    feedbackBtn.classList.add('active');
    feedbackBtn.textContent = '감지 중지';
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
}

async function applyScene(sc) {
  if (!connected) return showToast('먼저 X32 에 연결하세요.', 'err');
  const ok = confirm(`'${sc.name}' Scene 을 적용할까요?\n\n${sc.description}`);
  if (!ok) return;
  try {
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

// ---- 초기화 ----
(async function init() {
  await loadScenes();
  const status = await api.getStatus();
  if (status.connected) setConnected(status.info);
  else setDisconnected();
})();
