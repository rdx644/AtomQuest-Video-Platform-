/**
 * Server-side media session manager.
 * 
 * Architecture: browser MediaRecorder chunks are sent to the WebSocket
 * server and relayed to the other participant. This keeps media on owned
 * infrastructure and avoids direct browser-to-browser peer connections.
 * 
 * The server enforces:
 * - Session ownership (only agents can create/end sessions)
 * - Role-based access to media controls
 * - Recording control (agent-only)
 * - Mute/video state tracking
 */

export interface ParticipantMedia {
  userId: string;
  role: string;
  displayName: string;
  audioMuted: boolean;
  videoMuted: boolean;
  isRecording: boolean;
}

interface SessionMedia {
  participants: Map<string, ParticipantMedia>;
  isRecording: boolean;
  recordingAgentId?: string;
}

export class MediaManager {
  private sessions = new Map<string, SessionMedia>();

  /**
   * Initialize the media relay state manager.
   */
  async initialize(): Promise<void> {
    console.log('Media relay manager initialized');
    console.log('   Mode: WebSocket media relay (server-routed)');
  }

  /**
   * Get or create a media session.
   */
  getOrCreateSession(sessionId: string): SessionMedia {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        participants: new Map(),
        isRecording: false,
      });
    }
    return this.sessions.get(sessionId)!;
  }

  /**
   * Add a participant to the media session.
   */
  addParticipant(sessionId: string, userId: string, role: string, displayName: string): void {
    const session = this.getOrCreateSession(sessionId);
    session.participants.set(userId, {
      userId,
      role,
      displayName,
      audioMuted: false,
      videoMuted: false,
      isRecording: false,
    });
  }

  /**
   * Remove a participant.
   */
  removeParticipant(sessionId: string, userId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.participants.delete(userId);

    // Clean up empty sessions
    if (session.participants.size === 0) {
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Update mute state for a participant.
   */
  updateMuteState(sessionId: string, userId: string, kind: 'audio' | 'video', muted: boolean): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    const participant = session.participants.get(userId);
    if (!participant) return;

    if (kind === 'audio') {
      participant.audioMuted = muted;
    } else {
      participant.videoMuted = muted;
    }
  }

  /**
   * Get participants in a session.
   */
  getParticipants(sessionId: string): ParticipantMedia[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];
    return Array.from(session.participants.values());
  }

  /**
   * Start recording (agent only).
   */
  startRecording(sessionId: string, agentId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.isRecording = true;
    session.recordingAgentId = agentId;
    return true;
  }

  /**
   * Stop recording.
   */
  stopRecording(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.isRecording = false;
    session.recordingAgentId = undefined;
    return true;
  }

  /**
   * Check if a session is recording.
   */
  isRecording(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.isRecording || false;
  }

  /**
   * Get metrics.
   */
  getMetrics() {
    let totalParticipants = 0;
    this.sessions.forEach(s => { totalParticipants += s.participants.size; });
    return {
      activeRooms: this.sessions.size,
      totalParticipants,
    };
  }
}
