import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import * as path from 'path';

let dbPath = 'sqlite.db';

// Check if running inside Electron main process
try {
  // We use standard require or process check to see if electron app is available
  const { app } = require('electron');
  if (app) {
    dbPath = path.join(app.getPath('userData'), 'sqlite.db');
  }
} catch (e) {
  // Fallback to local file for CLI, migrations, testing, or other environments
}

const sqlite = new Database(dbPath);
// Enable foreign keys for Cascade delete etc.
sqlite.exec('PRAGMA foreign_keys = ON;');

export const db = drizzle(sqlite, { schema });
export type DatabaseInstance = typeof db;
