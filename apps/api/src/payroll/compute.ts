/**
 * E7-S02: pure gross-pay engine — no DB, no Nest. Table-driven tests own this file.
 *
 * Formula (FR-26):
 *   days_present × rate
 * + halfdays × 0.5 × rate
 * + OT_hrs × (rate / standard_hours) × ot_multiplier
 * + adjustments
 */

export interface DayInput {
  day: string;
  status: 'present' | 'halfday' | 'absent' | 'ot_candidate';
  hours: number;
  otEligible: boolean;
  otDeltaHours?: number;
}

export interface ComputeSettings {
  standardWorkdayHours: number;
  otMultiplier: number;
  moneyDecimals?: number;
}

export interface WorkerComputeInput {
  dailyRate: number;
  days: DayInput[];
  adjustments?: number;
}

export interface DayBreakdown {
  day: string;
  status: DayInput['status'];
  presentCredit: number;
  otHoursPaid: number;
  otHoursUnpaid: number;
}

export interface ComputeResult {
  daysPresent: number;
  halfdays: number;
  otHours: number;
  otHoursUnpaid: number;
  basePay: number;
  otPay: number;
  adjustments: number;
  gross: number;
  days: DayBreakdown[];
}

function roundMoney(n: number, decimals = 2): number {
  const f = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * f) / f;
}

/** OT = max(0, hours - standard) + manual delta; paid only if otEligible (E7-S03). */
export function otHoursForDay(
  day: DayInput,
  standardHours: number,
): { paid: number; unpaid: number } {
  const rawOver =
    Math.max(0, day.hours - standardHours) + (day.otDeltaHours ?? 0);
  const clamped = Math.max(0, rawOver);
  if (day.otEligible) return { paid: clamped, unpaid: 0 };
  return { paid: 0, unpaid: clamped };
}

export function computeGrossPay(
  input: WorkerComputeInput,
  settings: ComputeSettings,
): ComputeResult {
  const dec = settings.moneyDecimals ?? 2;
  const rate = input.dailyRate;
  const std = settings.standardWorkdayHours;
  const mult = settings.otMultiplier;

  let daysPresent = 0;
  let halfdays = 0;
  let otHours = 0;
  let otHoursUnpaid = 0;
  const days: DayBreakdown[] = [];

  for (const d of input.days) {
    let presentCredit = 0;
    if (d.status === 'present' || d.status === 'ot_candidate') {
      presentCredit = 1;
      daysPresent += 1;
    } else if (d.status === 'halfday') {
      presentCredit = 0.5;
      halfdays += 1;
    }

    const ot = otHoursForDay(d, std);
    otHours += ot.paid;
    otHoursUnpaid += ot.unpaid;

    days.push({
      day: d.day,
      status: d.status,
      presentCredit,
      otHoursPaid: roundMoney(ot.paid, 2),
      otHoursUnpaid: roundMoney(ot.unpaid, 2),
    });
  }

  const hourly = std > 0 ? rate / std : 0;
  const basePay = roundMoney(daysPresent * rate + halfdays * 0.5 * rate, dec);
  const otPay = roundMoney(otHours * hourly * mult, dec);
  const adjustments = roundMoney(input.adjustments ?? 0, dec);
  const gross = roundMoney(basePay + otPay + adjustments, dec);

  return {
    daysPresent,
    halfdays,
    otHours: roundMoney(otHours, 2),
    otHoursUnpaid: roundMoney(otHoursUnpaid, 2),
    basePay,
    otPay,
    adjustments,
    gross,
    days,
  };
}

export function eachDate(start: string, end: string): string[] {
  const out: string[] = [];
  const cur = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  while (cur <= last) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/**
 * Last completed payroll week relative to `ref`.
 * payrollWeekStartDay: 0=Sun … 6=Sat (JS getUTCDay).
 */
export function payrollWeekBounds(
  ref: Date,
  payrollWeekStartDay: number,
  preferPrevious = true,
): { start: string; end: string } {
  const d = new Date(
    Date.UTC(ref.getUTCFullYear(), ref.getUTCMonth(), ref.getUTCDate()),
  );
  const dow = d.getUTCDay();
  const daysSinceStart = (dow - payrollWeekStartDay + 7) % 7;
  const startOfThisWeek = new Date(d);
  startOfThisWeek.setUTCDate(d.getUTCDate() - daysSinceStart);

  const weekStart = new Date(startOfThisWeek);
  if (preferPrevious) {
    weekStart.setUTCDate(startOfThisWeek.getUTCDate() - 7);
  }
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);
  return {
    start: weekStart.toISOString().slice(0, 10),
    end: weekEnd.toISOString().slice(0, 10),
  };
}
