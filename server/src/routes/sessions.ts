import { Router, Request, Response } from 'express';
import { requireAuth, requireRole, generateToken } from '../middleware/auth';
import * as sessionManager from '../services/sessionManager';
import * as chatService from '../services/chatService';
import { canAccessSession, canManageSession, getCustomerUserId } from '../services/accessControl';
import { config } from '../config';

const router = Router();

function getPublicOrigin(req: Request): string {
  const configuredOrigin = config.publicOrigin || config.corsOrigin;
  if (configuredOrigin && !configuredOrigin.includes('localhost')) return configuredOrigin.replace(/\/$/, '');

  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || req.get('host');
  if (host) {
    const protocol = forwardedProto || req.protocol;
    return `${protocol}://${host}`.replace(/\/$/, '');
  }

  return configuredOrigin.replace(/\/$/, '');
}

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
  const inviteUrl = `${getPublicOrigin(req)}/join/${session.invite_token}`;

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
  } else if (req.user!.role === 'customer' && req.user!.sessionId) {
    const session = sessionManager.getSession(req.user!.sessionId);
    sessions = session ? [session] : [];
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
  const sessions = sessionManager
    .getLiveSessions()
    .filter((session: any) => req.user!.role === 'admin' || session.agent_id === req.user!.userId);
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
  const session = sessionManager.getSessionByToken(String(req.params.token));

  if (!session) {
    res.status(404).json({ error: 'Invalid invite link' });
    return;
  }
  if (session.status === 'ENDED') {
    res.status(400).json({ error: 'This session has ended' });
    return;
  }
  if (session.status === 'ACTIVE' && session.customer_name) {
    res.status(409).json({ error: 'A customer is already connected to this session' });
    return;
  }

  const name = customerName || 'Customer';
  const customerUserId = getCustomerUserId(session.id);

  // Generate customer JWT
  const customerToken = generateToken({
    userId: customerUserId,
    username: name.toLowerCase().replace(/\s+/g, '-'),
    displayName: name,
    role: 'customer',
    sessionId: session.id,
  });

  // Update session
  const updatedSession = sessionManager.customerJoinSession(session.id, name);
  if (!updatedSession) {
    res.status(409).json({ error: 'Unable to join this session at the moment' });
    return;
  }

  res.json({
    token: customerToken,
    user: {
      userId: customerUserId,
      username: name.toLowerCase().replace(/\s+/g, '-'),
      displayName: name,
      role: 'customer',
      sessionId: session.id,
    },
    session: updatedSession,
  });
});

/**
 * GET /api/sessions/:id
 * Get a specific session.
 */
router.get('/:id', requireAuth, (req: Request, res: Response): void => {
  const sessionId = String(req.params.id);
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  if (!canAccessSession(req.user!, session)) {
    res.status(403).json({ error: 'Access denied for this session' });
    return;
  }
  res.json({ session });
});

/**
 * POST /api/sessions/:id/invite
 * Generate a customer invite token for a session.
 */
router.post('/:id/invite', requireAuth, requireRole('agent', 'admin'), (req: Request, res: Response): void => {
  const sessionId = String(req.params.id);
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  if (!canManageSession(req.user!, session)) {
    res.status(403).json({ error: 'Access denied for this session' });
    return;
  }
  if (session.status === 'ENDED') {
    res.status(400).json({ error: 'Session has ended' });
    return;
  }

  // Generate customer JWT token scoped to this session
  const customerName = req.body.customerName || 'Customer';
  const customerUserId = getCustomerUserId(session.id);
  const customerToken = generateToken({
    userId: customerUserId,
    username: customerName.toLowerCase().replace(/\s+/g, '-'),
    displayName: customerName,
    role: 'customer',
    sessionId: session.id,
  });

  const inviteUrl = `${getPublicOrigin(req)}/join/${session.invite_token}`;

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
  const sessionId = String(req.params.id);
  const existing = sessionManager.getSession(sessionId);
  if (!existing) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  if (!canManageSession(req.user!, existing)) {
    res.status(403).json({ error: 'Access denied for this session' });
    return;
  }

  const session = sessionManager.endSession(sessionId, req.user!.userId, req.user!.role);
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
  const sessionId = String(req.params.id);
  const session = sessionManager.forceEndSession(sessionId, req.user!.userId);
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
  const sessionId = String(req.params.id);
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  if (!canAccessSession(req.user!, session)) {
    res.status(403).json({ error: 'Access denied for this session' });
    return;
  }
  const events = sessionManager.getSessionEvents(sessionId);
  res.json({ events });
});

/**
 * GET /api/sessions/:id/messages
 * Get chat messages for a session.
 */
router.get('/:id/messages', requireAuth, (req: Request, res: Response): void => {
  const sessionId = String(req.params.id);
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  if (!canAccessSession(req.user!, session)) {
    res.status(403).json({ error: 'Access denied for this session' });
    return;
  }
  const messages = chatService.getSessionMessages(sessionId);
  res.json({ messages });
});

export default router;
