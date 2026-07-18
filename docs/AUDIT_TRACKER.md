# Helix denetim uygulama takipçisi

Bu dosya, 17 Temmuz 2026 tarihli
[`HELIX_CODEX_AUDIT_2026-07-17.md`](HELIX_CODEX_AUDIT_2026-07-17.md)
raporundan çıkan bütün eylemlerin tek doğruluk kaynağıdır. Aynı kök nedene ait
Claude ve Codex kimlikleri tek satırda eşlenir; hiçbir madde yalnızca başka bir
satıra atıf verilmeden kapatılamaz.

## Durum sözleşmesi

| Durum | Anlamı |
|---|---|
| `NOT STARTED` | Kapsamda, henüz uygulanmadı |
| `IN PROGRESS` | Aktif pakette uygulanıyor; commit/deploy tamamlanmadı |
| `RESOLVED` | Kod/config/doküman ve otomatik kabul testleri tamamlandı |
| `VERIFIED` | `RESOLVED` üzerine ilgili remote/runtime doğrulaması da tamamlandı |
| `BACKLOG` | Kullanıcının açıkça ertelediği “şimdi yapılmamalı” veya Expo SDK 54 kaynaklı iş |
| `BLOCKED` | Kodla kapatılamayan dış bağımlılık var; neden ve sonraki adım zorunlu |

Bir iş ancak kabul ölçütü çalıştırılarak `RESOLVED`; gerçek cihaz/remote isteyen
bir iş yalnız o doğrulama da yapılırsa `VERIFIED` olur. Commit ve yayın bilgisi
her paket bölümünün altındaki release kaydına eklenir.

## Paketler

| Paket | Birlikte kapanan işler | Yayın |
|---|---|---|
| P0 · Kayıt ve kapsam | Rapor, bu tracker, backlog sınırı | GitHub `main`; uygulama OTA yok |
| P1 · Veri bütünlüğü | Outbox doğrulama, mutation idempotency, recurring-income category | Web + `preview` OTA |
| P2 · CI ve release | Quality gate, branch protection, EAS channel/native sözleşme, rollback | GitHub + EAS remote |
| P3 · DB ve tip sınırı | RLS optimizasyonu, DB integrity, generated types, unchecked index | Supabase migration + web/OTA |
| P4 · Mimari, performans, diagnostics | Live-query state, lifecycle/view-model/import plan, ölçümlü ölçek | Web + OTA |
| P5 · UI/UX/a11y/privacy | Shared semantics, contrast, mobile layout, dirty form, notification privacy | Web + OTA |
| P6 · Ürün ve IA | Arama, sync health, onboarding, bütçe, haftalık gelir, takvim, özellik keşfi | Web + OTA |
| P7 · Test, README ve kapanış | Kalıcı E2E/integration/a11y/perf, README, privacy/release dokümanı | Web + OTA gerekiyorsa |

## Güvenlik, veri bütünlüğü ve kod

| ID / eşleşme | P | Paket | Durum | Sorun | Çözüm ve kabul ölçütü |
|---|---:|---:|---|---|---|
| `HLX-05` · `CDX-CODE-04` | P1 | P1 | RESOLVED | `toRemote()` içindeki korumasız JSONB parse poison outbox satırını sonsuz retry’a sokabilir | Table-aware validator bozuk iç JSON/numeric/unknown-column payload’ını `invalid_row` dead-letter’a ayırıyor; aynı batch’teki sağlıklı row devam ediyor (`sync-outbound.test.ts`) |
| `CDX-CODE-01` · `CDX-CODE-03` | P1 | P1 | RESOLVED | Async form submitleri render’dan önce ikinci dokunmayı engellemiyor | Ortak senkron `useOperationGuard`; finansal create repository’lerinde operation ID/deterministik child ID; aynı tick iki çağrı tek callback (`operation-guard.test.ts`) |
| `CDX-CODE-02` | P2 | P1 | RESOLVED | Recurring income canlı income category doğrulamıyor | Repo sınırı null, silinmiş/foreign ve expense category’yi reddediyor; yalnız owner’ın canlı income category’sini kabul ediyor (`recurring-income-guard.test.ts`) |
| `CDX-ARCH-01` | P2 | P4 | RESOLVED | Live query loading/error/stale durumunu boş array ile karıştırıyor | Typed snapshot + last-good-data + retry eklendi; dashboard/Mali Tablo gerçek empty ile hata/loading’i ayırıyor; transition testleri yeşil |
| `CDX-ARCH-02` | P3 | P4 | RESOLVED | Dashboard query/aggregate/confirmation/render tek componentte | Saf tek-geçişli `buildDashboardModel`; forecast/distribution/fixed-variable golden parity ve 100k bütçesi yeşil |
| `CDX-ARCH-03` | P3 | P4 | RESOLVED | Cash-flow matrix model, orientation ve navigation iç içe | Saf matrix model + orientation adapterları; category/computed/system/missing-category parity ve 100k kredi-kartı split bütçesi yeşil. Görsel viewport matrisi P5/P7’de ayrıca korunacak |
| `CDX-ARCH-04` | P2 | P4 | RESOLVED | Root layout auth/lock/maintenance/market/guard effectleri tek orchestration’da | Biometric/maintenance/market hook’ları ve saf route guard ayrıldı; initial guard-query failure korumalı ekranı açmıyor; guard ve late-session testleri yeşil |
| `CDX-ARCH-05` | P2 | P4 | RESOLVED | Import SQL snapshot, mapping ve write planı tek I/O fonksiyonunda | Saf, lazy spreadsheet planı SQL/write’tan ayrıldı; category/year/breakdown/note parity testi ve tek atomik commit korundu |
| `HLX-06` | P3 | P3 | RESOLVED | `noUncheckedIndexedAccess` kapalı | Flag kalıcı açık; source + test indeksleri runtime guard/helper ile explicit; typecheck ve generated remote `Database` istemci tipi temiz |
| `CDX-DB-01` | P2 | P3 | VERIFIED | Own-data ilişkileri ve cross-kind kuralları remote DB’de yalnız client tarafından korunuyor | Remote migration 6: 19 owner-aware FK doğrulandı, category/polymorphic ref triggerları aktif, legacy 121 refund nakit etkisi korunarak kanonikleşti; son aggregate mismatch `0`; `database.types.ts` linked şemadan üretildi |
| `HLX-04` | P3 | P3 | VERIFIED | RLS policy’leri doğrudan `auth.uid()` çağırıyor ve role scope açık değil | Remote 60/60 policy `TO authenticated` ve init-plan `(select auth.uid())`; linked migration 1–6 eşit, DB lint sıfır hata |

## Release, supply chain ve gözlemlenebilirlik

| ID / eşleşme | P | Paket | Durum | Sorun | Çözüm ve kabul ölçütü |
|---|---:|---:|---|---|---|
| `HLX-01` · `CDX-DEVOPS-03` | P1 | P2 | VERIFIED | `main` deploy’unda typecheck/test/lint kapısı ve branch protection yok | Remote `main`: PR + strict `quality` + admin enforcement; force-push/delete kapalı. Pages run `29637115841` quality→deploy zinciri başarılı; Dependabot PR #2 aynı kapıdan geçti |
| `HLX-07` · `CDX-TEST-02` | P2 | P7 | NOT STARTED | Dokümante kalıcı Playwright smoke repoda yok | Static export üzerinde auth/deep-link/protected local flow; CI’da release-blocking |
| `HLX-11` · `CDX-DEVOPS-01` | P1 | P2 | RESOLVED | EAS branch var, channel/build header sözleşmesi yok | Remote `preview` channel→branch doğrulandı; CNG header + EAS profile eklendi; Android placeholder ID `com.toprak.helix` oldu. Native rebuild/iki-cold-start kabulü henüz `VERIFIED` değil |
| `CDX-DEVOPS-02` · `CDX-PRODUCT-08` | P2 | P4 | RESOLVED | Prod crash/sync/dead-letter ve incident kanıtı görünmüyor | PII’siz local diagnostics ekranı/export; update/runtime/channel, queue age/count, dead-letter dağılımı, migration ve bounded redacted event ring görünür; redaction testi yeşil |
| `HLX-13A` | P3 | P2 | RESOLVED | GitHub Actions tag ref kullanıyor | Bütün third-party actions doğrulanmış 40-haneli commit SHA’larına pinli; npm + Actions haftalık Dependabot politikası eklendi ve config testi ref’leri koruyor |
| `HLX-13F` | P2 | P2 | VERIFIED | Secret scanning/push protection/Dependabot security updates kapalı | GitHub API’den secret scanning, push protection ve Dependabot security updates `enabled` geri okundu; SDK 57 PR #3 `BACKLOG-SDK-01` gerekçesiyle kapatıldı |
| `HLX-13E` | P3 | P4 | RESOLVED | Harem market feed’i resmî/SLA’lı değil | Kamusal/resmî SLA’sız kaynak açık; live/reconnecting/unavailable ayrımı ve TCMB fallback metni var; 60 sn sessizlik ve stale-quote testleri yeşil |
| `HLX-13B` | P3 | P7 | RESOLVED | Supabase client patch güncelliği | `@supabase/supabase-js` 2.110.0 denetimde güncel doğrulandı; final dependency check tekrar koşacak |
| `HLX-13D` | P4 | P7 | RESOLVED | Boş catch’ler hata yutuyor olabilir | Denetimde uygulama catch’lerinin çoğu kasıtlı fallback/cleanup; final source scan ve lint tekrar koşacak |

## Performans ve ölçek

| ID / eşleşme | P | Paket | Durum | Sorun | Çözüm ve kabul ölçütü |
|---|---:|---:|---|---|---|
| `HLX-08` · `CDX-PERF-03` | P2 | P4 | RESOLVED | Backup/restore 100k satırı tek array/string/write planında tutuyor | Export tablo-tabla bounded builder kullanıyor; restore 400-row batch’leri tek transaction’da tüketiyor; 15 tablo envelope parity ve >100k erken reddetme testleri var. Gerçek SQLite clean-DB round-trip P7’de |
| `CDX-PERF-04` | P1 | P4 | RESOLVED | XLSX mantıksal hücre limitleri `XLSX.read` sonrasında; zip-bomb riski | SheetJS öncesi ZIP entry/64 MB açılmış boyut/32 MB entry/200× oran preflight; XLSX lazy chunk; hostile ZIP testi yazmadan reddediyor |
| `CDX-PERF-01` | P2 | P4 | RESOLVED | Ledger her değişimde tüm transaction geçmişini tarıyor | 1k/10k/100k benchmark lineer O(T+M) modeli bütçe içinde doğruladı; gereksiz model migration’ı yapılmadı, ikinci `currentBalance` taraması normal yoldan kaldırıldı |
| `CDX-PERF-02` | P3 | P4 | RESOLVED | Dashboard/analytics aynı diziyi çok kez tarıyor | Forecast+distribution+fixed-variable tek saf geçişte; cash-flow kredi-kartı split’i 12 taramadan bire indi; golden parity ve 100k eşikleri yeşil |
| `CDX-PERF-05` | P3 | P4 | RESOLVED | Uzun transaction listelerinde virtualization yok | Parent ScrollView ile çakışan nested virtual list yerine ilk 80 + 80’lik progressive rendering; 500/2k bounded testleri yeşil |
| `CDX-PERF-06` | P3 | P4 | RESOLVED | Bundle/brand asset bütçesi yok | Ölçüm: entry 5.07→4.60 MB, XLSX ayrı 493 KB lazy chunk, font 36→8, export ~15→9.48 MB; CI entry/JS/font/export bütçesi eklendi |

## UI, UX, erişilebilirlik ve gizlilik

| ID / eşleşme | P | Paket | Durum | Sorun | Çözüm ve kabul ölçütü |
|---|---:|---:|---|---|---|
| `HLX-02` · `CDX-A11Y-01` | P2 | P5 | RESOLVED | Shared form/chart/icon/modal semantics, focus ve announcements eksik | Shared field/control role-state-hint, heading, chart tam değer özeti, modal focus/return ve live error/loading eklendi; source contract testleri yeşil. Fiziksel VoiceOver/TalkBack kabulü `CDX-TEST-12` ile P7’de |
| `HLX-03` · `CDX-A11Y-02` | P2 | P5 | RESOLVED | Primary ve semantic foreground kontrastları WCAG AA altında | Accent/fill ile `*Text`/`on*` rolleri ayrıldı; light/dark body çiftleri ≥4.5:1, control/focus sınırları ≥3:1 otomatik testte |
| `CDX-UX-01` | P2 | P5 | RESOLVED | 320px cash-flow ve late-payment action satırları sıkışıyor | Primary CTA tam genişlik, beş araç dengeli satır, geniş payment aksiyonu <430px’de alt satır; 320/390/768/1440 matematiksel no-overflow testi yeşil |
| `CDX-UX-02` · `CDX-PRODUCT-03` | P2 | P5/P6 | IN PROGRESS | Onboarding ağır; dirty form geri dönüşte sessiz veri kaybediyor | Kritik formlar gerçek snapshot’a dayalı ortak dirty-exit guard kullanıyor ve untouched inline edit prompt vermiyor; P6 hızlı başlangıç/onboarding kaldı |
| `HLX-12` · `CDX-SEC-02` · `CDX-PRODUCT-04` | P2 | P5 | RESOLVED | Notification lock-screen metni ad/tutar gösterebilir | Varsayılan nötr preview, ayrı device-local onay, kapatma/account switch’te fail-closed clear ve en yakın 60 plan; pure+boundary testleri yeşil, cihaz kabulü `CDX-TEST-15`’te |
| `CDX-SEC-01` | P2 | P5 | RESOLVED | App switcher snapshot privacy cover yok; Pages frame header sınırlı | Native inactive/background ve framed web için izole, değersiz privacy modalı var; policy/source testi yeşil. OS snapshot zamanlaması fiziksel cihazda P7’de kesinleşecek |
| `CDX-IA-02` | P3 | P6 | NOT STARTED | Account freeze Settings’in ana seviyesinde dağınık | Account Security altında tek güvenlik grubu; deep link/back parity |
| `CDX-IA-03` | P3 | P6 | NOT STARTED | Dashboard üç analitik kartla Analytics’i tekrar ediyor | Balance/upcoming + tek eylemli insight; tam analiz için belirgin geçiş |
| `CDX-IA-04` | P3 | P6 | NOT STARTED | Var olan JSON/CSV export yeterince keşfedilebilir değil | Veri ve senkron grubunda açık “Dışa aktar / Geri yükle” görev dili |

## Ürün kapsamı

| ID | P | Paket | Durum | Problem / değer | Çözüm ve kabul ölçütü |
|---|---:|---:|---|---|---|
| `CDX-PRODUCT-01` | P2 | P6 | NOT STARTED | Büyüyen işlem geçmişinde kayıt bulmak zor | Metin+tarih+tür+kategori/kaynak filtreleri; sıfır sonuç, temizle ve keyboard erişimi |
| `CDX-PRODUCT-02` · `CDX-IA-01` | P2 | P6 | NOT STARTED | Sync sağlığı yalnız Settings’te ve teknik | Shell seviyesinde sakin durum; pending yaşı/hata varsa eylemli detay, sağlıklıyken gürültü yok |
| `CDX-PRODUCT-05` | P2 | P6 | NOT STARTED | Forecast var ama kullanıcı hedef/variance tanımlayamıyor | Aylık kategori bütçesi, aşım/remaining; para ve sync invariants; CRUD/analytics tests |
| `CDX-PRODUCT-06` | P2 | P6 | NOT STARTED | Haftalık/iki haftalık gelir kuralları modellenemiyor | Recurrence union ve UI; DST/ay sınırı/skip-history tests; backward compatible migration |
| `CDX-PRODUCT-07` | P2 | P6 | NOT STARTED | Expected/card/subscription takvimi ayrı yüzeylerde | Tek upcoming timeline/calendar; kaynağa drill-down ve empty/offline state |

## Test ve dokümantasyon

| ID / eşleşme | P | Paket | Durum | Eksik davranış | Kabul ölçütü |
|---|---:|---:|---|---|---|
| `HLX-09` · `CDX-TEST-01` | P2 | P7 | NOT STARTED | Component/hook/SQLite/RLS/E2E koruması yetersiz | Aşağıdaki release-blocking suite CI’da yeşil |
| `CDX-TEST-03` | P1 | P2/P7 | RESOLVED | OTA channel/runtime/rollback gerçek kabul testi yok | Config regression testi, remote channel/group metadata ve çalıştırılabilir rollback/iki-cold-start checklist tamam; fiziksel cihaz sonucu olmadığı için `VERIFIED` değil |
| `CDX-TEST-04` | P1 | P1 | RESOLVED | Poison outbox regression testi yok | Bozuk JSONB/unknown column/non-finite numeric karantinada; sağlıklı sonraki row push planında kalıyor |
| `CDX-TEST-05` | P1 | P1 | RESOLVED | Duplicate submit testi yok | Aynı tick iki invocation tek operation callback; success/error sonrası guard deterministik serbest |
| `CDX-TEST-06` | P1 | P3 | VERIFIED | İki-user RLS izolasyon testi yok | Remote pgTAP 19/19: A own CRUD, B read/update/delete/owner-change ve cross-owner ref reddi, category/ref corruption reddi, anon sıfır row; `finish(true)` + rollback |
| `CDX-TEST-07` | P1 | P7 | NOT STARTED | Core kalıcı E2E yok | Onboarding→transaction→table→edit/delete/undo→backup smoke |
| `CDX-TEST-08` | P1 | P4/P7 | IN PROGRESS | Account-switch late task integration testi eksik | Saf epoch regression’ında A’nın geç cevabı B epoch’unda `undefined` ve sıfır commit; gerçek SQLite lifecycle entegrasyonu P7’de |
| `CDX-TEST-09` | P1 | P4/P7 | IN PROGRESS | Backup temiz DB round-trip integration testi eksik | 15 tablo export envelope + ilişki validator parity var; gerçek clean SQLite export→restore ve invalidte sıfır write P7’de |
| `CDX-TEST-10` | P1 | P7 | NOT STARTED | Offline→relaunch→online sync kalıcı testi eksik | Tekil veri korunur, queue boşalır, duplicate yok |
| `CDX-TEST-11` | P2 | P5/P7 | IN PROGRESS | Form invalid/loading/error/dirty/password-manager tests yok | Shared error/loading/dirty ve auth metadata contractları var; gerçek component/navigation form matrisi P7’de |
| `CDX-TEST-12` | P2 | P5/P7 | IN PROGRESS | Automated + cihaz a11y matrisi yok | Semantics/contrast/modal/chart/table keyboard contractları yeşil; VoiceOver/TalkBack cihaz checklist’i ortam olmadığı için P7’de |
| `CDX-TEST-13` | P1 | P4/P7 | IN PROGRESS | Hostile workbook/büyük backup stress testi yok | Yüksek sıkıştırma oranlı ZIP SheetJS öncesi, >100k backup iterasyon/yazım öncesi reddediliyor; cihaz heap/invalid-write integration P7’de |
| `CDX-TEST-14` | P2 | P7 | NOT STARTED | Locale/timezone/DST matrisi eksik | TR comma, Istanbul/UTC, DST, leap ve ay sınırları CI’da |
| `CDX-TEST-15` | P2 | P5/P7 | IN PROGRESS | Notification consent/privacy/64-cap cihaz testi eksik | Default neutral/opt-in redaction, stale preference race, sign-out wiring ve 60-cap otomatik; OS notification cihaz testi P7’de |
| `CDX-TEST-16` | P2 | P5/P7 | IN PROGRESS | 320/390/768/1440 light/dark visual regression yok | 320/390/768/1440 no-overflow hesapları ve light/dark token kontrastı yeşil; kalıcı screenshot diff P7’de |
| `CDX-TEST-17` | P2 | P4/P7 | IN PROGRESS | 1k/10k/100k performance bütçesi yok | Kalıcı Vitest benchmark’ı 1k/10k/100k ledger ve 100k dashboard/matrix için 4 sn release eşiği koyuyor; P7 final CI/E2E ile kapanacak |
| `HLX-10` · `CDX-DOC-03` | P4 | P7 | NOT STARTED | Dokümanda sabit test sayısı drift ediyor | Sabit sayı kaldırılır veya otomatik üretilir |
| `HLX-13C` · `CDX-DOC-04` | P2 | P7 | NOT STARTED | Privacy, retention, release/rollback ve third-party feed açıklaması eksik | README/docs’ta kullanıcı ve maintainer bölümleri, gerçek sınırlar |
| `CDX-DOC-01` | P2 | P7 | NOT STARTED | README doğru ama uzun/teknik ve görsel olarak sönük | Türkçe/İngilizce dengeli hero, görev odaklı akış, gerçek rozet/görsel, kolay taranır yapı |
| `CDX-DOC-02` | P3 | P7 | NOT STARTED | Mermaid kullanıcıya ürün davranışını anlatmıyor | “Cihazda çalışır → güvenle sıraya alır → bağlanınca hesabına sync” dili; teknik terimler ikinci katman |

## Açıkça ertelenen backlog

| ID | Durum | Neden / tekrar değerlendirme tetikleyicisi |
|---|---|---|
| `BACKLOG-SDK-01` | BACKLOG | Expo SDK 54 zincirindeki 17 moderate advisory; user yeni SDK istediğinde ve installed build hattı SDK 57’ye geçebildiğinde |
| `BACKLOG-TECH-01` | BACKLOG | Expo/Supabase/PostgreSQL/SQLite/Drizzle/Zustand değişimi; mevcut teknolojiler kanıtlı kök neden değil |
| `BACKLOG-PRODUCT-01` | BACKLOG | Calculator tab’ını kaldırma/taşıma; gerçek kullanım metriği olmadan IA değişmeyecek |
| `BACKLOG-PRODUCT-02` | BACKLOG | Banka entegrasyonu, server push, widget ve çoklu kullanıcı; çekirdek kalite tamamlanıp talep doğrulanınca |
| `BACKLOG-ARCH-01` | BACKLOG | CQRS, event sourcing, DI container, microservice; kişisel local-first ürün için kanıtsız karmaşıklık |

## Paket release kaydı

| Paket | Commit | Web | OTA / remote | Sonuç |
|---|---|---|---|---|
| P0 | `f6009a5` | [Pages run 29636105664](https://github.com/topraksv/helix/actions/runs/29636105664) başarılı | Gerekmez | VERIFIED |
| P1 | `f8f536e` | [Pages run 29636759953](https://github.com/topraksv/helix/actions/runs/29636759953) başarılı | [EAS group df604f34](https://expo.dev/accounts/topraksv/projects/helix/updates/df604f34-b0e7-46b0-a190-b0cfe5e52e7a), runtime `1.0.0`; install henüz `0` | RESOLVED |
| P2 | `28ef0a6`, `886daa8` | [quality→Pages run 29637115841](https://github.com/topraksv/helix/actions/runs/29637115841) başarılı | `preview` channel→branch remote doğrulandı; native rebuild gerekli, OTA bilerek yok | RESOLVED |
| P3 | `8776f70`, `fa2988e`, `b2bd29a` | [quality→Pages run 29638482754](https://github.com/topraksv/helix/actions/runs/29638482754) başarılı | migration 6 + 19 pgTAP verified; [EAS group fb85064c](https://expo.dev/accounts/topraksv/projects/helix/updates/fb85064c-5fd9-4644-b547-129562a232e5), runtime `1.0.0`, install henüz `0` | RESOLVED |
| P4 | `775cf9e` | [quality→Pages run 29640137815](https://github.com/topraksv/helix/actions/runs/29640137815) başarılı; canlı root/diagnostics 200 | [EAS group 57ded800](https://expo.dev/accounts/topraksv/projects/helix/updates/57ded800-43bf-444f-abf8-780d67eddd27), runtime `1.0.0`; install henüz `0` | RESOLVED |
| P5 | `e04fc39` | [quality→Pages run 29642316030](https://github.com/topraksv/helix/actions/runs/29642316030) başarılı; canlı root/settings 200 | [EAS group 6eaac67f](https://expo.dev/accounts/topraksv/projects/helix/updates/6eaac67f-9986-426a-ba39-951a49dc5489), runtime `1.0.0`; ilk insights 0 install/user | RESOLVED |
| P6 | — | — | — | NOT STARTED |
| P7 | — | — | — | NOT STARTED |
