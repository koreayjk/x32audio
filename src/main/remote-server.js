'use strict';

const http = require('http');
const os = require('os');

/**
 * 태블릿/스마트폰 원격 조작용 내장 HTTP 서버.
 *
 * 외부 패키지 없이 Node 내장 http 만 사용한다. 같은 네트워크의 기기에서
 * 브라우저로 접속하면 큰 버튼으로 Scene 을 전환할 수 있다.
 * (WebSocket 대신 짧은 폴링으로 상태를 갱신해 의존성을 없앴다.)
 *
 * 핸들러는 생성자에 주입한다:
 *  - getScenes() => [{id,name,icon,danger}]
 *  - applyScene(id) => number
 *  - getStatus() => { connected, info }
 */
class RemoteServer {
  constructor(handlers) {
    this.handlers = handlers;
    this.server = null;
    this.port = 0;
  }

  get running() { return !!this.server; }

  start(port = 8723) {
    return new Promise((resolve, reject) => {
      if (this.server) return resolve(this.info());
      const server = http.createServer((req, res) => this._route(req, res));
      server.on('error', (err) => { this.server = null; reject(err); });
      server.listen(port, '0.0.0.0', () => {
        this.server = server;
        this.port = server.address().port;
        resolve(this.info());
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => { this.server = null; resolve(); });
    });
  }

  /** 접속용 URL 목록(로컬 IPv4) 반환. */
  info() {
    const urls = [];
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const ni of ifaces[name] || []) {
        if (ni.family === 'IPv4' && !ni.internal) urls.push(`http://${ni.address}:${this.port}`);
      }
    }
    if (!urls.length) urls.push(`http://localhost:${this.port}`);
    return { port: this.port, urls };
  }

  _send(res, code, type, body) {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  }

  _json(res, code, obj) {
    this._send(res, code, 'application/json; charset=utf-8', JSON.stringify(obj));
  }

  async _route(req, res) {
    const url = new URL(req.url, 'http://x');
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        return this._send(res, 200, 'text/html; charset=utf-8', PAGE);
      }
      if (req.method === 'GET' && url.pathname === '/api/scenes') {
        return this._json(res, 200, { scenes: this.handlers.getScenes() });
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        return this._json(res, 200, this.handlers.getStatus());
      }
      if (req.method === 'POST' && url.pathname === '/api/scene') {
        const body = await readBody(req);
        const id = (body && body.id) || url.searchParams.get('id');
        if (!id) return this._json(res, 400, { error: 'id 누락' });
        const status = this.handlers.getStatus();
        if (!status.connected) return this._json(res, 409, { error: '콘솔 미연결' });
        const count = this.handlers.applyScene(id);
        return this._json(res, 200, { ok: true, id, count });
      }
      if (req.method === 'GET' && url.pathname === '/api/cue') {
        return this._json(res, 200, this.handlers.getCue());
      }
      if (req.method === 'POST' && (url.pathname === '/api/cue/next'
        || url.pathname === '/api/cue/prev' || url.pathname === '/api/cue/goto')) {
        if (!this.handlers.getStatus().connected) return this._json(res, 409, { error: '콘솔 미연결' });
        const cur = this.handlers.getCue();
        let target;
        if (url.pathname === '/api/cue/next') target = cur.index + 1;
        else if (url.pathname === '/api/cue/prev') target = cur.index - 1;
        else { const body = await readBody(req); target = body.index; }
        const r = this.handlers.gotoCue(target);
        return this._json(res, r.ok ? 200 : 400, r);
      }
      if (req.method === 'POST' && url.pathname === '/api/mute') {
        if (!this.handlers.getStatus().connected) return this._json(res, 409, { error: '콘솔 미연결' });
        this.handlers.allMute();
        return this._json(res, 200, { ok: true });
      }
      this._json(res, 404, { error: 'not found' });
    } catch (err) {
      this._json(res, 500, { error: String(err && err.message ? err.message : err) });
    }
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (_) { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

// 원격 모바일 페이지 (정적, self-contained)
const PAGE = `<!DOCTYPE html><html lang="ko"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"/>
<title>X32 원격</title><style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;font-family:-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;background:#14171f;color:#eef1f8}
header{padding:16px;background:#1b1f2a;border-bottom:1px solid #333a52;display:flex;justify-content:space-between;align-items:center}
header b{font-size:17px}#st{font-size:13px;color:#9aa3bd}#st.on{color:#3ecf8e}
.sec{padding:6px 16px;color:#9aa3bd;font-size:13px;font-weight:600;margin-top:8px}
.grid{padding:8px 16px;display:grid;grid-template-columns:1fr 1fr;gap:12px}
button.sc{padding:22px 12px;border-radius:14px;border:1px solid #333a52;background:#232838;color:#eef1f8;font-size:17px;font-weight:600}
button.sc:active{background:#39426a}button.sc.danger{border-color:#ff5d6c;color:#ff5d6c}
button.sc .e{display:block;font-size:30px;margin-bottom:6px}
.cuebar{display:flex;align-items:center;gap:10px;padding:8px 16px}
.cuebar button{flex:1;padding:20px 8px;border-radius:14px;border:1px solid #333a52;background:#232838;color:#eef1f8;font-size:18px;font-weight:700}
.cuebar button.next{background:#4f7cff;border-color:#4f7cff}
.cuebar button:active{filter:brightness(1.2)}
.cuebar button:disabled{opacity:.4}
#cueNow{padding:0 16px 6px;font-size:15px}#cueNow b{color:#3ecf8e}
.mute{margin:10px 16px;width:calc(100% - 32px);padding:16px;border-radius:14px;border:1px solid #ff5d6c;background:rgba(255,93,108,.12);color:#ff5d6c;font-size:16px;font-weight:700}
#toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#11141d;border:1px solid #3ecf8e;padding:12px 20px;border-radius:10px;opacity:0;transition:.2s}
#toast.show{opacity:1}
</style></head><body>
<header><b>🎛️ X32 원격</b><span id="st">연결 확인 중…</span></header>
<div id="cueSec" style="display:none">
 <div class="sec">예배 순서 큐</div>
 <div id="cueNow">현재: <b id="cueName">—</b> <span id="cuePos"></span></div>
 <div class="cuebar"><button id="cp">◀ 이전</button><button class="next" id="cn">▶ 다음</button></div>
</div>
<button class="mute" id="muteBtn">🔇 전체 음소거</button>
<div class="sec">Scene</div>
<div class="grid" id="g"></div>
<div id="toast"></div>
<script>
const g=document.getElementById('g'),st=document.getElementById('st'),toast=document.getElementById('toast');
const cueSec=document.getElementById('cueSec'),cueName=document.getElementById('cueName'),cuePos=document.getElementById('cuePos'),cp=document.getElementById('cp'),cn=document.getElementById('cn');
let tt;function showToast(m){toast.textContent=m;toast.classList.add('show');clearTimeout(tt);tt=setTimeout(()=>toast.classList.remove('show'),1800);}
async function load(){const r=await fetch('/api/scenes');const{scenes}=await r.json();g.innerHTML='';
 for(const s of scenes){const b=document.createElement('button');b.className='sc'+(s.danger?' danger':'');
 b.innerHTML='<span class="e">'+(s.icon||'🎬')+'</span>'+s.name;b.onclick=()=>apply(s);g.appendChild(b);}}
async function apply(s){try{const r=await fetch('/api/scene',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:s.id})});
 const j=await r.json();if(r.ok)showToast('▶ '+s.name+' 적용');else showToast('⚠ '+(j.error||'실패'));}catch(e){showToast('⚠ 통신 오류');}}
async function cue(path){try{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const j=await r.json();if(!r.ok)showToast('⚠ '+(j.error||'실패'));else loadCue();}catch(e){showToast('⚠ 통신 오류');}}
cp.onclick=()=>cue('/api/cue/prev');cn.onclick=()=>cue('/api/cue/next');
document.getElementById('muteBtn').onclick=async()=>{try{const r=await fetch('/api/mute',{method:'POST'});if(r.ok)showToast('🔇 전체 음소거');else showToast('⚠ 실패');}catch(e){showToast('⚠ 통신 오류');}};
async function loadCue(){try{const r=await fetch('/api/cue');const c=await r.json();
 if(!c.items||!c.items.length){cueSec.style.display='none';return;}cueSec.style.display='block';
 const cur=c.items[c.index];cueName.textContent=cur?cur.name:'(시작 전)';cuePos.textContent=(c.index>=0?(c.index+1):'–')+' / '+c.items.length;
 cp.disabled=c.index<=0;cn.disabled=c.index>=c.items.length-1;}catch(e){}}
async function poll(){try{const r=await fetch('/api/status');const j=await r.json();
 st.textContent=j.connected?('연결됨 · '+(j.info&&j.info.model||'X32')):'콘솔 미연결';st.className=j.connected?'on':'';}catch(e){st.textContent='앱 연결 끊김';st.className='';}loadCue();}
load();poll();setInterval(poll,2000);
</script></body></html>`;

module.exports = { RemoteServer, readBody };
