import pino from 'pino';

// Structured JSON logs to stdout. Render (and most PaaS hosts) already
// capture stdout/stderr into one place per service, so this alone gives you
// "centralized logging" for both processes without any extra infra - it
// also means a real log-shipping/search tool (Better Stack, Axiom, Datadog,
// ...) can be pointed at that log stream later without touching this file,
// since it already emits structured JSON rather than free-form strings.
export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
});
