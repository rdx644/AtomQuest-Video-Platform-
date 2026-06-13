import express from 'express';
import cors from 'cors';
import http from 'http';
import path from 'path';
import fs from 'fs';
import { config } from './config';
import { initializeDatabase } from './database';
import { seedDatabase } from './database/init';
import { initWebSocket, setMediaManager, getConnectedParticipantsCount } from './websocket/handler';
import { MediaManager } from './media/mediaManager';
import authRoutes from './routes/auth';
import sessionRoutes from './routes/sessions';
import fileRoutes from './routes/files';
import { generateMetricsText, getMetricsJSON, setWsCountFn, incrementCounter, recordApiTiming, recordHistogram } from './services/metricsService';

async function main() {
  console.log('🚀 Starting AtomQuest Video Platform Server...\n');

  // 1. Initialize database & seed
  initializeDatabase();
  seedDatabase();

  // Ensure upload/recording dirs exist
  const uploadDir = path.join(__dirname, '..', 'uploads');
  const recordingDir = path.join(__dirname, '..', 'recordings');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  if (!fs.existsSync(recordingDir)) fs.mkdirSync(recordingDir, { recursive: true });

  // 2. Create Express app
  const app = express();
  app.use(cors({ origin: '*', credentials: true }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // --- Observability: API timing middleware ---
  app.use((req, _res, next) => {
    const start = Date.now();
    incrementCounter('api_requests_total');
    _res.on('finish', () => {
      const duration = Date.now() - start;
      recordApiTiming(`${req.method} ${req.path}`, duration);
      recordHistogram('api_response_time_ms', duration);
    });
    next();
  });

  // Serve uploaded files and recordings
  app.use('/uploads', express.static(uploadDir));
  app.use('/recordings', express.static(recordingDir));

  // 3. API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/sessions', sessionRoutes);
  app.use('/api/files', fileRoutes);

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: Math.round(process.uptime()),
      version: '1.0.0',
    });
  });

  // --- Prometheus-compatible metrics endpoint (full observability) ---
  app.get('/metrics', (_req, res) => {
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(generateMetricsText());
  });

  // --- JSON metrics endpoint (for admin dashboard) ---
  app.get('/api/metrics', (_req, res) => {
    res.json(getMetricsJSON());
  });

  // 4. Create HTTP server
  const server = http.createServer(app);

  // 5. Initialize Media Manager
  const mediaManager = new MediaManager();
  await mediaManager.initialize();
  setMediaManager(mediaManager);

  // 6. Initialize WebSocket
  initWebSocket(server);

  // Wire up WS count to metrics service
  setWsCountFn(getConnectedParticipantsCount);

  // 7. Start server
  server.listen(config.port, () => {
    console.log(`\n✅ Server running on http://localhost:${config.port}`);
    console.log(`   API:         http://localhost:${config.port}/api`);
    console.log(`   WebSocket:   ws://localhost:${config.port}/ws`);
    console.log(`   Metrics:     http://localhost:${config.port}/metrics`);
    console.log(`   Metrics API: http://localhost:${config.port}/api/metrics`);
    console.log(`   File Upload: http://localhost:${config.port}/api/files/upload`);
    console.log(`   Client:      ${config.corsOrigin}`);
    console.log(`\n📋 Demo Credentials:`);
    console.log(`   Agent:  agent1 / password123`);
    console.log(`   Agent:  agent2 / password123`);
    console.log(`   Admin:  admin  / password123`);
    console.log('');
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
