// Headless browser test. Needs: npm i playwright-core (or playwright) and Chrome/Chromium.
// node scripts/browser-test.js [baseUrl]      (env ADMIN_TOKEN: creates the "imp" school if missing)
// Expects: school "demo" (password Demo2026!) with NO data yet, and school "imp" (password Import2026!) with no data.
let pw; try { pw = require('playwright-core'); } catch (e) { pw = require('/tmp/pw/node_modules/playwright-core'); }
const B = process.argv[2] || 'http://localhost:3000';
const SHOTS = __dirname + '/../test-shots/';
let fails = 0; const t = (n, ok, x) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!ok) fails++; };
const api = async (u, cookie) => (await fetch(B + u, { headers: { Cookie: cookie } })).json();
async function cookieOf(ctx) { const c = (await ctx.cookies()).find(x => x.name === 'otq_sess'); return c ? 'otq_sess=' + c.value : ''; }
/** The single sign-in screen: school code (only if not remembered) + username + password. */
async function signIn(page, code, user, pass, opts = {}) {
  if (!opts.noGoto) await page.goto(B + '/');
  await page.waitForSelector('[data-oq-signin]', { timeout: 30000 });
  if (await page.locator('[data-oq-signin] input[name=school]').count()) await page.fill('[data-oq-signin] input[name=school]', code);
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
  if (process.env.ADMIN_TOKEN) await fetch(B + '/api/admin/schools', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.ADMIN_TOKEN }, body: JSON.stringify({ code: 'imp', password: 'Import2026!' }) });
  const browser = await pw.chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const errs = [];
  const A = await browser.newContext({ viewport: { width: 1280, height: 800 } }); const pa = await A.newPage();
  pa.on('pageerror', e => errs.push(e.message)); pa.on('console', m => { if (m.type() === 'error' && !/40[13]/.test(m.text())) errs.push(m.text()); });

  // fresh school: admin + school password = first-time setup, straight into the app (one screen only)
  await signIn(pa, 'demo', 'admin', 'Demo2026!', { shot: '1-signin.png' });
  await pa.waitForSelector('.nav', { timeout: 20000 });
  t('one sign-in -> app (no second login screen)', (await pa.locator('.login').count()) === 0);
  await waitSaved(pa); await pa.screenshot({ path: SHOTS + '2-app-dashboard.png' });
  const ca = await cookieOf(A); let s = await api('/api/db', ca);
  t('setup: default DB pushed, admin password = school password', s.version >= 1 && s.data.users.find(u => u.id === 'u1').password === 'Demo2026!', 'v' + s.version);
  t('logged in as manager (all manager pages)', (await pa.locator('.nav button:has-text("المونيتورات")').count()) === 1);
  await setSchoolName(pa, 'مدرسة النجاح'); await pa.waitForTimeout(300); await waitSaved(pa);
  s = await api('/api/db', ca); t('UI edit saved to server', s.data.settings.school === 'مدرسة النجاح', 'v' + s.version);

  // second device: concurrent edits merge instead of overwriting
  const Bc = await browser.newContext(); const pb = await Bc.newPage();
  await signIn(pb, 'demo', 'admin', 'Demo2026!'); await pb.waitForSelector('.nav', { timeout: 20000 }); await waitSaved(pb);
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

  // app logout (Settings) -> back to the single screen, school remembered (only username + password)
  await pa.click('.nav button:has-text("الإعدادات")'); await pa.click('.wrap button.b.del:has-text("خروج")');
  await pa.waitForSelector('[data-oq-signin]', { timeout: 15000 });
  t('app logout -> single sign-in screen', true);
  t('school remembered: no school field, change-school link shown', (await pa.locator('[data-oq-signin] input[name=school]').count()) === 0 && (await pa.locator('[data-oq-change-school]').count()) === 1);
  t('logout cleared the session cookie', !(await cookieOf(A)));
  await signIn(pa, 'demo', 'admin', 'wrong', { noGoto: true });
  await pa.waitForSelector('[data-oq-signin] .al.bad', { timeout: 10000 }); await pa.screenshot({ path: SHOTS + '3-signin-remembered-error.png' });
  t('wrong password -> error on the same screen', /غالطين/.test(await pa.locator('[data-oq-signin] .al.bad').innerText()));
  // role permissions still apply: secretary has no "monitors" page
  await signIn(pa, 'demo', 'secretary', '1234', { noGoto: true }); await pa.waitForSelector('.nav', { timeout: 20000 });
  t('secretary signed in with role permissions (no monitors page)', (await pa.locator('.nav button:has-text("المونيتورات")').count()) === 0 && (await pa.locator('.nav button:has-text("المترشحون")').count()) === 1);

  // one-time import of old browser data (fresh school "imp")
  const C = await browser.newContext(); const pc = await C.newPage();
  await pc.goto(B + '/'); await pc.evaluate(() => localStorage.setItem('autoecole_db_v1', JSON.stringify({ settings: { school: 'Old', absLimit: 3 },
    users: [{ id: 'u1', name: 'المدير', role: 'manager', username: 'admin', password: '1234' }], monitors: [], vehicles: [],
    candidates: [{ id: 'old1', name: 'مترشح قديم' }, { id: 'old2', name: 'مترشح 2' }], sessions: [], payments: [], expenses: [], notifs: [], requests: [], notes: [], log: [] })));
  await signIn(pc, 'imp', 'admin', 'Import2026!');
  await pc.waitForSelector('text=رفع الداتا للسيرفر', { timeout: 15000 }); await pc.screenshot({ path: SHOTS + '4-import-offer.png' });
  await pc.click('text=رفع الداتا للسيرفر'); await pc.waitForSelector('.nav', { timeout: 20000 });
  s = await api('/api/db', await cookieOf(C));
  t('old localStorage data imported to empty school, straight into the app', s.data && s.data.candidates.length === 2, 'v' + s.version);
  t('school isolation', s.data.settings.school !== 'مدرسة النجاح 2');
  // change-school link
  await pc.evaluate(() => OQ.logoutSchool(true)); await pc.waitForSelector('[data-oq-signin]', { timeout: 15000 });
  await pc.click('[data-oq-change-school]'); t('change school -> school field back', (await pc.locator('[data-oq-signin] input[name=school]').count()) === 1);

  // logout from the save badge
  await pb.click('[data-oq-sync]'); pb.once('dialog', d => d.accept());
  await pb.click('[data-oq-sync] >> xpath=.. >> button.b.del'); await pb.waitForSelector('[data-oq-signin]', { timeout: 15000 });
  t('badge logout returns to the single sign-in', true);
  t('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
