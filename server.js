// 판서 화이트보드 · 실시간 공유 서버
// HTTP로 public/index.html을 제공하고, /ws 에서 WebSocket으로 보드 상태를 동기화합니다.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
// index.html은 public 폴더 안이나 저장소 맨 위, 어느 쪽에 있어도 찾습니다
const INDEX_PATH = [path.join(__dirname, 'public', 'index.html'), path.join(__dirname, 'index.html')]
  .find(p => fs.existsSync(p));
if (!INDEX_PATH) {
  console.error('index.html을 찾지 못했어요. public/index.html 또는 맨 위에 index.html을 올려 주세요.');
  process.exit(1);
}
const INDEX = fs.readFileSync(INDEX_PATH);

const MAX_STROKES = 50000;      // 보드 하나에 담을 수 있는 최대 획 수
const MAX_PTS = 90000;          // 획 하나의 최대 좌표 수(x,y,압력 = 3개씩)
const ROOM_RE = /^[a-z0-9-]{3,40}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const TOOLS = new Set(['pen', 'hl']);

fs.mkdirSync(DATA_DIR, { recursive: true });

// ---------- 보드(방) 관리 ----------
const rooms = new Map(); // id -> { strokes: Map<id, stroke>, seq, clients:Set, saveT, unloadT }

function roomFile(id) { return path.join(DATA_DIR, id + '.json'); }

function getRoom(id) {
  let r = rooms.get(id);
  if (r) { clearTimeout(r.unloadT); return r; }
  r = { strokes: new Map(), seq: 0, clients: new Set(), saveT: null, unloadT: null };
  try {
    const d = JSON.parse(fs.readFileSync(roomFile(id), 'utf8'));
    for (const s of d.strokes || []) r.strokes.set(s.id, s);
    r.seq = d.seq || r.strokes.size;
  } catch (_) { /* 새 보드 */ }
  rooms.set(id, r);
  return r;
}

function saveSoon(id, r) {
  clearTimeout(r.saveT);
  r.saveT = setTimeout(() => {
    const body = JSON.stringify({ seq: r.seq, strokes: [...r.strokes.values()] });
    fs.writeFile(roomFile(id) + '.tmp', body, err => {
      if (!err) fs.rename(roomFile(id) + '.tmp', roomFile(id), () => {});
    });
  }, 1500);
}

function validStroke(s) {
  return s && typeof s.id === 'string' && s.id.length <= 40 &&
    TOOLS.has(s.tool) && typeof s.color === 'string' && COLOR_RE.test(s.color) &&
    typeof s.size === 'number' && isFinite(s.size) && s.size > 0 && s.size < 5000 &&
    Array.isArray(s.pts) && s.pts.length >= 3 && s.pts.length <= MAX_PTS && s.pts.length % 3 === 0 &&
    s.pts.every(v => typeof v === 'number' && isFinite(v));
}

function broadcast(r, msg, except) {
  const data = typeof msg === 'string' ? msg : JSON.stringify(msg);
  for (const c of r.clients) if (c !== except && c.readyState === 1) c.send(data);
}

// ---------- HTTP ----------
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
  if (url.pathname === '/') {
    const id = crypto.randomBytes(5).toString('hex');
    res.writeHead(302, { Location: '/b/' + id });
    return res.end();
  }
  if (/^\/b\/[a-z0-9-]{3,40}\/?$/i.test(url.pathname)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    return res.end(INDEX);
  }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('보드를 찾을 수 없어요');
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 2 * 1024 * 1024 });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, 'http://x');
  const roomId = (url.searchParams.get('room') || '').toLowerCase();
  const cid = url.searchParams.get('cid') || '';
  if (!ROOM_RE.test(roomId) || !/^[a-z0-9]{6,16}$/.test(cid)) return ws.close(1008, 'bad request');
  const own = id => typeof id === 'string' && id.startsWith(cid + '.');

  const r = getRoom(roomId);
  r.clients.add(ws);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  const strokes = [...r.strokes.values()].sort((a, b) => a.z - b.z);
  ws.send(JSON.stringify({ t: 'init', strokes, n: r.clients.size }));
  broadcast(r, { t: 'n', n: r.clients.size }, ws);

  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (_) { return; }
    if (!m || typeof m.t !== 'string') return;

    if (m.t === 'add' && Array.isArray(m.s)) {
      const out = [];
      for (const s of m.s) {
        // 자기 획만 추가할 수 있습니다(남의 획 id로 덮어쓰기 방지)
        if (!validStroke(s) || !own(s.id) || r.strokes.size >= MAX_STROKES) continue;
        // 실행 취소로 되살린 획은 원래 순서를 유지하고, 새 획은 맨 위에 쌓습니다
        const z = (typeof s.z === 'number' && s.z > 0 && s.z <= r.seq) ? s.z : ++r.seq;
        const clean = { id: s.id, z, tool: s.tool, color: s.color, size: s.size, pts: s.pts };
        r.strokes.set(clean.id, clean);
        out.push(clean);
      }
      if (out.length) { broadcast(r, { t: 'add', s: out }); saveSoon(roomId, r); }
      return;
    }
    if (m.t === 'rm' && Array.isArray(m.ids)) {
      // 자기 획만 지울 수 있습니다
      const ids = m.ids.filter(id => own(id) && r.strokes.delete(id));
      if (ids.length) { broadcast(r, { t: 'rm', ids }, ws); saveSoon(roomId, r); }
      return;
    }
    // 그리는 중인 획: 저장하지 않고 다른 사람에게만 전달
    if ((m.t === 'lp' || m.t === 'le') && typeof m.id === 'string') {
      broadcast(r, raw.toString(), ws);
    }
  });

  ws.on('close', () => {
    r.clients.delete(ws);
    broadcast(r, { t: 'n', n: r.clients.size });
    if (cid) broadcast(r, { t: 'gone', cid });
    if (!r.clients.size) {
      r.unloadT = setTimeout(() => { if (!r.clients.size) rooms.delete(roomId); }, 5 * 60 * 1000);
    }
  });
});

// 끊긴 연결 정리(프록시가 유휴 연결을 끊지 않도록 30초마다 ping)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch (_) {}
  }
}, 30000);

server.listen(PORT, () => console.log(`화이트보드 서버 실행 중: http://localhost:${PORT}`));
