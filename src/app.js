'use strict';

// ── Boot ──────────────────────────────────────────────────────────────────────
// Classic script (not a module) so the app also runs from file:// — browsers
// block module scripts, workers and fetch() there. The protobuf schema is
// inlined (src/proto.js) and SEI parsing falls back to the main thread.

const hudInst = new TeslaHUD($('hud-canvas'));

const player = new Player();
player.setHUD(hudInst);
player.onTimeUpdate      = onTimeUpdate;
player.onPlayStateChange = onPlayStateChange;
player.onClipEnd         = onClipEnd;

// Wire the UI first — folder selection must keep working even if the SEI
// worker can't start.
wireEvents();

player.init(DASHCAM_PROTO).catch((e) => // NOSONAR — top-level await needs a module script; modules are blocked on file://
  console.warn('SEI telemetry unavailable — videos will play without HUD.', e)
);

// ── File loading ──────────────────────────────────────────────────────────────

function handleDrop(e) {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const items = e.dataTransfer.items;
  if (!items) return;
  collectFilesFromDataTransfer(items).then(loadFolder);
}

function handleFolderInput(e) {
  loadFolder(Array.from(e.target.files));
  e.target.value = '';
}

function loadFolder(fileList) {
  const clips = parseFileList(fileList);
  if (!clips.length) {
    alert('No Tesla dashcam videos found.\nExpected files like: 2024-08-05_23-19-26-front.mp4');
    return;
  }
  state.clips = clips;
  state.currentClipIdx = -1;

  state.activeCam = 'quad';
  quadView.classList.remove('hidden');
  singleView.classList.add('hidden');
  setActiveCamButtons('quad');

  dropZone.classList.add('hidden');
  appEl.classList.remove('hidden');
  renderClipList();
  loadClipAtIndex(0);
}

// ── Clip loading ──────────────────────────────────────────────────────────────

async function loadClipAtIndex(idx) {
  if (idx < 0 || idx >= state.clips.length) return;
  if (idx === state.currentClipIdx) return;

  player.pause();
  state.currentClipIdx = idx;
  updateClipListActive();
  scrollClipIntoView(idx);

  const clip = state.clips[idx];
  const availableCams = ALL_CAMS.filter((c) => clip.files[c]);
  state.availableCams = availableCams;

  buildQuadGrid(availableCams);
  updateCamButtons(availableCams);

  if (state.activeCam !== 'quad' && !availableCams.includes(state.activeCam)) {
    state.activeCam = 'quad';
  }

  const targetCam = state.activeCam;
  if (targetCam === 'quad') {
    quadView.classList.remove('hidden');
    singleView.classList.add('hidden');
  } else {
    quadView.classList.add('hidden');
    singleView.classList.remove('hidden');
  }
  setActiveCamButtons(targetCam);

  hudInst.resize();
  showLoading('Loading cameras…');

  const canvases = buildCanvasMap(availableCams);

  try {
    await player.loadClipGroup(clip, canvases, (cam, status) => {
      if (cam) loadingText.textContent = `${status === 'loading' ? 'Loading' : 'Parsing'} ${cam}…`;
      else hideLoading();
    });

    hideLoading();
    updateEventInfo(clip);
    btnPrev.disabled = idx === 0;
    btnNext.disabled = idx === state.clips.length - 1;

    await player.seekTo(0);
    player.play();
  } catch (e) {
    hideLoading();
    console.error('Failed to load clip:', e);
  }
}

// Sync visual + ARIA pressed state of the camera toggle buttons
function setActiveCamButtons(mode) {
  document.querySelectorAll('.cam-btn').forEach((btn) => {
    const active = btn.dataset.cam === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

// ── Camera mode ───────────────────────────────────────────────────────────────

function setCameraMode(mode) {
  if (state.currentClipIdx < 0) return; // nothing loaded yet
  state.activeCam = mode;
  player.setActiveCam(mode);

  setActiveCamButtons(mode);

  if (mode === 'quad') {
    quadView.classList.remove('hidden');
    singleView.classList.add('hidden');
  } else {
    quadView.classList.add('hidden');
    singleView.classList.remove('hidden');
  }

  hudInst.resize();
  player.setCanvases(buildCanvasMap(state.availableCams));
}

// ── Player callbacks ──────────────────────────────────────────────────────────

function onTimeUpdate(timeMs, durationMs) {
  timeDisplay.textContent = `${formatTime(timeMs)} / ${formatTime(durationMs)}`;
  if (durationMs > 0) scrubber.value = Math.round((timeMs / durationMs) * 10000);
  scrubber.setAttribute('aria-valuetext', `${formatTime(timeMs)} of ${formatTime(durationMs)}`);
  updateScrubFill();
}

// Keeps the played portion of the scrubber track filled (see #scrubber CSS)
function updateScrubFill() {
  scrubber.style.setProperty('--scrub', scrubber.value / 100);
}

function onPlayStateChange(playing) {
  iconPlay.classList.toggle('hidden', playing);
  iconPause.classList.toggle('hidden', !playing);
}

function onClipEnd() {
  if (state.currentClipIdx < state.clips.length - 1) {
    loadClipAtIndex(state.currentClipIdx + 1);
  }
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function wireEvents() {
  dropZone.addEventListener('dragover',  (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop',      handleDrop);
  folderInput.addEventListener('change', handleFolderInput);

  $('btn-load-folder').addEventListener('click', () => $('folder-input-reload').click());
  $('folder-input-reload').addEventListener('change', handleFolderInput);

  appEl.addEventListener('dragover', (e) => e.preventDefault());
  appEl.addEventListener('drop',     handleDrop);

  document.querySelectorAll('.cam-btn').forEach((btn) =>
    btn.addEventListener('click', () => setCameraMode(btn.dataset.cam))
  );

  btnPlay.addEventListener('click', () => player.togglePlay());
  btnPrev.addEventListener('click', () => loadClipAtIndex(state.currentClipIdx - 1));
  btnNext.addEventListener('click', () => loadClipAtIndex(state.currentClipIdx + 1));

  let scrubWasPlaying = false;

  scrubber.addEventListener('mousedown', () => { scrubWasPlaying = player.playing; player.pause(); });
  scrubber.addEventListener('touchstart', () => { scrubWasPlaying = player.playing; player.pause(); }, { passive: true });

  scrubber.addEventListener('input', () => {
    const t = (+scrubber.value / 10000) * player.duration;
    timeDisplay.textContent = `${formatTime(t)} / ${formatTime(player.duration)}`;
    scrubber.setAttribute('aria-valuetext', `${formatTime(t)} of ${formatTime(player.duration)}`);
    updateScrubFill();
    player.seekPreview(t);
  });

  scrubber.addEventListener('change', async () => {
    const t = (+scrubber.value / 10000) * player.duration;
    await player.seekTo(t);
    if (scrubWasPlaying) player.play();
  });

  speedSelect.addEventListener('change', () => {
    state.playbackRate = +speedSelect.value;
    player.setRate(state.playbackRate);
  });

  btnUnit.addEventListener('click', () => {
    state.useKph = !state.useKph;
    btnUnit.textContent = state.useKph ? 'km/h' : 'mph';
    player.setUseKph(state.useKph);
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    const actions = {
      ' ':          () => { e.preventDefault(); player.togglePlay(); },
      'ArrowLeft':  () => { e.preventDefault(); player.seekRelative(-10); },
      'ArrowRight': () => { e.preventDefault(); player.seekRelative(10); },
      'ArrowUp':    () => { e.preventDefault(); loadClipAtIndex(state.currentClipIdx - 1); },
      'ArrowDown':  () => { e.preventDefault(); loadClipAtIndex(state.currentClipIdx + 1); },
    };
    actions[e.key]?.();
  });

  window.addEventListener('resize', () => hudInst?.resize());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) player.onVisibilityChange(); });
}

// Expose to classic-script files that reference these as globals
globalThis.loadClipAtIndex = loadClipAtIndex;

