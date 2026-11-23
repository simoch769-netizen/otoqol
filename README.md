# Otoqol — الباك اند (السيرفر)

هاد السيرفر كيخلي الداتا ديال كل مدرسة تتحفظ فالسيرفر عوض غير فالمتصفح.
كل مدرسة عندها حساب بوحدها (كود + كلمة سر)، والداتا ديالها معزولة على المدارس الأخرى.
الواجهة ديال التطبيق بقات كيف ما هي. تزادت غير شاشة "دخول حساب المدرسة" قبل الدخول العادي (admin / secretary / المونيتور)، وعلامة صغيرة لتحت فيها "● محفوظ".

## شنو كاين
- `src/server.js` : السيرفر (Express) — login ديال المدرسة، `GET/PUT /api/db`، admin API.
- `src/db.js` : SQLite (better-sqlite3): جداول `schools` و`school_data` و`history` (نسخ تلقائية).
- `scripts/admin.js` : أوامر الإدارة (إنشاء مدرسة، تبديل كلمة السر، توقيف، export/import، backup).
- `public/index.html` : نسخة من التطبيق، تبدل فيها غير الحفظ (sync مع السيرفر + cache فالجهاز).
- `scripts/api-test.js` و `scripts/browser-test.js` : تيستات.
- `Dockerfile`, `docker-compose.yml`, `ecosystem.config.js` (pm2), `render.yaml` (Render), `.env.example`.

## التشغيل (4 أوامر)
```bash
npm install
cp .env.example .env        # بدل JWT_SECRET (openssl rand -hex 32)
node scripts/admin.js create najah "مدرسة النجاح"     # كيعطيك licence + كلمة السر
node --env-file=.env src/server.js                    # http://localhost:3000
```
فالتجربة المحلية (بلا https) دير `NODE_ENV` خاوي ولا `COOKIE_SECURE=false`، حيت فـproduction الكوكي كيخدم غير على https.

## أوامر الإدارة
```bash
node scripts/admin.js create <code> "<الاسم>" [password]   # مدرسة جديدة
node scripts/admin.js list                                 # كل المدارس
node scripts/admin.js passwd <code> [كلمة_جديدة]           # تبديل كلمة السر (كيخرج كل الأجهزة)
node scripts/admin.js deactivate <code>   |  activate <code>
node scripts/admin.js export <code> file.json              # تصدير الداتا
node scripts/admin.js import <code> file.json              # استيراد (النسخة القديمة كتبقى فـhistory)
node scripts/admin.js history <code>                       # النسخ التلقائية
node scripts/admin.js restore <code> <id>                  # رجوع لنسخة
node scripts/admin.js backup [dir]                         # نسخة كاملة ديال قاعدة البيانات
```
كاين حتى admin API إلا حطيتي `ADMIN_TOKEN` (Header: `Authorization: Bearer <ADMIN_TOKEN>`):
`GET/POST /api/admin/schools`, `POST /api/admin/schools/:code/password`, `POST /api/admin/schools/:code/active {"active":false}`,
`GET /api/admin/schools/:code/export`, `PUT /api/admin/schools/:code/import {"data":{...}}`, `GET .../history`, `POST .../restore/:id`.

## كيفاش خدام الحفظ
- المدرسة كتدخل بالكود (ولا رقم الترخيص) + كلمة السر → كوكي httpOnly (JWT، 30 يوم).
- التطبيق كيجيب الداتا من `GET /api/db`، وكل تبديل كيتسيفط بعد 1.5 ثانية `PUT /api/db` مع `version`.
- إلا جوج أجهزة بدلو فنفس الوقت → السيرفر كيرد 409، والتطبيق كيجيب الجديد ويخلط التبديلات (حسب `id` ديال كل عنصر) وعاود يسيفط. ما كيضيع حتى تبديل فالحالات العادية.
- كل جهاز كيشوف واش كاين جديد كل 20 ثانية.
- بلا انترنت: الداتا كتبقى فالجهاز (localStorage) والعلامة كتولي "بلا انترنت"، وملي يرجع الانترنت كتسيفط وحدها.
- **استيراد الداتا القديمة**: إلا كان المتصفح فيه داتا قديمة (`autoecole_db_v1`) والحساب فالسيرفر خاوي، التطبيق كيسولك واش ترفعها.
- **خروج من حساب المدرسة**: كليكي على "● محفوظ" لتحت.

## اللغات
التطبيق كامل بالعربية والفرنسية والإنجليزية (الاختيار كيتحفظ فالجهاز). العربية RTL، والفرنسية والإنجليزية LTR. حتى رسائل واتساب والوصل كيتبعو اللغة لي مختارة.

## الحماية
helmet (CSP)، rate limit (240 طلب/دقيقة، و10 محاولات login غالطة / 15 دقيقة)، حد ديال الحجم 15MB، CORS مسدود غير للـorigins لي فـ`CORS_ORIGINS`، كلمات السر ديال المدارس bcrypt، header `X-Otoqol` ضد CSRF.

## Deploy على VPS
**pm2:**
```bash
npm ci --omit=dev && cp .env.example .env && nano .env
npm i -g pm2 && pm2 start ecosystem.config.js && pm2 save && pm2 startup
```
**Docker:** `docker compose up -d --build` (الداتا فـ`./data`). إنشاء مدرسة: `docker compose exec otoqol node scripts/admin.js create najah "مدرسة النجاح"`.

حط قدامو nginx ولا Caddy بـhttps (مثال Caddy: `otoqol.ma { reverse_proxy 127.0.0.1:3000 }`) وخلي `TRUST_PROXY=1`.

## Deploy على Render (من GitHub)
1. دخل لـ https://dashboard.render.com → **New** → **Blueprint** → ربط حساب GitHub واختار repo `otoqol`.
2. Render كيقرا `render.yaml` بوحدو. غادي يطلب منك `SEED_SCHOOL_PASSWORD`: كتب كلمة السر ديال المدرسة الأولى (6 حروف ولا كثر). من بعد **Apply**.
3. تسنى حتى يكمل الـbuild (2-5 دقايق)، وخود الرابط `https://otoqol-xxxx.onrender.com`.
4. دخل بالكود `demo` وكلمة السر لي كتبتي، ومن بعد `admin` / `1234`.

**مدرسة جديدة بلا shell** (ADMIN_TOKEN كتلقاه فـRender → Environment):
```bash
curl -X POST https://YOUR-APP.onrender.com/api/admin/schools \
  -H "Authorization: Bearer ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"code":"najah","name":"مدرسة النجاح","password":"Najah2026!"}'
curl -H "Authorization: Bearer ADMIN_TOKEN" https://YOUR-APP.onrender.com/api/admin/schools
```
ولا بالـenv: `SEED_SCHOOL_CODE` + `SEED_SCHOOL_PASSWORD` (+ `SEED_SCHOOL_NAME`) كيخلقو مدرسة وحدة ملي كيبدا السيرفر إلا ما كانتش.

> ⚠️ **مهم:** الخطة المجانية (Free) ديال Render ما فيهاش disk دائم. يعني الداتا ديال SQLite **كتمسح** مع كل redeploy ولا restart، والسيرفر كينعس بعد 15 دقيقة بلا زيارات (أول فتحة كتاخد ~1 دقيقة). مزيانة غير للتجربة.
> باش تبقى الداتا: بدل `plan: free` لـ`plan: starter` (مخلص) وفعّل الـdisk ديال 1GB و`DATA_DIR=/var/data` فـ`render.yaml` (مكتوبين ومعلقين).

## Backups
- تلقائي: كل 10 دقايق (ملي كاين تبديل) كتتحفظ نسخة فـ`history`، و200 نسخة الأخيرة لكل مدرسة كيبقاو. وقبل كل import/restore كتتحفظ نسخة.
- نسخة كاملة كل ليلة (cron):
```
0 3 * * * cd /path/otoqol-backend && node scripts/admin.js backup >> data/backup.log 2>&1
```
كيبقاو آخر 30 ملف فـ`data/backups/`. نقلهم حتى لبلاصة أخرى (rclone / scp) باش إلا طاح السيرفر ما تضيعش الداتا.

## التيست
```bash
node scripts/api-test.js http://localhost:3000 demo 'Demo2026!'
npm i playwright-core && node scripts/browser-test.js http://localhost:3000   # كيحتاج Chrome
node scripts/i18n-test.js http://localhost:3000 demo 'Demo2026!'           # كيدوز على كل الصفحات ف3 لغات (كيبدل الداتا ديال demo بداتا تجريبية)
```

## حدود خاص تعرفها
- الداتا ديال المدرسة كتتحفظ بلوك JSON واحد. مزيان لمدرسة (حتى آلاف المترشحين)، ولكن ماشي قاعدة بيانات بجداول.
- المستخدمين داخل التطبيق (admin/secretary/المونيتورات) باقي كلمات السر ديالهم فالداتا بحال الأصل، والدخول ديالهم كيتحقق فالمتصفح. الحماية الحقيقية هي كلمة السر ديال المدرسة.
- React و Babel كيتجابو من unpkg بحال الملف الأصلي، يعني خاص الانترنت فأول تحميل.
