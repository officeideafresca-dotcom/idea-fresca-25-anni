const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '2525';
const MAX_PHOTOS = 200;
const DEFAULT_DURATION_SEC = 30 * 60;

let state = freshState();

function freshState() {
  return {
    status: 'lobby', // lobby | running | paused | finished
    phase: 0, // 0..4
    startedAt: null,
    pausedRemainingSec: null,
    durationSec: DEFAULT_DURATION_SEC,
    photos: [], // { id, dataUrl, message, ts }
    quizLiveUrl: '',
    quizLivePin: '',
    quizRecap: null, // riepilogo del quiz letto da Quiz Live (vedi fetch-quiz-recap)
  };
}

function fullStatePayload() {
  return {
    status: state.status,
    phase: state.phase,
    startedAt: state.startedAt,
    durationSec: state.durationSec,
    pausedRemainingSec: state.pausedRemainingSec,
    photos: state.photos,
    photosTotal: state.photos.length,
    quizRecap: state.quizRecap,
  };
}

// Costruisce un riepilogo leggero (classifica + quante persone hanno scelto ogni opzione,
// domanda per domanda) a partire dai dati grezzi letti dall'endpoint /api/results di Quiz
// Live: evitiamo di portarci dietro la storia completa delle risposte di ogni giocatore
// sullo schermo, solo i conteggi già calcolati.
function buildQuizRecap(data) {
  const questions = Array.isArray(data.questions) ? data.questions : [];
  const players = Array.isArray(data.players) ? data.players : [];
  const topPlayers = players
    .slice()
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 5)
    .map((p) => ({ nickname: String(p.nickname || '').slice(0, 40), score: p.score || 0 }));
  const questionStats = questions.map((q, i) => {
    const options = Array.isArray(q.options) ? q.options.map((o) => String(o || '').slice(0, 80)) : [];
    const optionCounts = new Array(options.length).fill(0);
    let answered = 0;
    players.forEach((p) => {
      const h = (p.history || []).find((x) => x.questionIndex === i);
      if (!h) return;
      answered++;
      if (Array.isArray(h.optionIndexes)) {
        h.optionIndexes.forEach((idx) => { if (optionCounts[idx] != null) optionCounts[idx]++; });
      } else if (Number.isInteger(h.optionIndex) && optionCounts[h.optionIndex] != null) {
        optionCounts[h.optionIndex]++;
      }
    });
    // Le domande a selezione multipla (correctIndexes) sono spesso di opinione/mindset: non
    // marchiamo nessuna opzione come "quella giusta" nel grafico, contano solo i voti.
    const isMulti = Array.isArray(q.correctIndexes);
    const correctIndexes = isMulti ? [] : (Number.isInteger(q.correctIndex) ? [q.correctIndex] : []);
    return {
      text: String(q.text || '').slice(0, 200),
      options,
      optionCounts,
      correctIndexes,
      answered,
    };
  });
  return {
    quizTitle: String(data.quizTitle || 'Quiz').slice(0, 80),
    totalPlayers: players.length,
    topPlayers,
    questionStats,
    fetchedAt: Date.now(),
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

  socket.on('submit-photo', ({ dataUrl, message }) => {
    if (!dataUrl) return;
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(dataUrl)) return;
    if (dataUrl.length > 400 * 1024) return; // guard: reject oversized payloads (client should compress)
    if (state.photos.length >= MAX_PHOTOS) return;
    const photo = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      dataUrl,
      message: String(message || '').slice(0, 80),
      ts: Date.now(),
    };
    state.photos.push(photo);
    io.emit('photo:add', { photo, photosTotal: state.photos.length });
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
        const recipientCount = io.sockets.sockets.size;
        io.emit('final-image', { dataUrl, ts: Date.now() });
        socket.emit('broadcast-image:sent', { recipientCount });
        return;
      }
      // TEMPORANEO - SOLO PER TEST: duplica le prime foto caricate fino ad avere ~N foto
      // totali, per vedere l'effetto Vision Reveal a schermo pieno senza caricare 80 foto
      // vere. Da rimuovere (insieme al pulsante in admin.html/js) prima dell'evento reale.
      case 'test-fill-photos': {
        const target = (payload && payload.count) || 80;
        if (!state.photos.length) {
          socket.emit('admin:error', { message: 'Carica almeno una foto vera prima di usare il riempimento di test', code: 'invalid_image' });
          return;
        }
        const source = state.photos.slice(0, 2);
        let added = 0;
        while (state.photos.length < target) {
          const src = source[added % source.length];
          const photo = { id: `test-${Date.now()}-${added}`, dataUrl: src.dataUrl, message: src.message || '', ts: Date.now() };
          state.photos.push(photo); // limite MAX_PHOTOS non applicato: è un riempimento di test
          io.emit('photo:add', { photo, photosTotal: state.photos.length });
          added++;
        }
        return;
      }
      // Collegamento tecnico con l'app Quiz Live: legge il riepilogo in diretta
      // dall'endpoint /api/results (protetto dal PIN admin di Quiz Live) e lo
      // trasmette a schermo/admin. Da richiamare quando si passa alla fase "Riepilogo Quiz".
      case 'fetch-quiz-recap': {
        const quizLiveUrl = String((payload && payload.quizLiveUrl) || '').trim().replace(/\/+$/, '');
        const quizLivePin = String((payload && payload.quizLivePin) || '').trim();
        if (!quizLiveUrl || !quizLivePin) {
          socket.emit('admin:error', { message: 'Inserisci URL e PIN di Quiz Live', code: 'quiz_recap_missing' });
          return;
        }
        state.quizLiveUrl = quizLiveUrl;
        state.quizLivePin = quizLivePin;
        fetch(`${quizLiveUrl}/api/results?pin=${encodeURIComponent(quizLivePin)}`)
          .then((r) => { if (!r.ok) throw new Error('http_' + r.status); return r.json(); })
          .then((data) => {
            state.quizRecap = buildQuizRecap(data);
            io.emit('quiz-recap:update', state.quizRecap);
            socket.emit('quiz-recap:fetch-ok', { fetchedAt: state.quizRecap.fetchedAt });
          })
          .catch(() => {
            socket.emit('admin:error', { message: 'Impossibile leggere i risultati da Quiz Live: controlla URL e PIN', code: 'quiz_recap_failed' });
          });
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

server.listen(PORT, () => {
  const base = process.env.RENDER_EXTERNAL_URL || `http://${getLocalIPs()[0] || 'localhost'}:${PORT}`;
  console.log(`Idea Fresca 25 Anni - server avviato sulla porta ${PORT}`);
  console.log(`Partecipanti (QR): ${base}/`);
  console.log(`Schermo grande:    ${base}/screen`);
  console.log(`PIN Admin: ${ADMIN_PIN}`);
});
