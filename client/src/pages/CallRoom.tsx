import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { WebSocketClient } from '../services/websocket';
import { api } from '../services/api';
import type { User } from '../App';

interface Props { user: User | null; onLogout: () => void; }

const MEDIA_MIME_TYPES = [
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm',
];
const MEDIA_SLICE_MS = 350;

function getSupportedMediaMimeType(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  return MEDIA_MIME_TYPES.find(type => MediaRecorder.isTypeSupported(type)) || '';
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read media chunk'));
    reader.readAsDataURL(blob);
  });
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export default function CallRoom({ user: propUser, onLogout }: Props) {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

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
  const [remoteVideoUrl, setRemoteVideoUrl] = useState<string | null>(null);
  const [remoteMediaActive, setRemoteMediaActive] = useState(false);
  const [mediaRelayError, setMediaRelayError] = useState('');
  const [uploading, setUploading] = useState(false);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocketClient | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaSequenceRef = useRef(0);
  const remoteMediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const remoteQueueRef = useRef<Uint8Array[]>([]);
  const remoteObjectUrlRef = useRef<string | null>(null);
  const remoteMimeTypeRef = useRef<string | null>(null);

  const addSystemMessage = (text: string) => {
    setMessages(prev => [...prev, { id: Date.now(), sender_role: 'system', content: text, created_at: new Date().toISOString() }]);
  };

  const flushRemoteQueue = useCallback(() => {
    const sourceBuffer = sourceBufferRef.current;
    if (!sourceBuffer || sourceBuffer.updating || remoteQueueRef.current.length === 0) return;

    const chunk = remoteQueueRef.current.shift();
    if (!chunk) return;

    try {
      sourceBuffer.appendBuffer(chunk.buffer as ArrayBuffer);
    } catch (err) {
      console.warn('Remote media append failed:', err);
      remoteQueueRef.current = [];
      setMediaRelayError('Remote media playback fell behind. Waiting for the next stream segment.');
    }
  }, []);

  const cleanupRemotePlayback = useCallback(() => {
    sourceBufferRef.current = null;
    remoteQueueRef.current = [];
    const mediaSource = remoteMediaSourceRef.current;
    if (mediaSource?.readyState === 'open') {
      try { mediaSource.endOfStream(); } catch {}
    }
    remoteMediaSourceRef.current = null;
    remoteMimeTypeRef.current = null;
    if (remoteObjectUrlRef.current) {
      URL.revokeObjectURL(remoteObjectUrlRef.current);
      remoteObjectUrlRef.current = null;
    }
    setRemoteVideoUrl(null);
    setRemoteMediaActive(false);
  }, []);

  const initializeRemotePlayback = useCallback((mimeType: string) => {
    cleanupRemotePlayback();

    if (typeof MediaSource === 'undefined') {
      setMediaRelayError('This browser cannot play server-routed media streams.');
      return;
    }

    const selectedMimeType = MediaSource.isTypeSupported(mimeType) ? mimeType : 'video/webm';
    const mediaSource = new MediaSource();
    const objectUrl = URL.createObjectURL(mediaSource);
    remoteMediaSourceRef.current = mediaSource;
    remoteObjectUrlRef.current = objectUrl;
    remoteMimeTypeRef.current = selectedMimeType;
    setRemoteVideoUrl(objectUrl);

    mediaSource.addEventListener('sourceopen', () => {
      try {
        const sourceBuffer = mediaSource.addSourceBuffer(selectedMimeType);
        sourceBuffer.mode = 'sequence';
        sourceBuffer.addEventListener('updateend', flushRemoteQueue);
        sourceBufferRef.current = sourceBuffer;
        flushRemoteQueue();
      } catch (err) {
        console.error('Remote media initialization failed:', err);
        setMediaRelayError('Unable to initialize remote media playback in this browser.');
      }
    }, { once: true });
  }, [cleanupRemotePlayback, flushRemoteQueue]);

  const handleRemoteChunk = useCallback((data: any) => {
    if (!data?.chunk) return;
    const mimeType = typeof data.mimeType === 'string' ? data.mimeType : 'video/webm';

    try {
      if (!remoteMediaSourceRef.current || remoteMimeTypeRef.current !== mimeType) {
        initializeRemotePlayback(mimeType);
      }
      remoteQueueRef.current.push(base64ToBytes(data.chunk));
      setRemoteMediaActive(true);
      setMediaRelayError('');
      flushRemoteQueue();
      void remoteVideoRef.current?.play().catch(() => {});
    } catch (err) {
      console.warn('Remote media chunk failed:', err);
      setMediaRelayError('Received an invalid media chunk from the server.');
    }
  }, [flushRemoteQueue, initializeRemotePlayback]);

  const stopMediaRelay = useCallback(() => {
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
    mediaRecorderRef.current = null;
  }, []);

  const startMediaRelay = useCallback((wsClient: WebSocketClient, stream: MediaStream) => {
    stopMediaRelay();

    if (typeof MediaRecorder === 'undefined') {
      setMediaRelayError('This browser does not support server-routed media capture.');
      return;
    }

    const mimeType = getSupportedMediaMimeType();
    const options: MediaRecorderOptions = {
      audioBitsPerSecond: 64000,
      videoBitsPerSecond: 650000,
      ...(mimeType ? { mimeType } : {}),
    };

    try {
      const recorder = new MediaRecorder(stream, options);
      mediaSequenceRef.current = 0;

      recorder.onstart = () => {
        wsClient.send('media:stream-start', { mimeType: recorder.mimeType || mimeType || 'video/webm' });
      };

      recorder.ondataavailable = async (event) => {
        if (!event.data.size || !wsClient.isConnected) return;
        try {
          const chunk = await blobToBase64(event.data);
          wsClient.send('media:chunk', {
            chunk,
            mimeType: recorder.mimeType || mimeType || 'video/webm',
            sequence: mediaSequenceRef.current,
          });
          mediaSequenceRef.current += 1;
        } catch (err) {
          console.warn('Media relay chunk failed:', err);
          setMediaRelayError('Unable to send a media chunk to the server.');
        }
      };

      recorder.onerror = () => {
        setMediaRelayError('Media capture failed. Check camera and microphone permissions.');
      };

      recorder.onstop = () => {
        if (wsClient.isConnected) wsClient.send('media:stream-stop', {});
      };

      recorder.start(MEDIA_SLICE_MS);
      mediaRecorderRef.current = recorder;
    } catch (err) {
      console.error('Media relay start failed:', err);
      setMediaRelayError('Unable to start server-routed media relay.');
    }
  }, [stopMediaRelay]);

  useEffect(() => {
    if (!user || !sessionId) return;
    const token = localStorage.getItem('token');
    if (!token) { navigate('/login'); return; }

    let mounted = true;

    const init = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      } catch (err) {
        console.warn('Camera/mic not available:', err);
        setMediaRelayError('Camera or microphone is unavailable. Chat remains available.');
      }

      const wsClient = new WebSocketClient(token, sessionId);
      wsRef.current = wsClient;

      wsClient.on('connected', (data) => {
        if (!mounted) return;
        setConnected(true);
        setParticipants(data.participants || []);
        setIsRecording(data.isRecording || false);
        if (localStreamRef.current) startMediaRelay(wsClient, localStreamRef.current);
      });

      wsClient.on('disconnected', () => {
        if (!mounted) return;
        setConnected(false);
      });

      wsClient.on('connection_replaced', (data) => {
        if (!mounted) return;
        addSystemMessage(data.message || 'This connection was replaced by another browser tab.');
      });

      wsClient.on('participant_joined', (data) => {
        if (!mounted) return;
        setParticipants(prev => [...prev.filter(p => p.userId !== data.userId), data]);
        addSystemMessage(`${data.displayName} joined the call`);
      });

      wsClient.on('participant_left', (data) => {
        if (!mounted) return;
        setParticipants(prev => prev.filter(p => p.userId !== data.userId));
        cleanupRemotePlayback();
        addSystemMessage(`${data.displayName} left the call`);
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
        stopMediaRelay();
        cleanupRemotePlayback();
        addSystemMessage('Session has ended');
      });

      wsClient.on('session_force_ended', () => {
        if (!mounted) return;
        setSessionStatus('ENDED');
        stopMediaRelay();
        cleanupRemotePlayback();
        addSystemMessage('Session was ended by admin');
      });

      wsClient.on('grace_timeout_expired', (data) => {
        if (!mounted) return;
        addSystemMessage(`${data.customerName || 'Customer'} did not reconnect within the grace window`);
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

      wsClient.on('media:stream-start', (data) => {
        if (!mounted) return;
        if (data?.mimeType) initializeRemotePlayback(data.mimeType);
      });

      wsClient.on('media:chunk', (data) => {
        if (!mounted) return;
        handleRemoteChunk(data);
      });

      wsClient.on('media:stream-stop', () => {
        if (!mounted) return;
        cleanupRemotePlayback();
      });

      wsClient.on('error', (data) => {
        if (!mounted) return;
        addSystemMessage(data.message || 'A call error occurred');
      });

      try {
        await wsClient.connect();
        setWs(wsClient);
      } catch (err) {
        console.error('WS connect failed:', err);
        setMediaRelayError('Unable to connect to the call server.');
      }
    };

    init();

    return () => {
      mounted = false;
      stopMediaRelay();
      cleanupRemotePlayback();
      localStreamRef.current?.getTracks().forEach(t => t.stop());
      wsRef.current?.disconnect();
    };
  }, [cleanupRemotePlayback, handleRemoteChunk, initializeRemotePlayback, navigate, sessionId, startMediaRelay, stopMediaRelay, user]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    if (remoteVideoUrl && remoteVideoRef.current) {
      void remoteVideoRef.current.play().catch(() => {});
    }
  }, [remoteVideoUrl]);

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

  const exitAfterEnded = () => {
    if (user?.role === 'customer') onLogout();
    navigate(user?.role === 'admin' ? '/admin' : user?.role === 'customer' ? '/login' : '/dashboard');
  };

  const endCall = () => {
    if (user?.role === 'agent' || user?.role === 'admin') {
      // Agent/admin ends the entire session
      ws?.send('call:end', {});
    } else if (user?.role === 'customer') {
      // Customer leaves — server will transition to AGENT_WAITING + grace timer
      ws?.send('call:leave', {});
    }
    stopMediaRelay();
    cleanupRemotePlayback();
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    ws?.disconnect();
    exitAfterEnded();
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
  const getFileName = (msg: any) => msg.fileName || msg.file_name || 'Shared file';
  const getFileSize = (msg: any) => msg.fileSize || msg.file_size;
  const getFileMimeType = (msg: any) => msg.fileMimeType || msg.file_mime_type || '';

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !sessionId) return;
    e.target.value = '';

    setUploading(true);
    try {
      const result = await api.uploadFile(sessionId, file);
      ws?.send('chat:send', {
        content: `Shared file: ${result.file.originalName}`,
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
        <div className="card" style={{ textAlign: 'center', padding: '3rem', maxWidth: 420 }}>
          <div className="brand-mark" style={{ margin: '0 auto 1rem' }}>END</div>
          <h2>Session Ended</h2>
          <p style={{ color: 'var(--text-secondary)', margin: '1rem 0' }}>The video support session has ended.</p>
          <button className="btn btn-primary" onClick={exitAfterEnded}>
            {user?.role === 'customer' ? 'Close' : 'Back to Dashboard'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`call-room ${showChat ? '' : 'chat-hidden'}`}>
      <div className="call-main">
        <div className="call-status-strip">
          <div className="call-status-left">
            <div className="navbar-brand"><div className="logo">AQ</div><span>Support Room</span></div>
            <span className={`badge ${connected ? 'badge-active' : 'badge-ended'}`}>{connected ? 'Connected' : 'Connecting...'}</span>
            {isRecording && <span className="badge badge-recording">Recording</span>}
          </div>
          <div className="call-status-right">
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{participants.length + 1} participant{participants.length !== 0 ? 's' : ''}</span>
            <button className="btn btn-secondary btn-sm" onClick={() => setShowChat(!showChat)}>{showChat ? 'Hide' : 'Show'} Chat</button>
          </div>
        </div>

        <div className={`video-grid ${remoteMediaActive ? '' : 'single-feed'}`}>
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
              {audioMuted && 'Muted '}{user?.displayName || 'You'} (You)
            </div>
          </div>

          {remoteMediaActive && remoteVideoUrl ? (
            <div className="video-container">
              <video ref={remoteVideoRef} src={remoteVideoUrl} autoPlay playsInline />
              <div className="video-label">
                {participants[0]?.displayName || 'Remote'}
              </div>
            </div>
          ) : (
            <div className="video-container">
              <div className="video-off-placeholder">
                <div className="avatar" style={{ background: 'var(--bg-input)' }}>?</div>
                <span>{mediaRelayError || 'Waiting for server-routed media...'}</span>
              </div>
            </div>
          )}
        </div>

        <div className="control-bar">
          <button className={`control-btn ${audioMuted ? 'active' : ''}`} onClick={toggleAudio} title={audioMuted ? 'Unmute' : 'Mute'}>
            {audioMuted ? 'Unmute' : 'Mute'}
          </button>
          <button className={`control-btn ${videoMuted ? 'active' : ''}`} onClick={toggleVideo} title={videoMuted ? 'Turn on camera' : 'Turn off camera'}>
            {videoMuted ? 'Camera On' : 'Camera Off'}
          </button>
          {user?.role === 'agent' && (
            <button className={`control-btn ${isRecording ? 'active' : ''}`} onClick={toggleRecording} title={isRecording ? 'Stop recording' : 'Start recording'}>
              {isRecording ? 'Stop' : 'Rec'}
            </button>
          )}
          <button className="control-btn end-call" onClick={endCall} title={user?.role === 'customer' ? 'Leave call' : 'End call'}>
            {user?.role === 'customer' ? 'Leave' : 'End'}
          </button>
        </div>
      </div>

      {showChat && (
        <div className="chat-panel">
          <div className="chat-header">
            <span>Chat</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{messages.filter(m => m.sender_role !== 'system').length} messages</span>
          </div>
          <div className="chat-messages">
            {messages.map((msg, i) => {
              const fileUrl = msg.file_url ? api.getAssetUrl(msg.file_url) : '';
              return (
                <div key={msg.id || i} className={`chat-message ${msg.sender_role === 'system' ? 'system' : msg.sender_id === user?.userId ? 'own' : ''}`}>
                  {msg.sender_role !== 'system' && <span className="message-sender">{msg.sender_name || msg.sender_role}</span>}
                  <div className="message-content">
                    {msg.message_type === 'file' && msg.file_url ? (
                      <div className="file-message">
                        {msg.file_url.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i) || getFileMimeType(msg).startsWith('image/') ? (
                          <div>
                            <a href={fileUrl} target="_blank" rel="noreferrer">
                              <img src={fileUrl} alt={getFileName(msg)} className="file-preview-image" />
                            </a>
                            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                              {getFileName(msg)}
                            </div>
                          </div>
                        ) : (
                          <a href={fileUrl} target="_blank" rel="noreferrer" className="file-download-link">
                            <span className="mono">FILE</span>
                            <div>
                              <div style={{ fontWeight: 600, fontSize: '0.8125rem' }}>{getFileName(msg)}</div>
                              {getFileSize(msg) && <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)' }}>{formatFileSize(getFileSize(msg))}</div>}
                            </div>
                            <span style={{ fontSize: '0.875rem' }}>Open</span>
                          </a>
                        )}
                      </div>
                    ) : msg.content}
                  </div>
                  {msg.sender_role !== 'system' && <span className="message-time">{formatTime(msg.created_at)}</span>}
                </div>
              );
            })}
            <div ref={chatEndRef} />
          </div>
          <input type="file" ref={fileInputRef} onChange={handleFileUpload} style={{ display: 'none' }} accept="image/*,.pdf,.doc,.docx,.txt,.zip" />
          <form className="chat-input" onSubmit={sendChat}>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => fileInputRef.current?.click()} disabled={uploading} title="Attach file" style={{ flexShrink: 0 }}>
              {uploading ? '...' : 'Attach'}
            </button>
            <input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Type a message..." />
            <button type="submit">Send</button>
          </form>
        </div>
      )}
    </div>
  );
}
