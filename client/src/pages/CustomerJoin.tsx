import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../services/api';

export default function CustomerJoin() {
  const { token } = useParams<{ token: string }>();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Please enter your name'); return; }
    setLoading(true); setError('');
    try {
      const data = await api.joinSession(token!, name.trim());
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify({
        userId: `customer-${Date.now()}`, username: name.toLowerCase().replace(/\s+/g,'-'),
        displayName: name.trim(), role: 'customer', sessionId: data.session.id
      }));
      navigate(`/call/${data.session.id}`);
    } catch (err: any) { setError(err.message || 'Failed to join'); }
    finally { setLoading(false); }
  };

  return (
    <div className="page-centered">
      <div className="card join-card" style={{ animation: 'fadeIn 0.5s ease' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📹</div>
        <h1>Join Support Session</h1>
        <p className="subtitle">You've been invited to a video support call. Enter your name to join.</p>
        <form className="join-form" onSubmit={handleJoin}>
          <div className="input-group">
            <label htmlFor="customerName">Your Name</label>
            <input id="customerName" className="input" type="text" value={name} onChange={e=>setName(e.target.value)}
              placeholder="Enter your name" required autoFocus />
          </div>
          {error && <p style={{ color: 'var(--danger)', fontSize: '0.875rem' }}>⚠️ {error}</p>}
          <button type="submit" className="btn btn-primary btn-lg" disabled={loading} style={{ width: '100%' }}>
            {loading ? <span className="spinner"/> : '🎥 Join Video Call'}
          </button>
        </form>
        <p style={{ marginTop: '1.5rem', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          No download required • Works in your browser • Your camera & mic will be requested
        </p>
      </div>
    </div>
  );
}
