#!/usr/bin/env node
'use strict';
// Otoqol admin CLI — works directly on the SQLite file (run it on the server).
const fs = require('fs');
const path = require('path');
const store = require('../src/db');
const [cmd, ...a] = process.argv.slice(2);
const out = o => console.log(JSON.stringify(o, null, 2));
const need = id => { const s = store.findSchool(id); if (!s) { console.error('school not found: ' + id); process.exit(1); } return s; };
const help = `Otoqol admin
  create <code> "<name>" [password]     create a school (prints licence + password)
  list                                  list schools
  passwd <code|licence> [newPassword]   reset password (logs out all devices)
  deactivate <code> | activate <code>
  export <code> [file.json]             export school data (default stdout)
  import <code> <file.json>             replace school data (old version kept in history)
  history <code>                        list snapshots
  restore <code> <snapshotId>           restore a snapshot
  backup [dir]                          hot backup of the whole SQLite file`;
(async () => {
  try {
    switch (cmd) {
      case 'create': { if (!a[0]) throw new Error('usage: create <code> "<name>" [password]'); out(store.createSchool({ code: a[0], name: a[1], password: a[2] })); break; }
      case 'list': console.table(store.listSchools()); break;
      case 'passwd': out(store.setPassword(a[0], a[1])); break;
      case 'deactivate': out(store.setActive(a[0], false)); break;
      case 'activate': out(store.setActive(a[0], true)); break;
      case 'export': { const s = need(a[0]); const d = store.getData(s.id);
        const j = JSON.stringify(d.data ? JSON.parse(d.data) : null, null, 2);
        if (a[1]) { fs.writeFileSync(a[1], j); console.error('written ' + a[1] + ' (version ' + d.version + ')'); } else console.log(j); break; }
      case 'import': { const s = need(a[0]); let o = JSON.parse(fs.readFileSync(a[1], 'utf8'));
        if (o && o.data && !o.candidates) o = o.data;
        if (!o || !Array.isArray(o.candidates) || !Array.isArray(o.users)) throw new Error('file is not an Otoqol DB (needs users[] and candidates[])');
        out(store.putData(s.id, null, JSON.stringify(o), 'before-cli-import')); break; }
      case 'history': console.table(store.listHistory(need(a[0]).id)); break;
      case 'restore': { const s = need(a[0]); const h = store.getHistory(s.id, Number(a[1])); if (!h) throw new Error('snapshot not found');
        out(store.putData(s.id, null, h.data, 'before-restore')); break; }
      case 'backup': { const dir = a[0] || path.join(store.DATA_DIR, 'backups'); fs.mkdirSync(dir, { recursive: true });
        const f = path.join(dir, 'otoqol-' + new Date().toISOString().replace(/[:.]/g, '-') + '.sqlite');
        await store.backupFile(f); console.log(f);
        // keep last 30 backups
        const files = fs.readdirSync(dir).filter(x => /^otoqol-.*\.sqlite$/.test(x)).sort();
        files.slice(0, Math.max(0, files.length - Number(process.env.KEEP_BACKUPS || 30))).forEach(x => fs.unlinkSync(path.join(dir, x)));
        break; }
      default: console.log(help);
    }
  } catch (e) { console.error('Error: ' + e.message); process.exit(1); }
})();
