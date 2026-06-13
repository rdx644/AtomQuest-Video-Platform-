import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { getDb } from '../database';
import { generateToken, requireAuth } from '../middleware/auth';

const router = Router();

/**
 * POST /api/auth/login
 */
router.post('/login', (req: Request, res: Response): void => {
  const { username, password } = req.body;
  if (!username || !password) { res.status(400).json({ error: 'Username and password required' }); return; }

  const db = getDb();
  const user = db.users.find(u => u.username === username);
  if (!user) { res.status(401).json({ error: 'Invalid credentials' }); return; }

  if (!bcrypt.compareSync(password, user.password_hash)) {
    res.status(401).json({ error: 'Invalid credentials' }); return;
  }

  const token = generateToken({ userId: user.id, username: user.username, displayName: user.display_name, role: user.role });
  res.json({ token, user: { id: user.id, username: user.username, displayName: user.display_name, role: user.role } });
});

/**
 * GET /api/auth/me
 */
router.get('/me', requireAuth, (req: Request, res: Response): void => {
  res.json({ user: req.user });
});

export default router;
