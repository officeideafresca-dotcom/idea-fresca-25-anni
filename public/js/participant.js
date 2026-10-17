(function () {
  const LANGS = ['it', 'de', 'fr', 'es', 'en'];

  let lang = localStorage.getItem('if25_lang') || window.detectLang();
  let myPhotoCount = Number(localStorage.getItem('if25_my_photos') || 0);
  let pendingPhotoDataUrl = null;
  let latestState = null;

  const el = (id) => document.getElementById(id);
  const socket = io();

  function T(key) { return window.t(lang, key); }

  function showToast(msg) {
    const toast = el('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2200);
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
    el('photoTitle').textContent = T('photoTitle');
    el('photoSubtitle').textContent = T('photoSubtitle');
    el('powerMessageLabel').textContent = T('powerMessageLabel');
    el('powerMessageHelp').textContent = T('powerMessageHelp');
    el('powerMessageInput').placeholder = T('powerMessagePlaceholder');
    el('sendPhotoBtn').textContent = T('sendPhoto');
    el('finalImageTitle').textContent = T('finalImageTitle');
    el('finalImageHint').textContent = T('finalImageHint');
    el('finalImageSaveBtn').textContent = T('finalImageSave');
    el('finalImageCloseBtn').textContent = T('finalImageClose');
    updateStatusBadge();
    updatePhotoCount();
  }

  function updatePhotoCount() {
    el('photoCountText').textContent = myPhotoCount > 0 ? `${myPhotoCount} ${T('photosSent')}` : '';
    el('takePhotoBtn').textContent = myPhotoCount > 0 ? T('addPhoto') : T('takePhoto');
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
    if (!pendingPhotoDataUrl) return;
    const message = el('powerMessageInput').value.trim();
    if (!message) {
      showToast(T('powerMessageRequired'));
      el('powerMessageInput').focus();
      return;
    }
    // Il Power Message non viene più disegnato sulla foto: viaggia come testo a parte e
    // compare sullo schermo grande come elemento fluttuante per qualche secondo.
    socket.emit('submit-photo', { dataUrl: pendingPhotoDataUrl, message, lang });
    myPhotoCount++;
    localStorage.setItem('if25_my_photos', myPhotoCount);
    showToast('📸 ' + T('photosSent'));
    pendingPhotoDataUrl = null;
    el('photoPreview').classList.remove('show');
    el('powerMessageInput').value = '';
    el('photoInput').value = '';
    el('sendPhotoBtn').style.display = 'none';
    updatePhotoCount();
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

  // ---- Socket events ----
  socket.on('init', (st) => {
    latestState = st;
    updateStatusBadge();
  });
  socket.on('phase:update', (p) => {
    if (latestState) Object.assign(latestState, p);
    updateStatusBadge();
  });
  socket.on('reset', () => {
    localStorage.removeItem('if25_my_photos');
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
})();
