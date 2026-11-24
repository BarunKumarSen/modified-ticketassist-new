import type { EmploymentCategory } from './asset';

export type PolicyCategory = 'HR Policy' | 'POSH Policy' | 'IT Policy' | string;

export interface PolicyVersionHistoryEntry {
  version: string;
  fileName: string;
  fileSize: number;
  uploadedBy: string;
  uploadedAt: string;
  notes?: string;
}

export interface PolicyDocumentRecord {
  id: string;
  category: PolicyCategory;
  title: string;
  description: string;
  version: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  uploadedBy: string;
  uploadedAt: string;
  updatedAt: string;
  history: PolicyVersionHistoryEntry[];
  visibleRoles?: EmploymentCategory[];
}

export interface PolicyAcknowledgmentRecord {
  id: string;
  policyId: string;
  policyVersion: string;
  userId: string;
  employeeId?: string;
  userName: string;
  userRole: string;
  entityType?: string;
  entityCode?: string;
  acknowledgedAt: string;
}

export interface EmployeeCenterRecord {
  id: string;
  name: string;
  stateRegion: string;
  centerCode?: string;
  officialAddress?: string;
  phone?: string;
  isActive: boolean;
  createdAt: string;
}

