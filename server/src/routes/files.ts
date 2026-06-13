import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAuth } from '../middleware/auth';
import { FileRecord, getDb, saveDb } from '../database';
import * as sessionManager from '../services/sessionManager';
import { canAccessSession } from '../services/accessControl';
import { config } from '../config';
import { incrementCounter } from '../services/metricsService';

const router = Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.resolve(config.uploadDir);
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  },
});

const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'application/zip',
];

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx', '.txt', '.zip']);

function safeOriginalName(name: string): string {
  return path.basename(name).replace(/[^\w.\- ()]/g, '_').slice(0, 180) || 'uploaded-file';
}

const upload = multer({
  storage,
  limits: { fileSize: config.maxFileSize },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_TYPES.includes(file.mimetype) && ALLOWED_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype || ext || 'unknown'} is not allowed`));
    }
  },
});

/**
 * POST /api/files/upload
 * Upload a file during an active session.
 */
router.post('/upload', requireAuth, (req: Request, res: Response): void => {
  upload.single('file')(req, res, (err: any) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          res.status(413).json({ error: `File too large. Max size: ${config.maxFileSize / 1024 / 1024}MB` });
          return;
        }
        res.status(400).json({ error: err.message });
        return;
      }
      res.status(400).json({ error: err.message || 'Upload failed' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    const sessionId = String(req.body.sessionId || '');
    if (!sessionId) {
      // Clean up uploaded file
      fs.unlinkSync(req.file.path);
      res.status(400).json({ error: 'Session ID is required' });
      return;
    }

    // Verify session exists and is active
    const session = sessionManager.getSession(sessionId);
    if (!session || session.status === 'ENDED') {
      fs.unlinkSync(req.file.path);
      res.status(400).json({ error: 'Session not found or has ended' });
      return;
    }
    if (!canAccessSession(req.user!, session)) {
      fs.unlinkSync(req.file.path);
      res.status(403).json({ error: 'Access denied for this session' });
      return;
    }

    // Store file metadata in database
    const db = getDb();
    const fileRecord: FileRecord = {
      id: `file-${Date.now()}-${Math.round(Math.random() * 1e9)}`,
      session_id: sessionId,
      uploader_id: req.user!.userId,
      uploader_name: req.user!.displayName,
      uploader_role: req.user!.role,
      original_name: safeOriginalName(req.file.originalname),
      stored_name: req.file.filename,
      mime_type: req.file.mimetype,
      size_bytes: req.file.size,
      url: '',
      created_at: new Date().toISOString(),
    };
    fileRecord.url = `/api/files/${fileRecord.id}/download`;

    db.files.push(fileRecord);
    saveDb();
    incrementCounter('files_uploaded_total');
    incrementCounter('files_uploaded_bytes_total', req.file.size);

    // Log the event
    sessionManager.logEvent(sessionId, 'FILE_UPLOADED', req.user!.role, req.user!.userId, {
      fileName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
    });

    res.status(201).json({
      file: {
        id: fileRecord.id,
        originalName: fileRecord.original_name,
        mimeType: fileRecord.mime_type,
        sizeBytes: fileRecord.size_bytes,
        url: fileRecord.url,
        uploadedBy: fileRecord.uploader_name,
        uploadedAt: fileRecord.created_at,
      },
    });
  });
});

/**
 * GET /api/files/session/:sessionId
 * Get all files for a session.
 */
router.get('/session/:sessionId', requireAuth, (req: Request, res: Response): void => {
  const sessionId = String(req.params.sessionId);
  const session = sessionManager.getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  if (!canAccessSession(req.user!, session)) {
    res.status(403).json({ error: 'Access denied for this session' });
    return;
  }

  const db = getDb();
  const files = db.files
    .filter((f: FileRecord) => f.session_id === sessionId)
    .map((f: FileRecord) => ({
      id: f.id,
      originalName: f.original_name,
      mimeType: f.mime_type,
      sizeBytes: f.size_bytes,
      url: f.url,
      uploadedBy: f.uploader_name,
      uploadedRole: f.uploader_role,
      uploadedAt: f.created_at,
    }));

  res.json({ files });
});

/**
 * GET /api/files/:fileId/download
 * Authenticated file retrieval scoped to the session record.
 */
router.get('/:fileId/download', requireAuth, (req: Request, res: Response): void => {
  const file = getDb().files.find((f: FileRecord) => f.id === req.params.fileId);
  if (!file) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  const session = sessionManager.getSession(file.session_id);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  if (!canAccessSession(req.user!, session)) {
    res.status(403).json({ error: 'Access denied for this file' });
    return;
  }

  const uploadDir = path.resolve(config.uploadDir);
  const filePath = path.join(uploadDir, path.basename(file.stored_name));
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'Stored file missing' });
    return;
  }

  res.setHeader('Content-Type', file.mime_type);
  res.setHeader('Content-Disposition', `inline; filename="${file.original_name.replace(/"/g, '')}"`);
  res.sendFile(filePath);
});

export default router;
