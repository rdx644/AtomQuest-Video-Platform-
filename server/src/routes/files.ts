import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAuth } from '../middleware/auth';
import { getDb, saveDb } from '../database';
import * as sessionManager from '../services/sessionManager';
import { config } from '../config';

const router = Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(__dirname, '..', '..', 'uploads');
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

const upload = multer({
  storage,
  limits: { fileSize: config.maxFileSize },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} is not allowed`));
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

    const sessionId = req.body.sessionId;
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

    // Store file metadata in database
    const db = getDb();
    const fileRecord = {
      id: `file-${Date.now()}`,
      session_id: sessionId,
      uploader_id: req.user!.userId,
      uploader_name: req.user!.displayName,
      uploader_role: req.user!.role,
      original_name: req.file.originalname,
      stored_name: req.file.filename,
      mime_type: req.file.mimetype,
      size_bytes: req.file.size,
      url: `/uploads/${req.file.filename}`,
      created_at: new Date().toISOString(),
    };

    if (!db.files) db.files = [];
    db.files.push(fileRecord);
    saveDb();

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
  const db = getDb();
  const files = (db.files || [])
    .filter((f: any) => f.session_id === req.params.sessionId)
    .map((f: any) => ({
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

export default router;
