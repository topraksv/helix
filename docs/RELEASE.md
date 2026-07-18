# Helix release sözleşmesi

Helix iki ayrı hedefe çıkar: GitHub Pages web uygulaması ve `preview` channel
üzerindeki iOS/Android EAS Update. Birinin başarılı olması diğerini yayımlamaz.

## Web

1. Değişiklik ayrı bir branch ve pull request üzerinden `main`e gelir.
2. Zorunlu `quality` kontrolü `npm ci`, typecheck, bütün Vitest suite'i, Expo
   lint ve production web export çalıştırır.
3. Yalnız bu kontrol başarılıysa aynı workflow'un `deploy` job'u immutable
   Pages artefact'ını yayımlar.
4. Workflow URL'si ve sonuç commit'i `docs/AUDIT_TRACKER.md` release kaydına
   yazılır.

`main` branch protection; PR, güncel branch ve başarılı `quality` kontrolünü
zorunlu tutar. Bypass/force-push/delete kapalıdır.

## Mobil OTA

JS/asset-only bir commit için, tam kalite kapısından sonra aynı Git commit'ten:

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npx eas-cli update --channel preview -m "<kısa açıklama>" --non-interactive
```

`preview` channel remote'da `preview` branch'ine bağlıdır. Yayından sonra:

```bash
npx eas-cli channel:view preview --json --non-interactive
npx eas-cli update:insights <UPDATE_GROUP_ID> --json --non-interactive
```

Grup, iki platform update ID'si, runtime ve commit eşleşmeden paket kapanmaz.
Kurulu release build yeni update'i ilk cold start'ta indirir, bir sonraki cold
start'ta uygular; cihaz kabulü bu yüzden tam kapat/aç döngüsüyle yapılır.

## Native rebuild

Native modül/plugin, icon/splash, SDK, runtime veya native app config değişirse
OTA yeterli değildir. Bu repo ücretsiz Apple kimliğiyle yerel cihaz build'i
kullanır; ücretli EAS Build/App Store akışına kendiliğinden geçilmez:

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
npx expo run:ios --device
```

`app.json` içindeki `updates.requestHeaders.expo-channel-name=preview`, CNG
prebuild sırasında native iOS/Android config'e gömülür. P2 bu alanı eklediği
için kurulu eski binary'nin OTA alacağı iddia edilemez; bir sonraki yerel iOS
build'inden sonra `Updates.channel`/EAS teslimi iki cold start ile görülmelidir.

## Rollback

Hatalı son grubu, onun grup ID'siyle bir önceki update'e döndür:

```bash
npx eas-cli update:rollback <HATALI_GROUP_ID> \
  --message "rollback: <neden>" --non-interactive
```

Önceki grup yoksa CLI embedded update'e rollback yayımlar. Branch/channel
işaretçisini elle değiştirmek yerine aynı artefact'ı geri yayımlayan bu yol
kullanılır. Web için son sağlam Git commit'i yeni bir revert PR'ıyla geri al;
Pages geçmişindeki mutable artefact'a güvenme.

## Paket kapanış kontrolü

- Working tree yalnız paketin dosyalarını içeriyor.
- Typecheck, bütün testler, zero-warning lint ve production export temiz.
- PR `quality` check'i ve Pages deploy'u başarılı.
- App code değiştiyse `preview` update aynı commit'ten yayımlanmış.
- Native config değiştiyse OTA “teslim edildi” sayılmamış; cihaz build/kabul
  durumu açıkça kaydedilmiş.
- Tracker ve `docs/AI_HANDOFF.md` gerçek commit/run/update kimlikleriyle güncel.
