import { Router, raw } from 'express';
import { traceMoeSearch } from '../lib/traceMoe.js';

export const screenshotSearchRouter = Router();

function asyncRoute(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// The image is the whole request body (no multipart/form-data, no multer
// dependency needed) - the frontend POSTs the raw file bytes with its own
// Content-Type, same as it arrived from the <input type="file">.
screenshotSearchRouter.post(
  '/',
  raw({ type: ALLOWED_TYPES, limit: MAX_IMAGE_BYTES }),
  asyncRoute(async (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length) {
      return res.status(400).json({ error: 'Upload a JPEG, PNG, or WebP screenshot.' });
    }
    const results = await traceMoeSearch(req.body, req.get('Content-Type'));
    res.json({ results });
  }),
);
