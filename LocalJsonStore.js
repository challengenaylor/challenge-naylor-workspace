'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Generic disk-persisted JSON array store.
 *
 * THIS IS WHAT MAKES DUPLICATE DETECTION REAL ACROSS SEPARATE EXECUTIONS.
 * An in-memory Set only proves idempotency within one process. Every write
 * here goes to disk (atomic write via temp-file-then-rename) and every read
 * re-loads from disk, so a second, independent `node` process invocation
 * genuinely sees what the first one wrote. test/run-repositories.js proves
 * this by spawning two separate child processes.
 */
class LocalJsonStore {
  constructor(fileName, dir) {
    this.dir = dir || path.join(__dirname, '..', '..', '..', 'local-data');
    this.file = path.join(this.dir, fileName);
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
    if (!fs.existsSync(this.file)) fs.writeFileSync(this.file, '[]');
  }

  readAll() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (e) {
      // A corrupt or half-written file must never look like "empty" — that
      // would silently drop duplicate-detection history. Fail loudly instead.
      throw new Error(`LocalJsonStore: ${this.file} is corrupt and cannot be read safely: ${e.message}`);
    }
  }

  writeAll(records) {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(records, null, 2));
    fs.renameSync(tmp, this.file); // atomic on POSIX filesystems
  }

  append(record) {
    const all = this.readAll();
    all.push(record);
    this.writeAll(all);
    return record;
  }

  find(predicate) {
    return this.readAll().find(predicate) || null;
  }

  filter(predicate) {
    return this.readAll().filter(predicate);
  }

  /** Replace one record matched by predicate; used only where the interface explicitly allows mutation. */
  replaceOne(predicate, updater) {
    const all = this.readAll();
    const idx = all.findIndex(predicate);
    if (idx === -1) return null;
    all[idx] = updater(all[idx]);
    this.writeAll(all);
    return all[idx];
  }
}

module.exports = { LocalJsonStore };
