(function () {
  const TABLE_COUNT = 10;
  const ICONS = ['mountain', 'hands', 'sprout', 'compass', 'rocket', 'star'];
  const ICON_EMOJI = { mountain: '🏔️', hands: '🤝', sprout: '🌱', compass: '🧭', rocket: '🚀', star: '⭐' };
  const LANGS = ['it', 'de', 'fr', 'es', 'en'];

  let lang = localStorage.getItem('if25_lang') || window.detectLang();
  let tableId = localStorage.getItem('if25_table') || null;
  let selectedIcon = null;
  let pendingPhotoDataUrl = null;
  let latestState = null;
  let deviceId = localStorage.getItem('if25_device_id');
  if (!deviceId) {
    deviceId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem('if25_device_id', deviceId);
  }

  const el = (id) => document.getElementById(id);
  const socket = io();

  function T(key) { return window.t(lang, key); }

  function showToast(msg) {
    const toast = el('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2200);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderLangSwitch() {
    const box = el('langSwitch');
    box.innerHTML = '';
    LANGS.forEach((l) => {
      const b = document.createElement('button');
      b.textContent = l.toUpperCase();
      if (l === lang) b.classList.add('active');
      b.onclick = () => { lang = l; localStorage.setItem('if25_lang', l); applyTranslations(); renderLangSwitch(); };
      box.appendChild(b);
    });
  }

  function applyTranslations() {
    document.documentElement.lang = lang;
    el('brandText').textContent = T('brand');
    el('sloganText').textContent = T('slogan');
    el('selectTableTitle').textContent = T('selectTable');
    el('yourTableLabel').textContent = T('yourTable');
    el('changeTableBtn').textContent = T('changeTable');
    el('metricsTitle').textContent = T('metricsTitle');
    el('metricsSubtitle').textContent = T('metricsSubtitle');
    el('claimExplainText').textContent = T('claimExplainText');
    el('claimNameInput').placeholder = T('leaderNamePlaceholder');
    el('claimLeaderBtn').textContent = T('claimLeaderBtn');
    el('releaseLeaderBtn').textContent = T('releaseLeaderBtn');
    el('leaderNameLabel').textContent = T('leaderNameLabel');
    el('leaderName').placeholder = T('leaderNamePlaceholder');
    el('metric1Label').textContent = T('metric1Label');
    el('metric1Help').textContent = T('metric1Help');
    el('metric1Unit').textContent = T('metric1Unit');
    el('metric2Label').textContent = T('metric2Label');
    el('metric2Help').textContent = T('metric2Help');
    el('metric2Unit').textContent = T('metric2Unit');
    el('metric3Label').textContent = T('metric3Label');
    el('metric3Help').textContent = T('metric3Help');
    el('metric3Value').placeholder = T('metric3ValuePlaceholder');
    el('metric3Label_').placeholder = T('metric3LabelPlaceholder');
    el('submitMetricsBtn').textContent = T('submitMetrics');
    el('metricsSavedNote').textContent = T('metricsSaved');
    el('photoTitle').textContent = T('photoTitle');
    el('photoSubtitle').textContent = T('photoSubtitle');
    el('takePhotoBtn').textContent = T('takePhoto');
    el('powerMessageLabel').textContent = T('powerMessageLabel');
    el('powerMessageHelp').textContent = T('powerMessageHelp');
    el('powerMessageInput').placeholder = T('powerMessagePlaceholder');
    el('sendPhotoBtn').textContent = T('sendPhoto');
    el('chooseIconLabel').textContent = T('chooseIcon');
    el('liveTotalsLabel').textContent = T('liveTotals');
    el('lt1Label').textContent = T('screen.newPartners');
    el('lt2Label').textContent = T('screen.retention');
    el('lt3Label').textContent = T('screen.symbolicTotal');
    el('lt4Label').textContent = T('screen.tablesIn');
    el('finalImageTitle').textContent = T('finalImageTitle');
    el('finalImageHint').textContent = T('finalImageHint');
    el('finalImageSaveBtn').textContent = T('finalImageSave');
    el('finalImageCloseBtn').textContent = T('finalImageClose');
    renderIconGrid();
    renderTableGrid();
    updateStatusBadge();
    updatePhotoCount();
    renderLeaderSection();
  }

  function renderTableGrid() {
    const grid = el('tableGrid');
    grid.innerHTML = '';
    for (let i = 1; i <= TABLE_COUNT; i++) {
      const btn = document.createElement('button');
      btn.className = 'table-btn' + (String(i) === String(tableId) ? ' selected' : '');
      btn.textContent = i;
      btn.onclick = () => selectTable(i);
      grid.appendChild(btn);
    }
  }

  function renderIconGrid() {
    const grid = el('iconGrid');
    grid.innerHTML = '';
    ICONS.forEach((icon) => {
      const btn = document.createElement('button');
      btn.className = 'icon-btn' + (icon === selectedIcon ? ' selected' : '');
      btn.innerHTML = `<span class="emoji">${ICON_EMOJI[icon]}</span><span class="label">${T('icons.' + icon)}</span>`;
      btn.onclick = () => {
        selectedIcon = icon;
        socket.emit('submit-icon', { tableId, icon });
        renderIconGrid();
        showToast(T('iconSaved'));
      };
      grid.appendChild(btn);
    });
  }

  function selectTable(id) {
    tableId = String(id);
    localStorage.setItem('if25_table', tableId);
    el('tableSelectCard').style.display = 'none';
    el('mainContent').style.display = 'flex';
    el('yourTableNumber').textContent = T('table') + ' ' + tableId;
    renderTableGrid();
    prefillFromState();
  }

  function prefillFromState() {
    if (!latestState || !tableId) return;
    const t = latestState.tables[tableId];
    if (!t) return;
    if (t.teamLeaderName) el('leaderName').value = t.teamLeaderName;
    if (t.metrics) {
      el('metric1').value = t.metrics.network ?? '';
      el('metric2').value = t.metrics.retention ?? '';
      el('metric3Value').value = t.metrics.symbolicValue ?? '';
      el('metric3Label_').value = t.metrics.symbolicLabel ?? '';
      el('metricsSavedNote').classList.add('show');
    }
    if (t.icon) selectedIcon = t.icon;
    renderIconGrid();
    updatePhotoCount(t.photosCount);
    renderLeaderSection();
  }

  // Mostra: box "rivendica il ruolo" / form completo (se sono il leader) / sola lettura (se lo è un altro)
  function renderLeaderSection() {
    if (!tableId || !latestState) return;
    const t = latestState.tables[tableId];
    if (!t) return;
    const claimBox = el('leaderClaimBox');
    const formBox = el('leaderFormBox');
    const readonlyBox = el('leaderReadonlyBox');

    if (!t.leaderDeviceId) {
      claimBox.style.display = 'block';
      formBox.style.display = 'none';
      readonlyBox.style.display = 'none';
    } else if (t.leaderDeviceId === deviceId) {
      claimBox.style.display = 'none';
      formBox.style.display = 'block';
      readonlyBox.style.display = 'none';
    } else {
      claimBox.style.display = 'none';
      formBox.style.display = 'none';
      readonlyBox.style.display = 'block';
      const name = t.teamLeaderName || '';
      el('readonlyLeaderText').textContent = name
        ? T('leaderManagedBy').replace('{name}', name)
        : T('leaderManagedByUnknown');
      const box = el('readonlyMetricsBox');
      if (t.metrics) {
        const m = t.metrics;
        box.innerHTML = `
          <div class="stat"><span>${escapeHtml(T('metric1Label'))}</span><b>+${m.network}</b></div>
          <div class="stat"><span>${escapeHtml(T('metric2Label'))}</span><b>${m.retention}%</b></div>
          <div class="stat"><span>${escapeHtml(T('metric3Label'))}</span><b>${m.symbolicValue} ${escapeHtml(m.symbolicLabel || '')}</b></div>
        `;
      } else {
        box.innerHTML = `<div class="stat"><span>${escapeHtml(T('metricsPending'))}</span></div>`;
      }
    }
  }

  function updatePhotoCount(count) {
    const t = latestState && tableId ? latestState.tables[tableId] : null;
    const n = count != null ? count : (t ? t.photosCount : 0);
    el('photoCountText').textContent = n > 0 ? `${n} ${T('photosSent')}` : '';
    el('takePhotoBtn').textContent = n > 0 ? T('addPhoto') : T('takePhoto');
  }

  function updateStatusBadge() {
    const badge = el('statusBadge');
    if (!latestState) { badge.textContent = '—'; badge.className = 'status-badge'; return; }
    if (latestState.status === 'running') {
      badge.textContent = T('runningBadge');
      badge.className = 'status-badge running';
    } else if (latestState.status === 'paused') {
      badge.textContent = T('pausedBadge');
      badge.className = 'status-badge paused';
    } else if (latestState.status === 'finished') {
      badge.textContent = T('finishedTitle');
      badge.className = 'status-badge';
    } else {
      badge.textContent = T('waitingTitle');
      badge.className = 'status-badge';
    }
  }

  function updateLiveTicker() {
    if (!latestState) return;
    const t = latestState.totals;
    el('lt1Value').textContent = '+' + t.network.toLocaleString(lang);
    el('lt2Value').textContent = t.retention + '%';
    el('lt3Value').textContent = t.symbolic.toLocaleString(lang);
    el('lt4Value').textContent = `${t.tablesSubmitted} / ${t.tablesTotal}`;
  }

  // ---- Rivendicazione ruolo Team Leader ----
  el('claimLeaderBtn').addEventListener('click', () => {
    if (!tableId) return;
    const name = el('claimNameInput').value.trim();
    if (!name) {
      showToast(T('leaderNameRequired'));
      el('claimNameInput').focus();
      return;
    }
    socket.emit('claim-leader', { tableId, deviceId, name });
  });

  el('releaseLeaderBtn').addEventListener('click', () => {
    if (!tableId) return;
    if (!confirm(T('releaseLeaderConfirm'))) return;
    socket.emit('release-leader', { tableId, deviceId });
  });

  // ---- Metrics submit ----
  el('submitMetricsBtn').addEventListener('click', () => {
    if (!tableId) return;
    const metrics = {
      network: Number(el('metric1').value) || 0,
      retention: Number(el('metric2').value) || 0,
      symbolicValue: Number(el('metric3Value').value) || 0,
      symbolicLabel: el('metric3Label_').value || '',
    };
    socket.emit('submit-metrics', { tableId, deviceId, teamLeaderName: el('leaderName').value, lang, metrics });
    el('metricsSavedNote').classList.add('show');
    showToast(T('metricsSaved'));
  });

  // ---- Photo capture (in due passi: scegli foto -> scrivi Power Message -> invia) ----
  el('takePhotoBtn').addEventListener('click', () => el('photoInput').click());

  el('photoInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    compressImage(file, 640, 0.72).then((dataUrl) => {
      pendingPhotoDataUrl = dataUrl;
      const preview = el('photoPreview');
      preview.src = dataUrl;
      preview.classList.add('show');
      el('sendPhotoBtn').style.display = 'block';
      el('powerMessageInput').focus();
    });
  });

  el('sendPhotoBtn').addEventListener('click', () => {
    if (!tableId || !pendingPhotoDataUrl) return;
    const message = el('powerMessageInput').value.trim();
    if (!message) {
      showToast(T('powerMessageRequired'));
      el('powerMessageInput').focus();
      return;
    }
    // Il Power Message non viene più disegnato sulla foto: viaggia come testo a parte e
    // compare sullo schermo grande come elemento fluttuante per qualche secondo.
    socket.emit('submit-photo', { tableId, dataUrl: pendingPhotoDataUrl, message, lang });
    showToast('📸 ' + T('photosSent'));
    pendingPhotoDataUrl = null;
    el('photoPreview').classList.remove('show');
    el('powerMessageInput').value = '';
    el('photoInput').value = '';
    el('sendPhotoBtn').style.display = 'none';
  });

  function compressImage(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > height && width > maxDim) { height = Math.round(height * (maxDim / width)); width = maxDim; }
          else if (height > maxDim) { width = Math.round(width * (maxDim / height)); height = maxDim; }
          const canvas = document.createElement('canvas');
          canvas.width = width; canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  el('changeTableBtn').addEventListener('click', () => {
    tableId = null;
    localStorage.removeItem('if25_table');
    el('tableSelectCard').style.display = 'block';
    el('mainContent').style.display = 'none';
    pendingPhotoDataUrl = null;
    el('photoPreview').classList.remove('show');
    el('powerMessageInput').value = '';
    el('photoInput').value = '';
    el('sendPhotoBtn').style.display = 'none';
    renderTableGrid();
  });

  // ---- Socket events ----
  socket.on('init', (st) => {
    latestState = st;
    updateStatusBadge();
    updateLiveTicker();
    if (tableId) prefillFromState();
  });
  socket.on('metrics:update', (payload) => {
    if (latestState) { latestState.tables[payload.tableId] = payload.table; latestState.totals = payload.totals; }
    updateLiveTicker();
    if (String(payload.tableId) === String(tableId)) renderLeaderSection();
  });
  socket.on('photo:add', (payload) => {
    if (latestState && latestState.tables[payload.tableId]) {
      latestState.tables[payload.tableId].photosCount = payload.photosCount;
      latestState.totals = payload.totals;
    }
    updateLiveTicker();
    if (String(payload.tableId) === String(tableId)) updatePhotoCount(payload.photosCount);
  });
  socket.on('leader:update', (payload) => {
    if (latestState && latestState.tables[payload.tableId]) {
      latestState.tables[payload.tableId].leaderDeviceId = payload.leaderDeviceId;
      latestState.tables[payload.tableId].teamLeaderName = payload.teamLeaderName;
    }
    if (String(payload.tableId) === String(tableId)) renderLeaderSection();
  });
  socket.on('leader:claim-error', (payload) => {
    if (String(payload.tableId) !== String(tableId)) return;
    showToast(T('leaderClaimError'));
    renderLeaderSection();
  });
  socket.on('phase:update', (p) => {
    if (latestState) Object.assign(latestState, p);
    updateStatusBadge();
  });
  socket.on('reset', () => {
    localStorage.removeItem('if25_table');
    location.reload();
  });
  socket.on('final-image', (payload) => {
    el('finalImageImg').src = payload.dataUrl;
    el('finalImageSaveBtn').href = payload.dataUrl;
    el('finalImageOverlay').classList.add('show');
  });

  el('finalImageCloseBtn').addEventListener('click', () => {
    el('finalImageOverlay').classList.remove('show');
  });

  // ---- init ----
  renderLangSwitch();
  applyTranslations();
  if (tableId) selectTable(Number(tableId));
})();
