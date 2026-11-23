// Crawls every screen in AR/FR/EN with seeded Latin-named data and reports any Arabic text left in FR/EN.
// node scripts/i18n-test.js [baseUrl] [school] [password]
let pw; try { pw = require('playwright-core'); } catch (e) { pw = require('/tmp/pw/node_modules/playwright-core'); }
const B = process.argv[2] || 'http://localhost:3000', SC = process.argv[3] || 'demo', SP = process.argv[4] || 'Demo2026!';
const SHOTS = __dirname + '/../test-shots/';
const AR = /[\u0600-\u06FF]/;
let fails = 0; const t = (n, ok, x) => { console.log((ok ? 'PASS ' : 'FAIL ') + n + (x ? '  ' + x : '')); if (!ok) fails++; };
const d = n => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const seed = () => ({
  settings: { school: 'Auto Ecole Demo', absLimit: 2 },
  users: [{ id: 'u1', name: 'المدير', role: 'manager', username: 'admin', password: '1234' }, { id: 'u2', name: 'السكريتيرة', role: 'secretary', username: 'secretary', password: '1234' }],
  monitors: [{ id: 'm1', name: 'Karim Monitor', phone: '0612345678', licenseNo: 'M-1', username: 'karim', password: '1234' }],
  vehicles: [{ id: 'v1', plate: '12345-A-6', model: 'Dacia Logan', insurance: d(10), visit: d(-3), tax: d(200) }],
  candidates: [
    { id: 'c1', name: 'Youssef Alami', cin: 'AB12345', phone: '0600000001', address: 'Casablanca', license: 'B', price: 3500, codeHours: 10, driveHours: 20, stage: 'drive', medical: true, notes: '', createdAt: d(-30),
      exams: [{ id: 'e1', type: 'code', date: d(-10), result: 'نجح' }, { id: 'e2', type: 'conduite', date: d(5), result: 'في الانتظار' }] },
    { id: 'c2', name: 'Salma Bennani', cin: 'CD67890', phone: '0600000002', address: 'Rabat', license: 'B', price: 3000, codeHours: 10, driveHours: 20, stage: 'code', medical: false, notes: '', createdAt: d(-5), exams: [{ id: 'e3', type: 'code', date: d(-2), result: 'رسب' }] }],
  sessions: [
    { id: 's1', date: d(0), time: '09:00', duration: 1, type: 'conduite', monitorId: 'm1', vehicleId: 'v1', notes: '', att: [{ cid: 'c1', status: 'present', reason: '' }] },
    { id: 's2', date: d(0), time: '11:00', duration: 2, type: 'code', monitorId: 'm1', vehicleId: '', notes: '', att: [{ cid: 'c2', status: 'absent', reason: 'sick' }, { cid: 'c1', status: 'planned', reason: '' }] },
    { id: 's3', date: d(2), time: '10:00', duration: 1, type: 'conduite', monitorId: 'm1', vehicleId: 'v1', notes: '', att: [{ cid: 'c2', status: 'planned', reason: '' }] },
    { id: 's4', date: d(-3), time: '10:00', duration: 1, type: 'conduite', monitorId: 'm1', vehicleId: 'v1', notes: '', att: [{ cid: 'c2', status: 'absent', reason: '' }] }],
  payments: [{ id: 'p1', no: 1, cid: 'c1', amount: 1500, date: d(-20), note: 'cash' }, { id: 'p2', no: 2, cid: 'c2', amount: 1000, date: d(-1), note: '' }],
  expenses: [{ id: 'x1', label: 'Fuel Logan', category: 'بنزين', amount: 400, date: d(-1), vehicleId: 'v1' }, { id: 'x2', label: 'Rent', category: 'كراء', amount: 2000, date: d(-2), vehicleId: '' }],
  notifs: [{ id: 'n1', to: 'secretary', text: 'note one', cid: 'c2', date: new Date().toISOString(), read: false }, { id: 'n2', to: 'manager', text: 'note two', cid: 'c2', date: new Date().toISOString(), read: false }],
  requests: [{ id: 'r1', sessionId: 's3', monitorId: 'm1', text: 'change to 14:00', status: 'pending', date: d(0) }],
  notes: [{ id: 'nt1', cid: 'c1', monitorId: 'm1', text: 'good driver', date: d(-1) }],
  log: [{ id: 'l1', date: new Date().toISOString(), user: 'admin', text: 'seed' }],
});
async function api(m, u, body, cookie) { const r = await fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json', 'X-Otoqol': '1', Cookie: cookie || '' }, body: body && JSON.stringify(body) }); return { r, j: await r.json().catch(() => null) }; }
// visible text with Arabic, ignoring the language-name option and data we know is Arabic by design (none in seed)
const arabicLeft = page => page.evaluate(() => {
  const AR = /[\u0600-\u06FF]/; const out = new Set();
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (w.nextNode()) { const n = w.currentNode; const el = n.parentElement; if (!el || el.closest('option') || el.closest('select')) continue;
    const st = getComputedStyle(el); if (st.display === 'none' || st.visibility === 'hidden') continue;
    if (AR.test(n.nodeValue)) out.add(n.nodeValue.trim().slice(0, 80)); }
  document.querySelectorAll('input[placeholder],textarea[placeholder]').forEach(i => { if (AR.test(i.placeholder)) out.add('[placeholder] ' + i.placeholder); });
  document.querySelectorAll('[title]').forEach(i => { if (AR.test(i.title)) out.add('[title] ' + i.title); });
  document.querySelectorAll('select:not(.lg) option').forEach(o => { if (AR.test(o.textContent)) out.add('[option] ' + o.textContent); });
  return [...out];
});
(async () => {
  // seed data
  const lg = await api('POST', '/api/login', { school: SC, password: SP }); const cookie = (lg.r.headers.get('set-cookie') || '').split(';')[0];
  const cur = await api('GET', '/api/db', null, cookie);
  const put = await api('PUT', '/api/db', { version: cur.j.version, data: seed() }, cookie); t('seed data', put.r.ok, JSON.stringify(put.j));
  const browser = await pw.chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  for (const lang of ['ar', 'fr', 'en']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } }); const page = await ctx.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    page.on('dialog', dlg => dlg.dismiss());
    await page.addInitScript(l => { try { localStorage.setItem('ae_lang', l); } catch (e) {} }, lang);
    const leftovers = {}; let scanned = 0; const add = (where, arr) => { scanned++; arr = arr.filter(x => x !== 'مدرسة الديمو'); /* school name = data */ if (lang !== 'ar' && arr.length) leftovers[where] = arr; };
    await page.goto(B + '/'); await page.waitForSelector('[data-oq-signin]', { timeout: 30000 });
    t(`[${lang}] dir=${lang === 'ar' ? 'rtl' : 'ltr'}`, (await page.evaluate(() => document.documentElement.dir)) === (lang === 'ar' ? 'rtl' : 'ltr'));
    add('sign-in', await arabicLeft(page)); await page.screenshot({ path: SHOTS + `i18n-${lang}-0-signin.png` });
    const signIn = async (u, p) => { await page.waitForSelector('[data-oq-signin]', { timeout: 30000 });
      if (await page.locator('[data-oq-signin] input[name=school]').count()) await page.fill('[data-oq-signin] input[name=school]', SC);
      await page.fill('[data-oq-signin] input[name=username]', u); await page.fill('[data-oq-signin] input[name=password]', p); await page.click('[data-oq-signin] button.b.pri'); };
    // wrong password: error message on the single screen must be translated too
    await signIn('admin', 'wrong'); await page.waitForSelector('[data-oq-signin] .al.bad'); add('sign-in error', await arabicLeft(page));
    await signIn('admin', '1234');
    await page.waitForSelector('.nav'); await page.waitForTimeout(300);
    t(`[${lang}] one sign-in goes straight to the app`, (await page.locator('.login').count()) === 0);
    const navCount = await page.locator('.nav button').count();
    for (let i = 0; i < navCount; i++) {
      const b = page.locator('.nav button').nth(i); const name = (await b.innerText()).trim();
      await b.click(); await page.waitForTimeout(150);
      add('page ' + name, await arabicLeft(page));
      const tabs = page.locator('.wrap .tabs button'); const tc = await tabs.count();
      for (let k = 0; k < tc; k++) { await tabs.nth(k).click(); await page.waitForTimeout(100); add('page ' + name + ' / tab ' + (await tabs.nth(k).innerText()).trim(), await arabicLeft(page));
        if (i === 5 && k === 0) await page.screenshot({ path: SHOTS + `i18n-${lang}-4-finance.png`, fullPage: true }); }
      // open any "add / new" modal on this page (primary buttons in the toolbar), scan it, close it
      const adds = page.locator('.wrap .bar button.b.pri, .wrap > div > .row > button.b.pri');
      if (await adds.count()) { await adds.first().click(); await page.waitForTimeout(150);
        if (await page.locator('.md').count()) { add('page ' + name + ' / new-form', await arabicLeft(page)); await page.locator('.md .mh button.x').click(); } }
      if (i === 0) await page.screenshot({ path: SHOTS + `i18n-${lang}-2-dashboard.png`, fullPage: true });
      if (i === 1) { await page.screenshot({ path: SHOTS + `i18n-${lang}-3-candidates.png`, fullPage: true });
        // candidate modal + tabs + receipt
        await page.locator('tr.cl').first().click(); await page.waitForTimeout(200); add('candidate modal', await arabicLeft(page));
        const mt = page.locator('.md .tabs button'); const mc = await mt.count();
        for (let k = 0; k < mc; k++) { await mt.nth(k).click(); await page.waitForTimeout(100); add('candidate modal / tab ' + (await mt.nth(k).innerText()).trim(), await arabicLeft(page)); }
        for (let k = 0; k < mc; k++) { await mt.nth(k).click(); await page.waitForTimeout(100);
          if (await page.locator('button:has-text("🖨")').count()) { await page.screenshot({ path: SHOTS + `i18n-${lang}-5-payments.png` });
            const [pop] = await Promise.all([page.waitForEvent('popup'), page.locator('button:has-text("🖨")').first().click()]);
            await pop.waitForLoadState(); await pop.evaluate(() => { window.print = () => {}; });
            const rt = await pop.evaluate(() => ({ t: document.body.innerText, dir: document.documentElement.dir }));
            await pop.screenshot({ path: SHOTS + `i18n-${lang}-6-receipt.png` });
            if (lang !== 'ar' && AR.test(rt.t)) leftovers['receipt'] = rt.t.split('\n').filter(x => AR.test(x));
            t(`[${lang}] receipt dir`, rt.dir === (lang === 'ar' ? 'rtl' : 'ltr')); await pop.close(); break; } }
        await page.locator('.md .mh button.x').click(); await page.waitForTimeout(100);
      }
    }
    // WhatsApp templates (all modes)
    const msgs = await page.evaluate(() => { const db = JSON.parse(localStorage.autoecole_db_v1); const s = db.sessions[1], c = db.candidates[1];
      return ['confirm', 'update', 'cancel'].map(m => sessionMsg(db, s, c, m)).concat([absMsg(db, c, s), absMsg(db, c, null)]); });
    if (lang !== 'ar') { const bad = msgs.filter(m => AR.test(m)); if (bad.length) leftovers['whatsapp'] = bad; } else t('[ar] WhatsApp templates in Arabic', msgs.every(m => AR.test(m)));
    console.log(`--- [${lang}] sample WhatsApp: ` + JSON.stringify(msgs[0]));
    // monitor role
    await page.evaluate(() => OQ.logoutSchool(true)); await page.waitForSelector('[data-oq-signin]', { timeout: 15000 });
    add('sign-in (school remembered)', await arabicLeft(page)); await page.screenshot({ path: SHOTS + `i18n-${lang}-1-signin-remembered.png` });
    await signIn('karim', '1234');
    await page.waitForSelector('.nav'); const mn = await page.locator('.nav button').count();
    for (let i = 0; i < mn; i++) { const b = page.locator('.nav button').nth(i); const name = (await b.innerText()).trim(); await b.click(); await page.waitForTimeout(150); add('monitor ' + name, await arabicLeft(page));
      const tabs = page.locator('.wrap .tabs button'); const tc = await tabs.count(); for (let k = 0; k < tc; k++) { await tabs.nth(k).click(); await page.waitForTimeout(100); add('monitor ' + name + ' / tab ' + k, await arabicLeft(page)); } }
    // sync badge menu
    await page.click('[data-oq-sync]'); add('sync badge', await arabicLeft(page));
    // horizontal overflow check (layout)
    const ov = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); t(`[${lang}] no horizontal overflow`, ov <= 1, 'overflow ' + ov);
    t(`[${lang}] no page errors`, errs.length === 0, errs.join(' | '));
    t(`[${lang}] no leftover Arabic text (${scanned} screens/modals/tabs scanned)`, lang === 'ar' || Object.keys(leftovers).length === 0, JSON.stringify(leftovers, null, 1));
    await ctx.close();
  }
  await browser.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
