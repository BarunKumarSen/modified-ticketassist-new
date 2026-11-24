import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  KeyRound,
  Mail,
  RefreshCw,
  Search,
  Send,
  Server,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { apiClient, ApiError } from '../api/client';
import type { ThemePalette, ToastMessage } from '../types/asset';
import type {
  EmailAuditRecord,
  EmailDashboardSummary,
  EmailDeliveryStatus,
  EmailLogRecord,
  EmployeeMailReportRow,
  MailHealthStatus,
  ManagerMailReportRow,
} from '../types/mail';
import { THEME_PALETTES } from '../utils/assetMath';
import { formatTicketTimestamp } from '../utils/ticketLogic';
import { ModalShell } from './AssetModals';

type MailSubTab = 'sent' | 'failed' | 'retry' | 'managers' | 'employees' | 'audit';

const STATUS_STYLE: Record<EmailDeliveryStatus, string> = {
  Sent: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  Queued: 'bg-sky-50 text-sky-800 border-sky-200',
  Sending: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  Retry: 'bg-amber-50 text-amber-800 border-amber-200',
  Failed: 'bg-rose-50 text-rose-800 border-rose-200',
};

const WEB_LOGO_URL = '/assets/aistudio/Median_logo_Final_Small__1__69ba70f6.jpg';

export const MailDashboardView: React.FC<{
  theme: ThemePalette;
  onMailStatus?: (popup: { ok: boolean; title: string; details?: string }) => void;
  onNotify: (msg: string, type?: ToastMessage['type']) => void;
}> = ({ theme, onMailStatus, onNotify }) => {
  const palette = THEME_PALETTES[theme];
  const [subTab, setSubTab] = useState<MailSubTab>('sent');
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [logs, setLogs] = useState<EmailLogRecord[]>([]);
  const [summary, setSummary] = useState<EmailDashboardSummary>({
    total: 0,
    sent: 0,
    failed: 0,
    queued: 0,
    retrying: 0,
  });
  const [managerReports, setManagerReports] = useState<ManagerMailReportRow[]>([]);
  const [employeeReports, setEmployeeReports] = useState<EmployeeMailReportRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<EmailAuditRecord[]>([]);
  const [mailStatus, setMailStatus] = useState<MailHealthStatus | null>(null);
  const [testingConn, setTestingConn] = useState(false);
  const [processingQueue, setProcessingQueue] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [previewLog, setPreviewLog] = useState<EmailLogRecord | null>(null);

  // Admin Sender Migration (3-step OTP & SMTP/IMAP Loopback Verification)
  const [senderModalOpen, setSenderModalOpen] = useState(false);
  const [senderStep, setSenderStep] = useState<'request-otp' | 'verify-otp' | 'configure-server'>(
    'request-otp'
  );
  const [senderCurrentEmail, setSenderCurrentEmail] = useState('');
  const [senderNewEmail, setSenderNewEmail] = useState('');
  const [senderOtpId, setSenderOtpId] = useState('');
  const [senderOtpCode, setSenderOtpCode] = useState('');
  const [senderSandboxOtp, setSenderSandboxOtp] = useState('');
  const [senderSmtpHost, setSenderSmtpHost] = useState('smtp.gmail.com');
  const [senderSmtpPort, setSenderSmtpPort] = useState(587);
  const [senderEncryption, setSenderEncryption] = useState<'tls' | 'ssl' | 'none'>('tls');
  const [senderImapHost, setSenderImapHost] = useState('imap.gmail.com');
  const [senderImapPort, setSenderImapPort] = useState(993);
  const [senderAppPassword, setSenderAppPassword] = useState('');
  const [senderAppName, setSenderAppName] = useState('Median Research Asset & HR Portal');
  const [senderError, setSenderError] = useState('');
  const [senderSuccessMsg, setSenderSuccessMsg] = useState('');
  const [senderBusy, setSenderBusy] = useState(false);

  const loadMailDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const [logsRes, reportsRes, auditRes, statusRes] = await Promise.all([
        apiClient.getMailLogs(),
        apiClient.getMailReports(),
        apiClient.getMailAudit(),
        apiClient.getMailStatus(),
      ]);
      setLogs(logsRes.logs);
      setSummary(reportsRes.summary);
      setManagerReports(reportsRes.managerReports);
      setEmployeeReports(reportsRes.employeeReports);
      setAuditLogs(auditRes.logs);
      setMailStatus(statusRes.status);
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Failed to load mail dashboard', 'error');
    } finally {
      setLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    void loadMailDashboard();
  }, [loadMailDashboard]);

  const handleTestConnections = async () => {
    if (testingConn) return;
    setTestingConn(true);
    try {
      const res = await apiClient.testMailConnections();
      setMailStatus((prev) =>
        prev
          ? {
              ...prev,
              smtpReachable: res.smtp.ok,
              smtpMessage: res.smtp.details,
              imapReachable: res.imap.ok,
              imapMessage: res.imap.details,
              lastCheckedAt: new Date().toISOString(),
            }
          : prev
      );
      if (res.smtp.ok && res.imap.ok) {
        onNotify('Gmail SMTP & IMAP connections verified');
      } else {
        onNotify(
          `SMTP: ${res.smtp.ok ? 'OK' : res.smtp.details} · IMAP: ${res.imap.ok ? 'OK' : res.imap.details}`,
          res.smtp.ok || res.imap.ok ? 'info' : 'error'
        );
      }
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Connection test failed', 'error');
    } finally {
      setTestingConn(false);
    }
  };

  const handleProcessQueue = async () => {
    if (processingQueue) return;
    setProcessingQueue(true);
    try {
      const res = await apiClient.processMailQueue();
      onNotify(
        `Queue processed: ${res.dispatch.processed} checked, ${res.dispatch.sent} sent, ${res.dispatch.failedOrRetrying} retrying/failed`
      );
      await loadMailDashboard();
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Queue processing failed', 'error');
    } finally {
      setProcessingQueue(false);
    }
  };

  const handleSendOneNow = async (log: EmailLogRecord) => {
    setSendingId(log.id);
    try {
      const res = await apiClient.sendMailLogNow(log.id);
      if (onMailStatus) {
        onMailStatus({
          ok: true,
          title: 'Email Sent Successfully',
          details: res.message || `Email delivered to ${log.recipientEmail}`,
        });
      } else {
        onNotify(res.message || 'Email Sent Successfully', 'success');
      }
      await loadMailDashboard();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Email Delivery Failed';
      if (onMailStatus) {
        onMailStatus({
          ok: false,
          title: 'Email Delivery Failed',
          details: msg,
        });
      } else {
        onNotify(msg, 'error');
      }
      await loadMailDashboard();
    } finally {
      setSendingId(null);
    }
  };

  const openSenderMigrationModal = () => {
    setSenderStep('request-otp');
    setSenderCurrentEmail(mailStatus?.from || '');
    setSenderNewEmail('');
    setSenderOtpId('');
    setSenderOtpCode('');
    setSenderSandboxOtp('');
    setSenderSmtpHost(mailStatus?.smtpHost || 'smtp.gmail.com');
    setSenderSmtpPort(mailStatus?.smtpPort || 587);
    setSenderEncryption(
      mailStatus?.encryption === 'ssl' || mailStatus?.encryption === 'none'
        ? mailStatus.encryption
        : 'tls'
    );
    setSenderImapHost(mailStatus?.imapHost || 'imap.gmail.com');
    setSenderImapPort(mailStatus?.imapPort || 993);
    setSenderAppPassword('');
    setSenderAppName(mailStatus?.appName || 'Median Research Asset & HR Portal');
    setSenderError('');
    setSenderSuccessMsg('');
    setSenderModalOpen(true);
  };

  const handleRequestSenderOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!senderNewEmail.trim() || !senderNewEmail.includes('@')) {
      setSenderError('Please enter a valid new email address.');
      return;
    }
    setSenderBusy(true);
    setSenderError('');
    try {
      const res = await apiClient.requestSenderChangeOtp(senderNewEmail.trim());
      setSenderOtpId(res.otpId);
      setSenderCurrentEmail(res.currentEmail);
      setSenderNewEmail(res.newEmail);
      setSenderSandboxOtp(res.sandboxOtpPreview || '');
      setSenderStep('verify-otp');
      await loadMailDashboard();
    } catch (err) {
      setSenderError(err instanceof ApiError ? err.message : 'Failed to generate OTP');
    } finally {
      setSenderBusy(false);
    }
  };

  const handleVerifySenderOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (senderOtpCode.trim().length !== 6) {
      setSenderError('Please enter the 6-digit OTP.');
      return;
    }
    setSenderBusy(true);
    setSenderError('');
    try {
      const res = await apiClient.verifySenderChangeOtp({
        otpId: senderOtpId,
        otpCode: senderOtpCode.trim(),
      });
      onNotify(
        `OTP verified. Confirmation sent to ${res.oldEmail}. Configure new mail server details.`,
        'info'
      );
      setSenderStep('configure-server');
    } catch (err) {
      setSenderError(err instanceof ApiError ? err.message : 'Invalid or expired 6-digit OTP');
    } finally {
      setSenderBusy(false);
    }
  };

  const handleCompleteSenderChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setSenderBusy(true);
    setSenderError('');
    try {
      const res = await apiClient.completeSenderChange({
        otpId: senderOtpId,
        smtpHost: senderSmtpHost.trim(),
        smtpPort: Number(senderSmtpPort),
        encryption: senderEncryption,
        imapHost: senderImapHost.trim(),
        imapPort: Number(senderImapPort),
        appPassword: senderAppPassword,
        appName: senderAppName.trim(),
      });
      setSenderSuccessMsg(res.message || 'The mail configuration for Admin is successful');
      onNotify(res.message || 'The mail configuration for Admin is successful');
      await loadMailDashboard();
    } catch (err) {
      setSenderError(
        err instanceof ApiError
          ? err.message
          : 'Wrong input provided. Please put the correct input in order to setup the Admin automated mail system.'
      );
    } finally {
      setSenderBusy(false);
    }
  };

  const q = search.trim().toLowerCase();

  const visibleLogs = useMemo(() => {
    return logs.filter((item) => {
      if (subTab === 'sent' && item.status !== 'Sent') return false;
      if (subTab === 'failed' && item.status !== 'Failed') return false;
      if (
        subTab === 'retry' &&
        item.status !== 'Retry' &&
        item.status !== 'Queued' &&
        item.status !== 'Sending'
      ) {
        return false;
      }
      if (!q) return true;
      return (
        item.subject.toLowerCase().includes(q) ||
        item.recipientEmail.toLowerCase().includes(q) ||
        item.recipientName.toLowerCase().includes(q) ||
        (item.employeeName || '').toLowerCase().includes(q) ||
        (item.managerName || '').toLowerCase().includes(q) ||
        item.eventType.toLowerCase().includes(q)
      );
    });
  }, [logs, subTab, q]);

  const visibleManagers = useMemo(() => {
    if (!q) return managerReports;
    return managerReports.filter(
      (m) =>
        m.managerName.toLowerCase().includes(q) || m.managerEmail.toLowerCase().includes(q)
    );
  }, [managerReports, q]);

  const visibleEmployees = useMemo(() => {
    if (!q) return employeeReports;
    return employeeReports.filter(
      (e) =>
        e.employeeName.toLowerCase().includes(q) ||
        e.employeeCode.toLowerCase().includes(q) ||
        e.employeeEmail.toLowerCase().includes(q) ||
        e.center.toLowerCase().includes(q)
    );
  }, [employeeReports, q]);

  const visibleAudit = useMemo(() => {
    if (!q) return auditLogs;
    return auditLogs.filter(
      (a) =>
        a.eventType.toLowerCase().includes(q) ||
        a.actor.toLowerCase().includes(q) ||
        a.details.toLowerCase().includes(q)
    );
  }, [auditLogs, q]);

  const tabItems: Array<{ id: MailSubTab; label: string; count?: number }> = [
    { id: 'sent', label: 'Sent Mail Log', count: summary.sent },
    { id: 'failed', label: 'Failed Mail Log', count: summary.failed },
    { id: 'retry', label: 'Pending / Queued', count: summary.queued + summary.retrying },
    { id: 'managers', label: 'Manager-wise Reports', count: managerReports.length },
    { id: 'employees', label: 'Employee-wise Reports', count: employeeReports.length },
    { id: 'audit', label: 'Notification History', count: auditLogs.length },
  ];

  const previewHtml = useMemo(() => {
    if (!previewLog) return '';
    return previewLog.htmlBody.replace(/cid:median-company-logo/g, WEB_LOGO_URL);
  }, [previewLog]);

  return (
    <div className="space-y-4 pb-10" data-testid="mail-dashboard-view">
      {/* Header */}
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">
            Email &amp; Notification Management
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Manual dispatch control, zero-retry queue deletion policy, sender migration &amp; SMTP/IMAP health
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleProcessQueue}
            disabled={processingQueue}
            className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-3.5 py-1.5 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50`}
          >
            <Send className="w-3.5 h-3.5" />
            <span>{processingQueue ? 'Processing...' : 'Process Queue Now'}</span>
          </button>
          <button
            type="button"
            onClick={handleTestConnections}
            disabled={testingConn}
            className="px-3.5 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Server className="w-3.5 h-3.5 text-emerald-700" />
            <span>{testingConn ? 'Testing...' : 'Test SMTP & IMAP'}</span>
          </button>
          <button
            type="button"
            onClick={() => void loadMailDashboard()}
            className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Read-only Runtime Mail Configuration Strip (No Secrets) */}
      {mailStatus && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-2 text-slate-700">
            <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
            <span className="font-bold text-slate-900">{mailStatus.appName}</span>
            <span className="text-slate-300">·</span>
            <span>
              Sender: <strong className="font-mono text-slate-900">{mailStatus.from || 'Not set'}</strong>
            </span>
            <span className="text-slate-300">·</span>
            <span className="font-mono tabular-nums">
              SMTP {mailStatus.smtpHost}:{mailStatus.smtpPort} ({mailStatus.encryption.toUpperCase()})
            </span>
            <span className="text-slate-300">·</span>
            <span className="font-mono tabular-nums">
              IMAP {mailStatus.imapHost}:{mailStatus.imapPort}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span
              className={`px-2 py-0.5 rounded border font-semibold ${
                mailStatus.configured
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-amber-50 text-amber-800 border-amber-200'
              }`}
            >
              {mailStatus.configured ? 'Env Credentials Loaded' : 'Credentials Missing'}
            </span>
            {mailStatus.smtpReachable !== undefined && (
              <span
                className={`px-2 py-0.5 rounded border font-semibold ${
                  mailStatus.smtpReachable
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border-rose-200'
                }`}
                title={mailStatus.smtpMessage}
              >
                SMTP: {mailStatus.smtpReachable ? 'Connected' : 'Unreachable'}
              </span>
            )}
            {mailStatus.imapReachable !== undefined && (
              <span
                className={`px-2 py-0.5 rounded border font-semibold ${
                  mailStatus.imapReachable
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border-rose-200'
                }`}
                title={mailStatus.imapMessage}
              >
                IMAP: {mailStatus.imapReachable ? 'Connected' : 'Unreachable'}
              </span>
            )}
            <button
              type="button"
              onClick={openSenderMigrationModal}
              className="px-2.5 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 font-bold flex items-center gap-1 cursor-pointer"
            >
              <KeyRound className="w-3 h-3" />
              <span>Change Sender Email</span>
            </button>
          </div>
        </div>
      )}

      {/* Delivery Summary KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Total Emails</p>
          <p className="text-2xl font-extrabold text-slate-900 mt-1 tabular-nums">{summary.total}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-emerald-200 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">Delivered</p>
          <p className="text-2xl font-extrabold text-emerald-700 mt-1 tabular-nums">{summary.sent}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-sky-200 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-sky-700">Queued (Manual)</p>
          <p className="text-2xl font-extrabold text-sky-700 mt-1 tabular-nums">{summary.queued}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-amber-200 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-amber-700">Pending Dispatch</p>
          <p className="text-2xl font-extrabold text-amber-700 mt-1 tabular-nums">{summary.retrying}</p>
        </div>
        <div className="bg-white p-4 rounded-xl border border-rose-200 shadow-sm col-span-2 sm:col-span-1">
          <p className="text-[10px] font-bold uppercase tracking-wider text-rose-700">Failed</p>
          <p className="text-2xl font-extrabold text-rose-700 mt-1 tabular-nums">{summary.failed}</p>
        </div>
      </div>

      {/* Sub-navigation + Search */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm p-3 flex flex-col xl:flex-row xl:items-center justify-between gap-2.5">
        <div className="flex flex-wrap gap-1">
          {tabItems.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSubTab(tab.id)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap ${
                subTab === tab.id
                  ? `${palette.primaryBtn} shadow-sm`
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span className="font-mono text-[10px] opacity-80 tabular-nums">({tab.count})</span>
              )}
            </button>
          ))}
        </div>

        <div className="relative w-full xl:w-56 shrink-0">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            aria-label="Search email logs and reports"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search recipient, subject..."
            className="w-full pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
      </div>

      {/* Tables */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
        {loading && logs.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-500">Loading email logs...</div>
        ) : subTab === 'sent' || subTab === 'failed' || subTab === 'retry' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">Recipient</th>
                  <th className="px-4 py-3">Employee / Center</th>
                  <th className="px-4 py-3">Subject</th>
                  <th className="px-4 py-3">Delivery</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {visibleLogs.map((log) => {
                  const ts = formatTicketTimestamp(log.sentAt || log.updatedAt || log.createdAt);
                  return (
                    <tr key={log.id} className="hover:bg-slate-50 align-top">
                      <td className="px-4 py-3 whitespace-nowrap tabular-nums">
                        <span className="block font-semibold text-slate-800">{ts.date}</span>
                        <span className="block text-[10px] font-mono text-slate-500">{ts.time}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="font-mono text-[10px] font-bold text-slate-700">
                          {log.eventType}
                        </span>
                        <span className="block text-[10px] text-slate-400">
                          To {log.recipientRole}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-bold text-slate-900 block">{log.recipientName}</span>
                        <span className="text-[11px] font-mono text-slate-500">
                          {log.recipientEmail}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-slate-800 block">
                          {log.employeeName || '—'}
                        </span>
                        <span className="text-[10px] text-slate-500">
                          {[log.employeeCode, log.center].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 max-w-xs">
                        <p className="font-semibold text-slate-900 line-clamp-2">{log.subject}</p>
                        {log.lastError && (
                          <p className="text-[10px] text-rose-600 mt-0.5 line-clamp-2">
                            {log.lastError}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-[10px] font-bold ${STATUS_STYLE[log.status]}`}
                        >
                          {log.status === 'Sent' && <CheckCircle2 className="w-3 h-3" />}
                          {log.status === 'Failed' && <XCircle className="w-3 h-3" />}
                          {(log.status === 'Retry' || log.status === 'Queued') && (
                            <Clock className="w-3 h-3" />
                          )}
                          {log.status}
                        </span>
                        <span className="block text-[10px] font-mono text-slate-400 mt-0.5 tabular-nums">
                          Attempts: {log.attempts}/{log.maxAttempts}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap space-x-1">
                        <button
                          type="button"
                          onClick={() => setPreviewLog(log)}
                          className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Eye className="w-3 h-3" /> Preview
                        </button>
                        {log.status !== 'Sent' && (
                          <button
                            type="button"
                            disabled={sendingId === log.id}
                            onClick={() => handleSendOneNow(log)}
                            className="px-2.5 py-1 rounded bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          >
                            <Mail className="w-3 h-3" /> {sendingId === log.id ? 'Sending...' : 'Send Mail'}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {visibleLogs.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                      No email records in this queue.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : subTab === 'managers' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                  <th className="px-4 py-3">Reporting Manager</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Sent</th>
                  <th className="px-4 py-3">Queued / Retry</th>
                  <th className="px-4 py-3">Failed</th>
                  <th className="px-4 py-3">Last Activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {visibleManagers.map((row) => (
                  <tr key={row.managerEmail} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-bold text-slate-900">{row.managerName}</td>
                    <td className="px-4 py-3 font-mono text-slate-600">{row.managerEmail}</td>
                    <td className="px-4 py-3 tabular-nums font-bold">{row.total}</td>
                    <td className="px-4 py-3 tabular-nums font-semibold text-emerald-700">{row.sent}</td>
                    <td className="px-4 py-3 tabular-nums text-amber-700">{row.queued}</td>
                    <td className="px-4 py-3 tabular-nums text-rose-700">{row.failed}</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-500 tabular-nums">
                      {formatTicketTimestamp(row.lastActivityAt).full}
                    </td>
                  </tr>
                ))}
                {visibleManagers.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                      No manager email activity logged yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : subTab === 'employees' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Center</th>
                  <th className="px-4 py-3">Total</th>
                  <th className="px-4 py-3">Sent</th>
                  <th className="px-4 py-3">Queued / Retry</th>
                  <th className="px-4 py-3">Failed</th>
                  <th className="px-4 py-3">Last Activity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {visibleEmployees.map((row) => (
                  <tr key={`${row.employeeId}-${row.employeeEmail}`} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span className="font-bold text-slate-900 block">{row.employeeName}</span>
                      <span className="text-[10px] font-mono text-slate-400">{row.employeeCode}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-slate-600">{row.employeeEmail}</td>
                    <td className="px-4 py-3 text-slate-700">{row.center || '—'}</td>
                    <td className="px-4 py-3 tabular-nums font-bold">{row.total}</td>
                    <td className="px-4 py-3 tabular-nums font-semibold text-emerald-700">{row.sent}</td>
                    <td className="px-4 py-3 tabular-nums text-amber-700">{row.queued}</td>
                    <td className="px-4 py-3 tabular-nums text-rose-700">{row.failed}</td>
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-500 tabular-nums">
                      {formatTicketTimestamp(row.lastActivityAt).full}
                    </td>
                  </tr>
                ))}
                {visibleEmployees.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-slate-400">
                      No employee email activity logged yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                  <th className="px-4 py-3">Timestamp</th>
                  <th className="px-4 py-3">Event Type</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {visibleAudit.map((row) => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-[11px] text-slate-500 whitespace-nowrap tabular-nums">
                      {formatTicketTimestamp(row.createdAt).full}
                    </td>
                    <td className="px-4 py-3 font-mono font-bold text-slate-800">{row.eventType}</td>
                    <td className="px-4 py-3 font-semibold text-slate-800">{row.actor}</td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 font-bold text-[10px] text-slate-700">
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.details}</td>
                  </tr>
                ))}
                {visibleAudit.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                      No email notification audit events recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Email Preview Modal */}
      {previewLog && (
        <ModalShell
          title={`Email Preview · ${previewLog.subject}`}
          icon={<Mail className="w-4 h-4 text-emerald-400" />}
          headerClass={palette.modalHeader}
          maxWidth="max-w-3xl"
          onClose={() => setPreviewLog(null)}
        >
          <div className="p-5 space-y-3 bg-white overflow-y-auto max-h-[82vh]">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs">
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 block">To</span>
                <span className="font-semibold text-slate-900">
                  {previewLog.recipientName} &lt;{previewLog.recipientEmail}&gt;
                </span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 block">Status</span>
                <span className="font-bold text-slate-800">
                  {previewLog.status} (Attempts: {previewLog.attempts})
                </span>
              </div>
              <div>
                <span className="text-[10px] font-bold uppercase text-slate-400 block">Event</span>
                <span className="font-mono font-semibold text-slate-800">{previewLog.eventType}</span>
              </div>
            </div>
            {previewLog.lastError && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-700 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{previewLog.lastError}</span>
              </div>
            )}
            <iframe
              srcDoc={previewHtml}
              sandbox=""
              title={`Preview of ${previewLog.subject}`}
              className="w-full h-[460px] border border-slate-200 rounded-lg bg-slate-50"
            />
          </div>
        </ModalShell>
      )}
      {/* Admin Sender Email Migration Modal (6-Digit OTP + Live Loopback Verification) */}
      {senderModalOpen && (
        <ModalShell
          title="Change Admin Sender Email & Mail Server"
          icon={<KeyRound className="w-4 h-4 text-emerald-400" />}
          headerClass={palette.modalHeader}
          maxWidth="max-w-lg"
          onClose={() => setSenderModalOpen(false)}
        >
          <div className="p-6 bg-white space-y-4">
            {senderSuccessMsg ? (
              <div className="space-y-4">
                <div
                  role="alert"
                  className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-start gap-2.5"
                >
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div>
                    <p className="font-bold">{senderSuccessMsg}</p>
                    <p className="text-[11px] mt-1">
                      Loopback verification succeeded ({senderNewEmail} → {senderNewEmail}). New mail configuration saved.
                    </p>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setSenderModalOpen(false)}
                    className="px-5 py-2 bg-[#3f3f46] hover:bg-[#27272a] text-white rounded-lg text-xs font-bold cursor-pointer"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : senderStep === 'request-otp' ? (
              <form onSubmit={handleRequestSenderOtp} className="space-y-4">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700">
                  Current Sender Email:{' '}
                  <strong className="font-mono text-slate-900">
                    {senderCurrentEmail || 'Not configured'}
                  </strong>
                </div>
                <div>
                  <label
                    htmlFor="sender-new-email"
                    className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
                  >
                    New Admin Sender Email *
                  </label>
                  <input
                    id="sender-new-email"
                    type="email"
                    required
                    value={senderNewEmail}
                    onChange={(e) => {
                      setSenderNewEmail(e.target.value);
                      if (senderError) setSenderError('');
                    }}
                    placeholder="example@mail.com"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                  />
                </div>
                {senderError && (
                  <p role="alert" className="text-xs font-semibold text-rose-600">
                    {senderError}
                  </p>
                )}
                <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setSenderModalOpen(false)}
                    className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={senderBusy}
                    className="px-5 py-2 bg-[#3f3f46] hover:bg-[#27272a] disabled:opacity-50 text-white rounded-lg text-xs font-bold cursor-pointer"
                  >
                    {senderBusy ? 'Sending OTP...' : 'Send 6-Digit OTP'}
                  </button>
                </div>
              </form>
            ) : senderStep === 'verify-otp' ? (
              <form onSubmit={handleVerifySenderOtp} className="space-y-4">
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-800 leading-relaxed">
                  &ldquo;Hello Admin, to remove your mail ID from{' '}
                  <strong className="font-mono">{senderCurrentEmail}</strong> to{' '}
                  <strong className="font-mono">{senderNewEmail}</strong>, please put your OTP here in the web application.&rdquo;
                </div>
                {senderSandboxOtp && (
                  <p className="text-[11px] font-mono bg-sky-50 border border-sky-200 text-sky-900 px-3 py-2 rounded-lg">
                    Sandbox OTP Preview (Live SMTP not connected): <strong>{senderSandboxOtp}</strong>
                  </p>
                )}
                <div>
                  <label
                    htmlFor="sender-otp-input"
                    className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
                  >
                    Enter 6-Digit OTP *
                  </label>
                  <input
                    id="sender-otp-input"
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={senderOtpCode}
                    onChange={(e) => {
                      setSenderOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6));
                      if (senderError) setSenderError('');
                    }}
                    placeholder="6-digit OTP"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono tracking-widest"
                  />
                </div>
                {senderError && (
                  <p role="alert" className="text-xs font-semibold text-rose-600">
                    {senderError}
                  </p>
                )}
                <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setSenderStep('request-otp')}
                    className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer"
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={senderBusy}
                    className="px-5 py-2 bg-[#3f3f46] hover:bg-[#27272a] disabled:opacity-50 text-white rounded-lg text-xs font-bold cursor-pointer"
                  >
                    {senderBusy ? 'Verifying...' : 'Verify OTP'}
                  </button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleCompleteSenderChange} className="space-y-3">
                <p className="text-xs text-slate-600">
                  Enter the new mail server credentials for{' '}
                  <strong className="font-mono text-slate-900">{senderNewEmail}</strong>. A live loopback test email will be sent to verify.
                </p>
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="col-span-2">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                      SMTP Host *
                    </label>
                    <input
                      type="text"
                      required
                      value={senderSmtpHost}
                      onChange={(e) => setSenderSmtpHost(e.target.value)}
                      placeholder="smtp.gmail.com"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                      SMTP Port *
                    </label>
                    <input
                      type="number"
                      required
                      value={senderSmtpPort}
                      onChange={(e) => setSenderSmtpPort(Number(e.target.value) || 587)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="col-span-2">
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                      IMAP Host *
                    </label>
                    <input
                      type="text"
                      required
                      value={senderImapHost}
                      onChange={(e) => setSenderImapHost(e.target.value)}
                      placeholder="imap.gmail.com"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                      IMAP Port *
                    </label>
                    <input
                      type="number"
                      required
                      value={senderImapPort}
                      onChange={(e) => setSenderImapPort(Number(e.target.value) || 993)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                      App Password *
                    </label>
                    <input
                      type="password"
                      required
                      value={senderAppPassword}
                      onChange={(e) => setSenderAppPassword(e.target.value)}
                      placeholder="App password / token"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                      Encryption
                    </label>
                    <select
                      value={senderEncryption}
                      onChange={(e) =>
                        setSenderEncryption(e.target.value as 'tls' | 'ssl' | 'none')
                      }
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                    >
                      <option value="tls">TLS (STARTTLS)</option>
                      <option value="ssl">SSL</option>
                      <option value="none">None</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    App Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={senderAppName}
                    onChange={(e) => setSenderAppName(e.target.value)}
                    placeholder="Median Research Asset & HR Portal"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
                  />
                </div>
                {senderError && (
                  <div
                    role="alert"
                    className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-xs font-semibold text-rose-700"
                  >
                    {senderError}
                  </div>
                )}
                <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setSenderModalOpen(false)}
                    className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={senderBusy}
                    className="px-5 py-2 bg-[#3f3f46] hover:bg-[#27272a] disabled:opacity-50 text-white rounded-lg text-xs font-bold cursor-pointer"
                  >
                    {senderBusy ? 'Verifying Loopback...' : 'Verify & Save Configuration'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </ModalShell>
      )}
    </div>
  );
};
