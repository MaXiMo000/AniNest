import { logger } from './logger.js';

// Transactional email (password reset only, for now) through Resend's HTTP
// API. Optional, like Turnstile: with RESEND_API_KEY or MAIL_FROM unset the
// feature reports itself as off and nothing is sent. Free tier at resend.com.

const RESEND_URL = 'https://api.resend.com/emails';

let sender = null; // test hook

export function setMailSender(fn) {
  sender = fn;
}

export function isMailEnabled() {
  return Boolean(sender || (process.env.RESEND_API_KEY && process.env.MAIL_FROM));
}

export async function sendMail({ to, subject, text }) {
  if (sender) return sender({ to, subject, text });
  const res = await fetch(RESEND_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.MAIL_FROM, to: [to], subject, text }),
  });
  if (!res.ok) {
    logger.error({ status: res.status }, 'sending email failed');
    throw new Error('Email could not be sent.');
  }
  return true;
}
