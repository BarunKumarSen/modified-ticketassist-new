export type EmailDeliveryStatus = 'Queued' | 'Sending' | 'Sent' | 'Failed' | 'Retry';

export type ApprovalEntityType = 'leave' | 'regularization' | 'wfh' | 'profile_change';

export interface EmailLogRecord {
  id: string;
  dedupeKey: string;
  eventType: string;
  recipientEmail: string;
  recipientName: string;
  recipientRole: 'Manager' | 'Employee' | 'System';
  employeeId?: string | null;
  employeeCode?: string | null;
  employeeName?: string | null;
  managerName?: string | null;
  managerEmail?: string | null;
  center?: string | null;
  subject: string;
  htmlBody: string;
  textBody: string;
  status: EmailDeliveryStatus;
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: string | null;
  lastError?: string | null;
  messageId?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt?: string | null;
}

export interface EmailAuditRecord {
  id: string;
  emailLogId?: string | null;
  approvalRequestId?: string | null;
  eventType: string;
  actor: string;
  status: string;
  details: string;
  createdAt: string;
}

export interface ManagerMailReportRow {
  managerName: string;
  managerEmail: string;
  total: number;
  sent: number;
  failed: number;
  queued: number;
  lastActivityAt: string;
}

export interface EmployeeMailReportRow {
  employeeId: string;
  employeeCode: string;
  employeeName: string;
  employeeEmail: string;
  center: string;
  total: number;
  sent: number;
  failed: number;
  queued: number;
  lastActivityAt: string;
}

export interface EmailDashboardSummary {
  total: number;
  sent: number;
  failed: number;
  queued: number;
  retrying: number;
}

export interface MailHealthStatus {
  configured: boolean;
  appName: string;
  from: string;
  smtpHost: string;
  smtpPort: number;
  encryption: string;
  imapHost: string;
  imapPort: number;
  effectiveSource?: 'database' | 'env' | 'default';
  smtpReachable?: boolean;
  smtpMessage?: string;
  imapReachable?: boolean;
  imapMessage?: string;
  lastCheckedAt?: string;
}

export interface MailServerConfigInput {
  newEmail: string;
  smtpHost: string;
  smtpPort?: number;
  imapHost: string;
  imapPort?: number;
  appPassword: string;
  appName: string;
  encryption?: 'tls' | 'ssl' | 'none';
}
