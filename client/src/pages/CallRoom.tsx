import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { WebSocketClient } from '../services/websocket';
import { api } from '../services/api';
import type { User } from '../App';

interface Props { user: User | null; onLogout: () => void; }

export default function CallRoom({ user: propUser, onLogout }: Props) {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  // Get user from props or localStorage
  const [user] = useState<User | null>(() => {
    if (propUser) return propUser;
    const stored = localStorage.getItem('user');
    return stored ? JSON.parse(stored) : null;
  });

  const [ws, setWs] = useState<WebSocketClient | null>(null);
  const [connected, setConnected] = useState(false);
  const [participants, setParticipants] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [audioMuted, setAudioMuted] = useState(false);
  const [videoMuted, setVideoMuted] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [showChat, setShowChat] = useState(true);
  const [sessionStatus, setSessionStatus] = useState('');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [uploading, setUploading] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocketClient | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Initialize media and WebSocket
  useEffect(() => {
    if (!user || !sessionId) return;
    const token = localStorage.getItem('token');
    if (!token) { navigate('/login'); return; }

    let mounted = true;

    const init = async () => {
      // Get local media
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (err) {
        console.warn('Camera/mic not available:', err);
      }

      // Connect WebSocket
      const wsClient = new WebSocketClient(token, sessionId);
      wsRef.current = wsClient;

      wsClient.on('connected', (data) => {
        if (!mounted) return;
        setConnected(true);
        setParticipants(data.participants || []);
        setIsRecording(data.isRecording || false);

        // If there are existing participants, create offer
        if (data.participants?.length > 0) {
          setTimeout(() => createOffer(wsClient), 1000);
        }
      });

      wsClient.on('participant_joined', (data) => {
        if (!mounted) return;
        setParticipants(prev => [...prev.filter(p => p.userId !== data.userId), data]);
        addSystemMessage(`${data.displayName} joined the call`);
        // Create offer for the new participant
        setTimeout(() => createOffer(wsClient), 500);
      });

      wsClient.on('participant_left', (data) => {
        if (!mounted) return;
        setParticipants(prev => prev.filter(p => p.userId !== data.userId));
        addSystemMessage(`${data.displayName} left the call`);
        // Clean up peer connection
        if (peerConnectionRef.current) {
          peerConnectionRef.current.close();
          peerConnectionRef.current = null;
          setRemoteStream(null);
        }
      });

      wsClient.on('chat:receive', (msg) => {
        if (!mounted) return;
        setMessages(prev => [...prev, msg]);
      });

      wsClient.on('call:participantMuted', (data) => {
        if (!mounted) return;
        addSystemMessage(`${data.displayName} ${data.muted ? 'muted' : 'unmuted'} their ${data.kind}`);
      });

      wsClient.on('session_ended', () => {
        if (!mounted) return;
        setSessionStatus('ENDED');
        addSystemMessage('Session has ended');
      });

      wsClient.on('session_force_ended', () => {
        if (!mounted) return;
        setSessionStatus('ENDED');
        addSystemMessage('Session was ended by admin');
      });

      wsClient.on('customer_disconnected', (data) => {
        if (!mounted) return;
        addSystemMessage(`${data.customerName || 'Customer'} disconnected. Waiting for reconnect...`);
        setSessionStatus('AGENT_WAITING');
      });

      wsClient.on('customer_joined', (data) => {
        if (!mounted) return;
        addSystemMessage(`${data.customerName} reconnected`);
        setSessionStatus('ACTIVE');
      });

      wsClient.on('recording:started', (data) => {
        if (!mounted) return;
        setIsRecording(true);
        addSystemMessage(`Recording started by ${data.startedBy}`);
      });

      wsClient.on('recording:stopped', () => {
        if (!mounted) return;
        setIsRecording(false);
        addSystemMessage('Recording stopped');
      });

      // WebRTC signaling
      wsClient.on('webrtc:offer', async (data) => {
        if (!mounted) return;
        await handleOffer(wsClient, data);
      });

      wsClient.on('webrtc:answer', async (data) => {
        if (!mounted) return;
        if (peerConnectionRef.current) {
          await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
      });

      wsClient.on('webrtc:ice-candidate', async (data) => {
        if (!mounted) return;
        if (peerConnectionRef.current && data.candidate) {
          try {
            await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch (err) { console.warn('ICE candidate error:', err); }
        }
      });

      try {
        await wsClient.connect();
        setWs(wsClient);
      } catch (err) {
        console.error('WS connect failed:', err);
      }
    };

    init();

    return () => {
      mounted = false;
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      peerConnectionRef.current?.close();
      wsRef.current?.disconnect();
    };
  }, [sessionId]);

  // Scroll chat to bottom
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Set remote video
  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  const addSystemMessage = (text: string) => {
    setMessages(prev => [...prev, { id: Date.now(), sender_role: 'system', content: text, created_at: new Date().toISOString() }]);
  };

  const createPeerConnection = useCallback((wsClient: WebSocketClient): RTCPeerConnection => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ]
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        wsClient.send('webrtc:ice-candidate', { candidate: e.candidate });
      }
    };

    pc.ontrack = (e) => {
      setRemoteStream(e.streams[0]);
    };

    pc.oniceconnectionstatechange = () => {
      console.log('ICE state:', pc.iceConnectionState);
    };

    // Add local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    peerConnectionRef.current = pc;
    return pc;
  }, []);

  const createOffer = async (wsClient: WebSocketClient) => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }
    const pc = createPeerConnection(wsClient);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    wsClient.send('webrtc:offer', { offer });
  };

  const handleOffer = async (wsClient: WebSocketClient, data: any) => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }
    const pc = createPeerConnection(wsClient);
    await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    wsClient.send('webrtc:answer', { answer, toUserId: data.fromUserId });
  };

  const toggleAudio = () => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getAudioTracks()[0];
      if (track) { track.enabled = !track.enabled; setAudioMuted(!track.enabled); }
      ws?.send('call:mute', { kind: 'audio', muted: !track?.enabled });
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const track = localStreamRef.current.getVideoTracks()[0];
      if (track) { track.enabled = !track.enabled; setVideoMuted(!track.enabled); }
      ws?.send('call:mute', { kind: 'video', muted: !track?.enabled });
    }
  };

  const sendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !ws) return;
    ws.send('chat:send', { content: chatInput.trim() });
    setChatInput('');
  };

  const endCall = () => {
    if (user?.role === 'agent' || user?.role === 'admin') {
      ws?.send('call:end', {});
    }
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    peerConnectionRef.current?.close();
    ws?.disconnect();
    if (user?.role === 'customer') { navigate('/'); }
    else { navigate('/dashboard'); }
  };

  const toggleRecording = () => {
    if (user?.role !== 'agent') return;
    ws?.send(isRecording ? 'recording:stop' : 'recording:start', {});
  };

  const getInitial = (name: string) => (name || '?').charAt(0).toUpperCase();
  const formatTime = (ts: string) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !sessionId) return;
    e.target.value = ''; // Reset input

    setUploading(true);
    try {
      const result = await api.uploadFile(sessionId, file);
      // Send a chat message with the file info
      ws?.send('chat:send', {
        content: `📎 Shared file: ${result.file.originalName}`,
        messageType: 'file',
        fileUrl: result.file.url,
        fileName: result.file.originalName,
        fileSize: result.file.sizeBytes,
        fileMimeType: result.file.mimeType,
      });
    } catch (err: any) {
      addSystemMessage(`File upload failed: ${err.message}`);
    } finally {
      setUploading(false);
    }
  };

  if (sessionStatus === 'ENDED') {
    return (
      <div className="page-centered">
        <div className="card" style={{ textAlign: 'center', padding: '3rem', maxWidth: 400 }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📞</div>
          <h2>Session Ended</h2>
          <p style={{ color: 'var(--text-secondary)', margin: '1rem 0' }}>The video support session has ended.</p>
          <button className="btn btn-primary" onClick={() => navigate(user?.role === 'customer' ? '/' : '/dashboard')}>
            {user?.role === 'customer' ? 'Close' : 'Back to Dashboard'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="call-room">
      <div className="call-main">
        {/* Header */}
        <div className="navbar" style={{ padding: '0.75rem 1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="navbar-brand"><div className="logo" style={{ width: 28, height: 28, fontSize: '0.875rem' }}>📹</div></div>
            <span className={`badge ${connected ? 'badge-active' : 'badge-ended'}`}>{connected ? 'Connected' : 'Connecting...'}</span>
            {isRecording && <span className="badge badge-recording">Recording</span>}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{participants.length + 1} participant{participants.length !== 0 ? 's' : ''}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowChat(!showChat)}>💬 {showChat ? 'Hide' : 'Show'} Chat</button>
          </div>
        </div>

        {/* Video Grid */}
        <div className="video-grid" style={{ gridTemplateColumns: remoteStream ? '1fr 1fr' : '1fr' }}>
          {/* Local Video */}
          <div className="video-container">
            {videoMuted ? (
              <div className="video-off-placeholder">
                <div className="avatar">{getInitial(user?.displayName || '')}</div>
                <span>Camera Off</span>
              </div>
            ) : (
              <video ref={localVideoRef} autoPlay muted playsInline style={{ transform: 'scaleX(-1)' }} />
            )}
            <div className="video-label">
              {audioMuted && '🔇 '}{user?.displayName || 'You'} (You)
            </div>
          </div>

          {/* Remote Video */}
          {remoteStream ? (
            <div className="video-container">
              <video ref={remoteVideoRef} autoPlay playsInline />
              <div className="video-label">
                {participants[0]?.displayName || 'Remote'}
              </div>
            </div>
          ) : (
            <div className="video-container">
              <div className="video-off-placeholder">
                <div className="avatar" style={{ background: 'var(--bg-input)' }}>?</div>
                <span>Waiting for participant...</span>
              </div>
            </div>
          )}
        </div>

        {/* Control Bar */}
        <div className="control-bar">
          <button className={`control-btn ${audioMuted ? 'active' : ''}`} onClick={toggleAudio} title={audioMuted ? 'Unmute' : 'Mute'}>
            {audioMuted ? '🔇' : '🎤'}
          </button>
          <button className={`control-btn ${videoMuted ? 'active' : ''}`} onClick={toggleVideo} title={videoMuted ? 'Turn on camera' : 'Turn off camera'}>
            {videoMuted ? '📷' : '🎥'}
          </button>
          {user?.role === 'agent' && (
            <button className={`control-btn ${isRecording ? 'active' : ''}`} onClick={toggleRecording} title={isRecording ? 'Stop recording' : 'Start recording'}>
              {isRecording ? '⏹️' : '⏺️'}
            </button>
          )}
          <button className="control-btn end-call" onClick={endCall} title="End call">📞</button>
        </div>
      </div>

      {/* Chat Panel */}
      {showChat && (
        <div className="chat-panel">
          <div className="chat-header">
            <span>💬 Chat</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{messages.filter(m => m.sender_role !== 'system').length} messages</span>
          </div>
          <div className="chat-messages">
            {messages.map((msg, i) => (
              <div key={msg.id || i} className={`chat-message ${msg.sender_role === 'system' ? 'system' : msg.sender_id === user?.userId ? 'own' : ''}`}>
                {msg.sender_role !== 'system' && <span className="message-sender">{msg.sender_name || msg.sender_role}</span>}
                <div className="message-content">
                  {msg.message_type === 'file' && msg.file_url ? (
                    <div className="file-message">
                      {msg.file_url.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
                        <div>
                          <a href={`http://localhost:3001${msg.file_url}`} target="_blank" rel="noreferrer">
                            <img src={`http://localhost:3001${msg.file_url}`} alt="Shared" style={{ maxWidth: '200px', maxHeight: '150px', borderRadius: '8px', cursor: 'pointer' }} />
                          </a>
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                            {msg.fileName || 'Image'}
                          </div>
                        </div>
                      ) : (
                        <a href={`http://localhost:3001${msg.file_url}`} target="_blank" rel="noreferrer" className="file-download-link">
                          <span style={{ fontSize: '1.5rem' }}>📄</span>
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '0.8125rem' }}>{msg.fileName || 'File'}</div>
                            {msg.fileSize && <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>{formatFileSize(msg.fileSize)}</div>}
                          </div>
                          <span style={{ fontSize: '0.875rem' }}>⬇️</span>
                        </a>
                      )}
                    </div>
                  ) : msg.content}
                </div>
                {msg.sender_role !== 'system' && <span className="message-time">{formatTime(msg.created_at)}</span>}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} style={{ display: 'none' }} accept="image/*,.pdf,.doc,.docx,.txt,.zip" />
          <form className="chat-input" onSubmit={sendChat}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()} disabled={uploading} title="Attach file" style={{ flexShrink: 0 }}>
              {uploading ? '⏳' : '📎'}
            </button>
            <input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Type a message..." />
            <button type="submit">➤</button>
          </form>
        </div>
      )}
    </div>
  );
}
