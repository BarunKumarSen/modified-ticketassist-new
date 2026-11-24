import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import {
  BookOpen,
  CheckCircle2,
  Download,
  FileText,
  History,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
import { apiClient, ApiError } from '../api/client';
import { useSession } from '../auth/SessionContext';
import {
  ALL_EMPLOYMENT_CATEGORIES,
  type EmploymentCategory,
  type ThemePalette,
  type ToastMessage,
} from '../types/asset';
import type { PolicyAcknowledgmentRecord, PolicyDocumentRecord } from '../types/policy';
import { THEME_PALETTES } from '../utils/assetMath';
import { canManagePolicies } from '../utils/hierarchyLogic';
import { formatFileSize } from '../utils/policyLogic';
import { ModalShell } from './AssetModals';

interface PoliciesViewProps {
  theme: ThemePalette;
  initialCategory?: string;
  onNotify: (msg: string, type?: ToastMessage['type']) => void;
}

const DEFAULT_CATEGORIES = ['HR Policy', 'POSH Policy', 'IT Policy', 'Leave Policy', 'Workplace Policy'];

function readPdfAsBase64(file: File): Promise<{ base64: string; fileName: string }> {
  return new Promise((resolve, reject) => {
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      reject(new Error('Please select a valid PDF (.pdf) document.'));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      reject(new Error('PDF file size must be 8 MB or smaller.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('Failed to read selected PDF file.'));
        return;
      }
      const commaIdx = reader.result.indexOf(',');
      const base64 = commaIdx >= 0 ? reader.result.slice(commaIdx + 1) : reader.result;
      resolve({ base64, fileName: file.name });
    };
    reader.onerror = () => reject(new Error('Unable to read the selected file.'));
    reader.readAsDataURL(file);
  });
}

export const PoliciesView: React.FC<PoliciesViewProps> = ({
  theme,
  initialCategory,
  onNotify,
}) => {
  const { session } = useSession();
  const palette = THEME_PALETTES[theme];
  const isAdmin = canManagePolicies(session);

  const [policies, setPolicies] = useState<PolicyDocumentRecord[]>([]);
  const [acknowledgments, setAcknowledgments] = useState<PolicyAcknowledgmentRecord[]>([]);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);
  const [showAcknowledgments, setShowAcknowledgments] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string>('');
  const [pdfUrl, setPdfUrl] = useState<string>('');
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfError, setPdfError] = useState('');
  const [pdfScale, setPdfScale] = useState<number>(1.15);
  const [pdfPageCount, setPdfPageCount] = useState<number>(0);

  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<PolicyDocumentRecord | null>(null);
  const [deletingPolicy, setDeletingPolicy] = useState<PolicyDocumentRecord | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const loadPolicies = useCallback(async () => {
    setLoading(true);
    try {
      const [res, ackRes] = await Promise.all([
        apiClient.listPolicies(),
        apiClient.listPolicyAcknowledgments().catch(() => ({ acknowledgments: [] })),
      ]);
      setPolicies(res.policies);
      setAcknowledgments(ackRes.acknowledgments || []);
      setSelectedId((prev) => {
        if (prev && res.policies.some((p) => p.id === prev)) return prev;
        if (initialCategory) {
          const match = res.policies.find(
            (p) => p.category.toLowerCase() === initialCategory.toLowerCase()
          );
          if (match) return match.id;
        }
        return res.policies[0]?.id || '';
      });
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Failed to load company policies', 'error');
    } finally {
      setLoading(false);
    }
  }, [initialCategory, onNotify]);

  useEffect(() => {
    void loadPolicies();
  }, [loadPolicies]);

  useEffect(() => {
    if (!initialCategory || policies.length === 0) return;
    const match = policies.find((p) => p.category.toLowerCase() === initialCategory.toLowerCase());
    if (match) setSelectedId(match.id);
  }, [initialCategory, policies]);

  const filteredPolicies = useMemo(() => {
    const q = search.trim().toLowerCase();
    return policies.filter(
      (p) =>
        !q ||
        p.title.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
    );
  }, [policies, search]);

  const selectedPolicy = useMemo(
    () => policies.find((p) => p.id === selectedId) || filteredPolicies[0] || null,
    [policies, selectedId, filteredPolicies]
  );

  // Fetch binary PDF via authenticated Bearer fetch -> Uint8Array for canvas PDF viewer + Blob URL for download
  useEffect(() => {
    if (!selectedPolicy) {
      setPdfUrl('');
      setPdfBytes(null);
      setPdfPageCount(0);
      setPdfError('');
      return;
    }

    let cancelled = false;
    let activeObjectUrl = '';
    setPdfLoading(true);
    setPdfError('');

    apiClient
      .fetchPolicyPdfBlob(selectedPolicy.id, false)
      .then(async (blob) => {
        if (cancelled) return;
        const buf = await blob.arrayBuffer();
        if (cancelled) return;
        const bytes = new Uint8Array(buf);
        const typedBlob = new Blob([bytes], { type: 'application/pdf' });
        activeObjectUrl = URL.createObjectURL(typedBlob);
        setPdfUrl(activeObjectUrl);
        setPdfBytes(bytes);
      })
      .catch((err) => {
        if (cancelled) return;
        setPdfUrl('');
        setPdfBytes(null);
        setPdfPageCount(0);
        setPdfError(err instanceof ApiError ? err.message : 'Unable to render policy PDF');
      })
      .finally(() => {
        if (!cancelled) setPdfLoading(false);
      });

    return () => {
      cancelled = true;
      if (activeObjectUrl) URL.revokeObjectURL(activeObjectUrl);
    };
  }, [selectedPolicy?.id, selectedPolicy?.updatedAt, selectedPolicy?.version]);

  const handleDownloadPdf = async (policy: PolicyDocumentRecord) => {
    try {
      const blob = await apiClient.fetchPolicyPdfBlob(policy.id, true);
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = policy.fileName || `${policy.category}-v${policy.version}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
      onNotify(`Downloaded ${policy.fileName}`);
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Failed to download policy PDF', 'error');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingPolicy) return;
    try {
      await apiClient.deletePolicy(deletingPolicy.id);
      onNotify(`Deleted policy "${deletingPolicy.title}"`, 'info');
      setDeletingPolicy(null);
      setSelectedId('');
      await loadPolicies();
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Failed to delete policy', 'error');
    }
  };

  const handleAcknowledge = async (policy: PolicyDocumentRecord) => {
    if (acknowledgingId) return;
    setAcknowledgingId(policy.id);
    try {
      const res = await apiClient.acknowledgePolicy(policy.id);
      setAcknowledgments((prev) => {
        const filtered = prev.filter(
          (a) =>
            !(
              a.policyId === policy.id &&
              a.policyVersion === policy.version &&
              a.userId === res.acknowledgment.userId
            )
        );
        return [res.acknowledgment, ...filtered];
      });
      onNotify(`Acknowledged ${policy.title} (v${policy.version})`);
    } catch (err) {
      onNotify(err instanceof ApiError ? err.message : 'Failed to acknowledge policy', 'error');
    } finally {
      setAcknowledgingId(null);
    }
  };

  const selectedPolicyAcks = useMemo(
    () =>
      selectedPolicy
        ? acknowledgments.filter((a) => a.policyId === selectedPolicy.id)
        : [],
    [acknowledgments, selectedPolicy]
  );

  const myAckForSelected = useMemo(
    () =>
      selectedPolicy && session
        ? acknowledgments.find(
            (a) =>
              a.policyId === selectedPolicy.id &&
              a.policyVersion === selectedPolicy.version &&
              a.userId === session.id
          )
        : undefined,
    [acknowledgments, selectedPolicy, session]
  );

  return (
    <div className="space-y-4 pb-10" data-testid="policies-view">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 dark:text-white">Company Policies</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {isAdmin
              ? 'Manage HR Policy, POSH Policy, IT Policy, role visibility scopes, and versioned PDF acknowledgments'
              : 'Read, acknowledge, and download authorized HR Policy, POSH Policy, and IT Policy documents'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              aria-label="Search policies"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search policy..."
              className={`w-48 pl-8 pr-3 py-1.5 bg-white dark:bg-slate-800 border ${palette.border} dark:border-slate-700 rounded-lg text-xs dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600`}
            />
          </div>

          {isAdmin && (
            <button
              type="button"
              onClick={() => setUploadModalOpen(true)}
              className={`${palette.primaryBtn} ${palette.primaryBtnHover} px-3.5 py-2 rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0`}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Upload Policy PDF</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Split Layout: Policy Selector + Embedded PDF Viewer */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
        {/* Left Policy Directory */}
        <div className={`lg:col-span-4 bg-white dark:bg-slate-900 rounded-xl border ${palette.border} dark:border-slate-800 shadow-sm overflow-hidden`}>
          <div className={`px-4 py-3 ${palette.surfaceBg} dark:bg-slate-800/80 border-b ${palette.border} dark:border-slate-700 flex items-center justify-between`}>
            <span className="text-xs font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
              <BookOpen className="w-4 h-4 text-blue-700 dark:text-blue-400" />
              Policy Categories
            </span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
              {filteredPolicies.length} document(s)
            </span>
          </div>

          {loading ? (
            <div className="p-6 text-center text-xs text-slate-400">Loading policies...</div>
          ) : filteredPolicies.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-400 space-y-2">
              <p>No authorized policy documents available for your category.</p>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setUploadModalOpen(true)}
                  className="px-3 py-1.5 bg-slate-800 text-white rounded-lg text-xs font-semibold cursor-pointer"
                >
                  Upload First Policy
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredPolicies.map((pol) => {
                const active = selectedPolicy?.id === pol.id;
                const isAcked = Boolean(
                  session &&
                    acknowledgments.some(
                      (a) =>
                        a.policyId === pol.id &&
                        a.policyVersion === pol.version &&
                        a.userId === session.id
                    )
                );
                const visibleRoles =
                  pol.visibleRoles && pol.visibleRoles.length > 0
                    ? pol.visibleRoles
                    : [...ALL_EMPLOYMENT_CATEGORIES];
                const allVisible = visibleRoles.length >= ALL_EMPLOYMENT_CATEGORIES.length;

                return (
                  <button
                    key={pol.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(pol.id);
                      setShowHistory(false);
                      setShowAcknowledgments(false);
                    }}
                    className={`w-full p-4 text-left transition-colors cursor-pointer ${
                      active
                        ? `${palette.surfaceBg} dark:bg-slate-800 ring-1 ring-inset ring-blue-300 dark:ring-blue-700`
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold text-blue-700 dark:text-blue-400">{pol.category}</p>
                        <h3 className="text-xs font-extrabold text-slate-900 dark:text-white truncate mt-0.5">
                          {pol.title}
                        </h3>
                      </div>
                      <span className="text-[11px] font-mono font-semibold text-slate-600 dark:text-slate-300 tabular-nums shrink-0">
                        v{pol.version}
                      </span>
                    </div>
                    {pol.description && (
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                        {pol.description}
                      </p>
                    )}
                    {isAdmin && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {allVisible ? (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-[9px] font-semibold">
                            Visible: All Categories
                          </span>
                        ) : (
                          visibleRoles.map((roleName) => (
                            <span
                              key={roleName}
                              className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 text-[9px] font-semibold"
                            >
                              {roleName}
                            </span>
                          ))
                        )}
                      </div>
                    )}
                    <div className="mt-2 flex items-center justify-between gap-1.5 text-[10px] text-slate-400 tabular-nums">
                      <span>
                        Updated {pol.updatedAt.slice(0, 10)} · {formatFileSize(pol.fileSize)}
                      </span>
                      <span
                        className={`px-1.5 py-0.5 rounded font-bold border ${
                          isAcked
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : 'bg-amber-50 text-amber-800 border-amber-200'
                        }`}
                      >
                        {isAcked ? 'Acknowledged' : 'Pending'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Embedded PDF Viewer */}
        <div className={`lg:col-span-8 bg-white dark:bg-slate-900 rounded-xl border ${palette.border} dark:border-slate-800 shadow-sm overflow-hidden`}>
          {selectedPolicy ? (
            <>
              <div className={`p-4 ${palette.surfaceBg} dark:bg-slate-800/70 border-b ${palette.border} dark:border-slate-700 flex flex-col md:flex-row md:items-center justify-between gap-3`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-blue-700 dark:text-blue-400">{selectedPolicy.category}</span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums font-semibold text-slate-700 dark:text-slate-200">
                      Version v{selectedPolicy.version}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">{formatFileSize(selectedPolicy.fileSize)}</span>
                  </div>
                  <h2 className="text-base font-extrabold text-slate-900 dark:text-white mt-0.5 truncate">
                    {selectedPolicy.title}
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 tabular-nums">
                    Uploaded {selectedPolicy.uploadedAt.slice(0, 10)} by {selectedPolicy.uploadedBy}
                    {selectedPolicy.updatedAt !== selectedPolicy.uploadedAt
                      ? ` · Last updated ${selectedPolicy.updatedAt.slice(0, 10)}`
                      : ''}
                  </p>
                  {selectedPolicy.visibleRoles && selectedPolicy.visibleRoles.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1 mt-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 mr-1">
                        Authorized:
                      </span>
                      {selectedPolicy.visibleRoles.map((r) => (
                        <span
                          key={r}
                          className="px-1.5 py-0.5 rounded bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-[10px] font-semibold"
                        >
                          {r}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {myAckForSelected ? (
                    <span
                      data-testid="policy-acknowledged-badge"
                      className="px-3 py-1.5 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-lg text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>Acknowledged (v{selectedPolicy.version})</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={acknowledgingId === selectedPolicy.id}
                      onClick={() => void handleAcknowledge(selectedPolicy)}
                      data-testid="acknowledge-policy-btn"
                      className="px-3 py-1.5 bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>
                        {acknowledgingId === selectedPolicy.id
                          ? 'Recording...'
                          : 'Acknowledge Policy'}
                      </span>
                    </button>
                  )}

                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => setShowAcknowledgments((prev) => !prev)}
                      className="px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Acknowledgments ({selectedPolicyAcks.length})</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setShowHistory((prev) => !prev)}
                    className="px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <History className="w-3.5 h-3.5" />
                    <span>History ({selectedPolicy.history.length || 1})</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleDownloadPdf(selectedPolicy)}
                    className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download PDF</span>
                  </button>

                  {isAdmin && (
                    <>
                      <button
                        type="button"
                        onClick={() => setEditingPolicy(selectedPolicy)}
                        className="px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-lg text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <Pencil className="w-3.5 h-3.5 text-amber-600" />
                        <span>Replace / Update</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingPolicy(selectedPolicy)}
                        aria-label={`Delete policy ${selectedPolicy.title}`}
                        className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg text-xs font-semibold text-rose-800 flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Delete</span>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {selectedPolicy.description && (
                <div className="px-4 py-2.5 border-b border-slate-100 text-xs text-slate-600 bg-white">
                  {selectedPolicy.description}
                </div>
              )}

              {showAcknowledgments && isAdmin && (
                <div className="p-4 border-b border-slate-200 bg-emerald-50/40 space-y-2">
                  <h3 className="text-xs font-extrabold text-slate-800">
                    Policy Acceptance &amp; Acknowledgment Tracker
                  </h3>
                  <div className="overflow-x-auto bg-white border border-slate-200 rounded-lg max-h-56 overflow-y-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                          <th className="px-3 py-2">User Name</th>
                          <th className="px-3 py-2">Role / Category</th>
                          <th className="px-3 py-2">ID</th>
                          <th className="px-3 py-2">Version</th>
                          <th className="px-3 py-2">Acknowledged At</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {selectedPolicyAcks.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="px-3 py-4 text-center text-slate-400">
                              No user acknowledgments recorded yet for this policy.
                            </td>
                          </tr>
                        ) : (
                          selectedPolicyAcks.map((ack) => (
                            <tr key={ack.id}>
                              <td className="px-3 py-2 font-semibold text-slate-800">
                                {ack.userName}
                              </td>
                              <td className="px-3 py-2 text-slate-600">{ack.userRole}</td>
                              <td className="px-3 py-2 font-mono text-slate-500">
                                {ack.employeeId || '—'}
                              </td>
                              <td className="px-3 py-2 font-mono font-bold text-emerald-800">
                                v{ack.policyVersion}
                              </td>
                              <td className="px-3 py-2 font-mono text-slate-500 tabular-nums">
                                {ack.acknowledgedAt.replace('T', ' ').slice(0, 19)}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {showHistory && (
                <div className="p-4 border-b border-slate-200 bg-slate-50/70 space-y-2">
                  <h3 className="text-xs font-extrabold text-slate-800">Version History</h3>
                  <div className="overflow-x-auto bg-white border border-slate-200 rounded-lg">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                          <th className="px-3 py-2">Version</th>
                          <th className="px-3 py-2">File Name</th>
                          <th className="px-3 py-2">Size</th>
                          <th className="px-3 py-2">Uploaded By</th>
                          <th className="px-3 py-2">Date</th>
                          <th className="px-3 py-2">Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(selectedPolicy.history.length > 0
                          ? selectedPolicy.history
                          : [
                              {
                                version: selectedPolicy.version,
                                fileName: selectedPolicy.fileName,
                                fileSize: selectedPolicy.fileSize,
                                uploadedBy: selectedPolicy.uploadedBy,
                                uploadedAt: selectedPolicy.uploadedAt,
                                notes: 'Initial upload',
                              },
                            ]
                        ).map((entry, idx) => (
                          <tr key={`${entry.version}-${idx}`}>
                            <td className="px-3 py-2 font-mono font-bold text-slate-800">
                              v{entry.version}
                            </td>
                            <td className="px-3 py-2 text-slate-700">{entry.fileName}</td>
                            <td className="px-3 py-2 tabular-nums text-slate-500">
                              {formatFileSize(entry.fileSize)}
                            </td>
                            <td className="px-3 py-2 text-slate-700">{entry.uploadedBy}</td>
                            <td className="px-3 py-2 font-mono text-slate-500 tabular-nums">
                              {entry.uploadedAt.slice(0, 10)}
                            </td>
                            <td className="px-3 py-2 text-slate-600">{entry.notes || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Embedded PDF Viewer */}
              <div className="p-4 bg-slate-100/70 space-y-3">
                {pdfLoading ? (
                  <div className="h-[560px] flex items-center justify-center bg-white border border-slate-200 rounded-lg text-xs text-slate-500">
                    Loading PDF document viewer...
                  </div>
                ) : pdfError ? (
                  <div className="h-[360px] flex flex-col items-center justify-center gap-3 bg-white border border-rose-200 rounded-lg p-6 text-center">
                    <FileText className="w-8 h-8 text-rose-500" />
                    <p className="text-xs font-semibold text-rose-700">{pdfError}</p>
                    <button
                      type="button"
                      onClick={() => void handleDownloadPdf(selectedPolicy)}
                      className="px-4 py-2 bg-[#3f3f46] text-white rounded-lg text-xs font-bold cursor-pointer"
                    >
                      Download PDF Directly
                    </button>
                  </div>
                ) : pdfBytes ? (
                  <>
                    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs">
                      <span className="font-mono text-[11px] text-slate-600 tabular-nums">
                        {selectedPolicy.fileName} · {pdfPageCount || 1}{' '}
                        {(pdfPageCount || 1) === 1 ? 'page' : 'pages'}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          aria-label="Zoom out PDF"
                          onClick={() => setPdfScale((s) => Math.max(0.75, Number((s - 0.15).toFixed(2))))}
                          className="p-1.5 rounded border border-slate-200 hover:bg-slate-50 text-slate-700 cursor-pointer"
                        >
                          <ZoomOut className="w-3.5 h-3.5" />
                        </button>
                        <span className="font-mono text-[11px] text-slate-700 tabular-nums min-w-[44px] text-center">
                          {Math.round(pdfScale * 100)}%
                        </span>
                        <button
                          type="button"
                          aria-label="Zoom in PDF"
                          onClick={() => setPdfScale((s) => Math.min(2, Number((s + 0.15).toFixed(2))))}
                          className="p-1.5 rounded border border-slate-200 hover:bg-slate-50 text-slate-700 cursor-pointer"
                        >
                          <ZoomIn className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                    <PdfCanvasRenderer
                      pdfBytes={pdfBytes}
                      scale={pdfScale}
                      title={selectedPolicy.title}
                      onLoadPages={setPdfPageCount}
                      onRenderError={setPdfError}
                      fallbackUrl={pdfUrl}
                    />
                  </>
                ) : (
                  <div className="h-[360px] flex items-center justify-center bg-white border border-slate-200 rounded-lg text-xs text-slate-400">
                    Select a policy document to preview.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="p-12 text-center text-xs text-slate-400">
              Select a policy from the left panel to view its PDF document.
            </div>
          )}
        </div>
      </div>

      {/* Admin Upload New Policy Modal */}
      {uploadModalOpen && isAdmin && (
        <UploadPolicyModal
          headerClass={palette.modalHeader}
          primaryBtnClass={`${palette.primaryBtn} ${palette.primaryBtnHover}`}
          onClose={() => setUploadModalOpen(false)}
          onSaved={async () => {
            setUploadModalOpen(false);
            onNotify('New policy PDF uploaded');
            await loadPolicies();
          }}
          onError={(msg) => onNotify(msg, 'error')}
        />
      )}

      {/* Admin Replace / Update Policy Modal */}
      {editingPolicy && isAdmin && (
        <UpdatePolicyModal
          policy={editingPolicy}
          headerClass={palette.modalHeader}
          primaryBtnClass={`${palette.primaryBtn} ${palette.primaryBtnHover}`}
          onClose={() => setEditingPolicy(null)}
          onSaved={async () => {
            setEditingPolicy(null);
            onNotify('Policy document updated with new version');
            await loadPolicies();
          }}
          onError={(msg) => onNotify(msg, 'error')}
        />
      )}

      {/* Admin Delete Confirmation */}
      {deletingPolicy && isAdmin && (
        <ModalShell
          title="Delete Policy Document"
          icon={<Trash2 className="w-4 h-4 text-rose-300" />}
          headerClass="bg-[#3f3f46]"
          maxWidth="max-w-md"
          onClose={() => setDeletingPolicy(null)}
        >
          <div className="p-6 space-y-4 bg-white">
            <p className="text-xs text-slate-600 leading-relaxed">
              Are you sure you want to permanently remove{' '}
              <strong>{deletingPolicy.title}</strong> ({deletingPolicy.category}, v
              {deletingPolicy.version})?
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingPolicy(null)}
                className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDelete()}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold cursor-pointer"
              >
                Delete Policy
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </div>
  );
};

const UploadPolicyModal: React.FC<{
  headerClass: string;
  primaryBtnClass: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string) => void;
}> = ({ headerClass, primaryBtnClass, onClose, onSaved, onError }) => {
  const [category, setCategory] = useState('HR Policy');
  const [customCategory, setCustomCategory] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [version, setVersion] = useState('1.0');
  const [notes, setNotes] = useState('Initial policy publication');
  const [fileName, setFileName] = useState('');
  const [contentBase64, setContentBase64] = useState('');
  const [visibleRoles, setVisibleRoles] = useState<EmploymentCategory[]>([
    ...ALL_EMPLOYMENT_CATEGORIES,
  ]);
  const [saving, setSaving] = useState(false);

  const allSelected = visibleRoles.length === ALL_EMPLOYMENT_CATEGORIES.length;

  const toggleRoleScope = (cat: EmploymentCategory) => {
    setVisibleRoles((prev) =>
      prev.includes(cat) ? prev.filter((r) => r !== cat) : [...prev, cat]
    );
  };

  const handleToggleAllRoles = () => {
    setVisibleRoles(allSelected ? [] : [...ALL_EMPLOYMENT_CATEGORIES]);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await readPdfAsBase64(file);
      setFileName(res.fileName);
      setContentBase64(res.base64);
      if (!title.trim()) {
        setTitle(res.fileName.replace(/\.pdf$/i, '').replace(/[-_]+/g, ' '));
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Invalid PDF file');
      e.target.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalCategory = category === '__custom__' ? customCategory.trim() : category;
    if (!finalCategory || !title.trim() || !contentBase64) {
      onError('Category, Title, and PDF file are required.');
      return;
    }
    if (visibleRoles.length === 0) {
      onError('Select at least one authorized visibility category.');
      return;
    }
    setSaving(true);
    try {
      await apiClient.createPolicy({
        category: finalCategory,
        title: title.trim(),
        description: description.trim(),
        version: version.trim() || '1.0',
        fileName: fileName || `${finalCategory}.pdf`,
        contentBase64,
        notes: notes.trim(),
        visibleRoles,
      });
      await onSaved();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Failed to upload policy PDF');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title="Upload New Policy PDF"
      icon={<Upload className="w-4 h-4 text-emerald-400" />}
      headerClass={headerClass}
      maxWidth="max-w-lg"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-4 bg-white">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Policy Category *
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            >
              {DEFAULT_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value="__custom__">Other (Custom Category)</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Initial Version *
            </label>
            <input
              type="text"
              required
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="1.0"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono"
            />
          </div>
        </div>

        {category === '__custom__' && (
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Custom Category Name *
            </label>
            <input
              type="text"
              required
              value={customCategory}
              onChange={(e) => setCustomCategory(e.target.value)}
              placeholder="e.g. Travel & Expense Policy"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
        )}

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Policy Title *
          </label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Employee Travel Reimbursement Policy"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
          />
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Description
          </label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief summary of policy scope..."
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
          />
        </div>

        <div>
          <label
            htmlFor="policy-pdf-upload"
            className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
          >
            PDF Document *
          </label>
          <input
            id="policy-pdf-upload"
            type="file"
            accept=".pdf,application/pdf"
            required
            onChange={handleFileChange}
            className="w-full text-xs text-slate-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-slate-50 file:text-slate-700 hover:file:bg-slate-100"
          />
          {fileName && (
            <p className="mt-1 text-[11px] font-semibold text-emerald-700">Selected: {fileName}</p>
          )}
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Version Notes
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
          />
        </div>

        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
              Policy Visibility (Authorized Categories) *
            </span>
            <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-700 cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={handleToggleAllRoles}
                className="rounded border-slate-300"
              />
              <span>Select All</span>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {ALL_EMPLOYMENT_CATEGORIES.map((cat) => (
              <label
                key={cat}
                className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={visibleRoles.includes(cat)}
                  onChange={() => toggleRoleScope(cat)}
                  className="rounded border-slate-300 shrink-0"
                />
                <span className="leading-tight">{cat}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || !contentBase64 || visibleRoles.length === 0}
            className={`${primaryBtnClass} px-5 py-2 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50`}
          >
            {saving ? 'Uploading...' : 'Upload Policy PDF'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

const UpdatePolicyModal: React.FC<{
  policy: PolicyDocumentRecord;
  headerClass: string;
  primaryBtnClass: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onError: (msg: string) => void;
}> = ({ policy, headerClass, primaryBtnClass, onClose, onSaved, onError }) => {
  const [category, setCategory] = useState(policy.category);
  const [title, setTitle] = useState(policy.title);
  const [description, setDescription] = useState(policy.description);
  const [versionBump, setVersionBump] = useState<'minor' | 'major'>('minor');
  const [notes, setNotes] = useState('');
  const [fileName, setFileName] = useState('');
  const [contentBase64, setContentBase64] = useState('');
  const [visibleRoles, setVisibleRoles] = useState<EmploymentCategory[]>(
    policy.visibleRoles && policy.visibleRoles.length > 0
      ? [...policy.visibleRoles]
      : [...ALL_EMPLOYMENT_CATEGORIES]
  );
  const [saving, setSaving] = useState(false);

  const allSelected = visibleRoles.length === ALL_EMPLOYMENT_CATEGORIES.length;

  const toggleRoleScope = (cat: EmploymentCategory) => {
    setVisibleRoles((prev) =>
      prev.includes(cat) ? prev.filter((r) => r !== cat) : [...prev, cat]
    );
  };

  const handleToggleAllRoles = () => {
    setVisibleRoles(allSelected ? [] : [...ALL_EMPLOYMENT_CATEGORIES]);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const res = await readPdfAsBase64(file);
      setFileName(res.fileName);
      setContentBase64(res.base64);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Invalid PDF file');
      e.target.value = '';
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    if (visibleRoles.length === 0) {
      onError('Select at least one authorized visibility category.');
      return;
    }
    setSaving(true);
    try {
      await apiClient.updatePolicy(policy.id, {
        category: category.trim(),
        title: title.trim(),
        description: description.trim(),
        fileName: fileName || undefined,
        contentBase64: contentBase64 || undefined,
        versionBump,
        notes: notes.trim() || (contentBase64 ? 'Replaced PDF document' : 'Updated metadata'),
        visibleRoles,
      });
      await onSaved();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Failed to update policy');
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      title={`Update Policy — ${policy.category} (v${policy.version})`}
      icon={<Pencil className="w-4 h-4 text-emerald-400" />}
      headerClass={headerClass}
      maxWidth="max-w-lg"
      onClose={onClose}
    >
      <form onSubmit={handleSubmit} className="p-6 space-y-4 bg-white">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Category *
            </label>
            <input
              type="text"
              required
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Version Increment
            </label>
            <select
              value={versionBump}
              onChange={(e) => setVersionBump(e.target.value as 'minor' | 'major')}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
            >
              <option value="minor">Minor Revision (+0.1)</option>
              <option value="major">Major Revision (+1.0)</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Title *
          </label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
          />
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Description
          </label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
          />
        </div>

        <div>
          <label
            htmlFor="replace-policy-pdf"
            className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1"
          >
            Replace PDF File (Optional)
          </label>
          <input
            id="replace-policy-pdf"
            type="file"
            accept=".pdf,application/pdf"
            onChange={handleFileChange}
            className="w-full text-xs text-slate-700 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-slate-300 file:text-xs file:font-semibold file:bg-slate-50 file:text-slate-700 hover:file:bg-slate-100"
          />
          <p className="mt-1 text-[10px] text-slate-500">
            Current file: {policy.fileName} {fileName ? `→ New file: ${fileName}` : ''}
          </p>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
            Change Notes
          </label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Summarize changes in this policy revision..."
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs"
          />
        </div>

        <div className="p-3 rounded-lg border border-slate-200 bg-slate-50 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
              Policy Visibility (Authorized Categories) *
            </span>
            <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-blue-700 cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={handleToggleAllRoles}
                className="rounded border-slate-300"
              />
              <span>Select All</span>
            </label>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {ALL_EMPLOYMENT_CATEGORIES.map((cat) => (
              <label
                key={cat}
                className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={visibleRoles.includes(cat)}
                  onChange={() => toggleRoleScope(cat)}
                  className="rounded border-slate-300 shrink-0"
                />
                <span className="leading-tight">{cat}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-slate-300 rounded-lg text-xs font-semibold text-slate-700 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving || visibleRoles.length === 0}
            className={`${primaryBtnClass} px-5 py-2 rounded-lg text-xs font-bold cursor-pointer disabled:opacity-50`}
          >
            {saving ? 'Updating...' : 'Save Policy Update'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
};

const PdfCanvasRenderer: React.FC<{
  pdfBytes: Uint8Array;
  scale: number;
  title: string;
  onLoadPages: (pages: number) => void;
  onRenderError: (msg: string) => void;
  fallbackUrl?: string;
}> = ({ pdfBytes, scale, title, onLoadPages, onRenderError, fallbackUrl }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [rendering, setRendering] = useState(true);
  const [useIframeFallback, setUseIframeFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let loadingTask: pdfjsLib.PDFDocumentLoadingTask | null = null;

    const renderPdf = async () => {
      const container = containerRef.current;
      if (!container) return;
      setRendering(true);
      setUseIframeFallback(false);

      try {
        loadingTask = pdfjsLib.getDocument({ data: pdfBytes.slice() });
        const pdfDoc = await loadingTask.promise;
        if (cancelled) return;
        onLoadPages(pdfDoc.numPages);

        container.innerHTML = '';
        const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;

        for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
          if (cancelled) break;
          const page = await pdfDoc.getPage(pageNum);
          if (cancelled) break;

          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.setAttribute('aria-label', `${title} — Page ${pageNum}`);
          canvas.width = Math.floor(viewport.width * dpr);
          canvas.height = Math.floor(viewport.height * dpr);
          canvas.style.width = `${Math.floor(viewport.width)}px`;
          canvas.style.height = `${Math.floor(viewport.height)}px`;
          canvas.className = 'mx-auto bg-white shadow-sm rounded border border-slate-200 block max-w-full h-auto';

          const ctx = canvas.getContext('2d');
          if (!ctx) continue;

          container.appendChild(canvas);
          await page.render({
            canvas,
            canvasContext: ctx,
            viewport,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
          }).promise;
        }
      } catch (err) {
        if (!cancelled) {
          if (fallbackUrl) {
            setUseIframeFallback(true);
          } else {
            onRenderError(err instanceof Error ? err.message : 'Unable to display PDF pages');
          }
        }
      } finally {
        if (!cancelled) setRendering(false);
      }
    };

    void renderPdf();

    return () => {
      cancelled = true;
      if (loadingTask) {
        void loadingTask.destroy().catch(() => undefined);
      }
    };
  }, [pdfBytes, scale, title, onLoadPages, onRenderError, fallbackUrl]);

  if (useIframeFallback && fallbackUrl) {
    return (
      <iframe
        data-testid="policy-pdf-iframe"
        title={`${title} PDF Viewer`}
        src={fallbackUrl}
        className="w-full h-[580px] rounded-lg border border-slate-200 bg-white"
      />
    );
  }

  return (
    <div
      data-testid="policy-pdf-canvas-viewer"
      className="relative w-full h-[580px] overflow-y-auto rounded-lg border border-slate-200 bg-slate-200/70 p-4"
    >
      {rendering && (
        <div className="text-center text-xs text-slate-500 py-2">Rendering PDF pages...</div>
      )}
      <div ref={containerRef} className="space-y-4" />
    </div>
  );
};

