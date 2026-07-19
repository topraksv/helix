# Helix gizlilik ve veri kullanımı

Bu belge Helix’in mevcut kodunun teknik veri davranışını açıklar; hukukî danışmanlık
veya üçüncü taraf hizmetlerin kendi gizlilik politikalarının yerine geçmez. Kod ile
bu metin ayrışırsa sorun olarak raporlanmalı, metin sessizce daha güçlü bir garanti
vermemelidir.

## Kısa cevap

- Finansal kayıtların önce cihazdaki SQLite veritabanına yazılır.
- Supabase yapılandırılmamışsa uygulama local-only çalışır; Helix sync backend’ine
  finansal veri göndermez.
- Hesaplı modda kayıtlar bağlantı olduğunda Supabase’e eşitlenir ve her satır
  kullanıcı kimliğiyle owner-only RLS altında tutulur.
- Helix reklam SDK’sı, davranışsal izleme veya production analytics/crash SDK’sı
  içermez.
- Bildirim izni boot sırasında istenmez; kilit ekranı finansal ayrıntıyı varsayılan
  olarak göstermez.
- Export edilen JSON/CSV dosyaları şifrelenmiş kasa değildir. Paylaşıldığı konumun
  korunması kullanıcının ve işletim sisteminin sorumluluğundadır.

## Hangi veri nerede tutulur?

| Veri | Local-only | Hesaplı mod | Not |
|---|---|---|---|
| İşlem, kategori, taksit, abonelik, düzenli gelir, kişi, ödeme yöntemi, bütçe, not, ayar | Cihaz SQLite | Cihaz SQLite + Supabase Postgres | Uygulamanın temel finansal verisi |
| Sync outbox/dead-letter/cursor | Cihaz SQLite | Cihaz SQLite; geçerli satırlar sync için Supabase’e gider | Bozuk event local karantinada kalır; payload UI’da gösterilmez |
| E-posta, auth identity | Yok | Supabase Auth | Şifre Helix tablolarında saklanmaz |
| Auth session | Yok | Native’de SecureStore; web’de Supabase’in browser storage’ı | Web browser profiline erişebilen kişi session’a erişebilir |
| Bildirim tercihi ve planı | Cihaz | Cihaz | Device-local; hesap değişiminde temizlenir |
| Kur cache’i | Cihaz | Kullanıcı-scoped cihaz/remote satırları | Kaynak tarihiyle tutulur |
| İç hata kırıntısı halkası | Cihaz | Cihaz | Bounded ve redacted; tutar/not/e-posta/token/payload kabul etmez; son kullanıcı ekranı değildir |

İşletim sistemi ve browser kendi backup/cache davranışına sahip olabilir. iOS native
build `NSFileProtectionComplete` entitlement’ı kullanır; app-created dosyalar cihaz
kilitliyken okunamaz. Bu, ayrı bir uygulama-seviyesi SQLCipher şifrelemesi değildir.
Web’de SQLite/OPFS ve `localStorage` güvenliği browser profili ve cihaz hesabının
güvenliğine bağlıdır.

## Sync ve yetkilendirme

Kullanıcı yazıları önce tek local transaction’da veri + outbox olarak kaydolur.
Bağlantıda push edilir, server’ın normalize ettiği `updated_at` cevabı alınır ve
sonra ilgili outbox event’i kaldırılır. Pull satırları runtime’da doğrulanır; bozuk
veya foreign veri cursor’ın arkasına saklanmaz.

Remote tablolarda:

- policy’ler `authenticated` rolüne ve `(select auth.uid()) = user_id` sahipliğine
  dayanır;
- insert/update `WITH CHECK` ile owner değişimi engellenir;
- owner-aware FK ve category/reference trigger’ları cross-account ilişkiyi reddeder;
- client’taki gizli buton veya route guard yetkilendirme kontrolü sayılmaz.

Service-role anahtarı uygulamaya veya `EXPO_PUBLIC_*` env’e konmaz. Client yalnız
Supabase anon/publishable anahtarını taşır; asıl erişim sınırı RLS’tir.

## Üçüncü taraf ağ istekleri

| Hizmet | Neden | Gönderilen/verilen | Sınır |
|---|---|---|---|
| Supabase | Auth ve isteğe bağlı sync | E-posta/auth protokolü; kullanıcıya ait finance satırları | Hesaplı modda; RLS owner-only |
| Expo EAS Update | Kurulu uygulamaya JS/asset update | Runtime/channel ve update istemi; ağ sağlayıcısı normal bağlantı metadata’sını görebilir | Finansal payload update isteğine eklenmez |
| GitHub Pages | Web uygulamasını sunmak | Normal HTTP metadata | Finansal veri app tarafında browser storage/Supabase akışındadır |
| TCMB | TRY kaynaklı resmî kur | Salt okunur GET | Timeout, boyut/şekil/tarih doğrulaması |
| Frankfurter | TCMB alınamazsa kur fallback’i | İstenen para birimi sembolleri | Salt okunur; kaynak tarihi zorunlu |
| Harem Altın websocket | Canlı altın/döviz piyasa kartı | Salt okunur socket bağlantısı | Resmî SLA yok; 60 sn feed sessizliğinde veri canlı sayılmaz. Son geçerli fiyatlar zaman damgasıyla cihazda saklanır (kişisel veri içermez); hesap makinesi çevirisi bu son kuru ancak zaman damgasını açıkça göstererek kullanır, deftere yazan dönüşümler yalnız 60 sn içinde teyitli canlı kuru kabul eder |
| Google favicon | Bilinen abonelik logosu | Sıkı doğrulanmış/encode edilmiş public domain | İstek `google.com/s2`'ye gider ve Google `*.gstatic.com`'a yönlendirir; utility, unknown, IP/local/invalid host gönderilmez; disk cache + local fallback var |

Uygulama production'da kendi doğrudan console log'unu üretmez. Development logger
token, şifre veya ham import verisi almamalıdır. Şu anda merkezi crash reporting
yoktur; yalnız kapsam, hata sınıfı ve zamanı içeren küçük bir cihaz-içi halka tutulur.

## Bildirim ve ekran gizliliği

- Bildirimler opt-in’dir; izin yalnız Ayarlar’daki kullanıcı eyleminden sonra
  istenir.
- Varsayılan preview genel bir yaklaşan ödeme mesajıdır. Ad/tutar yalnız ayrı
  device-local ayrıntı tercihi açılırsa kullanılır.
- Kapatma, çıkış ve hesap değişimi scheduled/presented hesap ayrıntılarını temizler.
- Scheduler en yakın 60 kaydı sınırlar; OS limitini sonsuz retry ile zorlamaz.
- Native app inactive/background olduğunda app switcher için finansal içeriği örten
  privacy surface çizilir. OS snapshot zamanlaması gerçek cihazda ayrıca kabul
  edilmelidir.
- Helix ekran görüntüsü almayı sistem çapında engellemez. Kullanıcı hassas ekranın
  screenshot’ını paylaşırken bunu açık veri paylaşımı olarak değerlendirmelidir.

## Import, export ve yedekler

JSON restore bütün bundle’ı sahiplik, UUID, duplicate ve referential integrity
açısından doğrulamadan yazı başlatmaz. Excel/CSV import satır/hücre/dosya ve ZIP
açılmış boyut/oran limitleriyle sınırlıdır; replace planı tek atomik transaction’da
uygulanır.

Export dosyaları açık metindir:

- güvenilmeyen cloud klasörü veya mesajlaşma kanalına yüklememek;
- iş bitince paylaşılan kopyaları silmek;
- formül çalıştırabilen spreadsheet uygulamalarında dış veriyi temkinli açmak;
- cihazı devretmeden önce Helix’ten çıkmak ve browser site data’sını temizlemek

kullanıcının sorumluluğundadır. Helix export’u parola ile şifrelediğini iddia etmez.

## Saklama, silme ve taşınabilirlik

- Canlı satırlar ve sync için gereken tombstone’lar hesap var olduğu sürece otomatik
  süre dolumuyla silinmez. Şu anda genel amaçlı scheduled retention/purge job’ı yoktur.
- Bir satırı uygulamada silmek onu geri alınabilir tombstone yapar; bu, hesabı
  kalıcı silmekle aynı değildir.
- Çıkış; background işi durdurur, bildirim/kur state’ini temizler ve local finance
  workspace’i siler. Hesaplı modda sonraki giriş remote veriyi yeniden çeker.
- **Hesabı Sil** önce security-definer olmayan, sabit `search_path`’li
  `delete_own_account` RPC ile `auth.users` identity’sini siler; `ON DELETE CASCADE`
  bütün app satırlarını aynı server transaction’ında kaldırır. Remote silme başarısızsa
  local veri silinmez ve işlem başarı gibi gösterilmez.
- JSON yedek ve CSV export veri taşınabilirliği yoludur. Import limiti dışındaki çok
  büyük hesaplar için henüz stream’li server export hizmeti yoktur.

## Kullanıcının yapabileceği kontroller

- Hesapsız/local-only kullanmak veya Supabase sync hesabı açmak.
- Bildirimleri ve ayrıntılı lock-screen preview’ı ayrı ayrı açıp kapatmak.
- Biometric app lock’ı desteklenen native cihazda açmak.
- JSON yedek ve CSV export almak; restore/import sonucunu uygulamada doğrulamak.
- Ayarlar → Hesap Güvenliği’nden çıkış, dondurma veya kalıcı hesap silme.

## Bilinen sınırlar ve iletişim

- Production telemetry/crash reporting olmadığı için sessiz hata maintainer'a
  otomatik ulaşmaz; destek sırasında kullanıcıdan yalnız sürüm ve yeniden üretim
  adımları istenir, finansal veri veya yedek istenmez.
- Android production store build’i ve fiziksel TalkBack/notification kabulü henüz
  doğrulanmış değildir; ayrıntı [TESTING.md](TESTING.md) cihaz matrisindedir.
- Harem akışı resmî değildir; yatırım kararı için kaynak kabul edilmemelidir.
- Bu belge bir uygulama mağazası privacy nutrition label’ı değildir. Store release
  öncesi dağıtım bölgesi ve güncel SDK davranışıyla hukukî/mağaza beyanı ayrıca
  hazırlanmalıdır.

Gizlilik veya veri silme problemi için repository maintainer’ına
[GitHub üzerinden](https://github.com/topraksv) ulaşılabilir. Güvenlik açığında ham
finansal veri, backup, token veya şifre public issue’ya eklenmemelidir.
