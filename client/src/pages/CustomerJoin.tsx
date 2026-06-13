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
    if (!name.trim()) {
      setError('Please enter your name');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const data = await api.joinSession(token!, name.trim());
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      navigate(`/call/${data.session.id}`);
    } catch (err: any) {
      setError(err.message || 'Failed to join');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-centered">
      <div className="card join-card" style={{ animation: 'fadeIn 0.45s ease' }}>
        <div className="auth-layout">
          <section className="auth-visual">
            <div className="auth-visual-content">
              <div className="brand-lockup">
                <div className="brand-mark">AQ</div>
                <div>
                  <div className="eyebrow">Secure invite</div>
                  <strong>AtomQuest Video</strong>
                </div>
              </div>
              <h1>Join your support session.</h1>
              <p>
                Your support agent will see your camera feed only after you grant browser
                permission. No app installation is required.
              </p>
            </div>
            <div className="auth-checklist">
              <div className="auth-check"><span>01</span><span>Enter the name your agent should see.</span></div>
              <div className="auth-check"><span>02</span><span>Allow camera and microphone permissions.</span></div>
              <div className="auth-check"><span>03</span><span>Use chat or file sharing during the call.</span></div>
            </div>
          </section>

          <section className="auth-form-panel">
            <div className="brand-mark">AQ</div>
            <h2>Customer entry</h2>
            <p className="subtitle">This link is valid only for the invited session.</p>
            <form className="form-stack" onSubmit={handleJoin}>
              <div className="input-group">
                <label htmlFor="customerName">Your name</label>
                <input
                  id="customerName"
                  className="input"
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Jane Customer"
                  required
                  autoFocus
                />
              </div>
              {error && <p className="alert">Error: {error}</p>}
              <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>
                {loading ? <span className="spinner" /> : 'Join Video Call'}
              </button>
            </form>
            <p className="subtle" style={{ marginTop: '1.25rem' }}>
              Browser-only call. Camera, microphone, chat, and file sharing are available inside the room.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
