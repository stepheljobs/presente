export type Band = 'high' | 'confirm' | 'unrecognized';

export interface BandThresholds {
  /** confidence >= high → auto-tag (NFR-3: precision-critical). */
  high: number;
  /** confidence >= confirm (but < high) → human confirm card. */
  confirm: number;
}

/**
 * E4-S10: classification drives all downstream state — never silent-wrong,
 * everything below `high` routes to a human (NFR-3). Boundaries inclusive:
 * a score exactly at a threshold lands in the higher band.
 */
export function bandFor(confidence: number, t: BandThresholds): Band {
  if (confidence >= t.high) return 'high';
  if (confidence >= t.confirm) return 'confirm';
  return 'unrecognized';
}
