(function () {
  const el = (id) => document.getElementById(id);
  const socket = io();

  let state = null;
  let pin = localStorage.getItem('if25_admin_pin') || '';

  function fmt(n) { return Number(n || 0).toLocaleString('it-IT'); }

  function phaseLabels() { return window.t('it', 'screen.phaseLabels'); }

  function renderPhaseList() {
    const box = el('phaseList');
    box.innerHTML = '';
    const labels = phaseLabels();
    for (let i = 1; i <= 5; i++) {
      const b = document.createElement('button');
      b.className = 'phase-btn' + (state && state.phase === i ? ' active' : '');
      b.textContent = `${i}. ${labels[i]}`;
      b.onclick = () => sendAdmin('set-phase', { phase: i });
      box.appendChild(b);
    }
  }

  function renderStatus() {
    if (!state) return;
    const labels = phaseLabels();
    el('stPhase').textContent = labels[state.phase] || labels[0];
    el('stTables').textContent = `${state.totals.tablesSubmitted}/${state.totals.tablesTotal}`;
    el('stNetwork').textContent = '+' + fmt(state.totals.network);
    el('btnPauseResume').textContent = state.status === 'paused'
      ? window.t('it', 'screen.resumeButton')
      : window.t('it', 'screen.pauseButton');
    renderPhaseList();
  }

  function tickTimer() {
    if (!state) return;
    let remaining;
    if (state.status === 'paused' && state.pausedRemainingSec != null) {
      remaining = state.pausedRemainingSec;
    } else if (state.startedAt) {
      remaining = state.durationSec - (Date.now() - state.startedAt) / 1000;
    } else {
      remaining = state.durationSec;
    }
    remaining = Math.max(0, Math.round(remaining));
    const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
    const ss = String(remaining % 60).padStart(2, '0');
    el('stTimer').textContent = `${mm}:${ss}`;
  }
  setInterval(tickTimer, 500);

  function sendAdmin(action, payload) {
    socket.emit('admin', { pin, action, payload });
  }

  socket.on('init', (st) => { state = st; renderStatus(); });
  socket.on('metrics:update', (p) => { if (state) { state.tables[p.tableId] = p.table; state.totals = p.totals; renderStatus(); } });
  socket.on('photo:add', (p) => { if (state) { state.totals = p.totals; renderStatus(); } });
  socket.on('phase:update', (p) => { if (state) { Object.assign(state, p); renderStatus(); } });
  socket.on('reset', () => socket.emit('request-state'));
  socket.on('admin:error', (e) => {
    if (e.code === 'bad_pin') {
      el('pinError').textContent = e.message;
      el('pinBox').style.display = 'flex';
      el('controls').style.display = 'none';
      localStorage.removeItem('if25_admin_pin');
      pin = '';
    } else {
      alert(e.message);
    }
  });

  function unlock() {
    pin = el('pinInput').value.trim();
    if (!pin) return;
    localStorage.setItem('if25_admin_pin', pin);
    el('pinBox').style.display = 'none';
    el('controls').style.display = 'flex';
    el('pinError').textContent = '';
  }

  el('btnUnlock').addEventListener('click', unlock);
  el('pinInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlock(); });

  el('btnStart').addEventListener('click', () => {
    const minutes = Number(el('durationInput').value) || 30;
    sendAdmin('start', { durationSec: minutes * 60 });
  });
  el('btnPauseResume').addEventListener('click', () => {
    sendAdmin(state && state.status === 'paused' ? 'resume' : 'pause');
  });
  el('btnReset').addEventListener('click', () => {
    if (confirm('Confermi il reset completo di tutti i dati? Questa azione non si può annullare.')) {
      sendAdmin('reset');
    }
  });

  el('btnSaveImage').addEventListener('click', composeSaveAndBroadcastImage);

  async function composeSaveAndBroadcastImage() {
    const canvas = await buildFinalCanvas();
    if (!canvas) return;

    // 1) scarica la versione PNG ad alta qualità su questo dispositivo
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'idea-fresca-25-anni-vision.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, 'image/png');

    // 2) invia una versione JPEG più leggera a tutti i telefoni ancora collegati
    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.85);
    sendAdmin('broadcast-image', { dataUrl: jpegDataUrl });
  }

  async function buildFinalCanvas() {
    if (!state) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 1600; canvas.height = 900;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(800, 200, 100, 800, 450, 900);
    grad.addColorStop(0, '#12594f'); grad.addColorStop(1, '#06211d');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, 1600, 900);

    ctx.fillStyle = '#c79a2b';
    ctx.font = '900 64px Segoe UI, Arial';
    ctx.textAlign = 'center';
    ctx.fillText('IF 25 ANNI — BEYOND', 800, 90);
    ctx.font = '600 24px Segoe UI, Arial';
    ctx.fillStyle = '#ffffffcc';
    ctx.fillText('La nostra visione, costruita da tutti noi', 800, 128);

    const t = state.totals;
    ctx.font = '900 40px Segoe UI, Arial';
    ctx.fillStyle = '#c79a2b';
    ctx.fillText(`+${fmt(t.network)}`, 350, 200);
    ctx.fillText(`${t.retention}%`, 800, 200);
    ctx.fillText(`${fmt(t.symbolic)}`, 1250, 200);
    ctx.font = '500 18px Segoe UI, Arial';
    ctx.fillStyle = '#ffffffaa';
    ctx.fillText('Nuovi Partner di Rete', 350, 228);
    ctx.fillText('Fidelizzazione Media', 800, 228);
    ctx.fillText("Azioni d'Impatto 25°", 1250, 228);

    const photos = [];
    Object.values(state.tables).forEach((tb) => (tb.photos || []).forEach((p) => photos.push(p.dataUrl)));
    const sample = photos.slice(0, 96);
    const cols = 12;
    const cellW = 1600 / cols;
    const rows = Math.ceil(sample.length / cols) || 1;
    const gridTop = 270;
    const gridH = 900 - gridTop - 60;
    const cellH = Math.min(cellW, gridH / rows);

    const imgs = await Promise.all(sample.map((src) => loadImage(src)));
    imgs.forEach((img, i) => {
      const x = (i % cols) * cellW;
      const y = gridTop + Math.floor(i / cols) * cellH;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 2, y + 2, cellW - 4, cellH - 4);
      ctx.clip();
      drawCover(ctx, img, x + 2, y + 2, cellW - 4, cellH - 4);
      ctx.restore();
    });

    ctx.font = '500 16px Segoe UI, Arial';
    ctx.fillStyle = '#ffffff99';
    ctx.fillText('Idea Fresca · Digital Vision Mosaic & Numbers Quest · ' + new Date().toLocaleDateString('it-IT'), 800, 880);

    return canvas;
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function drawCover(ctx, img, x, y, w, h) {
    if (!img) return;
    const ir = img.width / img.height;
    const r = w / h;
    let sw, sh, sx, sy;
    if (ir > r) { sh = img.height; sw = sh * r; sx = (img.width - sw) / 2; sy = 0; }
    else { sw = img.width; sh = sw / r; sx = 0; sy = (img.height - sh) / 2; }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }

  // ---- init ----
  if (pin) {
    el('pinBox').style.display = 'none';
    el('controls').style.display = 'flex';
  }
})();
