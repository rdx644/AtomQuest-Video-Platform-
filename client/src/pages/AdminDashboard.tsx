import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import type { User } from '../App';

interface Props { user: User; onLogout: () => void; }

export default function AdminDashboard({ user, onLogout }: Props) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = async () => {
    try { const d = await api.getLiveSessions(); setSessions(d.sessions || []); }
    catch {} finally { setLoading(false); }
  };

  useEffect(() => { load(); const i = setInterval(load, 3000); return () => clearInterval(i); }, []);

  const forceEnd = async (id: string) => {
    if (!confirm('Force-end this session?')) return;
    try { await api.forceEndSession(id); load(); } catch (e: any) { alert(e.message); }
  };

  const badge = (status: string) => {
    const c: Record<string,string> = { CREATED: 'badge-created', ACTIVE: 'badge-active', AGENT_WAITING: 'badge-waiting', ENDED: 'badge-ended' };
    return <span className={`badge ${c[status]||''}`}>{status}</span>;
  };

  const active = sessions.filter(s => s.status === 'ACTIVE');
  const waiting = sessions.filter(s => s.status === 'AGENT_WAITING');

  return (
    <div className="page">
      <nav className="navbar">
        <div className="navbar-brand"><div className="logo">🔧</div><span>Admin Dashboard</span></div>
        <div className="navbar-actions">
          <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>🔧 {user.displayName}</span>
          <button className="btn btn-secondary btn-sm" onClick={onLogout}>Sign Out</button>
        </div>
      </nav>
      <div className="container" style={{ padding: '2rem 1.5rem' }}>
        <div className="stats-grid">
          <div className="stat-card card"><div className="stat-value">{sessions.length}</div><div className="stat-label">Live Sessions</div></div>
          <div className="stat-card card"><div className="stat-value">{active.length}</div><div className="stat-label">Active Calls</div></div>
          <div className="stat-card card"><div className="stat-value">{waiting.length}</div><div className="stat-label">Waiting</div></div>
        </div>

        <h2 style={{ marginBottom: '1rem' }}>Live Sessions</h2>
        {loading ? <div className="empty-state"><div className="spinner"/></div> :
        sessions.length === 0 ? <div className="empty-state card"><div className="icon">📊</div><h3>No active sessions</h3></div> :
        <div className="session-list">{sessions.map(s => (
          <div key={s.id} className="session-item">
            <div className="session-info">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span className="session-customer">Agent: {s.agent_name}</span>{badge(s.status)}
              </div>
              <div className="session-id">Customer: {s.customer_name || 'None'} • ID: {s.id.substring(0,8)}...</div>
              <div className="session-time">Started: {s.started_at ? new Date(s.started_at).toLocaleString() : 'Not yet'}</div>
            </div>
            <div className="session-actions">
              <button className="btn btn-secondary btn-sm" onClick={() => navigate(`/sessions/${s.id}`)}>📋 Events</button>
              <button className="btn btn-danger btn-sm" onClick={() => forceEnd(s.id)}>⛔ Force End</button>
            </div>
          </div>
        ))}</div>}
      </div>
    </div>
  );
}
