const isProduction = import.meta.env.PROD;
const API_BASE = import.meta.env.VITE_API_BASE || (isProduction ? '/api' : 'http://localhost:3001/api');
const SERVER_BASE = API_BASE.startsWith('http') ? API_BASE.replace(/\/api\/?$/, '') : '';
const WS_BASE = import.meta.env.VITE_WS_BASE || (isProduction
  ? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`
  : `${SERVER_BASE.replace(/^http/, 'ws')}/ws`);

export { WS_BASE };

function getToken(): string | null {
  return localStorage.getItem('token');
}

async function request(endpoint: string, options: RequestInit = {}): Promise<any> {
  const token = getToken();
  const headers: Record<string, string> = { ...((options.headers as Record<string, string>) || {}) };
  if (options.body && !(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  const contentType = res.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await res.json() : await res.text();
  if (!res.ok) {
    const message = typeof data === 'object' && data?.error ? data.error : 'Request failed';
    throw new Error(message);
  }
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

  getAssetUrl: (url: string) => {
    const absoluteUrl = url.startsWith('http') ? url : `${SERVER_BASE}${url}`;
    const token = getToken();
    if (!token) return absoluteUrl;
    const separator = absoluteUrl.includes('?') ? '&' : '?';
    return `${absoluteUrl}${separator}token=${encodeURIComponent(token)}`;
  },

  // Metrics (admin)
  getMetrics: () => request('/metrics'),
};
