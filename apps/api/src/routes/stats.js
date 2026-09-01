import { Router } from 'express';
import asyncHandler from '../utils/asyncHandler.js';
import statsService from '../services/statsService.js';

const router = Router();

// GET /api/stats — dipakai halaman Settings (storage & kompresi)
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json(await statsService.getStats());
  }),
);

export default router;
