import { getDb, saveDb } from '../database';

export interface ChatMessage {
  id: number;
  session_id: string;
  sender_role: string;
  sender_id: string;
  sender_name: string | null;
  content: string;
  message_type: string;
  file_url: string | null;
  file_name?: string | null;
  file_size?: number | null;
  file_mime_type?: string | null;
  created_at: string;
}

export function saveMessage(
  sessionId: string,
  senderRole: string,
  senderId: string,
  senderName: string,
  content: string,
  messageType: string = 'text',
  fileUrl?: string,
  fileMeta?: { fileName?: string; fileSize?: number; fileMimeType?: string }
): ChatMessage {
  const db = getDb();
  const message: ChatMessage = {
    id: db._meta.nextMessageId++,
    session_id: sessionId,
    sender_role: senderRole,
    sender_id: senderId,
    sender_name: senderName,
    content,
    message_type: messageType,
    file_url: fileUrl || null,
    file_name: fileMeta?.fileName || null,
    file_size: fileMeta?.fileSize || null,
    file_mime_type: fileMeta?.fileMimeType || null,
    created_at: new Date().toISOString(),
  };
  db.chat_messages.push(message);
  saveDb();
  return message;
}

export function getSessionMessages(sessionId: string): ChatMessage[] {
  return getDb().chat_messages
    .filter(m => m.session_id === sessionId)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

export function getRecentMessages(sessionId: string, limit: number = 50): ChatMessage[] {
  return getDb().chat_messages
    .filter(m => m.session_id === sessionId)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit);
}
