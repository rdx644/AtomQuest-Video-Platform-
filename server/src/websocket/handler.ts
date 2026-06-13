import { WebSocketServer, WebSocket } from 'ws';
import { Server as HttpServer } from 'http';
import { authenticateWebSocket, AuthPayload } from '../middleware/auth';
import * as sessionManager from '../services/sessionManager';
import * as chatService from '../services/chatService';
import { MediaManager } from '../media/mediaManager';
import { incrementCounter } from '../services/metricsService';

interface ConnectedClient {
  ws: WebSocket;
  user: AuthPayload;
  sessionId: string;
}

// Track all connected clients by session
const sessionClients = new Map<string, Map<string, ConnectedClient>>();

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

/**
 * Initialize WebSocket server.
 */
export function initWebSocket(server: HttpServer): void {
  const wss = new WebSocketServer({ server, path: '/ws' });

  console.log('🔌 WebSocket server initialized on /ws');

  // Listen for session events from the session manager
  sessionManager.onSessionEvent((sessionId, event, data) => {
    broadcastToSession(sessionId, event, data);
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

    // Register the client
    const client: ConnectedClient = {
      ws,
      user,
      sessionId,
    };

    const room = getSessionRoom(sessionId);
    room.set(user.userId, client);

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

      room.delete(user.userId);

      // Notify others
      broadcastToSession(sessionId, 'participant_left', {
        userId: user.userId,
        role: user.role,
        displayName: user.displayName,
      });

      // If customer disconnected, trigger the custom timeout rule
      if (user.role === 'customer') {
        sessionManager.customerDisconnect(sessionId, user.displayName);
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

    // ========== WebRTC Signaling (Server-Relayed) ==========
    case 'webrtc:offer':
      // Agent/Customer sends offer → relay to the other participant
      broadcastToSession(client.sessionId, 'webrtc:offer', {
        offer: data.offer,
        fromUserId: client.user.userId,
        fromDisplayName: client.user.displayName,
        fromRole: client.user.role,
      }, client.user.userId);
      break;

    case 'webrtc:answer':
      // Relay answer to the offering participant
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
      // Relay ICE candidates to other participants
      if (data.toUserId) {
        sendToUser(client.sessionId, data.toUserId, 'webrtc:ice-candidate', {
          candidate: data.candidate,
          fromUserId: client.user.userId,
        });
      } else {
        broadcastToSession(client.sessionId, 'webrtc:ice-candidate', {
          candidate: data.candidate,
          fromUserId: client.user.userId,
        }, client.user.userId);
      }
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
        sessionManager.endSession(client.sessionId, client.user.userId);
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
  const { content, messageType, fileUrl } = data;

  if (!content && !fileUrl) return;

  // Save to database
  const message = chatService.saveMessage(
    client.sessionId,
    client.user.role,
    client.user.userId,
    client.user.displayName,
    content || '',
    messageType || 'text',
    fileUrl
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
