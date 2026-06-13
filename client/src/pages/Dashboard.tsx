import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import type { User } from '../App';

interface Props { user: User; onLogout: () => void; }

export default function Dashboard({ user, onLogout }: Props) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const navigate = useNavigate();

  const loadSessions = async () => {
    try { const d = await api.getSessions(); setSessions(d.sessions || []); } catch {} finally { setLoading(false); }
  };

  useEffect(() => { loadSessions(); const i = setInterval(loadSessions, 5000); return () => clearInterval(i); }, []);

  const handleCreate = async () => {
    setCreating(true);
    try { const d = await api.createSession(); navigate(`/call/${d.session.id}`); } catch (e: any) { alert(e.message); }
    finally { setCreating(false); }
  };

  const handleCopyInvite = async (s: any) => {
    const url = `${window.location.origin}/join/${s.invite_token}`;
    try { await navigator.clipboard.writeText(url); setCopiedId(s.id); setTimeout(() => setCopiedId(null), 2000); }
    catch { prompt('Copy invite link:', url); }
  };

  const handleEnd = async (id: string) => {
    if (!confirm('End this session?')) return;
    try { await api.endSession(id); loadSessions(); } catch (e: any) { alert(e.message); }
  };

  const badge = (status: string) => {
    const c: Record<string,string> = { CREATED: 'badge-created', ACTIVE: 'badge-active', AGENT_WAITING: 'badge-waiting', ENDED: 'badge-ended' };
    const l: Record<string,string> = { CREATED: 'Created', ACTIVE: 'Active', AGENT_WAITING: 'Waiting', ENDED: 'Ended' };
    return <span className={`badge ${c[status]||''}`}>{l[status]||status}</span>;
  };

  const active = sessions.filter(s => s.status !== 'ENDED');
  const past = sessions.filter(s => s.status === 'ENDED');

  return (
    <div className="page">
      <nav className="navbar">
        <div className="navbar-brand"><div className="logo">📹</div><span>AtomQuest Video</span></div>
        <div className="navbar-actions">
          <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>👋 {user.displayName}</span>
          <button className="btn btn-secondary btn-sm" onClick={onLogout}>Sign Out</button>
        </div>
      </nav>
      <div className="container" style={{ padding: '2rem 1.5rem' }}>
        <div className="stats-grid">
          <div className="stat-card card"><div className="stat-value">{active.length}</div><div className="stat-label">Active</div></div>
          <div className="stat-card card"><div className="stat-value">{past.length}</div><div className="stat-label">Completed</div></div>
          <div className="stat-card card"><div className="stat-value">{sessions.length}</div><div className="stat-label">Total</div></div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
          <h2>Your Sessions</h2>
          <button className="btn btn-primary" onClick={handleCreate} disabled={creating}>{creating ? '...' : '+ New Session'}</button>
        </div>
        {loading ? <div className="empty-state"><div className="spinner"/></div> : sessions.length === 0 ?
          <div className="empty-state card"><div className="icon">📹</div><h3>No sessions yet</h3><p style={{marginTop:'0.5rem',color:'var(--text-secondary)'}}>Create a new session to start a video call.</p></div> :
          <div className="session-list">{sessions.map(s => (
            <div key={s.id} className="session-item">
              <div className="session-info">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span className="session-customer">{s.customer_name || 'No customer'}</span>{badge(s.status)}
                </div>
                <div className="session-id">ID: {s.id.substring(0,8)}...</div>
                <div className="session-time">Created: {new Date(s.created_at).toLocaleString()}</div>
              </div>
              <div className="session-actions">
                {s.status !== 'ENDED' && <>
                  <button className="btn btn-secondary btn-sm" onClick={e=>{e.stopPropagation();handleCopyInvite(s)}}>{copiedId===s.id?'✓ Copied':'🔗 Invite'}</button>
                  <button className="btn btn-primary btn-sm" onClick={()=>navigate(`/call/${s.id}`)}>📹 Join</button>
                  <button className="btn btn-danger btn-sm" onClick={e=>{e.stopPropagation();handleEnd(s.id)}}>End</button>
                </>}
                {s.status === 'ENDED' && <button className="btn btn-secondary btn-sm" onClick={()=>navigate(`/sessions/${s.id}`)}>📋 History</button>}
              </div>
            </div>
          ))}</div>}
      </div>
    </div>
  );
}
