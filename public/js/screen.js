(function () {
  const ICON_EMOJI = { mountain: '🏔️', hands: '🤝', sprout: '🌱', compass: '🧭', rocket: '🚀', star: '⭐' };
  const ROTATE_LANGS = ['it', 'de', 'fr', 'es', 'en'];
  const el = (id) => document.getElementById(id);
  const socket = io();

  let state = null;
  let adminPin = '';
  let popQueue = [];
  let popBusy = false;
  let spotlightTimer = null;
  let spotlightIndex = 1;
  let rotateIndex = 0;

  function fmt(n) { return Number(n || 0).toLocaleString('it-IT'); }

  function renderTopLabels() {
    el('lblNetwork').textContent = window.t('it', 'screen.newPartners');
    el('lblRetention').textContent = window.t('it', 'screen.retention');
    el('lblSymbolic').textContent = window.t('it', 'screen.symbolicTotal');
    el('lblTables').textContent = window.t('it', 'screen.tablesIn');
    el('launchCta').textContent = window.t('it', 'screen.scanCta');
    el('adminPinLabel').textContent = window.t('it', 'screen.adminPin');
    el('btnStart').textContent = window.t('it', 'screen.startButton');
    el('btnSaveImage').textContent = window.t('it', 'screen.saveImage');
    el('btnReset').textContent = window.t('it', 'screen.resetButton');
  }

  function phaseLabel(phase) {
    const labels = window.t('it', 'screen.phaseLabels');
    return labels[phase] || labels[0];
  }

  function renderTotals() {
    if (!state) return;
    const t = state.totals;
    el('totalNetwork').textContent = '+' + fmt(t.network);
    el('totalRetention').textContent = t.retention + '%';
    el('totalSymbolic').textContent = fmt(t.symbolic);
    el('totalTables').textContent = `${t.tablesSubmitted}/${t.tablesTotal}`;
    el('phasePill').textContent = phaseLabel(state.phase);
  }

  function renderTableCards() {
    if (!state) return;
    const left = el('colLeft');
    const right = el('colRight');
    left.innerHTML = '';
    right.innerHTML = '';
    Object.values(state.tables).forEach((t) => {
      const card = document.createElement('div');
      card.className = 'table-card' + (t.metrics ? ' submitted' : '');
      card.style.borderLeftColor = t.color;
      card.dataset.tableId = t.id;
      const icon = t.icon ? ICON_EMOJI[t.icon] : '';
      const name = t.teamLeaderName ? t.teamLeaderName : '—';
      const m = t.metrics;
      card.innerHTML = `
        <div class="tname"><span>${window.t('it', 'table')} ${t.id} ${icon}</span></div>
        <div class="tnums">${name}<br/>${m ? `+${fmt(m.network)} · ${m.retention}% · ${fmt(m.symbolicValue)} ${escapeHtml(m.symbolicLabel || '')}` : '···'}</div>
      `;
      if (t.id <= 5) left.appendChild(card); else right.appendChild(card);
    });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderMosaicFromScratch() {
    const grid = el('mosaicGrid');
    grid.innerHTML = '';
    let count = 0;
    Object.values(state.tables).forEach((t) => {
      (t.photos || []).forEach((p) => { addMosaicTile(p.dataUrl); count++; });
      if ((!t.photos || !t.photos.length) && t.icon) { addMosaicIconTile(t.icon); count++; }
    });
    el('mosaicTitle').style.display = count > 6 ? 'none' : 'flex';
  }

  function addMosaicTile(dataUrl) {
    const img = document.createElement('img');
    img.className = 'mosaic-tile';
    img.src = dataUrl;
    el('mosaicGrid').appendChild(img);
    el('mosaicTitle').style.display = el('mosaicGrid').children.length > 6 ? 'none' : 'flex';
  }

  function addMosaicIconTile(icon) {
    const div = document.createElement('div');
    div.className = 'mosaic-tile icon-tile';
    div.textContent = ICON_EMOJI[icon] || '✨';
    el('mosaicGrid').appendChild(div);
  }

  // ---------- Photo pop queue ----------
  function enqueuePhotoPop(tableId, photo) {
    popQueue.push({ tableId, photo });
    processPopQueue();
  }

  function processPopQueue() {
    if (popBusy || !popQueue.length) return;
    popBusy = true;
    const { tableId, photo } = popQueue.shift();
    const t = state.tables[tableId];
    el('photoPopMedia').innerHTML = `<img src="${photo.dataUrl}" alt="" />`;
    el('photoPopName').textContent = (t && t.teamLeaderName) || '';
    el('photoPopTable').textContent = `${window.t('it', 'table')} ${tableId}`;
    el('photoPop').classList.add('show');
    setTimeout(() => {
      el('photoPop').classList.remove('show');
      addMosaicTile(photo.dataUrl);
      setTimeout(() => { popBusy = false; processPopQueue(); }, 300);
    }, 3000);
  }

  // ---------- Timer ----------
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
    el('timerText').textContent = `${mm}:${ss}`;
    el('launchTimer').textContent = `${mm}:${ss}`;
  }
  setInterval(tickTimer, 500);

  // ---------- Launch overlay language rotation ----------
  function rotateLaunchLang() {
    const lang = ROTATE_LANGS[rotateIndex % ROTATE_LANGS.length];
    el('launchSub').textContent = window.t(lang, 'screen.launchSubtitle');
    rotateIndex++;
  }
  rotateLaunchLang();
  setInterval(rotateLaunchLang, 2600);

  function updateOverlayVisibility() {
    if (!state) return;
    const showLaunch = state.phase <= 1;
    el('launchOverlay').style.display = showLaunch ? 'flex' : 'none';
  }

  // ---------- Reveal mode ----------
  function updateRevealMode() {
    const root = el('screenRoot');
    const banner = el('revealBanner');
    if (state && state.phase >= 5) {
      root.classList.add('reveal');
      banner.style.display = 'block';
      banner.textContent = `${window.t('it', 'screen.revealTitle')} · ${window.t('it', 'screen.revealSubtitle')}`;
      startSpotlight();
    } else {
      root.classList.remove('reveal');
      banner.style.display = 'none';
      stopSpotlight();
    }
  }

  function startSpotlight() {
    if (spotlightTimer) return;
    spotlightTimer = setInterval(() => {
      document.querySelectorAll('.table-card.spotlight').forEach((c) => c.classList.remove('spotlight'));
      const card = document.querySelector(`.table-card[data-table-id="${spotlightIndex}"]`);
      if (card) card.classList.add('spotlight');
      spotlightIndex = (spotlightIndex % 10) + 1;
    }, 1400);
  }
  function stopSpotlight() {
    if (spotlightTimer) { clearInterval(spotlightTimer); spotlightTimer = null; }
    document.querySelectorAll('.table-card.spotlight').forEach((c) => c.classList.remove('spotlight'));
  }

  function fullRender() {
    renderTotals();
    renderTableCards();
    updateOverlayVisibility();
    updateRevealMode();
  }

  // ---------- Socket events ----------
  socket.on('init', (st) => {
    state = st;
    fullRender();
    renderMosaicFromScratch();
  });
  socket.on('metrics:update', (payload) => {
    if (!state) return;
    state.tables[payload.tableId] = payload.table;
    state.totals = payload.totals;
    renderTotals();
    renderTableCards();
  });
  socket.on('icon:update', (payload) => {
    if (!state) return;
    state.tables[payload.tableId].icon = payload.icon;
    renderTableCards();
  });
  socket.on('photo:add', (payload) => {
    if (!state) return;
    state.totals = payload.totals;
    renderTotals();
    enqueuePhotoPop(payload.tableId, payload.photo);
  });
  socket.on('phase:update', (p) => {
    if (!state) return;
    Object.assign(state, p);
    fullRender();
  });
  socket.on('reset', () => location.reload());
  socket.on('admin:error', (e) => { el('adminError').textContent = e.message; });

  // ---------- Admin modal ----------
  el('gearBtn').addEventListener('click', () => el('adminModal').classList.add('show'));
  el('btnCloseAdmin').addEventListener('click', () => el('adminModal').classList.remove('show'));

  function pin() { adminPin = el('adminPinInput').value; return adminPin; }

  el('btnStart').addEventListener('click', () => {
    const minutes = Number(el('durationInput').value) || 30;
    socket.emit('admin', { pin: pin(), action: 'start', payload: { durationSec: minutes * 60 } });
  });
  el('btnPauseResume').addEventListener('click', () => {
    const action = state && state.status === 'paused' ? 'resume' : 'pause';
    socket.emit('admin', { pin: pin(), action });
  });
  el('btnReset').addEventListener('click', () => {
    if (confirm('Confermi il reset completo di tutti i dati?')) {
      socket.emit('admin', { pin: pin(), action: 'reset' });
    }
  });

  const phaseBtnBox = el('phaseButtons');
  const labels = window.t('it', 'screen.phaseLabels');
  for (let i = 1; i <= 5; i++) {
    const b = document.createElement('button');
    b.className = 'admin-btn-secondary';
    b.textContent = i + '. ' + labels[i];
    b.style.fontSize = '0.72rem';
    b.onclick = () => socket.emit('admin', { pin: pin(), action: 'set-phase', payload: { phase: i } });
    phaseBtnBox.appendChild(b);
  }

  el('btnSaveImage').addEventListener('click', composeAndDownloadImage);

  async function composeAndDownloadImage() {
    if (!state) return;
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

    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'idea-fresca-25-anni-vision.png';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }, 'image/png');
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

  renderTopLabels();
})();
