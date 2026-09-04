# Değişiklik Kaydı

Yayımlanan her sürüm, en yeni üstte. Her sürüm, o sürümde neyin değiştiğini
maddeler hâlinde yazar — kullanıcının gördüğü şeyle, kısa cümlelerle.

Yayımlanan sürüm numarası `app.json` içindeki `expo.version`'dır.
`package.json` aynı değeri taşır ve `tests/release-config.test.ts` ikisinin
ayrışmasını reddeder. Aynı test en üstteki başlığın o sürüm olmasını ve her
sürümün en az bir madde taşımasını şart koşar — yani bu dosya güncellenmeden
sürüm yükseltilemez, ki bu kaydın boş kalmamasının tek gerçek garantisi budur.

Numaranın nasıl seçileceği ve etiketin nasıl atılacağı
[`docs/RELEASE.md`](docs/RELEASE.md) belgesindedir.

## 1.4.0

- Satır vurguları kartın kenarına kadar uzanıyor; ortada asılı kalmıyor (özet, yaklaşanlar, ayarlar, hesap güvenliği, kurulum).
- Aydınlatma Metni onayı tek satıra indi: aynı yerde açılır, onaylanır, istenirse tekrar açılır. "Metni yeniden aç" bağlantısı kalktı.
- Giriş ekranındaki düğme, bağlantı ve not arasındaki boşluklar tek ritme oturdu; alttaki üç ayrı satır tek satır oldu.
- Geri bildirimde yazı ya da ekran görüntüsü varken çıkılırsa uyarı veriliyor; gönderilmemiş rapor sessizce kaybolmuyor.
- Geri bildirimdeki Aydınlatma Metni bağlantısı, gönderim notunun içine taşındı.
- Analizdeki sütun grafiğinde seçili sütun vurgulanıyor; eskiden vurgu ters yönde çalışıyordu.
- Pasta grafiğinde kilitlenen dilim koyu temada da görünüyor.
- Yatırım dağılımı telefonda da halka grafiği: analiz ekranındakiyle aynı yapı, dokununca kilitleniyor.
- Piyasa detayındaki grafik ekran açıkken kendini tazeliyor; yanındaki fiyatla arası açılmıyor.
- Geri bildirim gönderimi hesap başına saatlik sınıra bağlandı.
- Tanıtım turu yalnızca hesap ilk kez oluşturulduğunda çıkıyor; mevcut hesapla yeni bir tarayıcıda ya da telefonda giriş yapmak artık turu tekrar açmıyor.
- Analizdeki pasta grafiği telefon genişliklerinde her zaman üstte, kategoriler altında; halka artık kendi grafiğinin küçük yarısı olamıyor.
- Giriş ekranındaki bağlantılar alt alta ve tek boyutta: "Şifremi unuttum", "Yeni hesap oluştur", "Zaten hesabım var, giriş yap". Yarım cümle bağlantılar kalktı.
- Hesap oluşturma notu ülke adı yerine olan biteni söylüyor; aktarımın nereye ve neden olduğu Aydınlatma Metni'nde.
- Aydınlatma Metni onayı, onaylandığında görünür şekilde değişiyor: yeşil onay kutusu ve metni yeniden açan "Görüntüle".

## 1.3.0

- Kaydettikten hemen sonra "Düzenle"ye basınca az önce kaydedilen satır açılıyor.
- Okunamayan tutar artık "limit aşıldı" yerine okunamadığını söylüyor.
- Yapıştırılan `₺-5` eksi kalıyor; iade aynı büyüklükte harcamaya dönüşmüyor.
- Taksit önizlemesi kurulacak planla aynı rakamı gösteriyor.
- Yatırım işleminde hatalı tarih, tutar hatası yerine tarih hatası olarak bildiriliyor.
- Eşitleme ve ekstre içe aktarma belirgin şekilde hızlandı.

## 1.2.0

- Uygulama telefonda yeniden açılıyor: Helix, Expo'nun güncel sürümüne (SDK 57) taşındı.
- App Store'daki Expo Go bir süredir eski sürümü çalıştıramıyordu; mobil taraf fiilen kapalıydı.
- Tarayıcıdaki görünüm ve davranış aynı kaldı; veriler, hesaplar ve eşitleme değişmedi.
- Önceki mobil güncelleme soyu kapandı, telefon yeni güncellemeyi bir kez indirir.

## 1.1.0

- İşlemlere eklenen fiş ve faturalar tüm cihazlarda açılıyor.
- Uygulamaya aydınlatma metni eklendi, Ayarlar'dan okunabiliyor.
- Eşitleme belirgin şekilde hızlandı.
- İkinci sekmede açılınca çıkan ekran ne olduğunu anlatıyor ve diğer sekme kapanınca kendiliğinden açılıyor.
- Yayın öncesi 32–36 numaralı veritabanı göçleri uygulanmalıdır.

## 1.0.0

- 2026-09-02'ye kadar yapılmış her şey.
- Bu tarihe kadar uygulama `main`'den sürekli yayımlandı ve sürüm numarası taşımadı; o dönemin doğru kaydı commit geçmişinin kendisidir.
