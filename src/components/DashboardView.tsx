import React, { useEffect, useRef, useState } from 'react';
import Chart from 'chart.js/auto';
import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  Bell,
  Box,
  Building2,
  Calendar,
  CheckCheck,
  Clock,
  Coins,
  Globe,
  PieChart,
  Plus,
  RefreshCw,
  RotateCcw,
  Store,
  Trash2,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
  Wrench,
  Zap,
} from 'lucide-react';
import type {
  AssetOSState,
  AssetStatus,
  ModalType,
  NavTab,
  VisitorAnalyticsSummary,
} from '../types/asset';
import { apiClient } from '../api/client';
import {
  aggregateByField,
  aggregateValueByCategory,
  computeDashboardKPIs,
  formatCurrency,
} from '../utils/assetMath';

interface DashboardViewProps {
  state: AssetOSState;
  userName: string;
  onNavigate: (tab: NavTab, statusFilter?: AssetStatus | 'ALL') => void;
  onOpenModal: (modal: ModalType) => void;
}

type ActivityFilter = 'All' | 'Assets' | 'Assignments' | 'Returns' | 'Maintenance';
type DateRangeFilter = 'All Time' | 'Today' | 'This Week' | 'This Month' | 'This Financial Year';

export const DashboardView: React.FC<DashboardViewProps> = ({
  state,
  userName,
  onNavigate,
  onOpenModal,
}) => {
  const [dateRange, setDateRange] = useState<DateRangeFilter>('All Time');
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('All');
  const [visitorAnalytics, setVisitorAnalytics] = useState<VisitorAnalyticsSummary | null>(null);
  const [loadingVisitors, setLoadingVisitors] = useState(false);

  const loadVisitorAnalytics = async () => {
    setLoadingVisitors(true);
    try {
      const data = await apiClient.getVisitorAnalytics();
      setVisitorAnalytics(data.summary);
    } catch {
      // Keep previous reading if offline
    } finally {
      setLoadingVisitors(false);
    }
  };

  useEffect(() => {
    void loadVisitorAnalytics();
    const timer = window.setInterval(() => {
      void loadVisitorAnalytics();
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const statusCanvasRef = useRef<HTMLCanvasElement>(null);
  const categoryCanvasRef = useRef<HTMLCanvasElement>(null);
  const deptCanvasRef = useRef<HTMLCanvasElement>(null);
  const valueCanvasRef = useRef<HTMLCanvasElement>(null);

  const currency = state.settings.currency || '$';
  const kpis = computeDashboardKPIs(state.assets);

  useEffect(() => {
    const charts: Chart[] = [];

    if (statusCanvasRef.current) {
      const statusLabels: AssetStatus[] = [
        'Available',
        'Assigned',
        'Under Maintenance',
        'Disposed',
      ];
      charts.push(
        new Chart(statusCanvasRef.current, {
          type: 'doughnut',
          data: {
            labels: statusLabels,
            datasets: [
              {
                data: [
                  kpis.availableAssets,
                  kpis.assignedAssets,
                  kpis.maintenanceAssets,
                  kpis.disposedAssets,
                ],
                backgroundColor: ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444'],
                borderWidth: 0,
                hoverOffset: 4,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            onClick: (_evt, elements) => {
              if (elements.length > 0) {
                const idx = elements[0].index;
                onNavigate('inventory', statusLabels[idx]);
              }
            },
            plugins: {
              legend: {
                position: 'bottom',
                labels: { boxWidth: 8, usePointStyle: true, font: { size: 10 } },
              },
            },
          },
        })
      );
    }

    if (categoryCanvasRef.current) {
      const catCounts = aggregateByField(state.assets, 'category');
      const sortedEntries = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
      charts.push(
        new Chart(categoryCanvasRef.current, {
          type: 'bar',
          data: {
            labels: sortedEntries.map(([k]) => k),
            datasets: [
              {
                label: 'Assets',
                data: sortedEntries.map(([, v]) => v),
                backgroundColor: '#8b5cf6',
                borderRadius: 4,
                barPercentage: 0.6,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              y: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } } },
              x: { ticks: { font: { size: 9 } } },
            },
          },
        })
      );
    }

    if (deptCanvasRef.current) {
      const deptCounts = aggregateByField(state.assets, 'department');
      charts.push(
        new Chart(deptCanvasRef.current, {
          type: 'bar',
          data: {
            labels: Object.keys(deptCounts),
            datasets: [
              {
                label: 'Assets',
                data: Object.values(deptCounts),
                backgroundColor: ['#3b82f6', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'],
                borderRadius: 4,
                barPercentage: 0.6,
              },
            ],
          },
          options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { beginAtZero: true, ticks: { stepSize: 1, font: { size: 10 } } },
              y: { ticks: { font: { size: 10 } } },
            },
          },
        })
      );
    }

    if (valueCanvasRef.current) {
      const catValues = aggregateValueByCategory(state.assets);
      charts.push(
        new Chart(valueCanvasRef.current, {
          type: 'bar',
          data: {
            labels: Object.keys(catValues),
            datasets: [
              {
                label: `Value (${currency})`,
                data: Object.values(catValues),
                backgroundColor: '#f59e0b',
                borderRadius: 4,
                barPercentage: 0.6,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              y: {
                beginAtZero: true,
                ticks: {
                  callback: (value) => `${currency}${Number(value) / 1000}k`,
                  font: { size: 10 },
                },
              },
              x: { ticks: { font: { size: 9 } } },
            },
          },
        })
      );
    }

    return () => {
      charts.forEach((c) => c.destroy());
    };
  }, [state.assets, currency, kpis.availableAssets, kpis.assignedAssets, kpis.maintenanceAssets, kpis.disposedAssets, onNavigate]);

  const matchesDateRange = (dateStr: string) => {
    if (dateRange === 'All Time' || !dateStr) return true;
    const target = new Date(dateStr);
    if (Number.isNaN(target.getTime())) return true;
    const now = new Date();
    const diffDays = (now.getTime() - target.getTime()) / (1000 * 60 * 60 * 24);
    if (dateRange === 'Today') return dateStr === now.toISOString().split('T')[0];
    if (dateRange === 'This Week') return diffDays >= -365 && diffDays <= 7;
    if (dateRange === 'This Month') {
      return (
        target.getMonth() === now.getMonth() && target.getFullYear() === now.getFullYear()
      );
    }
    if (dateRange === 'This Financial Year') {
      return target.getFullYear() >= now.getFullYear() - 1;
    }
    return true;
  };

  const recentAssignments = state.assignments.filter((a) => matchesDateRange(a.assignDate));
  const recentReturns = state.returns.filter((r) => matchesDateRange(r.date));

  // Build unified activity feed from live state
  const unifiedActivities = [
    ...recentAssignments.slice(0, 5).map((a) => {
      const emp = state.employees.find((e) => e.id === a.employeeId);
      const asset = state.assets.find((ast) => ast.id === a.assetId);
      return {
        id: `act-asn-${a.id}`,
        group: 'Assignments' as const,
        date: a.assignDate,
        title: `Asset Assigned to ${emp?.name || 'Employee'}`,
        subtitle: `${asset?.name || a.assetId} · Assignment #${a.id} · By Admin`,
        badgeBg: 'bg-[#dbeafe] text-[#1e40af]',
        icon: UserCheck,
      };
    }),
    ...recentReturns.slice(0, 5).map((r) => {
      const emp = state.employees.find((e) => e.id === r.employeeId);
      const asset = state.assets.find((ast) => ast.id === r.assetId);
      return {
        id: `act-ret-${r.id}`,
        group: 'Returns' as const,
        date: r.date,
        title: `Asset Returned by ${emp?.name || 'Employee'}`,
        subtitle: `${asset?.name || r.assetId} (${r.condition}) · Return #${r.id}`,
        badgeBg: 'bg-[#dcfce7] text-[#166534]',
        icon: RotateCcw,
      };
    }),
    ...state.maintenance
      .filter((m) => matchesDateRange(m.serviceDate))
      .slice(0, 5)
      .map((m) => {
        const asset = state.assets.find((ast) => ast.id === m.assetId);
        return {
          id: `act-mnt-${m.id}`,
          group: 'Maintenance' as const,
          date: m.serviceDate,
          title: `Maintenance: ${asset?.name || m.assetId}`,
          subtitle: `${m.type} · Status: ${m.status} · Cost: ${formatCurrency(m.cost, currency)}`,
          badgeBg: 'bg-[#ffedd5] text-[#c2410c]',
          icon: Wrench,
        };
      }),
    ...state.assets
      .filter((a) => matchesDateRange(a.purchaseDate))
      .slice(0, 5)
      .map((a) => ({
        id: `act-ast-${a.id}`,
        group: 'Assets' as const,
        date: a.purchaseDate,
        title: `Asset Registered: ${a.name}`,
        subtitle: `${a.id} · ${a.category} · ${formatCurrency(a.cost, currency)}`,
        badgeBg: 'bg-amber-100 text-amber-800',
        icon: Plus,
      })),
  ]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .filter((item) => activityFilter === 'All' || item.group === activityFilter)
    .slice(0, 10);

  return (
    <div className="space-y-4 pb-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-2">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-slate-100">
            Median Asset &amp; HR Suite Dashboard
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Welcome back, {userName} · {state.settings.companyName} · FY {state.settings.financialYear}
          </p>
        </div>
        <div className="flex items-center space-x-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 px-3 py-1.5 rounded-lg shadow-sm">
          <Calendar className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
          <select
            aria-label="Dashboard date range"
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as DateRangeFilter)}
            className="text-xs bg-transparent focus:outline-none font-semibold text-slate-700 dark:text-slate-200 cursor-pointer"
          >
            <option value="All Time">All Time</option>
            <option value="Today">Today</option>
            <option value="This Week">This Week</option>
            <option value="This Month">This Month</option>
            <option value="This Financial Year">This Financial Year</option>
          </select>
        </div>
      </div>

      {/* Web Application Visitor Counter */}
      <section
        aria-label="Web Application Visitor Counter"
        className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-700 text-white flex items-center justify-center">
              <Globe className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-xs font-extrabold text-slate-900 dark:text-slate-100 uppercase tracking-wider">
                Web Application Visitor Counter
              </h2>
              <p className="text-[10px] text-slate-500 dark:text-slate-400">
                Deduplicated daily visits and live active sessions across Median Asset &amp; HR Suite
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void loadVisitorAnalytics()}
            disabled={loadingVisitors}
            className="px-2.5 py-1 text-[11px] font-semibold rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-1 cursor-pointer"
          >
            <RefreshCw className={`w-3 h-3 ${loadingVisitors ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            {
              label: 'Total Visitors',
              value: visitorAnalytics?.totalVisitors ?? 0,
              accent: 'text-blue-700 dark:text-sky-400',
              bg: 'bg-blue-50/70 dark:bg-slate-800/80 border-blue-200 dark:border-slate-700',
            },
            {
              label: "Today's Visitors",
              value: visitorAnalytics?.todayVisitors ?? 0,
              accent: 'text-emerald-700 dark:text-emerald-400',
              bg: 'bg-emerald-50/70 dark:bg-slate-800/80 border-emerald-200 dark:border-slate-700',
            },
            {
              label: 'Monthly Visitors',
              value: visitorAnalytics?.monthlyVisitors ?? 0,
              accent: 'text-indigo-700 dark:text-indigo-400',
              bg: 'bg-indigo-50/70 dark:bg-slate-800/80 border-indigo-200 dark:border-slate-700',
            },
            {
              label: 'Yearly Visitors',
              value: visitorAnalytics?.yearlyVisitors ?? 0,
              accent: 'text-purple-700 dark:text-purple-400',
              bg: 'bg-purple-50/70 dark:bg-slate-800/80 border-purple-200 dark:border-slate-700',
            },
            {
              label: 'Logged-in Users',
              value: visitorAnalytics?.loggedInUsers ?? 0,
              accent: 'text-amber-700 dark:text-amber-400',
              bg: 'bg-amber-50/70 dark:bg-slate-800/80 border-amber-200 dark:border-slate-700',
            },
            {
              label: 'Online Users',
              value: visitorAnalytics?.onlineUsers ?? 0,
              accent: 'text-teal-700 dark:text-teal-400',
              bg: 'bg-teal-50/70 dark:bg-slate-800/80 border-teal-200 dark:border-slate-700',
              live: true,
            },
          ].map((item) => (
            <div
              key={item.label}
              className={`p-3 rounded-lg border ${item.bg} flex flex-col justify-between`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                  {item.label}
                </span>
                {item.live ? (
                  <Activity className="w-3 h-3 text-emerald-500 animate-pulse shrink-0" />
                ) : null}
              </div>
              <span className={`text-xl font-extrabold tabular-nums mt-1 ${item.accent}`}>
                {item.value.toLocaleString('en-US')}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* KPI Cards Row 1 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-amber-50 dark:bg-slate-900 p-4 rounded-xl border border-amber-200 dark:border-amber-800/60 hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-2">
            <div className="w-8 h-8 rounded-lg bg-amber-700 text-white flex items-center justify-center shadow-sm">
              <Box className="w-4 h-4" />
            </div>
            <button
              type="button"
              onClick={() => onNavigate('inventory', 'ALL')}
              className="text-[11px] font-bold text-amber-800 dark:text-amber-400 hover:underline cursor-pointer"
            >
              View →
            </button>
          </div>
          <h3 className="text-2xl font-extrabold text-amber-800 dark:text-amber-300 tabular-nums">{kpis.totalAssets}</h3>
          <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
            Total Assets
          </p>
          <p className="text-[10px] text-amber-700/80 dark:text-slate-400 mt-1">All Registered Assets</p>
        </div>

        <div className="bg-[#dcfce7] p-4 rounded-xl border border-[#bbf7d0] hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-2">
            <div className="w-8 h-8 rounded-lg bg-[#166534] text-white flex items-center justify-center shadow-sm">
              <CheckCheck className="w-4 h-4" />
            </div>
            <button
              type="button"
              onClick={() => onNavigate('inventory', 'Available')}
              className="text-[11px] font-bold text-[#166534] hover:underline cursor-pointer"
            >
              View →
            </button>
          </div>
          <h3 className="text-2xl font-extrabold text-[#166534] tabular-nums">
            {kpis.availableAssets}
          </h3>
          <p className="text-[10px] font-bold text-[#15803d] uppercase tracking-wider">
            Available Assets
          </p>
          <p className="text-[10px] text-[#15803d]/80 mt-1 tabular-nums">
            {kpis.availablePct}% of active assets
          </p>
        </div>

        <div className="bg-[#dbeafe] p-4 rounded-xl border border-[#bfdbfe] hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-2">
            <div className="w-8 h-8 rounded-lg bg-[#1e40af] text-white flex items-center justify-center shadow-sm">
              <UserCheck className="w-4 h-4" />
            </div>
            <button
              type="button"
              onClick={() => onNavigate('inventory', 'Assigned')}
              className="text-[11px] font-bold text-[#1e40af] hover:underline cursor-pointer"
            >
              View →
            </button>
          </div>
          <h3 className="text-2xl font-extrabold text-[#1e40af] tabular-nums">
            {kpis.assignedAssets}
          </h3>
          <p className="text-[10px] font-bold text-[#1d4ed8] uppercase tracking-wider">
            Assigned Assets
          </p>
          <p className="text-[10px] text-[#1d4ed8]/80 mt-1 tabular-nums">
            {kpis.assignedPct}% of active assets
          </p>
        </div>

        <div className="bg-[#ffedd5] p-4 rounded-xl border border-[#fed7aa] hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-2">
            <div className="w-8 h-8 rounded-lg bg-[#c2410c] text-white flex items-center justify-center shadow-sm">
              <Wrench className="w-4 h-4" />
            </div>
            <button
              type="button"
              onClick={() => onNavigate('inventory', 'Under Maintenance')}
              className="text-[11px] font-bold text-[#c2410c] hover:underline cursor-pointer"
            >
              View →
            </button>
          </div>
          <h3 className="text-2xl font-extrabold text-[#c2410c] tabular-nums">
            {kpis.maintenanceAssets}
          </h3>
          <p className="text-[10px] font-bold text-[#ea580c] uppercase tracking-wider">
            Under Maintenance
          </p>
          <p className="text-[10px] text-[#ea580c]/80 mt-1 tabular-nums">
            {kpis.maintenancePct}% of total assets
          </p>
        </div>
      </div>

      {/* KPI Cards Row 2 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#fce7f3] p-4 rounded-xl border border-[#fbcfe8] hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-2">
            <div className="w-8 h-8 rounded-lg bg-[#be185d] text-white flex items-center justify-center shadow-sm">
              <Trash2 className="w-4 h-4" />
            </div>
            <button
              type="button"
              onClick={() => onNavigate('disposals')}
              className="text-[11px] font-bold text-[#be185d] hover:underline cursor-pointer"
            >
              View →
            </button>
          </div>
          <h3 className="text-2xl font-extrabold text-[#be185d] tabular-nums">
            {kpis.disposedAssets}
          </h3>
          <p className="text-[10px] font-bold text-[#be185d] uppercase tracking-wider">
            Disposed Assets
          </p>
          <p className="text-[10px] text-[#be185d]/80 mt-1 tabular-nums">
            {kpis.disposedPct}% of total assets
          </p>
        </div>

        <div className="bg-[#f3e8ff] p-4 rounded-xl border border-[#e9d5ff] hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-2">
            <div className="w-8 h-8 rounded-lg bg-[#7e22ce] text-white flex items-center justify-center shadow-sm">
              <Coins className="w-4 h-4" />
            </div>
          </div>
          <h3 className="text-xl font-extrabold text-[#7e22ce] tabular-nums">
            {formatCurrency(kpis.totalPurchaseCost, currency)}
          </h3>
          <p className="text-[10px] font-bold text-[#7e22ce] uppercase tracking-wider">
            Total Purchase Value
          </p>
          <p className="text-[10px] text-[#7e22ce]/80 mt-1">Acquisition Cost</p>
        </div>

        <div className="bg-[#cffafe] p-4 rounded-xl border border-[#a5f3fc] hover:shadow-md transition-shadow">
          <div className="flex justify-between items-start mb-2">
            <div className="w-8 h-8 rounded-lg bg-[#0e7490] text-white flex items-center justify-center shadow-sm">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <h3 className="text-xl font-extrabold text-[#0e7490] tabular-nums">
            {formatCurrency(kpis.totalBookValue, currency)}
          </h3>
          <p className="text-[10px] font-bold text-[#0e7490] uppercase tracking-wider">
            Current Book Value
          </p>
          <p className="text-[10px] text-[#0e7490]/80 mt-1">Depreciated Value</p>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-wrap gap-2 items-center">
        <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase px-2 flex items-center gap-1">
          <Zap className="w-3.5 h-3.5 text-amber-500" />
          Quick Actions
        </span>
        {[
          { label: 'Add Asset', icon: Plus, onClick: () => onOpenModal({ type: 'asset' }) },
          { label: 'Assign Asset', icon: UserPlus, onClick: () => onOpenModal({ type: 'assign' }) },
          { label: 'Return Asset', icon: RotateCcw, onClick: () => onOpenModal({ type: 'return' }) },
          { label: 'Transfer', icon: ArrowLeftRight, onClick: () => onOpenModal({ type: 'transfer' }) },
          { label: 'Maintenance', icon: Wrench, onClick: () => onOpenModal({ type: 'maintenance' }) },
          { label: 'Disposal', icon: Trash2, onClick: () => onOpenModal({ type: 'disposal' }) },
          { label: 'Employee', icon: Users, onClick: () => onOpenModal({ type: 'employee' }) },
          { label: 'Vendor', icon: Store, onClick: () => onOpenModal({ type: 'vendor' }) },
        ].map((btn) => {
          const BtnIcon = btn.icon;
          return (
            <button
              key={btn.label}
              type="button"
              onClick={btn.onClick}
              className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
            >
              <BtnIcon className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" /> {btn.label}
            </button>
          );
        })}
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col h-72">
          <h3 className="font-bold text-xs text-slate-800 dark:text-slate-100 mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <PieChart className="w-3.5 h-3.5 text-blue-600" /> Asset Status Overview
            </span>
            <span className="text-[10px] font-normal text-slate-400">Click segment to filter</span>
          </h3>
          <div className="flex-1 relative min-h-0">
            <canvas ref={statusCanvasRef} />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col h-72">
          <h3 className="font-bold text-xs text-slate-800 dark:text-slate-100 mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <BarChart3 className="w-3.5 h-3.5 text-blue-600" /> Assets by Category
            </span>
            <span className="text-[10px] font-normal text-slate-400">Sorted by count</span>
          </h3>
          <div className="flex-1 relative min-h-0">
            <canvas ref={categoryCanvasRef} />
          </div>
        </div>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col h-72">
          <h3 className="font-bold text-xs text-slate-800 dark:text-slate-100 mb-2 flex items-center gap-2">
            <Building2 className="w-3.5 h-3.5 text-blue-600" /> Assets by Department
          </h3>
          <div className="flex-1 relative min-h-0">
            <canvas ref={deptCanvasRef} />
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col h-72">
          <h3 className="font-bold text-xs text-slate-800 dark:text-slate-100 mb-2 flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Coins className="w-3.5 h-3.5 text-blue-600" /> Asset Value by Category
            </span>
            <span className="text-[10px] font-normal text-slate-400">
              Purchase cost in {currency}
            </span>
          </h3>
          <div className="flex-1 relative min-h-0">
            <canvas ref={valueCanvasRef} />
          </div>
        </div>
      </div>

      {/* Tables Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col overflow-hidden">
          <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/70">
            <h3 className="font-bold text-xs text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-slate-400" /> Recent Asset Assignments
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('assignments')}
              className="text-[10px] font-bold text-blue-700 dark:text-sky-400 hover:underline border border-blue-200 dark:border-sky-800 bg-blue-50 dark:bg-sky-950/50 px-2 py-1 rounded cursor-pointer"
            >
              View All Assignments →
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-white dark:bg-slate-900">
                <tr className="border-b border-slate-100 dark:border-slate-800 text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="px-3 py-2">Assign ID</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Employee</th>
                  <th className="px-3 py-2">Asset</th>
                  <th className="px-3 py-2 text-center">Assigned By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {recentAssignments.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                      No assignments in selected period.
                    </td>
                  </tr>
                ) : (
                  recentAssignments.slice(0, 5).map((a) => {
                    const emp = state.employees.find((e) => e.id === a.employeeId);
                    const asset = state.assets.find((ast) => ast.id === a.assetId);
                    return (
                      <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                        <td className="px-3 py-2 font-mono font-bold text-slate-600 dark:text-slate-300">{a.id}</td>
                        <td className="px-3 py-2 text-slate-500 tabular-nums">{a.assignDate}</td>
                        <td className="px-3 py-2 font-bold text-slate-800 dark:text-slate-100">
                          {emp?.name || 'Unknown'}
                        </td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{asset?.name || a.assetId}</td>
                        <td className="px-3 py-2 text-center text-slate-600 dark:text-slate-300">
                          {a.assignedBy || 'Admin'}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col overflow-hidden">
          <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/70">
            <h3 className="font-bold text-xs text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <RotateCcw className="w-3.5 h-3.5 text-slate-400" /> Recent Asset Returns
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('returns')}
              className="text-[10px] font-bold text-blue-700 dark:text-sky-400 hover:underline border border-blue-200 dark:border-sky-800 bg-blue-50 dark:bg-sky-950/50 px-2 py-1 rounded cursor-pointer"
            >
              View All Returns →
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-white dark:bg-slate-900">
                <tr className="border-b border-slate-100 dark:border-slate-800 text-[9px] font-bold text-slate-500 uppercase tracking-wider">
                  <th className="px-3 py-2">Return ID</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Employee</th>
                  <th className="px-3 py-2">Asset</th>
                  <th className="px-3 py-2 text-center">Condition</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {recentReturns.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-slate-400">
                      No returns in selected period.
                    </td>
                  </tr>
                ) : (
                  recentReturns.slice(0, 5).map((r) => {
                    const emp = state.employees.find((e) => e.id === r.employeeId);
                    const asset = state.assets.find((ast) => ast.id === r.assetId);
                    return (
                      <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                        <td className="px-3 py-2 font-mono font-bold text-slate-600 dark:text-slate-300">{r.id}</td>
                        <td className="px-3 py-2 text-slate-500 tabular-nums">{r.date}</td>
                        <td className="px-3 py-2 font-bold text-slate-800 dark:text-slate-100">
                          {emp?.name || 'Unknown'}
                        </td>
                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300">{asset?.name || r.assetId}</td>
                        <td className="px-3 py-2 text-center">
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-800 rounded text-[9px] font-bold border border-amber-200">
                            {r.condition}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col overflow-hidden">
        <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex flex-wrap gap-2 justify-between items-center bg-slate-50 dark:bg-slate-800/70">
          <h3 className="font-bold text-xs text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Bell className="w-3.5 h-3.5 text-slate-400" /> Recent Asset Activity
          </h3>
          <div className="flex flex-wrap gap-1">
            {(['All', 'Assets', 'Assignments', 'Returns', 'Maintenance'] as ActivityFilter[]).map(
              (tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActivityFilter(tab)}
                  className={`px-2.5 py-1 text-[10px] font-bold rounded border transition-colors cursor-pointer ${
                    activityFilter === tab
                      ? 'bg-blue-50 dark:bg-sky-950/60 border-blue-300 dark:border-sky-700 text-blue-800 dark:text-sky-300'
                      : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {tab === 'All' ? 'All Activity' : tab}
                </button>
              )
            )}
          </div>
        </div>
        <div className="p-4 flex-1 overflow-y-auto max-h-72">
          <div className="relative border-l border-slate-200 ml-3 space-y-5 pb-2">
            {unifiedActivities.map((act) => {
              const Icon = act.icon;
              return (
                <div key={act.id} className="relative pl-6 pr-20">
                  <div
                    className={`absolute -left-3 top-0.5 w-6 h-6 ${act.badgeBg} rounded-full border border-white flex items-center justify-center shadow-sm`}
                  >
                    <Icon className="w-3 h-3" />
                  </div>
                  <p className="text-xs font-bold text-slate-800">{act.title}</p>
                  <p className="text-[10px] text-slate-500">{act.subtitle}</p>
                  <p className="text-[10px] text-slate-400 absolute right-0 top-0 tabular-nums">
                    {act.date}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
