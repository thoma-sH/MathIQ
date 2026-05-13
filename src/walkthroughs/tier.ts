import type { Tier } from '../billing/client';

export function isPro(tier: Tier | null | undefined): boolean {
  return tier === 'pro';
}

export function isPaid(tier: Tier | null | undefined): boolean {
  return tier === 'plus' || tier === 'pro';
}
