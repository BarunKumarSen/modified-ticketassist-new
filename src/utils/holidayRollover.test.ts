import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRolledNationalHolidays,
  canRaiseTicketOnDate,
  isSundayDate,
} from './holidayRollover';

test('buildRolledNationalHolidays rolls dates forward year-to-year and honors Admin edits & deletes', () => {
  const rolled = buildRolledNationalHolidays({
    startYear: 2025,
    endYear: 2027,
    overrides: [
      {
        id: 'ov-edit',
        originKey: 'IN_AMBEDKAR_JAYANTI',
        year: 2026,
        action: 'edited',
        title: 'Ambedkar Jayanti Observed',
        holidayDate: '2026-04-15',
      },
      {
        id: 'ov-del',
        originKey: 'IN_MAY_DAY',
        year: 2026,
        action: 'deleted',
      },
    ],
  });

  // Edited 2026-04-15 carries forward to 2027-04-15
  const ambedkar2026 = rolled.find((h) => h.holidayDate === '2026-04-15');
  const ambedkar2027 = rolled.find((h) => h.holidayDate === '2027-04-15');
  assert.ok(ambedkar2026);
  assert.equal(ambedkar2026?.title, 'Ambedkar Jayanti Observed');
  assert.ok(ambedkar2027);
  assert.equal(ambedkar2027?.title, 'Ambedkar Jayanti Observed');

  // Deleted IN_MAY_DAY in 2026 is gone in 2026 AND does not resurrect in 2027
  assert.equal(rolled.some((h) => h.holidayDate === '2026-05-01'), false);
  assert.equal(rolled.some((h) => h.holidayDate === '2027-05-01'), false);
  // 2025 still had it before deletion
  assert.equal(rolled.some((h) => h.holidayDate === '2025-05-01'), true);
});

test('canRaiseTicketOnDate enforces Sunday and National Holiday rules', () => {
  const holidays = buildRolledNationalHolidays({ startYear: 2026, endYear: 2026 });

  // 2026-11-15 is a Sunday
  assert.equal(isSundayDate('2026-11-15'), true);
  assert.equal(canRaiseTicketOnDate({ role: 'Employee', dateStr: '2026-11-15', holidays }).allowed, false);
  assert.equal(canRaiseTicketOnDate({ role: 'Manager', dateStr: '2026-11-15', holidays }).allowed, true);

  // 2026-08-15 is Saturday + Independence Day -> blocked for everyone
  assert.equal(canRaiseTicketOnDate({ role: 'Employee', dateStr: '2026-08-15', holidays }).allowed, false);
  assert.equal(canRaiseTicketOnDate({ role: 'Manager', dateStr: '2026-08-15', holidays }).allowed, false);

  // 2026-11-14 is Saturday (working day) -> allowed for Employee
  assert.equal(canRaiseTicketOnDate({ role: 'Employee', dateStr: '2026-11-14', holidays }).allowed, true);
});
