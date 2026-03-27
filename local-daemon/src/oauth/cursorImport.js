import sqlite3 from 'sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { updateToken } from './tokenStorage.js';
import { log } from '../logger.js';

const HOME = homedir();
const APPDATA = process.env.APPDATA || join(HOME, 'AppData', 'Roaming');

export async function importCursorToken() {
  return new Promise((resolve, reject) => {
    // Cursor token storage locations (state.vscdb)
    const paths = [
      join(APPDATA, 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
      join(HOME, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
      join(HOME, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb'),
    ];

    let dbPath = paths.find(p => existsSync(p));
    if (!dbPath) {
      log.warn("Cursor state.vscdb not found in default locations");
      return reject(new Error("Cursor state.vscdb not found"));
    }

    // Connect to SQLite DB
    const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
      if (err) return reject(new Error(`Failed to open Cursor DB: ${err.message}`));
    });

    // We need two keys: cursorAuth/accessToken AND storage.serviceMachineId
    const query = `SELECT key, value FROM ItemTable WHERE key IN ('cursorAuth/accessToken', 'storage.serviceMachineId')`;

    db.all(query, [], async (err, rows) => {
      db.close();
      if (err) return reject(err);

      let accessToken = null;
      let machineId = null;

      rows.forEach(row => {
        if (row.key === 'cursorAuth/accessToken') {
          // value is technically a JSON string with quotes, so strip them
          accessToken = row.value.replace(/^["']|["']$/g, ''); 
        } else if (row.key === 'storage.serviceMachineId') {
          machineId = row.value.replace(/^["']|["']$/g, '');
        }
      });

      if (accessToken) {
        log.info(`✅ Successfully imported token from Cursor SQLite DB`);
        await updateToken('cursor', {
            accessToken,
            machineId,
            source: 'cursor-sqlite'
        });
        return resolve({ success: true, machineId });
      }

      reject(new Error("No Cursor accessToken found in state.vscdb"));
    });
  });
}
