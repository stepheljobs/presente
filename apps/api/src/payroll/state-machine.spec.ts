import { canTransition, isImmutable, isMutable } from './state-machine';

describe('E7-S01 payroll state machine', () => {
  it('allows Draft → Reviewed → Approved → Exported', () => {
    expect(canTransition('draft', 'reviewed')).toBe(true);
    expect(canTransition('reviewed', 'approved')).toBe(true);
    expect(canTransition('approved', 'exported')).toBe(true);
  });

  it('rejects illegal transitions', () => {
    expect(canTransition('draft', 'approved')).toBe(false);
    expect(canTransition('exported', 'draft')).toBe(false);
    expect(canTransition('approved', 'reviewed')).toBe(false);
  });

  it('marks approved/exported immutable', () => {
    expect(isImmutable('approved')).toBe(true);
    expect(isImmutable('exported')).toBe(true);
    expect(isMutable('draft')).toBe(true);
  });
});
