'use strict';

const { hoursBetween, dayKey, splitHours } = require('./shifts');

const PF_RATE = 0.12; // provident fund on regular earnings
const ESI_RATE = 0.0075; // employee state insurance
const ESI_GROSS_CEILING = 21000;

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Build a transparent payslip for one worker and one month (YYYY-MM).
 * Every rupee is traceable: per-day rows plus labelled line items. Labels are
 * returned as translation keys so the client can render them in any language.
 *
 * Figures are illustrative; real statutory rules vary by state and employer.
 */
function buildPayslip(worker, shifts, month) {
  const days = shifts
    .filter((s) => s.workerId === worker.id && s.checkOut && dayKey(s.checkIn).startsWith(month))
    .map((s) => {
      const total = hoursBetween(s.checkIn, s.checkOut);
      const { regular, overtime } = splitHours(total, worker.sector);
      return { date: dayKey(s.checkIn), total, regular, overtime };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const regularHours = round2(days.reduce((n, d) => n + d.regular, 0));
  const overtimeHours = round2(days.reduce((n, d) => n + d.overtime, 0));
  const otMultiplier = worker.otMultiplier;

  const regularPay = round2(regularHours * worker.hourlyRate);
  const overtimePay = round2(overtimeHours * worker.hourlyRate * otMultiplier);
  const gross = round2(regularPay + overtimePay);

  const pf = round2(regularPay * PF_RATE);
  const esi = gross <= ESI_GROSS_CEILING ? round2(gross * ESI_RATE) : 0;
  const deductions = round2(pf + esi);

  return {
    month,
    worker: { id: worker.id, name: worker.name },
    hourlyRate: worker.hourlyRate,
    otMultiplier,
    days,
    hours: { regular: regularHours, overtime: overtimeHours, total: round2(regularHours + overtimeHours) },
    earnings: [
      { key: 'regularPay', hours: regularHours, rate: worker.hourlyRate, amount: regularPay },
      { key: 'overtimePay', hours: overtimeHours, rate: round2(worker.hourlyRate * otMultiplier), amount: overtimePay },
    ],
    deductionItems: [
      { key: 'pf', amount: pf },
      { key: 'esi', amount: esi },
    ],
    gross,
    deductions,
    net: round2(gross - deductions),
  };
}

module.exports = { buildPayslip, PF_RATE, ESI_RATE, ESI_GROSS_CEILING };
