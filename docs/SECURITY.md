# Helix güvenlik modeli

Bu belge Helix'in **mevcut** güvenlik tasarımını ve güven sınırlarını anlatır.
Kanıtı repository'de olmayan hiçbir kontrol "uygulanıyor" diye yazılmaz;
doğrulanmamış uyumluluk iddiası (OWASP/ASVS/MASVS "compliant") burada yer almaz.
Kullanıcıya dönük veri davranışı [PRIVACY.md](PRIVACY.md), yayın ve secret
prosedürü [RELEASE.md](RELEASE.md), test katmanları [TESTING.md](TESTING.md),
kod sınırları [ARCHITECTURE.md](ARCHITECTURE.md) belgesindedir.

## Güven sınırları

| Sınır | Güvenilen | Güvenilmeyen |
|---|---|---|
| Cihaz | OS dosya koruması, keychain/SecureStore | uygulama içi girdi, import dosyası, route param |
| Client → Supabase | JWT'nin `auth.uid()` claim'i | client'ın gönderdiği `user_id`, gizlenmiş buton, route guard |
| Supabase | RLS policy'leri, owner-aware FK/trigger | anon rolü, service-role dışı ayrıcalık varsayımı |
| Dış feed (TCMB, Frankfurter, Harem, favicon) | hiçbiri | yanıt boyutu, şekli, tarihi, host'u |
| Yayın hattı | protected `main`: required `quality` check (strict), imzalı commit, lineer geçmiş, `enforce_admins`, force-push/silme kapalı | doğrulanmamış artefact, elle Pages/OTA müdahalesi |

Client tarafındaki hiçbir kontrol yetkilendirme sayılmaz. Yetki tek yerde,
Postgres RLS'te uygulanır.

## Kimlik doğrulama ve oturum

- Supabase Auth; e-posta/şifre. Şifre Helix tablolarında tutulmaz.
- Şifre sıfırlama PKCE akışıdır. Web redirect'i Router'ın `/helix` base path'ini
  korumak zorundadır; kurulu build `helix://` şemasını kullanır. Recovery
  route'ları normal signed-in/onboarding guard'larından bilinçli olarak muaftır.
- Bir e-postanın hesaba ait olup olmadığı sıfırlama akışında açığa çıkarılmaz
  (user enumeration).
- Oturum saklama: native'de `expo-secure-store`, web'de Supabase'in browser
  storage'ı (`src/sync/supabase.ts`, `src/services/kv.ts`). Web'de browser
  profiline erişen kişi oturuma erişebilir — bu kabul edilmiş bir sınırdır.
- Her authenticated arka plan işi session-scoped'dır: auth bir epoch açar
  (`startSyncSession`), çıkış/hesap silme `stopSyncSession`'ı bekler ve render'ı
  aşabilen her async iş `runSyncSessionTask` üzerinden koşar. A kullanıcısının
  geç dönen cevabı B aktifken yazamaz. Test: `session-epoch`, `session-task`.
- Native cihazda opsiyonel biyometrik app lock (`expo-local-authentication`).

## Yerel veri

- Bütün finansal veri cihazdaki SQLite'ta (async, `expo-sqlite`).
- iOS: `app.json` `com.apple.developer.default-data-protection =
  NSFileProtectionComplete`. Uygulama-üretimi dosyalar cihaz kilitliyken
  okunamaz. Entitlement yalnız yeni bir yerel `npx expo run:ios --device`
  build'iyle etkinleşir. Bu **uygulama seviyesinde SQLCipher şifrelemesi
  değildir**.
- Web'de SQLite/OPFS ve `localStorage` güvenliği browser profiline bağlıdır.
- Export edilen JSON/CSV açık metindir; şifreli kasa iddiası yoktur.
- CSV export formül enjeksiyonuna karşı nötrlenir (`csv-export-safety` testi).

## Supabase yetkilendirme

- Policy'ler `authenticated` rolüne ve `(select auth.uid()) = user_id`
  sahipliğine dayanır; insert/update `WITH CHECK` ile owner değişimini engeller.
- Owner-aware FK ve category/reference trigger'ları cross-account ilişkiyi
  reddeder.
- Tablo ayrıcalıkları migration `00000000000009_table_privileges.sql` ile açıkça
  belirtilir: `authenticated` satır-seviyesi DML, `anon` hiçbir şey,
  `service_role` tam yetki. RLS satırları filtreler ama ayrıcalık **vermez**;
  anon'un grant'ı kaldırıldığı için anonim çağrı sessiz boş sonuç yerine `42501`
  reddi alır. Bu migration linked projeye uygulanmıştır (şema 9/9 senkron).
- `keep_alive` tablosu kullanıcı verisi tutmaz ve yalnız service-role
  heartbeat'ine açıktır.
- RPC: `delete_own_account` SECURITY DEFINER'dır ve öyle olmak zorundadır —
  kullanıcının `auth.users` üzerinde yetkisi yoktur. Gövde `auth.uid()` ile
  sınırlı, argümansız, `search_path = ''`, `execute` yalnız `authenticated`.
- Trigger/RPC fonksiyonları sabit `search_path` ile yazılır (migration 3, 6, 7,
  8).
- Kanıt: `supabase/tests/owner_integrity_and_rls.sql`, `plan(24)` — A/B
  izolasyonu, owner değiştirme denemesi, anon erişimi, cross-owner FK.

## Rol ayrımı ve secret'lar

| Anahtar | Nerede | Not |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `.env`, CI workflow, client bundle | public endpoint |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `.env`, CI workflow, client bundle | publishable; güvenlik sınırı RLS |
| service-role / `sb_secret_*` | yalnız GitHub Actions secret (keepalive workflow) | client, log, README, artefact'a girmez |
| EAS oturumu | maintainer makinesi veya güvenli CI secret | commit edilmez |
| Signing material | OS keychain / provisioning | repo'ya ve OTA artefact'ına girmez |

`.env.example` yalnız iki `EXPO_PUBLIC_*` değişkeni taşır ve service-role'ün
oraya konmaması dosyanın kendi başlığında yazılıdır.

## Web dağıtımı

Statik GitHub Pages'te server header yoktur; bu yüzden CSP `src/app/+html.tsx`
içinde meta olarak taşınır ve `tests/release-config.test.ts` ile korunur:

- `default-src 'self'`, `object-src 'none'`, `base-uri 'self'`,
  `form-action 'self'`;
- `connect-src` yalnız Supabase, Frankfurter ve Harem websocket'ine izin verir —
  XSS exfiltration hedeflerini kısıtlayan asıl kontrol budur. TCMB listede
  yoktur çünkü `today.xml` CORS başlığı göndermez ve web zaten yalnız
  Frankfurter'ı çağırır (`src/services/fx-fetch.ts`);
- `script-src` `'unsafe-inline'` içerir: export her build'de inline bootstrap
  script'i üretir, statik hash mümkün değildir. **Bilinen zayıflık.**
- `img-src` `https://*.gstatic.com`'a izin vermek zorundadır; favicon servisi
  oraya 301 yönlendirir.

## Girdi ve dış veri

- Route param'ları düşmanca kabul edilir; domain predicate'iyle doğrulanmadan
  sorguya girmez.
- Workbook byte'ları SheetJS'e verilmeden önce ZIP central-directory
  entry/boyut/oran limitlerinden geçer; ardından sheet/row/cell/text limitleri
  uygulanır. XLSX dynamic import'tur.
- JSON restore tamamen doğrulanmadan tek satır yazılmaz.
- Dış feed'ler: abort signal, timeout, boyut/şekil/tarih doğrulaması. Sağlayıcının
  beyan ettiği iş günü saklanır, "bugün" uydurulmaz. Eksik kur eksik kalır;
  yabancı tutar asla TRY sayılmaz. Favicon host'u sıkı public-host
  doğrulaması/encode'undan geçer.
- Kanıt: `external-services`, `spreadsheet-import`, `backup-validation`,
  `import-plan`, `navigation`, `app-guard` testleri.

## Loglama ve PII

- Production'da uygulama kendi console log'unu üretmez.
- `src/services/logger.ts` production'da yalnız sınırlı, cihaz-içi
  `{time, scope, severity, category}` kaydı tutar. Token, şifre, satır payload'ı,
  not, e-posta, id veya tutar persist edilmez. Kullanıcıya dönük diagnostics
  route'u/export'u yoktur.
- Kanıt: `tests/privacy.test.ts`, `tests/diagnostics.test.ts`.
- Uygulama dışı yüzey: native `inactive`/`background` durumunda `PrivacyCover`
  app-switcher snapshot'ından önce finansal içeriği kapatır.

## Bağımlılık ve tedarik zinciri

- Actions SHA'ları full commit'e pinlidir.
- Dependabot npm + Actions için haftalık çalışır; güvenlik güncellemeleri açıktır,
  yalnız Expo-yönetimli matris için rutin sürüm yükseltmeleri guard'lıdır
  (gerekçe: [ARCHITECTURE.md](ARCHITECTURE.md#stack)).
- `xlsx` SheetJS CDN tarball'ından gelir; `npm audit` ve Dependabot bunu
  **görmez** — import kodu her değiştiğinde upstream release elle kontrol edilir.
- CodeQL `javascript-typescript` üzerinde PR'da ve haftalık cron ile koşar.
- Değerlendirilmiş advisory kararları [RELEASE.md](RELEASE.md) "Dependabot
  bulguları" tablosundadır.

## Migration ve ayrıcalık yönetimi

Şema değişikliği [RELEASE.md](RELEASE.md) "Supabase migration" sırasını izler:
protected PR → linked push → policy/constraint/RPC davranışının remote'ta testi →
generated type commit'i. `migration list --linked` local ve remote sürümleri
birebir göstermelidir; `db lint --linked` schema error vermemelidir. Mevcut
durum: **9/9 senkron, lint temiz** (doğrulama 2026-07-20).

## Preview / production ayrımı

- OTA `preview` channel'ı tek ve koşulsuz bir mapping ile `preview` branch'ine
  bağlıdır, runtime `1.0.0`. `production` channel `eas.json`'da tanımlıdır ama
  bu repoda yayımlanmış bir production store build'i yoktur.
- E2E export'u Supabase env'ini bilinçli olarak boşaltır ve ayrı `dist-e2e/`
  artefact'ı üretir; test env'i Pages artefact'ına karışamaz.
- Testler production Supabase'e bağlanmaz ve gerçek kullanıcı verisi yazmaz.

## OTA / runtime bütünlüğü

Update bütünlüğü Expo'nun imzalı update protokolüne ve `expo-updates`'in runtime
eşleşmesine dayanır. Bu repo **ek bir code-signing anahtarı yapılandırmaz**;
güven sınırı EAS hesabının kendisidir. Runtime `appVersion` policy'sine bağlıdır,
bu yüzden eski runtime'a yanlış bundle ulaşamaz. Native config, icon/splash, SDK
ve runtime değişiklikleri OTA-able değildir.

## Bilinen zayıflıklar (açıkça kabul edilenler)

| Konu | Durum |
|---|---|
| `script-src 'unsafe-inline'` | statik export inline bootstrap ürettiği için gerekli; `connect-src` daraltmasıyla telafi ediliyor |
| Web oturum saklama | browser storage; profil erişimi = oturum erişimi |
| Uygulama seviyesi DB şifrelemesi | yok; iOS'ta OS dosya koruması, web'de browser profili |
| Merkezi crash reporting / alerting | yok; sessiz hata maintainer'a otomatik ulaşmaz |
| OTA ek code-signing | yapılandırılmadı |
| Android store build | imzalı production build ve fiziksel kabul yapılmadı |

## Plan sınırlı opsiyonel kontroller

Bunlar uygulama kusuru veya çözülmemiş kod açığı değildir; barındırma planının
sunmadığı ek kontrollerdir. Bulgu olarak açılmaz, plan değişirse etkinleştirilir.

| Kontrol | Durum |
|---|---|
| `auth_leaked_password_protection` (HaveIBeenPwned kontrolü) | Mevcut Supabase Free plan’de kullanılamıyor; repo’dan veya Dashboard’dan açılamaz. Şifre gücü sınırı uygulamanın kendi form doğrulamasında kalır. |

## Doğrulama matrisi (Paket 2'de doldurulacak)

Aşağıdaki tablo **iddia değil, plan**dır. Bu pakette hiçbir satır "compliant"
işaretlenmemiştir; her satır Paket 2'deki kod/güvenlik denetiminde repository
kanıtıyla doldurulacaktır. İzin verilen durumlar: `NOT ASSESSED`,
`EVIDENCE: <dosya/test>`, `GAP: <bulgu>`, `N/A: <gerekçe>`.

### OWASP Top 10 (2021)

| # | Kategori | İlgili Helix yüzeyi | Durum |
|---|---|---|---|
| A01 | Broken Access Control | RLS policy'leri, tablo grant'ları, `delete_own_account` | NOT ASSESSED |
| A02 | Cryptographic Failures | SecureStore, OS dosya koruması, açık metin export | NOT ASSESSED |
| A03 | Injection | Drizzle parametreleri, CSV formül enjeksiyonu, route param'ları | NOT ASSESSED |
| A04 | Insecure Design | outbox/dead-letter, all-or-nothing import, session epoch | NOT ASSESSED |
| A05 | Security Misconfiguration | CSP, Pages 404 shell, Supabase lint, `search_path` | NOT ASSESSED |
| A06 | Vulnerable Components | Dependabot, CodeQL, SheetJS CDN pin | NOT ASSESSED |
| A07 | Identification & Auth Failures | PKCE recovery, enumeration, session lifecycle | NOT ASSESSED |
| A08 | Software & Data Integrity | pinned Actions, OTA runtime/channel, migration history | NOT ASSESSED |
| A09 | Logging & Monitoring Failures | bounded local logger, merkezi telemetry yokluğu | NOT ASSESSED |
| A10 | SSRF | favicon host doğrulaması, sabit FX/market endpoint'leri | NOT ASSESSED |

### OWASP API Security Top 10 (2023)

| # | Kategori | İlgili yüzey | Durum |
|---|---|---|---|
| API1 | Broken Object Level Authorization | owner-only RLS, owner-aware FK | NOT ASSESSED |
| API2 | Broken Authentication | Supabase Auth, token yenileme | NOT ASSESSED |
| API3 | Broken Object Property Level Auth | `WITH CHECK` owner değişimi | NOT ASSESSED |
| API4 | Unrestricted Resource Consumption | import/row limitleri, pull batch sınırları | NOT ASSESSED |
| API5 | Broken Function Level Authorization | RPC `execute` grant'ları | NOT ASSESSED |
| API6 | Sensitive Business Flow | hesap dondurma/silme akışı | NOT ASSESSED |
| API7 | SSRF | dış feed host doğrulaması | NOT ASSESSED |
| API8 | Security Misconfiguration | anon grant'ları, lint bulguları | NOT ASSESSED |
| API9 | Improper Inventory Management | tek Supabase projesi, preview/production | NOT ASSESSED |
| API10 | Unsafe Consumption of APIs | TCMB/Frankfurter/Harem yanıt doğrulaması | NOT ASSESSED |

### OWASP ASVS ve MASVS

| Standart | Hedef kapsam | Durum |
|---|---|---|
| ASVS V1–V14 (L1 hedefi) | tek kullanıcılı, sunucusuz-mimari uygun bölümler | NOT ASSESSED |
| MASVS-STORAGE | SQLite, SecureStore, export dosyaları | NOT ASSESSED |
| MASVS-CRYPTO | OS-sağlayıcı kullanımı; uygulama kendi kriptosunu yazmaz | NOT ASSESSED |
| MASVS-AUTH | biyometrik app lock, oturum yaşam döngüsü | NOT ASSESSED |
| MASVS-NETWORK | TLS, sabit endpoint listesi, websocket | NOT ASSESSED |
| MASVS-PLATFORM | entitlement, bildirim izni, `PrivacyCover` | NOT ASSESSED |
| MASVS-CODE | bağımlılık yönetimi, OTA bütünlüğü | NOT ASSESSED |
| MASVS-RESILIENCE | anti-tamper/obfuscation yok — kapsam dışı kararı gerekçelendirilecek | NOT ASSESSED |

MASTG test seçimi Paket 2'de bu satırlara bağlanır.

## Açık bildirme (vulnerability reporting)

Güvenlik açığı public issue'ya yazılmaz. Maintainer'a
[GitHub üzerinden](https://github.com/topraksv) özel olarak ulaşın. Bildirime
ham finansal veri, yedek dosyası, token, şifre veya ekran görüntüsündeki gerçek
hesap verisi eklenmemelidir; yeniden üretim adımı ve etkilenen sürüm yeterlidir.
Bu tek geliştiricili bir projedir; taahhüt edilmiş bir SLA yoktur.
