const API_BASE = 'http://localhost:3001/api';
const WS_BASE = 'ws://localhost:3001/ws';

export { WS_BASE };

function getToken(): string | null {
  return localStorage.getItem('token');
}

async function request(endpoint: string, options: RequestInit = {}): Promise<any> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

export const api = {
  // Auth
  login: (username: string, password: string) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),

  getMe: () => request('/auth/me'),

  // Sessions
  createSession: (graceTimeout?: number) =>
    request('/sessions', { method: 'POST', body: JSON.stringify({ graceTimeout }) }),

  getSessions: () => request('/sessions'),

  getSession: (id: string) => request(`/sessions/${id}`),

  getLiveSessions: () => request('/sessions/live'),

  joinSession: (token: string, customerName: string) =>
    request(`/sessions/join/${token}`, { method: 'POST', body: JSON.stringify({ customerName }) }),

  generateInvite: (sessionId: string, customerName?: string) =>
    request(`/sessions/${sessionId}/invite`, { method: 'POST', body: JSON.stringify({ customerName }) }),

  endSession: (id: string) =>
    request(`/sessions/${id}/end`, { method: 'POST' }),

  forceEndSession: (id: string) =>
    request(`/sessions/${id}/force-end`, { method: 'POST' }),

  getSessionEvents: (id: string) => request(`/sessions/${id}/events`),

  getSessionMessages: (id: string) => request(`/sessions/${id}/messages`),

  // Files
  uploadFile: async (sessionId: string, file: File) => {
    const token = getToken();
    const formData = new FormData();
    formData.append('file', file);
    formData.append('sessionId', sessionId);

    const res = await fetch(`${API_BASE}/files/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Upload failed');
    return data;
  },

  getSessionFiles: (sessionId: string) => request(`/files/session/${sessionId}`),

  // Metrics (admin)
  getMetrics: () => request('/metrics'),
};

