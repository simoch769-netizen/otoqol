'use strict';
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'otoqol.sqlite');
const KEEP_HISTORY = Number(process.env.KEEP_HISTORY || 200);          // snapshots kept per school
const SNAPSHOT_EVERY_MIN = Number(process.env.SNAPSHOT_EVERY_MIN || 10); // min minutes between auto snapshots

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

db.exec(`
CREATE TABLE IF NOT EXISTS schools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  licence_key TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  token_gen INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS school_data (
  school_id INTEGER PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 0,
  data TEXT,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_history_school ON history(school_id, id);
`);

const genLicence = () => 'OTQ-' + crypto.randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g).join('-');
const genPassword = () => crypto.randomBytes(6).toString('base64url');
const normCode = c => String(c || '').trim().toLowerCase();

function createSchool({ code, name, password }) {
  code = normCode(code);
  if (!/^[a-z0-9][a-z0-9_-]{1,39}$/.test(code)) throw new Error('code must be 2-40 chars: a-z 0-9 _ -');
  password = password || genPassword();
  if (String(password).length < 6) throw new Error('password must be at least 6 chars');
  const licence = genLicence();
  const hash = bcrypt.hashSync(String(password), 11);
  const tx = db.transaction(() => {
    const r = db.prepare('INSERT INTO schools(code,name,licence_key,password_hash) VALUES (?,?,?,?)').run(code, name || code, licence, hash);
    db.prepare('INSERT INTO school_data(school_id,version,data,updated_at) VALUES (?,0,NULL,NULL)').run(r.lastInsertRowid);
    return r.lastInsertRowid;
  });
  const id = tx();
  return { id, code, name: name || code, licence_key: licence, password };
}

const findSchool = ident => {
  const s = String(ident || '').trim();
  return db.prepare('SELECT * FROM schools WHERE code = ? COLLATE NOCASE OR licence_key = ? COLLATE NOCASE').get(s, s);
};
const getSchoolById = id => db.prepare('SELECT * FROM schools WHERE id = ?').get(id);
const listSchools = () => db.prepare(`SELECT s.id,s.code,s.name,s.licence_key,s.active,s.created_at,d.version,d.updated_at,length(d.data) AS bytes
  FROM schools s JOIN school_data d ON d.school_id=s.id ORDER BY s.id`).all();

function setPassword(ident, password) {
  const s = findSchool(ident); if (!s) throw new Error('school not found');
  password = password || genPassword();
  if (String(password).length < 6) throw new Error('password must be at least 6 chars');
  // bump token_gen => all existing sessions of this school are revoked
  db.prepare('UPDATE schools SET password_hash=?, token_gen=token_gen+1 WHERE id=?').run(bcrypt.hashSync(String(password), 11), s.id);
  return { code: s.code, password };
}
function setActive(ident, active) {
  const s = findSchool(ident); if (!s) throw new Error('school not found');
  db.prepare('UPDATE schools SET active=?, token_gen=token_gen+1 WHERE id=?').run(active ? 1 : 0, s.id);
  return { code: s.code, active: !!active };
}
function checkPassword(school, password) {
  return bcrypt.compareSync(String(password || ''), school.password_hash);
}

const getData = schoolId => db.prepare('SELECT version,data,updated_at FROM school_data WHERE school_id=?').get(schoolId);

function snapshot(schoolId, reason, force) {
  const cur = getData(schoolId);
  if (!cur || cur.data == null) return false;
  if (!force) {
    const last = db.prepare('SELECT created_at FROM history WHERE school_id=? ORDER BY id DESC LIMIT 1').get(schoolId);
    if (last && (Date.now() - Date.parse(last.created_at + 'Z')) < SNAPSHOT_EVERY_MIN * 60000) return false;
  }
  db.prepare('INSERT INTO history(school_id,version,data,reason) VALUES (?,?,?,?)').run(schoolId, cur.version, cur.data, reason);
  db.prepare(`DELETE FROM history WHERE school_id=? AND id NOT IN (SELECT id FROM history WHERE school_id=? ORDER BY id DESC LIMIT ?)`).run(schoolId, schoolId, KEEP_HISTORY);
  return true;
}

/** Optimistic-concurrency write. Returns {ok, version} or {ok:false, version:current} */
const putData = db.transaction((schoolId, baseVersion, dataStr, reason = 'auto') => {
  const cur = getData(schoolId);
  if (baseVersion !== null && cur.version !== baseVersion) return { ok: false, version: cur.version };
  snapshot(schoolId, reason, reason !== 'auto');
  const v = cur.version + 1;
  db.prepare("UPDATE school_data SET version=?, data=?, updated_at=datetime('now') WHERE school_id=?").run(v, dataStr, schoolId);
  return { ok: true, version: v };
});

const listHistory = schoolId => db.prepare('SELECT id,version,reason,created_at,length(data) AS bytes FROM history WHERE school_id=? ORDER BY id DESC').all(schoolId);
const getHistory = (schoolId, hid) => db.prepare('SELECT * FROM history WHERE school_id=? AND id=?').get(schoolId, hid);

async function backupFile(dest) { await db.backup(dest); return dest; }

module.exports = { db, DB_FILE, DATA_DIR, createSchool, findSchool, getSchoolById, listSchools, setPassword, setActive,
  checkPassword, getData, putData, snapshot, listHistory, getHistory, backupFile, normCode };
