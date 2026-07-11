/** E7-S01: legal payroll run transitions. */
export type RunStatus = 'draft' | 'reviewed' | 'approved' | 'exported';

const TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  draft: ['reviewed'],
  reviewed: ['approved', 'draft'], // edits drop back to draft from UI via explicit reopen
  approved: ['exported'],
  exported: [],
};

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** Mutations allowed only in draft (or reviewed→draft for re-edit). */
export function isMutable(status: RunStatus): boolean {
  return status === 'draft' || status === 'reviewed';
}

export function isImmutable(status: RunStatus): boolean {
  return status === 'approved' || status === 'exported';
}
