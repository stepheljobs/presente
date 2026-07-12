import {
  computeGrossPay,
  eachDate,
  otHoursForDay,
  payrollWeekBounds,
} from './compute';

describe('E7-S02 gross pay engine', () => {
  const settings = {
    standardWorkdayHours: 8,
    otMultiplier: 1.25,
  };

  it('pays full days × rate', () => {
    const r = computeGrossPay(
      {
        dailyRate: 800,
        days: [
          { day: '2026-07-13', status: 'present', hours: 8, otEligible: true },
          { day: '2026-07-14', status: 'present', hours: 8, otEligible: true },
        ],
      },
      settings,
    );
    expect(r.daysPresent).toBe(2);
    expect(r.basePay).toBe(1600);
    expect(r.otPay).toBe(0);
    expect(r.gross).toBe(1600);
  });

  it('counts halfdays at 0.5 × rate', () => {
    const r = computeGrossPay(
      {
        dailyRate: 800,
        days: [
          { day: '2026-07-13', status: 'halfday', hours: 4, otEligible: true },
        ],
      },
      settings,
    );
    expect(r.halfdays).toBe(1);
    expect(r.basePay).toBe(400);
    expect(r.gross).toBe(400);
  });

  it('pays OT as hourly × multiplier when eligible', () => {
    // 2h OT × (800/8) × 1.25 = 2 × 100 × 1.25 = 250
    const r = computeGrossPay(
      {
        dailyRate: 800,
        days: [
          {
            day: '2026-07-13',
            status: 'ot_candidate',
            hours: 10,
            otEligible: true,
          },
        ],
      },
      settings,
    );
    expect(r.otHours).toBe(2);
    expect(r.otPay).toBe(250);
    expect(r.basePay).toBe(800);
    expect(r.gross).toBe(1050);
  });

  it('E7-S03: ineligible OT is recorded unpaid, zero paid', () => {
    const r = computeGrossPay(
      {
        dailyRate: 800,
        days: [
          {
            day: '2026-07-13',
            status: 'ot_candidate',
            hours: 10,
            otEligible: false,
          },
        ],
      },
      settings,
    );
    expect(r.otHours).toBe(0);
    expect(r.otHoursUnpaid).toBe(2);
    expect(r.otPay).toBe(0);
    expect(r.gross).toBe(800);
  });

  it('includes adjustments in gross', () => {
    const r = computeGrossPay(
      {
        dailyRate: 800,
        days: [
          { day: '2026-07-13', status: 'present', hours: 8, otEligible: true },
        ],
        adjustments: -200,
      },
      settings,
    );
    expect(r.adjustments).toBe(-200);
    expect(r.gross).toBe(600);
  });

  it('applies manual OT delta (E7-S04)', () => {
    const ot = otHoursForDay(
      {
        day: 'd',
        status: 'present',
        hours: 8,
        otEligible: true,
        otDeltaHours: 1.5,
      },
      8,
    );
    expect(ot.paid).toBe(1.5);
  });

  it('eachDate is inclusive', () => {
    expect(eachDate('2026-07-13', '2026-07-15')).toEqual([
      '2026-07-13',
      '2026-07-14',
      '2026-07-15',
    ]);
  });

  it('payrollWeekBounds returns a 7-day previous week (Mon start)', () => {
    // Wednesday 2026-07-15 UTC → previous Mon–Sun is 2026-07-06 .. 2026-07-12
    const b = payrollWeekBounds(new Date('2026-07-15T12:00:00Z'), 1, true);
    expect(b.start).toBe('2026-07-06');
    expect(b.end).toBe('2026-07-12');
  });
});
