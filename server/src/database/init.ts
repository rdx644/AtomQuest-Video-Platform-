import { getDb, saveDb } from './index';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

/**
 * Seed the database with default users for demo/judging.
 */
export function seedDatabase(): void {
  const db = getDb();

  if (db.users.length > 0) {
    console.log('ℹ️  Users already exist, skipping seed');
    return;
  }

  const passwordHash = bcrypt.hashSync('password123', 10);

  const users = [
    { id: uuidv4(), username: 'agent1', password_hash: passwordHash, display_name: 'Sarah Johnson', role: 'agent', created_at: new Date().toISOString() },
    { id: uuidv4(), username: 'agent2', password_hash: passwordHash, display_name: 'Mike Chen', role: 'agent', created_at: new Date().toISOString() },
    { id: uuidv4(), username: 'admin', password_hash: passwordHash, display_name: 'Admin User', role: 'admin', created_at: new Date().toISOString() },
  ];

  db.users.push(...users);
  saveDb();

  console.log('✅ Seed data inserted:');
  users.forEach(u => console.log(`   ${u.role}: ${u.username} / password123`));
}

// Run if executed directly
if (require.main === module) {
  const { initializeDatabase } = require('./index');
  initializeDatabase();
  seedDatabase();
}
