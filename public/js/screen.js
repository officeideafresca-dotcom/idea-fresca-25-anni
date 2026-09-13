(function () {
  const ICON_EMOJI = { mountain: '🏔️', hands: '🤝', sprout: '🌱', compass: '🧭', rocket: '🚀', star: '⭐' };
  const ROTATE_LANGS = ['it', 'de', 'fr', 'es', 'en'];
  const el = (id) => document.getElementById(id);
  const socket = io();

  // Fasi: 0 Preparazione, 1 Lancio, 2 Visual Challenge, 3 Sfida Numerica, 4 Vision Reveal
  const PHOTO_REVEAL_PHASE = 2; // "Visual Challenge": da qui le foto entrano nel mosaico
  const NUMBERS_REVEAL_PHASE = 3; // "Sfida Numerica": da qui si vedono i numeri dei tavoli
  const REVEAL_PHASE = 4; // "Vision Reveal"

  let state = null;
  let popQueue = [];
  let popBusy = false;
  let spotlightTimer = null;
  let spotlightIndex = 1;
  let rotateIndex = 0;
  let pendingMosaic = []; // { type: 'photo'|'icon', tableId, photo?, icon? } in attesa della fase giusta
  const mosaicIconTiles = {}; // tableId -> DOM element (icon placeholder tile, one per table)

  // ---------- Suono "whoosh" per il vortice di foto (sintetizzato, nessun file audio) ----------
  // I browser bloccano l'audio finché non c'è stata un'interazione: basta un click/tasto
  // qualsiasi sulla pagina (es. per andare a schermo intero) per sbloccarlo per il resto della sessione.
  let audioCtx = null;
  function ensureAudioContext() {
    if (!audioCtx) {
      try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audioCtx = null; }
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    return audioCtx;
  }
  document.addEventListener('click', ensureAudioContext);
  document.addEventListener('keydown', ensureAudioContext);

  function playSpinSound() {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(260, now);
      osc.frequency.exponentialRampToValueAtTime(920, now + 0.9);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.22, now + 0.15);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 1.2);
    } catch (e) {
      // il suono è solo un tocco in più: se non funziona, il resto dell'effetto resta intatto
    }
  }

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
    const showNumbers = state.phase >= NUMBERS_REVEAL_PHASE;
    el('totalNetwork').textContent = showNumbers ? '+' + fmt(t.network) : '—';
    el('totalRetention').textContent = showNumbers ? t.retention + '%' : '—';
    el('totalSymbolic').textContent = showNumbers ? fmt(t.symbolic) : '—';
    el('totalTables').textContent = showNumbers ? `${t.tablesSubmitted}/${t.tablesTotal}` : `?/${t.tablesTotal}`;
    el('phasePill').textContent = phaseLabel(state.phase);
  }

  function renderTableCards() {
    if (!state) return;
    const showNumbers = state.phase >= NUMBERS_REVEAL_PHASE;
    const left = el('colLeft');
    const right = el('colRight');
    left.innerHTML = '';
    right.innerHTML = '';
    Object.values(state.tables).forEach((t) => {
      const card = document.createElement('div');
      card.className = 'table-card' + (showNumbers && t.metrics ? ' submitted' : '');
      card.style.borderLeftColor = t.color;
      card.dataset.tableId = t.id;
      const icon = t.icon ? ICON_EMOJI[t.icon] : '';
      const name = t.teamLeaderName ? t.teamLeaderName : '—';
      const m = showNumbers ? t.metrics : null;
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

  // Il Power Message non è più disegnato sulla foto: compare come "bolla" fluttuante
  // in posizione casuale per 3 secondi, indipendentemente dalla fase e da dove va la foto.
  function showScatterMessage(text) {
    if (!text) return;
    const wrap = el('mosaicWrap');
    if (!wrap) return;
    const div = document.createElement('div');
    div.className = 'scatter-message';
    div.textContent = text;
    div.style.left = Math.random() * 70 + '%';
    div.style.top = Math.random() * 80 + '%';
    wrap.appendChild(div);
    setTimeout(() => div.remove(), 3000);
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
      applyRevealSlogan(true);
      startSpotlight();
    } else {
      root.classList.remove('reveal');
      banner.style.display = 'none';
      applyRevealSlogan(false);
      clearRevealMosaic();
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

  // ---------- Fase "Vision Reveal": scritta dietro il mosaico ----------
  // Durante il reveal la scritta di sfondo cambia da "IF/25" a "Together We Are One".
  // È un ripiego immediato: se ci sono foto, pochi istanti dopo viene sostituita dal
  // fotomosaico vero (stesso identico algoritmo dell'immagine finale esportata).
  function applyRevealSlogan(active) {
    const title = el('mosaicTitle');
    if (active) {
      title.innerHTML = 'TOGETHER<br/>WE ARE ONE';
      title.classList.add('reveal-slogan');
      title.style.display = 'flex';
    } else {
      title.innerHTML = 'IF<br/>25';
      title.classList.remove('reveal-slogan');
      updateMosaicTitleVisibility();
    }
  }

  function loadImageEl(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function drawCoverInto(ctx, img, x, y, w, h) {
    if (!img) return;
    const ir = img.width / img.height;
    const r = w / h;
    let sw, sh, sx, sy;
    if (ir > r) { sh = img.height; sw = sh * r; sx = (img.width - sw) / 2; sy = 0; }
    else { sw = img.width; sh = sw / r; sx = 0; sy = img.height - sh; }
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  }

  // Identica alla funzione usata per l'immagine finale esportata (admin.js), così il
  // fotomosaico live e quello scaricato/inviato risultano sempre coerenti tra loro.
  function buildRevealTextGrid(lines, width, height, cols, rows) {
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
      let fontSize = Math.round(lineHeight * 0.72);
      const setFont = () => {
        octx.font = `900 ${fontSize}px Segoe UI, Arial`;
        // un po' di spaziatura tra le lettere: a queste dimensioni il grassetto le fa
        // "toccare" leggermente (es. T-O-G in "TOGETHER") senza questo margine
        octx.letterSpacing = Math.max(1, Math.round(fontSize * 0.05)) + 'px';
      };
      setFont();
      while (octx.measureText(line).width > width * 0.94 && fontSize > 8) {
        fontSize -= 3;
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

  // Genera e mostra, dentro il mosaico live, lo stesso fotomosaico dell'immagine finale.
  async function renderRevealMosaic() {
    try {
      if (!state) return;
      const wrap = el('mosaicWrap');
      const grid = el('mosaicGrid');
      if (!wrap || !grid) return;

      const photos = [];
      Object.values(state.tables).forEach((t) => (t.photos || []).forEach((p) => photos.push(p.dataUrl)));
      if (!photos.length) return; // nessuna foto: resta la scritta semplice di ripiego

      const rect = wrap.getBoundingClientRect();
      const w = Math.max(200, Math.round(rect.width));
      const h = Math.max(150, Math.round(rect.height));

      const cellSize = 22;
      const cols = Math.max(20, Math.round(w / cellSize));
      const rows = Math.max(10, Math.round(h / cellSize));
      const cellW = w / cols, cellH = h / rows;

      const lum = buildRevealTextGrid(['TOGETHER', 'WE ARE ONE'], w, h, cols, rows);

      const shuffled = photos.slice();
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const imgs = await Promise.all(shuffled.map((src) => loadImageEl(src)));
      if (!state || state.phase < REVEAL_PHASE) return; // nel frattempo si è usciti dal reveal

      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.id = 'revealMosaicCanvas';
      canvas.style.cssText = 'position:relative; z-index:2; width:100%; height:100%; display:block; border-radius:16px;';
      const ctx = canvas.getContext('2d');

      let idx = 0;
      for (let ry = 0; ry < rows; ry++) {
        for (let rx = 0; rx < cols; rx++) {
          const img = imgs.length ? imgs[idx % imgs.length] : null;
          idx++;
          const x = rx * cellW, y = ry * cellH;
          drawCoverInto(ctx, img, x, y, cellW, cellH);
          const isLetter = lum[ry][rx] > 0.5;
          ctx.fillStyle = isLetter ? 'rgba(199,154,43,0.10)' : 'rgba(0,0,0,0.8)';
          ctx.fillRect(x, y, cellW, cellH);
        }
      }

      clearRevealMosaic();
      grid.style.display = 'none';
      el('mosaicTitle').style.display = 'none';
      wrap.appendChild(canvas);
    } catch (e) {
      // Ripiego opzionale: se qualcosa va storto qui, resta comunque visibile la scritta
      // semplice attivata da applyRevealSlogan(), e il resto del reveal non ne risente.
      console.error('Fotomosaico live del reveal non riuscito:', e);
    }
  }

  function clearRevealMosaic() {
    const canvas = document.getElementById('revealMosaicCanvas');
    if (canvas) canvas.remove();
    const grid = el('mosaicGrid');
    if (grid) grid.style.display = '';
  }

  // ---------- Effetti di transizione fase ----------
  let lastKnownPhase = null;

  function triggerFlash(kind) {
    const flash = el('flashOverlay');
    flash.className = 'flash-overlay'; // reset per poter ri-triggerare l'animazione
    void flash.offsetWidth; // forza il reflow
    flash.className = `flash-overlay show ${kind}`;
  }

  function triggerAssembleShake() {
    const grid = el('mosaicGrid');
    grid.classList.remove('assembling');
    void grid.offsetWidth;
    grid.classList.add('assembling');
  }

  // Prima che le foto "piovano" nel mosaico, un piccolo gruppo ruota al centro dello
  // schermo per un momento — un elemento decorativo isolato, rimosso da solo: se qualcosa
  // andasse storto qui non tocca il mosaico vero e proprio.
  function showSpinCluster(photoUrls) {
    if (!photoUrls.length) return;
    const wrap = el('mosaicWrap');
    if (!wrap) return;
    playSpinSound();
    const cluster = document.createElement('div');
    cluster.className = 'spin-cluster';
    photoUrls.slice(0, 8).forEach((dataUrl, i, arr) => {
      const img = document.createElement('img');
      img.src = dataUrl;
      const angle = (360 / arr.length) * i;
      const jitter = 34;
      img.style.setProperty('--jx', Math.round(Math.cos((angle * Math.PI) / 180) * jitter) + 'px');
      img.style.setProperty('--jy', Math.round(Math.sin((angle * Math.PI) / 180) * jitter) + 'px');
      img.style.animationDelay = i * 60 + 'ms';
      cluster.appendChild(img);
    });
    wrap.appendChild(cluster);
    setTimeout(() => cluster.remove(), 1700);
  }

  function onPhaseChanged(newPhase, oldPhase) {
    if (oldPhase == null) return; // primo caricamento pagina: non è una transizione da segnalare
    if (newPhase >= PHOTO_REVEAL_PHASE && oldPhase < PHOTO_REVEAL_PHASE) {
      triggerFlash('gold');
      const photoUrls = pendingMosaic
        .filter((item) => item.type === 'photo')
        .map((item) => item.photo.dataUrl);
      showSpinCluster(photoUrls);
      setTimeout(() => {
        triggerAssembleShake();
        flushPendingMosaic();
      }, 1300);
    }
    if (newPhase === REVEAL_PHASE && oldPhase !== REVEAL_PHASE) {
      triggerFlash('white');
      setTimeout(renderRevealMosaic, 900);
    }
  }

  // ---------- Socket events ----------
  socket.on('init', (st) => {
    state = st;
    lastKnownPhase = st.phase;
    fullRender();
    renderMosaicFromScratch();
    // Se la pagina si (ri)carica quando si è già in Vision Reveal (es. dopo un F5),
    // il fotomosaico va generato subito: non c'è nessuna transizione di fase da intercettare.
    if (st.phase >= REVEAL_PHASE) setTimeout(renderRevealMosaic, 300);
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
    showScatterMessage(payload.photo.message); // il Power Message compare sempre, in ogni fase
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
