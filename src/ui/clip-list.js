'use strict';

function renderClipList() {
  clipList.innerHTML = '';
  state.clips.forEach((clip, i) => {
    // Real <button> so clips are focusable and keyboard-operable (WCAG 2.1.1)
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'clip-item' + (i === state.currentClipIdx ? ' active' : '');
    item.dataset.idx = i;

    const timePart = clip.prefix.split('_')[1] || clip.prefix;
    const timeText = timePart.replaceAll('-', ':');
    const cams = Object.keys(clip.files);
    const camsText = `${cams.length} cam${cams.length === 1 ? '' : 's'}`;
    item.setAttribute('aria-label', `Clip ${timeText}, ${camsText}`);
    if (i === state.currentClipIdx) item.setAttribute('aria-current', 'true');

    if (clip.thumb) {
      const img = document.createElement('img');
      img.className = 'clip-thumb';
      img.src = URL.createObjectURL(clip.thumb);
      img.alt = '';
      item.appendChild(img);
    } else {
      const ph = document.createElement('span');
      ph.className = 'clip-thumb-placeholder';
      ph.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 9l5 3-5 3V9z"/></svg>';
      item.appendChild(ph);
    }

    const t = document.createElement('span');
    t.className = 'clip-time';
    t.textContent = timeText;
    item.appendChild(t);

    const c = document.createElement('span');
    c.className = 'clip-cams';
    c.textContent = camsText;
    item.appendChild(c);

    item.addEventListener('click', () => loadClipAtIndex(i));
    clipList.appendChild(item);
  });
}

function updateClipListActive() {
  clipList.querySelectorAll('.clip-item').forEach((el) => {
    const active = Number.parseInt(el.dataset.idx, 10) === state.currentClipIdx;
    el.classList.toggle('active', active);
    if (active) el.setAttribute('aria-current', 'true');
    else el.removeAttribute('aria-current');
  });
}

function scrollClipIntoView(idx) {
  const items = clipList.querySelectorAll('.clip-item');
  items[idx]?.scrollIntoView({ block: 'nearest' });
}
