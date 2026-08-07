import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import path from 'path';

let dbPath = 'sqlite.db';

if (process.versions && process.versions.electron) {
  try {
    // Dynamically require electron to prevent loading it in standard non-electron environments
    const electron = require('electron');
    const app = electron.app;
    if (app) {
      dbPath = path.join(app.getPath('userData'), 'sqlite.db');
    }
  } catch (error) {
    console.error('Failed to resolve Electron app userData path, falling back to local database file:', error);
  }
}

const sqlite = new Database(dbPath);
// Enable foreign keys for Cascade delete etc.
sqlite.exec('PRAGMA foreign_keys = ON;');

export const db = drizzle(sqlite, { schema });
export type DatabaseInstance = typeof db;
