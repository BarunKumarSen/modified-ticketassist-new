import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeEmployeeLeaveBucket,
  countChargeableLeaveDays,
  getMonthlyLeaveAccrualForMonth,
} from './leaveAccrual';
import type { LeaveRecord, PublicHoliday } from '../types/attendance';

test('getMonthlyLeaveAccrualForMonth enforces +2 Jan-Nov, 0 Dec, 15th cutoff, and Active status', () => {
  // Active employee joined Jan 1 -> 2 leaves Jan-Nov, 0 Dec
  for (let m = 1; m <= 11; m++) {
    assert.equal(
      getMonthlyLeaveAccrualForMonth({ year: 2026, month: m, joiningDate: '2026-01-01', status: 'Active' }),
      2
    );
  }
  assert.equal(
    getMonthlyLeaveAccrualForMonth({ year: 2026, month: 12, joiningDate: '2026-01-01', status: 'Active' }),
    0
  );

  // April 15th joining cutoff receives 2 for April
  assert.equal(
    getMonthlyLeaveAccrualForMonth({ year: 2026, month: 4, joiningDate: '2026-04-15', status: 'Active' }),
    2
  );

  // April 17th joining cutoff receives 0 for April, 2 from May onwards
  assert.equal(
    getMonthlyLeaveAccrualForMonth({ year: 2026, month: 4, joiningDate: '2026-04-17', status: 'Active' }),
    0
  );
  assert.equal(
    getMonthlyLeaveAccrualForMonth({ year: 2026, month: 5, joiningDate: '2026-04-17', status: 'Active' }),
    2
  );

  // Inactive employee accrues 0
  assert.equal(
    getMonthlyLeaveAccrualForMonth({ year: 2026, month: 5, joiningDate: '2025-01-01', status: 'Inactive' }),
    0
  );
});

test('computeEmployeeLeaveBucket matches April 17 joining example (14 leaves) and 44-leave carry-forward deduction scenario', () => {
  // Example 1: Joining April 17, 2026 -> Apr=0, May-Nov=14, Dec=0 -> Total = 14
  const apr17Bucket = computeEmployeeLeaveBucket({
    employee: {
      id: 'EMP-54321',
      employeeId: 'EMP-54321',
      name: 'Aarav Sen',
      joiningDate: '2026-04-17',
      status: 'Active',
      center: 'Mumbai',
      branch: 'Mumbai',
      leaveCarryForward: 0,
    },
    year: 2026,
    leaves: [],
  });
  assert.equal(apr17Bucket.annualAccrued, 14);
  assert.equal(apr17Bucket.availableBalance, 14);
  assert.equal(apr17Bucket.monthlyBreakdown[3].accrued, 0); // April
  assert.equal(apr17Bucket.monthlyBreakdown[4].accrued, 2); // May
  assert.equal(apr17Bucket.monthlyBreakdown[11].accrued, 0); // December

  // Example 2: Carried forward 44 leaves in Jan, applies for 14-day approved leave before Jan 15 -> 30, then +2/mo resumes
  const jan14Leave: LeaveRecord = {
    id: 'lv-1',
    employeeId: 'EMP-54321',
    leaveType: 'Annual',
    startDate: '2026-01-01',
    endDate: '2026-01-14',
    days: 14,
    reason: 'Annual vacation',
    status: 'Approved',
    createdAt: '2026-01-01T00:00:00Z',
  };

  const carryForwardBucket = computeEmployeeLeaveBucket({
    employee: {
      id: 'EMP-54321',
      employeeId: 'EMP-54321',
      name: 'Aarav Sen',
      joiningDate: '2023-01-01',
      status: 'Active',
      center: 'Mumbai',
      branch: 'Mumbai',
      leaveCarryForward: 44,
    },
    year: 2026,
    leaves: [jan14Leave],
  });

  // Jan started at 44, capped at 44, deducted 14 => 30 at end of Jan
  assert.equal(carryForwardBucket.monthlyBreakdown[0].endingBalance, 30);
  // Feb adds +2 => 32
  assert.equal(carryForwardBucket.monthlyBreakdown[1].endingBalance, 32);
  // Aug adds +2 up to cap 44 (30 + 7*2 = 44)
  assert.equal(carryForwardBucket.monthlyBreakdown[7].endingBalance, 44);
  // Subsequent months remain capped at 44
  assert.equal(carryForwardBucket.projectedYearEndBalance, 44);
});

test('countChargeableLeaveDays excludes National Holidays and Center-wise Holidays', () => {
  const holidays: PublicHoliday[] = [
    {
      id: 'h-nat',
      title: 'Republic Day',
      holidayDate: '2026-01-26',
      center: 'All Centers',
      description: '',
      isNational: true,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'h-mum',
      title: 'Mumbai Holiday',
      holidayDate: '2026-01-27',
      center: 'Mumbai',
      description: '',
      isNational: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'h-blr',
      title: 'Bengaluru Holiday',
      holidayDate: '2026-01-28',
      center: 'Bengaluru',
      description: '',
      isNational: false,
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ];

  // For Mumbai employee spanning Jan 25..Jan 29 (5 calendar days), Jan 26 (National) + Jan 27 (Mumbai) excluded -> 3 chargeable days
  const days = countChargeableLeaveDays({
    startDate: '2026-01-25',
    endDate: '2026-01-29',
    holidays,
    employeeCenter: 'Mumbai',
  });
  assert.equal(days, 3);
});
