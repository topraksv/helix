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
2. Commit öncesi Node 22 ile en az:

   ```bash
   export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
   npm run typecheck
   npm test
   npx expo lint
   npm run test:e2e
   ```

4. PR aç. Protected `main`; güncel branch, PR ve required `quality` check’i ister;
   admin bypass, force-push ve delete kapalıdır.
5. `quality` tek release kapısıdır: `npm ci` → typecheck → Vitest → lint →
   production export → bundle budget → Playwright Chromium/E2E.
6. Check geçmeden merge/deploy/OTA yoktur.

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

Release sonrası en az aşağıdaki URL’ler status 200 ve uygulama shell’iyle kontrol
edilir:

```text
https://topraksv.github.io/helix/
https://topraksv.github.io/helix/cash-flow/<YYYY-MM>
https://topraksv.github.io/helix/upcoming
https://topraksv.github.io/helix/settings
```

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
npx eas-cli update --branch preview \
  -m "<kısa, davranış odaklı özet>" --non-interactive
```

Bu projede kurulu test build’i `preview` channel → `preview` branch ve runtime
`1.0.0` sözleşmesini kullanır. `--branch preview`, channel mapping’i sessizce
değiştirmeden o branch’e update ekler.

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

### Bekleyen migration: 00000000000008_function_search_path.sql

Supabase database linter `set_updated_at` fonksiyonunu
`0011_function_search_path_mutable` altında raporluyor. Migration yazıldı ama
**linked projeye uygulanmadı**: bu ortamda Supabase CLI, Docker ve psql yok.
Uygulanana kadar `migration list --linked` bu sürümü yalnız local gösterir.

Uygulamak için yukarıdaki `db push --linked` akışı ya da Supabase SQL Editor
yeterli; fonksiyon `create or replace` olduğu için mevcut trigger’lar aynı
fonksiyonu göstermeye devam eder, trigger yeniden oluşturulmaz.

Kapanış kriteri: `db lint --linked` çıktısında bu uyarı kalmamalı.

### Kabul edilen Supabase lint bulguları

Aşağıdakiler bilinçli kararlardır; tekrar “bulgu” olarak açılmamalıdır.

| Bulgu | Karar |
| --- | --- |
| `delete_own_account` — signed-in kullanıcı SECURITY DEFINER çağırabiliyor | Tasarım gereği. Kullanıcının **kendi** hesabını silmesi için var; gövde `auth.uid()` ile sınırlı, argüman yok, `search_path = ''`, `execute` yalnız `authenticated`. SECURITY INVOKER olamaz: kullanıcının `auth.users` üzerinde yetkisi yoktur. |
| 18 × `unindexed_foreign_keys` (INFO) | Eklenmiyor. Bu FK’ler `(user_id, …)` bileşenli ve tek kullanıcılık veri hacmi küçük; kapsayıcı index’in kazandıracağı tek yol hesap silme cascade’i (ömürde bir kez). 18 index her yazmayı yavaşlatır, karşılığı yok. |
| 7 × `unused_index` (INFO) | Silinmiyor. `*_user_updated_id` index’leri sync pull cursor’ının tam olarak kullandığı sıralamadır (`order updated_at, id` + `gt`); `idx_tx_user_effective` ay aralığı sorgularını karşılar. Tablolar bugün seq scan tercih edilecek kadar küçük olduğu için “unused” görünüyorlar — veri büyüdüğünde gereken index’ler bunlar. |
| `auth_leaked_password_protection` kapalı | Remote Auth ayarı; repo’dan değiştirilmez. Açılması önerilir (Dashboard → Authentication → Password). Bu denetimde uzaktan ayar değiştirilmedi. |

## 5b · Dependabot bulguları

Üçü de geçişli bağımlılık. Her biri kendi advisory'si ve gerçek bağımlılık
zinciri üzerinden yeniden değerlendirildi.

| Uyarı | Sonuç | Kanıt |
| --- | --- | --- |
| `postcss` GHSA-qx2v-qp2m-jg93 | **Düzeltildi.** `overrides` ile 8.4.49 → 8.5.20 | `@expo/metro-config` `~8.4.32` pinliyordu; 8.5 semver-uyumlu minor. Tam release kapısı (export + bütçe + 15 Playwright) override ile yeşil. |
| `uuid` GHSA-w5hq-g745-h8pq | **Geçersiz bulgu.** Advisory `v3/v5/v6` + `buf` argümanı gerektirir | `xcode`'un tek çağrısı `pbxProject.js:90`'da argümansız `uuid.v4()`. Pakette v3/v5/v6 kullanımı yok. Ayrıca prebuild aracı, bundle'a girmiyor. |
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

## Environment ve secret sınırı

| Değer | Nerede olabilir? | Not |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | `.env`, CI workflow, client bundle | Public endpoint |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `.env`, CI workflow, client bundle | Publishable; güvenlik sınırı RLS |
| Supabase service-role / `sb_secret_*` | Yalnız GitHub Actions secret/maintainer environment | Client, log, README ve artefact’a girmez |
| EAS auth/session | Maintainer makinesi veya güvenli CI secret | Commit edilmez |
| Signing material | OS keychain/provisioning | Repo’ya ve OTA artefact’ına eklenmez |

`dist-e2e/`, test result/video/trace ve Playwright HTML report ignore edilir.
Failure artefact’ı gerçek production veriyle üretilmez; yine de paylaşmadan önce
ekran/console içeriği kontrol edilir.

## Artefact, gözlemlenebilirlik ve incident

- Actions SHA’ları full commit’e pinlidir; npm/Actions Dependabot haftalık çalışır.
- SheetJS CDN tarball npm audit/Dependabot görünürlüğü dışında olduğundan import
  değişikliğinde upstream release ayrıca kontrol edilir.
- Bundle bütçesi entry, lazy XLSX, font ve toplam export büyümesini bloklar.
- Şu anda merkezi crash reporting, release-health alert ve uploaded source-map
  pipeline yoktur. Production logger kullanıcıya teknik bir yüzey göstermez;
  yalnız PII'siz, cihaz-içi sınıflandırılmış hata kırıntıları tutar.
- Minimum incident kanıtı: Git commit, Pages run, EAS group/platform IDs,
  runtime/channel, migration list/lint/pgTAP sonucu ve kullanıcı
  adımları. Token, ham payload, backup veya finansal tutar incident issue’suna eklenmez.
- Web availability GitHub Pages run + live route probe; OTA health EAS insights ile
  kontrol edilir. Sessiz single-user app hatalarının otomatik alarmı olmadığı açıkça
  kabul edilir.

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
