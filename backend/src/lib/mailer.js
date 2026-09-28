import nodemailer from 'nodemailer';
import { logger } from './logger.js';

// Transactional email (password reset only, for now). Optional, like
// Turnstile: with nothing configured the feature reports itself as off and
// nothing is sent. Two ways to send, first match wins:
//   - Resend's HTTP API: RESEND_API_KEY + MAIL_FROM (needs a verified domain)
//   - SMTP, e.g. a Gmail app password: SMTP_USER + SMTP_PASS (no domain needed;
//     SMTP_HOST/SMTP_PORT default to Gmail)

const RESEND_URL = 'https://api.resend.com/emails';

let sender = null; // test hook

export function setMailSender(fn) {
  sender = fn;
}

const useResend = () => Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
const useSmtp = () => Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);

export function isMailEnabled() {
  return Boolean(sender || useResend() || useSmtp());
}

let transport = null;
function smtpTransport() {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT) || 465;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 10000,
    });
  }
  return transport;
}

// `html` is optional; `text` is always sent as the plain-text part.
export async function sendMail({ to, subject, text, html }) {
  if (sender) return sender({ to, subject, text, html });
  if (useResend()) {
    const res = await fetch(RESEND_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text, ...(html ? { html } : {}) }),
    });
    if (!res.ok) {
      logger.error({ status: res.status }, 'sending email failed');
      throw new Error('Email could not be sent.');
    }
    return true;
  }
  try {
    await smtpTransport().sendMail({ from: process.env.MAIL_FROM || `AniNest <${process.env.SMTP_USER}>`, to, subject, text, ...(html ? { html } : {}) });
    return true;
  } catch (err) {
    logger.error({ code: err?.code, responseCode: err?.responseCode }, 'sending email over SMTP failed');
    throw new Error('Email could not be sent.');
  }
}
