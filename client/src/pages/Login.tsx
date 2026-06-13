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
    setError(''); setLoading(true);
    try {
      const data = await api.login(username, password);
      onLogin({ userId: data.user.id, username: data.user.username, displayName: data.user.displayName, role: data.user.role }, data.token);
    } catch (err: any) { setError(err.message || 'Login failed'); }
    finally { setLoading(false); }
  };

  return (
    <div className="page-centered">
      <div className="card login-card" style={{ animation: 'fadeIn 0.5s ease' }}>
        <div style={{ textAlign: 'center', marginBottom: '0.5rem' }}>
          <div style={{ width: 56, height: 56, background: 'var(--accent-gradient)', borderRadius: 'var(--radius-md)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.75rem', marginBottom: '1rem' }}>📹</div>
        </div>
        <h1>AtomQuest Video</h1>
        <p className="subtitle">Real-Time Video Support Platform</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group input-group">
            <label htmlFor="username">Username</label>
            <input id="username" className="input" type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="Enter your username" required autoFocus />
          </div>
          <div className="form-group input-group" style={{ marginTop: '1rem' }}>
            <label htmlFor="password">Password</label>
            <input id="password" className="input" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your password" required />
          </div>
          {error && <p style={{ color: 'var(--danger)', fontSize: '0.875rem', marginTop: '0.75rem' }}>⚠️ {error}</p>}
          <button type="submit" className="btn btn-primary btn-lg login-btn" disabled={loading} style={{ marginTop: '1.5rem' }}>
            {loading ? <span className="spinner" /> : 'Sign In'}
          </button>
        </form>
        <div className="divider">Demo Credentials</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>🧑‍💼 Agent</span><code style={{ color: 'var(--accent-primary)' }}>agent1 / password123</code></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>🔧 Admin</span><code style={{ color: 'var(--accent-primary)' }}>admin / password123</code></div>
        </div>
      </div>
    </div>
  );
}
