import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { authenticateWebSocket, AuthPayload } from '../middleware/auth';
import { saveDb } from '../database';
import * as sessionManager from '../services/sessionManager';
import * as chatService from '../services/chatService';
import { MediaManager } from '../media/mediaManager';
import { incrementCounter } from '../services/metricsService';
import { canAccessSession } from '../services/accessControl';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

interface ConnectedClient {
  ws: WebSocket;
  user: AuthPayload;
  sessionId: string;
}

// Track all connected clients by session
const sessionClients = new Map<string, Map<string, ConnectedClient>>();
const MAX_MEDIA_CHUNK_CHARS = 2 * 1024 * 1024;

// Active recording file streams keyed by sessionId
const recordingStreams = new Map<string, fs.WriteStream>();

let mediaManager: MediaManager | null = null;

export function setMediaManager(mm: MediaManager): void {
  mediaManager = mm;
}

/**
 * Get all clients in a session.
 */
function getSessionRoom(sessionId: string): Map<string, ConnectedClient> {
  if (!sessionClients.has(sessionId)) {
    sessionClients.set(sessionId, new Map());
  }
  return sessionClients.get(sessionId)!;
}

/**
 * Broadcast a message to all participants in a session.
 */
function broadcastToSession(sessionId: string, event: string, data: any, excludeUserId?: string): void {
  const room = getSessionRoom(sessionId);
  const message = JSON.stringify({ event, data });

  room.forEach((client) => {
    if (client.user.userId !== excludeUserId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(message);
    }
  });
}

/**
 * Send a message to a specific client.
 */
function sendToClient(client: ConnectedClient, event: string, data: any): void {
  if (client.ws.readyState === WebSocket.OPEN) {
    client.ws.send(JSON.stringify({ event, data }));
  }
}

/**
 * Send to a specific user in a session.
 */
function sendToUser(sessionId: string, userId: string, event: string, data: any): void {
  const room = sessionClients.get(sessionId);
  if (!room) return;
  const client = room.get(userId);
  if (client) sendToClient(client, event, data);
}

function closeSessionRoom(sessionId: string, code: number, reason: string): void {
  const room = sessionClients.get(sessionId);
  if (!room) return;

  room.forEach((client) => {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.close(code, reason);
    }
  });
  sessionClients.delete(sessionId);
}

/**
 * Initialize WebSocket server.
 */
export function initWebSocket(server: HttpServer): void {
  const wss = new WebSocketServer({ server, path: '/ws' });

  console.log('🔌 WebSocket server initialized on /ws');

  // Listen for session events from the session manager
  sessionManager.onSessionEvent((sessionId, event, data) => {
    broadcastToSession(sessionId, event, data);
    if (event === 'session_ended' || event === 'session_force_ended') {
      setTimeout(() => closeSessionRoom(sessionId, 1000, 'Session ended'), 50);
    }
  });

  wss.on('connection', (ws: WebSocket, req) => {
    // Authenticate the WebSocket connection
    const user = authenticateWebSocket(req.url || '');
    if (!user) {
      incrementCounter('auth_failures_total');
      ws.send(JSON.stringify({ event: 'error', data: { message: 'Authentication failed' } }));
      ws.close(4001, 'Unauthorized');
      return;
    }

    // Extract session ID from query params
    const url = new URL(req.url || '', 'http://localhost');
    const sessionId = url.searchParams.get('sessionId');

    if (!sessionId) {
      ws.send(JSON.stringify({ event: 'error', data: { message: 'Session ID required' } }));
      ws.close(4002, 'Session ID required');
      return;
    }

    // Verify the session exists and is valid
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      ws.send(JSON.stringify({ event: 'error', data: { message: 'Session not found' } }));
      ws.close(4003, 'Session not found');
      return;
    }

    if (session.status === 'ENDED') {
      ws.send(JSON.stringify({ event: 'error', data: { message: 'Session has ended' } }));
      ws.close(4004, 'Session ended');
      return;
    }
    if (!canAccessSession(user, session)) {
      incrementCounter('auth_failures_total');
      ws.send(JSON.stringify({ event: 'error', data: { message: 'Access denied for this session' } }));
      ws.close(4005, 'Access denied');
      return;
    }

    // Register the client
    const client: ConnectedClient = {
      ws,
      user,
      sessionId,
    };

    const room = getSessionRoom(sessionId);
    const existingClient = room.get(user.userId);
    if (existingClient && existingClient.ws.readyState === WebSocket.OPEN) {
      sendToClient(existingClient, 'connection_replaced', { message: 'A newer connection joined this session' });
      existingClient.ws.close(4008, 'Connection replaced');
    }
    room.set(user.userId, client);
    sessionManager.logEvent(sessionId, 'PARTICIPANT_CONNECTED', user.role, user.userId, {
      displayName: user.displayName,
    });
    saveDb();

    // Register in media manager
    if (mediaManager) {
      mediaManager.addParticipant(sessionId, user.userId, user.role, user.displayName);
    }

    console.log(`🟢 ${user.role}:${user.displayName} connected to session ${sessionId}`);
    incrementCounter('websocket_connections_total');

    // Send connection acknowledgment with existing participants
    sendToClient(client, 'connected', {
      userId: user.userId,
      role: user.role,
      displayName: user.displayName,
      sessionId,
      participants: Array.from(room.values())
        .filter(c => c.user.userId !== user.userId)
        .map(c => ({
          userId: c.user.userId,
          role: c.user.role,
          displayName: c.user.displayName,
        })),
      isRecording: mediaManager?.isRecording(sessionId) || false,
    });

    // Notify others in the session
    broadcastToSession(sessionId, 'participant_joined', {
      userId: user.userId,
      role: user.role,
      displayName: user.displayName,
    }, user.userId);

    // Handle messages
    ws.on('message', async (rawMessage) => {
      try {
        const message = JSON.parse(rawMessage.toString());
        incrementCounter('websocket_messages_total');
        await handleMessage(client, message);
      } catch (err) {
        console.error('WebSocket message error:', err);
        sendToClient(client, 'error', { message: 'Invalid message format' });
      }
    });

    // Handle disconnect
    ws.on('close', () => {
      console.log(`🔴 ${user.role}:${user.displayName} disconnected from session ${sessionId}`);

      const currentClient = room.get(user.userId);
      if (currentClient?.ws !== ws) {
        return;
      }

      room.delete(user.userId);
      sessionManager.logEvent(sessionId, 'PARTICIPANT_DISCONNECTED', user.role, user.userId, {
        displayName: user.displayName,
      });
      saveDb();

      // Customer drops are held for the grace window before notifying the other side.
      if (user.role === 'customer') {
        const currentSession = sessionManager.getSession(sessionId);
        if (currentSession?.status === 'ACTIVE') {
          sessionManager.customerDisconnect(sessionId, user.displayName);
        }
      } else {
        broadcastToSession(sessionId, 'participant_left', {
          userId: user.userId,
          role: user.role,
          displayName: user.displayName,
        });
      }

      // Clean up media manager
      if (mediaManager) {
        mediaManager.removeParticipant(sessionId, user.userId);
      }

      // Clean up empty rooms
      if (room.size === 0) {
        sessionClients.delete(sessionId);
      }
    });

    ws.on('error', (err) => {
      console.error(`WebSocket error for ${user.displayName}:`, err);
    });
  });
}

/**
 * Handle incoming WebSocket messages.
 */
async function handleMessage(client: ConnectedClient, message: any): Promise<void> {
  const { event, data } = message;

  switch (event) {
    // ========== Chat Events ==========
    case 'chat:send':
      handleChatMessage(client, data);
      break;

    // ========== Server-Routed Media Relay ==========
    case 'media:stream-start':
      broadcastToSession(client.sessionId, 'media:stream-start', {
        fromUserId: client.user.userId,
        fromDisplayName: client.user.displayName,
        mimeType: data?.mimeType,
      }, client.user.userId);
      break;

    case 'media:chunk':
      if (!data || typeof data.chunk !== 'string' || data.chunk.length > MAX_MEDIA_CHUNK_CHARS) {
        sendToClient(client, 'error', { message: 'Invalid media chunk' });
        incrementCounter('media_relay_errors_total');
        break;
      }
      broadcastToSession(client.sessionId, 'media:chunk', {
        fromUserId: client.user.userId,
        fromDisplayName: client.user.displayName,
        mimeType: typeof data.mimeType === 'string' ? data.mimeType : 'video/webm',
        sequence: Number.isFinite(data.sequence) ? data.sequence : 0,
        chunk: data.chunk,
      }, client.user.userId);
      incrementCounter('media_chunks_relayed_total');

      // Write to recording file if recording is active
      if (mediaManager?.isRecording(client.sessionId)) {
        const stream = recordingStreams.get(client.sessionId);
        if (stream && !stream.destroyed) {
          try {
            const buf = Buffer.from(data.chunk, 'base64');
            stream.write(buf);
          } catch {}
        }
      }
      break;

    case 'media:stream-stop':
      broadcastToSession(client.sessionId, 'media:stream-stop', {
        fromUserId: client.user.userId,
        fromDisplayName: client.user.displayName,
      }, client.user.userId);
      break;

    // ========== WebRTC Signaling Relay ==========
    case 'webrtc:offer':
      // Relay the offer to all other participants in the session
      broadcastToSession(client.sessionId, 'webrtc:offer', {
        offer: data.offer,
        fromUserId: client.user.userId,
        fromDisplayName: client.user.displayName,
      }, client.user.userId);
      break;

    case 'webrtc:answer':
      // If a specific recipient is specified, send only to them; otherwise broadcast
      if (data.toUserId) {
        sendToUser(client.sessionId, data.toUserId, 'webrtc:answer', {
          answer: data.answer,
          fromUserId: client.user.userId,
        });
      } else {
        broadcastToSession(client.sessionId, 'webrtc:answer', {
          answer: data.answer,
          fromUserId: client.user.userId,
        }, client.user.userId);
      }
      break;

    case 'webrtc:ice-candidate':
      // Relay ICE candidates to all other participants
      broadcastToSession(client.sessionId, 'webrtc:ice-candidate', {
        candidate: data.candidate,
        fromUserId: client.user.userId,
      }, client.user.userId);
      break;

    // ========== Call Control Events ==========
    case 'call:mute':
      if (mediaManager) {
        mediaManager.updateMuteState(client.sessionId, client.user.userId, data.kind, data.muted);
      }
      broadcastToSession(client.sessionId, 'call:participantMuted', {
        userId: client.user.userId,
        displayName: client.user.displayName,
        kind: data.kind,
        muted: data.muted,
      }, client.user.userId);
      break;

    case 'call:end':
      if (client.user.role === 'agent' || client.user.role === 'admin') {
        sessionManager.endSession(client.sessionId, client.user.userId, client.user.role);
      } else {
        sendToClient(client, 'error', { message: 'Customers can leave the call, but only agents can end the session.' });
      }
      break;

    case 'call:leave':
      // Customer voluntarily leaves → session transitions to AGENT_WAITING with grace timer
      if (client.user.role === 'customer') {
        sessionManager.customerDisconnect(client.sessionId, client.user.displayName);
        sessionManager.logEvent(client.sessionId, 'CUSTOMER_LEFT', 'customer', client.user.userId, {
          displayName: client.user.displayName,
          voluntary: true,
        });
        saveDb();
        broadcastToSession(client.sessionId, 'participant_left', {
          userId: client.user.userId,
          role: 'customer',
          displayName: client.user.displayName,
        }, client.user.userId);
      }
      break;

    // ========== Recording Control ==========
    case 'recording:start':
      if (client.user.role !== 'agent') {
        sendToClient(client, 'error', { message: 'Only agents can start recording' });
        break;
      }
      if (mediaManager) {
        mediaManager.startRecording(client.sessionId, client.user.userId);
      }
      // Create recording file on disk
      try {
        const recordDir = path.resolve(config.recordingDir);
        fs.mkdirSync(recordDir, { recursive: true });
        const filename = `recording-${client.sessionId.substring(0, 8)}-${Date.now()}.webm`;
        const filepath = path.join(recordDir, filename);
        const stream = fs.createWriteStream(filepath);
        recordingStreams.set(client.sessionId, stream);
        sessionManager.logEvent(client.sessionId, 'RECORDING_STARTED', 'agent', client.user.userId, {
          filename,
          filepath,
        });
        saveDb();
      } catch (err) {
        console.error('Failed to create recording file:', err);
      }
      broadcastToSession(client.sessionId, 'recording:started', {
        startedBy: client.user.displayName,
      });
      incrementCounter('recording_started_total');
      break;

    case 'recording:stop':
      if (client.user.role !== 'agent') {
        sendToClient(client, 'error', { message: 'Only agents can stop recording' });
        break;
      }
      if (mediaManager) {
        mediaManager.stopRecording(client.sessionId);
      }
      // Close the recording file stream
      const recStream = recordingStreams.get(client.sessionId);
      if (recStream && !recStream.destroyed) {
        recStream.end();
        recordingStreams.delete(client.sessionId);
        sessionManager.logEvent(client.sessionId, 'RECORDING_STOPPED', 'agent', client.user.userId);
        saveDb();
      }
      broadcastToSession(client.sessionId, 'recording:stopped', {
        stoppedBy: client.user.displayName,
      });
      incrementCounter('recording_stopped_total');
      break;

    default:
      sendToClient(client, 'error', { message: `Unknown event: ${event}` });
  }
}

// ========== Chat Handlers ==========

function handleChatMessage(client: ConnectedClient, data: any): void {
  const { content, messageType, fileUrl, fileName, fileSize, fileMimeType } = data;

  if (!content && !fileUrl) return;

  // Save to database
  const message = chatService.saveMessage(
    client.sessionId,
    client.user.role,
    client.user.userId,
    client.user.displayName,
    content || '',
    messageType || 'text',
    fileUrl,
    { fileName, fileSize, fileMimeType }
  );

  // Broadcast to all participants in the session (including sender for confirmation)
  broadcastToSession(client.sessionId, 'chat:receive', message);
  incrementCounter('chat_messages_total');
}

/**
 * Get the number of connected participants across all sessions.
 */
export function getConnectedParticipantsCount(): number {
  let count = 0;
  sessionClients.forEach(room => { count += room.size; });
  return count;
}

/**
 * Get connected participants for a specific session.
 */
export function getSessionParticipants(sessionId: string): any[] {
  const room = sessionClients.get(sessionId);
  if (!room) return [];
  return Array.from(room.values()).map(c => ({
    userId: c.user.userId,
    role: c.user.role,
    displayName: c.user.displayName,
  }));
}
