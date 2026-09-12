(function () {
  const ICON_EMOJI = { mountain: '🏔️', hands: '🤝', sprout: '🌱', compass: '🧭', rocket: '🚀', star: '⭐' };
  const ROTATE_LANGS = ['it', 'de', 'fr', 'es', 'en'];
  const el = (id) => document.getElementById(id);
  const socket = io();

  const PHOTO_REVEAL_PHASE = 3; // "Visual Challenge": prima di questa fase, foto/icone restano in coda

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

  function renderMosaicFromScratch() {
    const grid = el('mosaicGrid');
    grid.innerHTML = '';
    Object.keys(mosaicIconTiles).forEach((k) => delete mosaicIconTiles[k]);
    pendingMosaic = [];

    if (state.phase < PHOTO_REVEAL_PHASE) {
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

  function flushPendingMosaic() {
    const items = pendingMosaic;
    pendingMosaic = [];
    items.forEach((item) => {
      if (item.type === 'photo') enqueuePhotoPop(item.tableId, item.photo);
      else addMosaicIconTile(item.tableId, item.icon);
    });
  }

  function addMosaicTile(dataUrl) {
    const img = document.createElement('img');
    img.className = 'mosaic-tile';
    img.src = dataUrl;
    el('mosaicGrid').appendChild(img);
    el('mosaicTitle').style.display = el('mosaicGrid').children.length > 6 ? 'none' : 'flex';
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
    el('mosaicTitle').style.display = el('mosaicGrid').children.length > 6 ? 'none' : 'flex';
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
      triggerFlash('gold');
      flushPendingMosaic();
    }
    if (newPhase === 4 && oldPhase !== 4) triggerAssemble();
    if (newPhase === 5 && oldPhase !== 5) triggerFlash('white');
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
      if (state.phase >= PHOTO_REVEAL_PHASE) addMosaicIconTile(payload.tableId, payload.icon);
      else pendingMosaic.push({ type: 'icon', tableId: payload.tableId, icon: payload.icon });
    }
  });
  socket.on('photo:add', (payload) => {
    if (!state) return;
    const t = state.tables[payload.tableId];
    if (t) { if (!t.photos) t.photos = []; t.photos.push(payload.photo); }
    state.totals = payload.totals;
    renderTotals();
    if (state.phase >= PHOTO_REVEAL_PHASE) {
      enqueuePhotoPop(payload.tableId, payload.photo);
    } else {
      pendingMosaic.push({ type: 'photo', tableId: payload.tableId, photo: payload.photo });
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
