'use strict';

const $ = (id) => document.getElementById(id);

const dropZone       = $('drop-zone');
const folderInput    = $('folder-input');
const appEl          = $('app');
const clipList       = $('clip-list');
const loadingOverlay = $('loading-overlay');
const loadingText    = $('loading-text');
const btnPlay        = $('btn-play');
const iconPlay       = $('icon-play');
const iconPause      = $('icon-pause');
const btnPrev        = $('btn-prev-clip');
const btnNext        = $('btn-next-clip');
const scrubber       = $('scrubber');
const timeDisplay    = $('time-display');
const speedSelect    = $('speed-select');
const btnUnit        = $('btn-unit');
const eventInfo      = $('event-info');
const infoCityEl     = $('info-city');
const infoReasonEl   = $('info-reason');
const infoTsEl       = $('info-timestamp');
const quadView       = $('quad-view');
const singleView     = $('single-view');
const singleCanvas   = $('single-canvas');
