// Web Worker: extracts SEI metadata from MP4 files off the main thread.
// The video is decoded natively by <video> elements — this worker only
// handles the protobuf telemetry embedded in each frame's SEI NAL unit.

importScripts('../vendor/protobuf.min.js', '../vendor/dashcam-mp4.js', 'sei-parser.js');

let SeiMetadata = null;

globalThis.onmessage = function(ev) {
  const msg = ev.data;
  switch (msg.type) {
    case 'INIT_PROTO': handleInitProto(msg); break;
    case 'PARSE':      handleParse(msg);     break;
    default:
      globalThis.postMessage({ type: 'ERROR', error: `Unknown message: ${msg.type}` });
  }
};

function handleInitProto(msg) {
  try {
    const root = protobuf.parse(msg.protoText, { keepCase: true }).root;
    SeiMetadata = root.lookupType('SeiMetadata');
    globalThis.postMessage({ type: 'PROTO_READY' });
  } catch (e) {
    globalThis.postMessage({ type: 'ERROR', error: 'Proto init failed: ' + e.message });
  }
}

function handleParse(msg) {
  const { camName, buffer } = msg;
  try {
    const result = extractFramesMeta(buffer, SeiMetadata);
    globalThis.postMessage({ type: 'DONE', camName, ...result });
  } catch (e) {
    globalThis.postMessage({ type: 'ERROR', camName, error: e.message });
  }
}
