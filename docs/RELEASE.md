# Helix release sözleşmesi

Helix’in üç bağımsız teslim yüzeyi vardır: GitHub Pages web, `preview` EAS OTA
ve gerektiğinde linked Supabase şeması. `main` push yalnız web’i yayımlar; telefon
kendiliğinden güncellenmez. OTA da native config veya database migration yerine
geçmez.

## Değişiklik türü → teslim yolu

| Değişiklik | Web | OTA | Native build | Supabase |
|---|---|---|---|---|
| Sadece docs/test/CI | `main` Pages | Gerekmez | Gerekmez | Gerekmez |
| JS/TS veya mevcut asset | `main` Pages | `preview` branch | Gerekmez | Gerekmez |
| Migration + backward-compatible app code | `main` Pages | `preview` branch | Genelde gerekmez | Linked push + doğrulama |
| Native module/plugin, `app.json` native alanı, icon/splash | `main` Pages | Tek başına yeterli değil | Yerel cihaz build’i | Varsa ayrıca |
| Expo SDK/runtime/app version | `main` Pages | Eski runtime’a ulaşmaz | Zorunlu | Varsa ayrıca |

## 1 · Branch ve kalite kapısı

1. `main`den branch aç; mevcut kirli dosyaları sahiplenmeden önce diff’i incele.
2. Commit öncesi Node 22 ile tam kapıyı koştur:

   ```bash
   export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
   npm run verify:release
   ```

   Kapsam ve katmanlar [TESTING.md](TESTING.md) belgesindedir.
3. PR aç. Protected `main`; güncel branch, PR ve required `quality` check’i ister.
   Ayrıca **imzalı commit**, lineer geçmiş ve çözülmüş konuşma zorunludur;
   admin bypass, force-push ve delete kapalıdır. İmzasız commit reddedilir —
   commit atmadan önce yerel imza yapılandırmasını doğrula.
4. `quality` tek release kapısıdır: `npm ci` → typecheck → Vitest → lint →
   production export → bundle budget → Playwright Chromium/E2E. Workflow bu
   adımları tek tek çalıştırır; `verify:release` aynı sırayı yerelde tekrarlar.
5. Check geçmeden merge/deploy/OTA yoktur.

Playwright local-only `dist-e2e/` üretir. Workflow production `dist/` export ve
bütçesini önce tamamladığı için test env’i deploy artefact’ını değiştirmez.

## 2 · Web / GitHub Pages

Protected PR merge’i `main`e geldiğinde aynı workflow:

1. production Supabase publishable değerleriyle bütün static route’ları export eder;
2. entry/chunk/font/toplam boyut bütçesini kontrol eder;
3. dynamic/bilinmeyen Pages URL’leri için **root `index.html` shell’ini**
   `404.html` olarak kopyalar;
4. immutable Pages artefact’ını `deploy` job’ına verir.

`+not-found.html` 404 fallback’i olarak kullanılmaz: dynamic route açılışında
yanlış server route hydrate olur ve React #418 üretebilir.

Release sonrası statik URL’ler status 200 ve uygulama shell’iyle; dinamik URL ise
GitHub Pages’in custom-404 davranışına uygun olarak status 404, root `index.html`
ile birebir aynı shell ve yüklenebilir entry asset’iyle kontrol edilir:

```text
https://topraksv.github.io/helix/
https://topraksv.github.io/helix/cash-flow/<YYYY-MM>
https://topraksv.github.io/helix/upcoming
https://topraksv.github.io/helix/settings
```

GitHub Pages rewrite desteklemediği için önceden üretilemeyen gerçek bir ay URL’si
ilk HTTP yanıtında 404 kalır; `404.html` kopyası client router’ın doğru ekranı
hydrate etmesini sağlar. Dinamik rotayı 200 diye raporlamak veya Expo Router’ın
`+not-found` çıktısıyla değiştirmek doğru kabul değildir.

Workflow run URL’si ve sonuç commit’i `docs/AI_HANDOFF.md` release kaydına yazılır.

### Web rollback

Pages’te mutable eski artefact’a işaret etme. Son sağlam Git commit’ini yeni bir
`revert` branch/PR’ıyla geri al; aynı required quality’den geçir. Migration içeren
release’te uygulama revert’inin remote şemayla backward-compatible olduğu ayrıca
kanıtlanmadan merge etme.

## 3 · Mobil EAS OTA

JS/asset-only değişiklik, protected `main` release commit’inden yayımlanır:

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
git status --short                  # boş olmalı
git rev-parse HEAD                  # handoff'taki release commit'i olmalı
npx eas-cli update --channel preview \
  -m "<kısa, davranış odaklı özet>" --non-interactive
```

Kurulu test build’i `preview` channel’ını tüketir (`app.json`
`updates.requestHeaders.expo-channel-name`, `eas.json` `build.preview.channel`)
ve runtime `1.0.0` kullanır. Channel’ın remote mapping’i tek ve koşulsuzdur
(`branchMappingLogic: "true"` → `preview` branch), bu yüzden `--channel preview`
aynı branch’e yayımlar ve mapping’i değiştirmez. Kanonik komut budur;
`--branch preview` kullanılmaz. Channel’a rollout ya da birden fazla branch
eklenirse bu komut yeniden değerlendirilir.

Yayın sonrası:

```bash
npx eas-cli channel:view preview --json --non-interactive
npx eas-cli update:view <UPDATE_GROUP_ID> --json --non-interactive
npx eas-cli update:insights <UPDATE_GROUP_ID> --json --non-interactive
```

Aşağıdaki kanıtlar eşleşmeden paket teslim edildi sayılmaz:

- group iki platform update ID’si içeriyor;
- runtime `1.0.0` ve branch `preview`;
- update metadata Git commit’i release commit’iyle aynı;
- channel remote’da hâlâ `preview` branch’ine bağlı;
- bundle upload iki platformda başarılı.

Kurulu binary update’i ilk cold start’ta indirir, bir sonraki cold start’ta açar.
Bu yüzden **iki tam kapat/aç** + hedef sürümdeki görünür kabul akışı doğrulanmadan installed
delivery `VERIFIED` değildir. EAS insights'ta `0` install/user olması yayın hatası
kanıtı değildir ama gerçek cihaz teslimini de kanıtlamaz.

### OTA rollback

Hatalı grubun en son group ve runtime olduğundan emin olup:

```bash
npx eas-cli update:rollback <HATALI_GROUP_ID> \
  -m "rollback: <neden>" --non-interactive
```

CLI bir önceki grubu republish eder; yoksa embedded update’e rollback yayınlar.
Rollback de yeni bir update grubudur: metadata/insights ve iki cold start yeniden
kontrol edilir. Branch/channel işaretçisini elle oynatmak incident kanıtını bozar.

## 4 · Native rebuild

Şunlar OTA-able değildir:

- native module veya `app.json` plugin eklemek/çıkarmak;
- icon, splash, adaptive icon;
- Expo SDK, runtimeVersion veya native app config;
- signing/provision süresinin dolması.

Bu repo ücretsiz Apple kimliğiyle yerel cihaz build’i kullanır:

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npx expo run:ios --device
```

EAS Build/App Store hattına kendiliğinden geçilmez. `app.json` içindeki
`updates.requestHeaders.expo-channel-name=preview` ancak yeni native build’e CNG
tarafından gömüldüğünde kurulu uygulama için etkili olur. Ücretsiz signing yaklaşık
7 gün sonra yenilenebilir; bu product/runtime hatası değildir.

Android `com.toprak.helix` config ve OTA bundle’ı vardır; production store build,
imza ve fiziksel cihaz kabulü yapılmadan Android “shipped/verified” denmez.

## 5 · Supabase migration

Remote şema local dosyaların önüne geçirilmez. Migration paketi:

1. additive/backward-compatible şema ve app code ile protected PR/quality’den geçer;
2. merge sonrası linked remote’a uygulanır;
3. policy/constraint/index/RPC davranışı remote’da test edilir;
4. generated type commit’e alınır ve app web/OTA aynı şemayla yayımlanır.

Komutlar:

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npx --no-install supabase db push --linked
npx --no-install supabase migration list --linked
npx --no-install supabase db lint --linked
npx --no-install supabase test db --linked supabase/tests
npx --no-install supabase gen types typescript --linked > src/sync/database.types.ts
npm run typecheck
```

`migration list` local/remote version’ları birebir göstermeli; lint schema error
vermemeli; pgTAP A/B/anon owner izolasyonu ve yeni constraint/policy’yi test
etmelidir. Linked pgTAP CLI Docker isteyen ortamda çalışmıyorsa aynı SQL Supabase’in
resmî Management API database-query endpoint’inde `finish(true)` ile **tek
transaction + rollback** olarak çalıştırılır. Kalıcı test verisi bırakılmaz.

### Migration durumu

Linked şema `…01`–`…14` için senkrondur. Migration 12 monotonik tombstone
generation kontrolünü 16 synced tabloya ekler; migration 13 client tablo
grant'larını yalnız `SELECT/INSERT/UPDATE` olarak yeniden kurar ve public
varsayılanlarını fail-closed yapar; migration 14 statement natural-key unique
index'inin birebir kopyasını kaldırır. `migration list` local/remote sürümleri
birebir gösterir, public-schema lint temizdir ve linked CLI'nin rollback
transaction'ı üzerinden pgTAP 48/48 geçer.
`src/sync/database.types.ts` linked şemadan verbatim yeniden üretilmiştir (son
doğrulama 2026-07-22).

Yeni migration eklendiğinde bu iki komut yeniden koşulur ve sonuç
`docs/AI_HANDOFF.md` içindeki güncel duruma yazılır.

### Kabul edilen Supabase lint bulguları

Aşağıdakiler bilinçli kararlardır; tekrar “bulgu” olarak açılmamalıdır.

| Bulgu | Karar |
| --- | --- |
| `delete_own_account` — signed-in kullanıcı SECURITY DEFINER çağırabiliyor | Tasarım gereği. Kullanıcının **kendi** hesabını silmesi için var; gövde `auth.uid()` ile sınırlı, argüman yok, `search_path = ''`, `execute` yalnız `authenticated`. SECURITY INVOKER olamaz: kullanıcının `auth.users` üzerinde yetkisi yoktur. |
| 18 × `unindexed_foreign_keys` (INFO) | Eklenmiyor. Package 2C'de remote tablo/index istatistikleri, query outlier'ları ve gerçek planner yolları ölçüldü. Client hard-delete yapamaz; bu `(user_id, …)` FK index'lerinin esas kazancı nadir hesap-silme cascade'idir. Mevcut sorgu trafiğinde FK kolonlarını kullanan server yolu yoktur; 18 index ise her sync write'ını sürekli pahalılaştırır. Veri hacmi veya server sorgu modeli değişirse yeniden ölçülür. |
| 6 × `unused_index` (INFO) | Korunuyor. Beş `*_user_updated_id` index'i sync pull cursor'ının tam sıralamasıdır (`order updated_at, id` + `gt`); gerçek remote istatistikte aynı ailedeki aktif tablolar bu index'leri kullanır. `idx_tx_user_effective` için remote `EXPLAIN` ay aralığı sorgusunda index scan gösterir. Birebir kopya olan yedinci statement index'i migration 14 ile kaldırıldı. |
| `auth_leaked_password_protection` kapalı | **Plan sınırı, kod açığı değil.** HaveIBeenPwned kontrolü mevcut Supabase Free plan’de kullanılamıyor; repo’dan veya Dashboard’dan açılamaz. Ücretli plana geçilirse etkinleştirilecek opsiyonel kontroldür. Bulgu olarak yeniden açılmaz. |

## 5b · Dependabot bulguları

Her bulgu kendi advisory'si ve gerçek bağımlılık zinciri üzerinden yeniden
değerlendirildi.

| Uyarı | Sonuç | Kanıt |
| --- | --- | --- |
| `postcss` GHSA-qx2v-qp2m-jg93 | **Düzeltildi.** `overrides` ile 8.4.49 → 8.5.20 | `@expo/metro-config` `~8.4.32` pinliyordu; 8.5 semver-uyumlu minor. Tam release kapısı override ile yeşil geçti. |
| `uuid` GHSA-w5hq-g745-h8pq | **Düzeltildi.** Yalnız `xcode` altına scoped `uuid@^11.1.1` override’ı | Expo matrisi değişmedi; `xcode` UUID üretim smoke’u ve tam release kapısı yeni ağaçla geçer. |
| `esbuild` GHSA-67mh-4wv8-2f99 | **Kullanılmıyor.** Advisory `esbuild serve` dev sunucusunu hedefler | `drizzle-kit → @esbuild-kit/*` yalnız TS transpile için kullanılıyor; dev server hiç çalışmıyor. `^0.25.0` override'ı geçersiz npm ağacı ürettiği için uygulanmadı (AGENTS.md'nin uyardığı durum). |

Yeniden değerlendirme tetikleyicisi: bu paketlerden biri runtime yoluna girerse
ya da `drizzle-kit` `@esbuild-kit` bağımlılığını bırakırsa.

### Eski client uyumu ve DB rollback

- Önce nullable/additive kolon veya backward-compatible constraint; eski client
  yeni şemayla yaşamadan destructive rename/drop yapılmaz.
- Yeni union/kolon okuyan app, eski satır için açık fallback taşır.
- Migration rollback otomatik varsayılmaz. Veri dönüştüren migration’da down SQL
  kayıp yaratabilir; incident’ta önce forward-fix tercih edilir.
- App rollback yapılacaksa önceki client’ın mevcut remote schema ve yeni satırlarla
  çalıştığı test edilir.

### Database backup ve geri yükleme

Helix Supabase organizasyonu Free plan'dedir; platform otomatik database backup,
indirilebilir restore point veya PITR sağlamaz. `walg_enabled` platform iç
mekanizması tek başına kullanıcıya geri yüklenebilir yedek kanıtı değildir.
Dolayısıyla linked production database şu anda **restore edilebilir diye
sunulmaz**.

Destructive migration, toplu veri onarımı veya hesaplar arası taşıma öncesinde:

1. `supabase db dump --linked --data-only --use-copy` ile logical export alınır;
2. dosya repo/worktree dışında, owner'ın onayladığı şifreli off-site hedefte
   tutulur; issue, Actions artefact'ı veya commit'e eklenmez;
3. export izole bir Supabase project/database'e yüklenip temel satır sayıları ve
   owner/RLS testleri doğrulanır;
4. restore kanıtı ve saklama süresi release handoff'una yazılır.

Onaylı şifreli hedef ve izole restore ortamı tanımlı olmadığı sürece bu adım
`BLOCKED_EXTERNAL` kalır. Günlük 7 günlük platform backup veya PITR için plan
değişikliği gerekir ve açık owner onayı olmadan etkinleştirilmez. Üç günlük
keepalive yalnız Free project pause riskini azaltır; backup veya uptime garantisi
değildir.

Remote projede Storage bucket/object yoktur ve app Storage API'si kullanmaz;
bugünkü restore kapsamı Postgres logical dump + kullanıcının açık metin JSON
export'udur. Storage eklenirse database dump onu kapsamayacağı için object
inventory/export/restore testi aynı release'te bu prosedüre eklenmeden kontrol
tamamlanmış sayılmaz. Tombstone saklama, fiziksel purge ve hesap silme davranışının
tek kanonik açıklaması [PRIVACY.md](PRIVACY.md#saklama-silme-ve-taşınabilirlik)
içindedir.

## Test artefact’ları ve secret sınırı

Hangi anahtarın nerede durabileceği [SECURITY.md](SECURITY.md) “Rol ayrımı ve
secret’lar” tablosundadır; release sırasında o sınır değiştirilmez.

`dist-e2e/`, test result/video/trace ve Playwright HTML report ignore edilir.
Failure artefact’ı gerçek production veriyle üretilmez; yine de paylaşmadan önce
ekran/console içeriği kontrol edilir.

## Gözlemlenebilirlik ve incident

- Bundle bütçesi entry, lazy XLSX, font, toplam export ve public source-map
  yokluğunu bloklar. Tedarik zinciri kontrolleri [SECURITY.md](SECURITY.md)
  belgesindedir.
- Şu anda merkezi crash reporting, release-health alert veya source-map upload
  pipeline yoktur. Production logger yalnız PII'siz, cihaz-içi sınıflandırılmış
  hata kırıntısı tutar. Web health Pages run + canlı route; OTA adoption EAS
  insights ile elle izlenir. Sessiz hata otomatik ulaşmaz.
- Expo'nun en küçük resmî crash-only entegrasyonu olan Sentry değerlendirilmiştir,
  ancak provider hesabı, veri işleme/retention kararı, DSN ve private upload token'ı
  yoktur. Owner onayı olmadan SDK eklenmez veya cihazdan veri gönderilmez; kontrol
  `BLOCKED_EXTERNAL` ve mevcut release için non-blocking'dir.

Onay verilirse minimum rollout şudur:

1. Owner kontrollü ayrı web/iOS/Android project ve production/preview environment
   açılır; analytics, session replay, screen recording ve attachment kapalı kalır.
2. `sendDefaultPii=false` ve fail-closed scrub hook'u user/request/breadcrumb/
   extra alanlarını kaldırır; yalnız hata sınıfı/stack ile Git SHA, app version,
   EAS update/group ID, runtime, platform ve environment tag'leri kalır.
3. Provider'ın offline queue sınırı/retention'ı doğrulanır; finansal payload,
   e-posta, route paramı, id ve tutar queue'ya giremiyorsa entegrasyon açılmaz;
   sign-out/account switch queue temizliği cihazda test edilir.
4. Source map yalnız exact build/update sonrasında private symbolication alanına,
   sensitive ve upload-only token ile gider. Map Pages/OTA asset manifesti veya
   Actions artefact'ına girmez; token loglanmaz.
5. Sentetik verisiz render crash'i web + iki native platformda sembolike edilir.
   Yeni fatal olay release'i hemen triage'a alır; aynı unhandled hata 15 dakikada
   3 kez görülürse veya yeterli hacimde 24 saatlik crash-free session oranı
   `99,5%` altına düşerse OTA ilerlemesi durur/rollback değerlendirilir.

### Secret rotation ve incident response

Rotation bu audit'te yapılmaz. Gerçek sızıntıda önce credential iptal/rotation,
sonra kod/history temizliği yapılır; public key görünmesi secret sızıntısı gibi
ele alınmaz.

| Yüzey | Containment ve rotation | Doğrulama |
|---|---|---|
| Supabase `sb_publishable_*` | Client'ta görünmesi tasarım gereğidir; yetki RLS'tir. Abuse veya zorunlu rotation varsa yeni publishable key web + uyumlu OTA/native'e dağıtılır, eski client kullanımı bitmeden eski key kapatılmaz | Owner-only/anon pgTAP + web/native auth/sync smoke |
| Supabase `sb_secret_*` / service-role | Etkilenen keepalive workflow'u önce disable edilir; Dashboard'da yeni secret oluşturulur, GitHub `SUPABASE_SERVICE_ROLE_KEY` atomik güncellenir, manuel keepalive geçince eski key revoke edilir | Workflow run; eski key reddi; secret log/artefact yokluğu |
| Database password | Eski parola kullanan direct/pooler client'lar durdurulur; Dashboard'da reset edilir; yalnız onaylı secret store/connection güncellenip client'lar yeniden açılır | Linked CLI connection, migration equality/lint; tekrarlayan eski parola denemesi yok |
| GitHub / EAS access token | Token provider'da revoke edilir, account session/2FA ve audit log incelenir; gerekiyorsa least-privilege yenisi ilgili secret store'a yazılır. Repo workflow'ları built-in `GITHUB_TOKEN` kullanır; OTA için şu anda yalnız owner local EAS session'ı vardır | Repo Actions, Pages ve EAS update history'de bilinmeyen run/group yok |
| SMTP / dış API credential | Bugün yapılandırılmamıştır (`N/A`). Eklenirse önce provider'da rotate/revoke, sonra GitHub/EAS secret güncellemesi yapılır; uygulama bundle'ına `EXPO_PUBLIC_*` olarak konmaz | Provider test + bundle/Gitleaks taraması |
| Git/Apple/Android/update signing | Compromised Git SSH signing key GitHub'dan kaldırılıp yenisi eklenir. Apple provisioning/certificate veya Android key etkilenirse provider prosedürü ve yeni native build gerekir. Ek EAS Update code-signing key bugün yoktur; ekleme/rotation yeni runtime + binary ister, OTA tek başına yetmez | GitHub verified signature; yeni binary/runtime ve cihaz kabul kaydı |
| User session / JWT signing | Tek kullanıcı incident'ında global sign-out/admin session revoke; proje-geneli signing compromise'ında Supabase signing-key rotation ve eski key revoke ancak owner onayıyla yapılır. Account switch cleanup yine local workspace'i temizler | Eski refresh/access yolunun reddi ve yeniden login/sync smoke |

Incident sırası:

1. Etkilenen workflow/update/deploy yüzeyi durdurulur; credential rotate/revoke
   edilir. Secret chat, issue, terminal çıktısı veya kanıt dosyasına kopyalanmaz.
2. Private advisory içinde UTC zaman çizgisi, etkilenen commit, Pages run, EAS
   group/platform ID, runtime/channel, migration state ve redacted provider event
   kimlikleri korunur. Finansal veri, token, backup ve ham payload eklenmez.
3. Web kötü deploy'u protected revert PR'ıyla; OTA kötü grup republish/rollback
   ile; database olayı backward-compatible forward-fix ile düzeltilir. Kalıcı
   veri değişikliği gerekiyorsa önce doğrulanmış restore noktası şarttır.
4. Git history'den string silmek containment değildir: clone/fork/cache ve eski
   artefact geri çağrılamaz. Force rewrite ayrıca yasaktır ve ancak explicit
   owner onayıyla, rotation tamamlandıktan sonra ayrı incident kararı olabilir.
5. Post-incident bütün required checks/scanner'lar, remote Supabase kanıtı ve
   canlı smoke yeniden alınır; disclosure zamanlaması private report sahibiyle
   koordine edilir, sabit SLA vaat edilmez.

## Paket kapanış kontrolü

- Working tree temiz ve paket kapsamı `docs/AI_HANDOFF.md`’de.
- Typecheck, bütün Vitest suite’i, zero-warning lint, production export/budget ve
  Playwright suite’i temiz.
- PR’ın required `quality` check’i ve `main` Pages deploy’u başarılı.
- App code değiştiyse `preview` update aynı protected main commit’ten yayımlanmış.
- Migration varsa linked list/lint/pgTAP ve generated DB type güncel.
- Native config değiştiyse OTA teslim diye sunulmamış; build ve cihaz kabul sonucu açık.
- README/privacy/test/release metni gerçek özellik ve sınırlarla uyumlu.
- `docs/AI_HANDOFF.md` gerçek commit/run/group ID’leriyle kapanmış; dış kabul
  yoksa `BLOCKED`, yapılmış gibi değil.
