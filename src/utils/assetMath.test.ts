import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateByField,
  aggregateValueByCategory,
  calculateBookValue,
  calculateWarrantyExpiry,
  computeDashboardKPIs,
  filterAssets,
  generateNextId,
  normalizeEmployeeId,
  paginateItems,
  toCSV,
  validateEmployeeId,
} from './assetMath';
import { seedData } from '../data/seedData';

test('calculateWarrantyExpiry adds months accurately', () => {
  assert.equal(calculateWarrantyExpiry('2024-01-15', 24), '2026-01-15');
  assert.equal(calculateWarrantyExpiry('2024-11-30', 36), '2027-11-30');
  assert.equal(calculateWarrantyExpiry('', 12), '');
});

test('calculateBookValue computes SLM and WDV depreciation with salvage floor', () => {
  const asOf = new Date('2026-01-01T00:00:00Z');
  const slm = calculateBookValue({
    cost: 10000,
    purchaseDate: '2024-01-01',
    usefulLife: 5,
    salvageValue: 0,
    method: 'SLM',
    asOfDate: asOf,
  });
  assert.ok(slm > 5900 && slm < 6100, `Expected ~6000, got ${slm}`);

  const slmFloored = calculateBookValue({
    cost: 10000,
    purchaseDate: '2015-01-01',
    usefulLife: 5,
    salvageValue: 1500,
    method: 'SLM',
    asOfDate: asOf,
  });
  assert.equal(slmFloored, 1500);

  const wdv = calculateBookValue({
    cost: 10000,
    purchaseDate: '2024-01-01',
    usefulLife: 5,
    salvageValue: 500,
    method: 'WDV',
    asOfDate: asOf,
  });
  assert.ok(wdv > 6300 && wdv < 6500, `Expected ~6400, got ${wdv}`);
});

test('generateNextId increments highest numeric suffix', () => {
  assert.equal(generateNextId('AST', ['AST0199', 'AST0200']), 'AST0201');
  assert.equal(generateNextId('DSP', [], 4), 'DSP0001');
  assert.equal(generateNextId('EMP', ['EMP009', 'EMP020'], 3), 'EMP021');
});

test('computeDashboardKPIs aggregates counts and totals accurately', () => {
  const kpis = computeDashboardKPIs(seedData.assets);
  assert.equal(kpis.totalAssets, 20);
  assert.equal(
    kpis.availableAssets + kpis.assignedAssets + kpis.maintenanceAssets + kpis.disposedAssets,
    20
  );
  assert.ok(kpis.totalPurchaseCost > 0);
  assert.ok(kpis.totalBookValue > 0);
});

test('filterAssets and paginateItems handle search, status, and page bounds', () => {
  const assigned = filterAssets(seedData.assets, '', 'Assigned');
  assert.ok(assigned.every((a) => a.status === 'Assigned'));

  const searchMac = filterAssets(seedData.assets, 'MacBook', 'ALL');
  assert.equal(searchMac.length, 2);

  const page2 = paginateItems(seedData.assets, 2, 10);
  assert.equal(page2.items.length, 10);
  assert.equal(page2.totalPages, 2);
  assert.equal(page2.startIndex, 11);
  assert.equal(page2.endIndex, 20);
});

test('aggregateByField and aggregateValueByCategory sum correctly', () => {
  const byCat = aggregateByField(seedData.assets, 'category');
  const totalCount = Object.values(byCat).reduce((a, b) => a + b, 0);
  assert.equal(totalCount, seedData.assets.length);

  const valByCat = aggregateValueByCategory(seedData.assets);
  assert.ok(valByCat.Vehicle >= 2150000);
});

test('toCSV escapes commas and quotes properly', () => {
  const csv = toCSV(
    ['ID', 'Name', 'Cost'],
    [['AST001', 'Monitor, 27"', 450]]
  );
  assert.equal(csv, 'ID,Name,Cost\nAST001,"Monitor, 27""",450');
});

import {
  extractFiveDigitEmployeeCode,
  formatFiveDigitEmployeeId,
  validateFiveDigitEmployeeId,
} from './assetMath';

test('normalizeEmployeeId trims and uppercases employee IDs', () => {
  assert.equal(normalizeEmployeeId('  emp-54321  '), 'EMP-54321');
  assert.equal(normalizeEmployeeId('a_b-9'), 'A_B-9');
});

test('5-digit Employee ID helpers extract, format as EMP-XXXXX, and validate strictly', () => {
  assert.equal(extractFiveDigitEmployeeCode('54321'), '54321');
  assert.equal(extractFiveDigitEmployeeCode('EMP-54321'), '54321');
  assert.equal(extractFiveDigitEmployeeCode('1234'), null);
  assert.equal(formatFiveDigitEmployeeId('54321'), 'EMP-54321');

  const existing = [
    { id: 'EMP-10001', employeeId: 'EMP-10001' },
    { id: 'EMP-20002', employeeId: 'EMP-20002' },
  ];

  assert.notEqual(validateFiveDigitEmployeeId('', existing), '');
  assert.notEqual(validateFiveDigitEmployeeId('1234', existing), '');
  assert.notEqual(validateFiveDigitEmployeeId('123456', existing), '');
  assert.notEqual(validateFiveDigitEmployeeId('ABCDE', existing), '');
  assert.notEqual(validateFiveDigitEmployeeId('54321-X', existing), '');
  assert.equal(validateFiveDigitEmployeeId('54321', existing), '');
  assert.equal(validateFiveDigitEmployeeId('EMP-54321', existing), '');
  assert.notEqual(validateFiveDigitEmployeeId('10001', existing), '');
  assert.equal(validateFiveDigitEmployeeId('10001', existing, 'EMP-10001'), '');
});

test('validateEmployeeId enforces required, format, length, and uniqueness rules', () => {
  const existing = [
    { id: 'EMP001', employeeId: 'EMP-10001' },
    { id: 'EMP002', employeeId: 'EMP_20002' },
  ];

  // Required (empty or whitespace-only)
  assert.notEqual(validateEmployeeId('', existing), '');
  assert.notEqual(validateEmployeeId('   ', existing), '');

  // Length (3-20 chars)
  assert.notEqual(validateEmployeeId('AB', existing), '');
  assert.notEqual(validateEmployeeId('A'.repeat(21), existing), '');
  assert.equal(validateEmployeeId('ABC', existing), '');
  assert.equal(validateEmployeeId('A'.repeat(20), existing), '');

  // Allowed chars: A-Z, 0-9, hyphen, underscore
  assert.notEqual(validateEmployeeId('EMP 54321', existing), '');
  assert.notEqual(validateEmployeeId('EMP@54321', existing), '');
  assert.notEqual(validateEmployeeId('EMP.54321', existing), '');
  assert.equal(validateEmployeeId('  emp-54321_x ', existing), '');

  // Case-insensitive and trimmed uniqueness
  assert.notEqual(validateEmployeeId('  emp-10001 ', existing), '');
  assert.notEqual(validateEmployeeId('emp_20002', existing), '');

  // Editing own record excludes itself from uniqueness check, but collides with others
  assert.equal(validateEmployeeId('  emp-10001 ', existing, 'EMP001'), '');
  assert.notEqual(validateEmployeeId('EMP_20002', existing, 'EMP001'), '');
});

test('seedData employees have unique valid employeeId values', () => {
  const seen = new Set<string>();
  for (const emp of seedData.employees) {
    assert.equal(
      validateEmployeeId(emp.employeeId, seedData.employees, emp.id),
      '',
      `Invalid seed employeeId: ${emp.employeeId}`
    );
    const normalized = normalizeEmployeeId(emp.employeeId);
    assert.equal(seen.has(normalized), false, `Duplicate seed employeeId: ${normalized}`);
    seen.add(normalized);
  }
});
