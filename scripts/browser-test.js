// Headless browser test. Needs: npm i playwright-core (or playwright) and Chrome/Chromium.
// node scripts/browser-test.js [baseUrl]
// Expects: the install's school "demo" (password Demo2026!) with NO data yet.
// The legacy-import check starts its own throw-away server (port+1, temp DATA_DIR, school "imp").
let pw; try { pw = require('playwright-core'); } catch (e) { pw = require('/tmp/pw/node_modules/playwright-core'); }
const B = process.argv[2] || 'http://localhost:3000';
const SHOTS = __dirname + '/../test-shots/';
let fails = 0; const t = (n, ok, x) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!ok) fails++; };
const api = async (u, cookie) => (await fetch(B + u, { headers: { Cookie: cookie } })).json();
async function cookieOf(ctx) { const c = (await ctx.cookies()).find(x => x.name === 'otq_sess'); return c ? 'otq_sess=' + c.value : ''; }
/** The single sign-in screen: username + password only (one install = one school). */
async function signIn(page, base, user, pass, opts = {}) {
  if (!opts.noGoto) await page.goto(base + '/');
  await page.waitForSelector('[data-oq-signin]', { timeout: 30000 });
  await page.fill('[data-oq-signin] input[name=username]', user); await page.fill('[data-oq-signin] input[name=password]', pass);
  if (opts.shot) await page.screenshot({ path: SHOTS + opts.shot });
  await page.click('[data-oq-signin] button.b.pri');
}
async function setSchoolName(page, name) {
  await page.click('.nav button:has-text("الإعدادات")');
  const f = page.locator('label.f:has-text("اسم المدرسة") input'); await f.fill(name);
  await page.locator('.card:has-text("اسم المدرسة") button.b.pri').click();
}
const waitSaved = page => page.waitForSelector('[data-oq-sync=ok]', { timeout: 15000 });
(async () => {
  const browser = await pw.chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errs = [];
  const A = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const pa = await A.newPage();
  pa.on('pageerror', e => errs.push(e.message)); pa.on('console', m => { if (m.type() === 'error' && !/40[13]/.test(m.text())) errs.push(m.text()); });

  // fresh school: admin + school password = first-time setup, straight into the app (one screen only)
  await signIn(pa, B, 'admin', 'Demo2026!', { shot: '1-signin.png' });
  await pa.waitForSelector('.nav', { timeout: 20000 });
  t('one sign-in -> app (no second login screen)', (await pa.locator('.login').count()) === 0);
  t('logout button visible in the header', await pa.locator('.top [data-oq-logout]').isVisible());
  await waitSaved(pa); await pa.screenshot({ path: SHOTS + '2-app-dashboard.png' });
  const ca = await cookieOf(A); let s = await api('/api/db', ca);
  t('setup: default DB pushed, admin password = school password', s.version >= 1 && s.data.users.find(u => u.id === 'u1').password === 'Demo2026!', 'v' + s.version);
  t('logged in as manager (all manager pages)', (await pa.locator('.nav button:has-text("المونيتورات")').count()) === 1);
  await setSchoolName(pa, 'مدرسة النجاح'); await pa.waitForTimeout(300); await waitSaved(pa);
  s = await api('/api/db', ca); t('UI edit saved to server', s.data.settings.school === 'مدرسة النجاح', 'v' + s.version);

  // second device: concurrent edits merge instead of overwriting
  const Bc = await browser.newContext(); const pb = await Bc.newPage();
  await signIn(pb, B, 'admin', 'Demo2026!'); await pb.waitForSelector('.nav', { timeout: 20000 }); await waitSaved(pb);
  await pa.click('.nav button:has-text("الإعدادات")');
  await pa.locator('label.f:has-text("عدد الغيابات") input').fill('7'); await pa.locator('.card:has-text("اسم المدرسة") button.b.pri').click();
  await pa.waitForTimeout(300); await waitSaved(pa);
  await setSchoolName(pb, 'مدرسة النجاح 2'); await pb.waitForTimeout(300); await waitSaved(pb);
  s = await api('/api/db', ca);
  t('two devices: conflict (409) auto-merged, both edits kept', s.data.settings.school === 'مدرسة النجاح 2' && Number(s.data.settings.absLimit) === 7, JSON.stringify(s.data.settings));
  await pa.evaluate(() => OQ.pull()); await pa.waitForTimeout(500);
  const shown = await pa.locator('label.f:has-text("اسم المدرسة") input').inputValue();
  t('device A pulls remote change', shown === 'مدرسة النجاح 2' || (await pa.evaluate(() => JSON.parse(localStorage.autoecole_db_v1).settings.school)) === 'مدرسة النجاح 2');

  // reload keeps session and app user
  await pa.reload(); await pa.waitForSelector('.nav', { timeout: 20000 });
  t('reload: session + app user remembered', (await pa.locator('[data-oq-signin]').count()) === 0);

  // header logout button, from a non-home screen -> back to the single screen
  await pa.click('.nav button:has-text("المالية")'); await waitSaved(pa);
  await pa.click('.top [data-oq-logout]'); await pa.waitForSelector('[data-oq-signin]', { timeout: 15000 });
  t('header logout (from Finance) -> sign-in screen', true);
  t('sign-in screen: no school field', (await pa.locator('[data-oq-signin] input').count()) === 2);
  t('logout cleared the session cookie', !(await cookieOf(A)));
  await signIn(pa, B, 'admin', 'wrong', { noGoto: true });
  await pa.waitForSelector('[data-oq-signin] .al.bad', { timeout: 10000 }); await pa.screenshot({ path: SHOTS + '3-signin-error.png' });
  t('wrong password -> error on the same screen', /غالطين/.test(await pa.locator('[data-oq-signin] .al.bad').innerText()));
  // role permissions still apply: secretary has no "monitors" page
  await signIn(pa, B, 'secretary', '1234', { noGoto: true }); await pa.waitForSelector('.nav', { timeout: 20000 });
  t('secretary signed in with role permissions (no monitors page)', (await pa.locator('.nav button:has-text("المونيتورات")').count()) === 0 && (await pa.locator('.nav button:has-text("المترشحون")').count()) === 1);

  // one-time import of old browser data (own throw-away server with a fresh school "imp")
  const port2 = Number(new URL(B).port || 80) + 1, B2 = 'http://localhost:' + port2;
  const fs = require('fs'), os = require('os'), path = require('path');
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-imp-'));
  const srv = require('child_process').spawn(process.execPath, [path.join(__dirname, '..', 'src', 'server.js')], { stdio: 'ignore',
    env: { ...process.env, PORT: String(port2), DATA_DIR: dir2, DB_FILE: '', SEED_SCHOOL_CODE: 'imp', SEED_SCHOOL_PASSWORD: 'Import2026!', DEFAULT_SCHOOL_CODE: '' } });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(B2 + '/healthz')).ok) break; } catch (e) {} await new Promise(r => setTimeout(r, 200)); }
  try {
    const C = await browser.newContext(); const pc = await C.newPage();
    await pc.goto(B2 + '/'); await pc.evaluate(() => localStorage.setItem('autoecole_db_v1', JSON.stringify({ settings: { school: 'Old', absLimit: 3 },
      users: [{ id: 'u1', name: 'المدير', role: 'manager', username: 'admin', password: '1234' }], monitors: [], vehicles: [],
      candidates: [{ id: 'old1', name: 'مترشح قديم' }, { id: 'old2', name: 'مترشح 2' }], sessions: [], payments: [], expenses: [], notifs: [], requests: [], notes: [], log: [] })));
    await signIn(pc, B2, 'admin', 'Import2026!');
    await pc.waitForSelector('text=رفع الداتا للسيرفر', { timeout: 15000 }); await pc.screenshot({ path: SHOTS + '4-import-offer.png' });
    await pc.click('text=رفع الداتا للسيرفر'); await pc.waitForSelector('.nav', { timeout: 20000 });
    const s2 = await (await fetch(B2 + '/api/db', { headers: { Cookie: await cookieOf(C) } })).json();
    t('old localStorage data imported to empty school, straight into the app', s2.data && s2.data.candidates.length === 2, 'v' + s2.version);
    await C.close();
  } finally { srv.kill(); }

  // logout from the save badge
  await pb.click('[data-oq-sync]'); pb.once('dialog', d => d.accept());
  await pb.click('[data-oq-sync] >> xpath=.. >> button.b.del'); await pb.waitForSelector('[data-oq-signin]', { timeout: 15000 });
  t('badge logout returns to the single sign-in', true);
  t('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
