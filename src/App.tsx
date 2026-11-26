import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  Asset,
  AssetOSState,
  AssetStatus,
  AssigneeEntityType,
  Employee,
  ModalType,
  NavTab,
  PersonnelEntity,
  PersonnelEntityType,
  ToastMessage,
} from './types/asset';
import type { EmployeeCenterRecord } from './types/policy';
import { DEFAULT_INDIAN_CENTER, INDIAN_CENTERS, normalizeCenterName } from './data/indianCenters';
import { seedData } from './data/seedData';
import {
  cancelOwnOpenTicket,
  canUserRaiseTicket,
  getScopedEmployeeData,
  isSelfServiceEntityRole,
} from './utils/ticketLogic';
import { apiClient, ApiError } from './api/client';
import { SessionProvider, useSession } from './auth/SessionContext';
import { AccessDeniedCard, RequirePermission, RequireRole } from './auth/RequireRole';
import type { PermissionName } from './auth/permissions';
import type { SessionUser } from './types/user';
import { LoginScreen } from './components/LoginScreen';
import { Sidebar } from './components/Sidebar';
import { Header } from './components/Header';
import { DashboardView } from './components/DashboardView';
import { InventoryView } from './components/InventoryView';
import {
  AssignmentsView,
  DisposalView,
  MaintenanceView,
  ReturnsView,
  TransfersView,
} from './components/OperationsViews';
import { EmployeesView, ExpensesView, VendorsView } from './components/ManagementViews';
import { ReportsView } from './components/ReportsView';
import { SettingsView } from './components/SettingsView';
import { AttendanceView } from './components/AttendanceView';
import { MailDashboardView } from './components/MailDashboardView';
import { parseCsvRows } from './utils/employeeImport';
import { parseAssetImportCsvRows } from './utils/assetExport';
import {
  AssetFormModal,
  AssignModal,
  BatchAssetUpdateModal,
  DisposalModal,
  MaintenanceModal,
  ModalShell,
  ReturnModal,
  SubAssignModal,
  TransferModal,
} from './components/AssetModals';
import type { FreelancerAllotmentDraft } from './components/FreelancerAllotmentModal';
import { FreelancerAllotmentPrintModal } from './components/FreelancerAllotmentPrintModal';
import { FreelancerFormModal } from './components/FreelancerFormModal';
import { PersonnelEntityModal } from './components/PersonnelEntityModal';
import { PersonnelModulesView } from './components/PersonnelModulesView';
import {
  AssetHistoryModal,
  ConfirmModal,
  ConvertEmploymentModal,
  DirectoryImportResultModal,
  EmployeeFormModal,
  EmployeeImportResultModal,
  EmployeeStatementModal,
  ExpenseFormModal,
  MailStatusPopupModal,
  ToastContainer,
  UserFormModal,
  VendorFormModal,
  type RbacUserFormPayload,
} from './components/InfoModals';
import type { SupportTicket } from './types/ticket';
import { TicketModal } from './components/TicketModal';
import { SupportTicketsView } from './components/SupportTicketsView';
import { isAdminRole, isEmployeeManagerUser } from './utils/hierarchyLogic';
import {
  EmployeeDashboardView,
  EmployeeProfileView,
  MyAssetsView,
} from './components/EmployeeViews';
import { MyTicketsView } from './components/MyTicketsView';
import { PoliciesView } from './components/PoliciesView';
import { TeamMembersView } from './components/TeamMembersView';

const STORAGE_KEY = 'assetOS_v1_state';
const KNOWN_TABS: ReadonlySet<NavTab> = new Set([
  'dashboard',
  'my-assets',
  'my-tickets',
  'policies',
  'team-members',
  'profile',
  'inventory',
  'assignments',
  'returns',
  'transfers',
  'maintenance',
  'disposals',
  'employees',
  'consultants',
  'retainers',
  'freelancers',
  'yrp',
  'interns',
  'attendance',
  'vendors',
  'expenses',
  'reports',
  'tickets',
  'mail',
  'settings',
]);

const TAB_TO_ENTITY_TYPE: Partial<Record<NavTab, PersonnelEntityType>> = {
  consultants: 'Consultant',
  retainers: 'Retainer',
  freelancers: 'Freelancer',
  yrp: 'Young Research Program',
  interns: 'Intern',
};

function getRequestedTabFromUrl(): NavTab | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const qTab = params.get('tab')?.trim();
  if (qTab && KNOWN_TABS.has(qTab as NavTab)) return qTab as NavTab;

  const hashTab = window.location.hash.replace(/^#\/?/, '').trim();
  if (hashTab && KNOWN_TABS.has(hashTab as NavTab)) return hashTab as NavTab;

  const pathSeg = window.location.pathname.replace(/^\/+|\/+$/g, '').trim();
  if (pathSeg && pathSeg !== 'index.html' && KNOWN_TABS.has(pathSeg as NavTab)) {
    return pathSeg as NavTab;
  }
  return null;
}

function loadInitialState(): AssetOSState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedData;
    const parsed = JSON.parse(raw) as Partial<AssetOSState>;
    return {
      ...seedData,
      ...parsed,
      settings: { ...seedData.settings, ...(parsed.settings || {}) },
      employees: Array.isArray(parsed.employees)
        ? parsed.employees.map((e) => {
            const seedMatch = seedData.employees.find((s) => s.id === e.id);
            return {
              ...e,
              employeeId: e.employeeId || e.id,
              center: normalizeCenterName(e.center || e.branch || seedMatch?.center || DEFAULT_INDIAN_CENTER),
              reportingManagerName:
                e.reportingManagerName || seedMatch?.reportingManagerName || 'System Administrator',
              reportingManagerEmail:
                e.reportingManagerEmail ||
                seedMatch?.reportingManagerEmail ||
                seedData.settings.email,
            };
          })
        : seedData.employees,
      tickets: Array.isArray(parsed.tickets)
        ? parsed.tickets.map((t) => ({ ...t, priority: t.priority || 'Medium' }))
        : seedData.tickets,
      categories: parsed.categories || seedData.categories,
      departments: parsed.departments || seedData.departments,
      locations: parsed.locations || seedData.locations,
    };
  } catch {
    return seedData;
  }
}

function AppContent() {
  const {
    session,
    authLoading,
    users,
    roles,
    theme: sessionTheme,
    setThemePreference,
    logout,
    refreshRbacData,
    hasPermission,
    hasAnyPermission,
  } = useSession();
  const [state, setState] = useState<AssetOSState>(loadInitialState);
  const [apiEmployees, setApiEmployees] = useState<Employee[] | null>(null);
  const [batchResetToken, setBatchResetToken] = useState(0);
  const [activeTab, setActiveTab] = useState<NavTab>(() => getRequestedTabFromUrl() || 'dashboard');
  const [inventoryStatusFilter, setInventoryStatusFilter] = useState<AssetStatus | 'ALL'>('ALL');
  const [globalSearch, setGlobalSearch] = useState('');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [forgotModalOpen, setForgotModalOpen] = useState(false);
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [forgotSubmitting, setForgotSubmitting] = useState(false);
  const [centers, setCenters] = useState<EmployeeCenterRecord[]>(() =>
    INDIAN_CENTERS.map((c) => ({
      id: c.id,
      name: c.name,
      stateRegion: c.stateRegion,
      isActive: true,
      createdAt: '',
    }))
  );
  const [selectedPolicyCategory, setSelectedPolicyCategory] = useState<string | undefined>(undefined);
  const [mailPopup, setMailPopup] = useState<{
    ok: boolean;
    title: string;
    details?: string;
  } | null>(null);

  const activeTheme = sessionTheme || state.settings.theme;
  const effectiveState = useMemo<AssetOSState>(
    () => ({
      ...state,
      settings: {
        ...state.settings,
        theme: activeTheme,
      },
    }),
    [state, activeTheme]
  );

  const currentUser = session?.fullName || '';
  const isSelfServiceUser = isSelfServiceEntityRole(session?.role);
  const canRaiseTicket = canUserRaiseTicket(session);
  const isSuperAdmin = isAdminRole(session?.role);
  const isAssetOpsRole =
    isSuperAdmin || session?.role === 'Manager' || session?.role === 'Auditor';
  const canAccessTeamMembers = Boolean(
    session &&
      (isSuperAdmin ||
        isEmployeeManagerUser(session, apiEmployees ?? state.employees, state.entities || []))
  );

  const showToast = useCallback((message: string, type: ToastMessage['type'] = 'success') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3200);
  }, []);

  // Load authoritative workspace state (assets, employees, operations, settings) from SQLite API
  const syncWorkspaceFromApi = useCallback(async () => {
    if (!session) {
      setApiEmployees(null);
      return;
    }
    void apiClient
      .listCenters()
      .then((cRes) => {
        if (cRes.centers.length > 0) setCenters(cRes.centers);
      })
      .catch(() => undefined);
    try {
      const res = await apiClient.getWorkspaceState();
      setState(res.state);
      setApiEmployees(hasPermission('employee.view') ? res.state.employees : null);
    } catch {
      if (hasPermission('employee.view')) {
        try {
          const empRes = await apiClient.listEmployees();
          setApiEmployees(empRes.employees);
          setState((prev) => ({ ...prev, employees: empRes.employees }));
        } catch {
          setApiEmployees(null);
        }
      } else {
        setApiEmployees(null);
      }
    }
  }, [session, hasPermission]);

  const syncEmployeesFromApi = useCallback(async () => {
    await syncWorkspaceFromApi();
  }, [syncWorkspaceFromApi]);

  useEffect(() => {
    void syncWorkspaceFromApi();
  }, [syncWorkspaceFromApi]);

  // Listen to browser navigation changes so direct URL navigation is evaluated against RBAC
  useEffect(() => {
    const handleUrlChange = () => {
      const urlTab = getRequestedTabFromUrl();
      if (urlTab) setActiveTab(urlTab);
    };
    window.addEventListener('popstate', handleUrlChange);
    window.addEventListener('hashchange', handleUrlChange);
    return () => {
      window.removeEventListener('popstate', handleUrlChange);
      window.removeEventListener('hashchange', handleUrlChange);
    };
  }, []);

  const scopedEmployeeData = useMemo(
    () =>
      canRaiseTicket
        ? getScopedEmployeeData({
            session,
            employees: state.employees,
            entities: state.entities || [],
            assets: state.assets,
            assignments: state.assignments,
            tickets: state.tickets,
            maintenance: state.maintenance,
          })
        : null,
    [
      canRaiseTicket,
      session,
      state.employees,
      state.entities,
      state.assets,
      state.assignments,
      state.tickets,
      state.maintenance,
    ]
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Ignore storage quota errors
    }
  }, [state]);

  const SELF_SERVICE_PORTAL_TABS = new Set<NavTab>([
    'dashboard',
    'my-assets',
    'my-tickets',
    'policies',
    'profile',
    'attendance',
    'team-members',
    'employees',
    'reports',
    'settings',
  ]);

  useEffect(() => {
    if (!session) return;
    if (isSelfServiceEntityRole(session.role) && !SELF_SERVICE_PORTAL_TABS.has(activeTab)) {
      setActiveTab('dashboard');
      if (window.location.search || window.location.pathname !== '/') {
        window.history.replaceState(null, '', '/');
      }
    }
  }, [session, activeTab]);

  const handleLoginSuccess = (user: SessionUser) => {
    const urlTab = getRequestedTabFromUrl();
    const targetTab: NavTab =
      urlTab && (!isSelfServiceEntityRole(user.role) || SELF_SERVICE_PORTAL_TABS.has(urlTab))
        ? urlTab
        : 'dashboard';
    setActiveTab(targetTab);
    if (targetTab === 'dashboard' && (window.location.search || window.location.pathname !== '/')) {
      window.history.replaceState(null, '', '/');
    }
    showToast(`Signed in as ${user.fullName}`);
  };

  const handleLogout = () => {
    void logout();
    setApiEmployees(null);
    setActiveTab('dashboard');
    setActiveModal(null);
    if (window.location.search || window.location.pathname !== '/') {
      window.history.replaceState(null, '', '/');
    }
    showToast('Signed out of Median Research Portal', 'info');
  };

  const handleNavigate = (tab: NavTab, statusFilter?: AssetStatus | 'ALL') => {
    if (statusFilter !== undefined) {
      setInventoryStatusFilter(statusFilter);
    } else if (tab === 'inventory') {
      setInventoryStatusFilter('ALL');
    }
    setActiveTab(tab);
    const nextUrl = tab === 'dashboard' ? '/' : `/?tab=${tab}`;
    if (window.location.pathname + window.location.search !== nextUrl) {
      window.history.replaceState(null, '', nextUrl);
    }
  };

  const handleGlobalSearch = (val: string) => {
    setGlobalSearch(val);
    if (val.trim().length > 1) {
      if (isSelfServiceUser) {
        if (activeTab !== 'my-assets') handleNavigate('my-assets');
      } else if (isAssetOpsRole && activeTab !== 'inventory') {
        handleNavigate('inventory');
      }
    }
  };

  const handleReorderTickets = async (orderedIds: string[]) => {
    try {
      await apiClient.reorderTickets(orderedIds);
      await syncWorkspaceFromApi();
      showToast('Ticket queue order updated');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Failed to reorder ticket queue', 'error');
    }
  };

  const handleScheduleWorkOrder = async (
    ticketId: string,
    payload: { workOrderDate: string; workOrderStartTime: string; workOrderDurationMins: number }
  ) => {
    await apiClient.scheduleTicketWorkOrder(ticketId, payload);
    await syncWorkspaceFromApi();
    showToast('Work Order scheduled and Admin slot locked');
  };

  const handleConfirmWorkOrder = async (ticket: SupportTicket) => {
    try {
      await apiClient.confirmTicketWorkOrder(ticket.id);
      await syncWorkspaceFromApi();
      showToast('Work Order time slot confirmed');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Failed to confirm Work Order', 'error');
    }
  };

  const handleCloseTicket = async (ticket: SupportTicket) => {
    try {
      await apiClient.closeTicket(ticket.id);
      await syncWorkspaceFromApi();
      showToast(`Ticket closed`, 'info');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Failed to close ticket', 'error');
    }
  };

  const handleSendTicketMail = async (ticket: SupportTicket) => {
    try {
      const res = await apiClient.sendTicketWorkOrderMail(ticket.id);
      await syncWorkspaceFromApi();
      setMailPopup({
        ok: true,
        title: 'Email Sent Successfully',
        details: res.message,
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Email Delivery Failed';
      setMailPopup({
        ok: false,
        title: 'Email Delivery Failed',
        details: msg,
      });
    }
  };

  // --- CRUD HANDLERS (SQLite-backed) ---
  const handleSaveAsset = async (payload: Omit<Asset, 'id'> & { id?: string }) => {
    const editingAssetId = activeModal?.type === 'asset' ? activeModal.assetId : undefined;
    try {
      if (editingAssetId) {
        await apiClient.updateAsset(editingAssetId, payload);
        showToast('Asset record updated');
      } else {
        await apiClient.createAsset(payload);
        showToast('New asset record created');
      }
      await syncWorkspaceFromApi();
      setActiveModal(null);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Failed to save asset', 'error');
    }
  };

  const handleDeleteAsset = (asset: Asset) => {
    setActiveModal({
      type: 'confirm',
      title: 'Delete Asset',
      message: `Are you sure you want to permanently remove "${asset.name}" (${asset.id})? Employee records will not be affected.`,
      confirmLabel: 'Delete Asset',
      danger: true,
      onConfirm: () => {
        void (async () => {
          try {
            await apiClient.deleteAsset(asset.id);
            await syncWorkspaceFromApi();
            setBatchResetToken((prev) => prev + 1);
            showToast('Asset deleted', 'info');
          } catch (err) {
            showToast(err instanceof ApiError ? err.message : 'Failed to delete asset', 'error');
          } finally {
            setActiveModal(null);
          }
        })();
      },
    });
  };

  const handleImportAssetsCSV = (csvText: string) => {
    const items = parseAssetImportCsvRows(csvText);
    if (items.length === 0) {
      showToast('CSV file is empty or has no valid asset rows', 'error');
      return;
    }
    void (async () => {
      try {
        const res = await apiClient.bulkImportAssets(items);
        await syncWorkspaceFromApi();
        showToast(`Imported ${res.assets.length} asset(s) from CSV`);
      } catch (err) {
        showToast(err instanceof ApiError ? err.message : 'Asset CSV import failed', 'error');
      }
    })();
  };

  const handleBatchAssetUpdate = async (payload: {
    assetIds: string[];
    status?: AssetStatus;
    department?: string;
    notes?: string;
  }) => {
    const res = await apiClient.bulkUpdateAssets(payload);
    await syncWorkspaceFromApi();
    setBatchResetToken((prev) => prev + 1);
    setActiveModal(null);
    showToast(`Updated ${res.updatedCount} asset(s) in batch`);
  };

  const handleDeleteEmployee = (emp: Employee) => {
    setActiveModal({
      type: 'confirm',
      title: 'Delete Employee',
      message: `Are you sure you want to permanently remove employee "${emp.name}" (${emp.employeeId})? Active asset assignments must be returned first.`,
      confirmLabel: 'Delete Employee',
      danger: true,
      onConfirm: () => {
        void (async () => {
          try {
            await apiClient.deleteEmployee(emp.id);
            await syncWorkspaceFromApi();
            showToast('Employee deleted', 'info');
          } catch (err) {
            showToast(
              err instanceof ApiError ? err.message : 'Failed to delete employee',
              'error'
            );
          } finally {
            setActiveModal(null);
          }
        })();
      },
    });
  };

  const handleImportEmployeesCSV = (csvText: string) => {
    const rows = parseCsvRows(csvText);
    if (rows.length < 2) {
      showToast('CSV file is empty or missing employee rows', 'error');
      return;
    }
    void (async () => {
      try {
        const result = await apiClient.bulkImportEmployees(csvText, 'skip');
        await syncWorkspaceFromApi();
        setActiveModal({ type: 'employee-import-result', result });
        showToast(
          `Employee import: ${result.createdCount} created, ${result.skippedCount} skipped, ${result.failedCount} failed`,
          result.failedCount > 0 && result.createdCount === 0 ? 'error' : 'success'
        );
      } catch (err) {
        showToast(
          err instanceof ApiError ? err.message : 'Bulk employee import failed',
          'error'
        );
      }
    })();
  };

  const handleImportEntitiesCSV = (entityType: PersonnelEntityType, csvText: string) => {
    const rows = parseCsvRows(csvText);
    if (rows.length < 2) {
      showToast('CSV file is empty or missing data rows', 'error');
      return;
    }
    void (async () => {
      try {
        const result = await apiClient.bulkImportEntities(entityType, csvText, 'skip');
        await syncWorkspaceFromApi();
        setActiveModal({ type: 'directory-import-result', result });
        showToast(
          `${entityType} import: ${result.createdCount} created, ${result.skippedCount} skipped, ${result.failedCount} failed`,
          result.failedCount > 0 && result.createdCount === 0 ? 'error' : 'success'
        );
      } catch (err) {
        showToast(
          err instanceof ApiError ? err.message : `Bulk ${entityType} import failed`,
          'error'
        );
      }
    })();
  };

  const handleImportVendorsCSV = (csvText: string) => {
    const rows = parseCsvRows(csvText);
    if (rows.length < 2) {
      showToast('CSV file is empty or missing vendor rows', 'error');
      return;
    }
    void (async () => {
      try {
        const result = await apiClient.bulkImportVendors(csvText, 'skip');
        await syncWorkspaceFromApi();
        setActiveModal({ type: 'directory-import-result', result });
        showToast(
          `Vendor import: ${result.createdCount} created, ${result.skippedCount} skipped, ${result.failedCount} failed`,
          result.failedCount > 0 && result.createdCount === 0 ? 'error' : 'success'
        );
      } catch (err) {
        showToast(
          err instanceof ApiError ? err.message : 'Bulk vendor import failed',
          'error'
        );
      }
    })();
  };

  const handleAssignSubmit = async (payload: {
    assetId: string;
    employeeId: string;
    assigneeType: AssigneeEntityType;
    assignDate: string;
    condition: Asset['condition'];
    notes: string;
    projectName?: string;
    projectNo?: string;
    eicName?: string;
    allotment?: FreelancerAllotmentDraft;
    openPrintPreview?: boolean;
  }) => {
    const emp = (apiEmployees ?? state.employees).find((e) => e.id === payload.employeeId);
    const ent = (state.entities || []).find((e) => e.id === payload.employeeId);
    const targetName = emp?.name || ent?.name || payload.assigneeType.toLowerCase();
    try {
      const res = await apiClient.assignAsset({
        assetId: payload.assetId,
        employeeId: payload.employeeId,
        assigneeType: payload.assigneeType,
        assignDate: payload.assignDate,
        condition: payload.condition,
        notes: payload.notes,
        projectName: payload.projectName,
        projectNo: payload.projectNo,
        eicName: payload.eicName,
        allotment: payload.allotment,
      });
      await syncWorkspaceFromApi();
      showToast(`Asset assigned to ${targetName}`);
      if (payload.openPrintPreview && res.allotment) {
        setActiveModal({
          type: 'freelancer-allotment-print',
          allotmentId: res.allotment.id,
          assignmentId: res.assignment.id,
        });
      } else {
        setActiveModal(null);
      }
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Failed to assign asset', 'error');
    }
  };

  const handleSubAssignSubmit = async (payload: {
    assetId: string;
    parentAssignmentId?: string;
    assigneeId: string;
    assigneeType: AssigneeEntityType;
    assignDate: string;
    condition: Asset['condition'];
    notes: string;
    projectName?: string;
    projectNo?: string;
    eicName?: string;
    allotment?: FreelancerAllotmentDraft;
    openPrintPreview?: boolean;
  }) => {
    const emp = (apiEmployees ?? state.employees).find((e) => e.id === payload.assigneeId);
    const ent = (state.entities || []).find((e) => e.id === payload.assigneeId);
    const targetName = emp?.name || ent?.name || payload.assigneeType;
    try {
      const res = await apiClient.createSubAssignment({
        assetId: payload.assetId,
        assigneeId: payload.assigneeId,
        assigneeType: payload.assigneeType,
        assignDate: payload.assignDate,
        condition: payload.condition,
        notes: payload.notes,
        projectName: payload.projectName,
        projectNo: payload.projectNo,
        eicName: payload.eicName,
        allotment: payload.allotment,
      });
      await syncWorkspaceFromApi();
      showToast(`Asset sub-assigned to ${targetName}`);
      if (payload.openPrintPreview && res.allotment) {
        setActiveModal({
          type: 'freelancer-allotment-print',
          allotmentId: res.allotment.id,
          assignmentId: res.assignment.id,
        });
      } else {
        setActiveModal(null);
      }
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Failed to sub-assign asset', 'error');
    }
  };

  const handleReturnSubAssignment = (subAssignmentId: string, assetLabel: string) => {
    setActiveModal({
      type: 'confirm',
      title: 'Return Sub-Assignment',
      message: `Return sub-assigned equipment "${assetLabel}" back to its Primary custody holder?`,
      confirmLabel: 'Confirm Return',
      danger: false,
      onConfirm: () => {
        void (async () => {
          try {
            await apiClient.returnSubAssignment(subAssignmentId);
            await syncWorkspaceFromApi();
            showToast('Sub-assigned asset returned to Primary holder');
          } catch (err) {
            showToast(
              err instanceof ApiError ? err.message : 'Failed to return sub-assignment',
              'error'
            );
          } finally {
            setActiveModal(null);
          }
        })();
      },
    });
  };

  const handleToggleConsultantManager = async (
    entity: PersonnelEntity,
    nextVal: boolean,
    forceUnassign = false
  ) => {
    try {
      await apiClient.toggleConsultantManager(entity.id, nextVal, forceUnassign);
      await syncWorkspaceFromApi();
      showToast(
        nextVal
          ? `${entity.name} granted Consultant-Manager privileges`
          : `${entity.name} Manager privileges revoked`
      );
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 409)) {
        showToast(
          err instanceof ApiError ? err.message : 'Failed to update Consultant-Manager privilege',
          'error'
        );
      }
      throw err;
    }
  };

  const handleDeleteEntity = (entity: PersonnelEntity) => {
    setActiveModal({
      type: 'confirm',
      title: `Delete ${entity.entityType}`,
      message: `Are you sure you want to remove "${entity.name}" (${entity.entityCode})? Active asset assignments must be returned first.`,
      confirmLabel: `Delete ${entity.entityType}`,
      danger: true,
      onConfirm: () => {
        void (async () => {
          try {
            await apiClient.deleteEntity(entity.id);
            await syncWorkspaceFromApi();
            showToast(`${entity.entityType} removed`, 'info');
          } catch (err) {
            showToast(
              err instanceof ApiError ? err.message : `Failed to delete ${entity.entityType}`,
              'error'
            );
          } finally {
            setActiveModal(null);
          }
        })();
      },
    });
  };

  const handleReturnSubmit = async (payload: {
    assetId: string;
    employeeId: string;
    date: string;
    condition: Asset['condition'];
    damage: 'No Damage' | 'Minor Damage' | 'Major Damage';
    remarks: string;
  }) => {
    try {
      await apiClient.returnAsset(payload);
      await syncWorkspaceFromApi();
      showToast('Asset returned successfully');
      setActiveModal(null);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Failed to return asset', 'error');
    }
  };

  const handleTransferSubmit = async (payload: {
    assetId: string;
    currentEmployeeId: string;
    newEmployeeId: string;
    date: string;
    newLocation: string;
    reason: string;
    remarks: string;
  }) => {
    const newEmp = (apiEmployees ?? state.employees).find((e) => e.id === payload.newEmployeeId);
    try {
      await apiClient.transferAsset(payload);
      await syncWorkspaceFromApi();
      showToast(`Asset transferred to ${newEmp?.name || 'employee'}`);
      setActiveModal(null);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Failed to transfer asset', 'error');
    }
  };

  const handleSaveMaintenance = async (
    payload: Omit<AssetOSState['maintenance'][number], 'id'> & { id?: string }
  ) => {
    try {
      await apiClient.saveMaintenance(payload);
      await syncWorkspaceFromApi();
      showToast(payload.id ? 'Maintenance record updated' : 'Maintenance service logged');
      setActiveModal(null);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Failed to save maintenance', 'error');
    }
  };

  const handleDisposalSubmit = async (payload: {
    assetId: string;
    disposalDate: string;
    salvageRecovered: number;
    reason: string;
    notes: string;
  }) => {
    try {
      await apiClient.disposeAsset(payload);
      await syncWorkspaceFromApi();
      showToast('Asset marked as Disposed', 'info');
      setActiveModal(null);
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Failed to dispose asset', 'error');
    }
  };

  const handleSaveRolePermissions = async (
    roleId: string,
    permissions: PermissionName[]
  ): Promise<boolean> => {
    try {
      await apiClient.updateRolePermissions(roleId, permissions);
      await refreshRbacData();
      showToast('Role permissions updated in database');
      return true;
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Failed to update role permissions', 'error');
      return false;
    }
  };

  const handleSaveUserModal = async (input: RbacUserFormPayload) => {
    try {
      if (activeModal?.type === 'user' && activeModal.userId) {
        await apiClient.updateUser(activeModal.userId, {
          loginId: input.loginId,
          password: input.password || undefined,
          fullName: input.fullName,
          email: input.email,
          roleId: input.roleId,
          employeeId: input.employeeId,
          department: input.department,
          active: input.active,
          customPermissions: input.customPermissions,
        });
        showToast('System user & permissions updated');
      } else {
        await apiClient.createUser({
          loginId: input.loginId,
          password: input.password,
          fullName: input.fullName,
          email: input.email,
          roleId: input.roleId,
          employeeId: input.employeeId,
          department: input.department,
          active: input.active,
          customPermissions: input.customPermissions,
        });
        showToast('System user & permissions created');
      }
      await refreshRbacData();
      setActiveModal(null);
      return { ok: true as const };
    } catch (err) {
      if (err instanceof ApiError && err.errors) {
        return { ok: false as const, errors: err.errors };
      }
      return {
        ok: false as const,
        errors: {
          form: err instanceof ApiError ? err.message : 'Failed to save user',
        },
      };
    }
  };

  if (authLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-[#1c1c1e] text-xs text-slate-300">
        Verifying session...
      </div>
    );
  }

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (forgotSubmitting || !forgotIdentifier.trim()) return;
    setForgotSubmitting(true);
    try {
      const res = await apiClient.forgotPassword(forgotIdentifier.trim());
      showToast(res.message, 'info');
      setForgotModalOpen(false);
      setForgotIdentifier('');
    } catch (err) {
      showToast(
        err instanceof ApiError ? err.message : 'Unable to process password reset request',
        'error'
      );
    } finally {
      setForgotSubmitting(false);
    }
  };

  if (!session) {
    return (
      <>
        <ToastContainer toasts={toasts} />
        <LoginScreen
          onSuccess={handleLoginSuccess}
          onForgotPassword={() => {
            setForgotIdentifier('');
            setForgotModalOpen(true);
          }}
        />
        {forgotModalOpen && (
          <ModalShell
            title="Reset Account Password"
            icon={<span className="text-xs font-bold text-amber-300">PW</span>}
            headerClass="bg-[#3f3f46]"
            maxWidth="max-w-sm"
            onClose={() => setForgotModalOpen(false)}
          >
            <form onSubmit={handleForgotSubmit} className="p-5 space-y-4 bg-white">
              <p className="text-xs text-slate-600">
                Enter your Login ID or registered Email address. If an active account exists, a
                temporary password email will be sent to your inbox.
              </p>
              <div>
                <label
                  htmlFor="forgot-identifier"
                  className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
                >
                  Login ID or Email *
                </label>
                <input
                  id="forgot-identifier"
                  type="text"
                  required
                  value={forgotIdentifier}
                  onChange={(e) => setForgotIdentifier(e.target.value)}
                  placeholder="e.g. rahim or rahim@medianresearch.com"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setForgotModalOpen(false)}
                  className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={forgotSubmitting}
                  className="px-4 py-2 bg-[#3f3f46] hover:bg-[#27272a] text-white rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  {forgotSubmitting ? 'Sending...' : 'Send Reset Email'}
                </button>
              </div>
            </form>
          </ModalShell>
        )}
      </>
    );
  }

  const returnToAllowed = () => handleNavigate('dashboard');

  return (
    <div className="h-full w-full flex overflow-hidden bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100">
      <ToastContainer toasts={toasts} />

      <Sidebar
        activeTab={activeTab}
        onSelectTab={(tab) => handleNavigate(tab)}
        theme={activeTheme}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
      />

      <div className="flex-1 flex flex-col min-w-0 bg-slate-50 dark:bg-slate-950 overflow-hidden">
        <Header
          globalSearch={globalSearch}
          onGlobalSearchChange={handleGlobalSearch}
          maintenance={isSelfServiceUser ? scopedEmployeeData?.maintenance || [] : state.maintenance}
          assets={
            isSelfServiceUser
              ? scopedEmployeeData?.ownedAssets.map((o) => o.asset) || []
              : state.assets
          }
          companyName={state.settings.companyName}
          onNavigate={(tab) => handleNavigate(tab)}
          onOpenMobileNav={() => setMobileNavOpen(true)}
          onOpenTicketModal={canRaiseTicket ? () => setActiveModal({ type: 'ticket' }) : undefined}
          onLogout={handleLogout}
        />

        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          {activeTab === 'dashboard' && (
            <>
              {isSelfServiceUser && scopedEmployeeData ? (
                <EmployeeDashboardView
                  scopedData={scopedEmployeeData}
                  employees={apiEmployees ?? state.employees}
                  entities={state.entities || []}
                  assets={state.assets}
                  assignments={state.assignments}
                  onNavigate={(tab) => handleNavigate(tab)}
                  onOpenPolicy={(category) => {
                    setSelectedPolicyCategory(category);
                    handleNavigate('policies');
                  }}
                  onRaiseTicket={(assetId) =>
                    setActiveModal({ type: 'ticket', preselectedAssetId: assetId })
                  }
                  onSubAssign={(assetId, parentAssignmentId) =>
                    setActiveModal({
                      type: 'sub-assign',
                      preselectedAssetId: assetId,
                      preselectedParentAssignmentId: parentAssignmentId,
                    })
                  }
                  onReturnSubAssign={handleReturnSubAssignment}
                />
              ) : isAssetOpsRole ? (
                <DashboardView
                  state={effectiveState}
                  userName={currentUser}
                  onNavigate={handleNavigate}
                  onOpenModal={setActiveModal}
                />
              ) : hasPermission('attendance.view') ? (
                <AttendanceView
                  theme={activeTheme}
                  centers={centers}
                  onMailStatus={setMailPopup}
                  onNotify={showToast}
                />
              ) : hasPermission('employee.view') ? (
                <EmployeesView
                  state={effectiveState}
                  employeesOverride={apiEmployees ?? state.employees}
                  isAdmin={isSuperAdmin}
                  canCreate={hasPermission('employee.create')}
                  canEdit={hasPermission('employee.edit')}
                  canDelete={hasPermission('employee.delete')}
                  onOpenModal={setActiveModal}
                  onDeleteEmployee={handleDeleteEmployee}
                  onImportEmployeesCSV={handleImportEmployeesCSV}
                  onRefreshEmployees={syncEmployeesFromApi}
                  onMailStatus={setMailPopup}
                  onNotify={showToast}
                />
              ) : (
                <AccessDeniedCard
                  roleName={session.role}
                  requiredDetail="No dashboard module assigned to this account"
                />
              )}
            </>
          )}

          {activeTab === 'my-assets' && (
            <RequireRole
              roles={[
                'Employee',
                'Manager',
                'Department Manager',
                'Consultant',
                'Retainer',
                'Freelancer',
                'Young Research Program',
                'Intern',
              ]}
              showForbiddenFallback
              onUnauthorized={returnToAllowed}
            >
              {scopedEmployeeData && (
                <MyAssetsView
                  key={globalSearch}
                  scopedData={scopedEmployeeData}
                  employees={apiEmployees ?? state.employees}
                  entities={state.entities || []}
                  assets={state.assets}
                  assignments={state.assignments}
                  initialSearch={globalSearch}
                  onRaiseTicket={(assetId) =>
                    setActiveModal({ type: 'ticket', preselectedAssetId: assetId })
                  }
                  onSubAssign={(assetId, parentAssignmentId) =>
                    setActiveModal({
                      type: 'sub-assign',
                      preselectedAssetId: assetId,
                      preselectedParentAssignmentId: parentAssignmentId,
                    })
                  }
                  onReturnSubAssign={handleReturnSubAssignment}
                />
              )}
            </RequireRole>
          )}

          {activeTab === 'my-tickets' && (
            <RequireRole
              roles={[
                'Employee',
                'Manager',
                'Department Manager',
                'Consultant',
                'Retainer',
                'Freelancer',
                'Young Research Program',
                'Intern',
              ]}
              showForbiddenFallback
              onUnauthorized={returnToAllowed}
            >
              {scopedEmployeeData && (
                <MyTicketsView
                  scopedData={scopedEmployeeData}
                  onRaiseTicket={() => setActiveModal({ type: 'ticket' })}
                  onConfirmWorkOrder={(ticket) => void handleConfirmWorkOrder(ticket)}
                  onCloseTicket={(ticket) => void handleCloseTicket(ticket)}
                  onSendTicketMail={(ticket) => void handleSendTicketMail(ticket)}
                  onCancelTicket={(ticket) => {
                    const res = cancelOwnOpenTicket({ ticket, session });
                    if (!res.ok) {
                      showToast(res.error, 'error');
                      return;
                    }
                    setState((prev) => ({
                      ...prev,
                      tickets: prev.tickets.map((t) =>
                        t.id === res.ticket.id ? res.ticket : t
                      ),
                    }));
                    void apiClient
                      .updateTicket(res.ticket.id, res.ticket)
                      .then(() => syncWorkspaceFromApi())
                      .catch(() => undefined);
                    showToast('Ticket cancelled', 'info');
                  }}
                />
              )}
            </RequireRole>
          )}

          {activeTab === 'policies' && (
            <PoliciesView
              theme={activeTheme}
              initialCategory={selectedPolicyCategory}
              onNotify={showToast}
            />
          )}

          {activeTab === 'team-members' &&
            (canAccessTeamMembers ? (
              <TeamMembersView
                theme={activeTheme}
                onNotify={showToast}
                onTeamUpdated={() => void syncWorkspaceFromApi()}
              />
            ) : (
              <AccessDeniedCard
                roleName={session.role}
                requiredDetail="Manager or Administrator access"
                onReturnAllowed={returnToAllowed}
              />
            ))}

          {activeTab === 'profile' && (
            <RequireRole
              roles={[
                'Employee',
                'Consultant',
                'Retainer',
                'Freelancer',
                'Young Research Program',
                'Intern',
              ]}
              showForbiddenFallback
              onUnauthorized={returnToAllowed}
            >
              {scopedEmployeeData && (
                <EmployeeProfileView
                  scopedData={scopedEmployeeData}
                  centers={centers}
                  onNotify={showToast}
                />
              )}
            </RequireRole>
          )}

          {activeTab === 'inventory' && (
            <RequireRole
              roles={['Super Admin', 'Administrator', 'Manager', 'Auditor']}
              showForbiddenFallback
              onUnauthorized={returnToAllowed}
            >
              <InventoryView
                key={`${inventoryStatusFilter}-${globalSearch}`}
                assets={state.assets}
                assignments={state.assignments}
                employees={apiEmployees ?? state.employees}
                entities={state.entities || []}
                currency={state.settings.currency}
                theme={activeTheme}
                initialStatusFilter={inventoryStatusFilter}
                initialSearchQuery={globalSearch}
                selectionResetToken={batchResetToken}
                canWrite={session.role !== 'Auditor'}
                onOpenModal={setActiveModal}
                onDeleteAsset={handleDeleteAsset}
                onImportCSV={handleImportAssetsCSV}
              />
            </RequireRole>
          )}

          {activeTab === 'assignments' && (
            <RequireRole
              roles={['Super Admin', 'Administrator', 'Manager', 'Auditor']}
              showForbiddenFallback
              onUnauthorized={returnToAllowed}
            >
              <AssignmentsView
                state={effectiveState}
                onOpenModal={setActiveModal}
                onReturnSubAssignment={(asn) => {
                  const asset = state.assets.find((a) => a.id === asn.assetId);
                  handleReturnSubAssignment(asn.id, asset?.name || asn.assetId);
                }}
                onDeleteAssignment={(asn) =>
                  setActiveModal({
                    type: 'confirm',
                    title: 'Delete Assignment',
                    message: `Remove assignment record ${asn.id}?`,
                    confirmLabel: 'Delete',
                    danger: true,
                    onConfirm: () => {
                      void (async () => {
                        try {
                          await apiClient.deleteAssignment(asn.id);
                          await syncWorkspaceFromApi();
                          showToast('Assignment removed', 'info');
                        } catch (err) {
                          showToast(err instanceof ApiError ? err.message : 'Failed to remove assignment', 'error');
                        } finally {
                          setActiveModal(null);
                        }
                      })();
                    },
                  })
                }
              />
            </RequireRole>
          )}

          {activeTab === 'returns' && (
            <RequireRole
              roles={['Super Admin', 'Administrator', 'Manager', 'Auditor']}
              showForbiddenFallback
              onUnauthorized={returnToAllowed}
            >
              <ReturnsView
                state={effectiveState}
                onOpenModal={setActiveModal}
                onDeleteReturn={(ret) =>
                  setActiveModal({
                    type: 'confirm',
                    title: 'Delete Return Record',
                    message: `Remove return record ${ret.id}?`,
                    confirmLabel: 'Delete',
                    danger: true,
                    onConfirm: () => {
                      void (async () => {
                        try {
                          await apiClient.deleteReturn(ret.id);
                          await syncWorkspaceFromApi();
                          showToast('Return record removed', 'info');
                        } catch (err) {
                          showToast(err instanceof ApiError ? err.message : 'Failed to remove return record', 'error');
                        } finally {
                          setActiveModal(null);
                        }
                      })();
                    },
                  })
                }
              />
            </RequireRole>
          )}

          {activeTab === 'transfers' && (
            <RequireRole
              roles={['Super Admin', 'Administrator', 'Manager', 'Auditor']}
              showForbiddenFallback
              onUnauthorized={returnToAllowed}
            >
              <TransfersView
                state={effectiveState}
                onOpenModal={setActiveModal}
                onDeleteTransfer={(trf) =>
                  setActiveModal({
                    type: 'confirm',
                    title: 'Delete Transfer Record',
                    message: `Remove transfer record ${trf.id}?`,
                    confirmLabel: 'Delete',
                    danger: true,
                    onConfirm: () => {
                      void (async () => {
                        try {
                          await apiClient.deleteTransfer(trf.id);
                          await syncWorkspaceFromApi();
                          showToast('Transfer record removed', 'info');
                        } catch (err) {
                          showToast(err instanceof ApiError ? err.message : 'Failed to remove transfer record', 'error');
                        } finally {
                          setActiveModal(null);
                        }
                      })();
                    },
                  })
                }
              />
            </RequireRole>
          )}

          {activeTab === 'maintenance' && (
            <RequireRole
              roles={['Super Admin', 'Administrator', 'Manager', 'Auditor']}
              showForbiddenFallback
              onUnauthorized={returnToAllowed}
            >
              <MaintenanceView
                state={effectiveState}
                onOpenModal={setActiveModal}
                onCompleteMaintenance={(m) => {
                  void (async () => {
                    try {
                      await apiClient.saveMaintenance({ ...m, status: 'Completed' });
                      await syncWorkspaceFromApi();
                      showToast(`Maintenance ${m.id} marked Completed`);
                    } catch (err) {
                      showToast(err instanceof ApiError ? err.message : 'Failed to update maintenance', 'error');
                    }
                  })();
                }}
                onDeleteMaintenance={(m) =>
                  setActiveModal({
                    type: 'confirm',
                    title: 'Delete Maintenance Record',
                    message: `Remove maintenance record ${m.id}?`,
                    confirmLabel: 'Delete',
                    danger: true,
                    onConfirm: () => {
                      void (async () => {
                        try {
                          await apiClient.deleteMaintenance(m.id);
                          await syncWorkspaceFromApi();
                          showToast('Maintenance record removed', 'info');
                        } catch (err) {
                          showToast(err instanceof ApiError ? err.message : 'Failed to remove maintenance record', 'error');
                        } finally {
                          setActiveModal(null);
                        }
                      })();
                    },
                  })
                }
              />
            </RequireRole>
          )}

          {activeTab === 'disposals' && (
            <RequireRole
              roles={['Super Admin', 'Administrator', 'Manager', 'Auditor']}
              showForbiddenFallback
              onUnauthorized={returnToAllowed}
            >
              <DisposalView state={effectiveState} onOpenModal={setActiveModal} />
            </RequireRole>
          )}

          {activeTab === 'employees' && (
            <RequirePermission permission="employee.view" onReturnAllowed={returnToAllowed}>
              <EmployeesView
                state={effectiveState}
                employeesOverride={apiEmployees ?? state.employees}
                isAdmin={isSuperAdmin}
                canCreate={hasPermission('employee.create')}
                canEdit={hasPermission('employee.edit')}
                canDelete={hasPermission('employee.delete')}
                onOpenModal={setActiveModal}
                onDeleteEmployee={handleDeleteEmployee}
                onImportEmployeesCSV={handleImportEmployeesCSV}
                onRefreshEmployees={syncEmployeesFromApi}
                onMailStatus={setMailPopup}
                onNotify={showToast}
              />
            </RequirePermission>
          )}

          {TAB_TO_ENTITY_TYPE[activeTab] &&
            (hasPermission('employee.view') || isAssetOpsRole ? (
              <PersonnelModulesView
                entityType={TAB_TO_ENTITY_TYPE[activeTab]!}
                state={effectiveState}
                isAdmin={isSuperAdmin}
                canWrite={isSuperAdmin || hasPermission('employee.edit') || hasPermission('employee.create')}
                onOpenModal={setActiveModal}
                onToggleConsultantManager={handleToggleConsultantManager}
                onDeleteEntity={handleDeleteEntity}
                onImportEntitiesCSV={handleImportEntitiesCSV}
              />
            ) : (
              <AccessDeniedCard
                roleName={session.role}
                requiredDetail="Employee or Asset Operations access"
                onReturnAllowed={returnToAllowed}
              />
            ))}

          {activeTab === 'attendance' && (
            <RequirePermission permission="attendance.view" onReturnAllowed={returnToAllowed}>
              <AttendanceView
                theme={activeTheme}
                centers={centers}
                onMailStatus={setMailPopup}
                onNotify={showToast}
              />
            </RequirePermission>
          )}

          {activeTab === 'vendors' && (
            <RequireRole
              roles={['Super Admin', 'Administrator', 'Manager', 'Auditor']}
              showForbiddenFallback
              onUnauthorized={returnToAllowed}
            >
              <VendorsView
                state={effectiveState}
                onOpenModal={setActiveModal}
                onImportVendorsCSV={handleImportVendorsCSV}
                onDeleteVendor={(v) =>
                  setActiveModal({
                    type: 'confirm',
                    title: 'Delete Vendor',
                    message: `Remove vendor "${v.name}" (${v.id})?`,
                    confirmLabel: 'Delete',
                    danger: true,
                    onConfirm: () => {
                      void (async () => {
                        try {
                          await apiClient.deleteVendor(v.id);
                          await syncWorkspaceFromApi();
                          showToast('Vendor deleted', 'info');
                        } catch (err) {
                          showToast(err instanceof ApiError ? err.message : 'Failed to delete vendor', 'error');
                        } finally {
                          setActiveModal(null);
                        }
                      })();
                    },
                  })
                }
              />
            </RequireRole>
          )}

          {activeTab === 'expenses' && (
            <RequireRole
              roles={['Super Admin', 'Administrator', 'Manager', 'Auditor']}
              showForbiddenFallback
              onUnauthorized={returnToAllowed}
            >
              <ExpensesView
                state={effectiveState}
                onOpenModal={setActiveModal}
                onRefreshMasters={syncWorkspaceFromApi}
                onNotify={showToast}
                onDeleteExpense={(exp) =>
                  setActiveModal({
                    type: 'confirm',
                    title: 'Delete Expense',
                    message: `Remove expense ${exp.id}?`,
                    confirmLabel: 'Delete',
                    danger: true,
                    onConfirm: () => {
                      void (async () => {
                        try {
                          await apiClient.deleteExpense(exp.id);
                          await syncWorkspaceFromApi();
                          showToast('Expense removed', 'info');
                        } catch (err) {
                          showToast(err instanceof ApiError ? err.message : 'Failed to delete expense', 'error');
                        } finally {
                          setActiveModal(null);
                        }
                      })();
                    },
                  })
                }
              />
            </RequireRole>
          )}

          {activeTab === 'reports' && (
            <>
              {isAssetOpsRole ? (
                <ReportsView state={effectiveState} />
              ) : hasPermission('attendance.report') ? (
                <AttendanceView
                  theme={activeTheme}
                  centers={centers}
                  initialSubTab="daily-report"
                  onMailStatus={setMailPopup}
                  onNotify={showToast}
                />
              ) : (
                <AccessDeniedCard
                  roleName={session.role}
                  requiredDetail="attendance.report"
                  onReturnAllowed={returnToAllowed}
                />
              )}
            </>
          )}

          {activeTab === 'tickets' && (
            <RequireRole
              roles={['Super Admin', 'Administrator']}
              showForbiddenFallback
              onUnauthorized={returnToAllowed}
            >
              <SupportTicketsView
                state={effectiveState}
                onUpdateTicket={(updated) => {
                  setState((prev) => ({
                    ...prev,
                    tickets: prev.tickets.map((t) => (t.id === updated.id ? updated : t)),
                  }));
                  void apiClient
                    .updateTicket(updated.id, updated)
                    .then(() => syncWorkspaceFromApi())
                    .catch((err) =>
                      showToast(err instanceof ApiError ? err.message : 'Failed to update ticket', 'error')
                    );
                }}
                onReorderTickets={handleReorderTickets}
                onScheduleWorkOrder={handleScheduleWorkOrder}
                onCloseTicket={handleCloseTicket}
                onSendTicketMail={handleSendTicketMail}
                onNotify={showToast}
              />
            </RequireRole>
          )}

          {activeTab === 'mail' && (
            <RequirePermission
              anyOf={['role.manage', 'attendance.report', 'user.view']}
              onReturnAllowed={returnToAllowed}
            >
              <MailDashboardView
                theme={activeTheme}
                onMailStatus={setMailPopup}
                onNotify={showToast}
              />
            </RequirePermission>
          )}

          {activeTab === 'settings' && (
            <RequirePermission
              anyOf={['user.view', 'user.create', 'user.edit', 'user.delete', 'role.manage']}
              onReturnAllowed={returnToAllowed}
            >
              <SettingsView
                state={effectiveState}
                centers={centers}
                onCentersUpdated={() => void syncWorkspaceFromApi()}
                onNotify={showToast}
                onSaveSettings={(settings) => {
                  void (async () => {
                    try {
                      await apiClient.updateWorkspaceSettings({ settings });
                      await syncWorkspaceFromApi();
                      showToast('Company profile saved to SQLite');
                    } catch (err) {
                      showToast(err instanceof ApiError ? err.message : 'Failed to save settings', 'error');
                    }
                  })();
                }}
                onSelectTheme={(theme) => {
                  const nextSettings = { ...state.settings, theme };
                  setState((prev) => ({ ...prev, settings: nextSettings }));
                  void setThemePreference(theme, true);
                  void apiClient
                    .updateWorkspaceSettings({ settings: nextSettings })
                    .then(() => syncWorkspaceFromApi())
                    .catch(() => undefined);
                  showToast(`Theme updated to ${theme}`);
                }}
                onOpenModal={setActiveModal}
                onSaveRolePermissions={handleSaveRolePermissions}
                onResetUserPassword={(u) => {
                  void (async () => {
                    try {
                      const res = await apiClient.resetUserPassword(u.id);
                      showToast(res.message);
                    } catch (err) {
                      showToast(
                        err instanceof ApiError ? err.message : 'Failed to reset user password',
                        'error'
                      );
                    }
                  })();
                }}
                onDeleteUser={(u) =>
                  setActiveModal({
                    type: 'confirm',
                    title: 'Delete User',
                    message: `Remove user "${u.fullName}" (${u.loginId})?`,
                    confirmLabel: 'Delete',
                    danger: true,
                    onConfirm: () => {
                      void (async () => {
                        try {
                          await apiClient.deleteUser(u.id);
                          await refreshRbacData();
                          showToast('User removed', 'info');
                        } catch (err) {
                          showToast(
                            err instanceof ApiError ? err.message : 'Failed to delete user',
                            'error'
                          );
                        } finally {
                          setActiveModal(null);
                        }
                      })();
                    },
                  })
                }
                onExportBackup={async () => {
                  try {
                    const res = await apiClient.exportBackup();
                    const json = JSON.stringify(res.backup, null, 2);
                    const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `median-asset-hr-suite-backup-${new Date().toISOString().split('T')[0]}.json`;
                    link.click();
                    URL.revokeObjectURL(url);
                    showToast('Full enterprise backup exported');
                  } catch (err) {
                    showToast(err instanceof ApiError ? err.message : 'Failed to export backup', 'error');
                  }
                }}
                onRestoreBackup={async (jsonText, mode) => {
                  let parsed: Record<string, unknown>;
                  try {
                    const raw = JSON.parse(jsonText) as Record<string, unknown>;
                    parsed =
                      raw && typeof raw.backup === 'object' && raw.backup !== null
                        ? (raw.backup as Record<string, unknown>)
                        : raw;
                    if (!parsed || typeof parsed !== 'object') {
                      showToast('Invalid JSON backup file structure', 'error');
                      return;
                    }
                  } catch {
                    showToast('Could not parse JSON backup file', 'error');
                    return;
                  }

                  const runRestore = async () => {
                    try {
                      const res = await apiClient.restoreBackup(parsed, mode);
                      await Promise.all([syncWorkspaceFromApi(), refreshRbacData()]);
                      const empCount = res.restoredCounts.employees ?? 0;
                      const assetCount = res.restoredCounts.assets ?? 0;
                      showToast(`Backup restored (${mode}): ${empCount} employees, ${assetCount} assets`);
                    } catch (err) {
                      showToast(err instanceof ApiError ? err.message : 'Backup restore failed', 'error');
                    }
                  };

                  if (mode === 'replace') {
                    setActiveModal({
                      type: 'confirm',
                      title: 'Confirm Full Replace Restore',
                      message:
                        'Full Replace mode will replace current workspace tables (Assets, Employees, Operations, Settings) with the backup contents. System Audit Logs are preserved. Continue?',
                      confirmLabel: 'Restore (Full Replace)',
                      danger: true,
                      onConfirm: () => {
                        setActiveModal(null);
                        void runRestore();
                      },
                    });
                    return;
                  }

                  await runRestore();
                }}
                onResetAllData={() =>
                  setActiveModal({
                    type: 'confirm',
                    title: 'Clear Local Browser Cache',
                    message:
                      'This clears only the browser localStorage UI cache and reloads authoritative records from SQLite. Database employees and assets are never deleted.',
                    confirmLabel: 'Clear Cache & Reload',
                    danger: false,
                    onConfirm: () => {
                      localStorage.removeItem(STORAGE_KEY);
                      setActiveModal(null);
                      void syncWorkspaceFromApi();
                      showToast('Local cache cleared and synced from SQLite', 'info');
                    },
                  })
                }
              />
            </RequirePermission>
          )}
        </main>
      </div>

      {/* MODALS */}
      {activeModal?.type === 'asset' && (
        <AssetFormModal
          state={effectiveState}
          editingAsset={state.assets.find((a) => a.id === activeModal.assetId)}
          onClose={() => setActiveModal(null)}
          onSave={handleSaveAsset}
          onAddQuickOption={(kind, val) => {
            void (async () => {
              try {
                await apiClient.addWorkspaceOption(kind, val);
                await syncWorkspaceFromApi();
                showToast(`Added ${kind}: ${val}`);
              } catch (err) {
                showToast(err instanceof ApiError ? err.message : `Failed to add ${kind}`, 'error');
              }
            })();
          }}
        />
      )}

      {activeModal?.type === 'batch-asset-update' && (
        <BatchAssetUpdateModal
          state={effectiveState}
          assetIds={activeModal.assetIds}
          onClose={() => setActiveModal(null)}
          onSubmit={handleBatchAssetUpdate}
        />
      )}

      {activeModal?.type === 'assign' && (
        <AssignModal
          state={{ ...effectiveState, employees: apiEmployees ?? state.employees }}
          centers={centers}
          issuerName={currentUser || 'Administrator'}
          issuerEmpId={session.employeeId || session.entityId || session.id}
          preselectedAssetId={activeModal.preselectedAssetId}
          onClose={() => setActiveModal(null)}
          onSubmit={handleAssignSubmit}
        />
      )}

      {activeModal?.type === 'sub-assign' && (
        <SubAssignModal
          state={{ ...effectiveState, employees: apiEmployees ?? state.employees }}
          centers={centers}
          preselectedAssetId={activeModal.preselectedAssetId}
          preselectedParentAssignmentId={activeModal.preselectedParentAssignmentId}
          issuerName={currentUser || 'Primary Holder'}
          issuerEmpId={session.employeeId || session.entityId || session.id}
          onClose={() => setActiveModal(null)}
          onSubmit={handleSubAssignSubmit}
        />
      )}

      {activeModal?.type === 'return' && (
        <ReturnModal
          state={{ ...effectiveState, employees: apiEmployees ?? state.employees }}
          preselectedAssetId={activeModal.preselectedAssetId}
          preselectedEmployeeId={activeModal.preselectedEmployeeId}
          onClose={() => setActiveModal(null)}
          onSubmit={handleReturnSubmit}
        />
      )}

      {activeModal?.type === 'transfer' && (
        <TransferModal
          state={{ ...effectiveState, employees: apiEmployees ?? state.employees }}
          preselectedAssetId={activeModal.preselectedAssetId}
          preselectedEmployeeId={activeModal.preselectedEmployeeId}
          onClose={() => setActiveModal(null)}
          onSubmit={handleTransferSubmit}
        />
      )}

      {activeModal?.type === 'maintenance' && (
        <MaintenanceModal
          state={effectiveState}
          editingRecord={state.maintenance.find((m) => m.id === activeModal.maintenanceId)}
          onClose={() => setActiveModal(null)}
          onSave={handleSaveMaintenance}
        />
      )}

      {activeModal?.type === 'disposal' && (
        <DisposalModal
          state={effectiveState}
          onClose={() => setActiveModal(null)}
          onSubmit={handleDisposalSubmit}
        />
      )}

      {activeModal?.type === 'employee' && (
        <EmployeeFormModal
          state={{ ...effectiveState, employees: apiEmployees ?? state.employees }}
          centers={centers}
          editingEmployee={(apiEmployees ?? state.employees).find(
            (e) => e.id === activeModal.employeeId
          )}
          onDepartmentsUpdated={() => void syncWorkspaceFromApi()}
          onClose={() => setActiveModal(null)}
          onSave={async (payload) => {
            try {
              if (payload.id) {
                const res = await apiClient.updateEmployee(payload.id, payload);
                showToast('Employee updated');
                if (res.userAccountCreated) {
                  await refreshRbacData();
                }
              } else {
                await apiClient.createEmployee(payload);
                showToast('New employee added & login account created');
              }
              await syncEmployeesFromApi();
              setActiveModal(null);
            } catch (err) {
              showToast(
                err instanceof ApiError ? err.message : 'Failed to save employee',
                'error'
              );
              throw err;
            }
          }}
        />
      )}

      {activeModal?.type === 'employee-import-result' && (
        <EmployeeImportResultModal
          result={activeModal.result}
          theme={activeTheme}
          onClose={() => setActiveModal(null)}
        />
      )}

      {activeModal?.type === 'directory-import-result' && (
        <DirectoryImportResultModal
          result={activeModal.result}
          theme={activeTheme}
          onClose={() => setActiveModal(null)}
        />
      )}

      {activeModal?.type === 'convert-employment' && (
        <ConvertEmploymentModal
          state={effectiveState}
          sourceType={activeModal.sourceType}
          sourceId={activeModal.sourceId}
          sourceCode={activeModal.sourceCode}
          personName={activeModal.personName}
          onClose={() => setActiveModal(null)}
          onConvert={async (payload) => {
            try {
              const res = await apiClient.convertEmploymentType(payload);
              await Promise.all([syncWorkspaceFromApi(), refreshRbacData()]);
              showToast(
                `Converted ${activeModal.personName} from ${payload.sourceCategory} to ${payload.targetCategory} (${res.targetCode})`
              );
              setActiveModal(null);
            } catch (err) {
              showToast(
                err instanceof ApiError ? err.message : 'Employment conversion failed',
                'error'
              );
              throw err;
            }
          }}
        />
      )}

      {activeModal?.type === 'vendor' && (
        <VendorFormModal
          state={effectiveState}
          editingVendor={state.vendors.find((v) => v.id === activeModal.vendorId)}
          onClose={() => setActiveModal(null)}
          onSave={async (payload) => {
            const isEdit = Boolean(activeModal.vendorId);
            try {
              await apiClient.saveVendor(payload, isEdit);
              await syncWorkspaceFromApi();
              showToast(isEdit ? 'Vendor updated' : 'New vendor added');
              setActiveModal(null);
            } catch (err) {
              showToast(err instanceof ApiError ? err.message : 'Failed to save vendor', 'error');
              throw err;
            }
          }}
        />
      )}

      {activeModal?.type === 'expense' && (
        <ExpenseFormModal
          state={effectiveState}
          editingExpense={state.expenses.find((e) => e.id === activeModal.expenseId)}
          onClose={() => setActiveModal(null)}
          onSave={async (payload) => {
            const isEdit = Boolean(activeModal.expenseId);
            try {
              await apiClient.saveExpense(payload, isEdit);
              await syncWorkspaceFromApi();
              showToast(isEdit ? 'Expense updated' : 'Expense saved successfully');
              setActiveModal(null);
            } catch (err) {
              showToast(err instanceof ApiError ? err.message : 'Failed to save expense', 'error');
              throw err;
            }
          }}
        />
      )}

      {activeModal?.type === 'entity' && (
        <PersonnelEntityModal
          entityType={activeModal.entityType}
          state={{ ...effectiveState, employees: apiEmployees ?? state.employees }}
          centers={centers}
          editingEntity={(state.entities || []).find((e) => e.id === activeModal.entityId)}
          onClose={() => setActiveModal(null)}
          onSave={async (payload) => {
            try {
              if (payload.id) {
                const res = await apiClient.updateEntity(payload.id, payload);
                showToast(`${activeModal.entityType} updated`);
                if (res.userAccountCreated) {
                  await refreshRbacData();
                }
              } else {
                await apiClient.createEntity(payload);
                showToast(`${activeModal.entityType} registered`);
              }
              await syncWorkspaceFromApi();
              setActiveModal(null);
            } catch (err) {
              showToast(
                err instanceof ApiError ? err.message : `Failed to save ${activeModal.entityType}`,
                'error'
              );
              throw err;
            }
          }}
        />
      )}

      {activeModal?.type === 'freelancer' && (
        <FreelancerFormModal
          state={{ ...effectiveState, employees: apiEmployees ?? state.employees }}
          centers={centers}
          editingEntity={(state.entities || []).find((e) => e.id === activeModal.entityId)}
          onDepartmentsUpdated={() => void syncWorkspaceFromApi()}
          onClose={() => setActiveModal(null)}
          onSave={async (payload) => {
            try {
              if (payload.id) {
                const res = await apiClient.updateEntity(payload.id, payload);
                showToast('Freelancer updated');
                if (res.userAccountCreated) {
                  await refreshRbacData();
                }
              } else {
                await apiClient.createEntity(payload);
                showToast('Freelancer onboarded');
              }
              await syncWorkspaceFromApi();
              setActiveModal(null);
            } catch (err) {
              showToast(
                err instanceof ApiError ? err.message : 'Failed to save freelancer',
                'error'
              );
              throw err;
            }
          }}
        />
      )}

      {activeModal?.type === 'freelancer-allotment-print' && (() => {
        const allotment = (state.freelancerAllotments || []).find(
          (al) =>
            (activeModal.allotmentId && al.id === activeModal.allotmentId) ||
            (activeModal.assignmentId && al.assignmentId === activeModal.assignmentId)
        );
        if (!allotment) return null;
        return (
          <FreelancerAllotmentPrintModal
            allotment={allotment}
            assets={state.assets}
            centers={centers}
            onClose={() => setActiveModal(null)}
          />
        );
      })()}

      {activeModal?.type === 'ticket' && (
        <RequireRole
          roles={[
            'Employee',
            'Manager',
            'Department Manager',
            'Consultant',
            'Retainer',
            'Freelancer',
            'Young Research Program',
            'Intern',
          ]}
          onUnauthorized={() => setActiveModal(null)}
        >
          {scopedEmployeeData && (
            <TicketModal
              scopedData={scopedEmployeeData}
              existingTickets={state.tickets}
              theme={activeTheme}
              preselectedAssetId={activeModal.preselectedAssetId}
              onClose={() => setActiveModal(null)}
              onSubmitTicket={async (input) => {
                try {
                  const res = await apiClient.createTicket({
                    assetId: input.assetId,
                    subject: input.subject,
                    description: input.description,
                    priority: input.priority || 'Medium',
                    requestedDate: input.requestedDate,
                    requestedStartTime: input.requestedStartTime,
                    requestedDurationMins: input.requestedDurationMins,
                  });
                  await syncWorkspaceFromApi();
                  showToast('Support ticket raised (FCFS queue)');
                  setActiveModal(null);
                  handleNavigate('my-tickets');
                  return { ok: true, ticket: res.ticket };
                } catch (err) {
                  const msg = err instanceof ApiError ? err.message : 'Failed to submit ticket';
                  showToast(msg, 'error');
                  return { ok: false, errors: { form: msg } };
                }
              }}
            />
          )}
        </RequireRole>
      )}

      {activeModal?.type === 'user' && (
        <RequirePermission
          anyOf={activeModal.userId ? ['user.edit'] : ['user.create']}
          onReturnAllowed={() => setActiveModal(null)}
        >
          <UserFormModal
            state={{ ...effectiveState, employees: apiEmployees ?? state.employees }}
            users={users}
            roles={roles}
            editingUser={activeModal.userId ? users.find((u) => u.id === activeModal.userId) : undefined}
            onClose={() => setActiveModal(null)}
            onSave={handleSaveUserModal}
          />
        </RequirePermission>
      )}

      {activeModal?.type === 'history' && (
        <AssetHistoryModal
          state={effectiveState}
          assetId={activeModal.assetId}
          onClose={() => setActiveModal(null)}
        />
      )}

      {activeModal?.type === 'employee-statement' && (
        <EmployeeStatementModal
          state={{ ...effectiveState, employees: apiEmployees ?? state.employees }}
          employeeId={activeModal.employeeId}
          onClose={() => setActiveModal(null)}
        />
      )}

      {activeModal?.type === 'confirm' && (
        <ConfirmModal
          title={activeModal.title}
          message={activeModal.message}
          confirmLabel={activeModal.confirmLabel}
          danger={activeModal.danger}
          onCancel={() => setActiveModal(null)}
          onConfirm={activeModal.onConfirm}
        />
      )}

      {mailPopup && (
        <MailStatusPopupModal
          ok={mailPopup.ok}
          title={mailPopup.title}
          details={mailPopup.details}
          theme={activeTheme}
          onClose={() => setMailPopup(null)}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <AppContent />
    </SessionProvider>
  );
}
