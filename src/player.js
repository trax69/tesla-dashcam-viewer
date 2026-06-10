'use strict';

// All cameras Tesla produces (superset — clips may have a subset)
const ALL_CAM_NAMES = ['front', 'back', 'left_repeater', 'right_repeater', 'left_pillar', 'right_pillar'];

// ── CameraTrack ──────────────────────────────────────────────────────────────
// Uses a hidden <video> element for decoding (smooth, native, hardware-accelerated).
// SEI metadata is extracted separately by the worker and mapped to video timestamps.
class CameraTrack {
  constructor(name, canvas) {
    this.name = name;
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d') : null;
    this.framesMeta = [];   // [{index, keyframe, timeMs, sei}] from worker
    this.totalDurationMs = 0;
    this.objectUrl = null;

    // The hidden <video> element — one per track
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.preload = 'auto';
    // Keep it off-screen
    this.video.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;';
    document.body.appendChild(this.video);

    this.pendingSei = null;
    this._rafHandle = null;
    this._lastDrawnTime = -1;
    this._lastDriftCorrection = 0;
  }

  get duration() { return this.totalDurationMs; }

  seiAtTime(timeMs) {
    const frames = this.framesMeta;
    if (!frames.length) return null;
    let lo = 0, hi = frames.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (frames[mid].timeMs <= timeMs) lo = mid;
      else hi = mid - 1;
    }
    return frames[lo]?.sei ?? null;
  }

  async load(file) {
    this.unload();
    this.objectUrl = URL.createObjectURL(file);
    this.video.src = this.objectUrl;
    await new Promise((resolve, reject) => {
      const onLoaded = () => { cleanup(); resolve(); };
      const onError = (e) => { cleanup(); reject(new Error(`Video load error: ${e.type}`)); };
      const cleanup = () => {
        this.video.removeEventListener('loadedmetadata', onLoaded);
        this.video.removeEventListener('error', onError);
      };
      this.video.addEventListener('loadedmetadata', onLoaded);
      this.video.addEventListener('error', onError);
      this.video.load();
    });
    this.totalDurationMs = (this.video.duration || 0) * 1000;
  }

  unload() {
    this.video.pause();
    this.video.src = '';
    if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; }
    this.framesMeta = [];
    this.totalDurationMs = 0;
    this.pendingSei = null;
    this._lastDrawnTime = -1;
  }

  destroy() {
    this.unload();
    this.video.remove();
  }

  // Draw current video frame to canvas
  drawCurrentFrame() {
    if (!this.canvas || !this.ctx) return;
    const v = this.video;
    if (v.readyState < 2) return; // HAVE_CURRENT_DATA
    const t = v.currentTime;
    if (t === this._lastDrawnTime) return;
    this._lastDrawnTime = t;
    this.ctx.drawImage(v, 0, 0, this.canvas.width, this.canvas.height);
    // Update SEI from framesMeta
    this.pendingSei = this.seiAtTime(t * 1000);
  }

  // Set canvas size from video metadata
  applyVideoDimensions() {
    if (!this.canvas) return;
    const v = this.video;
    if (v.videoWidth && v.videoHeight) {
      this.canvas.width = v.videoWidth;
      this.canvas.height = v.videoHeight;
    }
  }
}

// ── Player ───────────────────────────────────────────────────────────────────
class Player {
  constructor() {
    this.tracks = new Map();           // camName -> CameraTrack

    this._worker = null;
    this._seiReady = false;
    this._mainThreadSei = null;
    this._pendingWorkerReplies = new Map();
    this._workerParseResolvers = new Map();
    this._reqCounter = 0;

    this._playing = false;
    this._rafHandle = null;
    this._duration = 0;
    this._masterCam = null;  // camera name used as master clock

    this._hud = null;
    this._useKph = false;

    this.onTimeUpdate = null;
    this.onPlayStateChange = null;
    this.onClipEnd = null;

    this._protoText = null;
    this._endedBound = this._onMasterEnded.bind(this);
    this._timeupdateBound = this._onMasterTimeUpdate.bind(this);
  }

  async init(protoText) {
    this._protoText = protoText;
    await this._ensureWorker();
  }

  // True when SEI telemetry can be extracted (worker or main-thread fallback).
  get seiAvailable() { return this._seiReady || !!this._mainThreadSei; }

  // (Re)starts the SEI worker. Always settles — telemetry is optional, so a
  // worker that can't start (file://, 404, blocked) must never stall the app.
  // When workers are unavailable, falls back to parsing on the main thread.
  async _ensureWorker() {
    this._seiReady = false;
    this._settleAllPending();
    if (this._worker) { this._worker.terminate(); this._worker = null; }
    if (!this._protoText) {
      console.warn('No SEI schema loaded — telemetry HUD disabled.');
      return;
    }
    try {
      this._worker = new Worker('src/worker-sei.js');
    } catch (e) {
      this._onWorkerFailure(e.message);
      return;
    }
    this._worker.onmessage = (ev) => this._onWorkerMessage(ev.data);
    this._worker.onerror = (e) => this._onWorkerFailure(e.message || 'worker script failed to load');
    this._seiReady = await this._sendWorkerInit(this._protoText);
  }

  // Settle every pending worker promise so no caller is left awaiting forever.
  _settleAllPending() {
    const proto = this._pendingWorkerReplies.get('__proto__');
    if (proto) { proto.resolve(false); this._pendingWorkerReplies.delete('__proto__'); }
    for (const [cam, r] of this._workerParseResolvers) {
      r.resolve({ camName: cam, framesMeta: [] });
    }
    this._workerParseResolvers.clear();
  }

  // Worker died or never loaded: switch to the main-thread parser if possible.
  _onWorkerFailure(reason) {
    this._seiReady = false;
    this._settleAllPending();
    if (this._initMainThreadFallback()) {
      console.warn('SEI worker unavailable — parsing telemetry on the main thread:', reason);
    } else {
      console.warn('SEI worker unavailable — telemetry HUD disabled:', reason);
    }
  }

  // Prepares protobuf decoding on the main thread (vendor libs are already
  // loaded by index.html). Used when the Worker API is blocked, e.g. file://.
  _initMainThreadFallback() {
    if (this._mainThreadSei) return true;
    try {
      if (typeof protobuf === 'undefined' || typeof DashcamMP4 === 'undefined' ||
          typeof extractFramesMeta !== 'function' || !this._protoText) return false;
      const root = protobuf.parse(this._protoText, { keepCase: true }).root;
      this._mainThreadSei = root.lookupType('SeiMetadata');
      return true;
    } catch {
      return false;
    }
  }

  async _parseOnMainThread(camName, buffer) {
    if (!this._mainThreadSei) return { camName, framesMeta: [] };
    await new Promise((r) => setTimeout(r)); // let the loading overlay paint
    try {
      return { camName, ...extractFramesMeta(buffer, this._mainThreadSei) };
    } catch (e) {
      console.warn(`SEI parse failed for ${camName}:`, e.message);
      return { camName, framesMeta: [] };
    }
  }

  _onWorkerMessage(msg) {
    switch (msg.type) {
      case 'PROTO_READY': {
        const r = this._pendingWorkerReplies.get('__proto__');
        if (r) { r.resolve(true); this._pendingWorkerReplies.delete('__proto__'); }
        break;
      }
      case 'DONE': {
        const r = this._workerParseResolvers.get(msg.camName);
        if (r) { r.resolve(msg); this._workerParseResolvers.delete(msg.camName); }
        break;
      }
      case 'ERROR': {
        const r = msg.camName ? this._workerParseResolvers.get(msg.camName) : null;
        if (r) {
          // SEI extraction failed for one camera — keep its video, skip HUD data.
          console.warn(`SEI parse failed for ${msg.camName}:`, msg.error);
          r.resolve({ camName: msg.camName, framesMeta: [] });
          this._workerParseResolvers.delete(msg.camName);
        } else {
          this._onWorkerFailure(msg.error);
        }
        break;
      }
    }
  }

  _sendWorkerInit(protoText) {
    return new Promise((resolve) => {
      this._pendingWorkerReplies.set('__proto__', { resolve });
      this._worker.postMessage({ type: 'INIT_PROTO', protoText });
    });
  }

  _sendWorkerParse(camName, buffer) {
    if (!this._seiReady || !this._worker) {
      return this._parseOnMainThread(camName, buffer);
    }
    return new Promise((resolve) => {
      this._workerParseResolvers.set(camName, { resolve });
      this._worker.postMessage({ type: 'PARSE', camName, buffer }, [buffer]);
    });
  }

  // ── Load clip group ──────────────────────────────────────────────────────
  async loadClipGroup(clipGroup, canvases, onProgress) {
    this.pause();
    this._detachMasterListeners();

    // Destroy old tracks
    for (const track of this.tracks.values()) track.destroy();
    this.tracks.clear();
    this._masterCam = null;
    this._duration = 0;

    // Restart worker (drops any in-flight parses from the previous clip)
    await this._ensureWorker();

    const files = clipGroup.files;
    const camNames = Object.keys(files);

    // Phase 1: load video + parse SEI in parallel per camera
    const loadResults = await Promise.allSettled(camNames.map(async (cam) => {
      const file = files[cam];
      if (!file) return null;
      if (onProgress) onProgress(cam, 'loading');

      const track = new CameraTrack(cam, canvases[cam] || null);

      // Load video and fetch SEI in parallel
      const [, seiResult] = await Promise.all([
        track.load(file),
        (async () => {
          if (!this.seiAvailable) return { framesMeta: [] };
          if (onProgress) onProgress(cam, 'parsing');
          const buffer = await file.arrayBuffer();
          return this._sendWorkerParse(cam, buffer);
        })(),
      ]);

      track.framesMeta = seiResult.framesMeta || [];
      track.applyVideoDimensions();
      return { cam, track };
    }));

    for (const r of loadResults) {
      if (r.status !== 'fulfilled' || !r.value) continue;
      const { cam, track } = r.value;
      this.tracks.set(cam, track);
    }

    // Duration: use longest video duration
    let maxDur = 0;
    for (const track of this.tracks.values()) {
      if (track.duration > maxDur) maxDur = track.duration;
    }
    this._duration = maxDur;

    // Master: prefer front, then first available
    this._masterCam = this.tracks.has('front') ? 'front' : [...this.tracks.keys()][0] ?? null;
    this._attachMasterListeners();

    if (onProgress) onProgress(null, 'ready');
    return [...this.tracks.keys()];
  }

  _masterTrack() { return this._masterCam ? this.tracks.get(this._masterCam) : null; }

  _attachMasterListeners() {
    const master = this._masterTrack();
    if (!master) return;
    master.video.addEventListener('ended', this._endedBound);
    master.video.addEventListener('timeupdate', this._timeupdateBound);
  }

  _detachMasterListeners() {
    const master = this._masterTrack();
    if (!master) return;
    master.video.removeEventListener('ended', this._endedBound);
    master.video.removeEventListener('timeupdate', this._timeupdateBound);
  }

  _onMasterEnded() {
    this._playing = false;
    if (this.onPlayStateChange) this.onPlayStateChange(false);
    if (this.onClipEnd) this.onClipEnd();
  }

  _onMasterTimeUpdate() {
    if (!this._playing) return;
    const master = this._masterTrack();
    if (!master) return;
    const timeMs = master.video.currentTime * 1000;
    if (this.onTimeUpdate) this.onTimeUpdate(timeMs, this._duration);
  }

  // ── Seek ─────────────────────────────────────────────────────────────────
  async seekTo(timeMs) {
    const targetSec = Math.max(0, Math.min(timeMs / 1000, this._duration / 1000));
    const seeks = [];
    for (const track of this.tracks.values()) {
      track.video.currentTime = targetSec;
      seeks.push(new Promise((resolve) => {
        const onSeeked = () => { track.video.removeEventListener('seeked', onSeeked); resolve(); };
        track.video.addEventListener('seeked', onSeeked);
        // Fallback if already at position
        if (track.video.seeking === false) resolve();
      }));
    }
    await Promise.allSettled(seeks);

    // Draw first frame at seek position
    for (const track of this.tracks.values()) {
      track._lastDrawnTime = -1;
      track.drawCurrentFrame();
    }
    this._drawHUD();

    const timeMs2 = targetSec * 1000;
    if (this.onTimeUpdate) this.onTimeUpdate(timeMs2, this._duration);
  }

  seekRelative(deltaS) {
    const master = this._masterTrack();
    const current = master ? master.video.currentTime * 1000 : 0;
    return this.seekTo(current + deltaS * 1000);
  }

  // Non-blocking preview seek for scrubber dragging.
  // Sets currentTime immediately and draws whatever the browser has ready.
  // Does not await the 'seeked' event — the frame may lag by one keyframe interval,
  // but this gives instant visual feedback without stacking async seeks.
  seekPreview(timeMs) {
    const targetSec = Math.max(0, Math.min(timeMs / 1000, this._duration / 1000));
    for (const track of this.tracks.values()) {
      track.video.currentTime = targetSec;
      track._lastDrawnTime = -1; // force redraw even if time didn't change
    }
    for (const track of this.tracks.values()) {
      if (track.video.readyState >= 2) track.drawCurrentFrame();
    }
    this._drawHUD();
    const t = targetSec * 1000;
    if (this.onTimeUpdate) this.onTimeUpdate(t, this._duration);
  }

  // ── Playback ──────────────────────────────────────────────────────────────
  play() {
    if (this._playing) return;
    this._playing = true;

    const playPromises = [];
    for (const track of this.tracks.values()) {
      track.video.playbackRate = this._rate ?? 1;
      playPromises.push(track.video.play().catch(() => {}));
    }
    Promise.all(playPromises).then(() => {
      this._startRaf();
    });

    if (this.onPlayStateChange) this.onPlayStateChange(true);
  }

  pause() {
    this._playing = false;
    for (const track of this.tracks.values()) track.video.pause();
    this._stopRaf();
    if (this.onPlayStateChange) this.onPlayStateChange(false);
  }

  togglePlay() { if (this._playing) this.pause(); else this.play(); }

  _rate = 1;
  setRate(rate) {
    this._rate = rate;
    for (const track of this.tracks.values()) track.video.playbackRate = rate;
  }

  setHUD(hud) { this._hud = hud; }
  setUseKph(v) { this._useKph = v; }
  setActiveCam(cam) { this._activeCam = cam; }

  // Reassigns canvases on existing tracks without reloading video.
  setCanvases(canvasMap) {
    for (const [name, track] of this.tracks) {
      const canvas = canvasMap[name] ?? null;
      track.canvas = canvas;
      track.ctx = canvas ? canvas.getContext('2d') : null;
      track._lastDrawnTime = -1;
      if (canvas) track.applyVideoDimensions();
    }
    for (const track of this.tracks.values()) {
      if (track.video.readyState >= 2) track.drawCurrentFrame();
    }
    this._drawHUD();
  }

  get currentTimeMs() {
    const m = this._masterTrack();
    return m ? m.video.currentTime * 1000 : 0;
  }
  get duration() { return this._duration; }
  get playing() { return this._playing; }

  onVisibilityChange() {
    // Native video handles this automatically
  }

  // ── rAF loop — only for canvas drawing + HUD ─────────────────────────────
  _startRaf() {
    if (this._rafHandle) return;
    let lastDraw = 0;
    const FRAME_MS = 1000 / 30;
    const loop = (now) => {
      if (!this._playing) return;
      if (now - lastDraw >= FRAME_MS) {
        this._drawAll();
        lastDraw = now;
      }
      this._rafHandle = requestAnimationFrame(loop);
    };
    this._rafHandle = requestAnimationFrame(loop);
  }

  _stopRaf() {
    if (this._rafHandle) { cancelAnimationFrame(this._rafHandle); this._rafHandle = null; }
  }

  _drawAll() {
    for (const track of this.tracks.values()) track.drawCurrentFrame();
    this._drawHUD();

    // Sync non-master cameras to master time (drift correction)
    const master = this._masterTrack();
    if (!master) return;
    const masterTime = master.video.currentTime;
    const now = performance.now();
    for (const [name, track] of this.tracks) {
      if (name === this._masterCam) continue;
      if (track.video.readyState < 1) continue;
      const drift = Math.abs(track.video.currentTime - masterTime);
      if (drift > 0.25 && now - track._lastDriftCorrection > 500) {
        track.video.currentTime = masterTime;
        track._lastDriftCorrection = now;
      }
    }
  }

  _drawHUD() {
    if (!this._hud) return;
    const frontTrack = this.tracks.get('front') || this._masterTrack();
    const sei = frontTrack?.pendingSei ?? null;
    const timeMs = this.currentTimeMs;
    this._hud.render(sei, timeMs, this._useKph);
  }
}

globalThis.Player = Player;
