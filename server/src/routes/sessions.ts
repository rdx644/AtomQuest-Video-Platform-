import { Router, Request, Response } from 'express';
import { requireAuth, requireRole, generateToken } from '../middleware/auth';
import * as sessionManager from '../services/sessionManager';
import * as chatService from '../services/chatService';
import { config } from '../config';

const router = Router();

/**
 * POST /api/sessions
 * Agent creates a new session.
 */
router.post('/', requireAuth, requireRole('agent', 'admin'), (req: Request, res: Response): void => {
  const { graceTimeout } = req.body;
  const session = sessionManager.createSession(
    req.user!.userId,
    graceTimeout || config.graceTimeoutSeconds
  );

  // Generate the customer invite URL
  const inviteUrl = `${config.corsOrigin}/join/${session.invite_token}`;

  res.status(201).json({
    session,
    inviteUrl,
    inviteToken: session.invite_token,
  });
});

/**
 * GET /api/sessions
 * Get sessions for the current user.
 */
router.get('/', requireAuth, (req: Request, res: Response): void => {
  let sessions;
  if (req.user!.role === 'admin') {
    const status = req.query.status as string | undefined;
    sessions = sessionManager.getAllSessions(status);
  } else {
    sessions = sessionManager.getAgentSessions(req.user!.userId);
  }
  res.json({ sessions });
});

/**
 * GET /api/sessions/live
 * Get all live/active sessions (admin/agent view).
 */
router.get('/live', requireAuth, requireRole('agent', 'admin'), (req: Request, res: Response): void => {
  const sessions = sessionManager.getLiveSessions();
  res.json({ sessions });
});

/**
 * GET /api/sessions/metrics/summary
 * Get session metrics. (MUST be before /:id to avoid wildcard match)
 */
router.get('/metrics/summary', requireAuth, requireRole('admin'), (req: Request, res: Response): void => {
  const metrics = sessionManager.getSessionMetrics();
  res.json(metrics);
});

/**
 * POST /api/sessions/join/:token
 * Customer joins a session via invite token. (MUST be before /:id to avoid wildcard match)
 * No auth required — customers use invite tokens.
 */
router.post('/join/:token', (req: Request, res: Response): void => {
  const { customerName } = req.body;
  const session = sessionManager.getSessionByToken(req.params.token);

  if (!session) {
    res.status(404).json({ error: 'Invalid invite link' });
    return;
  }
  if (session.status === 'ENDED') {
    res.status(400).json({ error: 'This session has ended' });
    return;
  }

  const name = customerName || 'Customer';

  // Generate customer JWT
  const customerToken = generateToken({
    userId: `customer-${Date.now()}`,
    username: name.toLowerCase().replace(/\s+/g, '-'),
    displayName: name,
    role: 'customer',
    sessionId: session.id,
  });

  // Update session
  const updatedSession = sessionManager.customerJoinSession(session.id, name);

  res.json({
    token: customerToken,
    session: updatedSession,
  });
});

/**
 * GET /api/sessions/:id
 * Get a specific session.
 */
router.get('/:id', requireAuth, (req: Request, res: Response): void => {
  const session = sessionManager.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  res.json({ session });
});

/**
 * POST /api/sessions/:id/invite
 * Generate a customer invite token for a session.
 */
router.post('/:id/invite', requireAuth, requireRole('agent', 'admin'), (req: Request, res: Response): void => {
  const session = sessionManager.getSession(req.params.id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  if (session.status === 'ENDED') {
    res.status(400).json({ error: 'Session has ended' });
    return;
  }

  // Generate customer JWT token scoped to this session
  const customerToken = generateToken({
    userId: `customer-${Date.now()}`,
    username: 'customer',
    displayName: req.body.customerName || 'Customer',
    role: 'customer',
    sessionId: session.id,
  });

  const inviteUrl = `${config.corsOrigin}/join/${session.invite_token}`;

  res.json({
    customerToken,
    inviteUrl,
    inviteToken: session.invite_token,
  });
});

/**
 * POST /api/sessions/:id/end
 * Agent or admin ends a session.
 */
router.post('/:id/end', requireAuth, requireRole('agent', 'admin'), (req: Request, res: Response): void => {
  const session = sessionManager.endSession(req.params.id, req.user!.userId);
  if (!session) {
    res.status(404).json({ error: 'Session not found or already ended' });
    return;
  }
  res.json({ session });
});

/**
 * POST /api/sessions/:id/force-end
 * Admin force-ends a session.
 */
router.post('/:id/force-end', requireAuth, requireRole('admin'), (req: Request, res: Response): void => {
  const session = sessionManager.forceEndSession(req.params.id, req.user!.userId);
  if (!session) {
    res.status(404).json({ error: 'Session not found or already ended' });
    return;
  }
  res.json({ session });
});

/**
 * GET /api/sessions/:id/events
 * Get session events (audit trail).
 */
router.get('/:id/events', requireAuth, (req: Request, res: Response): void => {
  const events = sessionManager.getSessionEvents(req.params.id);
  res.json({ events });
});

/**
 * GET /api/sessions/:id/messages
 * Get chat messages for a session.
 */
router.get('/:id/messages', requireAuth, (req: Request, res: Response): void => {
  const messages = chatService.getSessionMessages(req.params.id);
  res.json({ messages });
});

export default router;
