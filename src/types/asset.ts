import type { SessionUser, SystemUser, UserRole } from './user';
import type { SupportTicket } from './ticket';
export type { SessionUser, SystemUser, UserRole, SupportTicket };

export type NavTab =
  | 'dashboard'
  | 'my-assets'
  | 'my-tickets'
  | 'policies'
  | 'team-members'
  | 'profile'
  | 'inventory'
  | 'assignments'
  | 'returns'
  | 'transfers'
  | 'maintenance'
  | 'disposals'
  | 'employees'
  | 'consultants'
  | 'retainers'
  | 'freelancers'
  | 'yrp'
  | 'interns'
  | 'attendance'
  | 'vendors'
  | 'expenses'
  | 'reports'
  | 'tickets'
  | 'mail'
  | 'settings';

export type ReportTab =
  | 'asset'
  | 'employee'
  | 'depreciation'
  | 'assignment'
  | 'return'
  | 'transfer'
  | 'maintenance'
  | 'vendor'
  | 'expense';

export type AssetStatus = 'Available' | 'Assigned' | 'Under Maintenance' | 'Disposed';
export type AssetCondition = 'New' | 'Good' | 'Fair' | 'Damaged' | 'Poor';
export type DepreciationMethod = 'SLM' | 'WDV';
export type ThemePalette = 'Corporate Blue' | 'Emerald Green' | 'Royal Purple' | 'Dark Mode';

export type EmploymentCategory =
  | 'Employee'
  | 'Consultant'
  | 'Retainer'
  | 'Freelancer'
  | 'Young Research Program'
  | 'Intern';

export const ALL_EMPLOYMENT_CATEGORIES: readonly EmploymentCategory[] = [
  'Employee',
  'Consultant',
  'Retainer',
  'Freelancer',
  'Young Research Program',
  'Intern',
] as const;

export interface CompanySettings {
  companyName: string;
  gstNumber: string;
  phone: string;
  email: string;
  address: string;
  financialYear: string;
  currency: string;
  theme: ThemePalette;
}

export interface Asset {
  id: string;
  name: string;
  category: string;
  subcategory: string;
  brand: string;
  model?: string;
  serial: string;
  rmnNumber?: string;
  partNumber?: string;
  eanNumber?: string;
  imei1?: string;
  imei2?: string;
  snidNumber?: string;
  purchaseDate: string;
  cost: number;
  vendor: string;
  vendorSupplierName?: string;
  invoiceNumber?: string;
  warrantyMonths: number;
  warrantyExpiry: string;
  department: string;
  location: string;
  condition: AssetCondition;
  status: AssetStatus;
  depMethod: DepreciationMethod;
  usefulLife: number;
  salvageValue: number;
  currentValue: number;
  description: string;
  image?: string;
  projectName?: string;
  projectNo?: string;
  eicName?: string;
  assignedFlp?: string;
  flpId?: string;
  dateOfIssue?: string;
  dateOfReturn?: string;
  accessoriesIssued?: string;
  lastVerificationDate?: string;
  remarks?: string;
  employeeName?: string;
  consultantName?: string;
  retainerName?: string;
  freelancerName?: string;
  yrpName?: string;
  internName?: string;
}

export type PersonnelEntityType =
  | 'Consultant'
  | 'Retainer'
  | 'Freelancer'
  | 'Young Research Program'
  | 'Intern';

export type AssigneeEntityType = 'Employee' | PersonnelEntityType;

export interface PersonnelEntity {
  id: string;
  profileId?: string;
  entityCode: string;
  entityType: PersonnelEntityType;
  name: string;
  email: string;
  personalEmail?: string;
  officialEmail?: string;
  phone: string;
  whatsappNo?: string;
  fatherHusbandName?: string;
  address?: string;
  center: string;
  department: string;
  designation: string;
  isManager: boolean;
  reportingManagerId?: string;
  reportingManagerName?: string;
  reportingManagerEmail?: string;
  aadhaarCard?: string;
  panCard?: string;
  projectName?: string;
  projectNo?: string;
  eicName?: string;
  bankName?: string;
  bankBranch?: string;
  bankAccountType?: string;
  bankAccountNo?: string;
  ifscCode?: string;
  joiningDate?: string;
  status: 'Active' | 'Inactive';
  remarks?: string;
  createdAt?: string;
}

export interface FreelancerAccessoryItem {
  name: string;
  qty: number;
}

export interface FreelancerAllotmentRecord {
  id: string;
  assignmentId: string;
  assetIds: string[];
  flpId: string;
  flpName: string;
  flpCode: string;
  flpAddress: string;
  aadhaarNo: string;
  panNo: string;
  mobileNo: string;
  centerName: string;
  centerAddress: string;
  centerPhone: string;
  executiveName: string;
  executiveEmpId: string;
  jobNumber: string;
  issueDate: string;
  accessories: FreelancerAccessoryItem[];
  remarks?: string;
  witness1Name?: string;
  witness2Name?: string;
  allotmentDate: string;
  createdAt?: string;
}

export interface Employee {
  id: string;
  profileId?: string;
  employeeId: string;
  name: string;
  email: string;
  personalEmail?: string;
  officialEmail?: string;
  personalEmailVerified?: boolean;
  officialEmailVerified?: boolean;
  uanNumber?: string;
  panCard?: string;
  voterIdCard?: string;
  aadhaarCard?: string;
  leaveCarryForward?: number;
  department: string;
  designation: string;
  phone: string;
  branch: string;
  center?: string;
  isManager?: boolean;
  reportingManagerId?: string;
  reportingManagerName?: string;
  reportingManagerEmail?: string;
  joiningDate?: string;
  address?: string;
  remarks?: string;
  status: 'Active' | 'Inactive';
}

export interface DepartmentDesignation {
  id: string;
  departmentName: string;
  designationName: string;
  createdAt?: string;
}

export interface Vendor {
  id: string;
  name: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  gst: string;
  remarks?: string;
}

export interface Assignment {
  id: string;
  assetId: string;
  employeeId: string;
  assigneeType?: AssigneeEntityType;
  assignedById?: string;
  assignedByRole?: string;
  parentAssignmentId?: string;
  custodyLevel?: 'Primary' | 'Sub-Assigned';
  assignDate: string;
  returnDate?: string;
  condition?: AssetCondition;
  assignedBy?: string;
  notes?: string;
  projectName?: string;
  projectNo?: string;
  eicName?: string;
  allotmentId?: string;
  status: 'Active' | 'Returned' | 'Transferred';
}

export interface AssetReturn {
  id: string;
  date: string;
  employeeId: string;
  assetId: string;
  condition: AssetCondition;
  damage: 'No Damage' | 'Minor Damage' | 'Major Damage';
  remarks?: string;
}

export interface AssetTransfer {
  id: string;
  date: string;
  assetId: string;
  fromDept: string;
  toDept: string;
  fromEmp: string;
  toEmp: string;
  newLocation?: string;
  reason: string;
  remarks?: string;
}

export interface MaintenanceRecord {
  id: string;
  assetId: string;
  type: 'Preventive' | 'Corrective' | 'Upgrade' | 'Inspection';
  cost: number;
  vendor: string;
  status: 'Open' | 'In Progress' | 'Completed' | 'Cancelled';
  serviceDate: string;
  nextDate: string;
  notes: string;
}

export interface DisposalRecord {
  id: string;
  assetId: string;
  disposalDate: string;
  salvageRecovered: number;
  reason: string;
  notes: string;
}

export interface ExpenseCategoryRecord {
  id: string;
  name: string;
  description?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface PaymentModeRecord {
  id: string;
  name: string;
  description?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ExpenseRecord {
  id: string;
  date: string;
  category: string;
  paidTo: string;
  amount: number;
  mode: string;
  remarks: string;
}

export interface VisitorAnalyticsSummary {
  totalVisitors: number;
  todayVisitors: number;
  monthlyVisitors: number;
  yearlyVisitors: number;
  loggedInUsers: number;
  onlineUsers: number;
  dateStr: string;
}

export interface EmploymentConversionRecord {
  id: string;
  profileId: string;
  personName: string;
  fromType: EmploymentCategory;
  toType: EmploymentCategory;
  fromCode: string;
  toCode: string;
  convertedBy: string;
  reason?: string;
  convertedAt: string;
}

export interface HistoryEntry {
  id?: string;
  assetId: string;
  date: string;
  activity: 'Purchased' | 'Assigned' | 'Returned' | 'Transferred' | 'Maintenance' | 'Disposed' | 'Updated';
  details: string;
}

export interface AssetOSState {
  settings: CompanySettings;
  users: SystemUser[];
  assets: Asset[];
  employees: Employee[];
  entities?: PersonnelEntity[];
  vendors: Vendor[];
  assignments: Assignment[];
  freelancerAllotments?: FreelancerAllotmentRecord[];
  returns: AssetReturn[];
  transfers: AssetTransfer[];
  maintenance: MaintenanceRecord[];
  disposals: DisposalRecord[];
  expenses: ExpenseRecord[];
  expenseCategories?: ExpenseCategoryRecord[];
  paymentModes?: PaymentModeRecord[];
  employmentConversions?: EmploymentConversionRecord[];
  tickets: SupportTicket[];
  history: HistoryEntry[];
  categories: string[];
  departments: string[];
  designations?: DepartmentDesignation[];
  locations: string[];
}

export interface SystemAuditLog {
  id: string;
  module: string;
  entityType: string;
  entityId: string;
  action: string;
  actorUserId: string;
  actorName: string;
  actorRole: string;
  ipAddress: string;
  beforeJson: string | null;
  afterJson: string | null;
  details: string;
  createdAt: string;
}

export interface BulkEmployeeImportError {
  rowNumber: number;
  employeeId?: string;
  name?: string;
  reason: string;
}

export interface BulkEmployeeImportResult {
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  errors: BulkEmployeeImportError[];
  employees: Employee[];
}

export interface BulkDirectoryImportResult {
  directoryLabel: string;
  totalRows: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  errors: BulkEmployeeImportError[];
}

export interface ToastMessage {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

export type ModalType =
  | null
  | { type: 'asset'; assetId?: string }
  | { type: 'batch-asset-update'; assetIds: string[] }
  | { type: 'assign'; preselectedAssetId?: string; assignmentId?: string }
  | { type: 'sub-assign'; preselectedAssetId?: string; preselectedParentAssignmentId?: string }
  | { type: 'return'; preselectedAssetId?: string; preselectedEmployeeId?: string; assignmentId?: string }
  | { type: 'transfer'; preselectedAssetId?: string; preselectedEmployeeId?: string }
  | { type: 'maintenance'; maintenanceId?: string }
  | { type: 'disposal' }
  | { type: 'employee'; employeeId?: string }
  | { type: 'entity'; entityType: PersonnelEntityType; entityId?: string }
  | { type: 'freelancer'; entityId?: string }
  | { type: 'freelancer-allotment-print'; allotmentId?: string; assignmentId?: string }
  | {
      type: 'convert-employment';
      sourceType: EmploymentCategory;
      sourceId: string;
      sourceCode: string;
      personName: string;
    }
  | { type: 'vendor'; vendorId?: string }
  | { type: 'expense'; expenseId?: string }
  | { type: 'ticket'; preselectedAssetId?: string }
  | { type: 'user'; userId?: string }
  | { type: 'history'; assetId: string }
  | { type: 'employee-statement'; employeeId: string }
  | { type: 'employee-import-result'; result: BulkEmployeeImportResult }
  | { type: 'directory-import-result'; result: BulkDirectoryImportResult }
  | { type: 'confirm'; title: string; message: string; confirmLabel: string; danger?: boolean; onConfirm: () => void };
