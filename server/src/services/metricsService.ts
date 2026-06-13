import { getDb } from '../database';

/**
 * Observability metrics service.
 * Tracks counters and histograms for Prometheus-compatible /metrics endpoint.
 * Satisfies Section 3.5 of the problem statement.
 */

interface MetricCounter {
  name: string;
  help: string;
  type: 'counter' | 'gauge' | 'histogram';
  value: number;
  labels?: Record<string, string>;
}

// In-memory counters
const counters: Record<string, number> = {
  session_errors_total: 0,
  websocket_connections_total: 0,
  websocket_messages_total: 0,
  chat_messages_total: 0,
  files_uploaded_total: 0,
  files_uploaded_bytes_total: 0,
  api_requests_total: 0,
  auth_failures_total: 0,
  recording_started_total: 0,
  recording_stopped_total: 0,
};

// Timing histograms (store individual samples)
const histograms: Record<string, number[]> = {
  session_duration_seconds: [],
  recording_duration_seconds: [],
  api_response_time_ms: [],
};

// Track request timings per endpoint
const endpointTimings: Record<string, number[]> = {};

/**
 * Increment a counter metric.
 */
export function incrementCounter(name: string, amount: number = 1): void {
  if (name in counters) {
    counters[name] += amount;
  }
}

/**
 * Record a histogram observation.
 */
export function recordHistogram(name: string, value: number): void {
  if (name in histograms) {
    histograms[name].push(value);
    // Keep only last 1000 observations to prevent memory leak
    if (histograms[name].length > 1000) {
      histograms[name] = histograms[name].slice(-500);
    }
  }
}

/**
 * Record API response time.
 */
export function recordApiTiming(endpoint: string, durationMs: number): void {
  if (!endpointTimings[endpoint]) {
    endpointTimings[endpoint] = [];
  }
  endpointTimings[endpoint].push(durationMs);
  if (endpointTimings[endpoint].length > 200) {
    endpointTimings[endpoint] = endpointTimings[endpoint].slice(-100);
  }
}

/**
 * Calculate percentiles from a sorted array.
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Compute histogram stats.
 */
function histogramStats(samples: number[]) {
  if (samples.length === 0) return { count: 0, sum: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    sum: Math.round(sum * 100) / 100,
    avg: Math.round((sum / sorted.length) * 100) / 100,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

/**
 * Get connected WebSocket clients count (injected externally).
 */
let getWsCount: (() => number) | null = null;
export function setWsCountFn(fn: () => number): void {
  getWsCount = fn;
}

/**
 * Generate Prometheus-compatible metrics text.
 */
export function generateMetricsText(): string {
  const db = getDb();
  const sessions = db.sessions || [];
  const activeSessions = sessions.filter(s => ['ACTIVE', 'AGENT_WAITING'].includes(s.status));
  const endedSessions = sessions.filter(s => s.status === 'ENDED');
  const connectedParticipants = getWsCount ? getWsCount() : 0;

  const lines: string[] = [];

  // --- Session metrics ---
  lines.push('# HELP active_sessions_total Number of currently active sessions');
  lines.push('# TYPE active_sessions_total gauge');
  lines.push(`active_sessions_total ${activeSessions.length}`);
  lines.push('');

  lines.push('# HELP total_sessions_created Total number of sessions created');
  lines.push('# TYPE total_sessions_created counter');
  lines.push(`total_sessions_created ${sessions.length}`);
  lines.push('');

  lines.push('# HELP ended_sessions_total Number of completed sessions');
  lines.push('# TYPE ended_sessions_total counter');
  lines.push(`ended_sessions_total ${endedSessions.length}`);
  lines.push('');

  // Sessions by status
  lines.push('# HELP sessions_by_status Number of sessions by current status');
  lines.push('# TYPE sessions_by_status gauge');
  const statusCounts: Record<string, number> = {};
  sessions.forEach(s => { statusCounts[s.status] = (statusCounts[s.status] || 0) + 1; });
  for (const [status, count] of Object.entries(statusCounts)) {
    lines.push(`sessions_by_status{status="${status}"} ${count}`);
  }
  lines.push('');

  // --- Connection metrics ---
  lines.push('# HELP connected_participants_total Number of currently connected WebSocket participants');
  lines.push('# TYPE connected_participants_total gauge');
  lines.push(`connected_participants_total ${connectedParticipants}`);
  lines.push('');

  lines.push('# HELP websocket_connections_total Total WebSocket connections established');
  lines.push('# TYPE websocket_connections_total counter');
  lines.push(`websocket_connections_total ${counters.websocket_connections_total}`);
  lines.push('');

  lines.push('# HELP websocket_messages_total Total WebSocket messages processed');
  lines.push('# TYPE websocket_messages_total counter');
  lines.push(`websocket_messages_total ${counters.websocket_messages_total}`);
  lines.push('');

  // --- Error metrics ---
  lines.push('# HELP session_errors_total Total number of session errors');
  lines.push('# TYPE session_errors_total counter');
  lines.push(`session_errors_total ${counters.session_errors_total}`);
  lines.push('');

  lines.push('# HELP auth_failures_total Total number of authentication failures');
  lines.push('# TYPE auth_failures_total counter');
  lines.push(`auth_failures_total ${counters.auth_failures_total}`);
  lines.push('');

  // --- Chat metrics ---
  lines.push('# HELP chat_messages_total Total chat messages sent');
  lines.push('# TYPE chat_messages_total counter');
  lines.push(`chat_messages_total ${counters.chat_messages_total}`);
  lines.push('');

  // --- File metrics ---
  lines.push('# HELP files_uploaded_total Total files uploaded');
  lines.push('# TYPE files_uploaded_total counter');
  lines.push(`files_uploaded_total ${counters.files_uploaded_total}`);
  lines.push('');

  lines.push('# HELP files_uploaded_bytes_total Total bytes of files uploaded');
  lines.push('# TYPE files_uploaded_bytes_total counter');
  lines.push(`files_uploaded_bytes_total ${counters.files_uploaded_bytes_total}`);
  lines.push('');

  // --- Recording metrics ---
  lines.push('# HELP recording_started_total Total recordings started');
  lines.push('# TYPE recording_started_total counter');
  lines.push(`recording_started_total ${counters.recording_started_total}`);
  lines.push('');

  lines.push('# HELP recording_stopped_total Total recordings stopped');
  lines.push('# TYPE recording_stopped_total counter');
  lines.push(`recording_stopped_total ${counters.recording_stopped_total}`);
  lines.push('');

  // --- Session duration histogram ---
  const sessionDurStats = histogramStats(histograms.session_duration_seconds);
  if (sessionDurStats.count > 0) {
    lines.push('# HELP session_duration_seconds Duration of completed sessions');
    lines.push('# TYPE session_duration_seconds summary');
    lines.push(`session_duration_seconds{quantile="0.5"} ${sessionDurStats.p50}`);
    lines.push(`session_duration_seconds{quantile="0.95"} ${sessionDurStats.p95}`);
    lines.push(`session_duration_seconds{quantile="0.99"} ${sessionDurStats.p99}`);
    lines.push(`session_duration_seconds_sum ${sessionDurStats.sum}`);
    lines.push(`session_duration_seconds_count ${sessionDurStats.count}`);
    lines.push('');
  }

  // --- API response time ---
  const apiStats = histogramStats(histograms.api_response_time_ms);
  if (apiStats.count > 0) {
    lines.push('# HELP api_response_time_ms API response time in milliseconds');
    lines.push('# TYPE api_response_time_ms summary');
    lines.push(`api_response_time_ms{quantile="0.5"} ${apiStats.p50}`);
    lines.push(`api_response_time_ms{quantile="0.95"} ${apiStats.p95}`);
    lines.push(`api_response_time_ms{quantile="0.99"} ${apiStats.p99}`);
    lines.push(`api_response_time_ms_sum ${apiStats.sum}`);
    lines.push(`api_response_time_ms_count ${apiStats.count}`);
    lines.push('');
  }

  // --- API requests total ---
  lines.push('# HELP api_requests_total Total API requests processed');
  lines.push('# TYPE api_requests_total counter');
  lines.push(`api_requests_total ${counters.api_requests_total}`);
  lines.push('');

  // --- Process/uptime metrics ---
  lines.push('# HELP process_uptime_seconds Server uptime in seconds');
  lines.push('# TYPE process_uptime_seconds gauge');
  lines.push(`process_uptime_seconds ${Math.round(process.uptime())}`);
  lines.push('');

  lines.push('# HELP process_heap_bytes Node.js heap used bytes');
  lines.push('# TYPE process_heap_bytes gauge');
  lines.push(`process_heap_bytes ${process.memoryUsage().heapUsed}`);
  lines.push('');

  return lines.join('\n');
}

/**
 * Get metrics as a structured JSON object (for admin dashboard API).
 */
export function getMetricsJSON() {
  const db = getDb();
  const sessions = db.sessions || [];

  return {
    sessions: {
      total: sessions.length,
      active: sessions.filter(s => s.status === 'ACTIVE').length,
      waiting: sessions.filter(s => s.status === 'AGENT_WAITING').length,
      ended: sessions.filter(s => s.status === 'ENDED').length,
      created: sessions.filter(s => s.status === 'CREATED').length,
    },
    connections: {
      current: getWsCount ? getWsCount() : 0,
      total: counters.websocket_connections_total,
    },
    chat: {
      totalMessages: counters.chat_messages_total,
    },
    files: {
      totalUploaded: counters.files_uploaded_total,
      totalBytes: counters.files_uploaded_bytes_total,
    },
    recordings: {
      started: counters.recording_started_total,
      stopped: counters.recording_stopped_total,
    },
    errors: {
      sessionErrors: counters.session_errors_total,
      authFailures: counters.auth_failures_total,
    },
    system: {
      uptimeSeconds: Math.round(process.uptime()),
      heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 100) / 100,
    },
  };
}
