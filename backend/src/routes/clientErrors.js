import { Router } from 'express';
import { z } from 'zod';
import { logger } from '../lib/logger.js';

export const clientErrorsRouter = Router();

const errorSchema = z.object({
  message: z.string().trim().min(1).max(500),
  stack: z.string().trim().max(2000).optional(),
  url: z.string().trim().max(500).optional(),
});

// Public and unauthenticated on purpose - most real frontend errors happen
// to visitors who were never logged in, and this needs to work for them
// too. This is client-reported text, never trusted as more than a hint for
// a human reading logs later - it's logged and nothing else ever acts on
// it programmatically. Covered by the same global rate limiter and 10kb
// body cap as every other route (see app.js).
clientErrorsRouter.post('/', (req, res) => {
  const parsed = errorSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid error report.' });
  const { message, stack, url } = parsed.data;
  (req.log || logger).warn({ clientError: { message, stack, url, userAgent: req.get('user-agent') } }, 'frontend error report');
  res.status(204).end();
});
