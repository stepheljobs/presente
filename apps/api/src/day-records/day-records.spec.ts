import { classifyStatus, computeHours } from './day-records.service';

describe('E6-S01 day-record pure helpers', () => {
  const settings = {
    standard_workday_hours: '8',
    halfday_rule: 'hours_threshold' as const,
    halfday_threshold_hours: '4',
    halfday_cutoff_time: '12:00:00',
    timezone: 'Asia/Manila',
  };

  it('computes hours between in and out', () => {
    const inn = new Date('2026-07-14T00:00:00.000Z');
    const out = new Date('2026-07-14T08:00:00.000Z');
    expect(computeHours(inn, out)).toBe(8);
  });

  it('classifies present / halfday / ot / absent', () => {
    const inn = new Date('2026-07-14T00:00:00.000Z');
    expect(classifyStatus(8, inn, new Date('2026-07-14T08:00:00Z'), settings)).toBe(
      'present',
    );
    expect(classifyStatus(3, inn, new Date('2026-07-14T03:00:00Z'), settings)).toBe(
      'halfday',
    );
    expect(
      classifyStatus(10, inn, new Date('2026-07-14T10:00:00Z'), settings),
    ).toBe('ot_candidate');
    expect(classifyStatus(0, null, null, settings)).toBe('absent');
    expect(classifyStatus(0, inn, null, settings)).toBe('halfday');
  });
});
