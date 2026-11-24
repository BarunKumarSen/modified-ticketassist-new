import type {
  Asset,
  AssetStatus,
  DepreciationMethod,
  Employee,
  ThemePalette,
} from '../types/asset';

export function normalizeEmployeeId(value: string): string {
  return value.trim().toUpperCase();
}

export function extractFiveDigitEmployeeCode(rawValue: string): string | null {
  const trimmed = rawValue.trim().toUpperCase();
  const match = /^(?:EMP[-_]?)?(\d{5})$/.exec(trimmed);
  return match ? match[1] : null;
}

export function formatFiveDigitEmployeeId(rawValue: string): string {
  const code = extractFiveDigitEmployeeCode(rawValue);
  return code ? `EMP-${code}` : normalizeEmployeeId(rawValue);
}

export function validateFiveDigitEmployeeId(
  rawValue: string,
  existingEmployees: Pick<Employee, 'id' | 'employeeId'>[],
  editingInternalId?: string
): string {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return '5-digit Employee ID is required.';
  }
  const code = extractFiveDigitEmployeeCode(trimmed);
  if (!code) {
    return 'Employee ID must be a 5-digit numeric code (formatted as EMP-XXXXX, e.g. 54321 -> EMP-54321).';
  }
  const formatted = `EMP-${code}`;
  const isDuplicate = existingEmployees.some((emp) => {
    if (editingInternalId && emp.id === editingInternalId) return false;
    const existing = normalizeEmployeeId(emp.employeeId ?? emp.id ?? '');
    return existing === formatted || existing === code;
  });
  if (isDuplicate) {
    return `Employee ID "${formatted}" already exists.`;
  }
  return '';
}

export function validateEmployeeId(
  rawValue: string,
  existingEmployees: Pick<Employee, 'id' | 'employeeId'>[],
  editingInternalId?: string
): string {
  const normalized = normalizeEmployeeId(rawValue);
  if (!normalized) {
    return 'Employee ID is required.';
  }
  if (!/^[A-Z0-9_-]+$/.test(normalized)) {
    return 'Employee ID may only contain A–Z, 0–9, hyphens (-), and underscores (_).';
  }
  if (normalized.length < 3 || normalized.length > 20) {
    return 'Employee ID must be 3–20 characters.';
  }
  const isDuplicate = existingEmployees.some((emp) => {
    if (editingInternalId && emp.id === editingInternalId) return false;
    const existing = normalizeEmployeeId(emp.employeeId ?? emp.id ?? '');
    return existing === normalized;
  });
  if (isDuplicate) {
    return `Employee ID "${normalized}" already exists.`;
  }
  return '';
}

export function calculateWarrantyExpiry(purchaseDate: string, warrantyMonths: number): string {
  if (!purchaseDate || Number.isNaN(warrantyMonths)) return '';
  const parts = purchaseDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return '';
  const [year, month, day] = parts;
  const date = new Date(Date.UTC(year, month - 1 + warrantyMonths, day));
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().split('T')[0];
}

export function calculateBookValue(params: {
  cost: number;
  purchaseDate: string;
  usefulLife: number;
  salvageValue: number;
  method: DepreciationMethod;
  asOfDate?: Date;
}): number {
  const { cost, purchaseDate, usefulLife, salvageValue, method, asOfDate = new Date() } = params;
  if (!purchaseDate || cost <= 0) return 0;

  const pDate = new Date(purchaseDate);
  if (Number.isNaN(pDate.getTime())) return Math.max(0, cost);

  const msPerYear = 1000 * 60 * 60 * 24 * 365.25;
  const yearsElapsed = Math.max(0, (asOfDate.getTime() - pDate.getTime()) / msPerYear);
  const safeLife = Math.max(1, usefulLife || 5);
  const safeSalvage = Math.max(0, Math.min(cost, salvageValue || 0));

  if (method === 'SLM') {
    const annualDep = (cost - safeSalvage) / safeLife;
    const value = cost - annualDep * yearsElapsed;
    return Number(Math.max(safeSalvage, value).toFixed(2));
  }

  const rate = 0.2;
  const value = cost * Math.pow(1 - rate, yearsElapsed);
  return Number(Math.max(safeSalvage, value).toFixed(2));
}

export function generateNextId(prefix: string, existingIds: string[], padLength = 4): string {
  let maxNum = 0;
  for (const id of existingIds) {
    if (id.startsWith(prefix)) {
      const numeric = parseInt(id.slice(prefix.length), 10);
      if (!Number.isNaN(numeric) && numeric > maxNum) {
        maxNum = numeric;
      }
    }
  }
  return `${prefix}${String(maxNum + 1).padStart(padLength, '0')}`;
}

export interface DashboardKPIs {
  totalAssets: number;
  availableAssets: number;
  assignedAssets: number;
  maintenanceAssets: number;
  disposedAssets: number;
  availablePct: number;
  assignedPct: number;
  maintenancePct: number;
  disposedPct: number;
  totalPurchaseCost: number;
  totalBookValue: number;
}

export function computeDashboardKPIs(assets: Asset[]): DashboardKPIs {
  const totalAssets = assets.length;
  const availableAssets = assets.filter((a) => a.status === 'Available').length;
  const assignedAssets = assets.filter((a) => a.status === 'Assigned').length;
  const maintenanceAssets = assets.filter((a) => a.status === 'Under Maintenance').length;
  const disposedAssets = assets.filter((a) => a.status === 'Disposed').length;

  const activeDenominator = Math.max(1, totalAssets - disposedAssets);
  const totalDenominator = Math.max(1, totalAssets);

  const totalPurchaseCost = assets.reduce((sum, a) => sum + (Number(a.cost) || 0), 0);
  const totalBookValue = assets.reduce((sum, a) => sum + (Number(a.currentValue) || 0), 0);

  return {
    totalAssets,
    availableAssets,
    assignedAssets,
    maintenanceAssets,
    disposedAssets,
    availablePct: totalAssets === 0 ? 0 : Math.round((availableAssets / activeDenominator) * 100),
    assignedPct: totalAssets === 0 ? 0 : Math.round((assignedAssets / activeDenominator) * 100),
    maintenancePct: totalAssets === 0 ? 0 : Math.round((maintenanceAssets / totalDenominator) * 100),
    disposedPct: totalAssets === 0 ? 0 : Math.round((disposedAssets / totalDenominator) * 100),
    totalPurchaseCost,
    totalBookValue,
  };
}

export function aggregateByField(assets: Asset[], field: 'category' | 'department'): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const asset of assets) {
    const key = asset[field] || 'Other';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

export function aggregateValueByCategory(assets: Asset[]): Record<string, number> {
  const values: Record<string, number> = {};
  for (const asset of assets) {
    const key = asset.category || 'Other';
    values[key] = (values[key] || 0) + (Number(asset.cost) || 0);
  }
  return values;
}

export function filterAssets(
  assets: Asset[],
  query: string,
  statusFilter: AssetStatus | 'ALL'
): Asset[] {
  const q = query.trim().toLowerCase();
  return assets.filter((a) => {
    const matchesStatus = statusFilter === 'ALL' || a.status === statusFilter;
    if (!matchesStatus) return false;
    if (!q) return true;
    return (
      a.name.toLowerCase().includes(q) ||
      a.id.toLowerCase().includes(q) ||
      a.serial.toLowerCase().includes(q) ||
      a.brand.toLowerCase().includes(q) ||
      a.category.toLowerCase().includes(q) ||
      a.department.toLowerCase().includes(q)
    );
  });
}

export function paginateItems<T>(items: T[], page: number, pageSize: number): {
  items: T[];
  totalPages: number;
  safePage: number;
  startIndex: number;
  endIndex: number;
} {
  const total = items.length;
  const safeSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(total / safeSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * safeSize;
  const sliced = items.slice(start, start + safeSize);
  return {
    items: sliced,
    totalPages,
    safePage,
    startIndex: total === 0 ? 0 : start + 1,
    endIndex: Math.min(start + safeSize, total),
  };
}

export function toCSV(headers: string[], rows: Array<Array<string | number>>): string {
  const escapeCell = (val: string | number) => {
    const raw = String(val ?? '');
    const str = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    if (str.includes('"') || str.includes(',') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  return [headers.map(escapeCell).join(','), ...rows.map((r) => r.map(escapeCell).join(','))].join('\n');
}

export interface ThemeTokens {
  primaryBtn: string;
  primaryBtnHover: string;
  sidebarActive: string;
  accentText: string;
  accentBorder: string;
  border: string;
  surfaceBg: string;
  modalHeader: string;
  swatchHex: string;
  dataTheme: 'corporate-blue' | 'emerald-green' | 'royal-purple' | 'dark-mode';
}

export function normalizeThemePalette(raw?: string | null): ThemePalette {
  const val = String(raw || '').trim();
  if (val === 'Emerald Green') return 'Emerald Green';
  if (val === 'Royal Purple' || val === 'Royal Violet') return 'Royal Purple';
  if (val === 'Dark Mode') return 'Dark Mode';
  if (val === 'Corporate Blue' || val === 'Deep Indigo' || val === 'Classic Olive' || val === 'Plum Blossom') {
    return 'Corporate Blue';
  }
  return 'Corporate Blue';
}

export const THEME_PALETTES: Record<ThemePalette, ThemeTokens> = {
  'Corporate Blue': {
    primaryBtn: 'bg-blue-700 text-white',
    primaryBtnHover: 'hover:bg-blue-800',
    sidebarActive: 'bg-blue-700 text-white',
    accentText: 'text-blue-700 dark:text-blue-400',
    accentBorder: 'border-blue-700',
    border: 'border-slate-200 dark:border-slate-700',
    surfaceBg: 'bg-white dark:bg-slate-900',
    modalHeader: 'bg-slate-900',
    swatchHex: '#1d4ed8',
    dataTheme: 'corporate-blue',
  },
  'Emerald Green': {
    primaryBtn: 'bg-emerald-700 text-white',
    primaryBtnHover: 'hover:bg-emerald-800',
    sidebarActive: 'bg-emerald-700 text-white',
    accentText: 'text-emerald-700 dark:text-emerald-400',
    accentBorder: 'border-emerald-700',
    border: 'border-emerald-200 dark:border-slate-700',
    surfaceBg: 'bg-white dark:bg-slate-900',
    modalHeader: 'bg-emerald-900',
    swatchHex: '#047857',
    dataTheme: 'emerald-green',
  },
  'Royal Purple': {
    primaryBtn: 'bg-purple-700 text-white',
    primaryBtnHover: 'hover:bg-purple-800',
    sidebarActive: 'bg-purple-700 text-white',
    accentText: 'text-purple-700 dark:text-purple-400',
    accentBorder: 'border-purple-700',
    border: 'border-purple-200 dark:border-slate-700',
    surfaceBg: 'bg-white dark:bg-slate-900',
    modalHeader: 'bg-purple-900',
    swatchHex: '#7e22ce',
    dataTheme: 'royal-purple',
  },
  'Dark Mode': {
    primaryBtn: 'bg-sky-600 text-white',
    primaryBtnHover: 'hover:bg-sky-500',
    sidebarActive: 'bg-sky-600 text-white',
    accentText: 'text-sky-400',
    accentBorder: 'border-sky-500',
    border: 'border-slate-700',
    surfaceBg: 'bg-slate-900',
    modalHeader: 'bg-slate-950',
    swatchHex: '#0284c7',
    dataTheme: 'dark-mode',
  },
};

export function formatCurrency(amount: number, symbol = '$'): string {
  const num = Number(amount) || 0;
  return `${symbol}${num.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}
