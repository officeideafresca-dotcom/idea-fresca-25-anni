(function () {
  const ICON_EMOJI = { mountain: '🏔️', hands: '🤝', sprout: '🌱', compass: '🧭', rocket: '🚀', star: '⭐' };
  const ROTATE_LANGS = ['it', 'de', 'fr', 'es', 'en'];
  const el = (id) => document.getElementById(id);
  const socket = io();

  // Fasi: 0 Preparazione, 1 Lancio, 2 Visual Challenge, 3 Sfida Numerica, 4 Vision Reveal
  const PHOTO_REVEAL_PHASE = 2; // "Visual Challenge": da qui le foto entrano nel mosaico
  const REVEAL_PHASE = 4; // "Vision Reveal"

  let state = null;
  let popQueue = [];
  let popBusy = false;
  let spotlightTimer = null;
  let spotlightIndex = 1;
  let rotateIndex = 0;
  let pendingMosaic = []; // { type: 'photo'|'icon', tableId, photo?, icon? } in attesa della fase giusta
  const mosaicIconTiles = {}; // tableId -> DOM element (icon placeholder tile, one per table)

  function fmt(n) { return Number(n || 0).toLocaleString('it-IT'); }

  function renderTopLabels() {
    el('lblNetwork').textContent = window.t('it', 'screen.newPartners');
    el('lblRetention').textContent = window.t('it', 'screen.retention');
    el('lblSymbolic').textContent = window.t('it', 'screen.symbolicTotal');
    el('lblTables').textContent = window.t('it', 'screen.tablesIn');
    el('launchCta').textContent = window.t('it', 'screen.scanCta');
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

  // Fase 0 "Preparazione": foto totalmente nascoste. Fase 1 "Lancio": ogni foto appare
  // sparsa per 3 secondi e sparisce (senza entrare nel mosaico). Da fase 2 "Visual
  // Challenge" in poi: le foto entrano subito nel mosaico.
  function photoPhaseMode() {
    if (!state) return 'hidden';
    if (state.phase <= 0) return 'hidden';
    if (state.phase === 1) return 'scatter';
    return 'live';
  }

  function shouldQueueMosaic() {
    return state.phase < PHOTO_REVEAL_PHASE;
  }

  function updateMosaicTitleVisibility() {
    el('mosaicTitle').style.display = el('mosaicGrid').children.length > 6 ? 'none' : 'flex';
  }

  // Fase 1 "Lancio": mostra una foto in posizione casuale per qualche secondo, poi sparisce.
  function showScatterPhoto(dataUrl) {
    const wrap = el('mosaicWrap');
    if (!wrap) return;
    const img = document.createElement('img');
    img.src = dataUrl;
    img.className = 'scatter-photo';
    const size = 14 + Math.random() * 8; // % larghezza contenitore
    img.style.width = size + '%';
    img.style.left = Math.random() * Math.max(0, 100 - size) + '%';
    img.style.top = Math.random() * Math.max(0, 100 - size * 1.1) + '%';
    wrap.appendChild(img);
    setTimeout(() => img.remove(), 3000);
  }

  function renderMosaicFromScratch() {
    const grid = el('mosaicGrid');
    grid.innerHTML = '';
    Object.keys(mosaicIconTiles).forEach((k) => delete mosaicIconTiles[k]);
    pendingMosaic = [];

    if (shouldQueueMosaic()) {
      // Ancora prima della fase "Visual Challenge": teniamo tutto in coda, mosaico vuoto
      Object.values(state.tables).forEach((t) => {
        (t.photos || []).forEach((p) => pendingMosaic.push({ type: 'photo', tableId: t.id, photo: p }));
        if ((!t.photos || !t.photos.length) && t.icon) pendingMosaic.push({ type: 'icon', tableId: t.id, icon: t.icon });
      });
      el('mosaicTitle').style.display = 'flex';
      return;
    }

    let count = 0;
    Object.values(state.tables).forEach((t) => {
      (t.photos || []).forEach((p) => { addMosaicTile(p.dataUrl); count++; });
      if ((!t.photos || !t.photos.length) && t.icon) { addMosaicIconTile(t.id, t.icon); count++; }
    });
    el('mosaicTitle').style.display = count > 6 ? 'none' : 'flex';
  }

  // Fase 2 "Visual Challenge": effetto pioggia, le foto accumulate cadono nel mosaico
  // una dopo l'altra a raffica invece che con il pop-up singolo al centro.
  function flushPendingMosaic() {
    const items = pendingMosaic;
    pendingMosaic = [];
    items.forEach((item, i) => {
      setTimeout(() => {
        if (item.type === 'photo') addMosaicTileRain(item.photo.dataUrl);
        else addMosaicIconTile(item.tableId, item.icon);
      }, i * 40);
    });
  }

  function addMosaicTile(dataUrl) {
    const img = document.createElement('img');
    img.className = 'mosaic-tile';
    img.src = dataUrl;
    el('mosaicGrid').appendChild(img);
    updateMosaicTitleVisibility();
  }

  function addMosaicTileRain(dataUrl) {
    const img = document.createElement('img');
    img.className = 'mosaic-tile rain-in';
    img.src = dataUrl;
    el('mosaicGrid').appendChild(img);
    updateMosaicTitleVisibility();
  }

  function addMosaicIconTile(tableId, icon) {
    if (mosaicIconTiles[tableId]) {
      mosaicIconTiles[tableId].textContent = ICON_EMOJI[icon] || '✨';
      return;
    }
    const div = document.createElement('div');
    div.className = 'mosaic-tile icon-tile';
    div.textContent = ICON_EMOJI[icon] || '✨';
    el('mosaicGrid').appendChild(div);
    mosaicIconTiles[tableId] = div;
    updateMosaicTitleVisibility();
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
    const showLaunch = state.phase <= 0;
    el('launchOverlay').style.display = showLaunch ? 'flex' : 'none';
  }

  // ---------- Reveal mode ----------
  function updateRevealMode() {
    const root = el('screenRoot');
    const banner = el('revealBanner');
    if (state && state.phase >= REVEAL_PHASE) {
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

  // ---------- Fase "Vision Reveal": le foto si muovono per formare la scritta ----------
  // Rasterizza `lines` e restituisce le celle "accese" (dentro una lettera) come
  // rettangoli {x,y,w,h} in pixel, dentro un'area width x height.
  function buildScreenTextCells(lines, width, height, cellSize) {
    const off = document.createElement('canvas');
    off.width = width; off.height = height;
    const octx = off.getContext('2d');
    if (!octx) return [];
    octx.fillStyle = '#000';
    octx.fillRect(0, 0, width, height);
    octx.fillStyle = '#fff';
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    const lineHeight = height / lines.length;
    lines.forEach((line, i) => {
      let fontSize = Math.round(lineHeight * 0.72);
      octx.font = `900 ${fontSize}px Segoe UI, Arial`;
      while (octx.measureText(line).width > width * 0.94 && fontSize > 8) {
        fontSize -= 3;
        octx.font = `900 ${fontSize}px Segoe UI, Arial`;
      }
      octx.fillText(line, width / 2, lineHeight * i + lineHeight / 2);
    });

    const cols = Math.max(10, Math.round(width / cellSize));
    const rows = Math.max(6, Math.round(height / cellSize));
    const full = octx.getImageData(0, 0, width, height).data;
    const cellW = width / cols, cellH = height / rows;
    const cells = [];
    for (let ry = 0; ry < rows; ry++) {
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
        if (count && sum / count / 255 > 0.5) cells.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      }
    }
    return cells;
  }

  // Sposta le tessere già presenti nel mosaico in modo che, viste nel loro insieme,
  // compongano la scritta "Together we are one". Se non ci sono abbastanza foto per
  // riempire tutte le lettere, clona quelle esistenti (stesso trucco dell'immagine finale).
  function startTextFormation() {
    try {
      const grid = el('mosaicGrid');
      const tiles = Array.from(grid.children);
      if (!tiles.length) return; // nessuna foto: il resto del reveal resta comunque intatto
      const rect = grid.getBoundingClientRect();
      const w = Math.round(rect.width), h = Math.round(rect.height);
      if (!w || !h) return;

      const cells = buildScreenTextCells(['TOGETHER', 'WE ARE ONE'], w, h, 34);
      if (!cells.length) return;

      grid.classList.add('text-forming');
      tiles.forEach((tile, i) => {
        const cell = cells[i % cells.length];
        tile.style.left = cell.x + 'px';
        tile.style.top = cell.y + 'px';
        tile.style.width = cell.w + 'px';
        tile.style.height = cell.h + 'px';
      });

      // celle rimaste senza tessera: le riempiamo clonando le foto già arrivate
      for (let i = tiles.length; i < cells.length; i++) {
        const src = tiles[i % tiles.length];
        const clone = src.cloneNode(true);
        clone.style.animation = 'none';
        clone.style.opacity = '0';
        const cell = cells[i];
        clone.style.left = cell.x + 'px';
        clone.style.top = cell.y + 'px';
        clone.style.width = cell.w + 'px';
        clone.style.height = cell.h + 'px';
        grid.appendChild(clone);
        requestAnimationFrame(() => { clone.style.opacity = '1'; });
      }
    } catch (e) {
      // Effetto opzionale: se qualcosa va storto qui, gli altri effetti del reveal
      // (flash, banner, attenuazione colonne, spotlight) restano comunque attivi.
      console.error('Formazione scritta fotomosaico non riuscita:', e);
    }
  }

  // ---------- Effetti di transizione fase ----------
  let lastKnownPhase = null;

  function triggerFlash(kind) {
    const flash = el('flashOverlay');
    flash.className = 'flash-overlay'; // reset per poter ri-triggerare l'animazione
    void flash.offsetWidth; // forza il reflow
    flash.className = `flash-overlay show ${kind}`;
  }

  function triggerAssemble() {
    const grid = el('mosaicGrid');
    grid.classList.remove('assembling');
    void grid.offsetWidth;
    grid.classList.add('assembling');
    triggerFlash('gold');
  }

  function onPhaseChanged(newPhase, oldPhase) {
    if (oldPhase == null) return; // primo caricamento pagina: non è una transizione da segnalare
    if (newPhase >= PHOTO_REVEAL_PHASE && oldPhase < PHOTO_REVEAL_PHASE) {
      triggerAssemble(); // scossa del mosaico + flash dorato: effetto "pioggia" in arrivo
      flushPendingMosaic();
    }
    if (newPhase === REVEAL_PHASE && oldPhase !== REVEAL_PHASE) {
      triggerFlash('white');
      setTimeout(startTextFormation, 900);
    }
  }

  // ---------- Socket events ----------
  socket.on('init', (st) => {
    state = st;
    lastKnownPhase = st.phase;
    fullRender();
    renderMosaicFromScratch();
  });
  socket.on('metrics:update', (payload) => {
    if (!state) return;
    // il server manda un riepilogo senza `photos`: uniamo per non perdere l'array locale
    state.tables[payload.tableId] = Object.assign({}, state.tables[payload.tableId], payload.table);
    state.totals = payload.totals;
    renderTotals();
    renderTableCards();
  });
  socket.on('icon:update', (payload) => {
    if (!state) return;
    const t = state.tables[payload.tableId];
    if (!t) return;
    const hadPhotos = t.photos && t.photos.length > 0;
    t.icon = payload.icon;
    renderTableCards();
    if (!hadPhotos) {
      // le icone (a differenza delle foto) non hanno un'anteprima da "spargere" in fase 1:
      // restano semplicemente in coda finché non si entra in "Visual Challenge"
      if (photoPhaseMode() === 'live') addMosaicIconTile(payload.tableId, payload.icon);
      else pendingMosaic.push({ type: 'icon', tableId: payload.tableId, icon: payload.icon });
    }
  });
  socket.on('photo:add', (payload) => {
    if (!state) return;
    const t = state.tables[payload.tableId];
    if (t) { if (!t.photos) t.photos = []; t.photos.push(payload.photo); }
    state.totals = payload.totals;
    renderTotals();
    const mode = photoPhaseMode();
    if (mode === 'live') {
      enqueuePhotoPop(payload.tableId, payload.photo);
    } else {
      pendingMosaic.push({ type: 'photo', tableId: payload.tableId, photo: payload.photo });
      if (mode === 'scatter') showScatterPhoto(payload.photo.dataUrl);
    }
  });
  socket.on('phase:update', (p) => {
    if (!state) return;
    const oldPhase = lastKnownPhase;
    Object.assign(state, p);
    lastKnownPhase = p.phase;
    fullRender();
    onPhaseChanged(p.phase, oldPhase);
  });
  socket.on('reset', () => location.reload());

  renderTopLabels();
})();
