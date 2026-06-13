import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import type { User } from '../App';

interface Props { user: User; onLogout: () => void; }

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }) : 'Not started';
}

export default function AdminDashboard({ user, onLogout }: Props) {
  const [liveSessions, setLiveSessions] = useState<any[]>([]);
  const [allSessions, setAllSessions] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'live' | 'history'>('live');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const load = async () => {
    try {
      const [live, all, metricData] = await Promise.all([api.getLiveSessions(), api.getSessions(), api.getMetrics()]);
      setLiveSessions(live.sessions || []);
      setAllSessions(all.sessions || []);
      setMetrics(metricData);
      setError('');
    } catch (err: any) {
      setError(err.message || 'Unable to load admin data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const i = setInterval(load, 3000);
    return () => clearInterval(i);
  }, []);

  const forceEnd = async (id: string) => {
    if (!confirm('Force-end this session?')) return;
    try {
      await api.forceEndSession(id);
      load();
    } catch (err: any) {
      setError(err.message || 'Unable to force-end session');
    }
  };

  const badge = (status: string) => {
    const classes: Record<string, string> = {
      CREATED: 'badge-created',
      ACTIVE: 'badge-active',
      AGENT_WAITING: 'badge-waiting',
      ENDED: 'badge-ended',
    };
    return <span className={`badge ${classes[status] || ''}`}>{status.replace(/_/g, ' ')}</span>;
  };

  const active = liveSessions.filter(s => s.status === 'ACTIVE');
  const waiting = liveSessions.filter(s => s.status === 'AGENT_WAITING' || s.status === 'CREATED');
  const ended = allSessions.filter(s => s.status === 'ENDED');
  const visibleSessions = tab === 'live' ? liveSessions : allSessions;

  return (
    <div className="page">
      <nav className="navbar">
        <div className="navbar-brand"><div className="logo">OPS</div><span>AtomQuest Admin</span></div>
        <div className="navbar-actions">
          <span className="subtle">{user.displayName}</span>
          <button className="btn btn-secondary btn-sm" onClick={onLogout}>Sign Out</button>
        </div>
      </nav>

      <main className="container page-shell">
        <div className="dashboard-hero">
          <div>
            <div className="eyebrow">Operations dashboard</div>
            <h1>Live control and audit history</h1>
            <p>Monitor active sessions, inspect participant details, review completed calls, and force-end stuck rooms.</p>
          </div>
          <div className="tabs">
            <button className={`btn ${tab === 'live' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setTab('live')}>Live</button>
            <button className={`btn ${tab === 'history' ? 'btn-primary' : 'btn-secondary'} btn-sm`} onClick={() => setTab('history')}>History</button>
          </div>
        </div>

        {error && <p className="alert" style={{ marginBottom: '1rem' }}>{error}</p>}

        <div className="stats-grid">
          <div className="stat-card card"><div className="stat-value">{liveSessions.length}</div><div className="stat-label">Live Sessions</div></div>
          <div className="stat-card card"><div className="stat-value">{active.length}</div><div className="stat-label">Active Calls</div></div>
          <div className="stat-card card"><div className="stat-value">{ended.length}</div><div className="stat-label">Ended Sessions</div></div>
          <div className="stat-card card"><div className="stat-value">{metrics?.connections?.current ?? 0}</div><div className="stat-label">Connected Participants</div></div>
        </div>

        <div className="section-header">
          <div>
            <h2>{tab === 'live' ? 'Live sessions' : 'Session history'}</h2>
            <p className="subtle">{tab === 'live' ? `${waiting.length} sessions waiting or created.` : 'All persisted sessions are available for event and chat review.'}</p>
          </div>
        </div>

        {loading ? (
          <div className="empty-state"><div className="spinner" /></div>
        ) : visibleSessions.length === 0 ? (
          <div className="empty-state card"><div className="icon">OPS</div><h3>No sessions in this view</h3></div>
        ) : (
          <div className="session-list">
            {visibleSessions.map(s => (
              <div key={s.id} className="session-item">
                <div className="session-info">
                  <div className="session-title-row">
                    <span className="session-customer">Agent: {s.agent_name || s.agent_id}</span>
                    {badge(s.status)}
                  </div>
                  <div className="session-id">Customer: {s.customer_name || 'None'} | ID: {s.id}</div>
                  <div className="session-time">Started: {formatDate(s.started_at)}{s.ended_at ? ` | Ended: ${formatDate(s.ended_at)}` : ''}</div>
                </div>
                <div className="session-actions">
                  <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/sessions/${s.id}`)}>Inspect</button>
                  {s.status !== 'ENDED' && (
                    <button className="btn btn-danger btn-sm" onClick={() => forceEnd(s.id)}>Force End</button>
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
