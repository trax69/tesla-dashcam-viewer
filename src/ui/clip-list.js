'use strict';

function renderClipList() {
  clipList.innerHTML = '';
  state.clips.forEach((clip, i) => {
    const item = document.createElement('div');
    item.className = 'clip-item' + (i === state.currentClipIdx ? ' active' : '');
    item.dataset.idx = i;

    if (clip.thumb) {
      const img = document.createElement('img');
      img.className = 'clip-thumb';
      img.src = URL.createObjectURL(clip.thumb);
      img.alt = clip.prefix;
      item.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'clip-thumb-placeholder';
      ph.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M10 9l5 3-5 3V9z"/></svg>';
      item.appendChild(ph);
    }

    const timePart = clip.prefix.split('_')[1] || clip.prefix;
    const t = document.createElement('div');
    t.className = 'clip-time';
    t.textContent = timePart.replaceAll('-', ':');
    item.appendChild(t);

    const cams = Object.keys(clip.files);
    const c = document.createElement('div');
    c.className = 'clip-cams';
    c.textContent = `${cams.length} cam${cams.length === 1 ? '' : 's'}`;
    item.appendChild(c);

    item.addEventListener('click', () => loadClipAtIndex(i));
    clipList.appendChild(item);
  });
}

function updateClipListActive() {
  clipList.querySelectorAll('.clip-item').forEach((el) => {
    el.classList.toggle('active', Number.parseInt(el.dataset.idx, 10) === state.currentClipIdx);
  });
}

function scrollClipIntoView(idx) {
  const items = clipList.querySelectorAll('.clip-item');
  items[idx]?.scrollIntoView({ block: 'nearest' });
}
