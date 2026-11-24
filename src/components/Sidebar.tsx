import React from 'react';
import {
  ArrowLeftRight,
  Banknote,
  BarChart3,
  Award,
  BookOpen,
  Briefcase,
  CalendarClock,
  GraduationCap,
  Handshake,
  Laptop,
  LifeBuoy,
  Mail,
  PieChart,
  RotateCcw,
  Settings,
  Store,
  Trash2,
  UserCheck,
  UserCircle,
  UserCog,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import type { NavTab, ThemePalette } from '../types/asset';
import { THEME_PALETTES } from '../utils/assetMath';
import { useSession } from '../auth/SessionContext';
import { isSelfServiceEntityRole } from '../utils/ticketLogic';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  theme: ThemePalette;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

interface NavItem {
  id: NavTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

const ASSET_NAV: NavItem[] = [
  { id: 'inventory', label: 'Asset Entry', icon: Laptop },
  { id: 'assignments', label: 'Asset Assignment', icon: Handshake },
  { id: 'returns', label: 'Asset Return', icon: RotateCcw },
  { id: 'transfers', label: 'Asset Transfer', icon: ArrowLeftRight },
  { id: 'maintenance', label: 'Asset Maintenance', icon: Wrench },
  { id: 'disposals', label: 'Asset Disposal', icon: Trash2 },
];

const EMPLOYEE_PORTAL_NAV: NavItem[] = [
  { id: 'dashboard', label: 'My Dashboard', icon: PieChart },
  { id: 'my-assets', label: 'My Assets', icon: Laptop },
  { id: 'my-tickets', label: 'My Tickets', icon: LifeBuoy },
  { id: 'policies', label: 'Policies', icon: BookOpen },
  { id: 'profile', label: 'Profile', icon: UserCircle },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onSelectTab,
  theme,
  mobileOpen,
  onCloseMobile,
}) => {
  const { session, hasPermission, hasAnyPermission } = useSession();
  const palette = THEME_PALETTES[theme];

  const isSuperAdmin =
    session?.role === 'Super Admin' || session?.role === 'Administrator';
  const isEmployee = isSelfServiceEntityRole(session?.role);
  const isDesignatedManager =
    Boolean(session?.isManager) ||
    session?.role === 'Department Manager' ||
    session?.role === 'Manager';
  const isAssetOpsRole =
    isSuperAdmin || session?.role === 'Manager' || session?.role === 'Auditor';

  const canViewEmployees = hasPermission('employee.view');
  const canViewAttendance = hasPermission('attendance.view');
  const canViewReports =
    hasPermission('attendance.report') || isAssetOpsRole;
  const canAccessUserOrRoleMgmt =
    isSuperAdmin ||
    hasAnyPermission([
      'user.view',
      'user.create',
      'user.edit',
      'user.delete',
      'role.manage',
    ]);

  const handleNavClick = (tab: NavTab) => {
    onSelectTab(tab);
    onCloseMobile();
  };

  const renderLink = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = activeTab === item.id;
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => handleNavClick(item.id)}
        aria-current={isActive ? 'page' : undefined}
        className={`w-full flex items-center px-3 py-2.5 text-xs font-medium rounded-lg text-left cursor-pointer whitespace-nowrap ${
          isActive
            ? `${palette.sidebarActive} shadow-sm`
            : 'text-slate-300 hover:bg-white/10 hover:text-white'
        }`}
      >
        <Icon className={`w-4 h-4 mr-3 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
        <span className="truncate">{item.label}</span>
      </button>
    );
  };

  const showEmployeeSection = canViewEmployees || canViewAttendance || isDesignatedManager || isSuperAdmin;

  const portalTitle = (() => {
    switch (session?.role) {
      case 'Consultant':
        return 'Consultant Portal';
      case 'Retainer':
        return 'Retainer Portal';
      case 'Freelancer':
        return 'Freelancer Portal';
      case 'Young Research Program':
        return 'Young Research Program Portal';
      case 'Intern':
        return 'Intern Portal';
      default:
        return 'Employee Portal';
    }
  })();

  const currentYear = new Date().getFullYear();

  const sidebarContent = (
    <aside className="w-64 bg-slate-900 dark:bg-slate-950 text-slate-300 flex flex-col shadow-xl h-full shrink-0 no-print border-r border-slate-800">
      {/* Brand Header */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-white/10 shrink-0">
        <div className="flex items-center space-x-2.5 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-white flex items-center justify-center p-0.5 shadow-lg shrink-0 overflow-hidden">
            <img
              src="/assets/aistudio/Median_logo_Final_Small__1__69ba70f6.jpg"
              alt="Median Research & Consulting Pvt Ltd"
              className="w-full h-full object-contain"
            />
          </div>
          <div className="min-w-0">
            <span className="text-white font-bold text-sm tracking-wide block leading-tight truncate">
              Median Suite
            </span>
            <span className="block text-[9px] text-slate-400 uppercase tracking-wider font-semibold truncate">
              Median Asset &amp; HR Suite
            </span>
          </div>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
          className="lg:hidden text-slate-400 hover:text-white p-1 rounded"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Dynamic RBAC Navigation */}
      <nav aria-label="Main navigation" className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {isEmployee ? (
          <>
            <div className="pt-1 pb-1 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              {portalTitle}
            </div>
            {EMPLOYEE_PORTAL_NAV.map(renderLink)}

            {(isDesignatedManager || canViewEmployees || canViewAttendance) && (
              <>
                <div className="pt-4 pb-1 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {isDesignatedManager ? 'Manager & Team' : 'Employee'}
                </div>
                {isDesignatedManager &&
                  renderLink({ id: 'team-members', label: 'Team Members', icon: UserCheck })}
                {canViewEmployees &&
                  renderLink({ id: 'employees', label: 'Employee', icon: Users })}
                {canViewAttendance &&
                  renderLink({
                    id: 'attendance',
                    label: 'Attendance Management',
                    icon: CalendarClock,
                  })}
              </>
            )}

            {(canViewReports || canAccessUserOrRoleMgmt) && (
              <>
                <div className="pt-4 pb-1 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Administration
                </div>
                {canViewReports &&
                  renderLink({ id: 'reports', label: 'Reports', icon: BarChart3 })}
                {canAccessUserOrRoleMgmt &&
                  renderLink({ id: 'settings', label: 'User Management', icon: Settings })}
              </>
            )}
          </>
        ) : (
          <>
            {renderLink({ id: 'dashboard', label: 'Dashboard', icon: PieChart })}

            {isAssetOpsRole && (
              <>
                <div className="pt-3 pb-1 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Assets
                </div>
                {ASSET_NAV.map(renderLink)}
              </>
            )}

            {(showEmployeeSection || isAssetOpsRole) && (
              <>
                <div className="pt-4 pb-1 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  People &amp; Modules
                </div>
                {canViewEmployees &&
                  renderLink({ id: 'employees', label: 'Employee', icon: Users })}
                {(canViewEmployees || isAssetOpsRole) && (
                  <>
                    {renderLink({ id: 'consultants', label: 'Consultants', icon: Briefcase })}
                    {renderLink({ id: 'retainers', label: 'Retainers', icon: UserCog })}
                    {renderLink({ id: 'freelancers', label: 'Freelancers', icon: Users })}
                    {renderLink({ id: 'yrp', label: 'Young Research Program', icon: Award })}
                    {renderLink({ id: 'interns', label: 'Interns', icon: GraduationCap })}
                  </>
                )}
                {(isSuperAdmin || isDesignatedManager) &&
                  renderLink({ id: 'team-members', label: 'Team Members', icon: UserCheck })}
                {canViewAttendance &&
                  renderLink({
                    id: 'attendance',
                    label: 'Attendance Management',
                    icon: CalendarClock,
                  })}
                {(isDesignatedManager || session?.role === 'Manager' || session?.role === 'Department Manager') &&
                  renderLink({ id: 'my-tickets', label: 'My Tickets', icon: LifeBuoy })}
                {renderLink({ id: 'policies', label: 'Policies', icon: BookOpen })}
              </>
            )}

            {(isAssetOpsRole || canViewReports || canAccessUserOrRoleMgmt) && (
              <>
                <div className="pt-4 pb-1 px-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Management
                </div>
                {isAssetOpsRole &&
                  renderLink({ id: 'vendors', label: 'Vendor', icon: Store })}
                {isAssetOpsRole &&
                  renderLink({ id: 'expenses', label: 'Expense', icon: Banknote })}
                {canViewReports &&
                  renderLink({ id: 'reports', label: 'Reports', icon: BarChart3 })}
                {canAccessUserOrRoleMgmt &&
                  renderLink({
                    id: 'settings',
                    label: isSuperAdmin ? 'Settings' : 'User Management',
                    icon: Settings,
                  })}
                {isSuperAdmin &&
                  renderLink({ id: 'tickets', label: 'Support Tickets', icon: LifeBuoy })}
                {(isSuperAdmin || hasAnyPermission(['role.manage', 'attendance.report', 'user.view'])) &&
                  renderLink({ id: 'mail', label: 'Email & Notifications', icon: Mail })}
              </>
            )}
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-white/10 text-center shrink-0">
        <p className="text-[10px] text-slate-400">
          Median Research &amp; Consulting Pvt Ltd · &copy; {currentYear}
        </p>
      </div>
    </aside>
  );

  return (
    <>
      <div className="hidden lg:block h-full shrink-0">{sidebarContent}</div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-[1px]"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{sidebarContent}</div>
        </div>
      )}
    </>
  );
};
