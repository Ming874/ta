// 聖心醫院 · 多人連線伺服器
// 同一個 HTTP 埠:提供 dist/ 靜態檔(正確 MIME、br/gzip、Range、SPA fallback、跨來源隔離標頭)與 WebSocket /ws。
// WebSocket:房間(6 碼代碼,合作 4 人 / 對戰 8 人)、暱稱、房主與房主轉移、斷線保留座位(可重連)、心跳與逾時、
// 訊息頻率/大小上限、公開房間列表。遊戲本身由房主的瀏覽器模擬,伺服器只負責轉發:
//   文字訊息(JSON,低頻事件):{t:'g', k, d, to?} → 轉給房間其他人(或指定座位),附上 f = 發送者座位
//   二進位訊息(高頻:玩家狀態 / 殭屍快照):第 0 位元組 = 種類、第 1 位元組由伺服器填入發送者座位,原封轉發
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(process.env.DIST_DIR || path.join(HERE, '..', 'dist'));
const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const PROTO = 1; // 與 src/net/protocol.js 的 PROTO 一致
const DEV = process.env.NODE_ENV !== 'production';

const L = {
  conns: 2000, perIp: 16, rooms: 500, createPerMin: 8, payload: 64 * 1024,
  msgRate: 90, msgBurst: 180, byteRate: 128 * 1024, byteBurst: 384 * 1024, strikes: 400,
  chatRate: 1 / 1.1, chatBurst: 5, chatLen: 160, nameLen: 16,
  grace: 20000, hostGrace: 2500, idle: 45000, ping: 5000, slow: 768 * 1024, dead: 4 * 1024 * 1024,
};
const MAXP = { coop: 4, pvp: 8 };
const BIN = { STATE: 1, ZSNAP: 2 }; // 二進位訊息種類
const BIN_MAX = { [BIN.STATE]: 2048, [BIN.ZSNAP]: 24576 };
const HOST_ONLY = new Set(['zn', 'zd', 'hz', 'rs', 're', 'go', 'ps', 'pe', 'hurt', 'kn', 'sh', 'sync', 'rv', 'rq', 'cd']);
const now = () => Date.now();
const mono = () => performance.now();

// ---------- 小工具 ----------
class Bucket { // 令牌桶:rate 每秒補充、burst 上限
  constructor(rate, burst) { this.rate = rate; this.burst = burst; this.tokens = burst; this.t = mono(); }
  take(n = 1) {
    const t = mono();
    this.tokens = Math.min(this.burst, this.tokens + ((t - this.t) / 1000) * this.rate);
    this.t = t;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}
// 控制字元、零寬字元、雙向文字控制字元、角括號
const BAD_CP = (cp) => cp < 0x20 || (cp >= 0x7f && cp <= 0x9f) || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x2028 && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069) || cp === 0xfeff || cp === 0x3c || cp === 0x3e;
const clean = (s, max) => {
  if (typeof s !== 'string') return '';
  // 去掉控制字元與角括號,合併空白,依字元(code point)截斷
  let t = '';
  for (const ch of s) if (!BAD_CP(ch.codePointAt(0))) t += ch;
  t = t.replace(/\s+/g, ' ').trim();
  return Array.from(t).slice(0, max).join('');
};
const int = (v, lo, hi, def) => (Number.isFinite(+v) ? Math.max(lo, Math.min(hi, Math.round(+v))) : def);
const CODE_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 不含易混淆的 I O 0 1
const CODE_RE = /^[A-HJ-NP-Z2-9]{6}$/;
function newCode() {
  for (let i = 0; i < 64; i++) {
    let s = '';
    for (let k = 0; k < 6; k++) s += CODE_ABC[crypto.randomInt(CODE_ABC.length)];
    if (!rooms.has(s)) return s;
  }
  return null;
}
function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf) return xf.split(',')[0].trim();
  return req.socket.remoteAddress || '?';
}

// ---------- 統計 ----------
const stat = { msgIn: 0, msgOut: 0, byteIn: 0, byteOut: 0, binIn: 0, rate: { msgIn: 0, msgOut: 0, byteIn: 0, byteOut: 0, binIn: 0 }, started: now(), peakConns: 0, dropped: 0, kicked: 0 };
setInterval(() => {
  for (const k of ['msgIn', 'msgOut', 'byteIn', 'byteOut', 'binIn']) { stat.rate[k] = stat[k]; stat[k] = 0; }
}, 1000).unref();

// =====================================================================
// 靜態檔
// =====================================================================
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.ktx2': 'image/ktx2', '.hdr': 'image/vnd.radiance', '.exr': 'image/x-exr', '.basis': 'application/octet-stream',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.wasm': 'application/wasm',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.webmanifest': 'application/manifest+json', '.pdf': 'application/pdf',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.map', '.txt', '.md', '.xml', '.csv', '.svg', '.gltf', '.wasm', '.webmanifest', '.obj', '.hdr']);
// 跨來源隔離(SharedArrayBuffer 需要):所有回應都帶;靜態資源另外標示只供同源使用
const ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};
const brotli = promisify(zlib.brotliCompress), gzip = promisify(zlib.gzip);
const zcache = new Map(); // `${file}|${mtime}|${enc}` → Promise<Buffer>
let zbytes = 0;
const ZCACHE_MAX = 96 * 1024 * 1024;

function compressed(file, st, enc) {
  const key = `${file}|${st.mtimeMs}|${enc}`;
  let p = zcache.get(key);
  if (!p) {
    p = fsp.readFile(file).then((buf) => (enc === 'br'
      ? brotli(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: buf.length > 4e6 ? 7 : 10, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } })
      : gzip(buf, { level: 9 }))).then((out) => {
      zbytes += out.length;
      while (zbytes > ZCACHE_MAX && zcache.size > 1) { // 超出上限:丟掉最舊的
        const [k0, v0] = zcache.entries().next().value;
        zcache.delete(k0);
        v0.then((b) => { zbytes -= b.length; }, () => {});
      }
      return out;
    });
    p.catch(() => zcache.delete(key));
    zcache.set(key, p);
  }
  return p;
}

const statOf = (f) => fsp.stat(f).catch(() => null);
function plain(res, code, text, extra = {}) {
  res.writeHead(code, { ...ISOLATION, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(text);
}
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { ...ISOLATION, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

async function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return plain(res, 400, 'Bad Request'); }
  if (rel.includes('\0') || rel.includes('\\')) return plain(res, 400, 'Bad Request');
  rel = path.posix.normalize(rel);
  if (!rel.startsWith('/')) rel = '/' + rel;
  if (rel.endsWith('/')) rel += 'index.html';
  let file = path.join(DIST, rel);
  if (file !== DIST && !file.startsWith(DIST + path.sep)) return plain(res, 403, 'Forbidden');
  let st = await statOf(file);
  if (st && st.isDirectory()) { file = path.join(file, 'index.html'); st = await statOf(file); }
  if (!st || !st.isFile()) {
    // 有副檔名的資源不存在 → 404(讓 tryLoadGLB 之類的探測正確失敗);其他路徑 → SPA fallback
    if (path.posix.extname(rel) && rel !== '/index.html') return plain(res, 404, 'Not Found');
    file = path.join(DIST, 'index.html');
    st = await statOf(file);
    if (!st) return plain(res, 503, '尚未建置前端:請先執行 npm run build(開發時請用 Vite dev server)');
  }
  const ext = path.extname(file).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const immutable = rel.startsWith('/assets/');
  const headers = {
    ...ISOLATION,
    'Content-Type': type,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : ext === '.html' ? 'no-cache' : 'public, max-age=3600',
    ETag: etag,
    'Last-Modified': st.mtime.toUTCString(),
    'Accept-Ranges': 'bytes',
  };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }

  // 壓縮(文字類資源)
  const ae = String(req.headers['accept-encoding'] || '');
  const enc = COMPRESSIBLE.has(ext) && st.size > 1024 && st.size < 32e6 ? (/\bbr\b/.test(ae) ? 'br' : /\bgzip\b/.test(ae) ? 'gzip' : null) : null;
  if (enc) {
    try {
      const body = await compressed(file, st, enc);
      headers['Content-Encoding'] = enc;
      headers['Content-Length'] = body.length;
      headers.Vary = 'Accept-Encoding';
      delete headers['Accept-Ranges'];
      res.writeHead(200, headers);
      return req.method === 'HEAD' ? res.end() : res.end(body);
    } catch { /* 壓縮失敗就送原檔 */ }
  }

  // Range(音訊/影片串流)
  let start = 0, end = st.size - 1, code = 200;
  const range = req.headers.range;
  if (range && /^bytes=\d*-\d*$/.test(range) && st.size > 0) {
    const [a, b] = range.slice(6).split('-');
    if (a === '') { start = Math.max(0, st.size - Number(b)); } else { start = Number(a); if (b !== '') end = Math.min(end, Number(b)); }
    if (start > end || start >= st.size) { res.writeHead(416, { ...ISOLATION, 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    code = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
  }
  headers['Content-Length'] = end - start + 1;
  res.writeHead(code, headers);
  if (req.method === 'HEAD' || st.size === 0) return res.end();
  const stream = fs.createReadStream(file, { start, end });
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

// 啟動後在背景先把文字資源壓好,第一位玩家不用等
async function warm() {
  const walk = async (dir) => {
    let ents;
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) await walk(f);
      else if (COMPRESSIBLE.has(path.extname(f).toLowerCase())) {
        const st = await statOf(f);
        if (st && st.size > 1024 && st.size < 8e6) { await compressed(f, st, 'br').catch(() => {}); await compressed(f, st, 'gzip').catch(() => {}); }
      }
    }
  };
  const t = mono();
  await walk(DIST);
  if (zcache.size) console.log(`[http] 預先壓縮 ${zcache.size} 個檔案 ${(zbytes / 1024).toFixed(0)}KB(${(mono() - t).toFixed(0)}ms)`);
}

// =====================================================================
// 房間與連線
// =====================================================================
const rooms = new Map(); // code → Room
const conns = new Set();
const byToken = new Map(); // 房間內的連線:token → Conn(斷線重連用)
const ipConns = new Map();
const ipCreates = new Map(); // ip → [時間戳]
let nextConn = 1;

class Conn {
  constructor(ws, ip) {
    this.id = nextConn++;
    this.ws = ws;
    this.ip = ip;
    this.name = '';
    this.hello = false;
    this.room = null;
    this.slot = -1;
    this.ready = false;
    this.joined = 0;
    this.token = crypto.randomBytes(12).toString('base64url');
    this.gone = 0; // 斷線時間(保留座位中)
    this.misses = 0;
    this.pingAt = 0;
    this.rtt = 0;
    this.last = now();
    this.msgs = new Bucket(L.msgRate, L.msgBurst);
    this.bytes = new Bucket(L.byteRate, L.byteBurst);
    this.chat = new Bucket(L.chatRate, L.chatBurst);
    this.strikes = 0;
    this.strikeT = 0;
  }
  raw(s) {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return;
    if (ws.bufferedAmount > L.dead) { ws.terminate(); return; }
    ws.send(s);
    stat.msgOut++;
    stat.byteOut += s.length;
  }
  send(obj) { this.raw(JSON.stringify(obj)); }
}

class Room {
  constructor(code, mode, opts) {
    this.code = code;
    this.mode = mode;
    this.max = MAXP[mode];
    this.name = clean(opts.name, 24);
    this.pub = opts.pub !== false;
    this.settings = settingsOf(mode, opts.settings);
    this.slots = new Array(8).fill(null);
    this.host = 0;
    this.state = 'lobby';
    this.match = 0;
    this.created = now();
    this.started = 0;
  }
  members() { return this.slots.filter(Boolean); }
  live() { return this.slots.filter((c) => c && !c.gone); }
  freeSlot() { for (let i = 0; i < this.max; i++) if (!this.slots[i]) return i; return -1; }
  player(c) { return { id: c.slot, name: c.name, ready: c.ready, conn: !c.gone, rtt: c.rtt }; }
  info() {
    return {
      code: this.code, mode: this.mode, name: this.name, pub: this.pub, max: this.max, host: this.host, state: this.state,
      match: this.match, settings: this.settings, players: this.members().map((c) => this.player(c)),
    };
  }
  brief() {
    const host = this.slots[this.host];
    return { code: this.code, mode: this.mode, name: this.name || `${host?.name || '?'} 的房間`, n: this.members().length, max: this.max, state: this.state, settings: this.settings };
  }
  cast(obj, except = null) { this.castRaw(JSON.stringify(obj), except); }
  castRaw(s, except = null) { for (const c of this.slots) if (c && c !== except && !c.gone) c.raw(s); }
}

function settingsOf(mode, s = {}) {
  s = s && typeof s === 'object' ? s : {};
  if (mode === 'pvp') return { zombies: !!s.zombies, kills: int(s.kills, 5, 50, 20), minutes: int(s.minutes, 3, 20, 8) };
  return { diff: ['easy', 'normal', 'hard'].includes(s.diff) ? s.diff : 'normal', late: s.late !== false };
}

function publicRooms() {
  const list = [];
  for (const r of rooms.values()) if (r.pub && r.live().length) list.push(r.brief());
  list.sort((a, b) => (a.n >= a.max) - (b.n >= b.max) || b.n - a.n);
  return list.slice(0, 60);
}

function join(c, room) {
  const slot = room.freeSlot();
  if (slot < 0) return c.send({ t: 'error', code: 'full', msg: '房間已滿' });
  if (room.state === 'playing' && room.mode === 'coop' && room.settings.late === false) return c.send({ t: 'error', code: 'started', msg: '遊戲已開始,房主不允許中途加入' });
  leave(c, 'switch');
  c.room = room;
  c.slot = slot;
  c.ready = false;
  c.joined = mono();
  room.slots[slot] = c;
  byToken.set(c.token, c);
  if (room.live().length === 1 && !room.slots[room.host]) room.host = slot;
  c.send({ t: 'joined', room: room.info(), you: slot, token: c.token });
  room.cast({ t: 'peer', p: room.player(c), join: true }, c);
}

function leave(c, why = 'leave') {
  const room = c.room;
  if (!room) return;
  room.slots[c.slot] = null;
  byToken.delete(c.token);
  c.room = null;
  const slot = c.slot;
  c.slot = -1;
  c.ready = false;
  if (!room.members().length) { rooms.delete(room.code); log(`[room] ${room.code} 關閉`); return; }
  room.cast({ t: 'left', id: slot, why });
  if (room.host === slot) migrate(room);
}

// 房主轉移:挑最早加入、仍在線的玩家
function migrate(room) {
  const cand = room.live().sort((a, b) => a.joined - b.joined)[0];
  if (!cand) return;
  if (cand.slot === room.host && room.slots[room.host] && !room.slots[room.host].gone) return;
  room.host = cand.slot;
  room.cast({ t: 'host', id: cand.slot });
  log(`[room] ${room.code} 房主轉移 → ${cand.slot}(${cand.name})`);
}

// 斷線:保留座位一段時間,可用 token 重連;房主斷線較短的寬限後轉移
function drop(c) {
  const room = c.room;
  c.ws = null;
  if (!room) return;
  c.gone = now();
  room.cast({ t: 'peer', p: room.player(c) });
  if (room.host === c.slot) setTimeout(() => { if (c.gone && c.room === room && room.host === c.slot) migrate(room); }, L.hostGrace).unref();
  setTimeout(() => { if (c.gone && c.room === room) leave(c, 'timeout'); }, L.grace).unref();
}

// 用 token 接手原本的座位;舊連線可能還沒被偵測到斷線(半開的 TCP),直接踢掉舊的
function resume(c, token) {
  const old = byToken.get(token);
  if (!old || old === c || !old.room) return false;
  const room = old.room;
  if (old.ws) { const ws = old.ws; old.ws = null; try { ws.terminate(); } catch { /* 忽略 */ } }
  Object.assign(c, { name: old.name, room, slot: old.slot, ready: old.ready, joined: old.joined, token: old.token, gone: 0 });
  room.slots[c.slot] = c;
  byToken.set(c.token, c);
  old.room = null;
  c.send({ t: 'joined', room: room.info(), you: c.slot, token: c.token, resumed: true });
  room.cast({ t: 'peer', p: room.player(c), back: true }, c);
  return true;
}

function log(...a) { console.log(new Date().toISOString().slice(11, 19), ...a); }

// ---------- 訊息處理 ----------
function onText(c, msg) {
  const t = msg.t;
  if (!c.hello && t !== 'hello' && t !== 'ping') return;
  const room = c.room;
  switch (t) {
    case 'hello': {
      if (c.hello) return;
      if (msg.v !== PROTO) { c.send({ t: 'error', code: 'version', msg: '版本不符,請重新整理頁面' }); return c.ws.close(4000, 'version'); }
      c.hello = true;
      c.name = clean(msg.name, L.nameLen) || `倖存者${String(c.id % 1000).padStart(3, '0')}`;
      const resumed = typeof msg.token === 'string' && resume(c, msg.token);
      c.send({ t: 'welcome', id: c.id, v: PROTO, name: c.name, token: c.token, resumed, now: mono() });
      return;
    }
    case 'ping': return c.send({ t: 'pong', c: msg.c, s: mono() });
    case 'name': {
      c.name = clean(msg.name, L.nameLen) || c.name;
      if (room) room.cast({ t: 'peer', p: room.player(c) });
      return;
    }
    case 'list': return c.send({ t: 'rooms', list: publicRooms() });
    case 'create': {
      const mode = msg.mode === 'pvp' ? 'pvp' : 'coop';
      if (rooms.size >= L.rooms) return c.send({ t: 'error', code: 'busy', msg: '伺服器房間已滿,請稍後再試' });
      const hist = (ipCreates.get(c.ip) || []).filter((x) => now() - x < 60000);
      if (hist.length >= L.createPerMin) return c.send({ t: 'error', code: 'rate', msg: '建立房間太頻繁,請稍候' });
      hist.push(now());
      ipCreates.set(c.ip, hist);
      const code = newCode();
      if (!code) return c.send({ t: 'error', code: 'busy', msg: '無法建立房間' });
      const r = new Room(code, mode, msg);
      rooms.set(code, r);
      log(`[room] ${code} 建立(${mode})by ${c.name}`);
      join(c, r);
      r.host = c.slot;
      return;
    }
    case 'join': {
      const code = String(msg.code || '').toUpperCase().trim();
      if (!CODE_RE.test(code)) return c.send({ t: 'error', code: 'code', msg: '房間代碼格式錯誤(6 碼英數字)' });
      const r = rooms.get(code);
      if (!r) return c.send({ t: 'error', code: 'notfound', msg: '找不到這個房間' });
      if (r === room) return c.send({ t: 'joined', room: r.info(), you: c.slot, token: c.token });
      return join(c, r);
    }
    case 'leave': return leave(c);
    case 'ready': {
      if (!room) return;
      c.ready = !!msg.on;
      return room.cast({ t: 'peer', p: room.player(c) });
    }
    case 'settings': {
      if (!room || room.host !== c.slot || room.state !== 'lobby') return;
      if (msg.mode === 'coop' || msg.mode === 'pvp') {
        const n = room.members().length;
        if (MAXP[msg.mode] >= n) { room.mode = msg.mode; room.max = MAXP[msg.mode]; }
      }
      if (typeof msg.pub === 'boolean') room.pub = msg.pub;
      if (typeof msg.name === 'string') room.name = clean(msg.name, 24);
      room.settings = settingsOf(room.mode, { ...room.settings, ...(msg.settings || {}) });
      return room.cast({ t: 'room', room: room.info() });
    }
    case 'start': {
      if (!room || room.host !== c.slot) return;
      if (room.mode === 'pvp' && room.live().length < 2) return c.send({ t: 'error', code: 'players', msg: '對戰至少需要 2 位玩家' });
      room.state = 'playing';
      room.match++;
      room.started = now();
      for (const m of room.members()) m.ready = false;
      const data = msg.data && typeof msg.data === 'object' ? msg.data : {};
      const s = JSON.stringify({ t: 'start', match: room.match, seed: crypto.randomInt(1 << 30), data, room: room.info() });
      if (s.length > 8192) return;
      log(`[room] ${room.code} 開始第 ${room.match} 場(${room.mode},${room.live().length} 人)`);
      return room.castRaw(s);
    }
    case 'lobby': {
      if (!room || room.host !== c.slot) return;
      room.state = 'lobby';
      for (const m of room.members()) m.ready = false;
      return room.cast({ t: 'lobby', room: room.info() });
    }
    case 'kick': {
      if (!room || room.host !== c.slot) return;
      const target = room.slots[msg.id | 0];
      if (!target || target === c) return;
      target.send({ t: 'kicked', msg: '你被房主移出房間' });
      leave(target, 'kick');
      stat.kicked++;
      return;
    }
    case 'chat': {
      if (!room) return;
      if (!c.chat.take()) return c.send({ t: 'error', code: 'chat', msg: '訊息太頻繁' });
      const text = clean(msg.text, L.chatLen);
      if (!text) return;
      return room.cast({ t: 'chat', id: c.slot, name: c.name, text, team: !!msg.team });
    }
    case 'g': {
      if (!room || c.gone) return;
      const k = msg.k;
      if (typeof k !== 'string' || k.length > 8) return;
      if (HOST_ONLY.has(k) && room.host !== c.slot) return;
      const out = JSON.stringify({ t: 'g', k, f: c.slot, d: msg.d ?? null });
      if (msg.to !== undefined && msg.to !== null) {
        const tc = room.slots[msg.to | 0];
        if (tc && !tc.gone && tc !== c) tc.raw(out);
      } else room.castRaw(out, c);
      return;
    }
    default:
  }
}

function onBinary(c, buf) {
  const room = c.room;
  if (!room || c.gone || buf.length < 4) return;
  const kind = buf[0];
  const max = BIN_MAX[kind];
  if (!max || buf.length > max) return;
  if (kind === BIN.ZSNAP && room.host !== c.slot) return;
  stat.binIn++;
  buf[1] = c.slot; // 由伺服器填發送者座位(用戶端無法冒充)
  for (const o of room.slots) {
    if (!o || o === c || o.gone) continue;
    const ws = o.ws;
    if (!ws || ws.readyState !== 1) continue;
    if (ws.bufferedAmount > L.slow) { stat.dropped++; continue; } // 慢速連線:丟掉這一幀(下一幀會補上)
    ws.send(buf, { binary: true });
    stat.msgOut++;
    stat.byteOut += buf.length;
  }
}

function onConnect(ws, ip) {
  const c = new Conn(ws, ip);
  conns.add(c);
  ipConns.set(ip, (ipConns.get(ip) || 0) + 1);
  stat.peakConns = Math.max(stat.peakConns, conns.size);
  ws.on('message', (data, isBinary) => {
    const len = data.length;
    c.last = now();
    stat.msgIn++;
    stat.byteIn += len;
    if (!c.msgs.take() || !c.bytes.take(len)) {
      const t = now();
      if (t - c.strikeT > 10000) { c.strikeT = t; c.strikes = 0; }
      if (++c.strikes > L.strikes) { log(`[ws] ${c.id} 訊息過量,斷線`); ws.close(1008, 'rate limit'); }
      return;
    }
    if (isBinary) return onBinary(c, data);
    if (len > 16384) return;
    let msg;
    try { msg = JSON.parse(data.toString('utf8')); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    try { onText(c, msg); } catch (e) { log('[ws] 處理訊息錯誤', e); }
  });
  ws.on('pong', () => { c.misses = 0; c.rtt = Math.round(mono() - c.pingAt); });
  ws.on('error', () => {});
  ws.on('close', () => {
    conns.delete(c);
    const n = (ipConns.get(ip) || 1) - 1;
    if (n > 0) ipConns.set(ip, n); else ipConns.delete(ip);
    if (c.ws !== ws) return; // 已被重連接手
    if (c.room) drop(c);
  });
}

// 心跳:每 5 秒 ping;連續 2 次沒回應或 45 秒沒任何訊息就斷線。順便廣播各房間的延遲
setInterval(() => {
  const t = now();
  for (const c of conns) {
    if (!c.ws) continue;
    if (c.misses >= 2 || t - c.last > L.idle) { c.ws.terminate(); continue; }
    c.misses++;
    c.pingAt = mono();
    try { c.ws.ping(); } catch { /* 忽略 */ }
  }
  for (const r of rooms.values()) {
    const live = r.live();
    if (live.length > 1 || r.state === 'playing') r.cast({ t: 'pings', r: live.map((c) => [c.slot, c.rtt]) });
  }
}, L.ping).unref();

// =====================================================================
// HTTP 伺服器
// =====================================================================
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://local');
    const p = url.pathname;
    if (p === '/healthz') return plain(res, 200, 'ok');
    if (p === '/api/rooms') return json(res, 200, { rooms: publicRooms() });
    if (p === '/api/stats') {
      return json(res, 200, {
        uptime: Math.round((now() - stat.started) / 1000), conns: conns.size, peakConns: stat.peakConns, rooms: rooms.size,
        playing: [...rooms.values()].filter((r) => r.state === 'playing').length, perSec: stat.rate, droppedFrames: stat.dropped,
        mem: Math.round(process.memoryUsage().rss / 1048576), zcache: zcache.size,
      });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return plain(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
    await serveStatic(req, res, p);
  } catch (e) {
    log('[http] 錯誤', e);
    if (!res.headersSent) plain(res, 500, 'Internal Server Error'); else res.destroy();
  }
});
server.on('clientError', (err, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch { /* 忽略 */ } });
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

const wss = new WebSocketServer({ noServer: true, maxPayload: L.payload, perMessageDeflate: false, clientTracking: false });
server.on('upgrade', (req, socket, head) => {
  let pathname = '/';
  try { pathname = new URL(req.url, 'http://local').pathname; } catch { /* 忽略 */ }
  if (pathname !== '/ws') { socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); return socket.destroy(); }
  const ip = clientIp(req);
  if (conns.size >= L.conns || (ipConns.get(ip) || 0) >= L.perIp) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    return socket.destroy();
  }
  socket.setNoDelay(true);
  wss.handleUpgrade(req, socket, head, (ws) => onConnect(ws, ip));
});

server.listen(PORT, HOST, () => {
  log(`[server] http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  ws:/ws  dist=${DIST}${fs.existsSync(DIST) ? '' : '(不存在,僅提供 WebSocket)'}${DEV ? '  [dev]' : ''}`);
  if (fs.existsSync(DIST)) warm();
});

function shutdown(sig) {
  log(`[server] 收到 ${sig},關閉中…`);
  for (const c of conns) { try { c.send({ t: 'error', code: 'restart', msg: '伺服器重新啟動中,請稍後重新連線' }); c.ws?.close(1001, 'restart'); } catch { /* 忽略 */ } }
  server.close();
  setTimeout(() => process.exit(0), 800).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
