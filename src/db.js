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
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  school_id INTEGER NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);
`);

// Multi-school signup: status + contact columns (existing schools stay active/inactive).
(function migrateSchools() {
  const cols = new Set(db.prepare('PRAGMA table_info(schools)').all().map(c => c.name));
  const add = (name, sql) => { if (!cols.has(name)) db.exec(sql); };
  add('status', "ALTER TABLE schools ADD COLUMN status TEXT NOT NULL DEFAULT 'active'");
  add('city', 'ALTER TABLE schools ADD COLUMN city TEXT');
  add('contact_name', 'ALTER TABLE schools ADD COLUMN contact_name TEXT');
  add('contact_email', 'ALTER TABLE schools ADD COLUMN contact_email TEXT');
  add('contact_phone', 'ALTER TABLE schools ADD COLUMN contact_phone TEXT');
  add('decided_at', 'ALTER TABLE schools ADD COLUMN decided_at TEXT');
  db.prepare("UPDATE schools SET status = CASE WHEN active = 1 THEN 'active' ELSE 'inactive' END WHERE status IS NULL OR status = ''").run();
  db.exec(`CREATE INDEX IF NOT EXISTS idx_schools_status ON schools(status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_schools_email ON schools(contact_email)`);
})();

const HISTORY_MAX_BYTES = Number(process.env.HISTORY_MAX_MB || 100) * 1024 * 1024; // per school, protects the disk

const genLicence = () => 'OTQ-' + crypto.randomBytes(8).toString('hex').toUpperCase().match(/.{4}/g).join('-');
const genPassword = () => crypto.randomBytes(6).toString('base64url');
const normCode = c => String(c || '').trim().toLowerCase();

const STATUSES = new Set(['pending', 'active', 'rejected', 'inactive']);
function schoolStatus(s) {
  if (!s) return null;
  const st = String(s.status || '').trim();
  if (STATUSES.has(st)) return st;
  return s.active ? 'active' : 'inactive';
}

const RESERVED_CODES = new Set(['app', 'api', 'owner', 'signup', 'assets', 'admin', 'login', 'healthz', 'www', 'static', 'otoqol', 'config']);
const AR_LATIN = { 'ا':'a','أ':'a','إ':'i','آ':'a','ب':'b','ت':'t','ث':'th','ج':'j','ح':'h','خ':'kh','د':'d','ذ':'dh','ر':'r','ز':'z','س':'s','ش':'sh','ص':'s','ض':'d','ط':'t','ظ':'z','ع':'a','غ':'gh','ف':'f','ق':'q','ك':'k','ل':'l','م':'m','ن':'n','ه':'h','و':'w','ي':'y','ى':'a','ة':'a','ء':'','ئ':'y','ؤ':'w','ﻻ':'la' };

function slugFromName(name) {
  let s = String(name || '').trim().toLowerCase();
  s = [...s].map(ch => (Object.prototype.hasOwnProperty.call(AR_LATIN, ch) ? AR_LATIN[ch] : ch)).join('');
  s = s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
  if (!s || s.length < 2) s = 'school';
  if (!/^[a-z0-9]/.test(s)) s = 's' + s;
  return s.slice(0, 32);
}

function isValidCode(code) {
  return /^[a-z0-9][a-z0-9_-]{1,39}$/.test(code) && !RESERVED_CODES.has(code);
}

function allocateCode(name, wanted) {
  let base = wanted != null && String(wanted).trim() !== '' ? normCode(wanted) : slugFromName(name);
  if (!isValidCode(base)) {
    if (wanted != null && String(wanted).trim() !== '') throw new Error('invalid_code');
    base = 'school';
  }
  if (!findSchool(base) && isValidCode(base)) return base;
  if (wanted != null && String(wanted).trim() !== '') throw new Error('code_taken');
  for (let i = 2; i < 1000; i++) {
    const cand = (base.slice(0, 36) + '-' + i).slice(0, 40);
    if (isValidCode(cand) && !findSchool(cand)) return cand;
  }
  const cand = (base.slice(0, 24) + '-' + crypto.randomBytes(3).toString('hex')).slice(0, 40);
  if (!isValidCode(cand) || findSchool(cand)) throw new Error('code_taken');
  return cand;
}

function createSchool({ code, name, password, active, status, city, contact_name, contact_email, contact_phone }) {
  code = normCode(code);
  if (!isValidCode(code)) throw new Error('code must be 2-40 chars: a-z 0-9 _ -');
  const generated = !password;
  password = password || genPassword();
  if (String(password).length < 6) throw new Error('password must be at least 6 chars');
  const st = STATUSES.has(status) ? status : (active === 0 || active === false ? 'inactive' : 'active');
  const isActive = st === 'active' ? 1 : 0;
  const licence = genLicence();
  const hash = bcrypt.hashSync(String(password), 11);
  const tx = db.transaction(() => {
    const r = db.prepare('INSERT INTO schools(code,name,licence_key,password_hash,active,status,city,contact_name,contact_email,contact_phone) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(code, name || code, licence, hash, isActive, st, city || null, contact_name || null, contact_email || null, contact_phone || null);
    db.prepare('INSERT INTO school_data(school_id,version,data,updated_at) VALUES (?,0,NULL,NULL)').run(r.lastInsertRowid);
    return r.lastInsertRowid;
  });
  const id = tx();
  // only echo the password when it was generated here (never echo one the caller chose)
  return { id, code, name: name || code, licence_key: licence, status: st, active: !!isActive, ...(generated ? { password } : {}) };
}

const findSchool = ident => {
  const s = String(ident || '').trim();
  return db.prepare('SELECT * FROM schools WHERE code = ? COLLATE NOCASE OR licence_key = ? COLLATE NOCASE').get(s, s);
};
const getSchoolById = id => db.prepare('SELECT * FROM schools WHERE id = ?').get(id);
const listSchools = () => db.prepare(`SELECT s.id,s.code,s.name,s.licence_key,s.active,s.status,s.city,s.contact_name,s.contact_email,s.contact_phone,s.created_at,s.decided_at,d.version,d.updated_at,length(d.data) AS bytes
  FROM schools s JOIN school_data d ON d.school_id=s.id ORDER BY CASE s.status WHEN 'pending' THEN 0 WHEN 'active' THEN 1 WHEN 'inactive' THEN 2 ELSE 3 END, s.id`).all();

const findByEmail = email => {
  const e = String(email || '').trim();
  if (!e) return null;
  return db.prepare(`SELECT * FROM schools WHERE contact_email = ? COLLATE NOCASE AND status IN ('pending','active') ORDER BY id`).get(e);
};

function setPassword(ident, password) {
  const s = findSchool(ident); if (!s) throw new Error('school not found');
  const generated = !password;
  password = password || genPassword();
  if (String(password).length < 6) throw new Error('password must be at least 6 chars');
  // bump token_gen => all existing sessions of this school are revoked
  db.prepare('UPDATE schools SET password_hash=?, token_gen=token_gen+1 WHERE id=?').run(bcrypt.hashSync(String(password), 11), s.id);
  return { code: s.code, ...(generated ? { password } : { password_changed: true }) };
}
function setActive(ident, active) {
  const s = findSchool(ident); if (!s) throw new Error('school not found');
  const st = active ? 'active' : 'inactive';
  db.prepare("UPDATE schools SET active=?, status=?, decided_at=datetime('now'), token_gen=token_gen+1 WHERE id=?").run(active ? 1 : 0, st, s.id);
  return { code: s.code, active: !!active, status: st };
}

function setStatus(ident, status) {
  const s = findSchool(ident); if (!s) throw new Error('school not found');
  if (!STATUSES.has(status)) throw new Error('invalid_status');
  const active = status === 'active' ? 1 : 0;
  db.prepare("UPDATE schools SET status=?, active=?, decided_at=datetime('now'), token_gen=token_gen+1 WHERE id=?").run(status, active, s.id);
  return { code: s.code, status, active: !!active };
}
function checkPassword(school, password) {
  return bcrypt.compareSync(String(password || ''), school.password_hash);
}

const getData = schoolId => db.prepare('SELECT version,data,updated_at FROM school_data WHERE school_id=?').get(schoolId);
const getVersion = schoolId => db.prepare('SELECT version,updated_at,data IS NULL AS empty FROM school_data WHERE school_id=?').get(schoolId);

// server-side sessions (so logout really ends a token)
const addSession = (id, schoolId, expiresAt) => db.prepare('INSERT INTO sessions(id,school_id,expires_at) VALUES (?,?,?)').run(id, schoolId, expiresAt);
const hasSession = id => !!db.prepare('SELECT 1 FROM sessions WHERE id=? AND expires_at>?').get(id, Date.now());
const delSession = id => db.prepare('DELETE FROM sessions WHERE id=?').run(id);
const purgeSessions = () => db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());

function snapshot(schoolId, reason, force) {
  const cur = getData(schoolId);
  if (!cur || cur.data == null) return false;
  if (!force) {
    const last = db.prepare('SELECT created_at FROM history WHERE school_id=? ORDER BY id DESC LIMIT 1').get(schoolId);
    if (last && (Date.now() - Date.parse(last.created_at + 'Z')) < SNAPSHOT_EVERY_MIN * 60000) return false;
  }
  db.prepare('INSERT INTO history(school_id,version,data,reason) VALUES (?,?,?,?)').run(schoolId, cur.version, cur.data, reason);
  db.prepare(`DELETE FROM history WHERE school_id=? AND id NOT IN (SELECT id FROM history WHERE school_id=? ORDER BY id DESC LIMIT ?)`).run(schoolId, schoolId, KEEP_HISTORY);
  // and cap the total size of the snapshots (newest kept first)
  const rows = db.prepare('SELECT id,length(data) AS b FROM history WHERE school_id=? ORDER BY id DESC').all(schoolId);
  let tot = 0; const drop = [];
  rows.forEach((r, i) => { tot += r.b; if (i > 0 && tot > HISTORY_MAX_BYTES) drop.push(r.id); });
  if (drop.length) db.prepare(`DELETE FROM history WHERE id IN (${drop.map(() => '?').join(',')})`).run(...drop);
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

module.exports = { db, DB_FILE, DATA_DIR, createSchool, findSchool, getSchoolById, listSchools, findByEmail, setPassword, setActive, setStatus, schoolStatus,
  checkPassword, getData, getVersion, putData, addSession, hasSession, delSession, purgeSessions, snapshot, listHistory, getHistory, backupFile, normCode,
  allocateCode, slugFromName, isValidCode, RESERVED_CODES, STATUSES };
