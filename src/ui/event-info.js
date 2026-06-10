'use strict';

function updateEventInfo(clip) {
  if (!clip.eventJson) { eventInfo.classList.add('hidden'); return; }
  clip.eventJson.text().then((text) => {
    try {
      const data = JSON.parse(text);
      infoCityEl.textContent   = data.city || '';
      infoReasonEl.textContent = REASON_MAP[data.reason] || data.reason || '';
      infoTsEl.textContent     = data.timestamp?.replace('T', ' ') ?? '';
      eventInfo.classList.remove('hidden');
    } catch {
      eventInfo.classList.add('hidden');
    }
  });
}
