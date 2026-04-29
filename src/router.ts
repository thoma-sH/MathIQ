import type { Domain } from './math/types';
import type { DrillMode } from './drills/types';

/**
 * Discriminated route union. Drill routes carry mode + domain so deep
 * links (and the gallery) can land directly on a configured drill.
 */
export type Route =
  | { name: 'onboard' }
  | { name: 'home' }
  | { name: 'drills' }
  | { name: 'gallery' }
  | { name: 'tutor' }
  | { name: 'library' }
  | { name: 'profile' }
  | { name: 'settings' }
  | { name: 'results' }
  | { name: 'drill'; mode: DrillMode; domain: Domain };

export type RouteName = Route['name'];
