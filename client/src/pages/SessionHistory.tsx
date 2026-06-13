import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import type { User } from '../App';

interface Props { user: User; onLogout: () => void; }

export default function SessionHistory({ user, onLogout }: Props) {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);
  const [tab, setTab] = useState<'events' | 'chat'>('events');
  const navigate = useNavigate();

  useEffect(() => {
    if (!id) return;
    api.getSession(id).then(d => setSession(d.session)).catch(() => {});
    api.getSessionEvents(id).then(d => setEvents(d.events || [])).catch(() => {});
    api.getSessionMessages(id).then(d => setMessages(d.messages || [])).catch(() => {});
  }, [id]);

  const badge = (status: string) => {
    const c: Record<string,string> = { CREATED:'badge-created', ACTIVE:'badge-active', AGENT_WAITING:'badge-waiting', ENDED:'badge-ended' };
    return <span className={`badge ${c[status]||''}`}>{status}</span>;
  };

  return (
    <div className="page">
      <nav className="navbar">
        <div className="navbar-brand">
          <button className="btn btn-secondary btn-sm" onClick={() => navigate(-1)}>← Back</button>
          <span>Session Details</span>
        </div>
        <div className="navbar-actions">
          <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{user.displayName}</span>
        </div>
      </nav>
      <div className="container" style={{ padding: '2rem 1.5rem' }}>
        {session && (
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                  <h2>Session</h2>{badge(session.status)}
                </div>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                  ID: {session.id}<br/>
                  Customer: {session.customer_name || 'None'}<br/>
                  Created: {new Date(session.created_at).toLocaleString()}
                  {session.ended_at && <><br/>Ended: {new Date(session.ended_at).toLocaleString()}</>}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          <button className={`btn ${tab==='events'?'btn-primary':'btn-secondary'} btn-sm`} onClick={()=>setTab('events')}>📋 Events ({events.length})</button>
          <button className={`btn ${tab==='chat'?'btn-primary':'btn-secondary'} btn-sm`} onClick={()=>setTab('chat')}>💬 Chat ({messages.length})</button>
        </div>

        {tab === 'events' ? (
          <div className="session-list">
            {events.length === 0 ? <div className="empty-state card"><p>No events</p></div> :
            events.map(e => (
              <div key={e.id} className="session-item" style={{ cursor: 'default' }}>
                <div className="session-info">
                  <span className="session-customer">{e.event_type.replace(/_/g, ' ')}</span>
                  <div className="session-time">
                    {e.actor_role}: {e.actor_id} • {new Date(e.created_at).toLocaleString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="card" style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {messages.length === 0 ? <div className="empty-state"><p>No messages</p></div> :
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {messages.map(m => (
                <div key={m.id} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: m.sender_role==='agent'?'var(--accent-gradient)':'var(--bg-input)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', flexShrink: 0 }}>
                    {(m.sender_name||'?')[0]}
                  </div>
                  <div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'baseline' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.875rem' }}>{m.sender_name}</span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{new Date(m.created_at).toLocaleTimeString()}</span>
                    </div>
                    <p style={{ fontSize: '0.875rem', marginTop: '0.125rem' }}>{m.content}</p>
                  </div>
                </div>
              ))}
            </div>}
          </div>
        )}
      </div>
    </div>
  );
}
