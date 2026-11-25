# Otoqol — الباك اند (السيرفر)

هاد السيرفر كيخلي الداتا ديال كل مدرسة تتحفظ فالسيرفر عوض غير فالمتصفح.
كل مدرسة عندها حساب بوحدها (كود + كلمة سر)، والداتا ديالها معزولة على المدارس الأخرى.
الواجهة ديال التطبيق بقات كيف ما هي. تبدل غير الدخول: ولات **شاشة دخول وحدة** (اسم المستخدم + كلمة السر)، وزادت علامة الحفظ لتحت.

## شنو كاين
- `src/server.js` : السيرفر (Express) — الدخول (`/api/signin`)، نسيت كلمة السر (`/api/forgot-password`, `/api/reset-password`)، `GET/PUT /api/db`، admin API.
- `src/mail.js` : إرسال إيميل استرجاع كلمة السر (nodemailer / SMTP).
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

## الدخول (شاشة وحدة)
- شاشة وحدة فيها غير: **اسم المستخدم** + **كلمة السر** (بالعربية/الفرنسية/الإنجليزية). كل نسخة (deploy) ديال مدرسة وحدة، والمدرسة هي `DEFAULT_SCHOOL_CODE`، ولا `SEED_SCHOOL_CODE` إلا ما كانش، ولا أول مدرسة مفعلة.
- السيرفر (`POST /api/signin {username, password}`، و`school` اختياري) كيتحقق من المستخدم فالداتا ديال المدرسة بنفس الطريقة ديال التطبيق: اسم المستخدم بلا فرق بين الحروف الكبار والصغار، والأرقام العربية (١٢٣) كتتحسب بحال 123. كيقلب فالمستخدمين (المدير/السكريتيرة) ومن بعد فالمونيتورات. إلا كان شي حساب فيه `active:false` ما كيدخلش.
- إلا صح → كوكي httpOnly (JWT، 30 يوم) فيه المدرسة + المستخدم، والتطبيق كيدخل نيشان للصفحة ديال داك المستخدم. الصلاحيات (مدير، سكريتيرة، مونيتور) باقين كيف ما كانو.
- **أول مرة** (مدرسة جديدة ما فيها حتى داتا): دخل بـ`admin` + **كلمة السر ديال المدرسة** (لي عطيتيها فـadmin API). التطبيق كيصاوب الداتا الأولى، وكلمة السر ديال `admin` فالتطبيق كتولي هي نفس كلمة السر ديال المدرسة (ماشي 1234).
- **دخول المالك الاحتياطي**: `admin` + كلمة السر ديال المدرسة كيخدم **غير إلا ما كاينش** حساب سميتو `admin` فالتطبيق (مثلا تمسح ولا تبدلات السمية). كيدخلك بأول مدير. إلا كان `admin` موجود، خاصك كلمة السر ديالو لي فالتطبيق.
- **تسجيل الخروج**: بوطونة "تسجيل الخروج" فالفوق (كاينة فكل صفحة)، ولا من الإعدادات، ولا من "● محفوظ" لتحت → كيرجع لنفس الشاشة.
- إلا تمسح المستخدم ولا تبدلات كلمة السر ديالو فالتطبيق، الجلسة ديالو كتسالى ملي يعاود يحل التطبيق (`/api/me` كيرد 401).
- `POST /api/login {school, password}` (الدخول القديم بكلمة السر ديال المدرسة بوحدها) باقي خدام للتيستات والسكريبتات، ولكن الواجهة ما بقاتش كتستعملو. إلا شي جهاز كان داخل بيه، كيبقى داخل.


## نسيت كلمة السر (بالإيميل)
- فشاشة الدخول كاينة «نسيت كلمة السر؟». المستخدم كيكتب اسم الدخول، والسيرفر كيصيفط **رمز من 6 أرقام** للإيميل المسجّل فالحساب (صالِح 15 دقيقة، 5 محاولات). من بعد كيدخل الرمز وكلمة سر جديدة.
- الجواب ديال السيرفر **دائما عام** (`POST /api/forgot-password` → `{ok:true}`): ما كيبينش واش الحساب ولا الإيميل موجودين.
- الرموز كيتحفظو مشفرين (hash)، وفي حد للطلبات لكل IP ولكل حساب (`FORGOT_PER_15MIN` / `FORGOT_PER_ACCOUNT_15MIN`).
- الإيميل اختياري، والمدير كيزيدو من **الإعدادات → حسابات الفريق** (للمدير/السكريتيرة) ومن صفحة **المونيتورات**. خاص الإيميل يكون بصيغة صحيحة.
- الإرسال بـ SMTP عبر `nodemailer`. المتغيرات:
  - `SMTP_HOST` (الافتراضي `smtp.gmail.com`)
  - `SMTP_PORT` (الافتراضي `465`)
  - `SMTP_USER` (الافتراضي `contact.otoqol@gmail.com`)
  - `SMTP_PASS` (Gmail App Password — تحطّو فـ Railway بنفسك، ما كيتكتبش هنا)
  - `MAIL_FROM` (الافتراضي `Otoqol <contact.otoqol@gmail.com>`)
- إلا ما كانش `SMTP_PASS`، السيرفر **ما كيطّحش**: كيسجّل فاللوج وكيرجع نفس الرسالة العامة، بلا إيميل.
- الرسالة بالعربية الفصحى والفرنسية، موقعة «فريق Otoqol»، وفي التذييل واتساب `+212 716-396333`، إنستغرام `@otoqol_officiel`، و`contact.otoqol@gmail.com`.
- إلا ما كانش إيميل مسجّل للحساب، ولا نسا المدير كلمة السر وما قدرش يسترجعها: دير export، بدل `password` ديال الحساب فالملف، ودير import.

## كيفاش خدام الحفظ
- التطبيق كيجيب الداتا من `GET /api/db`، وكل تبديل كيتسيفط بعد 1.5 ثانية `PUT /api/db` مع `version`.
- إلا جوج أجهزة بدلو فنفس الوقت → السيرفر كيرد 409، والتطبيق كيجيب الجديد ويخلط التبديلات (حسب `id` ديال كل عنصر) وعاود يسيفط. ما كيضيع حتى تبديل فالحالات العادية.
- كل جهاز كيشوف واش كاين جديد كل 20 ثانية.
- بلا انترنت: الداتا كتبقى فالجهاز (localStorage) والعلامة كتولي "بلا انترنت"، وملي يرجع الانترنت كتسيفط وحدها.
- **استيراد الداتا القديمة**: إلا كان المتصفح فيه داتا قديمة (`autoecole_db_v1`) والحساب فالسيرفر خاوي، التطبيق كيسولك واش ترفعها.

## اللغات
التطبيق كامل بالعربية والفرنسية والإنجليزية (الاختيار كيتحفظ فالجهاز). العربية RTL، والفرنسية والإنجليزية LTR. حتى رسائل واتساب والوصل كيتبعو اللغة لي مختارة.

## الحماية
- **كلمات السر**: ديال المدارس وديال المستخدمين داخل التطبيق (admin/secretary/المونيتورات) كيتحفظو bcrypt. كلمات السر القديمة لي كانت مكتوبة عاديين كيتشفرو بوحدهم فأول دخول (`admin` / `1234` كيبقى خدام). السيرفر عمرو ما كيرجع كلمة السر للمتصفح (`/api/db` كيعطيها خاوية، وخاوية = ما تبدلاتش).
- **الصلاحيات فالسيرفر**: السكريتيرة ما تقدرش تبدل المستخدمين ولا المونيتورات ولا الإعدادات، والمونيتور حتى المالية والسيارات. إلا تمسح شي مستخدم ولا تبدلات كلمة السر ديالو، كيخرج فالطلب الجاي.
- **الجلسات**: كوكي `HttpOnly` + `Secure` + `SameSite=Strict`، JWT HS256 (issuer/audience)، وكل جلسة مسجلة فالسيرفر: **تسجيل الخروج كيقتل الجلسة** (حتى إلا شي حد نسخ الكوكي).
- **Rate limit**: 240 طلب/دقيقة لكل IP، 10 محاولات دخول غالطين / 15 دقيقة لكل IP، و30 / 15 دقيقة لكل اسم مستخدم (من أي IP)، و10 محاولات غالطين ديال `ADMIN_TOKEN`. طلبات «نسيت كلمة السر»: 5 / 15 دقيقة لكل IP و3 / 15 دقيقة لكل حساب. `TRUST_PROXY=1` كيتقرا رقم (hop واحد) باش كل زبون يكون عندو الحد ديالو.
- **Headers**: CSP (بلا frames)، `X-Frame-Options: DENY`، `nosniff`، `Referrer-Policy`، `Permissions-Policy`، HSTS فـproduction. React وBabel مثبتين بنسخة محددة مع SRI.
- **CSRF**: header `X-Otoqol` ضروري فكل طلب كيبدل شي حاجة. CORS مسدود غير للـorigins لي فـ`CORS_ORIGINS`.
- **الحجم والديسك**: حد 15MB للطلب، والنسخ التلقائية (history) ما كيفوتوش `HISTORY_MAX_MB` (100MB) لكل مدرسة.
- **Docker**: كيبدا root غير باش يعطي `/data` لـuser `node`، ومن بعد التطبيق كيخدم بـ`node` (ماشي root). إلا بغيتي تخدم `scripts/admin.js` داخل الكونتينر، خدمو بـ`setpriv --reuid=node --regid=node --init-groups node scripts/admin.js ...` باش ما يتصاوبوش ملفات ديال root فـ`/data`، ولا استعمل admin API.
- ⚠️ من بعد هاد التحديث، كل الأجهزة خاصها تعاود الدخول مرة وحدة (الجلسات القديمة ما بقاتش مقبولة).

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
4. فشاشة الدخول: اسم المستخدم `admin`، وكلمة السر لي كتبتي (أول مرة). إلا كانت المدرسة فيها داتا من قبل، `admin` بكلمة السر ديالو فالتطبيق.

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
ADMIN_TOKEN=... node scripts/api-test.js http://localhost:3000 demo 'Demo2026!'   # بلا ADMIN_TOKEN كيتخطاو تيستات المدرسة الجديدة
npm i playwright-core && ADMIN_TOKEN=... node scripts/browser-test.js http://localhost:3000   # كيحتاج Chrome، و demo خاوية (كيشعل سيرفر تاني فـport+1 لتيست الاستيراد)
node scripts/security-test.js                                              # تيستات الحماية (كيشعل سيرفر بوحدو فـ4100)
node scripts/load-test.js 10                                               # تيست الضغط محليا (كيشعل سيرفر بوحدو فـ4200، ما تديروش على السيت)
node scripts/i18n-test.js http://localhost:3000 demo 'Demo2026!'           # كيدوز على كل الصفحات ف3 لغات (كيبدل الداتا ديال demo بداتا تجريبية)
node scripts/forgot-password-test.js                                         # تيست نسيت كلمة السر (SMTP وهمي، كيشعل سيرفر بوحدو فـ4300)
```

## حدود خاص تعرفها
- الداتا ديال المدرسة كتتحفظ بلوك JSON واحد. مزيان لمدرسة (حتى آلاف المترشحين)، ولكن ماشي قاعدة بيانات بجداول.
- React و Babel كيتجابو من unpkg بحال الملف الأصلي، يعني خاص الانترنت فأول تحميل.
