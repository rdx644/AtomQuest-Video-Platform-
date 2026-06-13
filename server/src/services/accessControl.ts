import { AuthPayload } from '../middleware/auth';
import type { Session } from './sessionManager';

export function canAccessSession(user: AuthPayload, session: Session): boolean {
  if (user.role === 'admin') return true;
  if (user.role === 'agent') return session.agent_id === user.userId;
  return user.sessionId === session.id;
}

export function canManageSession(user: AuthPayload, session: Session): boolean {
  if (user.role === 'admin') return true;
  return user.role === 'agent' && session.agent_id === user.userId;
}

export function getCustomerUserId(sessionId: string): string {
  return `customer-${sessionId}`;
}
