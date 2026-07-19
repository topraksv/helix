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
| P4 · Mimari, performans, gözlemlenebilirlik | Live-query state, lifecycle/view-model/import plan, ölçümlü ölçek | Web + OTA |
| P5 · UI/UX/a11y/privacy | Shared semantics, contrast, mobile layout, dirty form, notification privacy | Web + OTA |
| P6 · Ürün ve IA | Arama, kullanıcı odaklı sync geri bildirimi, onboarding, bütçe, haftalık gelir, takvim, özellik keşfi | Web + OTA |
| P7 · Test, README ve kapanış | Kalıcı E2E/integration/a11y/perf, README, privacy/release dokümanı | Web + OTA gerekiyorsa |
| P8 · Follow-up sadelik ve UX | Atıl kod, görsel sistem, yaklaşanlar, analiz, bakiye geçmişi, ay sonu | Web + `preview` OTA |
| P9 · Follow-up runtime güvenilirliği | Harem yaşam döngüsü, çok cihazlı sync, geri/jest ve Face ID autofill | Web + `preview` OTA |
| P10 · Follow-up kapanış | Denetim yeniden teyidi, E2E/görsel/remote kanıt ve doküman | GitHub + EAS remote |
| P11 · Sadelik ve UI regresyonu | Atıl API/dependency/asset temizliği, Claude paleti, geri kontrolü, dashboard tahmin/grafik/navigasyon | Web + `preview` OTA |

## 18 Temmuz kullanıcı geri bildirimi

| ID | P | Paket | Durum | Sorun | Kabul ölçütü |
|---|---:|---:|---|---|---|
| `CDX-VERIFY-01` | P1 | P10 | RESOLVED | 17 Temmuz denetimindeki kapanışların güncel uygulamayla yeniden teyidi gerekli | Audit §12, bütün ID'leri code/test/runtime/remote kanıtıyla yeniden sınıflandırdı; cihaz/iki-client sınırları `BLOCKED`, Expo 54 kapsamı `BACKLOG`, diğer aktif işler kapalı |
| `CDX-CODE-07` | P2 | P8 | RESOLVED | Son paketler gereksiz route, export ve tekrar üretmiş olabilir | Kullanılmayan diagnostics route/domain/testi, outbox hook’u ve gradient bağımlılığı silindi; import/TS unused taraması temiz; net kaynak küçüldü ve tam suite korunuyor |
| `CDX-UI-04` | P2 | P8 | VERIFIED | Hero, turuncu dolgular, toggle ve input sınırları iki temada fazla sert | Tonal yüzeyler ve nötr primary action ortak primitive/token’da; 21 adet 320–1440 açık/koyu gerçek Chromium baseline’ı ve kontrast testleri |
| `CDX-UX-04` | P1 | P8 | VERIFIED | Yaklaşan ödeme eylemi metinden kopup alt satıra düşüyor, metin daralmıyor | Kopya esnek metin kolonunda sarıyor, eylem 88px sağ slotta kalıyor; uzun başlıklı 320px browser akışı yatay taşmadan geçti |
| `CDX-MARKET-01` | P1 | P9 | VERIFIED | Harem bağlantısı kısa lifecycle cleanup sonrası yeniden açılıp 429'a düşebiliyor; UI teknik metin gösteriyor | Tek socket, 5sn lifecycle grace ve bounded jitter backoff; gerçek Chromium’da beş sembol canlı fiyat ve hard reload doğrulandı; kaynak/SLA/TCMB metni yok |
| `CDX-UX-05` | P1 | P8 | VERIFIED | Analiz ödeme yöntemi/dönem bağı belirsiz; kapsam seçimi etkisiz görünüyor; tür segmenti yamuk ve “transfer” dili içeriyor | Dönem kaynaksız disabled, seçili kaynakla gerçek tarih kapsamı uygulanıyor; Tümü/Gider/Gelir/Yatırım 320px’de eşit ve tek satır; browser davranış testi geçti |
| `CDX-UX-06` | P2 | P8 | VERIFIED | Bakiye başlangıç ayarı “gelişmiş” dili ve disclosure'ıyla kullanıcıyı yönlendirmiyor | Güncel bakiye birincil; “Geçmiş Başlangıç Noktası” açıklamalı, açılıp kapanabilen ikincil düzenleyici; iki temada browser baseline’ı incelendi |
| `CDX-DATE-01` | P1 | P8 | VERIFIED | Tekrarlayan gün alanlarında açık “Ayın sonu” seçeneği yok | Ortak `MonthDayField`; 31 kalıcı “Ayın sonu” anlamında; Şubat/leap/30/31 clamp unit testi ve browser seçim akışı geçti |
| `CDX-SYNC-01` | P1 | P9 | RESOLVED | Manuel sync sonucu belirsiz; iki aktif cihaz diğerinin yazısını düzenli çekmiyor | Foreground/resume anlık ve 30sn periyodik pull, mevcut single-flight/rerun korunuyor; manuel loading/sonuç ve dead-letter attention var. İki gerçek kurulu client kabulü `CDX-TEST-10` nedeniyle `BLOCKED` |
| `CDX-UX-07` | P2 | P8 | VERIFIED | Tanılama ve shell sync-health son kullanıcıya teknik, gereksiz bir yüzey | Route/badge/export UI ve domain modeli tamamen kaldırıldı; Settings yalnız eyleme dönük kısa sync durumu gösteriyor; route/metin yokluğu browser testinde |
| `CDX-NAV-01` | P1 | P9 | RESOLVED | Özel geri kontrolü küçük/optik offsetli; modal sunumu iOS sağ-silme jestini engelliyor | Tek markalı 44pt kontrol, deterministic dismiss/back ve stack card sunumu; direct-link browser geri testi geçti. Fiziksel iOS edge-swipe kabulü `BLOCKED` |
| `CDX-AUTH-01` | P1 | P9 | RESOLVED | Sign-in Face ID autofill sırasında privacy cover auth formunu kapatıyor | Native cover yalnız authenticated finans içeriğinde; sign-in/autofill yolu açık; policy testi geçti. Gerçek Face ID kabulü cihaz yokluğu nedeniyle `BLOCKED` |

## 18 Temmuz sadelik ve regresyon geri bildirimi

| ID | P | Paket | Durum | Sorun | Çözüm ve kabul ölçütü |
|---|---:|---:|---|---|---|
| `CDX-CODE-08` | P2 | P11 | VERIFIED | Son geliştirmeler atıl export, bağımlılık, asset, tekrar ve uzun doküman bırakmış olabilir | Sıkı TS unused + import graph + public-export taraması temiz; kullanılmayan `expo-constants`, iki lockup ve test-only production helper kaldırıldı; chart dönüşümü tek geçiş; net diff 1.000+ satır ekside; protected PR/main CI geçti |
| `CDX-UI-05` | P1 | P11 | VERIFIED | CTA ve kontrol renkleri istenen Claude light/dark paletiyle uyuşmuyor | Verilen roller `theme.ts` tek kaynağına birebir işlendi; button/field/toggle/card/segment ortak primitive'leri tonal sisteme geçti; gerçek kullanılan metin rolleri AA kontrast ve 20 runtime baseline'ında geçti |
| `CDX-NAV-02` | P1 | P11 | RESOLVED | Geri kontrolü özel pill gibi duruyor ve stack'lerde farklı uygulanıyor | Tek 44×44 icon-only kontrol ve tek `stackScreenOptions`; direct-link deterministic parent E2E geçti. Fiziksel iOS edge-swipe kabulü hâlâ cihaz gerektiriyor |
| `CDX-UX-08` | P1 | P11 | VERIFIED | Ay sonu tahmini dar mobilde kayboluyor, web yerleşimi tutarsız | Tahmin pending akış olmasa da her bakiye modelinde görünür; tam genişlik tonal satır 320/390/768/1440 browser matrisi ve main CI'da geçti |
| `CDX-NAV-03` | P1 | P11 | VERIFIED | Özet'ten Analytics'e gittikten sonra Mali Tablo sekmesi nested route'ta kalıyor | Cash Flow ve Settings tab'ları blur'da kök route'a dönüyor; Analytics → Özet → Mali Tablo kalıcı E2E akışı local/PR/main'de geçti |
| `CDX-PRODUCT-09` | P2 | P11 | VERIFIED | Özet, seçili aya ait gider dağılımı ve gelir/gider grafiğini göstermiyor | Analytics ile aynı saf donut verisi ve chart primitive'leri kullanılarak Özet'e tek pasta/sütun seçici eklendi; gerçek Chromium toggle akışı local/PR/main'de geçti |

## Güvenlik, veri bütünlüğü ve kod

| ID / eşleşme | P | Paket | Durum | Sorun | Çözüm ve kabul ölçütü |
|---|---:|---:|---|---|---|
| `HLX-05` · `CDX-CODE-04` | P1 | P1 | RESOLVED | `toRemote()` içindeki korumasız JSONB parse poison outbox satırını sonsuz retry’a sokabilir | Table-aware validator bozuk iç JSON/numeric/unknown-column payload’ını `invalid_row` dead-letter’a ayırıyor; aynı batch’teki sağlıklı row devam ediyor (`sync-outbound.test.ts`) |
| `CDX-CODE-01` · `CDX-CODE-03` | P1 | P1 | RESOLVED | Async form submitleri render’dan önce ikinci dokunmayı engellemiyor | Ortak senkron `useOperationGuard`; finansal create repository’lerinde operation ID/deterministik child ID; aynı tick iki çağrı tek callback (`operation-guard.test.ts`) |
| `CDX-CODE-02` | P2 | P1 | RESOLVED | Recurring income canlı income category doğrulamıyor | Repo sınırı null, silinmiş/foreign ve expense category’yi reddediyor; yalnız owner’ın canlı income category’sini kabul ediyor (`recurring-income-guard.test.ts`) |
| `CDX-CODE-05` | P1 | P7 | VERIFIED | Web document picker blob URL’si `expo-file-system File` ile okunamadığı için JSON restore ve spreadsheet import başlamıyor | Platform sınırı `readPickedText/readPickedBytes` altında toplandı; web browser `File`/fetch, native Expo File kullanıyor; clean-browser restore required CI Playwright’ında gerçek SQLite’a yazıyor |
| `CDX-CODE-06` | P1 | P7 | VERIFIED | Local-only workspace’in legacy owner UUID’si uygulamanın kendi JSON yedeğini geçersiz kılıyor | Stable local owner tek domain sabitine taşındı; yalnız bu exact `user_id` istisna, row/ref UUID kuralı aynı sıkılıkta; local export→clean restore ve validator regression’ı required CI’da yeşil |
| `CDX-ARCH-01` | P2 | P4 | RESOLVED | Live query loading/error/stale durumunu boş array ile karıştırıyor | Typed snapshot + last-good-data + retry eklendi; dashboard/Mali Tablo gerçek empty ile hata/loading’i ayırıyor; transition testleri yeşil |
| `CDX-ARCH-02` | P3 | P4 | RESOLVED | Dashboard query/aggregate/confirmation/render tek componentte | Saf tek-geçişli `buildDashboardModel`; forecast/distribution/fixed-variable golden parity ve 100k bütçesi yeşil |
| `CDX-ARCH-03` | P3 | P4 | RESOLVED | Cash-flow matrix model, orientation ve navigation iç içe | Saf matrix model + orientation adapterları; category/computed/system/missing-category parity ve 100k kredi-kartı split bütçesi yeşil. Görsel viewport matrisi P5/P7’de ayrıca korunacak |
| `CDX-ARCH-04` | P2 | P4 | RESOLVED | Root layout auth/lock/maintenance/market/guard effectleri tek orchestration’da | Biometric/maintenance/market hook’ları ve saf route guard ayrıldı; initial guard-query failure korumalı ekranı açmıyor; guard ve late-session testleri yeşil |
| `CDX-ARCH-05` | P2 | P4 | RESOLVED | Import SQL snapshot, mapping ve write planı tek I/O fonksiyonunda | Saf, lazy spreadsheet planı SQL/write’tan ayrıldı; category/year/breakdown/note parity testi ve tek atomik commit korundu |
| `HLX-06` | P3 | P3 | RESOLVED | `noUncheckedIndexedAccess` kapalı | Flag kalıcı açık; source + test indeksleri runtime guard/helper ile explicit; typecheck ve generated remote `Database` istemci tipi temiz |
| `CDX-DB-01` | P2 | P3 | VERIFIED | Own-data ilişkileri ve cross-kind kuralları remote DB’de yalnız client tarafından korunuyor | Remote migration 6: 19 owner-aware FK doğrulandı, category/polymorphic ref triggerları aktif, legacy 121 refund nakit etkisi korunarak kanonikleşti; son aggregate mismatch `0`; `database.types.ts` linked şemadan üretildi |
| `HLX-04` | P3 | P3/P6 | VERIFIED | RLS policy’leri doğrudan `auth.uid()` çağırıyor ve role scope açık değil | Remote 64/64 policy `TO authenticated` ve init-plan `(select auth.uid())`; linked migration 1–7 eşit, DB lint sıfır hata |

## Release, supply chain ve gözlemlenebilirlik

| ID / eşleşme | P | Paket | Durum | Sorun | Çözüm ve kabul ölçütü |
|---|---:|---:|---|---|---|
| `HLX-01` · `CDX-DEVOPS-03` | P1 | P2 | VERIFIED | `main` deploy’unda typecheck/test/lint kapısı ve branch protection yok | Remote `main`: PR + strict `quality` + admin enforcement; force-push/delete kapalı. Pages run `29637115841` quality→deploy zinciri başarılı; Dependabot PR #2 aynı kapıdan geçti |
| `HLX-07` · `CDX-TEST-02` | P2 | P7 | VERIFIED | Dokümante kalıcı Playwright smoke repoda yok | Local-only static export, gerçek browser SQLite/OPFS, service-worker offline, deep link, axe ve screenshot suite’i remote required `quality` job’unda release-blocking; production `dist` test env’inden önce üretiliyor |
| `CDX-DEVOPS-04` | P1 | P7 | VERIFIED | Pages dynamic route fallback’i `+not-found` shell’ini hydrate edip React #418 ile açılışı bozuyor | Production ve E2E `404.html` root `index.html` shell’inden üretiliyor; protected/modal/dynamic direct-link CI Playwright testi page exception olmadan geçti ve canlı deep-link aynı root shell’i sundu |
| `HLX-11` · `CDX-DEVOPS-01` | P1 | P2 | RESOLVED | EAS branch var, channel/build header sözleşmesi yok | Remote `preview` channel→branch doğrulandı; CNG header + EAS profile eklendi; Android placeholder ID `com.toprak.helix` oldu. Native rebuild/iki-cold-start kabulü henüz `VERIFIED` değil |
| `CDX-DEVOPS-02` · `CDX-PRODUCT-08` | P2 | P4/P9 | RESOLVED | Prod crash/sync/dead-letter ve incident kanıtı görünmüyor | Son kullanıcıya teknik ekran açmadan PII’siz bounded breadcrumb içeride kalıyor; sync eylemi pending/error/dead-letter attention’ı sade dille gösteriyor; EAS update health release tarafında izleniyor. Harici crash SaaS ürüne eklenmedi |
| `HLX-13A` | P3 | P2 | RESOLVED | GitHub Actions tag ref kullanıyor | Bütün third-party actions doğrulanmış 40-haneli commit SHA’larına pinli; npm + Actions haftalık Dependabot politikası eklendi ve config testi ref’leri koruyor |
| `HLX-13F` | P2 | P2 | VERIFIED | Secret scanning/push protection/Dependabot security updates kapalı | GitHub API’den secret scanning, push protection ve Dependabot security updates `enabled` geri okundu; SDK 57 PR #3 `BACKLOG-SDK-01` gerekçesiyle kapatıldı |
| `HLX-13E` | P3 | P4/P9 | VERIFIED | Harem market feed’i resmî/SLA’lı değil | Resmî SLA’sız kaynak teknik ayrıntısı kullanıcı UI’sından kaldırıldı; bağlantı/reconnect/stale davranışı sınırlandı ve testli; gerçek Chromium’da canlı beş sembol + hard reload geçti |
| `HLX-13B` | P3 | P7 | VERIFIED | Supabase client ve audit dışı SheetJS patch güncelliği | Final check’te çıkan Supabase 2.110.7 patch’i uygulandı; official SheetJS CDN/docs 0.20.3’ü current gösteriyor ve pinned tarball aynı; Expo 54 kaynaklı 17 moderate yalnız `BACKLOG-SDK-01` |
| `HLX-13D` | P4 | P7 | VERIFIED | Boş catch’ler hata yutuyor olabilir | Uygulama catch’leri kasıtlı fallback/cleanup sınırları olarak doğrulandı; final source scan, typecheck ve sıfır uyarılı lint local ile remote required CI’da geçti |

## Performans ve ölçek

| ID / eşleşme | P | Paket | Durum | Sorun | Çözüm ve kabul ölçütü |
|---|---:|---:|---|---|---|
| `HLX-08` · `CDX-PERF-03` | P2 | P4 | VERIFIED | Backup/restore 100k satırı tek array/string/write planında tutuyor | Export tablo-tabla bounded builder kullanıyor; restore 400-row batch’leri tek transaction’da tüketiyor; 15 tablo envelope parity ve >100k erken reddetme testlerine ek gerçek SQLite clean-DB round-trip required CI’da geçti |
| `CDX-PERF-04` | P1 | P4 | RESOLVED | XLSX mantıksal hücre limitleri `XLSX.read` sonrasında; zip-bomb riski | SheetJS öncesi ZIP entry/64 MB açılmış boyut/32 MB entry/200× oran preflight; XLSX lazy chunk; hostile ZIP testi yazmadan reddediyor |
| `CDX-PERF-01` | P2 | P4 | RESOLVED | Ledger her değişimde tüm transaction geçmişini tarıyor | 1k/10k/100k benchmark lineer O(T+M) modeli bütçe içinde doğruladı; gereksiz model migration’ı yapılmadı, ikinci `currentBalance` taraması normal yoldan kaldırıldı |
| `CDX-PERF-02` | P3 | P4 | RESOLVED | Dashboard/analytics aynı diziyi çok kez tarıyor | Forecast+distribution+fixed-variable tek saf geçişte; cash-flow kredi-kartı split’i 12 taramadan bire indi; golden parity ve 100k eşikleri yeşil |
| `CDX-PERF-05` | P3 | P4 | RESOLVED | Uzun transaction listelerinde virtualization yok | 2026-07-19: ay detayı/hücre editörü/Analiz araması gerçek `FlatList` sanallaştırmasına taşındı (progressive 80+80 katmanı kaldırıldı); 1.200 işlemlik gerçek import senaryosunda ay detayı ~160 ms açılıyor, ~116 satır mount ediliyor |
| `CDX-PERF-06` | P3 | P4 | RESOLVED | Bundle/brand asset bütçesi yok | Ölçüm: entry 5.07→4.60 MB, XLSX ayrı 493 KB lazy chunk, font 36→8, export ~15→9.48 MB; CI entry/JS/font/export bütçesi eklendi |

## UI, UX, erişilebilirlik ve gizlilik

| ID / eşleşme | P | Paket | Durum | Sorun | Çözüm ve kabul ölçütü |
|---|---:|---:|---|---|---|
| `HLX-02` · `CDX-A11Y-01` | P2 | P5 | RESOLVED | Shared form/chart/icon/modal semantics, focus ve announcements eksik | Shared field/control role-state-hint, heading, chart tam değer özeti, modal focus/return ve live error/loading eklendi; source contract testleri yeşil. Fiziksel VoiceOver/TalkBack kabulü `CDX-TEST-12` ile P7’de |
| `HLX-03` · `CDX-A11Y-02` | P2 | P5/P8 | RESOLVED | Primary ve semantic foreground kontrastları WCAG AA altında | Accent/fill ile foreground rolleri ayrıldı; light/dark body/semantic metin çiftleri ≥4.5:1 ve focus sınırı ≥3:1 otomatik testte; sakin filled control yüzeyleri görsel matriste |
| `CDX-A11Y-03` | P2 | P7 | VERIFIED | Runtime axe taraması dekoratif image, progressbar ve radio/switch checked state’lerinin web DOM’unda eksik olduğunu gösterdi | Dekoratif Expo Image’lar empty alt’a mapleniyor; spinner adları ve explicit `aria-checked` eklendi; dashboard/cash-flow/subscriptions/calculator/settings/transaction WCAG A/AA runtime taraması remote required CI’da sıfır ihlal |
| `CDX-UX-01` | P2 | P5 | RESOLVED | 320px cash-flow ve late-payment action satırları sıkışıyor | Primary CTA tam genişlik, beş araç dengeli satır, geniş payment aksiyonu <430px’de alt satır; 320/390/768/1440 matematiksel no-overflow testi yeşil |
| `CDX-UX-03` | P2 | P7 | VERIFIED | 320px bottom tab görünür metni `Bütçe Ö…`/`Aboneli…` olarak kesiliyor | Tam screen-reader adları korunurken görünür navigasyon `Özet/Tablo/Abonelik/Hesap/Ayarlar` oldu; 320 light/dark screenshot + exact text/no-ellipsis assertion remote required CI’da yeşil |
| `CDX-UX-02` · `CDX-PRODUCT-03` | P2 | P5/P6 | RESOLVED | Onboarding ağır; dirty form geri dönüşte sessiz veri kaybediyor | Kritik formlarda gerçek snapshot’a dayalı dirty-exit guard var; onboarding varsayılan kategori/kişiyle tek ana eylemli hızlı başlangıca indi, mevcut bakiye ve ileri kurulum/import isteğe bağlı kaldı |
| `HLX-12` · `CDX-SEC-02` · `CDX-PRODUCT-04` | P2 | P5 | RESOLVED | Notification lock-screen metni ad/tutar gösterebilir | Varsayılan nötr preview, ayrı device-local onay, kapatma/account switch’te fail-closed clear ve en yakın 60 plan; pure+boundary testleri yeşil, cihaz kabulü `CDX-TEST-15`’te |
| `CDX-SEC-01` | P2 | P5 | RESOLVED | App switcher snapshot privacy cover yok; Pages frame header sınırlı | Native inactive/background ve framed web için izole, değersiz privacy modalı var; policy/source testi yeşil. OS snapshot zamanlaması fiziksel cihazda P7’de kesinleşecek |
| `CDX-IA-02` | P3 | P6 | RESOLVED | Account freeze Settings’in ana seviyesinde dağınık | Dondurma Account Security altında toplandı; local-only modda da erişiliyor, deterministic back/deep-link sözleşmesi korunuyor |
| `CDX-IA-03` | P3 | P6/P11 | RESOLVED | Dashboard üç analitik kartla Analytics’i tekrar ediyor | Eski üçlü tekrar kaldırıldı; kullanıcı talebiyle yalnız seçili ayın tek değiştirilebilir pasta/sütun kartı geri geldi. Arama, bütçe ayrıntısı ve trendler Analytics'te kaldı (`CDX-PRODUCT-09`) |
| `CDX-IA-04` | P3 | P6/P8 | RESOLVED | Var olan JSON/CSV export yeterince keşfedilebilir değil | Ayarlar’da “Verilerini Taşı ve Koru” görev grubu tanılama yüzeyinden bağımsız; backup/export/restore açık görev diliyle sunuluyor |

## Ürün kapsamı

| ID | P | Paket | Durum | Problem / değer | Çözüm ve kabul ölçütü |
|---|---:|---:|---|---|---|
| `CDX-PRODUCT-01` | P2 | P6 | RESOLVED | Büyüyen işlem geçmişinde kayıt bulmak zor | Analytics’te metin+tarih kapsamı+tür+kategori+kaynak filtreleri, bounded newest-first sonuç, sıfır sonuç/temizle ve edit drill-down var; saf arama testleri yeşil |
| `CDX-PRODUCT-02` · `CDX-IA-01` | P2 | P6/P8/P9 | RESOLVED | Sync sağlığı teknik ve dikkat dağıtıcıydı | Global badge/teknik health modeli kaldırıldı; yalnız Ayarlar’daki manuel eylem üzerinde kısa kullanıcı dili, loading, son başarı veya attention gösteriliyor |
| `CDX-PRODUCT-05` | P2 | P6 | VERIFIED | Forecast var ama kullanıcı hedef/variance tanımlayamıyor | Synced aylık expense-category bütçesi CRUD/undo/progress/remaining ve Analytics görünümü eklendi; migration 7 remote, 24 pgTAP ve domain/backup testleri yeşil |
| `CDX-PRODUCT-06` | P2 | P6 | VERIFIED | Haftalık/iki haftalık gelir kuralları modellenemiyor | `monthly/weekly/biweekly` union’ı, ISO anchor, 7/14 günlük üretim ve backward-compatible migration var; remote constraint ve recurrence/backup testleri yeşil |
| `CDX-PRODUCT-07` | P2 | P6 | RESOLVED | Expected/card/subscription takvimi ayrı yüzeylerde | Abonelik, düzenli gelir, gelecek işlem ve kart ekstresini ay bazında birleştiren `/upcoming` eklendi; dashboard preview, empty/offline/stale ve kaynak drill-down testli |

## Test ve dokümantasyon

| ID / eşleşme | P | Paket | Durum | Eksik davranış | Kabul ölçütü |
|---|---:|---:|---|---|---|
| `HLX-09` · `CDX-TEST-01` | P2 | P7/P10 | VERIFIED | Component/hook/SQLite/RLS/E2E koruması yetersiz | 48-file/289-test unit/boundary suite; actual browser component/SQLite flows; 24 remote pgTAP; 9 Playwright flow; axe ve 21 responsive/follow-up baseline PR `29652848214` ve main `29653031390` required run'larında geçti |
| `CDX-TEST-03` | P1 | P2/P7 | RESOLVED | OTA channel/runtime/rollback gerçek kabul testi yok | Config regression testi, remote channel/group metadata ve çalıştırılabilir rollback/iki-cold-start checklist tamam; fiziksel cihaz sonucu olmadığı için `VERIFIED` değil |
| `CDX-TEST-04` | P1 | P1 | RESOLVED | Poison outbox regression testi yok | Bozuk JSONB/unknown column/non-finite numeric karantinada; sağlıklı sonraki row push planında kalıyor |
| `CDX-TEST-05` | P1 | P1 | RESOLVED | Duplicate submit testi yok | Aynı tick iki invocation tek operation callback; success/error sonrası guard deterministik serbest |
| `CDX-TEST-06` | P1 | P3/P6 | VERIFIED | İki-user RLS izolasyon testi yok | Remote pgTAP 24/24: önceki A/B/anon/FK/category kapsamına owned budget ve expense-kind/weekly-anchor constraintleri eklendi; `finish(true)` + rollback |
| `CDX-TEST-07` | P1 | P7 | VERIFIED | Core kalıcı E2E yok | Onboarding→transaction→month detail→edit/delete/undo→JSON backup gerçek browser SQLite akışı remote required CI’da geçti |
| `CDX-TEST-08` | P1 | P4/P7 | BLOCKED | Account-switch late task integration testi eksik | Saf epoch/task regression A’nın geç sonucunu B’de sıfır commit ile düşürüyor; iki authenticated installed client/SQLite lifecycle kabulü ortamda yok, `TESTING.md` cihaz matrisinde açık |
| `CDX-TEST-09` | P1 | P4/P7 | VERIFIED | Backup temiz DB round-trip integration testi eksik | Gerçek Chromium’da export → yeni browser context/clean SQLite restore; dangling ref’li bundle sıfır write; 15-table unit parity remote required CI’da korunuyor |
| `CDX-TEST-10` | P1 | P7 | BLOCKED | Offline→relaunch→online sync kalıcı testi eksik | Service-worker offline cold reload gerçek SQLite verisini koruyor ve duplicate üretmiyor; remote outbox drain için disposable authenticated iki-client ortamı yok |
| `CDX-TEST-11` | P2 | P5/P7 | VERIFIED | Form invalid/loading/error/dirty/password-manager tests yok | Shared invalid/dirty/busy/error/auth contractları + actual onboarding/transaction edit/restore navigation E2E; double submit ayrı boundary testinde ve remote required CI’da yeşil |
| `CDX-TEST-12` | P2 | P5/P7 | BLOCKED | Automated + cihaz a11y matrisi yok | axe ana route’larda sıfır A/AA ihlali; semantics/contrast/modal/chart/tab contractları yeşil. Fiziksel VoiceOver/TalkBack/Dynamic Type kabulü için cihaz yok |
| `CDX-TEST-13` | P1 | P4/P7 | BLOCKED | Hostile workbook/büyük backup stress testi yok | Hostile ZIP SheetJS öncesi; >100k backup iterasyon/yazım öncesi; relational invalid browser restore sıfır write. Düşük bellek cihaz heap kabulü için cihaz yok |
| `CDX-TEST-14` | P2 | P7 | VERIFIED | Locale/timezone/DST matrisi eksik | TR grouped comma round-trip, Istanbul/UTC gün sınırı, leap/DST tarihleri ve 7/14 günlük ay geçişleri kalıcı unit testte; browser `tr-TR`/Istanbul matrisi remote required CI’da geçti |
| `CDX-TEST-15` | P2 | P5/P7 | BLOCKED | Notification consent/privacy/64-cap cihaz testi eksik | Default neutral/opt-in, stale preference, sign-out clear ve 60-cap otomatik; gerçek OS permission/scheduler/lock-screen için cihaz yok |
| `CDX-TEST-16` | P2 | P5/P7/P10 | VERIFIED | 320/390/768/1440 light/dark visual regression yok | 21 versioned screenshot: dashboard matrisi, beş tab ve transaction/analytics/payment-source/opening-balance iki tema; exact no-ellipsis/layout assertion, görsel inceleme ve remote required runs geçti |
| `CDX-TEST-17` | P2 | P4/P7 | VERIFIED | 1k/10k/100k performance bütçesi yok | Vitest benchmark 1k/10k/100k ledger ve 100k dashboard/matrix 4 sn eşiğinde; production bundle budget + full E2E remote required quality’de geçti |
| `HLX-10` · `CDX-DOC-03` | P4 | P7 | VERIFIED | Dokümanda sabit test sayısı drift ediyor | README/TESTING sabit sayıyı kaldırdı; gerçek suite sonucu her CI commit’inde üretiliyor ve güncel GitHub `main` üzerinde yayınlandı |
| `HLX-13C` · `CDX-DOC-04` | P2 | P7 | VERIFIED | Privacy, retention, release/rollback ve third-party feed açıklaması eksik | `PRIVACY.md` local/remote storage, tombstone retention, delete/export, notifications, dış servisler ve sınırları; `RELEASE.md` web/OTA/native/DB/rollback/incident sözleşmesini açıklıyor ve GitHub `main` üzerinde yayınlandı |
| `CDX-DOC-01` | P2 | P7 | VERIFIED | README doğru ama uzun/teknik ve görsel olarak sönük | Türkçe-first iki dilli hero, gerçek workflow rozetleri, 5 gerçek screenshot, görev/IA tablosu, progressive technical details ve doğru platform sınırları GitHub `main` üzerinde yayınlandı |
| `CDX-DOC-02` | P3 | P7 | VERIFIED | Mermaid kullanıcıya ürün davranışını anlatmıyor | Ana diagram “ekle → cihazda hesapla → offline sırada bekle → hesabına sync” dilinde; repo/outbox/RLS teknik akışı açılır ikinci katmanda ve GitHub `main` üzerinde yayınlandı |

## Açıkça ertelenen backlog

| ID | Durum | Neden / tekrar değerlendirme tetikleyicisi |
|---|---|---|
| `BACKLOG-SDK-01` | BACKLOG | Expo SDK 54 zincirindeki advisory ve toolchain yükseltmeleri; Dependabot SDK-managed Expo/React/React Native tüm rutin version update’lerini, rutin ESLint sürümlerini ve TypeScript major’larını koordineli native/toolchain upgrade’e kadar susturuyor, security update’leri açık kalıyor. User yeni SDK istediğinde ve installed build hattı SDK 57’ye geçebildiğinde tekrar açılacak |
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
| P6 | `40c0fea` | [quality→Pages run 29643476129](https://github.com/topraksv/helix/actions/runs/29643476129) başarılı; canlı root/upcoming/budgets/analytics 200 | migration 7 + 24 pgTAP verified; [EAS group ea6a17fd](https://expo.dev/accounts/topraksv/projects/helix/updates/ea6a17fd-610c-4370-8ce7-91cbb753bcb4), runtime `1.0.0` | VERIFIED |
| P7 | `14547c8` + final `8164caa` ([PR #20](https://github.com/topraksv/helix/pull/20), [#29](https://github.com/topraksv/helix/pull/29)) | PR quality `29647921636` ve [final quality→Pages run 29648089748](https://github.com/topraksv/helix/actions/runs/29648089748) başarılı; canlı root/settings 200, önceki route/dynamic shell doğrulamaları korunuyor | [EAS group 885cbc8e](https://expo.dev/accounts/topraksv/projects/helix/updates/885cbc8e-47b3-4bfb-bc31-389379d1a76f), runtime `1.0.0`, commit `8164caa`; installed delivery doğrulanamadı, fiziksel cihaz kabul maddeleri `BLOCKED` | RESOLVED |
| P8 | `a249492` ([PR #32](https://github.com/topraksv/helix/pull/32)) | PR quality `29652848214` + [main quality→Pages `29653031390`](https://github.com/topraksv/helix/actions/runs/29653031390) başarılı; root/analytics/transaction/payment-sources canlı 200 | [EAS group 1d2ed181](https://expo.dev/accounts/topraksv/projects/helix/updates/1d2ed181-0dcd-48be-abae-3985d414854b), runtime `1.0.0`, commit `a249492` | VERIFIED |
| P9 | `a249492` ([PR #32](https://github.com/topraksv/helix/pull/32)) | Aynı required quality/Pages zinciri ve canlı route probe | Aynı EAS group; canlı Harem browser doğrulandı. İki-client, Face ID ve iOS edge-swipe installed kabulü `BLOCKED` | RESOLVED |
| P10 | `a249492` + release record | [main run `29653031390`](https://github.com/topraksv/helix/actions/runs/29653031390) başarılı | Linked migration 1–7 eşit, DB lint 0, pgTAP 24/24; EAS commit/runtime/platform metadata eşleşti | VERIFIED |
| P11 | `93e12ab` ([PR #34](https://github.com/topraksv/helix/pull/34)) | PR quality [`29655641593`](https://github.com/topraksv/helix/actions/runs/29655641593) ve main quality→Pages [`29655797800`](https://github.com/topraksv/helix/actions/runs/29655797800) başarılı; canlı root/analytics/transaction 200 | [EAS group `5abb5e1b`](https://expo.dev/accounts/topraksv/projects/helix/updates/5abb5e1b-f99a-47da-9e63-ceeab5a864de), runtime `1.0.0`, commit `93e12ab`, iOS+Android; ilk health 0 install/0 failure. SDK 54'ün 17 moderate advisory'si `BACKLOG-SDK-01` | RESOLVED |
