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
- Oturum saklama: native'de bounded, bozuk chunk marker’larında fail-closed
  `expo-secure-store` adapter’ı; web'de Supabase'in browser storage'ı
  (`src/sync/secure-chunked-storage.ts`, `src/sync/supabase.ts`). Web'de browser
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
  belirtilir; `00000000000010_tombstone_only_client_deletes.sql`
  `authenticated` için fiziksel DELETE’i ve DELETE policy’lerini kaldırır.
  Client yalnız select/insert/update + tombstone kullanır; `anon` hiçbir tablo
  yetkisi almaz, `service_role` tam yetkilidir. RLS satırları filtreler ama
  ayrıcalık **vermez**; anonim ve hard-delete çağrıları `42501` reddi alır.
  Linked rollout durumu [RELEASE.md](RELEASE.md#5--supabase-migration) içindedir.
- `keep_alive` tablosu kullanıcı verisi tutmaz ve yalnız service-role
  heartbeat'ine açıktır.
- RPC: `delete_own_account` SECURITY DEFINER'dır ve öyle olmak zorundadır —
  kullanıcının `auth.users` üzerinde yetkisi yoktur. Gövde `auth.uid()` ile
  sınırlı, argümansız, `search_path = ''`, `execute` yalnız `authenticated`.
- Trigger/RPC fonksiyonları sabit `search_path` ile yazılır (migration 3, 6, 7,
  8).
- Kanıt: `supabase/tests/owner_integrity_and_rls.sql`, `plan(33)` — A/B
  izolasyonu, owner değiştirme, anon/hard-delete reddi, cross-owner FK,
  transfer constraint’i ve hesap-silme RPC davranışı.

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
- Rutin Dependabot version update’leri ve doğrudan npm çözümlemeleri yeni
  yayımlanan paketleri yedi gün bekletir; Dependabot security update’leri bu
  cooldown’dan etkilenmez. Acil npm security fix’i açık bir
  `min-release-age-exclude`/komut override’ı gerektirir.
- `xlsx` SheetJS CDN tarball'ından gelir; `npm audit` ve Dependabot bunu
  **görmez** — import kodu her değiştiğinde upstream release elle kontrol edilir.
- CodeQL `javascript-typescript` üzerinde PR'da ve haftalık cron ile koşar.
- Değerlendirilmiş advisory kararları [RELEASE.md](RELEASE.md) "Dependabot
  bulguları" tablosundadır.

## Migration ve ayrıcalık yönetimi

Şema değişikliği [RELEASE.md](RELEASE.md) "Supabase migration" sırasını izler:
protected PR → linked push → policy/constraint/RPC davranışının remote'ta testi →
generated type commit'i. Güncel linked version/lint/pgTAP sonucu tek yerde,
[RELEASE.md](RELEASE.md#5--supabase-migration) ve paket handoff’unda tutulur.

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
| Fiziksel cihaz erişilebilirlik kabulü | VoiceOver/TalkBack, Dynamic Type ve app-switcher snapshot zamanlaması gerçek cihazda **hiç doğrulanmadı**; matris [TESTING.md](TESTING.md) içinde `BLOCKED` |
| MASVS-RESILIENCE | anti-tamper/obfuscation/root tespiti bilinçli olarak yok — gerekçe doğrulama matrisinde |
| `xlsx` otomatik uyarı kapsamı dışında | npm audit ve Dependabot SheetJS CDN tarball'ını hiç göremez; kapsam OSV-Scanner ve elle upstream kontrolüyle telafi ediliyor |

## Plan sınırlı opsiyonel kontroller

Bunlar uygulama kusuru veya çözülmemiş kod açığı değildir; barındırma planının
sunmadığı ek kontrollerdir. Bulgu olarak açılmaz, plan değişirse etkinleştirilir.

| Kontrol | Durum |
|---|---|
| `auth_leaked_password_protection` (HaveIBeenPwned kontrolü) | Mevcut Supabase Free plan’de kullanılamıyor; repo’dan veya Dashboard’dan açılamaz. Şifre gücü sınırı uygulamanın kendi form doğrulamasında kalır. |

## Doğrulama matrisi

Bu tablo **uyumluluk beyanı değil, değerlendirilmiş kapsam kaydıdır**. Hiçbir
satır "compliant" veya "certified" demez; her satır repository'deki dosya, test
veya scanner çıktısına dayanır. Biçim:

`KONTROL → APPLICABLE / N/A / DEVICE-BINARY ONLY → DOSYA/AKIŞ → TEST/SCANNER KANITI → ARTIK RİSK`

Bu matris kalıcı kontrol kapsamını gösterir; SHA, scanner sürümü ve değişken test
sayıları burada dondurulmaz. Güncel koşu kanıtı `docs/AI_HANDOFF.md` ve GitHub
Actions `quality` job’undadır.

### OWASP Top 10 (2021)

| # | Durum | Dosya / akış | Test / scanner kanıtı | Artık risk |
|---|---|---|---|---|
| A01 Broken Access Control | APPLICABLE | 16 tabloda owner-only RLS; `WITH CHECK`; owner-aware FK; tombstone-only client grant’ları; `delete_own_account`; `src/domain/route-params.ts` | linked pgTAP: A/B izolasyonu, owner değiştirme, client DELETE/anon reddi (`42501`), cross-owner FK (`23503`), scoped RPC. `tests/route-params.test.ts`, `tests/navigation.test.ts`, hostile-route E2E | Yetki tek yerde (RLS). Client guard'ları yetkilendirme sayılmıyor |
| A02 Cryptographic Failures | APPLICABLE | `expo-secure-store`; iOS `NSFileProtectionComplete`; TLS-only endpoint'ler; uygulama kendi kriptosunu yazmaz | `tests/privacy.test.ts` `kv.set` anahtar sınırı; Semgrep `p/insecure-transport` **0**; Gitleaks **0 gerçek secret** | **Bilinen:** uygulama seviyesinde SQLCipher yok; web'de oturum browser storage'ında. İkisi de aşağıda açıkça kabul edilmiş |
| A03 Injection | APPLICABLE | Drizzle parametre bağlama; ham SQL yok; `csvCell`; `isUuidShaped` PostgREST filtre grameri | Semgrep `p/sql-injection`+`p/command-injection`+`p/xss` **0 bulgu**; `tests/csv-export-safety.test.ts` (7 test, mutasyon kanıtlı); `tests/sync-merge.test.ts` filtre-grameri enjeksiyonu | React Native metin render'ı `dangerouslySetInnerHTML` kullanmıyor |
| A04 Insecure Design | APPLICABLE | outbox + `sync_dead_letters` karantina; all-or-nothing import; session epoch; `writeRows` tek transaction | `tests/sync-dead-letters.test.ts` (gerçek migration DDL'ine karşı), `tests/backup-validation.test.ts`, `tests/session-epoch.test.ts`, `tests/repository-contract.test.ts` (tek `writeRows`) | — |
| A05 Security Misconfiguration | APPLICABLE | `src/app/+html.tsx` CSP; `dist/404.html` = root shell; sabit function `search_path`; açık table grant’ları | `tests/release-config.test.ts`; linked migration list + public-schema lint | **Bilinen:** `script-src 'unsafe-inline'` — statik export inline bootstrap üretiyor, `connect-src` daraltmasıyla telafi |
| A06 Vulnerable Components | APPLICABLE | `package-lock.json`; SheetJS CDN pin; Dependabot guard'ları | clean `npm ci`; `npm ls --all`; `npm audit`ta kalan tek advisory zinciri dev-only Drizzle transpiler’ındaki dört moderate node | Advisory dispozisyonları [RELEASE.md](RELEASE.md#5b--dependabot-bulguları) içinde; runtime bundle’a girmez |
| A07 Identification & Auth Failures | APPLICABLE | Supabase Auth; PKCE recovery; `src/auth/verification-brake.ts`; `src/auth/session.ts` epoch'ları | `tests/auth.test.ts` (expired/reused/malformed link), `tests/verification-brake.test.ts` (18 vaka), `tests/session-task.test.ts` | E-posta enumeration sıfırlama akışında açığa çıkmıyor |
| A08 Software & Data Integrity | APPLICABLE | Bütün Action referansları full-SHA pinli; OTA runtime `appVersion` + channel ayrımı; lockfile integrity; imzalı commit + korumalı `main` | `tests/release-config.test.ts`; clean `npm ci`; GitHub verified signature/check | **Bilinen:** ek OTA code-signing anahtarı yapılandırılmadı; güven sınırı EAS hesabı |
| A09 Logging & Monitoring Failures | APPLICABLE | `src/services/logger.ts`, `src/services/diagnostics.ts` (12 kayıtlık bounded ring) | `tests/diagnostics.test.ts` (tam anahtar kümesi + negatif PII regex), `tests/privacy.test.ts` | **Bilinen:** merkezi crash/telemetry alerting yok — sessiz hata maintainer'a otomatik ulaşmıyor |
| A10 SSRF | APPLICABLE | `src/domain/logo-domain.ts` public-host doğrulaması; sabit FX/market endpoint listesi; CSP `connect-src` | `tests/external-services.test.ts` (credential/port/localhost/IP reddi), `e2e/helpers.ts` host-eşleşmesi (substring değil) | Kullanıcı serbest URL giremiyor; yalnız domain adı |

### OWASP API Security Top 10 (2023)

Helix'in kendi API'si yoktur; tüketilen yüzey Supabase PostgREST + üç dış
feed'dir. Satırlar bu yüzeye göre değerlendirildi.

| # | Durum | Dosya / akış | Test / scanner kanıtı | Artık risk |
|---|---|---|---|---|
| API1 Broken Object Level Auth | APPLICABLE | owner-only RLS, owner-aware FK | pgTAP: B, A'nın satırını okuyamaz/güncelleyemez/silemez (3 assertion) | — |
| API2 Broken Authentication | APPLICABLE | Supabase Auth, token yenileme, session epoch | `tests/auth.test.ts`, `tests/session-epoch.test.ts` | — |
| API3 Broken Object Property Level Auth | APPLICABLE | insert/update `WITH CHECK` | pgTAP: owner değiştirme denemesi `42501` | — |
| API4 Unrestricted Resource Consumption | APPLICABLE | `MAX_BACKUP_ROWS`, `MAX_BACKUP_BYTES`, ZIP oran/boyut preflight, `INPUT_LIMITS`, `MAX_INSTALLMENT_COUNT`, 60 bildirim tavanı, pull batch sınırı | `tests/backup-validation.test.ts`, `tests/spreadsheet-import.test.ts` (ZIP bomb), `tests/input-policy.test.ts`, `tests/installments.test.ts` | — |
| API5 Broken Function Level Auth | APPLICABLE | `delete_own_account` `execute` yalnız `authenticated`, argümansız, `search_path = ''` | migration 3 + pgTAP grant assertion'ları | SECURITY DEFINER zorunlu — kullanıcının `auth.users` yetkisi yok |
| API6 Sensitive Business Flow | APPLICABLE | hesap dondurma ve kalıcı silme | `tests/account-freeze.test.ts` (9 test: rollback, rollback hatası, fail-closed ilk yazma) | — |
| API7 SSRF | APPLICABLE | favicon host doğrulaması, sabit endpoint listesi | A10 ile aynı kanıt | — |
| API8 Security Misconfiguration | APPLICABLE | `anon` grant'ı kaldırıldı, CSP, sabit `search_path` | pgTAP: anon `42501` (sessiz boş sonuç değil); `db lint --linked` Helix şemasında 0 | — |
| API9 Improper Inventory Management | APPLICABLE | tek Supabase projesi; `preview`/`production` channel ayrımı `eas.json`'da | `tests/release-config.test.ts`; `preview` → branch `preview` koşulsuz mapping doğrulandı | Yayımlanmış production store build'i yok |
| API10 Unsafe Consumption of APIs | APPLICABLE | TCMB/Frankfurter/Harem yanıt doğrulaması; abort signal + timeout + boyut sınırı | `tests/external-services.test.ts`: tarihsiz TCMB reddi, geçersiz Frankfurter reddi, quote şekil/tazelik kontratı (7 invariant mutasyon kanıtlı) | Harem feed'i resmî SLA'sız — 60 sn sonrası canlı sayılmıyor |

### OWASP ASVS (L1 hedefi)

Tek kullanıcılı, kendi sunucusu olmayan bir istemci olduğu için V-bölümleri
uygulanabilirliğe göre değerlendirildi.

| Bölüm | Durum | Kanıt / gerekçe |
|---|---|---|
| V1 Architecture | APPLICABLE | `docs/ARCHITECTURE.md` bağımlılık yönü + güven sınırları tablosu (bu belgenin başı) |
| V2 Authentication | APPLICABLE | Supabase Auth; `tests/auth.test.ts`; şifre gücü form doğrulamasında (plan sınırı: leaked-password kontrolü Free plan'de yok) |
| V3 Session Management | APPLICABLE | SecureStore + session epoch; `tests/session-epoch.test.ts`, `tests/session-task.test.ts` |
| V4 Access Control | APPLICABLE | RLS; 33 assertion’lı linked pgTAP |
| V5 Validation / Encoding | APPLICABLE | `route-params`, `backup-validation`, `spreadsheet-import`, `csvCell`; Semgrep 0 |
| V6 Stored Cryptography | **DEVICE/BINARY ONLY** | `NSFileProtectionComplete` yalnız yerel `npx expo run:ios --device` build'inde etkinleşir; doğrulaması cihazda yapılır |
| V7 Error Handling & Logging | APPLICABLE | `tests/diagnostics.test.ts`, `tests/privacy.test.ts`, `tests/undo-outcome.test.ts` (yanıltıcı başarı yok) |
| V8 Data Protection | APPLICABLE | `PrivacyCover`, `tests/privacy.test.ts`; export açık metin olarak beyan ediliyor |
| V9 Communications | APPLICABLE | yalnız HTTPS/WSS; CSP `connect-src` beyaz listesi |
| V10 Malicious Code | APPLICABLE | Gitleaks 0; Semgrep 0; CodeQL 0; install-script envanteri (2 paket, ağ erişimi yok) |
| V11 Business Logic | APPLICABLE | `tests/account-freeze.test.ts`, `tests/repository-contract.test.ts`, `tests/balance.test.ts` (Excel golden) |
| V12 Files & Resources | APPLICABLE | ZIP preflight, satır/hücre/metin tavanları; `tests/spreadsheet-import.test.ts` |
| V13 API | APPLICABLE | API Security tablosu |
| V14 Configuration | APPLICABLE | `tests/release-config.test.ts`; `.env.example` yalnız `EXPO_PUBLIC_*` |

### OWASP MASVS ve seçilmiş MASTG kontrolleri

| Kategori | Durum | Kanıt / gerekçe |
|---|---|---|
| MASVS-STORAGE | APPLICABLE + kısmen DEVICE/BINARY ONLY | Finansal veri SQLite'ta; secret yok. `MASTG-TEST-0052` (hassas veri yerel depoda): `tests/privacy.test.ts` `kv.set` anahtarlarını `helix.*` literal/sabitiyle sınırlıyor ve `token|password|secret|credential|jwt` desenini reddediyor. `NSFileProtectionComplete` doğrulaması cihaz ister |
| MASVS-CRYPTO | APPLICABLE | Uygulama kendi kripto ilkelini yazmıyor; `expo-crypto` + `uuidv7`. Semgrep `p/secrets` 0. `MASTG-TEST-0061` (zayıf rastgelelik): id üretimi `uuidv7`, `Math.random` finansal/kimlik yolunda kullanılmıyor |
| MASVS-AUTH | APPLICABLE + DEVICE/BINARY ONLY | `expo-local-authentication` biyometrik app lock; oturum yaşam döngüsü test edilmiş. Biyometrik akışın kendisi cihazda kabul edilecek |
| MASVS-NETWORK | APPLICABLE | Yalnız TLS/WSS; sabit endpoint listesi; clear-text yapılandırma yok. `MASTG-TEST-0021`: `app.json` içinde `usesCleartextTraffic`/ATS istisnası **yok** |
| MASVS-PLATFORM | APPLICABLE + DEVICE/BINARY ONLY | `PrivacyCover` (`tests/privacy.test.ts`), bildirim izni boot'ta istenmiyor, deep link şeması `helix://`. `MASTG-TEST-0027` (app-switcher snapshot) OS zamanlaması gerektirdiği için cihazda |
| MASVS-CODE | APPLICABLE | Bağımlılık envanteri/SBOM; advisory dispozisyonları; SHA-pinli Action'lar; `npm ci` reproduktibl |
| MASVS-RESILIENCE | **N/A — gerekçeli** | Anti-tamper, obfuscation, root/jailbreak tespiti ve emülatör tespiti bilinçli olarak yok. Helix tek kullanıcılık kendi finansal verisini tutar; koruduğu sır cihaz sahibinin kendi verisidir, o yüzden cihaz sahibine karşı bir savunma modeli anlamsızdır. DRM/lisans zorlaması da yoktur |

### Kapsam dışı bırakılan araçlar

| Araç | Durum |
|---|---|
| SonarQube / SonarCloud | **N/A — kullanıcı tarafından açıkça kapsam dışı bırakıldı.** Yerine `tsc`, sıfır-uyarı ESLint, Knip, Madge, Jscpd ve Semgrep koşuyor |
| OWASP ZAP | **N/A — kullanıcı tarafından açıkça kapsam dışı bırakıldı.** CSP, source map yokluğu, service worker ve route davranışı statik export üzerinde elle doğrulandı |
| MobSF | **N/A — kullanıcı tarafından açıkça kapsam dışı bırakıldı.** Kaynak seviyesi MASVS kontrolleri yukarıda tamamlandı; binary-only kontroller cihaz matrisinde |

### Değerlendirilmiş bağımlılık advisory'leri

| Advisory | Paket | Yol | Sınıf | Bundle'da? | Karar |
|---|---|---|---|---|---|
| GHSA-67mh-4wv8-2f99 | `esbuild@0.18.20` | `drizzle-kit` → `@esbuild-kit/esm-loader` → `core-utils` → `esbuild` | devDependency | **hayır (0 dosya)** | **NOT REACHABLE — RETAINED.** `esbuild serve` gerektiriyor; drizzle-kit yalnız config transpile ediyor. Önerilen düzeltme `drizzle-kit@0.18.1` major downgrade'i |
| GHSA-4r6h-8v6p-xvw6 (CVE-2023-30533) | `xlsx@0.20.3` | doğrudan (SheetJS CDN) | production | evet | **NOT AFFECTED.** Satıcı bildirimi: "0.19.2'ye kadar tüm sürümler", düzeltme **0.19.3**. Kurulu 0.20.3 |
| GHSA-5pgg-2g8v-p4x9 (CVE-2024-22363) | `xlsx@0.20.3` | doğrudan (SheetJS CDN) | production | evet | **NOT AFFECTED.** Satıcı bildirimi: "0.20.1'e kadar tüm sürümler", düzeltme **0.20.2**. Kurulu 0.20.3 |

**OSV'nin xlsx satırlarını neden kalıcı olarak "affected" göstereceği:** SheetJS
npm yayınını **0.18.5**'te bıraktı; bütün düzeltmeler yalnız CDN'de. GitHub
advisory veritabanı npm paketini izlediği için kayıtların SEMVER aralığı
`introduced: 0` ile açık uçlu kalıyor ve `fixed` olayı hiç yazılamıyor — bu
yüzden **her** sürüm eşleşiyor. Otoriter alan `last_known_affected_version_range`
(`< 0.19.3` ve `< 0.20.2`) ve satıcının kendi advisory sayfalarıdır. Bu satırlar
scanner'ı susturmak için sürüm düşürülerek "çözülmemelidir".

## Açık bildirme (vulnerability reporting)

Güvenlik açığı public issue'ya yazılmaz. Maintainer'a
[GitHub üzerinden](https://github.com/topraksv) özel olarak ulaşın. Bildirime
ham finansal veri, yedek dosyası, token, şifre veya ekran görüntüsündeki gerçek
hesap verisi eklenmemelidir; yeniden üretim adımı ve etkilenen sürüm yeterlidir.
Bu tek geliştiricili bir projedir; taahhüt edilmiş bir SLA yoktur.
