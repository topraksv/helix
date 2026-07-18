# Helix test ve kabul sözleşmesi

Bu belge test sayısını değil, hangi kritik davranışın hangi katmanda korunduğunu
tanımlar. Sabit test sayısı tutulmaz; gerçek sonuç her commit’in GitHub Actions
`quality` job’unda ve yerel komut çıktısında görülür.

## Release kapısı

| Katman | Komut | Çalışma yeri | Release durumu |
|---|---|---|---|
| TypeScript sınırı | `npm run typecheck` | local + CI | Bloklayan |
| Domain/data/sync regression | `npm test` | local + CI | Bloklayan |
| Expo/React lint | `npx expo lint` | local + CI | Bloklayan |
| Production web export + bundle bütçesi | `npx expo export -p web && npm run bundle:check` | local + CI | Bloklayan |
| Browser SQLite/E2E/a11y/görsel | `npm run test:e2e` | local + CI | Bloklayan |
| Supabase migration/RLS | `migration list`, `db lint`, pgTAP | migration paketinde linked remote | Bloklayan |
| iOS/Android gerçek cihaz | aşağıdaki cihaz kabul matrisi | release adayı cihazda | Native/OTA teslimi için manuel; cihaz yoksa `BLOCKED` |

CI sırası özellikle önemlidir: önce gerçek production export `dist/` içine
üretilir ve bütçesi ölçülür; sonra E2E scripti Supabase env’ini bilinçli olarak
boşaltıp ayrı `dist-e2e/` local-only artefact’ını oluşturur. Test env’i Pages
artefact’ına karışamaz.

## Otomatik davranış matrisi

| Öncelik | Akış/risk | Test türü | Senaryo | Beklenen | Kanıt |
|---:|---|---|---|---|---|
| P1 | Para ve bakiye bütünlüğü | Unit/golden | integer kuruş, signed refund, ledger anchor, kart ekstresi, taksit/recurrence | Kuruş sapması ve yanlış ay yok | `tests/balance.test.ts`, `money-fx-computed`, `card-statements`, `installments`, `recurrence` |
| P1 | Mutation duplicate | Unit/boundary | aynı tick iki submit + deterministic child IDs | Tek operation/write; success/error sonrası kilit açılır | `operation-guard`, `repository-contract` |
| P1 | Poison outbox/cross-session write | Unit/integration | bozuk JSON/kolon/sayı; A’nın geç cevabı B aktifken döner | Bozuk event dead-letter; sağlam event ilerler; geç cevap commit olmaz | `sync-outbound`, `session-epoch`, `session-task` |
| P1 | Onboarding → işlem yaşam döngüsü | Browser E2E | quick start → gider ekle → ay detayı → edit → delete/undo → JSON export | Gerçek browser SQLite’ta tek ve geri alınabilir kayıt | `e2e/core-flow.spec.ts` |
| P1 | Temiz DB restore/atomiklik | Browser E2E | export → yeni context restore; dangling ref’li bundle | Geçerli bundle 1:1 gelir; invalid bundle sıfır satır yazar | `e2e/core-flow.spec.ts`, `backup-validation` |
| P1 | Offline cold relaunch | Browser E2E | service worker cache → offline reload → online | SQLite veri korunur; yeniden mount duplicate üretmez | `e2e/resilience.spec.ts` |
| P1 | İki-user yetkilendirme | Remote pgTAP | A CRUD, B izolasyonu, owner değiştirme, anon erişim, cross-owner FK | 24 assertion; fixture rollback | `supabase/tests/rls_policies.sql` |
| P1 | Hostile import/backup | Unit/stress | yüksek oranlı ZIP, büyük entry, >100k row, duplicate/mixed owner | SheetJS/write öncesi bounded red | `spreadsheet-import`, `backup-validation`, `import-plan` |
| P2 | Route/guard/deep link | Browser E2E + unit | protected ve modal direkt URL; auth/onboarding/recovery guard | Hata ekranı/hydration exception yok; deterministic parent | `e2e/resilience.spec.ts`, `app-guard`, `navigation` |
| P2 | Form durumları | Unit + browser component | invalid limit, dirty exit, loading/busy, password-manager metadata | Hata görünür/duyurulur; veri sessiz kaybolmaz; double submit yok | `input-policy`, `dirty-exit`, `accessibility-contract`, core E2E |
| P2 | Erişilebilirlik | axe + contract | altı ana route WCAG A/AA; form/chart/modal/tab semantics | axe violation yok; adı/role/state’i eksik ortak kontrol yok | `e2e/visual-a11y.spec.ts`, `accessibility-contract`, `theme-contrast` |
| P2 | Responsive görsel kalite | Screenshot + assertion | 320/390/768/1440, light/dark; beş ana tab | Baseline diff bütçesinde; tab metni üç noktayla kesilmez | `e2e/__screenshots__`, `visual-a11y`, `responsive-layout` |
| P2 | TR locale/tarih | Unit + browser locale | virgül/kuruş, Istanbul–UTC gün sınırı, leap/DST, 7/14 gün ay geçişi | Parse/format round-trip; takvim günü kaymaz | `locale-timezone`, `dates-year-columns`, `income-recurrence` |
| P2 | Bildirim privacy/cap | Unit/boundary | default neutral, opt-in detail, stale preference, sign-out, >60 item | Ayrıntı fail-closed; en yakın 60; hesap verisi temizlenir | `device-preferences`, `privacy`, `upcoming` |
| P2 | Ölçek | Deterministic benchmark | 1k/10k/100k ledger; 100k dashboard/matrix; progressive list | CI 4 sn bütçesi; lineer/bounded output | `performance`, `progressive-list` |
| P3 | External feed dayanıklılığı | Unit | timeout/abort/shape/date/cache, stable market quote, invalid favicon host | Eski/bozuk veri canlı veya TRY gibi sunulmaz | `external-services` |
| P3 | Release config | Source/config | Node 22, runtime/channel, pinned Actions, branch-safe deploy, bundle budget | Native/web sözleşmesi drift etmez | `release-config`, workflow `quality` |

## Playwright neyi gerçekten yapar?

`npm run test:e2e` şu adımları çalıştırır:

1. `EXPO_NO_DOTENV=1` ile Supabase değerlerini boşaltır ve local-only static web
   export üretir.
2. Pages `/helix` base path’ini ve bilinmeyen/dynamic URL’ler için root
   `404.html` shell’ini yerel sunucuda taklit eder.
3. Chromium’u `tr-TR`, `Europe/Istanbul`, Reduced Motion ile açar; opsiyonel dış
   feed isteklerini keser.
4. Gerçek Expo SQLite web worker/OPFS yolu üzerinde onboarding, CRUD, undo,
   export/restore ve offline cold reload yapar.
5. Ana route’ları axe WCAG A/AA ile tarar; page exception ve uygulama console
   error’larını test hatası sayar.
6. Responsive light/dark screenshot baseline’larını karşılaştırır.

Bu suite production Supabase’e bağlanmaz, gerçek kullanıcı verisi yazmaz ve canlı
iki-cihaz sync’ini taklit etmiş sayılmaz. Remote yetki/constraint pgTAP ile;
kurulu cihaz lifecycle’ı aşağıdaki manuel kabul ile tamamlanır.

Baseline’ı yalnız bilinçli tasarım değişikliğinde güncelle:

```bash
npm run test:e2e:update
git diff -- e2e/__screenshots__
```

Her değişen görüntü 320/390 mobil ve ilgili tablet/desktop görünümünde gözle
incelenmeden kabul edilmez. Sadece testi yeşile çevirmek için baseline yenilenmez.

## Linked Supabase kabulü

Migration içeren paket, [RELEASE.md](RELEASE.md) sırasını uygular. Minimum kanıt:

- local/remote migration version’ları birebir;
- `supabase db lint --linked` schema error yok;
- pgTAP A/B/anon izolasyonu, owner change, FK/check/RPC davranışını test ediyor;
- test fixture’ları aynı transaction’da rollback oluyor;
- linked generated `Database` tipi typecheck’ten geçiyor.

Local migration dosyası tek başına production gerçeği değildir.

## Gerçek cihaz kabulü

Otomatik kontroller aşağıdaki OS davranışlarını kanıtlayamaz. Ulaşılabilir
installed build/simulator olmadığı için son 2026-07-18 otomasyon koşusunda bu
matris **BLOCKED** kaldı; kod başarısız değil, dış kabul kanıtı yok.

| Platform | Senaryo | Kabul ölçütü | Son durum |
|---|---|---|---|
| iOS | VoiceOver + Dynamic Type XL/AX | Onboarding, işlem formu, tablo detayı, Settings okuma sırası; focus modalı açan elemana döner; metin/CTA kesilmez | BLOCKED — cihaz yok |
| Android | TalkBack + font/display scale | Aynı ana akış; role/state/hint doğru; hardware/system back deterministic parent’a gider | BLOCKED — verified build/device yok |
| iOS/Android | Reduced Motion | Press/list/modal hareketleri azalır; işlev kaybı yok | BLOCKED — cihaz yok |
| iOS/Android | App switcher/screenshot privacy | Background anında finansal içerik yerine privacy cover snapshot’lanır | BLOCKED — OS timing cihaz ister |
| iOS/Android | Bildirim | Boot’ta izin sorulmaz; nötr preview varsayılan; opt-in detail; sign-out tüm account detail’i temizler; en yakın 60 planlanır | BLOCKED — OS scheduler cihaz ister |
| Installed OTA | `preview` teslimi | Doğru runtime/channel; ilk cold start indirir, ikinci cold start yeni update’i açar; diagnostics commit/runtime gösterir | BLOCKED — installed binary erişilemedi |
| İki installed client | Account switch/sync | A’nın geç işi B’ye yazmaz; offline event online olunca tek kez gider; delete/undo iki tarafta eşit | BLOCKED — iki client yok |
| Düşük bellek cihaz | Büyük geçerli import | Limit içindeki dosya tamamlanır veya kontrollü hata verir; crash/yarım write yok | BLOCKED — cihaz profili yok |

### Cihaz sonuç kaydı

Release yapan kişi bu tabloyu doldurup tracker/handoff’a kanıt linkini ekler:

| Tarih | Cihaz/OS | Build + runtime + update group | Tester | Geçen senaryolar | Kalan hata/kanıt |
|---|---|---|---|---|---|
| — | — | — | — | — | Henüz cihaz kabul koşusu yok |

Bir satır doldurulmadan otomatik test sonucu “VoiceOver/TalkBack/installed OTA
verified” diye raporlanamaz.

## Paket kapanış kontrolü

- Kök neden için unit/boundary testi ve kullanıcı akışı için mümkünse E2E var.
- Test production verisine yazmıyor ve gerçek sırrı artefact’a gömmüyor.
- Retry/undo senaryosu idempotent; invalid import sıfır write ile bitiyor.
- Runtime görülmeyen OS davranışı `BLOCKED`, test edildi gibi değil.
- `npm run typecheck && npm test && npx expo lint` temiz.
- `npm run test:e2e` temiz; değişen baseline’lar görsel olarak incelenmiş.
- Migration varsa linked list/lint/pgTAP/type generation kanıtı var.
- PR’ın required `quality` kontrolü geçmeden release yok.
