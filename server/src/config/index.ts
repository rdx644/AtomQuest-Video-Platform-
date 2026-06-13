import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  jwtSecret: process.env.JWT_SECRET || 'atomquest-hackathon-secret-key-2024',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  publicOrigin: process.env.PUBLIC_ORIGIN || '',
  graceTimeoutSeconds: parseInt(process.env.GRACE_TIMEOUT_SECONDS || '120', 10),
  uploadDir: process.env.UPLOAD_DIR || './uploads',
  recordingDir: process.env.RECORDING_DIR || './recordings',
  maxFileSize: parseInt(process.env.MAX_FILE_SIZE || '10485760', 10), // 10MB
};
