# Helix release sözleşmesi

Helix’in üç teslim yüzeyi vardır:

- GitHub Pages’te statik web uygulaması;
- EAS `preview` branch’inde Expo Go ile açılan SDK 54 update;
- gerektiğinde linked Supabase şeması.

Kod ve `.github/workflows/ci.yml` bu belgeden üstündür. Akış doğrudan
`main` üzerindedir; branch ve PR yoktur. Apple Developer, EAS Build, TestFlight,
Xcode, custom binary, development client ve store submission bu akışta yoktur.

## Değişiklik türü → teslim yolu

| Değişiklik | Web | Expo Go preview | Supabase |
|---|---|---|---|
| Yalnız docs/README | Yok | Yok | Yok |
| Yalnız test/CI/release script | Kontrol var, yayın yok | Yok | Yok |
| `src/**`, shipped asset veya app/runtime config | Pages | `preview`, iOS + Android | Yok |
| Expo Go dışı native dependency/plugin | Pages | Yayınlanabilir kabul edilmez | Yok |
| Forward-only migration + uyumlu app | Pages | App değiştiyse `preview` | Linked push + doğrulama |

Classifier mobil update’i uygulama/asset/config değişiklikleriyle sınırlar;
docs, tests, CI ve yalnız teslim aracını değiştiren dosyalar mobil yayın
başlatmaz. Android ve iOS için update üretilmesi signed binary veya fiziksel
cihaz kabulü anlamına gelmez.

## 1 · Yerel kapı, commit ve push

Kapının derinliği değişikliğin riskine göre seçilir: sıradan bir değişiklik
`npm run verify` ile davranış regresyonu ve `npm run test:e2e:smoke` ister;
para, veri, auth, sync, dependency, native/config/routing/shared primitive
veya CI'a dokunan ya da sonucu belirsiz bir değişiklik `npm run verify:full`
ister.

Node 22 kullanılmalıdır:

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npm run verify:full
```

`verify:release` ve `verify:skills` script’leri yoktur; skill paketi ayrı bir
komutla değil, `verify` zincirindeki `npm run control:check` ile doğrulanır.
İş bitince diff ve kapsam incelenir, commit imzalı atılır ve bir kez doğrudan
`main`e push edilir. Force push/history rewrite yoktur.

## 2 · GitHub CI ve web

`ci.yml` değişen yolları sınıflandırır. Tanınmayan yol fail-safe olarak tam E2E,
web build ve iki deploy’u da ister. Tek required sonuç `gate` job’ıdır; başarısız
veya iptal edilmiş her gerekli job yayını durdurur.

Web yayın yolu:

1. production publishable Supabase değerleriyle `expo export -p web --clear`;
2. bundle, font, toplam export ve source-map bütçesi;
3. root `index.html` → `404.html` kopyası;
4. aynı `dist` dizininin immutable Pages artefaktı olarak upload edilmesi;
5. yalnız başarılı gate sonrasında o artefaktın deploy edilmesi;
6. canlı root, `/upcoming` ve root HTML’nin gösterdiği entry JS için HTTP 200.

Deploy job’ı ikinci export yapmaz. Böylece ölçülen/test edilen byte’lar
yayımlanan byte’larla aynıdır. Bilinmeyen/dinamik URL’nin ilk HTTP cevabı GitHub
Pages nedeniyle 404 olabilir; root shell client router’ın doğru ekranı açmasına
izin verir.

```text
https://topraksv.github.io/helix/
https://topraksv.github.io/helix/upcoming
https://topraksv.github.io/helix/cash-flow/<YYYY-MM>
```

Rollback eski artefaktı elle seçerek değil, son sağlam commit’e yeni bir
`git revert` commit’i atıp aynı kapıdan geçirerek yapılır.

## 3 · Mobil EAS: Expo Go update

`app.json` runtime’ı `{ "policy": "sdkVersion" }` ile
`exposdk:54.0.0` olarak çözer. GitHub `deploy-mobile`, ancak gate yeşil ve
classifier shipped app/asset/config değişikliği saptamışsa, exact EAS CLI ile
doğrudan yayımlar:

```bash
npx eas-cli@21.4.0 update \
  --branch preview \
  --platform all \
  --message "main $GITHUB_SHA" \
  --clear-cache \
  --non-interactive
```

CLI sürümü kasıtlı olarak exact’tır; `@latest` denetlenmiş commit sonrasında
yayın davranışını değiştiremez. GitHub’daki `EXPO_TOKEN` zorunludur; yoksa job
açıkça kırmızı olur. Fingerprint, compatible-build lookup, EAS Build ve submit
komutları yoktur; Apple kimlik bilgisi istenmez.

Teslim kabulü ayrı kanıtlarla yapılır:

- GitHub gate ile `deploy-mobile` terminal sonucu;
- EAS update group’un `preview` branch, `exposdk:54.0.0`, iOS + Android ve tam
  Git commit metadata’sı;
- EAS dashboard veya `qr.expo.dev` group QR’ının Expo Go hedefi;
- yerel `npx expo start --tunnel --clear` komutunun Expo Go QR/`exp://` çıktısı;
- fiziksel cihaz denendiyse görünür kabul davranışı.

Expo Go kullanıcısı proje sahibi Expo hesabıyla oturum açmış olmalıdır. Yalnız
Expo Go-compatible modüller çalışır. Fiziksel cihaz testi yapılmadıysa yapılmış
sayılmaz. JS rollback’i aynı SDK runtime/branch üzerinde rollback veya sağlam
commit’i republish ederek yapılır; Expo Go dışı native değişiklik bu ücretsiz
teslim modelinde yayınlanamaz.

## 4 · Supabase migration

Migration’lar forward-only ve backward-compatible hazırlanır. Production
verisinde destructive komut veya linked `db reset` çalıştırılmaz. Değişiklik
varsa sıralama:

1. additive şema ve eski client uyumu;
2. yerel full doğrulama;
3. linked migration push;
4. local/remote migration eşliği;
5. `public` schema lint;
6. owner izolasyonu/RLS/RPC için linked pgTAP;
7. linked şemadan TypeScript type üretimi ve typecheck;
8. web ve mobil teslim.

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npx supabase db push --linked
npx supabase migration list --linked
npx supabase db lint --linked --schema public
npx supabase test db --linked supabase/tests
npx supabase gen types typescript --linked > src/sync/database.types.ts
npm run typecheck
```

Linked şema `…01`–`…14` için senkrondur; public lint temiz ve pgTAP 59/59’dur.
Default lint’in managed `extensions` pgTAP sembol uyarıları app şeması kusuru
değildir. Linked schema diff remote session pool nedeniyle
`EMAXCONNSESSION` verebilir; migration replay’i başarılı olsa da bu durumda
diff başarılı raporlanmaz.

Free plan geri yüklenebilir platform backup/PITR garantisi vermez. Destructive
migration veya toplu onarım öncesinde repo dışında şifreli logical dump alınır
ve izole ortamda restore doğrulanır; owner hedefi/restore ortamı yoksa işlem
`BLOCKED_EXTERNAL` kalır.

## 5 · Dependency, secret ve gözlemlenebilirlik

GitHub Actions tam commit SHA’larına, yayın yapabilen EAS CLI exact sürüme
sabitlidir. Expo-managed dependency matrisi koordineli SDK upgrade dışında
zorlanmaz. Registry audit kararları package adına göre değil reachability,
published tarball ve production bundle kanıtına göre verilir; güncel kalan risk
`SECURITY.md` içindedir.

Yalnız `EXPO_PUBLIC_*` publishable değerler client bundle’a girebilir.
`SUPABASE_SERVICE_ROLE_KEY` yalnız ayrı keepalive job’ındadır; job repository
token’ını `permissions: {}` ile alamaz. `EXPO_TOKEN` yalnız mobil deploy job’ına
verilir. Secret loglanmaz veya artefakta konmaz.

Merkezi crash reporting yoktur. Web health GitHub run + canlı smoke, mobil
sağlık EAS update metadata’sı ve yapıldıysa fiziksel cihaz kabulüyle izlenir.
Bu sınırlama görünür tutulur; cihaz kabulü veya otomatik crash telemetrisi
varmış gibi raporlanmaz.
