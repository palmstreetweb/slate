/**
 * Drop-animation presets for the /lab/drop playground (examples/ only).
 */

export type DropPresetId =
  | 'current'
  | 'overshoot'
  | 'squash'
  | 'snappy'
  | 'shadow-slam'
  | 'ripple'
  | 'slot-flash'
  | 'no-fade'
  | 'line-absorb'
  | 'audio-distance'
  | 'magnetic';

export type DropPreset = {
  id: DropPresetId;
  label: string;
  description: string;
  settleMs: number;
  cancelMs: number;
  settleEase: string;
  settleCommitRatio: number;
  /** Ghost fades out at end of settle (production behavior). */
  fadeOnSettle: boolean;
  landedClass: string;
  shadowSlam: boolean;
  rippleNeighbors: boolean;
  slotFlash: boolean;
  lineAbsorb: boolean;
  audioByDistance: boolean;
  magneticSnap: boolean;
  squashStretch: boolean;
  overshootLand: boolean;
};

export const DROP_PRESETS: ReadonlyArray<DropPreset> = [
  {
    id: 'current',
    label: 'Current',
    description: 'Production settle — 380ms ease, ghost fades at 82%.',
    settleMs: 380,
    cancelMs: 300,
    settleEase: 'cubic-bezier(0.22, 1, 0.16, 1)',
    settleCommitRatio: 0.82,
    fadeOnSettle: true,
    landedClass: 'slate-drop-landed--current',
    shadowSlam: false,
    rippleNeighbors: false,
    slotFlash: false,
    lineAbsorb: false,
    audioByDistance: false,
    magneticSnap: false,
    squashStretch: false,
    overshootLand: false,
  },
  {
    id: 'overshoot',
    label: 'Overshoot bounce',
    description: 'Spring past 1.0 then settle — bouncy landing pulse.',
    settleMs: 420,
    cancelMs: 300,
    settleEase: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
    settleCommitRatio: 1,
    fadeOnSettle: false,
    landedClass: 'slate-drop-landed--overshoot',
    shadowSlam: false,
    rippleNeighbors: false,
    slotFlash: false,
    lineAbsorb: false,
    audioByDistance: false,
    magneticSnap: false,
    squashStretch: false,
    overshootLand: true,
  },
  {
    id: 'squash',
    label: 'Squash & stretch',
    description: 'Card squashes on impact then springs back to shape.',
    settleMs: 360,
    cancelMs: 280,
    settleEase: 'cubic-bezier(0.22, 1, 0.16, 1)',
    settleCommitRatio: 1,
    fadeOnSettle: false,
    landedClass: 'slate-drop-landed--squash',
    shadowSlam: false,
    rippleNeighbors: false,
    slotFlash: false,
    lineAbsorb: false,
    audioByDistance: false,
    magneticSnap: false,
    squashStretch: true,
    overshootLand: false,
  },
  {
    id: 'snappy',
    label: 'Snappy settle',
    description: '250ms with a sharp deceleration — quick and crisp.',
    settleMs: 250,
    cancelMs: 200,
    settleEase: 'cubic-bezier(0.2, 0.9, 0.1, 1)',
    settleCommitRatio: 0.9,
    fadeOnSettle: true,
    landedClass: 'slate-drop-landed--snappy',
    shadowSlam: false,
    rippleNeighbors: false,
    slotFlash: false,
    lineAbsorb: false,
    audioByDistance: false,
    magneticSnap: false,
    squashStretch: false,
    overshootLand: false,
  },
  {
    id: 'shadow-slam',
    label: 'Shadow slam',
    description: 'Lifted shadow collapses as the card sets down.',
    settleMs: 340,
    cancelMs: 280,
    settleEase: 'cubic-bezier(0.22, 1, 0.16, 1)',
    settleCommitRatio: 1,
    fadeOnSettle: false,
    landedClass: 'slate-drop-landed--current',
    shadowSlam: true,
    rippleNeighbors: false,
    slotFlash: false,
    lineAbsorb: false,
    audioByDistance: false,
    magneticSnap: false,
    squashStretch: false,
    overshootLand: false,
  },
  {
    id: 'ripple',
    label: 'Neighbor ripple',
    description: 'Adjacent rows nudge outward when the card lands.',
    settleMs: 380,
    cancelMs: 300,
    settleEase: 'cubic-bezier(0.22, 1, 0.16, 1)',
    settleCommitRatio: 1,
    fadeOnSettle: false,
    landedClass: 'slate-drop-landed--current',
    shadowSlam: false,
    rippleNeighbors: true,
    slotFlash: false,
    lineAbsorb: false,
    audioByDistance: false,
    magneticSnap: false,
    squashStretch: false,
    overshootLand: false,
  },
  {
    id: 'slot-flash',
    label: 'Slot flash',
    description: 'Destination row briefly highlights with accent tint.',
    settleMs: 360,
    cancelMs: 280,
    settleEase: 'cubic-bezier(0.22, 1, 0.16, 1)',
    settleCommitRatio: 1,
    fadeOnSettle: false,
    landedClass: 'slate-drop-landed--current',
    shadowSlam: false,
    rippleNeighbors: false,
    slotFlash: true,
    lineAbsorb: false,
    audioByDistance: false,
    magneticSnap: false,
    squashStretch: false,
    overshootLand: false,
  },
  {
    id: 'no-fade',
    label: 'No end fade',
    description: 'Ghost stays opaque until handoff — cleaner swap.',
    settleMs: 320,
    cancelMs: 260,
    settleEase: 'cubic-bezier(0.22, 1, 0.16, 1)',
    settleCommitRatio: 1,
    fadeOnSettle: false,
    landedClass: 'slate-drop-landed--current',
    shadowSlam: false,
    rippleNeighbors: false,
    slotFlash: false,
    lineAbsorb: false,
    audioByDistance: false,
    magneticSnap: false,
    squashStretch: false,
    overshootLand: false,
  },
  {
    id: 'line-absorb',
    label: 'Line absorb',
    description: 'Drop line collapses into the slot as the card lands.',
    settleMs: 360,
    cancelMs: 280,
    settleEase: 'cubic-bezier(0.22, 1, 0.16, 1)',
    settleCommitRatio: 1,
    fadeOnSettle: false,
    landedClass: 'slate-drop-landed--current',
    shadowSlam: false,
    rippleNeighbors: false,
    slotFlash: false,
    lineAbsorb: true,
    audioByDistance: false,
    magneticSnap: false,
    squashStretch: false,
    overshootLand: false,
  },
  {
    id: 'audio-distance',
    label: 'Audio by distance',
    description: 'Drop sound gets louder/deeper the farther you moved.',
    settleMs: 380,
    cancelMs: 300,
    settleEase: 'cubic-bezier(0.22, 1, 0.16, 1)',
    settleCommitRatio: 0.82,
    fadeOnSettle: true,
    landedClass: 'slate-drop-landed--current',
    shadowSlam: false,
    rippleNeighbors: false,
    slotFlash: false,
    lineAbsorb: false,
    audioByDistance: true,
    magneticSnap: false,
    squashStretch: false,
    overshootLand: false,
  },
  {
    id: 'magnetic',
    label: 'Magnetic snap',
    description: 'Glides most of the way, then snaps into the slot.',
    settleMs: 400,
    cancelMs: 280,
    settleEase: 'linear',
    settleCommitRatio: 1,
    fadeOnSettle: false,
    landedClass: 'slate-drop-landed--magnetic',
    shadowSlam: false,
    rippleNeighbors: false,
    slotFlash: false,
    lineAbsorb: false,
    audioByDistance: false,
    magneticSnap: true,
    squashStretch: false,
    overshootLand: false,
  },
];

export function getDropPreset(id: DropPresetId): DropPreset {
  return DROP_PRESETS.find((p) => p.id === id) ?? DROP_PRESETS[0]!;
}
