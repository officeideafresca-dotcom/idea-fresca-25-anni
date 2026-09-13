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
    for (let i = 1; i <= 4; i++) {
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
  socket.on('metrics:update', (p) => {
    if (!state) return;
    // il server manda un riepilogo senza `photos`: uniamo per non perdere l'array locale
    state.tables[p.tableId] = Object.assign({}, state.tables[p.tableId], p.table);
    state.totals = p.totals;
    renderStatus();
  });
  socket.on('photo:add', (p) => {
    if (!state) return;
    const t = state.tables[p.tableId];
    if (t) { if (!t.photos) t.photos = []; t.photos.push(p.photo); }
    state.totals = p.totals;
    renderStatus();
  });
  socket.on('phase:update', (p) => { if (state) { Object.assign(state, p); renderStatus(); } });
  socket.on('reset', () => socket.emit('request-state'));
  socket.on('broadcast-image:sent', (p) => {
    const status = el('exportStatus');
    status.textContent = `Inviata a ${p.recipientCount} dispositivi collegati ✓`;
    setTimeout(() => { status.textContent = ''; }, 6000);
  });
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

  // TEMPORANEO - SOLO PER TEST: rimuovere insieme al bottone in admin.html prima dell'evento reale
  el('btnTestFill').addEventListener('click', () => {
    sendAdmin('test-fill-photos', { count: 80 });
  });

  el('btnSaveImage').addEventListener('click', composeSaveAndBroadcastImage);

  async function composeSaveAndBroadcastImage() {
    const btn = el('btnSaveImage');
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Generazione in corso...';
    try {
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
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }

  async function buildFinalCanvas() {
    if (!state) return null;
    const canvas = document.createElement('canvas');
    canvas.width = 1600; canvas.height = 900;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
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
    const gridTop = 270;
    const gridW = 1600;
    const gridH = 900 - gridTop - 60;

    if (photos.length > 0) {
      const cellSize = 16; // celle più piccole = mosaico più definito, meno "a blocchi"
      const cols = Math.max(24, Math.round(gridW / cellSize));
      const rows = Math.max(14, Math.round(gridH / cellSize));
      const cellW = gridW / cols;
      const cellH = gridH / rows;

      const lum = buildTextLuminanceGrid(['TOGETHER', 'WE ARE ONE'], gridW, gridH, cols, rows);

      // mescoliamo le foto: con poche decine di scatti verranno riusate più volte,
      // lo shuffle evita pattern ripetitivi troppo regolari e visibili
      const shuffled = photos.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const imgs = await Promise.all(shuffled.map((src) => loadImage(src)));

      let idx = 0;
      for (let ry = 0; ry < rows; ry++) {
        for (let rx = 0; rx < cols; rx++) {
          const img = imgs.length ? imgs[idx % imgs.length] : null;
          idx++;
          const x = rx * cellW;
          const y = gridTop + ry * cellH;
          if (img) {
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, y, cellW, cellH);
            ctx.clip();
            drawCover(ctx, img, x, y, cellW, cellH);
            ctx.restore();
          }
          // tinta in base alla mappa di luminosità del testo: lettera = quasi originale, sfondo = molto scurito
          const isLetter = lum[ry][rx] > 0.5;
          ctx.fillStyle = isLetter ? 'rgba(199,154,43,0.10)' : 'rgba(0,0,0,0.8)';
          ctx.fillRect(x, y, cellW, cellH);
        }
      }
    } else {
      ctx.font = '600 22px Segoe UI, Arial';
      ctx.fillStyle = '#ffffff88';
      ctx.fillText('Nessuna foto ancora caricata', 800, gridTop + gridH / 2);
    }

    ctx.font = '500 16px Segoe UI, Arial';
    ctx.fillStyle = '#ffffff99';
    ctx.fillText('Idea Fresca · Digital Vision Mosaic & Numbers Quest · ' + new Date().toLocaleDateString('it-IT'), 800, 880);

    return canvas;
  }

  // Rasterizza una o più righe di testo e restituisce una griglia cols x rows di
  // luminosità 0..1 (1 = dentro una lettera, 0 = sfondo) per "dipingere" il fotomosaico.
  function buildTextLuminanceGrid(lines, width, height, cols, rows) {
    if (!Array.isArray(lines)) lines = [lines];
    const off = document.createElement('canvas');
    off.width = width; off.height = height;
    const octx = off.getContext('2d');
    octx.fillStyle = '#000';
    octx.fillRect(0, 0, width, height);
    octx.fillStyle = '#fff';
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';

    const lineHeight = height / lines.length;
    lines.forEach((line, i) => {
      let fontSize = Math.round(lineHeight * 0.8);
      const setFont = () => {
        octx.font = `900 ${fontSize}px Segoe UI, Arial`;
        // spaziatura tra le lettere: evita che si "tocchino" leggermente col grassetto
        octx.letterSpacing = Math.max(1, Math.round(fontSize * 0.05)) + 'px';
      };
      setFont();
      while (octx.measureText(line).width > width * 0.94 && fontSize > 10) {
        fontSize -= 4;
        setFont();
      }
      octx.fillText(line, width / 2, lineHeight * i + lineHeight / 2);
    });

    const full = octx.getImageData(0, 0, width, height).data;
    const cellW = width / cols, cellH = height / rows;
    const grid = [];
    for (let ry = 0; ry < rows; ry++) {
      const row = [];
      const y0 = Math.floor(ry * cellH), y1 = Math.max(y0 + 1, Math.floor((ry + 1) * cellH));
      for (let rx = 0; rx < cols; rx++) {
        const x0 = Math.floor(rx * cellW), x1 = Math.max(x0 + 1, Math.floor((rx + 1) * cellW));
        let sum = 0, count = 0;
        for (let y = y0; y < y1; y += 2) {
          for (let x = x0; x < x1; x += 2) {
            sum += full[(y * width + x) * 4];
            count++;
          }
        }
        row.push(count ? sum / count / 255 : 0);
      }
      grid.push(row);
    }
    return grid;
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
    // foto verticali ritagliate: ancoriamo in basso, non al centro, per non tagliare il Power Message
    if (ir > r) { sh = img.height; sw = sh * r; sx = (img.width - sw) / 2; sy = 0; }
    else { sw = img.width; sh = sw / r; sx = 0; sy = img.height - sh; }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }

  // ---- init ----
  if (pin) {
    el('pinBox').style.display = 'none';
    el('controls').style.display = 'flex';
  }
})();
