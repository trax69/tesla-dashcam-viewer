'use strict';

function readAllEntries(reader) {
  return new Promise((resolve) => {
    const all = [];
    const readBatch = () => reader.readEntries((batch) => {
      if (!batch.length) { resolve(all); return; }
      all.push(...batch);
      readBatch();
    });
    readBatch();
  });
}

async function traverseEntry(entry, files) {
  if (entry.isFile) {
    await new Promise((resolve) => {
      entry.file((f) => { f._relativePath = entry.fullPath; files.push(f); resolve(); });
    });
  } else if (entry.isDirectory) {
    const entries = await readAllEntries(entry.createReader());
    await Promise.all(entries.map((e) => traverseEntry(e, files)));
  }
}

async function collectFilesFromDataTransfer(items) {
  const files = [];
  await Promise.all(Array.from(items).map((item) => {
    const entry = item.webkitGetAsEntry?.();
    return entry ? traverseEntry(entry, files) : Promise.resolve();
  }));
  return files;
}

function parseFileList(fileList) {
  const clipMap    = new Map();
  const eventJsons = new Map();
  const thumbs     = new Map();

  for (const file of fileList) {
    const name   = file.name;
    const path   = file.webkitRelativePath || file._relativePath || name;
    const parts  = path.replaceAll('\\', '/').split('/');
    const folder = parts.length > 1 ? parts[parts.length - 2] : '';

    if (name === 'event.json') { eventJsons.set(folder, file); continue; }
    if (name === 'thumb.png' || name === 'thumb.jpg') { thumbs.set(folder, file); continue; }

    const match = name.match(CAM_RE);
    if (!match) continue;

    const [, prefix, camera] = match;
    const key = `${folder}/${prefix}`;
    if (!clipMap.has(key)) clipMap.set(key, { prefix, folder, files: {}, eventJson: null, thumb: null });
    clipMap.get(key).files[camera] = file;
  }

  const clips = [...clipMap.values()].sort((a, b) => a.prefix.localeCompare(b.prefix));
  for (const clip of clips) {
    clip.eventJson = eventJsons.get(clip.folder) ?? null;
    clip.thumb     = thumbs.get(clip.folder)     ?? null;
  }
  return clips;
}
