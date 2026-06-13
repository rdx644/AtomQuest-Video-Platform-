import { getDb, saveDb } from '../database';
import { v4 as uuidv4 } from 'uuid';
import crypto from 'crypto';

export type SessionStatus = 'CREATED' | 'ACTIVE' | 'AGENT_WAITING' | 'ENDED';

export interface Session {
  id: string;
  agent_id: string;
  invite_token: string;
  status: SessionStatus;
  grace_timeout_seconds: number;
  customer_name: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

export interface SessionEvent {
  id: number;
  session_id: string;
  event_type: string;
  actor_role: string;
  actor_id: string;
  metadata: any;
  created_at: string;
}

// In-memory timeout tracking
const graceTimers = new Map<string, NodeJS.Timeout>();

// Callbacks for session events
type SessionCallback = (sessionId: string, event: string, data?: any) => void;
const eventCallbacks: SessionCallback[] = [];

export function onSessionEvent(cb: SessionCallback): void {
  eventCallbacks.push(cb);
}

function emitSessionEvent(sessionId: string, event: string, data?: any): void {
  eventCallbacks.forEach(cb => cb(sessionId, event, data));
}

export function createSession(agentId: string, graceTimeout?: number): Session {
  const db = getDb();
  const session: Session = {
    id: uuidv4(),
    agent_id: agentId,
    invite_token: crypto.randomBytes(16).toString('hex'),
    status: 'CREATED',
    grace_timeout_seconds: graceTimeout || 120,
    customer_name: null,
    created_at: new Date().toISOString(),
    started_at: null,
    ended_at: null,
  };

  db.sessions.push(session);
  logEvent(session.id, 'SESSION_CREATED', 'agent', agentId);
  saveDb();

  emitSessionEvent(session.id, 'session_created', session);
  return session;
}

export function getSession(sessionId: string): Session | undefined {
  return getDb().sessions.find(s => s.id === sessionId);
}

export function getSessionByToken(token: string): Session | undefined {
  return getDb().sessions.find(s => s.invite_token === token);
}

export function getAgentSessions(agentId: string): Session[] {
  return getDb().sessions
    .filter(s => s.agent_id === agentId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function getAllSessions(status?: string): Session[] {
  let sessions = getDb().sessions;
  if (status) sessions = sessions.filter(s => s.status === status);
  return sessions.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function getLiveSessions(): any[] {
  const db = getDb();
  return db.sessions
    .filter(s => ['CREATED', 'ACTIVE', 'AGENT_WAITING'].includes(s.status))
    .map(s => {
      const agent = db.users.find(u => u.id === s.agent_id);
      return {
        ...s,
        agent_name: agent?.display_name || 'Unknown',
        agent_username: agent?.username || 'unknown',
      };
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

export function customerJoinSession(sessionId: string, customerName: string): Session | null {
  const session = getSession(sessionId);
  if (!session || session.status === 'ENDED') return null;

  clearGraceTimer(sessionId);

  session.status = 'ACTIVE';
  session.customer_name = customerName;
  if (!session.started_at) session.started_at = new Date().toISOString();

  logEvent(sessionId, 'CUSTOMER_JOINED', 'customer', customerName);
  saveDb();

  emitSessionEvent(sessionId, 'customer_joined', { customerName });
  return session;
}

export function customerDisconnect(sessionId: string, customerName?: string): void {
  const session = getSession(sessionId);
  if (!session || session.status === 'ENDED') return;

  session.status = 'AGENT_WAITING';
  logEvent(sessionId, 'CUSTOMER_DISCONNECTED', 'customer', customerName || 'unknown');
  saveDb();

  emitSessionEvent(sessionId, 'customer_disconnected', { customerName });
  startGraceTimer(sessionId, session.grace_timeout_seconds);
}

export function endSession(sessionId: string, agentId: string): Session | null {
  const session = getSession(sessionId);
  if (!session || session.status === 'ENDED') return null;

  clearGraceTimer(sessionId);

  session.status = 'ENDED';
  session.ended_at = new Date().toISOString();

  logEvent(sessionId, 'SESSION_ENDED', 'agent', agentId);
  saveDb();

  emitSessionEvent(sessionId, 'session_ended', { agentId });
  return session;
}

export function forceEndSession(sessionId: string, adminId: string): Session | null {
  const session = getSession(sessionId);
  if (!session || session.status === 'ENDED') return null;

  clearGraceTimer(sessionId);

  session.status = 'ENDED';
  session.ended_at = new Date().toISOString();

  logEvent(sessionId, 'SESSION_FORCE_ENDED', 'admin', adminId);
  saveDb();

  emitSessionEvent(sessionId, 'session_force_ended', { adminId });
  return session;
}

function startGraceTimer(sessionId: string, timeoutSeconds: number): void {
  clearGraceTimer(sessionId);
  const timer = setTimeout(() => {
    const session = getSession(sessionId);
    if (session && session.status === 'AGENT_WAITING') {
      logEvent(sessionId, 'GRACE_TIMEOUT_EXPIRED', 'system', 'system');
      emitSessionEvent(sessionId, 'grace_timeout_expired', { sessionId });
    }
    graceTimers.delete(sessionId);
  }, timeoutSeconds * 1000);
  graceTimers.set(sessionId, timer);
}

function clearGraceTimer(sessionId: string): void {
  const timer = graceTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    graceTimers.delete(sessionId);
  }
}

export function logEvent(sessionId: string, eventType: string, actorRole: string, actorId: string, metadata?: any): void {
  const db = getDb();
  db.session_events.push({
    id: db._meta.nextEventId++,
    session_id: sessionId,
    event_type: eventType,
    actor_role: actorRole,
    actor_id: actorId,
    metadata: metadata || null,
    created_at: new Date().toISOString(),
  });
}

export function getSessionEvents(sessionId: string): SessionEvent[] {
  return getDb().session_events
    .filter(e => e.session_id === sessionId)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

export function getSessionMetrics() {
  const db = getDb();
  const active = db.sessions.filter(s => ['ACTIVE', 'AGENT_WAITING'].includes(s.status)).length;
  const total = db.sessions.length;
  const ended = db.sessions.filter(s => s.status === 'ENDED').length;
  return { active, total, ended };
}
