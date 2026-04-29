/**
 * Drill registry — lookup component + display metadata by mode.
 * Adding a new drill is a single-file change here plus the new component.
 */
import type { ComponentType } from 'react';
import type { DrillMode, DrillProps } from './types';
import { PulseDrill } from './PulseDrill';
import { StreamDrill } from './StreamDrill';
import { VoiceDrill } from './VoiceDrill';
import { LayersDrill } from './LayersDrill';
import { ArenaDrill } from './ArenaDrill';

export interface DrillMeta {
  id: DrillMode;
  name: string;
  tag: string;
  kicker: string;
  description: string;
  component: ComponentType<DrillProps>;
}

export const DRILLS: DrillMeta[] = [
  {
    id: 'pulse',
    name: 'Pulse',
    tag: '01',
    kicker: 'rhythmic timed drills',
    description: 'Front-page editorial · beat tracker · single problem at a time on a metronome.',
    component: PulseDrill,
  },
  {
    id: 'stream',
    name: 'Stream',
    tag: '02',
    kicker: 'endless ledger feed',
    description: 'Problems flow past you. Solve fast — combo for higher score. The Ledger.',
    component: StreamDrill,
  },
  {
    id: 'voice',
    name: 'Voice',
    tag: '03',
    kicker: 'hands-free with Iris',
    description: "Eyes off the screen. Iris reads, you answer aloud. Multi-step chains.",
    component: VoiceDrill,
  },
  {
    id: 'layers',
    name: 'Layers',
    tag: '04',
    kicker: 'visual decomposition',
    description: 'See the math. Break the problem into atoms — graph-paper diagrams.',
    component: LayersDrill,
  },
  {
    id: 'arena',
    name: 'Arena',
    tag: '05',
    kicker: 'head-to-head with AI',
    description: "Race the model. Best of 15. No paper. Your reflexes vs. its softmax.",
    component: ArenaDrill,
  },
];

export const DRILLS_BY_ID: Record<DrillMode, DrillMeta> = Object.fromEntries(
  DRILLS.map((d) => [d.id, d]),
) as Record<DrillMode, DrillMeta>;

export type { DrillMeta as Drill };
