/* Otoqol Google Drive backup helpers (browser + Node tests). No secrets. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.OQDrive = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const FOLDER_NAME = 'Otoqol Backups';
  const FOLDER_MIME = 'application/vnd.google-apps.folder';
  const FILES = 'https://www.googleapis.com/drive/v3/files';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
  const ABOUT = 'https://www.googleapis.com/drive/v3/about';
  const GIS_SRC = 'https://accounts.google.com/gsi/client';
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';

  function pad(n) { return String(n).padStart(2, '0'); }

  function backupFileName(d) {
    d = d || new Date();
    return 'otoqol-backup-' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.json';
  }

  function parseBackup(text) {
    let o;
    try { o = JSON.parse(text); } catch (e) { throw new Error('invalid'); }
    if (!o || typeof o !== 'object' || Array.isArray(o) || !Array.isArray(o.candidates)) throw new Error('invalid');
    return o;
  }

  async function driveFetch(token, url, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {}, { Authorization: 'Bearer ' + token });
    const r = await fetch(url, { method: opts.method || 'GET', headers, body: opts.body });
    if (r.status === 401) {
      const err = new Error('unauthorized');
      err.code = 'unauthorized';
      throw err;
    }
    if (!r.ok) {
      let detail = '';
      try { detail = (await r.text()).slice(0, 180); } catch (e) {}
      const err = new Error('Drive HTTP ' + r.status + (detail ? ': ' + detail : ''));
      err.status = r.status;
      throw err;
    }
    if (opts.raw) return r;
    const ct = r.headers && r.headers.get && r.headers.get('content-type') || '';
    if (opts.text || ct.indexOf('application/json') === -1) return r.text();
    return r.json();
  }

  async function getUser(token) {
    const j = await driveFetch(token, ABOUT + '?fields=user(displayName,emailAddress)');
    const u = (j && j.user) || {};
    return { email: u.emailAddress || '', name: u.displayName || '' };
  }

  async function ensureFolder(token) {
    const q = "name='" + FOLDER_NAME + "' and mimeType='" + FOLDER_MIME + "' and trashed=false";
    const found = await driveFetch(token, FILES + '?q=' + encodeURIComponent(q) + '&fields=files(id,name)&pageSize=1&spaces=drive');
    const hit = found && found.files && found.files[0];
    if (hit && hit.id) return hit;
    return driveFetch(token, FILES + '?fields=id,name', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME }),
    });
  }

  async function uploadBackup(token, data, when) {
    const folder = await ensureFolder(token);
    const name = backupFileName(when);
    const meta = { name: name, mimeType: 'application/json', parents: [folder.id] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    form.append('file', new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), name);
    const created = await driveFetch(token, UPLOAD + '?uploadType=multipart&fields=id,name,modifiedTime', {
      method: 'POST',
      body: form,
    });
    return { file: created, folder: folder, name: name };
  }

  async function listBackups(token) {
    const folder = await ensureFolder(token);
    const q = "'" + folder.id + "' in parents and trashed=false";
    const j = await driveFetch(token, FILES + '?q=' + encodeURIComponent(q) + '&fields=files(id,name,modifiedTime,size)&orderBy=modifiedTime desc&pageSize=50&spaces=drive');
    return { folder: folder, files: (j && j.files) || [] };
  }

  async function downloadBackup(token, fileId) {
    const text = await driveFetch(token, FILES + '/' + encodeURIComponent(fileId) + '?alt=media', { text: true });
    return parseBackup(text);
  }

  function loadGis(doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null);
    return new Promise(function (resolve, reject) {
      if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2) return resolve();
      if (!doc) return reject(new Error('gis_unavailable'));
      if (loadGis._p) return loadGis._p.then(resolve, reject);
      loadGis._p = new Promise(function (res, rej) {
        const s = doc.createElement('script');
        s.src = GIS_SRC;
        s.async = true;
        s.onload = function () { res(); };
        s.onerror = function () { loadGis._p = null; rej(new Error('gis_load_failed')); };
        doc.head.appendChild(s);
      });
      loadGis._p.then(resolve, reject);
    });
  }

  function requestToken(clientId, opts) {
    opts = opts || {};
    return new Promise(function (resolve, reject) {
      if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
        return reject(new Error('gis_unavailable'));
      }
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        callback: function (resp) {
          if (resp && resp.access_token) resolve(resp);
          else reject(Object.assign(new Error((resp && (resp.error_description || resp.error)) || 'denied'), { code: (resp && resp.error) || 'denied' }));
        },
        error_callback: function (err) {
          reject(Object.assign(new Error((err && (err.message || err.type)) || 'denied'), { code: (err && err.type) || 'denied' }));
        },
      });
      client.requestAccessToken({ prompt: opts.prompt == null ? '' : opts.prompt });
    });
  }

  function revoke(token) {
    return new Promise(function (resolve) {
      try {
        if (typeof google !== 'undefined' && google.accounts && google.accounts.oauth2 && token) {
          google.accounts.oauth2.revoke(token, function () { resolve(); });
          return;
        }
      } catch (e) {}
      resolve();
    });
  }

  return {
    FOLDER_NAME: FOLDER_NAME,
    SCOPE: SCOPE,
    GIS_SRC: GIS_SRC,
    backupFileName: backupFileName,
    parseBackup: parseBackup,
    getUser: getUser,
    ensureFolder: ensureFolder,
    uploadBackup: uploadBackup,
    listBackups: listBackups,
    downloadBackup: downloadBackup,
    loadGis: loadGis,
    requestToken: requestToken,
    revoke: revoke,
  };
});
