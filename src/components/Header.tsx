import React, { useState, useRef, useEffect } from 'react';
import { Bell, LifeBuoy, LogOut, Menu, Moon, Palette, Search, Sun, Wrench } from 'lucide-react';
import type { Asset, MaintenanceRecord, NavTab, ThemePalette } from '../types/asset';
import { useSession } from '../auth/SessionContext';
import { THEME_PALETTES } from '../utils/assetMath';
import { isSelfServiceEntityRole } from '../utils/ticketLogic';

interface HeaderProps {
  globalSearch: string;
  onGlobalSearchChange: (val: string) => void;
  maintenance: MaintenanceRecord[];
  assets: Asset[];
  companyName: string;
  onNavigate: (tab: NavTab) => void;
  onOpenMobileNav: () => void;
  onOpenTicketModal?: () => void;
  onLogout?: () => void;
}

const QUICK_THEMES: ThemePalette[] = [
  'Corporate Blue',
  'Emerald Green',
  'Royal Purple',
  'Dark Mode',
];

export const Header: React.FC<HeaderProps> = ({
  globalSearch,
  onGlobalSearchChange,
  maintenance,
  assets,
  companyName,
  onNavigate,
  onOpenMobileNav,
  onOpenTicketModal,
  onLogout,
}) => {
  const { session, logout, hasAnyPermission, theme, setThemePreference } = useSession();
  const userName = session?.fullName || 'User';
  const userRole = session?.role || '';
  const isEmployee = isSelfServiceEntityRole(session?.role);
  const canOpenSettings =
    session?.role === 'Super Admin' ||
    session?.role === 'Administrator' ||
    hasAnyPermission(['user.view', 'user.create', 'user.edit', 'user.delete', 'role.manage']);
  const handleLogoutClick = () => {
    if (onLogout) {
      onLogout();
    } else {
      void logout();
    }
  };
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const themeRef = useRef<HTMLDivElement>(null);

  const ownedAssetIds = new Set(assets.map((a) => a.id));
  const activeAlerts = maintenance.filter(
    (m) =>
      (m.status === 'In Progress' || m.status === 'Open') &&
      (!isEmployee || ownedAssetIds.has(m.assetId))
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setNotifOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setProfileOpen(false);
      }
      if (themeRef.current && !themeRef.current.contains(event.target as Node)) {
        setThemeMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const initials =
    userName
      .split(' ')
      .map((p) => p[0])
      .join('')
      .substring(0, 2)
      .toUpperCase() || 'AD';

  const portalLabel = (() => {
    switch (userRole) {
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
      case 'Employee':
        return 'Employee Portal';
      default:
        return companyName;
    }
  })();

  const palette = THEME_PALETTES[theme];

  return (
    <header className="h-16 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 md:px-6 z-30 shrink-0 no-print">
      <div className="flex items-center space-x-3">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Open navigation menu"
          className="lg:hidden p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="relative w-32 sm:w-64 md:w-80">
          <span className="absolute inset-y-0 left-0 flex items-center pl-2.5 pointer-events-none text-slate-400">
            <Search className="w-3.5 h-3.5" />
          </span>
          <input
            type="text"
            aria-label={isEmployee ? 'Search my assigned assets' : 'Quick search assets and employees'}
            value={globalSearch}
            onChange={(e) => onGlobalSearchChange(e.target.value)}
            placeholder={isEmployee ? 'Search assets...' : 'Search assets, staff...'}
            className="w-full pl-8 pr-2 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600 transition-all"
          />
        </div>
      </div>

      <div className="flex items-center space-x-2 sm:space-x-3 md:space-x-4 shrink-0">
        {onOpenTicketModal && (
          <button
            type="button"
            aria-label="Raise Ticket"
            onClick={onOpenTicketModal}
            className={`px-2.5 sm:px-3 py-1.5 ${palette.primaryBtn} ${palette.primaryBtnHover} rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer whitespace-nowrap`}
          >
            <LifeBuoy className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Raise Ticket</span>
          </button>
        )}

        <div className="hidden md:block text-right">
          <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            {portalLabel}
          </span>
        </div>

        {/* Theme Switcher */}
        <div className="relative" ref={themeRef}>
          <button
            type="button"
            aria-label="Switch theme"
            title={`Theme: ${theme}`}
            onClick={() => setThemeMenuOpen((prev) => !prev)}
            className="p-2 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
          >
            {theme === 'Dark Mode' ? <Moon className="w-4 h-4 text-sky-400" /> : <Palette className="w-4 h-4" />}
          </button>
          {themeMenuOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 z-50 overflow-hidden py-1.5">
              <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-100 dark:border-slate-800">
                Appearance Theme
              </div>
              {QUICK_THEMES.map((t) => {
                const active = theme === t;
                const swatch = THEME_PALETTES[t].swatchHex;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      void setThemePreference(t, true);
                      setThemeMenuOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between cursor-pointer ${
                      active
                        ? 'bg-slate-100 dark:bg-slate-800 font-bold text-slate-900 dark:text-white'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        className="w-3 h-3 rounded-full border border-black/10 shrink-0"
                        style={{ backgroundColor: swatch }}
                      />
                      <span>{t}</span>
                    </span>
                    {t === 'Dark Mode' ? <Moon className="w-3 h-3" /> : active ? <Sun className="w-3 h-3" /> : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Notifications Dropdown */}
        <div className="relative" ref={notifRef}>
          <button
            type="button"
            aria-label={`Notifications (${activeAlerts.length} active)`}
            onClick={() => setNotifOpen((prev) => !prev)}
            className="relative p-2 text-slate-600 dark:text-slate-300 hover:text-blue-700 dark:hover:text-sky-400 transition-colors rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <Bell className="w-4 h-4" />
            {activeAlerts.length > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-rose-500 rounded-full ring-2 ring-white dark:ring-slate-900" />
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 mt-2 w-80 bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 z-50 overflow-hidden">
              <div className="p-3 bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <span className="font-bold text-xs text-slate-800 dark:text-slate-100">Notifications</span>
                <span className="text-[10px] bg-blue-100 text-blue-800 dark:bg-sky-900/60 dark:text-sky-300 font-semibold px-2 py-0.5 rounded-full tabular-nums">
                  {activeAlerts.length} Alerts
                </span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-80 overflow-y-auto">
                {activeAlerts.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-400">
                    {isEmployee ? 'No alerts on your assigned assets' : 'No active system alerts'}
                  </div>
                ) : (
                  activeAlerts.map((m) => {
                    const asset = assets.find((a) => a.id === m.assetId);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          setNotifOpen(false);
                          onNavigate(isEmployee ? 'my-assets' : 'maintenance');
                        }}
                        className="w-full text-left p-3 hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors cursor-pointer block"
                      >
                        <div className="flex items-center space-x-1.5 text-amber-600 dark:text-amber-400 font-bold text-[10px]">
                          <Wrench className="w-3 h-3" />
                          <span>Maintenance Alert</span>
                        </div>
                        <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 mt-0.5 truncate">
                          {asset?.name || m.assetId}
                        </p>
                        <p className="text-[10px] text-slate-500 dark:text-slate-400">
                          {m.type} · Status: {m.status}
                        </p>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* User Profile */}
        <div className="relative pl-3 border-l border-slate-200 dark:border-slate-700" ref={profileRef}>
          <button
            type="button"
            onClick={() => setProfileOpen((prev) => !prev)}
            className="flex items-center space-x-2 hover:bg-slate-100 dark:hover:bg-slate-800 p-1 rounded-lg transition-colors cursor-pointer"
          >
            <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-sky-900/50 text-blue-800 dark:text-sky-300 flex items-center justify-center font-bold text-xs border border-blue-200 dark:border-sky-700">
              {initials}
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-xs font-bold text-slate-800 dark:text-slate-100 leading-tight">{userName}</p>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">{userRole}</p>
            </div>
          </button>

          {profileOpen && (
            <div className="absolute right-0 mt-2 w-48 bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 z-50 overflow-hidden py-1">
              {isEmployee ? (
                <button
                  type="button"
                  onClick={() => {
                    setProfileOpen(false);
                    onNavigate('profile');
                  }}
                  className="w-full text-left px-4 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  My Profile
                </button>
              ) : canOpenSettings ? (
                <button
                  type="button"
                  onClick={() => {
                    setProfileOpen(false);
                    onNavigate('settings');
                  }}
                  className="w-full text-left px-4 py-2 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  System Settings
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setProfileOpen(false);
                  handleLogoutClick();
                }}
                className="w-full text-left px-4 py-2 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors flex items-center gap-2 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
