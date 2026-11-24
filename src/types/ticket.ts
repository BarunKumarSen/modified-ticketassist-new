export type TicketStatus = 'Requested' | 'Open' | 'Approved' | 'Rejected' | 'Closed';

export type TicketPriority = 'Low' | 'Medium' | 'High';

export type TicketApprovalStatus = 'Pending' | 'Approved' | 'Rejected';

export interface SupportTicket {
  id: string;
  employeeId: string;
  assetId: string;
  subject: string;
  description: string;
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: string;
  queueOrder?: number;
  createdByRole?: string;
  requestedDate?: string;
  requestedStartTime?: string;
  requestedDurationMins?: number;
  bookedSlotId?: string;
  workOrderDate?: string;
  workOrderStartTime?: string;
  workOrderDurationMins?: number;
  workOrderEndTime?: string;
  employeeConfirmed?: boolean;
  employeeConfirmedAt?: string;
  workOrderMailSentAt?: string;
  approvalStatus: TicketApprovalStatus;
  approvedBy?: string;
  approvedAt?: string;
  rejectionReason?: string;
  closedBy?: string;
  closedAt?: string;
}
