import type {
  Assignment,
  Employee,
  FreelancerAccessoryItem,
  PersonnelEntity,
  PersonnelEntityType,
} from '../types/asset';
import type { EmployeeCenterRecord } from '../types/policy';

/**
 * Global Entity ID validation rule across Consultant, Retainer, Freelancer,
 * Young Research Program, and Interns:
 * ONLY CAPITAL LETTERS (A-Z) and NUMBERS (0-9), maximum length 10 characters.
 */
export const ENTITY_ID_REGEX = /^[A-Z0-9]{1,10}$/;

export const PERSONNEL_ENTITY_TYPES: readonly PersonnelEntityType[] = [
  'Consultant',
  'Retainer',
  'Freelancer',
  'Young Research Program',
  'Intern',
] as const;

export interface EntityModuleMeta {
  entityType: PersonnelEntityType;
  pluralLabel: string;
  singularLabel: string;
  idLabel: string;
  idPlaceholder: string;
  prefixHint: string;
}

export const ENTITY_MODULE_META: Record<PersonnelEntityType, EntityModuleMeta> = {
  Consultant: {
    entityType: 'Consultant',
    pluralLabel: 'Consultants',
    singularLabel: 'Consultant',
    idLabel: 'Consultant ID',
    idPlaceholder: 'e.g. CON0001',
    prefixHint: 'CON',
  },
  Retainer: {
    entityType: 'Retainer',
    pluralLabel: 'Retainers',
    singularLabel: 'Retainer',
    idLabel: 'Retainer ID',
    idPlaceholder: 'e.g. RET0001',
    prefixHint: 'RET',
  },
  Freelancer: {
    entityType: 'Freelancer',
    pluralLabel: 'Freelancers',
    singularLabel: 'Freelancer',
    idLabel: 'Freelancer Code / ID',
    idPlaceholder: 'e.g. KOL000001',
    prefixHint: 'FRL',
  },
  'Young Research Program': {
    entityType: 'Young Research Program',
    pluralLabel: 'Young Research Program',
    singularLabel: 'YRP Member',
    idLabel: 'YRP ID',
    idPlaceholder: 'e.g. YRP0001',
    prefixHint: 'YRP',
  },
  Intern: {
    entityType: 'Intern',
    pluralLabel: 'Interns',
    singularLabel: 'Intern',
    idLabel: 'Intern ID',
    idPlaceholder: 'e.g. INT0001',
    prefixHint: 'INT',
  },
};

export function normalizeEntityIdInput(raw: string): string {
  return String(raw || '').toUpperCase().trim();
}

export function validateEntityId(params: {
  rawId: string;
  existingEntities?: readonly Pick<PersonnelEntity, 'id' | 'entityCode'>[];
  existingEmployees?: readonly Pick<Employee, 'id' | 'employeeId'>[];
  excludeEntityId?: string;
}): { valid: true; normalizedId: string } | { valid: false; error: string } {
  const normalized = normalizeEntityIdInput(params.rawId);
  if (!normalized) {
    return {
      valid: false,
      error: 'ID is required (only CAPITAL LETTERS A-Z and NUMBERS 0-9, max 10 characters).',
    };
  }
  if (normalized.length > 10) {
    return {
      valid: false,
      error: `ID "${normalized}" exceeds the maximum length of 10 characters (A-Z, 0-9 only).`,
    };
  }
  if (!ENTITY_ID_REGEX.test(normalized)) {
    return {
      valid: false,
      error: `Invalid ID "${params.rawId}". Only CAPITAL LETTERS (A-Z) and NUMBERS (0-9) up to 10 characters are allowed (no spaces or special characters).`,
    };
  }

  const entities = params.existingEntities || [];
  const dupEntity = entities.find(
    (e) =>
      e.id !== params.excludeEntityId &&
      e.entityCode.trim().toUpperCase() === normalized
  );
  if (dupEntity) {
    return {
      valid: false,
      error: `ID "${normalized}" is already assigned to ${dupEntity.entityCode}.`,
    };
  }

  const employees = params.existingEmployees || [];
  const dupEmp = employees.find(
    (e) => e.employeeId.trim().toUpperCase() === normalized || e.id.trim().toUpperCase() === normalized
  );
  if (dupEmp) {
    return {
      valid: false,
      error: `ID "${normalized}" conflicts with an existing employee ID.`,
    };
  }

  return { valid: true, normalizedId: normalized };
}

export function validatePersonnelEntityInput(params: {
  entityType: PersonnelEntityType;
  entityCode: string;
  name: string;
  email: string;
  phone?: string;
  aadhaarCard?: string;
  panCard?: string;
  existingEntities?: readonly PersonnelEntity[];
  existingEmployees?: readonly Employee[];
  excludeEntityId?: string;
}): { ok: true; normalizedCode: string } | { ok: false; error: string; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const idCheck = validateEntityId({
    rawId: params.entityCode,
    existingEntities: params.existingEntities,
    existingEmployees: params.existingEmployees,
    excludeEntityId: params.excludeEntityId,
  });

  if (!idCheck.valid) {
    errors.entityCode = idCheck.error;
  }

  if (!params.name.trim()) {
    errors.name = 'Full Name is required.';
  }

  const cleanEmail = params.email.trim();
  if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    errors.email = 'A valid Email ID is required.';
  }

  if (params.entityType === 'Freelancer') {
    if (!params.phone?.trim()) {
      errors.phone = 'Mobile No. is required for Freelancers.';
    }
    if (params.aadhaarCard?.trim() && !/^\d{12}$/.test(params.aadhaarCard.replace(/[\s-]/g, ''))) {
      errors.aadhaarCard = 'Aadhaar Card No. must be 12 digits.';
    }
    if (params.panCard?.trim() && !/^[A-Z]{5}\d{4}[A-Z]$/.test(params.panCard.trim().toUpperCase())) {
      errors.panCard = 'PAN Card No. must match 10-character format (e.g. ABCDE1234F).';
    }
  }

  if (Object.keys(errors).length > 0 || !idCheck.valid) {
    return {
      ok: false,
      error: Object.values(errors)[0] || 'Validation failed.',
      errors,
    };
  }

  return { ok: true, normalizedCode: idCheck.normalizedId };
}

export const DEFAULT_CENTER_OFFICES: Record<string, { address: string; phone: string }> = {
  kolkata: {
    address: '3rd Floor, Unit - 304, Stesalit Towers, E-2/3, Block - EP & GP, Sector V, Salt Lake City, Kolkata - 700091',
    phone: '+91 33 4073 1137',
  },
  mumbai: {
    address: 'Median Research & Consulting Pvt. Ltd., Corporate Office, Mumbai, Maharashtra - 400001',
    phone: '+91 22 4000 1100',
  },
  'new delhi': {
    address: 'Median Research & Consulting Pvt. Ltd., Regional Office, New Delhi - 110001',
    phone: '+91 11 4000 1100',
  },
  bengaluru: {
    address: 'Median Research & Consulting Pvt. Ltd., Regional Office, Bengaluru, Karnataka - 560001',
    phone: '+91 80 4000 1100',
  },
  chennai: {
    address: 'Median Research & Consulting Pvt. Ltd., Regional Office, Chennai, Tamil Nadu - 600001',
    phone: '+91 44 4000 1100',
  },
  hyderabad: {
    address: 'Median Research & Consulting Pvt. Ltd., Regional Office, Hyderabad, Telangana - 500081',
    phone: '+91 40 4000 1100',
  },
  pune: {
    address: 'Median Research & Consulting Pvt. Ltd., Regional Office, Pune, Maharashtra - 411001',
    phone: '+91 20 4000 1100',
  },
};

export function resolveCenterOfficeInfo(
  centerName: string | undefined | null,
  centers: readonly EmployeeCenterRecord[] = []
): { name: string; address: string; phone: string } {
  const cleanName = (centerName || '').trim() || 'Kolkata';
  const key = cleanName.toLowerCase();
  const matched = centers.find((c) => c.name.trim().toLowerCase() === key);
  if (matched) {
    return {
      name: matched.name,
      address: matched.officialAddress?.trim() || '',
      phone: matched.phone?.trim() || '',
    };
  }
  const preset = DEFAULT_CENTER_OFFICES[key];

  return {
    name: cleanName,
    address: preset?.address || '',
    phone: preset?.phone || '',
  };
}

export function validateFreelancerAllotmentInput(params: {
  flpId: string;
  flpName: string;
  flpCode: string;
  flpAddress: string;
  aadhaarNo: string;
  panNo: string;
  mobileNo: string;
  centerName: string;
  executiveName: string;
  executiveEmpId: string;
  jobNumber: string;
  issueDate: string;
  assetIds: readonly string[];
  accessories?: readonly FreelancerAccessoryItem[];
}): { ok: true } | { ok: false; error: string } {
  if (!params.flpId.trim()) return { ok: false, error: 'Freelancer selection is required.' };
  if (!params.flpName.trim()) return { ok: false, error: 'Freelancer Name is required.' };
  if (!ENTITY_ID_REGEX.test(normalizeEntityIdInput(params.flpCode))) {
    return { ok: false, error: 'Valid Freelancer Code (A-Z, 0-9, max 10 chars) is required.' };
  }
  if (!params.flpAddress.trim()) return { ok: false, error: 'Freelancer Address is required.' };
  if (!params.aadhaarNo.trim()) return { ok: false, error: 'Aadhaar No. is required on the Allotment Form.' };
  if (!params.panNo.trim()) return { ok: false, error: 'PAN No. is required on the Allotment Form.' };
  if (!params.mobileNo.trim()) return { ok: false, error: 'Mobile No. is required on the Allotment Form.' };
  if (!params.centerName.trim()) return { ok: false, error: 'Name of Center is required.' };
  if (!params.executiveName.trim()) return { ok: false, error: 'Name of Executive (Issuer) is required.' };
  if (!params.jobNumber.trim()) return { ok: false, error: 'Job Number / Project No. is required.' };
  if (!params.issueDate.trim()) return { ok: false, error: 'Date of Issue is required.' };
  if (!Array.isArray(params.assetIds) || params.assetIds.length === 0) {
    return { ok: false, error: 'At least one asset must be selected for Freelancer allotment.' };
  }
  return { ok: true };
}

export function getDefaultFreelancerAccessories(): FreelancerAccessoryItem[] {
  return [
    { name: 'Power Adaptor / Charger', qty: 1 },
    { name: 'SIM Card', qty: 1 },
    { name: 'Tablet Flip cover', qty: 1 },
  ];
}

export function resolveCustodySummaryForAsset(params: {
  assetId: string;
  assignments: readonly Assignment[];
  employees: readonly Employee[];
  entities: readonly PersonnelEntity[];
}): {
  primary?: Assignment;
  subAssigned?: Assignment;
  primaryHolderName?: string;
  subHolderName?: string;
} {
  const active = params.assignments.filter(
    (a) => a.assetId === params.assetId && a.status === 'Active'
  );
  const primary = active.find((a) => (a.custodyLevel || 'Primary') === 'Primary');
  const subAssigned = active.find((a) => a.custodyLevel === 'Sub-Assigned');

  const resolveName = (asn?: Assignment): string | undefined => {
    if (!asn) return undefined;
    const emp = params.employees.find((e) => e.id === asn.employeeId || e.employeeId === asn.employeeId);
    if (emp) return emp.name;
    const ent = params.entities.find((e) => e.id === asn.employeeId || e.entityCode === asn.employeeId);
    if (ent) return ent.name;
    return asn.employeeId;
  };

  return {
    primary,
    subAssigned,
    primaryHolderName: resolveName(primary),
    subHolderName: resolveName(subAssigned),
  };
}
