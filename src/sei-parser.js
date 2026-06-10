'use strict';

// SEI extraction shared by the Web Worker (worker-sei.js) and the main-thread
// fallback in player.js (used when workers are unavailable, e.g. on file://).
// Expects DashcamMP4 (vendor/dashcam-mp4.js) to be loaded in the current scope.

// Parse an MP4 buffer into per-frame metadata with cumulative timestamps (ms).
function extractFramesMeta(buffer, SeiMetadata) {
  const mp4 = new DashcamMP4(buffer);
  const config = mp4.getConfig();
  const frames = mp4.parseFrames(SeiMetadata);

  let timeMs = 0;
  const framesMeta = frames.map((f, i) => {
    const ms = timeMs;
    timeMs += config.durations[i] ?? 33.333;
    return {
      index: f.index,
      keyframe: f.keyframe,
      timeMs: ms,
      sei: f.sei ? seiToPlain(f.sei) : null,
    };
  });

  return {
    framesMeta,
    config: {
      width: config.width,
      height: config.height,
      codec: config.codec,
      totalDurationMs: timeMs,
      frameCount: frames.length,
    },
  };
}

function seiToPlain(sei) {
  return {
    frame_seq_no:               sei.frame_seq_no === undefined ? null : Number(sei.frame_seq_no),
    vehicle_speed_mps:          sei.vehicle_speed_mps ?? null,
    accelerator_pedal_position: +(sei.accelerator_pedal_position ?? 0),
    steering_wheel_angle:       sei.steering_wheel_angle ?? null,
    brake_applied:              sei.brake_applied ?? false,
    blinker_on_left:            sei.blinker_on_left ?? false,
    blinker_on_right:           sei.blinker_on_right ?? false,
    gear_state:                 sei.gear_state ?? 0,
    autopilot_state:            sei.autopilot_state ?? 0,
    latitude_deg:               sei.latitude_deg ?? null,
    longitude_deg:              sei.longitude_deg ?? null,
    heading_deg:                sei.heading_deg ?? null,
  };
}
