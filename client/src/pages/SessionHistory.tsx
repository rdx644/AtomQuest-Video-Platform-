import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import type { User } from '../App';

interface Props { user: User; onLogout: () => void; }

function formatDate(value: string) {
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function SessionHistory({ user, onLogout }: Props) {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [files, setFiles] = useState<any[]>([]);
  const [tab, setTab] = useState<'events' | 'chat' | 'files'>('events');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([
      api.getSession(id),
      api.getSessionEvents(id),
      api.getSessionMessages(id),
      api.getSessionFiles(id),
    ])
      .then(([sessionData, eventData, messageData, fileData]) => {
        setSession(sessionData.session);
        setEvents(eventData.events || []);
        setMessages(messageData.messages || []);
        setFiles(fileData.files || []);
        setError('');
      })
      .catch((err: any) => setError(err.message || 'Unable to load session history'))
      .finally(() => setLoading(false));
  }, [id]);

  const badge = (status: string) => {
    const classes: Record<string, string> = {
      CREATED: 'badge-created',
      ACTIVE: 'badge-active',
      AGENT_WAITING: 'badge-waiting',
      ENDED: 'badge-ended',
    };
    return <span className={`badge ${classes[status] || ''}`}>{status.replace(/_/g, ' ')}</span>;
  };

  return (
    <div className="page">
      <nav className="navbar">
        <div className="navbar-brand">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate(-1)}>Back</button>
          <span>Session Details</span>
        </div>
        <div className="navbar-actions">
          <span className="subtle">{user.displayName}</span>
          <button className="btn btn-secondary btn-sm" onClick={onLogout}>Sign Out</button>
        </div>
      </nav>

      <main className="container page-shell">
        {error && <p className="alert" style={{ marginBottom: '1rem' }}>{error}</p>}

        {session && (
          <div className="card" style={{ marginBottom: '1rem' }}>
            <div className="card-header">
              <div>
                <div className="eyebrow">Persisted support record</div>
                <h1 style={{ fontSize: '2rem', marginTop: '0.35rem' }}>Session review</h1>
              </div>
              {badge(session.status)}
            </div>
            <div className="stats-grid" style={{ marginBottom: 0 }}>
              <div className="stat-card">
                <div className="stat-label">Customer</div>
                <div className="session-customer">{session.customer_name || 'None'}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Created</div>
                <div className="session-customer">{formatDate(session.created_at)}</div>
              </div>
              <div className="stat-card">
                <div className="stat-label">Ended</div>
                <div className="session-customer">{session.ended_at ? formatDate(session.ended_at) : 'Open'}</div>
              </div>
            </div>
            <p className="session-id" style={{ marginTop: '1rem' }}>ID: {session.id}</p>
          </div>
        )}

        <div className="section-header">
          <div className="tabs">
            <button className={`btn ${tab === 'events' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setTab('events')}>Events ({events.length})</button>
            <button className={`btn ${tab === 'chat' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setTab('chat')}>Chat ({messages.length})</button>
            <button className={`btn ${tab === 'files' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setTab('files')}>Files ({files.length})</button>
          </div>
        </div>

        {loading ? (
          <div className="empty-state"><div className="spinner" /></div>
        ) : tab === 'events' ? (
          <div className="session-list">
            {events.length === 0 ? (
              <div className="empty-state card"><p>No events recorded.</p></div>
            ) : events.map(e => (
              <div key={e.id} className="session-item">
                <div className="session-info">
                  <span className="session-customer">{String(e.event_type).replace(/_/g, ' ')}</span>
                  <div className="session-time">{e.actor_role}: {e.actor_id} | {formatDate(e.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        ) : tab === 'chat' ? (
          <div className="card" style={{ maxHeight: '64vh', overflowY: 'auto' }}>
            {messages.length === 0 ? (
              <div className="empty-state"><p>No chat messages recorded.</p></div>
            ) : (
              <div style={{ display: 'grid', gap: '0.75rem' }}>
                {messages.map(m => (
                  <div key={m.id} className="session-item" style={{ gridTemplateColumns: '1fr' }}>
                    <div className="session-info">
                      <div className="session-title-row">
                        <span className="session-customer">{m.sender_name || m.sender_role}</span>
                        <span className="session-time">{formatDate(m.created_at)}</span>
                      </div>
                      <p className="subtle">{m.content}</p>
                      {m.file_url && (
                        <a href={api.getAssetUrl(m.file_url)} target="_blank" rel="noreferrer">
                          {m.file_name || 'Open shared file'}
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="session-list">
            {files.length === 0 ? (
              <div className="empty-state card"><p>No files shared in this session.</p></div>
            ) : files.map(file => (
              <div key={file.id} className="session-item">
                <div className="session-info">
                  <div className="session-title-row">
                    <span className="session-customer">{file.originalName}</span>
                    <span className="badge badge-created">{file.uploadedRole}</span>
                  </div>
                  <div className="session-time">
                    {formatFileSize(file.sizeBytes)} | {file.mimeType} | Uploaded by {file.uploadedBy} on {formatDate(file.uploadedAt)}
                  </div>
                </div>
                <div className="session-actions">
                  <a className="btn btn-secondary btn-sm" href={api.getAssetUrl(file.url)} target="_blank" rel="noreferrer">Open</a>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
