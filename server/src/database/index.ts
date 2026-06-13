import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

export interface DbSchema {
  users: any[];
  sessions: any[];
  session_events: any[];
  chat_messages: any[];
  recordings: any[];
  files: FileRecord[];
  _meta: { nextEventId: number; nextMessageId: number };
}

export interface FileRecord {
  id: string;
  session_id: string;
  uploader_id: string;
  uploader_name: string;
  uploader_role: string;
  original_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: number;
  url: string;
  created_at: string;
}

let db: DbSchema | null = null;

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getDefaultDb(): DbSchema {
  return {
    users: [],
    sessions: [],
    session_events: [],
    chat_messages: [],
    recordings: [],
    files: [],
    _meta: { nextEventId: 1, nextMessageId: 1 },
  };
}

/**
 * Load database from disk or initialize a new one.
 */
export function getDb(): DbSchema {
  if (db) return db;

  ensureDataDir();

  if (fs.existsSync(DB_FILE)) {
    try {
      const raw = fs.readFileSync(DB_FILE, 'utf-8');
      db = JSON.parse(raw);
      db!.files ||= [];
      db!._meta ||= { nextEventId: 1, nextMessageId: 1 };
      return db!;
    } catch {
      console.warn('⚠️  Failed to parse database file, starting fresh');
    }
  }

  db = getDefaultDb();
  saveDb();
  return db;
}

/**
 * Save database to disk.
 */
export function saveDb(): void {
  if (!db) return;
  ensureDataDir();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf-8');
}

// Auto-save periodically (every 5 seconds)
setInterval(() => {
  if (db) saveDb();
}, 5000);

/**
 * Initialize database with default data.
 */
export function initializeDatabase(): void {
  getDb();
  console.log('✅ Database initialized (JSON file storage)');
}
