import { useState } from 'react';
import { api } from '../services/api';
import type { User } from '../App';

interface LoginProps { onLogin: (user: User, token: string) => void; }

export default function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api.login(username, password);
      onLogin({
        userId: data.user.id,
        username: data.user.username,
        displayName: data.user.displayName,
        role: data.user.role,
      }, data.token);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-centered">
      <div className="card login-card" style={{ animation: 'fadeIn 0.45s ease' }}>
        <div className="auth-layout">
          <section className="auth-visual" aria-label="AtomQuest platform overview">
            <div className="auth-visual-content">
              <div className="brand-lockup">
                <div className="brand-mark">AQ</div>
                <div>
                  <div className="eyebrow">Owned video support</div>
                  <strong>AtomQuest Video</strong>
                </div>
              </div>
              <h1>Resolve what voice calls cannot show.</h1>
              <p>
                A browser-based support room for agent-led video calls, persisted chat,
                session audit trails, file exchange, and admin oversight.
              </p>
            </div>
            <div className="auth-checklist">
              <div className="auth-check"><span>01</span><span>Agent creates a secure customer invite.</span></div>
              <div className="auth-check"><span>02</span><span>Media routes through the application server.</span></div>
              <div className="auth-check"><span>03</span><span>Session history remains queryable after the call.</span></div>
            </div>
          </section>

          <section className="auth-form-panel">
            <div className="brand-mark">AQ</div>
            <h2>Sign in</h2>
            <p className="subtitle">Use an agent or admin account to start the judging flow.</p>
            <form className="form-stack" onSubmit={handleSubmit}>
              <div className="input-group">
                <label htmlFor="username">Username</label>
                <input
                  id="username"
                  className="input"
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="agent1"
                  required
                  autoFocus
                />
              </div>
              <div className="input-group">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  className="input"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="password123"
                  required
                />
              </div>
              {error && <p className="alert">Error: {error}</p>}
              <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>
                {loading ? <span className="spinner" /> : 'Sign In'}
              </button>
            </form>

            <div className="demo-credentials">
              <div className="eyebrow">Demo credentials</div>
              <div className="credential-row"><span>Call Agent</span><code>agent1 / password123</code></div>
              <div className="credential-row"><span>Operations Admin</span><code>admin / password123</code></div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
