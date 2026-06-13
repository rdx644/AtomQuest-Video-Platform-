import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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

export default function Dashboard({ user, onLogout }: Props) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const loadSessions = async () => {
    try {
      const d = await api.getSessions();
      setSessions(d.sessions || []);
      setError('');
    } catch (err: any) {
      setError(err.message || 'Unable to load sessions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
    const i = setInterval(loadSessions, 5000);
    return () => clearInterval(i);
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      const d = await api.createSession();
      navigate(`/call/${d.session.id}`);
    } catch (err: any) {
      setError(err.message || 'Unable to create session');
    } finally {
      setCreating(false);
    }
  };

  const handleCopyInvite = async (s: any) => {
    const url = `${window.location.origin}/join/${s.invite_token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(s.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      prompt('Copy invite link:', url);
    }
  };

  const handleEnd = async (id: string) => {
    if (!confirm('End this session?')) return;
    try {
      await api.endSession(id);
      loadSessions();
    } catch (err: any) {
      setError(err.message || 'Unable to end session');
    }
  };

  const badge = (status: string) => {
    const classes: Record<string, string> = {
      CREATED: 'badge-created',
      ACTIVE: 'badge-active',
      AGENT_WAITING: 'badge-waiting',
      ENDED: 'badge-ended',
    };
    const labels: Record<string, string> = {
      CREATED: 'Created',
      ACTIVE: 'Active',
      AGENT_WAITING: 'Waiting',
      ENDED: 'Ended',
    };
    return <span className={`badge ${classes[status] || ''}`}>{labels[status] || status}</span>;
  };

  const active = sessions.filter(s => s.status !== 'ENDED');
  const past = sessions.filter(s => s.status === 'ENDED');
  const waiting = sessions.filter(s => s.status === 'AGENT_WAITING' || s.status === 'CREATED');

  return (
    <div className="page">
      <nav className="navbar">
        <div className="navbar-brand"><div className="logo">AQ</div><span>AtomQuest Video</span></div>
        <div className="navbar-actions">
          <span className="subtle">{user.displayName}</span>
          <button className="btn btn-secondary btn-sm" onClick={onLogout}>Sign Out</button>
        </div>
      </nav>

      <main className="container page-shell">
        <div className="dashboard-hero">
          <div>
            <div className="eyebrow">Agent console</div>
            <h1>Support sessions</h1>
            <p>Create invite links, join active rooms, end calls cleanly, and review the session record after completion.</p>
          </div>
          <button className="btn btn-primary btn-lg" onClick={handleCreate} disabled={creating}>
            {creating ? <span className="spinner" /> : 'New Session'}
          </button>
        </div>

        {error && <p className="alert" style={{ marginBottom: '1rem' }}>{error}</p>}

        <div className="stats-grid">
          <div className="stat-card card"><div className="stat-value">{active.length}</div><div className="stat-label">Open Sessions</div></div>
          <div className="stat-card card"><div className="stat-value">{waiting.length}</div><div className="stat-label">Awaiting Customer</div></div>
          <div className="stat-card card"><div className="stat-value">{past.length}</div><div className="stat-label">Completed</div></div>
        </div>

        <div className="section-header">
          <div>
            <h2>Your sessions</h2>
            <p className="subtle">Polling every 5 seconds for live status changes.</p>
          </div>
        </div>

        {loading ? (
          <div className="empty-state"><div className="spinner" /></div>
        ) : sessions.length === 0 ? (
          <div className="empty-state card">
            <div className="icon">AQ</div>
            <h3>No sessions yet</h3>
            <p>Create a session to generate a customer invite.</p>
          </div>
        ) : (
          <div className="session-list">
            {sessions.map(s => (
              <div key={s.id} className="session-item">
                <div className="session-info">
                  <div className="session-title-row">
                    <span className="session-customer">{s.customer_name || 'Customer not joined'}</span>
                    {badge(s.status)}
                  </div>
                  <div className="session-id">ID: {s.id}</div>
                  <div className="session-time">Created {formatDate(s.created_at)}</div>
                </div>
                <div className="session-actions">
                  {s.status !== 'ENDED' && (
                    <>
                      <button className="btn btn-secondary btn-sm" onClick={() => handleCopyInvite(s)}>
                        {copiedId === s.id ? 'Copied' : 'Copy Invite'}
                      </button>
                      <button className="btn btn-primary btn-sm" onClick={() => navigate(`/call/${s.id}`)}>Join</button>
                      <button className="btn btn-danger btn-sm" onClick={() => handleEnd(s.id)}>End</button>
                    </>
                  )}
                  {s.status === 'ENDED' && (
                    <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/sessions/${s.id}`)}>History</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
