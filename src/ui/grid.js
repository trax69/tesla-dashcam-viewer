'use strict';

let quadCanvases = {};

function buildQuadGrid(cams) {
  quadView.querySelectorAll('.quad-cell').forEach((el) => el.remove());
  quadCanvases = {};

  const count = cams.length;
  let gridClass = 'grid-4';
  if (count <= 1)      gridClass = 'grid-1';
  else if (count <= 2) gridClass = 'grid-2';
  else if (count >= 6) gridClass = 'grid-6';
  quadView.className = gridClass;

  const orderedCams = count >= 6 ? CAM_ORDER_6.filter((c) => cams.includes(c)) : cams;

  for (const cam of orderedCams) {
    const cell = document.createElement('div');
    cell.className = 'quad-cell';
    cell.id = `cell-${cam}`;

    const canvas = document.createElement('canvas');
    canvas.id = `cam-${cam}`;
    cell.appendChild(canvas);

    const label = document.createElement('div');
    label.className = 'cam-label';
    label.textContent = CAM_LABELS[cam] ?? cam.toUpperCase();
    cell.appendChild(label);

    quadView.appendChild(cell);
    quadCanvases[cam] = canvas;
  }
}

function buildCanvasMap(cams) {
  if (state.activeCam === 'quad') {
    const map = {};
    for (const cam of cams) map[cam] = quadCanvases[cam] ?? null;
    return map;
  }
  const map = {};
  for (const cam of cams) map[cam] = cam === state.activeCam ? singleCanvas : null;
  return map;
}

function updateCamButtons(availableCams) {
  document.querySelectorAll('.pillar-btn').forEach((btn) => {
    btn.classList.toggle('hidden', !availableCams.includes(btn.dataset.cam));
  });
  const quadIcon = document.querySelector('#btn-cam-quad .quad-icon');
  if (quadIcon) {
    const n = availableCams.length;
    quadIcon.innerHTML = new Array(n).fill('<span></span>').join('');
    quadIcon.className = `cam-icon quad-icon quad-icon-${Math.min(n, 6)}`;
  }
}
