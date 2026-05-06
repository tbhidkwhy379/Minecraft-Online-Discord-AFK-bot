'use strict';

const fs   = require('fs');
const path = require('path');

const DB_PATH = path.resolve(process.cwd(), 'database.json');
const TMP_PATH = DB_PATH + '.tmp';

/**
 * Tiny synchronous key/value store backed by a single JSON file.
 *
 * Writes are ATOMIC: the new state is written to a `.tmp` file first,
 * then renamed (fs.renameSync) over the real file. On POSIX systems
 * this rename is atomic at the OS level — a crash mid-write leaves the
 * original file intact.
 */
class Database {
  constructor() {
    this._cache = this._load();
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  get(key) {
    return this._cache[key];
  }

  set(key, value) {
    this._cache[key] = value;
    this._persist();
  }

  delete(key) {
    delete this._cache[key];
    this._persist();
  }

  all() {
    return { ...this._cache };
  }

  // ─── Private Helpers ─────────────────────────────────────────────────────

  _load() {
    try {
      if (!fs.existsSync(DB_PATH)) return {};
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      return JSON.parse(raw);
    } catch (err) {
      console.warn('[Database] Could not read database.json — starting fresh:', err.message);
      return {};
    }
  }

  /**
   * Atomic write:
   *   1. Serialise to JSON.
   *   2. Write to database.json.tmp (partial writes go here, not the real file).
   *   3. fsync — flushes OS buffers to disk.
   *   4. Rename .tmp → database.json (atomic on POSIX; nearly atomic on Windows).
   */
  _persist() {
    const json = JSON.stringify(this._cache, null, 2);
    const fd   = fs.openSync(TMP_PATH, 'w');
    try {
      fs.writeSync(fd, json, 0, 'utf8');
      fs.fsyncSync(fd);   // flush to physical disk before rename
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(TMP_PATH, DB_PATH);
  }
}

module.exports = Database;
