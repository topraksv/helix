# Değişiklik Kaydı

Yayımlanan her sürümde neyin değiştiği, en yeni üstte. Sürüm numarası
`app.json` içindeki `expo.version`'dır; nasıl seçildiği geliştiricinin kendi
sürüm defterinde yazılıdır ve bu depoya dahil değildir.

## 1.4.2

### Patch Changes

- **Aydınlatma Metni artık uygulamanın konuştuğu her yeri sayıyor.** Metin dört alıcı adı geçiriyordu; ölçüldüğünde dokuz taneydi.

  - Eklenenler: döviz kuru için **TCMB** ve **exchangerate-api**, piyasa kotasyonu için **Binance**'in halka açık verisi, ve bir abonelik ya da ödeme yöntemine tanınan bir kurum adı yazıldığında logosunu getiren **Google**, **DuckDuckGo** ve **icon.horse**.
  - Sonuncusunda gidenin ne olduğu da yazıyor: bağlantı bilgisi ve yazılan adın karşılık geldiği alan adı — yani hangi bankayı yazdığınız — ve bu isteğin siz kaydetmeden, yazarken gittiği.
  - Geri bildirim satırı e-postanızın da gönderildiğini söylüyor. Uygulamanın geri bildirim ekranı bunu zaten yazıyordu; Aydınlatma Metni yazmıyordu.

- **"Hesap açmadan kullanabilirsiniz" çıkışı kalktı, çünkü öyle bir mod yok.** Helix bir hesapla kullanılıyor: oturumu olmayan bir okuyucuyu `resolveRootGuard` giriş ekranına yolluyor ve hesapsız çalışma alanı yalnızca Supabase yapılandırması taşımayan derlemede — yani yayınlanmayan test artefaktında — açılıyor. Metin artık aktarımı kabul etmemenin tek yolunun hesap açmamak olduğunu söylüyor, ve bu kural artık guard'ın kendisine karşı test ediliyor.

- **180 günlük hata kaydı saklama süresinin nasıl uygulandığı düzeltildi.** Silmeyi uygulama her eşitlemede başlatıyor; uygulamayı bir daha açmazsanız çağrı da yapılmıyor. Metin bunu veritabanının kendiliğinden yaptığı izlenimi veriyordu.

- **Aydınlatma Metni ekranı kaydırma alanını kendisi klavyeye açıyor.** 655 piksellik pencerede 3594 piksel metin, içinde odaklanabilir hiçbir şey olmadan duruyordu; `scrollable-region-focusable` ihlali buradan geliyordu. Chromium ve Firefox bu alanı kendiliğinden odaklıyor, ama uygulama artık bu nezakete güvenmiyor. Aynı taramaya daha önce hiç bakılmamış altı rota eklendi.

- **Yayımlanan depodaki iki kırık bağlantı kaldırıldı.** CHANGELOG ve README, bu depoya dahil olmayan dosyalara link veriyordu; ikisi de ziyaretçi için 404'tü.

### Internal

- Yirmi ekranın tekrar ettiği "veri hazır değilken ne göster" bloğu tek bir `DataGateScreen` bileşenine indi; her ekranın kendi başlığı ve genişliği korunarak.
- Lint artık bir ratchet: `lint-baseline.json` kayıtlı sayıları tutuyor ve bir kural daha sık tetiklenirse push düşüyor. Bugünkü taban 262 uyarı, 0 hata.
- Gecelik iş artık yayındaki paketin sürümünü `app.json` ile karşılaştırıyor. "main yeşil, üretim eski" durumunun bugüne kadar hiçbir alarmı yoktu.

## 1.4.1

### Patch Changes

- "Bu ay net değişim" satırının ve benzerlerinin vurgusu artık çizgiye kadar uzanıyor; hesabı dondur ile hesabı sil arasındaki fazla boşluk da aynı sebepten kalktı.
- Hesap içinden şifre yenileme istendiğinde "bu adresle bir hesap varsa" denmiyor; bağlantının hangi adrese gittiği yazıyor.
- Açık temada "Helix başka bir sekmede açık" ekranındaki durum yazısı okunur hale geldi (2,07 kontrasttan çıktı).
- Şifre yenilendikten sonra çıkan "Expo Go'da Aç" düğmesi kaldırıldı; tek yol giriş yapmak.
- Piyasa detayında satış fiyatı üstte büyük, alış hemen altında daha küçük. Grafiğin altında artık aralığın en düşük ve en yüksek değeri ile değişim hem lira hem yüzde olarak yazıyor; alttaki uzun açıklama tek cümleye indi.

## 1.4.0

### Minor Changes

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

### Minor Changes

- Kaydettikten hemen sonra "Düzenle"ye basınca az önce kaydedilen satır açılıyor.
- Okunamayan tutar artık "limit aşıldı" yerine okunamadığını söylüyor.
- Yapıştırılan `₺-5` eksi kalıyor; iade aynı büyüklükte harcamaya dönüşmüyor.
- Taksit önizlemesi kurulacak planla aynı rakamı gösteriyor.
- Yatırım işleminde hatalı tarih, tutar hatası yerine tarih hatası olarak bildiriliyor.
- Eşitleme ve ekstre içe aktarma belirgin şekilde hızlandı.

## 1.2.0

### Minor Changes

- Uygulama telefonda yeniden açılıyor: Helix, Expo'nun güncel sürümüne (SDK 57) taşındı.
- App Store'daki Expo Go bir süredir eski sürümü çalıştıramıyordu; mobil taraf fiilen kapalıydı.
- Tarayıcıdaki görünüm ve davranış aynı kaldı; veriler, hesaplar ve eşitleme değişmedi.
- Önceki mobil güncelleme soyu kapandı, telefon yeni güncellemeyi bir kez indirir.

## 1.1.0

### Minor Changes

- İşlemlere eklenen fiş ve faturalar tüm cihazlarda açılıyor.
- Uygulamaya aydınlatma metni eklendi, Ayarlar'dan okunabiliyor.
- Eşitleme belirgin şekilde hızlandı.
- İkinci sekmede açılınca çıkan ekran ne olduğunu anlatıyor ve diğer sekme kapanınca kendiliğinden açılıyor.
- Yayın öncesi 32–36 numaralı veritabanı göçleri uygulanmalıdır.

## 1.0.0

### Major Changes

- 2026-09-02'ye kadar yapılmış her şey.
- Bu tarihe kadar uygulama `main`'den sürekli yayımlandı ve sürüm numarası taşımadı; o dönemin doğru kaydı commit geçmişinin kendisidir.
