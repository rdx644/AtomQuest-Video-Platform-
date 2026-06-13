import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import CallRoom from './pages/CallRoom';
import CustomerJoin from './pages/CustomerJoin';
import AdminDashboard from './pages/AdminDashboard';
import SessionHistory from './pages/SessionHistory';

export interface User {
  userId: string;
  username: string;
  displayName: string;
  role: 'agent' | 'admin' | 'customer';
  sessionId?: string;
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = localStorage.getItem('user');
    const token = localStorage.getItem('token');
    if (stored && token) {
      try {
        setUser(JSON.parse(stored));
      } catch {}
    }
    setLoading(false);
  }, []);

  const handleLogin = (userData: User, token: string) => {
    localStorage.setItem('user', JSON.stringify(userData));
    localStorage.setItem('token', token);
    setUser(userData);
  };

  const handleLogout = () => {
    localStorage.removeItem('user');
    localStorage.removeItem('token');
    setUser(null);
  };

  if (loading) {
    return (
      <div className="page-centered">
        <div className="spinner" />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Customer join route — no auth needed */}
        <Route path="/join/:token" element={<CustomerJoin />} />

        {/* Call room — for both agent and customer */}
        <Route
          path="/call/:sessionId"
          element={user ? <CallRoom user={user} onLogout={handleLogout} /> : <Navigate to="/login" replace />}
        />

        {/* Auth-protected routes */}
        {!user ? (
          <>
            <Route path="/login" element={<Login onLogin={handleLogin} />} />
            <Route path="*" element={<Navigate to="/login" replace />} />
          </>
        ) : user.role === 'admin' ? (
          <>
            <Route path="/admin" element={<AdminDashboard user={user} onLogout={handleLogout} />} />
            <Route path="/sessions/:id" element={<SessionHistory user={user} onLogout={handleLogout} />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </>
        ) : (
          <>
            <Route path="/dashboard" element={<Dashboard user={user} onLogout={handleLogout} />} />
            <Route path="/sessions/:id" element={<SessionHistory user={user} onLogout={handleLogout} />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </>
        )}
      </Routes>
    </BrowserRouter>
  );
}

export default App;
