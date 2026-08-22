# Helix gizlilik ve veri kullanımı

Bu belge uygulamanın mevcut teknik veri davranışını açıklar; hukukî danışmanlık
ve üçüncü taraf politikalarının yerine geçmez. Kod ile metin ayrışırsa daha
güçlü bir garanti varsayılmaz, ayrışma hata olarak düzeltilir. Güven sınırları ve
artık riskler [`SECURITY.md`](SECURITY.md) belgesindedir.

## Kısa cevap

- Finansal kayıtlar önce cihazdaki SQLite veritabanına yazılır.
- Supabase yapılandırılmamışsa uygulama local-only çalışır ve finansal veriyi
  Helix sync backend'ine göndermez.
- Hesaplı modda kayıtlar bağlantı olduğunda Supabase'e eşitlenir; owner-only RLS
  her hesabı diğerinden ayırır.
- Reklam, davranış analitiği, session recording veya production crash SDK'sı
  yoktur.
- Bildirim izni açılışta istenmez; finansal lock-screen ayrıntısı varsayılan
  olarak kapalıdır.
- JSON ve CSV export şifreli kasa değildir.

## Verinin yeri

| Veri | Local-only | Hesaplı mod |
|---|---|---|
| İşlemler, kategoriler, bütçeler, notlar ve diğer finansal kayıtlar | Cihaz SQLite | Cihaz SQLite + kullanıcıya ait Supabase satırları |
| Sync outbox, cursor ve bozuk-satır karantinası | Cihaz | Cihaz; yalnız doğrulanmış satırlar gönderilir |
| E-posta ve auth identity | Yok | Supabase Auth |
| Auth session | Yok | Native'de SecureStore; web'de browser storage |
| Bildirim, biyometrik ve görünüm tercihleri | Cihaz | Cihaz |
| Tarihli döviz kuru snapshot'ları | Cihaz | Cihaz + kullanıcıya ait Supabase `fx_rates` satırları |
| Canlı piyasa fiyatı cache'i | Cihaz | Cihaz; kişisel finans payload'ı içermez |
| Redacted hata olayları | Son 12 olay cihazda | Cihaz + giriş yapılmışsa kullanıcıya ait Supabase `diagnostic_events` satırları |

İşletim sistemi ve browser kendi backup/cache davranışına sahip olabilir. iOS
build'i `NSFileProtectionComplete` ister, Android app backup'ı kapalıdır; Helix
SQLCipher gibi ayrı bir uygulama şifreleme katmanı kullanmaz. Web güvenliği
browser profili ve cihaz hesabına bağlıdır. Donanım ve OS davranışı ancak o
build'de yapılan cihaz kabulüyle doğrulanmış sayılır.

## Sync ve hesap sınırı

Her yazma veri + outbox olarak tek local transaction'a iner. Server'ın
normalize ettiği zaman damgası alınmadan event kaldırılmaz. Pull satırları
sahiplik ve şekil açısından doğrulanır; bozuk veya yabancı satır cursor'ın
arkasına saklanmaz. Tombstone nesli, uzun süre offline kalan eski bir cihazın
silinmiş kaydı ileri saatiyle diriltmesini engeller.

Yetkilendirme client butonunda değil Postgres RLS'tedir. Uygulama yalnız public
Supabase URL'i ve publishable anon anahtarını taşır; service-role anahtarı
client'a veya `EXPO_PUBLIC_*` değişkenine konmaz.

## Üçüncü taraf bağlantıları

| Hizmet | Amaç | Gönderilen veri |
|---|---|---|
| Supabase | İsteğe bağlı auth, sync ve redacted hata kaydı | E-posta/auth protokolü, hesaba ait finans satırları ve aşağıda sınırlanan hata metadata'sı |
| Expo EAS Update | Preview JS/asset update | Runtime/channel isteği; finansal payload yok |
| GitHub Pages | Statik web uygulaması | Normal HTTP bağlantı bilgisi |
| TCMB / exchangerate-api | TRY kurları | Salt okunur istek; kullanıcı verisi yok |
| Harem Altın websocket | Canlı piyasa kartı | Salt okunur bağlantı; kullanıcı verisi yok |
| Google favicon | Doğrulanmış abonelik domain'i için logo | Encode edilmiş public domain; bilinmeyen/local/IP host gönderilmez |

Kur ve piyasa yanıtları timeout, boyut, şekil, tarih ve tazelik sınırlarından
geçer. Resmî SLA'sı olmayan Harem verisi 60 saniye sessizlikten sonra canlı
sayılmaz. Uygulama kendi production console log'una finansal payload yazmaz.

Hata olayı; olay zamanı, internal scope, önem sınıfı, altı sabit hata kodundan
biri, platform ve app version taşır. Remote satır hesap kimliğiyle bağlıdır ama
mesaj, stack, e-posta, finansal değer, not, row payload veya cihaz kimliği
taşımaz. Yalnız sahibi RLS altında okuyup ekleyebilir; client değiştiremez veya
silemez. Remote kayıtlar genel süreyle purge edilmez, hesap silinince cascade
ile silinir. Bu first-party kayıtların otomatik alarmı veya üçüncü taraf crash
SDK'sı yoktur.

## Bildirim, export ve import

Bildirimler opt-in'dir. Varsayılan preview nötrdür; ad ve tutar için ayrı
device-local tercih gerekir. Bildirime dokunulduğunda ilgili kaydın açılması
için taşınan payload yalnız hedef türü ve kayıt id'sidir: tutar, ad veya rota
içermez. Ayrıntılı preview kapalıyken payload kayıt kimliğini de bırakır, çünkü
o durumda tek bir nötr hatırlatma o günün tamamını temsil eder. Çıkış, hesap değişimi ve remote session iptali
hesaba ait bildirim ve cache durumunu temizler. App inactive/background iken
finansal içeriğin üstüne privacy cover çizilir; gerçek snapshot zamanlaması
cihazda kabul edilmelidir.

Android bunu çizerek yapamaz. React Native'in `AppState`'i `inactive` durumunu
yalnız iOS'ta yayar; Android `background`'ı ancak uygulama gittikten sonra
bildirir, sistem görev görüntüsünü çoktan almış olur. Bu yüzden Android'de
koruma pencere bayrağıyla kurulur (`FLAG_SECURE`): önizlemeyi işletim sistemi
karartır, render yarışı olmaz. Aynı bayrak ekran görüntüsünü ve ekran kaydını
da engeller ve Android bu ikisini ayırmaya izin vermez, bu yüzden yalnız hesap
açıkken tutulur — hesapsız (local-only) kullanımda ekran görüntüsü çalışmaya
devam eder.

Kredi kartı ekstresi PDF'i yalnızca cihazda okunur: Helix dosyayı saklamaz,
kopyalamaz ve hiçbir yere göndermez. Okunamayan, taranmış veya parola korumalı
bir PDF tahmin edilmez; nedeni söylenerek reddedilir. Ekstreden okunan hiçbir
satır sen onaylamadan deftere yazılmaz.

İşleme eklediğin belgelerin (fiş, fatura, garanti) yalnızca kaydı eşitlenir;
dosyanın kendisi onu eklediğin cihazda kalır. Başka bir cihaz o dosyayı
göremez ve bunu açıkça söyler. Yedek dosyası da belgelerin kaydını taşır,
içeriklerini taşımaz.

Restore, bundle'ın sahiplik, UUID, duplicate ve referential-integrity kontrolü
bitmeden yazmaz. Spreadsheet ve JSON yollarında dosya, açılmış ZIP, satır, hücre
ve metin limitleri vardır. Export açık metindir; güvenilmeyen cloud klasörüne
veya mesajlaşma kanalına yüklememek, paylaşılan kopyayı silmek ve cihazı
devretmeden önce çıkış/browser verisi temizlemek kullanıcının sorumluluğundadır.

## Saklama ve silme

- Bir kaydı silmek onu sync/undo için tombstone yapar; hesap silme değildir.
- Çıkış local workspace'i ve hesaba ait cache/bildirimleri temizler, remote
  finansal veriyi silmez. Senkronize edilmemiş satır kaybı ayrıca onaylanır.
- Hesap dondurma veri veya token silmez; diğer cihazların da gördüğü kilit
  bayrağını yazar ve bu cihazın oturumunu kapatır. Çalınmış token için parola
  değişimi veya hesap silme gerekir.
- **Hesabı Sil**, yalnız oturum sahibini hedefleyen argümansız
  `delete_own_account` RPC'siyle auth identity'yi ve cascade edilen app
  satırlarını tek server transaction'ında kaldırır. Remote işlem başarısızsa
  local veri başarı gibi silinmez.
- Genel süreli fiziksel purge yoktur; cihaz-ack watermark olmadan böyle bir
  purge eski offline cihazların silinen veriyi yeniden üretmesine yol açabilir.

Otomatik crash alarmı olmadığı için sessiz hata maintainer'a otomatik ulaşmaz.
Destek sırasında finansal veri veya backup yerine yalnız sürüm ve yeniden üretim
adımları paylaşılmalıdır. Android store build'i ve fiziksel cihaz kabulü henüz
kanıtlanmış değildir. Native suite'in kapsamı ve sınırları
[`e2e/native/README.md`](../e2e/native/README.md) dosyasındadır.

Gizlilik veya veri silme sorusu için repository maintainer'ına
[GitHub üzerinden](https://github.com/topraksv) ulaşılabilir. Güvenlik açığı
public issue yerine [`SECURITY.md`](SECURITY.md) içindeki özel kanaldan
bildirilmelidir.
