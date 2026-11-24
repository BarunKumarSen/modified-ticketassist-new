import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';
import type { Attachment } from 'nodemailer/lib/mailer';
import { ImapFlow } from 'imapflow';
import { getMailConfigFromDb, type AppDatabase } from '../src/db/sqlite.ts';
import type { MailHealthStatus } from '../src/types/mail.ts';
import { COMPANY_LOGO_CID } from './emailTemplates.ts';

export interface RuntimeMailConfig {
  appName: string;
  from: string;
  host: string;
  port: number;
  username: string;
  password: string;
  encryption: 'tls' | 'ssl' | 'none';
  imapHost: string;
  imapPort: number;
}

export const ADMIN_MAIL_CONFIG_ERROR =
  'Wrong input provided. Please put the correct input in order to setup the Admin automated mail system.';
export const ADMIN_MAIL_CONFIG_SUCCESS = 'The mail configuration for Admin is successful';

export function getMailConfigFromEnv(): RuntimeMailConfig {
  const port = Number(process.env.MAIL_PORT || 587) || 587;
  const rawEnc = (process.env.MAIL_ENCRYPTION || (port === 465 ? 'ssl' : 'tls')).toLowerCase();
  const encryption: 'tls' | 'ssl' | 'none' =
    rawEnc === 'ssl' ? 'ssl' : rawEnc === 'none' ? 'none' : 'tls';

  return {
    appName: process.env.MAIL_APP_NAME || 'Mail',
    from: process.env.MAIL_FROM || process.env.MAIL_USERNAME || '',
    host: process.env.MAIL_HOST || 'smtp.gmail.com',
    port,
    username: process.env.MAIL_USERNAME || process.env.MAIL_FROM || '',
    password: process.env.MAIL_PASSWORD || '',
    encryption,
    imapHost: process.env.IMAP_HOST || 'imap.gmail.com',
    imapPort: Number(process.env.IMAP_PORT || 993) || 993,
  };
}

export function getEffectiveMailConfig(db?: AppDatabase): {
  config: RuntimeMailConfig;
  effectiveSource: 'database' | 'env' | 'default';
} {
  const envCfg = getMailConfigFromEnv();
  const dbCfg = db ? getMailConfigFromDb(db) : null;

  if (dbCfg && dbCfg.appPassword && dbCfg.fromEmail && dbCfg.smtpHost) {
    return {
      effectiveSource: 'database',
      config: {
        appName: dbCfg.appName || envCfg.appName || 'Median Asset & HR Suite',
        from: dbCfg.fromEmail,
        host: dbCfg.smtpHost,
        port: dbCfg.smtpPort || 587,
        username: dbCfg.username || dbCfg.fromEmail,
        password: dbCfg.appPassword,
        encryption: dbCfg.encryption || 'tls',
        imapHost: dbCfg.imapHost || envCfg.imapHost || 'imap.gmail.com',
        imapPort: dbCfg.imapPort || 993,
      },
    };
  }

  if (envCfg.host && envCfg.username && envCfg.password) {
    return {
      effectiveSource: 'env',
      config: {
        ...envCfg,
        from: envCfg.from || dbCfg?.fromEmail || 'barunkumarsenbks1997@gmail.com',
      },
    };
  }

  return {
    effectiveSource: 'default',
    config: {
      ...envCfg,
      appName: dbCfg?.appName || envCfg.appName || 'Median Asset & HR Suite',
      from: dbCfg?.fromEmail || envCfg.from || 'barunkumarsenbks1997@gmail.com',
      host: dbCfg?.smtpHost || envCfg.host || 'smtp.gmail.com',
      port: dbCfg?.smtpPort || envCfg.port || 587,
      encryption: dbCfg?.encryption || envCfg.encryption || 'tls',
      imapHost: dbCfg?.imapHost || envCfg.imapHost || 'imap.gmail.com',
      imapPort: dbCfg?.imapPort || envCfg.imapPort || 993,
      username: dbCfg?.username || dbCfg?.fromEmail || envCfg.username || 'barunkumarsenbks1997@gmail.com',
      password: dbCfg?.appPassword || envCfg.password || '',
    },
  };
}

export function getPublicMailStatus(db?: AppDatabase): MailHealthStatus {
  const { config: cfg, effectiveSource } = getEffectiveMailConfig(db);
  return {
    configured: Boolean(cfg.host && cfg.username && cfg.password),
    appName: cfg.appName,
    from: cfg.from || 'barunkumarsenbks1997@gmail.com',
    smtpHost: cfg.host,
    smtpPort: cfg.port,
    encryption: cfg.encryption.toUpperCase(),
    imapHost: cfg.imapHost,
    imapPort: cfg.imapPort,
    effectiveSource,
  };
}

export type TestMailTransportFn = (msg: {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}) => Promise<{ messageId: string }>;

let customTestTransport: TestMailTransportFn | null = null;

export function setMailTransportForTest(fn: TestMailTransportFn | null): void {
  customTestTransport = fn;
}

export function hasCustomTestMailTransport(): boolean {
  return customTestTransport !== null;
}

function getLogoAttachment(): Attachment | null {
  const logoPath = path.resolve(
    process.cwd(),
    'public/assets/aistudio/Median_logo_Final_Small__1__69ba70f6.jpg'
  );
  if (!fs.existsSync(logoPath)) {
    return null;
  }
  return {
    filename: 'median-logo.jpg',
    path: logoPath,
    cid: COMPANY_LOGO_CID,
    contentDisposition: 'inline',
  };
}

function createSmtpTransporter(cfg: RuntimeMailConfig) {
  const isSsl = cfg.encryption === 'ssl' || cfg.port === 465;
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: isSsl,
    requireTLS: cfg.encryption === 'tls' && !isSsl,
    auth: {
      user: cfg.username,
      pass: cfg.password,
    },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}

export async function sendMailViaSmtp(params: {
  to: string;
  subject: string;
  html: string;
  text: string;
  db?: AppDatabase;
  configOverride?: RuntimeMailConfig;
}): Promise<{ messageId: string }> {
  const cfg = params.configOverride || getEffectiveMailConfig(params.db).config;
  const fromHeader = cfg.from
    ? `"Median Research & Consulting · ${cfg.appName}" <${cfg.from}>`
    : `"Median Research & Consulting · ${cfg.appName}" <no-reply@medianresearch.local>`;

  if (customTestTransport) {
    return customTestTransport({
      from: cfg.from || 'barunkumarsenbks1997@gmail.com',
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    });
  }

  if (!cfg.host || !cfg.username || !cfg.password) {
    throw new Error(
      'SMTP credentials are missing in environment variables or Admin Mail Config (MAIL_HOST, MAIL_USERNAME, MAIL_PASSWORD).'
    );
  }

  const transporter = createSmtpTransporter(cfg);
  const logoAttachment = getLogoAttachment();

  const info = await transporter.sendMail({
    from: fromHeader,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
    attachments: logoAttachment ? [logoAttachment] : undefined,
  });

  return {
    messageId: info.messageId || `smtp-${Date.now()}`,
  };
}

export async function verifySmtpConnection(
  db?: AppDatabase,
  configOverride?: RuntimeMailConfig
): Promise<{ ok: boolean; details: string }> {
  const cfg = configOverride || getEffectiveMailConfig(db).config;
  if (!cfg.host || !cfg.username || !cfg.password) {
    if (customTestTransport && !configOverride) {
      return { ok: true, details: 'Mock SMTP test transport active.' };
    }
    return {
      ok: false,
      details: 'SMTP credentials (MAIL_HOST, MAIL_USERNAME, MAIL_PASSWORD) not configured.',
    };
  }
  if (customTestTransport) {
    return { ok: true, details: 'Mock SMTP test transport active.' };
  }
  try {
    const transporter = createSmtpTransporter(cfg);
    await transporter.verify();
    return {
      ok: true,
      details: `Connected to SMTP ${cfg.host}:${cfg.port} (${cfg.encryption.toUpperCase()}) as ${cfg.username}.`,
    };
  } catch (err) {
    return {
      ok: false,
      details: err instanceof Error ? err.message : 'SMTP connection failed.',
    };
  }
}

export async function verifyAndSyncImap(
  db?: AppDatabase,
  configOverride?: RuntimeMailConfig
): Promise<{
  ok: boolean;
  details: string;
  mailboxMessages?: number;
}> {
  const cfg = configOverride || getEffectiveMailConfig(db).config;
  if (!cfg.imapHost || !cfg.username || !cfg.password) {
    if (customTestTransport && !configOverride) {
      return {
        ok: true,
        details: 'Mock IMAP test transport active (INBOX reachable).',
        mailboxMessages: 0,
      };
    }
    return {
      ok: false,
      details: 'IMAP credentials (IMAP_HOST, MAIL_USERNAME, MAIL_PASSWORD) not configured.',
    };
  }
  if (customTestTransport) {
    return {
      ok: true,
      details: 'Mock IMAP test transport active (INBOX reachable).',
      mailboxMessages: 0,
    };
  }

  const client = new ImapFlow({
    host: cfg.imapHost,
    port: cfg.imapPort,
    secure: cfg.imapPort === 993,
    auth: {
      user: cfg.username,
      pass: cfg.password,
    },
    logger: false,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 12000,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    let exists = 0;
    try {
      exists = typeof client.mailbox === 'object' && client.mailbox ? client.mailbox.exists || 0 : 0;
    } finally {
      lock.release();
    }
    await client.logout();
    return {
      ok: true,
      details: `Connected to IMAP ${cfg.imapHost}:${cfg.imapPort} INBOX (${exists} messages).`,
      mailboxMessages: exists,
    };
  } catch (err) {
    try {
      client.close();
    } catch {
      // Ignore close errors
    }
    return {
      ok: false,
      details: err instanceof Error ? err.message : 'IMAP connection failed.',
    };
  }
}

/**
 * Performs live loopback verification (SMTP verify + IMAP connect + self-test email newEmail -> newEmail).
 */
export async function sendLiveLoopbackVerification(cfg: RuntimeMailConfig): Promise<
  | { ok: true; messageId: string; message: string }
  | { ok: false; error: string; details: string }
> {
  if (
    !cfg.from ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cfg.from.trim()) ||
    !cfg.host.trim() ||
    !cfg.imapHost.trim() ||
    !cfg.password.trim() ||
    !cfg.appName.trim()
  ) {
    return {
      ok: false,
      error: ADMIN_MAIL_CONFIG_ERROR,
      details: 'Missing or invalid SMTP Host, IMAP Host, App Password, App Name, or Email.',
    };
  }

  const smtpCheck = await verifySmtpConnection(undefined, cfg);
  if (!smtpCheck.ok) {
    return { ok: false, error: ADMIN_MAIL_CONFIG_ERROR, details: smtpCheck.details };
  }

  const imapCheck = await verifyAndSyncImap(undefined, cfg);
  if (!imapCheck.ok) {
    return { ok: false, error: ADMIN_MAIL_CONFIG_ERROR, details: imapCheck.details };
  }

  try {
    const res = await sendMailViaSmtp({
      to: cfg.from.trim(),
      subject: `Admin Mail Configuration Verified · ${cfg.appName.trim()}`,
      text: ADMIN_MAIL_CONFIG_SUCCESS,
      html: `<p>${ADMIN_MAIL_CONFIG_SUCCESS}</p>`,
      configOverride: cfg,
    });
    return {
      ok: true,
      messageId: res.messageId,
      message: ADMIN_MAIL_CONFIG_SUCCESS,
    };
  } catch (err) {
    return {
      ok: false,
      error: ADMIN_MAIL_CONFIG_ERROR,
      details: err instanceof Error ? err.message : 'Loopback verification failed.',
    };
  }
}
