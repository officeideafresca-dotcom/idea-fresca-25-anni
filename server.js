const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '2525';
const TABLE_COUNT = 10;
const MAX_PHOTOS_PER_TABLE = 20;
const DEFAULT_DURATION_SEC = 30 * 60;

const ICONS = ['mountain', 'hands', 'sprout', 'compass', 'rocket', 'star'];

function makeTable(id) {
  return {
    id,
    teamLeaderName: '',
    leaderDeviceId: null, // solo questo dispositivo può inserire/modificare i numeri del tavolo
    lang: null,
    color: TABLE_COLORS[(id - 1) % TABLE_COLORS.length],
    icon: null,
    metrics: null, // { network: number, retention: number, symbolicValue: number, symbolicLabel: string }
    metricsSubmittedAt: null,
    photos: [], // { id, dataUrl, ts }
    updatedAt: null,
  };
}

const TABLE_COLORS = [
  '#1F6F5C', '#C79A2B', '#2B5FAD', '#B04A3B', '#5B3E9E',
  '#2E8B8B', '#A15C2B', '#3B7D3B', '#7A3E6E', '#345A7A',
];

let state = freshState();

function freshState() {
  const tables = {};
  for (let i = 1; i <= TABLE_COUNT; i++) tables[i] = makeTable(i);
  return {
    status: 'lobby', // lobby | running | paused | finished
    phase: 0, // 0..4
    startedAt: null,
    pausedRemainingSec: null,
    durationSec: DEFAULT_DURATION_SEC,
    tables,
  };
}

function computeTotals(tables) {
  const list = Object.values(tables);
  const submitted = list.filter((t) => t.metrics);
  const network = submitted.reduce((s, t) => s + (t.metrics.network || 0), 0);
  const retentionAvg = submitted.length
    ? submitted.reduce((s, t) => s + (t.metrics.retention || 0), 0) / submitted.length
    : 0;
  const symbolic = submitted.reduce((s, t) => s + (t.metrics.symbolicValue || 0), 0);
  const photosCount = list.reduce((s, t) => s + t.photos.length, 0);
  return {
    network,
    retention: Math.round(retentionAvg * 10) / 10,
    symbolic,
    tablesSubmitted: submitted.length,
    tablesTotal: TABLE_COUNT,
    photosCount,
  };
}

function publicTableSummary(t) {
  return {
    id: t.id,
    teamLeaderName: t.teamLeaderName,
    leaderDeviceId: t.leaderDeviceId,
    lang: t.lang,
    color: t.color,
    icon: t.icon,
    metrics: t.metrics,
    photosCount: t.photos.length,
    updatedAt: t.updatedAt,
  };
}

function fullStatePayload() {
  return {
    status: state.status,
    phase: state.phase,
    startedAt: state.startedAt,
    durationSec: state.durationSec,
    pausedRemainingSec: state.pausedRemainingSec,
    tables: state.tables,
    totals: computeTotals(state.tables),
  };
}

function getLocalIPs() {
  const nets = os.networkInterfaces();
  const ips = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

function buildPublicUrl(req) {
  const hostHeader = req.get('host') || `localhost:${PORT}`;
  const hostname = hostHeader.split(':')[0];
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    const ips = getLocalIPs();
    return `http://${ips[0] || 'localhost'}:${PORT}/`;
  }
  const protocol = req.protocol || 'http';
  return `${protocol}://${hostHeader}/`;
}

const app = express();
app.set('trust proxy', true); // rispetta X-Forwarded-Proto quando l'app gira dietro il proxy HTTPS di Render
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 10 * 1024 * 1024 });

app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob:; connect-src 'self' ws: wss:; " +
      "base-uri 'self'; object-src 'none'; frame-ancestors 'self';"
  );
  next();
});

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  lastModified: true,
  maxAge: 0,
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

app.get('/screen', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'screen.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/api/state', (req, res) => {
  res.json(fullStatePayload());
});

app.get('/api/network-info', (req, res) => {
  res.json({ ips: getLocalIPs(), port: PORT });
});

app.get('/api/qr', async (req, res) => {
  const url = req.query.host ? `http://${req.query.host}:${PORT}/` : buildPublicUrl(req);
  try {
    const buf = await QRCode.toBuffer(url, { width: 480, margin: 1, color: { dark: '#0B3B36', light: '#FFFFFF' } });
    res.setHeader('Content-Type', 'image/png');
    res.send(buf);
  } catch (e) {
    res.status(500).json({ error: 'qr_failed' });
  }
});

io.on('connection', (socket) => {
  socket.emit('init', fullStatePayload());

  socket.on('request-state', () => {
    socket.emit('init', fullStatePayload());
  });

  socket.on('claim-leader', ({ tableId, deviceId, name }) => {
    const t = state.tables[tableId];
    if (!t || !deviceId) return;
    if (t.leaderDeviceId && t.leaderDeviceId !== deviceId) {
      socket.emit('leader:claim-error', { tableId, message: 'Questo tavolo ha già un Team Leader' });
      return;
    }
    t.leaderDeviceId = deviceId;
    if (name) t.teamLeaderName = String(name).slice(0, 60);
    t.updatedAt = Date.now();
    io.emit('leader:update', { tableId: t.id, leaderDeviceId: t.leaderDeviceId, teamLeaderName: t.teamLeaderName });
  });

  socket.on('release-leader', ({ tableId, deviceId }) => {
    const t = state.tables[tableId];
    if (!t || t.leaderDeviceId !== deviceId) return;
    t.leaderDeviceId = null;
    t.updatedAt = Date.now();
    io.emit('leader:update', { tableId: t.id, leaderDeviceId: null, teamLeaderName: t.teamLeaderName });
  });

  socket.on('submit-metrics', ({ tableId, deviceId, teamLeaderName, lang, metrics }) => {
    const t = state.tables[tableId];
    if (!t || !metrics) return;
    if (!t.leaderDeviceId || t.leaderDeviceId !== deviceId) {
      socket.emit('leader:claim-error', { tableId, message: 'Solo il Team Leader del tavolo può inserire i numeri' });
      return;
    }
    t.teamLeaderName = String(teamLeaderName || t.teamLeaderName || '').slice(0, 60);
    if (lang) t.lang = lang;
    t.metrics = {
      network: clampNumber(metrics.network, 0, 999999),
      retention: clampNumber(metrics.retention, 0, 100),
      symbolicValue: clampNumber(metrics.symbolicValue, 0, 9999999),
      symbolicLabel: String(metrics.symbolicLabel || '').slice(0, 80),
    };
    t.metricsSubmittedAt = Date.now();
    t.updatedAt = Date.now();
    io.emit('metrics:update', { tableId: t.id, table: publicTableSummary(t), totals: computeTotals(state.tables) });
  });

  socket.on('submit-icon', ({ tableId, icon }) => {
    const t = state.tables[tableId];
    if (!t || !ICONS.includes(icon)) return;
    t.icon = icon;
    t.updatedAt = Date.now();
    io.emit('icon:update', { tableId: t.id, icon });
  });

  socket.on('submit-photo', ({ tableId, dataUrl, lang }) => {
    const t = state.tables[tableId];
    if (!t || !dataUrl) return;
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(dataUrl)) return;
    if (dataUrl.length > 400 * 1024) return; // guard: reject oversized payloads (client should compress)
    if (t.photos.length >= MAX_PHOTOS_PER_TABLE) return;
    if (lang) t.lang = t.lang || lang;
    const photo = { id: `${tableId}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, dataUrl, ts: Date.now() };
    t.photos.push(photo);
    t.updatedAt = Date.now();
    io.emit('photo:add', { tableId: t.id, photo, photosCount: t.photos.length, totals: computeTotals(state.tables) });
  });

  socket.on('admin', ({ pin, action, payload }) => {
    if (pin !== ADMIN_PIN) {
      socket.emit('admin:error', { message: 'PIN errato', code: 'bad_pin' });
      return;
    }
    switch (action) {
      case 'start': {
        state.status = 'running';
        state.phase = 1;
        state.startedAt = Date.now();
        state.pausedRemainingSec = null;
        if (payload && payload.durationSec) state.durationSec = payload.durationSec;
        break;
      }
      case 'pause': {
        if (state.status === 'running' && state.startedAt) {
          const elapsed = (Date.now() - state.startedAt) / 1000;
          state.pausedRemainingSec = Math.max(0, state.durationSec - elapsed);
          state.status = 'paused';
        }
        break;
      }
      case 'resume': {
        if (state.status === 'paused' && state.pausedRemainingSec != null) {
          state.durationSec = state.pausedRemainingSec;
          state.startedAt = Date.now();
          state.pausedRemainingSec = null;
          state.status = 'running';
        }
        break;
      }
      case 'set-phase': {
        if (payload && Number.isInteger(payload.phase)) state.phase = payload.phase;
        break;
      }
      case 'reset': {
        state = freshState();
        io.emit('reset');
        io.emit('init', fullStatePayload());
        return;
      }
      case 'broadcast-image': {
        const dataUrl = payload && payload.dataUrl;
        if (!dataUrl || !/^data:image\/jpeg;base64,/.test(dataUrl) || dataUrl.length > 8 * 1024 * 1024) {
          socket.emit('admin:error', { message: 'Immagine non valida o troppo pesante', code: 'invalid_image' });
          return;
        }
        io.emit('final-image', { dataUrl, ts: Date.now() });
        return;
      }
      default:
        return;
    }
    io.emit('phase:update', {
      status: state.status,
      phase: state.phase,
      startedAt: state.startedAt,
      durationSec: state.durationSec,
      pausedRemainingSec: state.pausedRemainingSec,
    });
  });
});

function clampNumber(v, min, max) {
  const n = Number(v);
  if (Number.isNaN(n)) return 0;
  return Math.min(max, Math.max(min, n));
}

server.listen(PORT, () => {
  const base = process.env.RENDER_EXTERNAL_URL || `http://${getLocalIPs()[0] || 'localhost'}:${PORT}`;
  console.log(`Idea Fresca 25 Anni - server avviato sulla porta ${PORT}`);
  console.log(`Partecipanti (QR): ${base}/`);
  console.log(`Schermo grande:    ${base}/screen`);
  console.log(`PIN Admin: ${ADMIN_PIN}`);
});
