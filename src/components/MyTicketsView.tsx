import React, { useState } from 'react';
import { CheckCircle2, Inbox, LifeBuoy, Lock, Mail, Search, XCircle } from 'lucide-react';
import type { SupportTicket, TicketPriority, TicketStatus } from '../types/ticket';
import {
  canUserRaiseTicket,
  formatTicketTimestamp,
  type ScopedEmployeeData,
} from '../utils/ticketLogic';
import { useSession } from '../auth/SessionContext';

interface MyTicketsViewProps {
  scopedData: ScopedEmployeeData;
  onRaiseTicket: () => void;
  onCancelTicket: (ticket: SupportTicket) => void;
  onConfirmWorkOrder?: (ticket: SupportTicket) => void;
  onCloseTicket?: (ticket: SupportTicket) => void;
  onSendTicketMail?: (ticket: SupportTicket) => void;
}

const STATUS_BADGE: Record<TicketStatus, { classes: string; dot: string }> = {
  Requested: {
    classes: 'bg-sky-50 text-sky-800 border-sky-200',
    dot: 'bg-sky-500',
  },
  Open: {
    classes: 'bg-amber-100 text-amber-800 border-amber-300',
    dot: 'bg-amber-500',
  },
  Approved: {
    classes: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    dot: 'bg-emerald-500',
  },
  Rejected: {
    classes: 'bg-red-100 text-red-800 border-red-300',
    dot: 'bg-red-500',
  },
  Closed: {
    classes: 'bg-blue-100 text-blue-800 border-blue-300',
    dot: 'bg-blue-500',
  },
};

const PRIORITY_BADGE: Record<TicketPriority, string> = {
  Low: 'bg-slate-100 text-slate-700 border-slate-300',
  Medium: 'bg-amber-50 text-amber-800 border-amber-200',
  High: 'bg-rose-100 text-rose-800 border-rose-300',
};

export const MyTicketsView: React.FC<MyTicketsViewProps> = ({
  scopedData,
  onRaiseTicket,
  onCancelTicket,
  onConfirmWorkOrder,
  onCloseTicket,
  onSendTicketMail,
}) => {
  const { session } = useSession();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<TicketStatus | 'ALL'>('ALL');

  if (!canUserRaiseTicket(session)) {
    return null;
  }

  const assetMap = new Map(scopedData.assets.map((a) => [a.id, a]));
  const q = search.trim().toLowerCase();

  const filteredTickets = scopedData.tickets.filter((t) => {
    if (statusFilter !== 'ALL' && t.status !== statusFilter) return false;
    if (!q) return true;
    const assetName = assetMap.get(t.assetId)?.name || '';
    return (
      t.subject.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.assetId.toLowerCase().includes(q) ||
      assetName.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4 pb-10" data-testid="my-tickets-view">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900">My Tickets</h1>
          <p className="text-xs text-slate-500 mt-1">
            Support tickets &amp; Work Order schedule ({scopedData.tickets.length} total,{' '}
            {scopedData.openTicketsCount} active/requested)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none text-slate-400">
              <Search className="w-3.5 h-3.5" />
            </span>
            <input
              type="text"
              aria-label="Search my tickets"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search subject or asset..."
              className="w-48 pl-8 pr-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <select
            aria-label="Filter my tickets by status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as TicketStatus | 'ALL')}
            className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-100 focus:outline-none cursor-pointer"
          >
            <option value="ALL">All Statuses</option>
            <option value="Requested">Requested</option>
            <option value="Open">Open</option>
            <option value="Approved">Approved</option>
            <option value="Rejected">Rejected</option>
            <option value="Closed">Closed</option>
          </select>

          <button
            type="button"
            onClick={onRaiseTicket}
            disabled={scopedData.assets.length === 0}
            className="px-4 py-1.5 bg-slate-800 hover:bg-slate-900 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-xs font-bold shadow-sm flex items-center gap-1.5 cursor-pointer"
          >
            <LifeBuoy className="w-3.5 h-3.5" />
            <span>Raise Ticket</span>
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                <th className="px-4 py-3">Queue #</th>
                <th className="px-4 py-3">Asset</th>
                <th className="px-4 py-3">Subject &amp; Work Order</th>
                <th className="px-4 py-3">Priority</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filteredTickets.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <Inbox className="w-6 h-6 text-slate-300" />
                      <span>
                        {scopedData.tickets.length === 0
                          ? 'You have not raised any support tickets yet.'
                          : 'No tickets match your current filter.'}
                      </span>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredTickets.map((t, idx) => {
                  const asset = assetMap.get(t.assetId);
                  const statusStyle = STATUS_BADGE[t.status] || STATUS_BADGE.Requested;
                  const priorityStyle = PRIORITY_BADGE[t.priority || 'Medium'];
                  const hasWorkOrder = Boolean(t.workOrderDate && t.workOrderStartTime);
                  const canConfirmWo =
                    hasWorkOrder && !t.employeeConfirmed && t.status !== 'Closed' && t.status !== 'Rejected';
                  const canClose =
                    Boolean(onCloseTicket) &&
                    (t.status === 'Open' || (t.status === 'Approved' && hasWorkOrder));
                  const canCancel = t.status === 'Requested' || t.status === 'Open';

                  return (
                    <tr
                      key={t.id}
                      data-testid={`my-ticket-row-${t.id}`}
                      className="hover:bg-slate-50 transition-colors align-top"
                    >
                      <td className="px-4 py-3 font-mono font-bold text-slate-600 whitespace-nowrap tabular-nums">
                        #{t.queueOrder && t.queueOrder > 0 ? t.queueOrder : idx + 1}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-slate-900 block">
                          {asset?.name || t.assetId}
                        </span>
                        <span className="text-[10px] font-mono text-slate-400">{t.assetId}</span>
                      </td>
                      <td className="px-4 py-3 max-w-md">
                        <p className="font-bold text-slate-900">{t.subject}</p>
                        <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-2">
                          {t.description}
                        </p>
                        {hasWorkOrder && (
                          <div className="mt-1.5 inline-flex flex-wrap items-center gap-1.5 px-2 py-0.5 rounded bg-emerald-50 border border-emerald-200 text-[10px] text-emerald-900 font-semibold tabular-nums">
                            <span>
                              Work Order: {t.workOrderDate} · {t.workOrderStartTime}–
                              {t.workOrderEndTime || '?'} ({t.workOrderDurationMins} mins)
                            </span>
                            {t.employeeConfirmed ? (
                              <span className="text-emerald-700 font-bold">· Confirmed</span>
                            ) : (
                              <span className="text-amber-700 font-bold">· Awaiting Your Confirmation</span>
                            )}
                          </div>
                        )}
                        {!hasWorkOrder && t.requestedDate && (
                          <p className="text-[10px] text-slate-500 mt-1 tabular-nums">
                            Requested slot: {t.requestedDate}
                            {t.requestedStartTime ? ` · ${t.requestedStartTime}` : ''}
                            {t.requestedDurationMins ? ` (${t.requestedDurationMins} mins)` : ''}
                          </p>
                        )}
                        {t.rejectionReason && (
                          <p className="text-[10px] text-red-600 font-semibold mt-1">
                            Rejection reason: {t.rejectionReason}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border ${priorityStyle}`}
                        >
                          {t.priority || 'Medium'}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${statusStyle.classes}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${statusStyle.dot}`} />
                          {t.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 whitespace-nowrap tabular-nums">
                        {(() => {
                          const ts = formatTicketTimestamp(t.createdAt);
                          return (
                            <>
                              <span className="block font-semibold text-slate-800">{ts.date}</span>
                              {ts.time && (
                                <span className="block text-[10px] font-mono text-slate-500">
                                  {ts.time}
                                </span>
                              )}
                            </>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap space-x-1">
                        {onSendTicketMail && (
                          <button
                            type="button"
                            onClick={() => onSendTicketMail(t)}
                            aria-label={`Send email notification for ticket ${t.subject}`}
                            title="Send ticket email"
                            className="inline-flex items-center justify-center w-7 h-7 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 cursor-pointer align-middle"
                          >
                            <Mail className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canConfirmWo && onConfirmWorkOrder && (
                          <button
                            type="button"
                            onClick={() => onConfirmWorkOrder(t)}
                            aria-label={`Confirm work order for ${t.subject}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-emerald-100 hover:bg-emerald-200 text-emerald-800 border border-emerald-200 text-[10px] font-bold cursor-pointer align-middle"
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Confirm Work Order</span>
                          </button>
                        )}
                        {canClose && onCloseTicket && (
                          <button
                            type="button"
                            onClick={() => onCloseTicket(t)}
                            aria-label={`Close ticket ${t.subject}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#dbeafe] hover:bg-[#bfdbfe] text-[#1e40af] text-[10px] font-bold cursor-pointer align-middle"
                          >
                            <Lock className="w-3 h-3" />
                            <span>Close</span>
                          </button>
                        )}
                        {canCancel && (
                          <button
                            type="button"
                            onClick={() => onCancelTicket(t)}
                            aria-label={`Cancel ticket ${t.subject}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-100 hover:bg-red-50 text-slate-700 hover:text-red-700 border border-slate-200 hover:border-red-200 text-[10px] font-bold cursor-pointer align-middle"
                          >
                            <XCircle className="w-3 h-3" />
                            <span>Cancel</span>
                          </button>
                        )}
                        {!canConfirmWo && !canClose && !canCancel && !onSendTicketMail && (
                          <span className="text-[10px] text-slate-400 font-medium">Read-only</span>
                        )}
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
  );
};
