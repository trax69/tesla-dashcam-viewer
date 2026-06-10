'use strict';

const ALL_CAMS = ['front', 'back', 'left_repeater', 'right_repeater', 'left_pillar', 'right_pillar'];

// Spatial order for 6-camera layout — mirrors physical position on the car:
//   Row 1: right_pillar | front | left_pillar
//   Row 2: right_repeater | back | left_repeater
const CAM_ORDER_6 = [
  'right_pillar',   'front',  'left_pillar',
  'right_repeater', 'back',   'left_repeater',
];

const CAM_LABELS = {
  front:          'FRONT',
  back:           'BACK',
  left_repeater:  'LEFT',
  right_repeater: 'RIGHT',
  left_pillar:    'L·PILLAR',
  right_pillar:   'R·PILLAR',
};

// YYYY-MM-DD_HH-MM-SS-{camera}.mp4
const CAM_RE = /^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})-(front|back|left_repeater|right_repeater|left_pillar|right_pillar)\.mp4$/i;

const REASON_MAP = {
  sentry_aware_object_detection:        'Sentry: Object Detected',
  user_interaction_dashcam_icon_tapped: 'Manual Save',
  user_interaction_honk:                'Honk',
  emergency_braking:                    'Emergency Braking',
  collision:                            'Collision',
};
