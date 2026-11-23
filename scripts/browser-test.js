// Headless browser test. Needs: npm i playwright-core (or playwright) and Chrome/Chromium.
// node scripts/browser-test.js [baseUrl]
let pw; try { pw = require('playwright-core'); } catch (e) { pw = require('/tmp/pw/node_modules/playwright-core'); }
const B = process.argv[2] || 'http://localhost:3000';
const SHOTS = __dirname + '/../test-shots/';
let fails = 0; const t = (n, ok, x) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!ok) fails++; };
const api = async (u, cookie) => (await fetch(B + u, { headers: { Cookie: cookie } })).json();
async function cookieOf(ctx) { const c = (await ctx.cookies()).find(x => x.name === 'otq_sess'); return c ? 'otq_sess=' + c.value : ''; }
async function schoolLogin(page, code, pass) {
  await page.goto(B + '/'); await page.waitForSelector('text=دخول حساب المدرسة', { timeout: 30000 });
  const inp = page.locator('.login input'); await inp.nth(0).fill(code); await inp.nth(1).fill(pass);
  await page.click('.login button.b.pri');
}
async function appLogin(page) {
  await page.waitForSelector('text=اسم المستخدم', { timeout: 15000 });
  const inp = page.locator('.login input:not([type=checkbox])'); await inp.nth(0).fill('admin'); await inp.nth(1).fill('1234');
  await page.click('.login button.b.pri'); await page.waitForSelector('.nav', { timeout: 15000 });
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
  pa.on('pageerror', e => errs.push(e.message)); pa.on('console', m => { if (m.type() === 'error' && !/401/.test(m.text())) errs.push(m.text()); });
  await schoolLogin(pa, 'demo', 'Demo2026!'); await pa.screenshot({ path: SHOTS + '1-school-login.png' });
  await appLogin(pa); await waitSaved(pa); await pa.screenshot({ path: SHOTS + '2-app-dashboard.png' });
  const ca = await cookieOf(A); let s = await api('/api/db', ca);
  t('school login + app renders, default DB pushed to server', s.version >= 1 && Array.isArray(s.data.users), 'v' + s.version);
  await setSchoolName(pa, 'مدرسة النجاح'); await pa.waitForTimeout(300); await waitSaved(pa);
  s = await api('/api/db', ca); t('UI edit saved to server', s.data.settings.school === 'مدرسة النجاح', 'v' + s.version);

  // second device: concurrent edits merge instead of overwriting
  const Bc = await browser.newContext(); const pb = await Bc.newPage();
  await schoolLogin(pb, 'demo', 'Demo2026!'); await appLogin(pb); await waitSaved(pb);
  await pb.evaluate(() => { window.__noop = 1; });
  // device A changes abs limit, device B changes the name (B still at old version)
  await pa.click('.nav button:has-text("الإعدادات")');
  await pa.locator('label.f:has-text("عدد الغيابات") input').fill('7'); await pa.locator('.card:has-text("اسم المدرسة") button.b.pri').click();
  await pa.waitForTimeout(300); await waitSaved(pa);
  await setSchoolName(pb, 'مدرسة النجاح 2'); await pb.waitForTimeout(300); await waitSaved(pb);
  s = await api('/api/db', ca);
  t('two devices: conflict (409) auto-merged, both edits kept', s.data.settings.school === 'مدرسة النجاح 2' && Number(s.data.settings.absLimit) === 7, JSON.stringify(s.data.settings));
  await pa.evaluate(() => OQ.pull()); await pa.waitForTimeout(500);
  const shown = await pa.locator('label.f:has-text("اسم المدرسة") input').inputValue();
  t('device A pulls remote change', shown === 'مدرسة النجاح 2' || (await pa.evaluate(() => JSON.parse(localStorage.autoecole_db_v1).settings.school)) === 'مدرسة النجاح 2');

  // reload keeps session and data
  await pa.reload(); await pa.waitForSelector('.nav', { timeout: 20000 });
  t('reload: session + app user remembered', true);

  // one-time import of old browser data
  const C = await browser.newContext(); const pc = await C.newPage();
  await pc.goto(B + '/'); await pc.evaluate(() => localStorage.setItem('autoecole_db_v1', JSON.stringify({ settings: { school: 'Old', absLimit: 3 },
    users: [{ id: 'u1', name: 'المدير', role: 'manager', username: 'admin', password: '1234' }], monitors: [], vehicles: [],
    candidates: [{ id: 'old1', name: 'مترشح قديم' }, { id: 'old2', name: 'مترشح 2' }], sessions: [], payments: [], expenses: [], notifs: [], requests: [], notes: [], log: [] })));
  await schoolLogin(pc, 'imp', 'Import2026!');
  await pc.waitForSelector('text=رفع الداتا للسيرفر', { timeout: 15000 }); await pc.screenshot({ path: SHOTS + '3-import-offer.png' });
  await pc.click('text=رفع الداتا للسيرفر'); await appLogin(pc);
  s = await api('/api/db', await cookieOf(C));
  t('old localStorage data imported to empty school', s.data && s.data.candidates.length === 2, 'v' + s.version);

  // school isolation: context C cookie can't see demo data
  t('school isolation', s.data.settings.school !== 'مدرسة النجاح 2');

  // school logout from badge
  await pa.click('[data-oq-sync]'); pa.once('dialog', d => d.accept());
  await pa.click('text=خروج من حساب المدرسة'); await pa.waitForSelector('text=دخول حساب المدرسة', { timeout: 15000 });
  t('school logout returns to school login', true);
  t('no page errors', errs.length === 0, errs.join(' | '));
  await browser.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
