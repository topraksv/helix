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
| `CDX-ARCH-01` | P2 | P4 | NOT STARTED | Live query loading/error/stale durumunu boş array ile karıştırıyor | Son iyi veriyi koruyan typed status/error; loading, stale, retry ve recovery testleri |
| `CDX-ARCH-02` | P3 | P4 | NOT STARTED | Dashboard query/aggregate/confirmation/render tek componentte | Saf `buildDashboardModel`; mevcut finansal sonuçlarla golden parity testi |
| `CDX-ARCH-03` | P3 | P4 | NOT STARTED | Cash-flow matrix model, orientation ve navigation iç içe | Saf matrix model + ince orientation adapters; mevcut tablo parity ve 320/desktop testleri |
| `CDX-ARCH-04` | P2 | P4 | NOT STARTED | Root layout auth/lock/maintenance/market/guard effectleri tek orchestration’da | Ayrı lifecycle/maintenance hooks ve saf guard state machine; account-switch/cleanup testleri |
| `CDX-ARCH-05` | P2 | P4 | NOT STARTED | Import SQL snapshot, mapping ve write planı tek I/O fonksiyonunda | Saf import planner + tek atomik commit; mevcut fixture parity ve invalid inputte sıfır write |
| `HLX-06` | P3 | P3 | NOT STARTED | `noUncheckedIndexedAccess` kapalı | Compiler flag açık; tüm kaynak typecheck, riskli indeksler explicit guardlı |
| `CDX-DB-01` | P2 | P3 | NOT STARTED | Own-data ilişkileri ve cross-kind kuralları remote DB’de yalnız client tarafından korunuyor | Sync sırasını bozmayan owner-aware constraint/validator; corruption fixture reddedilir |
| `HLX-04` | P3 | P3 | NOT STARTED | RLS policy’leri doğrudan `auth.uid()` çağırıyor ve role scope açık değil | `(select auth.uid())`, `TO authenticated`; linked lint ve iki-kullanıcı izolasyon testi |

## Release, supply chain ve gözlemlenebilirlik

| ID / eşleşme | P | Paket | Durum | Sorun | Çözüm ve kabul ölçütü |
|---|---:|---:|---|---|---|
| `HLX-01` · `CDX-DEVOPS-03` | P1 | P2 | IN PROGRESS | `main` deploy’unda typecheck/test/lint kapısı ve branch protection yok | `quality` job typecheck/test/lint/export sonrası Pages artefact’ı üretiyor; required-check branch protection commit sonrası remote’da etkinleştirilecek |
| `HLX-07` · `CDX-TEST-02` | P2 | P7 | NOT STARTED | Dokümante kalıcı Playwright smoke repoda yok | Static export üzerinde auth/deep-link/protected local flow; CI’da release-blocking |
| `HLX-11` · `CDX-DEVOPS-01` | P1 | P2 | RESOLVED | EAS branch var, channel/build header sözleşmesi yok | Remote `preview` channel→branch doğrulandı; CNG header + EAS profile eklendi; Android placeholder ID `com.toprak.helix` oldu. Native rebuild/iki-cold-start kabulü henüz `VERIFIED` değil |
| `CDX-DEVOPS-02` · `CDX-PRODUCT-08` | P2 | P4 | NOT STARTED | Prod crash/sync/dead-letter ve incident kanıtı görünmüyor | PII’siz local diagnostics ekranı/export; update ID, queue age/count, dead-letter ve son hata görünür |
| `HLX-13A` | P3 | P2 | RESOLVED | GitHub Actions tag ref kullanıyor | Bütün third-party actions doğrulanmış 40-haneli commit SHA’larına pinli; npm + Actions haftalık Dependabot politikası eklendi ve config testi ref’leri koruyor |
| `HLX-13F` | P2 | P2 | IN PROGRESS | Secret scanning/push protection/Dependabot security updates kapalı | Repo config hazır; secret scanning, push protection ve Dependabot security updates commit sonrası remote’da açılıp API’den okunacak |
| `HLX-13E` | P3 | P4 | NOT STARTED | Harem market feed’i resmî/SLA’lı değil | Kaynak etiketi, sessizlik/stale davranışı, fallback/health; yanlış “canlı” iddiası yok |
| `HLX-13B` | P3 | P7 | RESOLVED | Supabase client patch güncelliği | `@supabase/supabase-js` 2.110.0 denetimde güncel doğrulandı; final dependency check tekrar koşacak |
| `HLX-13D` | P4 | P7 | RESOLVED | Boş catch’ler hata yutuyor olabilir | Denetimde uygulama catch’lerinin çoğu kasıtlı fallback/cleanup; final source scan ve lint tekrar koşacak |

## Performans ve ölçek

| ID / eşleşme | P | Paket | Durum | Sorun | Çözüm ve kabul ölçütü |
|---|---:|---:|---|---|---|
| `HLX-08` · `CDX-PERF-03` | P2 | P4 | NOT STARTED | Backup/restore 100k satırı tek array/string/write planında tutuyor | Ölçülmüş peak-memory bütçesi; chunk/stream planı veya güvenli daha düşük limit; round-trip parity |
| `CDX-PERF-04` | P1 | P4 | NOT STARTED | XLSX mantıksal hücre limitleri `XLSX.read` sonrasında; zip-bomb riski | Daha sıkı byte/complexity limiti, worker/timeout fizibilitesi ve hostile workbook testi |
| `CDX-PERF-01` | P2 | P4 | NOT STARTED | Ledger her değişimde tüm transaction geçmişini tarıyor | 1k/10k/100k benchmark; ölçüme göre bounded query/incremental model; sonuç parity |
| `CDX-PERF-02` | P3 | P4 | NOT STARTED | Dashboard/analytics aynı diziyi çok kez tarıyor | Saf tek-pass aggregate yalnız benchmark kazanımı gösterirse; mikro-optimizasyon yapılmaz |
| `CDX-PERF-05` | P3 | P4 | NOT STARTED | Uzun transaction listelerinde virtualization yok | 500/2k profiling; kullanıcı etkisi varsa virtualized list, yoksa ölçümle “korunmalı” kararı |
| `CDX-PERF-06` | P3 | P4 | NOT STARTED | Bundle/brand asset bütçesi yok | Web/OTA asset raporu; kalite kaybetmeden gereksiz byte temizliği ve regression bütçesi |

## UI, UX, erişilebilirlik ve gizlilik

| ID / eşleşme | P | Paket | Durum | Sorun | Çözüm ve kabul ölçütü |
|---|---:|---:|---|---|---|
| `HLX-02` · `CDX-A11Y-01` | P2 | P5 | NOT STARTED | Shared form/chart/icon/modal semantics, focus ve announcements eksik | Label/role/state/hint, heading, chart özeti, modal focus restore, live error/loading; a11y tests + manual checklist |
| `HLX-03` · `CDX-A11Y-02` | P2 | P5 | NOT STARTED | Primary ve semantic foreground kontrastları WCAG AA altında | Role-based foreground token; light/dark tüm token çiftleri otomatik ≥4.5:1 (large text istisnası açık) |
| `CDX-UX-01` | P2 | P5 | NOT STARTED | 320px cash-flow ve late-payment action satırları sıkışıyor | Primary CTA + overflow/stacked layout; 320/390/768/1440 overflow testleri |
| `CDX-UX-02` · `CDX-PRODUCT-03` | P2 | P5/P6 | NOT STARTED | Onboarding ağır; dirty form geri dönüşte sessiz veri kaybediyor | Ortak dirty-exit guard/draft; P6’da hızlı başlangıç; navigation tests |
| `HLX-12` · `CDX-SEC-02` · `CDX-PRODUCT-04` | P2 | P5 | NOT STARTED | Notification lock-screen metni ad/tutar gösterebilir | Device-local opt-in detail preference; varsayılan nötr body; sign-out cleanup testleri |
| `CDX-SEC-01` | P2 | P5 | NOT STARTED | App switcher snapshot privacy cover yok; Pages frame header sınırlı | Native `inactive` overlay; web mümkünse header, değilse sensitive re-auth + dokümante residual |
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
| `CDX-TEST-06` | P1 | P3 | NOT STARTED | İki-user RLS izolasyon testi yok | A kendi CRUD; B read/update/delete/owner change reddedilir; anon sıfır row |
| `CDX-TEST-07` | P1 | P7 | NOT STARTED | Core kalıcı E2E yok | Onboarding→transaction→table→edit/delete/undo→backup smoke |
| `CDX-TEST-08` | P1 | P4/P7 | NOT STARTED | Account-switch late task integration testi eksik | A response’u B sessionında hiçbir write yapmaz |
| `CDX-TEST-09` | P1 | P4/P7 | NOT STARTED | Backup temiz DB round-trip integration testi eksik | 15 tablo ve ilişkiler 1:1, invalid bundle sıfır write |
| `CDX-TEST-10` | P1 | P7 | NOT STARTED | Offline→relaunch→online sync kalıcı testi eksik | Tekil veri korunur, queue boşalır, duplicate yok |
| `CDX-TEST-11` | P2 | P5/P7 | NOT STARTED | Form invalid/loading/error/dirty/password-manager tests yok | Her kritik form state’i ve accessible error beklenen davranışta |
| `CDX-TEST-12` | P2 | P5/P7 | NOT STARTED | Automated + cihaz a11y matrisi yok | Semantics/contrast/keyboard automated; VoiceOver/TalkBack checklist |
| `CDX-TEST-13` | P1 | P4/P7 | NOT STARTED | Hostile workbook/büyük backup stress testi yok | Süre/bellek bütçesi aşılmaz ve veri yazılmaz |
| `CDX-TEST-14` | P2 | P7 | NOT STARTED | Locale/timezone/DST matrisi eksik | TR comma, Istanbul/UTC, DST, leap ve ay sınırları CI’da |
| `CDX-TEST-15` | P2 | P5/P7 | NOT STARTED | Notification consent/privacy/64-cap cihaz testi eksik | Default neutral, opt-in detail, sign-out clears, cap korunur |
| `CDX-TEST-16` | P2 | P5/P7 | NOT STARTED | 320/390/768/1440 light/dark visual regression yok | Screenshot diff bütçesi ve no-overflow assertions |
| `CDX-TEST-17` | P2 | P4/P7 | NOT STARTED | 1k/10k/100k performance bütçesi yok | Benchmark artefact ve regression eşikleri |
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
| P2 | Hazırlanıyor | Local `quality` eşdeğeri + 49-route export başarılı | Remote ayarlar/yayın bekliyor | IN PROGRESS |
| P3 | — | — | — | NOT STARTED |
| P4 | — | — | — | NOT STARTED |
| P5 | — | — | — | NOT STARTED |
| P6 | — | — | — | NOT STARTED |
| P7 | — | — | — | NOT STARTED |
