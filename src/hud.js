'use strict';

class TeslaHUD {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._dpr = 1;
    // Canvas fallback content (index.html) — the accessible text alternative
    this._statusEl = canvas.querySelector('#hud-status');
    this._lastStatusUpdate = -1e9;
    this.resize();
  }

  resize() {
    const canvas = this.canvas;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = window.devicePixelRatio || 1;
    this._dpr = dpr;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  clear() {
    const { width, height } = this.canvas;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, width, height);
    this.ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
  }

  render(sei, timeMs, useKph) {
    this.clear();
    this._updateStatus(sei, useKph);

    const ctx = this.ctx;
    const W = this.canvas.width / this._dpr;
    const H = this.canvas.height / this._dpr;

    if (!sei) return;

    this._drawGear(ctx, W, H, sei.gear_state);
    this._drawBrakePedal(ctx, W, H, sei.brake_applied);
    this._drawSpeed(ctx, W, H, sei.vehicle_speed_mps, useKph);
    this._drawAutopilot(ctx, W, H, sei.autopilot_state);
    this._drawBlinkers(ctx, W, H, sei.blinker_on_left, sei.blinker_on_right, timeMs);
    this._drawSteeringWheel(ctx, W, H, sei.steering_wheel_angle);
    this._drawAccelPedal(ctx, W, H, sei.accelerator_pedal_position);
  }

  // Mirrors the drawn telemetry into the canvas fallback text (throttled ~1/s)
  _updateStatus(sei, useKph) {
    if (!this._statusEl) return;
    const now = performance.now();
    if (now - this._lastStatusUpdate < 1000) return;
    this._lastStatusUpdate = now;

    let text = 'No telemetry';
    if (sei) {
      const GEARS = { 0: 'Park', 1: 'Drive', 2: 'Reverse', 3: 'Neutral' };
      const AP = { 1: 'Self Driving', 2: 'Autosteer', 3: 'Traffic-Aware Cruise' };
      const v = sei.vehicle_speed_mps ?? 0;
      const speed = Math.round(Math.max(0, useKph ? v * 3.6 : v * 2.23694));
      text = `${speed} ${useKph ? 'km/h' : 'mph'}, gear ${GEARS[sei.gear_state] ?? 'Park'}`;
      if (sei.brake_applied) text += ', braking';
      if (AP[sei.autopilot_state]) text += `, ${AP[sei.autopilot_state]}`;
    }
    if (this._statusEl.textContent !== text) this._statusEl.textContent = text;
  }

  _drawGear(ctx, W, H, gearState) {
    const LABELS = { 0: 'P', 1: 'D', 2: 'R', 3: 'N' };
    const label = LABELS[gearState] ?? 'P';
    ctx.font = `700 ${H * 0.6}px -apple-system, system-ui, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, W * 0.05, H * 0.46);
  }

  _drawBrakePedal(ctx, W, H, brakeApplied) {
    const level = brakeApplied ? 1 : 0;
    const r = H * 0.38;
    _drawBubblePedal(ctx, W * 0.155, H / 2, r, level, '#e74c3c', _drawBrakeIcon);
  }

  _drawBlinkers(ctx, W, H, leftOn, rightOn, timeMs) {
    const blinkOn = Math.floor(timeMs / 325) % 2 === 0;
    const activeColor = '#4cd964';
    const inactiveColor = 'rgba(255,255,255,0.1)';

    const arrowH = H * 0.42;
    const arrowW = H * 0.26;
    const arrowCy = H * 0.43;

    // Left arrow centered at W*0.29
    ctx.fillStyle = leftOn && blinkOn ? activeColor : inactiveColor;
    this._drawArrowLeft(ctx, W * 0.29 - arrowW / 2, arrowCy, arrowW, arrowH);

    // Right arrow centered at W*0.71 (symmetric)
    ctx.fillStyle = rightOn && blinkOn ? activeColor : inactiveColor;
    this._drawArrowRight(ctx, W * 0.71 - arrowW / 2, arrowCy, arrowW, arrowH);
  }

  // Arrow pointing left: rightmost point at (cx, cy), body to the right
  _drawArrowLeft(ctx, cx, cy, w, h) {
    const bodyH = h * 0.4;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + w * 0.45, cy - h / 2);
    ctx.lineTo(cx + w * 0.45, cy - bodyH / 2);
    ctx.lineTo(cx + w, cy - bodyH / 2);
    ctx.lineTo(cx + w, cy + bodyH / 2);
    ctx.lineTo(cx + w * 0.45, cy + bodyH / 2);
    ctx.lineTo(cx + w * 0.45, cy + h / 2);
    ctx.closePath();
    ctx.fill();
  }

  // Arrow pointing right: leftmost point at (cx, cy), body to the right
  _drawArrowRight(ctx, cx, cy, w, h) {
    const bodyH = h * 0.4;
    ctx.beginPath();
    ctx.moveTo(cx + w, cy);
    ctx.lineTo(cx + w * 0.55, cy - h / 2);
    ctx.lineTo(cx + w * 0.55, cy - bodyH / 2);
    ctx.lineTo(cx, cy - bodyH / 2);
    ctx.lineTo(cx, cy + bodyH / 2);
    ctx.lineTo(cx + w * 0.55, cy + bodyH / 2);
    ctx.lineTo(cx + w * 0.55, cy + h / 2);
    ctx.closePath();
    ctx.fill();
  }

  _drawSpeed(ctx, W, H, speedMps, useKph) {
    const speedVal = speedMps ?? 0;
    const converted = useKph ? speedVal * 3.6 : speedVal * 2.23694;
    const display = Math.round(Math.max(0, converted));
    const unit = useKph ? 'KM/H' : 'MPH';

    ctx.font = `700 ${H * 0.6}px -apple-system, system-ui, sans-serif`;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(display), W * 0.5, H * 0.4);

    ctx.font = `500 ${H * 0.18}px -apple-system, system-ui, sans-serif`;
    ctx.fillStyle = 'rgba(255,255,255,0.55)'; /* ≥4.5:1 on --surface */
    ctx.textBaseline = 'top';
    ctx.fillText(unit, W * 0.5, H * 0.7);
  }

  _drawAutopilot(ctx, W, H, apState) {
    const LABELS = { 0: '', 1: 'Self Driving', 2: 'Autosteer', 3: 'Traffic-Aware Cruise' };
    const label = LABELS[apState] || '';
    if (!label) return;

    ctx.font = `400 ${H * 0.15}px -apple-system, system-ui, sans-serif`;
    /* Both ≥4.5:1 on --surface (WCAG 1.4.3) */
    ctx.fillStyle = apState === 1 ? '#7da1f7' : 'rgba(255,255,255,0.62)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, W * 0.5, H * 0.99);
  }

  _drawSteeringWheel(ctx, W, H, angleDeg) {
    const angle = ((angleDeg || 0) * Math.PI) / 180;
    const r = H * 0.3;
    const cx = W * 0.95;
    const cy = H * 0.46;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    const s = r / 16;
    ctx.scale(s, s);
    ctx.translate(-16, -16);

    const path = new Path2D(
      'M16,0C7.164,0,0,7.164,0,16s7.164,16,16,16s16-7.164,16-16S24.836,0,16,0z ' +
      'M16,4c5.207,0,9.605,3.354,11.266,8H4.734C6.395,7.354,10.793,4,16,4z ' +
      'M16,18c-1.105,0-2-0.895-2-2s0.895-2,2-2s2,0.895,2,2S17.105,18,16,18z ' +
      'M4,16c5.465,0,9.891,5.266,9.984,11.797C8.328,26.828,4,21.926,4,16z ' +
      'M18.016,27.797C18.109,21.266,22.535,16,28,16C28,21.926,23.672,26.828,18.016,27.797z'
    );
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fill(path, 'evenodd');

    ctx.restore();
  }

  _drawAccelPedal(ctx, W, H, accelPos) {
    const raw = (accelPos != null && accelPos !== '') ? +accelPos : 0;
    // accelerator_pedal_position arrives as 0–100 (percent), not 0–1
    const level = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw / 100)) : 0;
    const r = H * 0.38;
    _drawBubblePedal(ctx, W * 0.845, H / 2, r, level, '#27ae60', _drawAccelIcon);
  }
}

function _drawBubblePedal(ctx, cx, cy, r, level, color, drawIcon) {
  ctx.save();

  // Background circle
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Color fill rising from bottom, clipped to circle
  if (level > 0.01) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r - 1, 0, Math.PI * 2);
    ctx.clip();
    const fillY = cy + r - (r * 2 * level);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.35 + level * 0.45;
    ctx.fillRect(cx - r, fillY, r * 2, cy + r - fillY);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 0.5, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  drawIcon(ctx, cx, cy, r);
  ctx.restore();
}

function _strokeRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
  ctx.stroke();
}

function _strokeGripLines(ctx, bodyX, bodyY, bodyW, bodyH, marginY) {
  const marginX = bodyW * 0.12;
  const count = 4;
  for (let i = 0; i < count; i++) {
    const ly = bodyY + marginY + (bodyH - marginY * 2) * (i / (count - 1));
    ctx.beginPath();
    ctx.moveTo(bodyX + marginX, ly);
    ctx.lineTo(bodyX + bodyW - marginX, ly);
    ctx.stroke();
  }
}

function _strokeRods(ctx, cx, rodSpacing, rodW, rodY, rodH) {
  const rod1X = cx - rodSpacing / 2 + rodW / 2;
  const rod2X = cx + rodSpacing / 2 - rodW / 2;
  ctx.strokeRect(rod1X - rodW / 2, rodY, rodW, rodH);
  ctx.strokeRect(rod2X - rodW / 2, rodY, rodW, rodH);
}

function _drawBrakeIcon(ctx, cx, cy, r) {
  const bodyW = r * 1.3;
  const bodyH = r * 0.55;
  const bodyX = cx - bodyW / 2;
  const bodyY = cy - bodyH * 0.1;
  const rodW = r * 0.1;
  const rodH = r * 0.55;
  const rodY = bodyY - rodH;

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.80)';
  ctx.lineWidth = 1.2;
  ctx.lineJoin = 'round';

  _strokeRods(ctx, cx, bodyW * 0.28, rodW, rodY, rodH);
  _strokeRoundedRect(ctx, bodyX, bodyY, bodyW, bodyH, Math.min(bodyW, bodyH) * 0.18);
  _strokeGripLines(ctx, bodyX, bodyY, bodyW, bodyH, bodyH * 0.18);

  ctx.restore();
}

function _drawAccelIcon(ctx, cx, cy, r) {
  const bodyW = r * 0.55;
  const bodyH = r * 1.1;
  const bodyX = cx - bodyW / 2;
  const bodyY = cy - bodyH * 0.55;
  const rodW = r * 0.09;
  const rodH = r * 0.45;
  const rodY = bodyY - rodH;

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.80)';
  ctx.lineWidth = 1.2;
  ctx.lineJoin = 'round';

  _strokeRods(ctx, cx, bodyW * 0.4, rodW, rodY, rodH);
  _strokeRoundedRect(ctx, bodyX, bodyY, bodyW, bodyH, bodyW * 0.18);
  _strokeGripLines(ctx, bodyX, bodyY, bodyW, bodyH, bodyH * 0.12);

  ctx.restore();
}

globalThis.TeslaHUD = TeslaHUD;
