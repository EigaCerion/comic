import { Router } from 'express';
import asyncHandler from '../utils/asyncHandler.js';
import { wajibKemampuan } from '../middleware/auth.js';
import { parsePositiveInt } from '../utils/validators.js';
import searchService from '../services/searchService.js';

const router = Router();

// GET /api/search?q=naruto
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const q = String(req.query.q ?? req.query.query ?? '');
    const limit = parsePositiveInt(req.query.limit, 20, { max: 50 });
    res.json({ query: q, items: searchService.searchComics(q, limit) });
  }),
);

// GET /api/search/genres — facet genre untuk filter Browse
router.get(
  '/genres',
  asyncHandler(async (_req, res) => {
    res.json({ items: searchService.listGenres() });
  }),
);

// POST /api/search/rebuild-index
router.post(
  '/rebuild-index',
  wajibKemampuan('kelola_koleksi'),
  asyncHandler(async (_req, res) => {
    res.json(searchService.rebuildSearchIndex());
  }),
);

export default router;
