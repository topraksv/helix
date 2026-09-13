# Değişiklik Kaydı

Her sürümde neyin değiştiği, en yeni üstte. Sürüm numarası `app.json`
içindeki `expo.version`'dır; nasıl seçildiği geliştiricinin kendi sürüm
defterinde yazılıdır ve bu depoya dahil değildir.

Notlar kısa tutulur: ne değişti, tek cümle. Sebebi ve ölçümü commit'te.

## 1.7.3

### Patch Changes

- Şifre yenileme bağlantısı, mail hangi tarayıcıda açılırsa açılsın şifre yenileme ekranını açıyor; önceden isteği yapan tarayıcı dışında giriş ekranı açılıyordu.
- Bağlantı saniyeler içinde "süresi dolmuş" demiyor: sayfayı açmak onu harcamıyor, yalnızca yeni şifreyi kaydettiğinde kullanılıyor.
- Eski şifreni yeniden seçince "şifre çok zayıf" yerine "yeni şifren eskisiyle aynı olamaz" yazıyor.
- Süresi dolmuş ya da kullanılmış bir bağlantıda kaydet'e basınca, yeni bağlantı isteyebileceğin ekran açılıyor.
- Şifre yenileme maili için Türkçe, yeni tasarımlı bir şablon hazırlandı.

## 1.7.2

### Patch Changes

- İçe aktarma, bu ayın taksitlerini artık sıfırlamıyor. Tablonun henüz doldurmadığı bir hücre "sıfır" sayılıyordu; Eylül'ün taksitleri iptal oluyor, Ekim ve Kasım'ınkiler görünüyordu.
- İlk kurulumdan sonra yapılan içe aktarma bakiyeyi doğru kuruyor. Kurulumda yazdığın "bugün elimde şu kadar var", dosyanın ilk ayına ait sanılıyor ve aradaki her satır üstüne ekleniyordu.
- Aynı dosyayı ikinci kez aktarmak bakiye düzeltmelerini koruyor; önceden ikinci aktarım onları siliyordu.
- Taksit kartında üstteki satır her zaman bulunduğun ayı gösteriyor; yanındaki sayaç ise barla birlikte, baktığın aya göre değişiyor.
- Bakiye kolonları diğer kolonlar gibi kalemle düzenleniyor. "Mali Tablo'da göster" yalnızca Ay Başı satırının altında.
- Mali Tablo'yu sona kaydırınca sağda boşluk kalmıyor; hiçbir kolon da bunun için genişletilmiyor.
- Geçmiş ay girişinde tutar alanları geniş ekranda daha geniş, tek sayıda kolon olduğunda son alan kendi sütununda kalıyor.
- Analizdeki tablo bulunduğun aya odaklı açılıyor; o ay pencerede yoksa son aya.
- Sıfırlama ekranında "tümünü seç" var.
- "Bu cihazda kalan kayıtlar", tablonun adının yanına kaydın kendisini de yazıyor.
- İlk kurulumda kredi kartı ekstre ve son ödeme günü opsiyonel; girilmezse taksit kendi ayına düşüyor.
- İçe aktarma bittiğinde kaç taksit planı kurulduğu yazıyor.

## 1.7.1

### Patch Changes

- Excel içe aktarımı, hangi kolonun gelir hangisinin gider olduğunu tablonun kendi bakiye formülünden okuyor; başlıktaki kelimeden değil.
- Bir hücre kendi değerinden fazlasını yazmıyor. Yorumunda taksit listesi olan hücre iki kez sayılıyordu: 23.672,13'lük ev kredisi tabloya 46.000 olarak düşüyordu.
- Aynı taksit iki ayrı isimle yazıldığında tek plan oluyor. Plan artık adıyla değil, takvimiyle tanınıyor.
- Excel'den kurulan taksit planları yalnızca tablonun yazmadığı aylara satır yazıyor.
- Ay başı bakiyesi, aktarılan en erken aya yazılıyor. O ay için rakam yoksa sıfırdan başlıyor.
- Tablo kendi bakiyesini elle yeniden başlattığı yerde uygulama da yeniden başlıyor; aradaki fark bir düzeltme satırı oluyor.

## 1.7.0

### Minor Changes

- Kredi kartı ekstresindeki taksitler Taksitler ekranına düşüyor: "3/9" diyen bir satır artık tek bir harcama değil, arkasındaki planın kendisi.
- Bir ekstre yalnız kendi ayına yazıyor. Ekran dönemi ve kartı soruyor; her satır o dönemin ödeme gününe düşüyor, alışveriş tarihi ayrıca saklanıyor.
- Ekstre satırı kendi kalemine oturuyor; hiçbiri tutmazsa kalemsiz kalıyor ve ekran bunu söylüyor.
- Mali Tablo'nun iki bakiye kolonunu yeniden adlandırabiliyor, ay başı kolonunu kapatabiliyorsun.
- Excel'de açılış bakiyesinin hangi kolondan okunacağını sen seçiyorsun; liste her kolonu vereceği rakamla gösteriyor.
- Excel'deki taksitler kolon başlığına bakılmadan okunuyor.
- Canlı piyasa kartındaki "Alış" gerçek tezgâha yaklaştı: satış fiyatından ölçülmüş bir makas düşülüyor — altın %1,25, dolar %0,22, euro %0,42.

### Patch Changes

- Veri sıfırlama, biten bir silmeye "hiçbir şey silinmedi" demiyor.
- Sıfırlama, planı silinmiş taksit satırlarını da alıyor; önceden her şeyi silen bir sıfırlamadan sonra bile bakiye kalıyordu.
- Mali Tablo, hiç kayıt olmayan yılları geri okuyla açmıyor.
- Taksitler ekranında ay okları yalnızca taksitin olduğu aylar arasında geziniyor.
- Mali Tablo hücresindeki kayıt satırı işyeri adıyla başlıyor.
- Abonelik maliyeti, aylık ve yıllık rakamı piyasa kartındaki düzenle veriyor.
- Sıfırlama ekranı, yatırım kapsamının cüzdanın açılış nakdini de sıfırladığını söylüyor.
- Boş yatırım grafiğinin yanındaki gereksiz açıklama kaldırıldı.

### Internal

- Bakım geçişi, onaylanamayan tek bir bekleyen ödeme yüzünden bütünüyle durmuyor.
- `matchStatementCategory`, `statementPlanSpec`, `parseBalanceColumns` ve kuyumcu makası için testler eklendi.

## 1.6.0

### Minor Changes

- Canlı piyasa verisi, cihazın fiyat kaynağına ulaşamadığı ağlarda da geliyor: istek önce doğrudan, olmazsa Supabase üzerinden yapılıyor.
- Piyasa detay ekranı beslemenin durumunu söylüyor — fiyat son bilinen değerse bunu, grafik çizilemiyorsa sebebini yazıyor.

### Internal

- Canlı Piyasalar ekranına altı e2e testi geldi; bu ekranın hiç tarayıcı kapsamı yoktu.
- `supabase/functions/market-proxy` sıkı bir izin listesiyle yazıldı: URL'i çağıran seçmiyor.

### Patch Changes

- Excel çıktısındaki varlık türleri uygulamanın kendi adlarını kullanıyor: "Kıymetli Maden", "Borsa", "BES".

## 1.5.0

### Minor Changes

- CSV çıktısı yerini Excel çıktısına bıraktı. Mali tablon her yıl kendi sayfasında iniyor; düzenleyip aynı sihirbazdan geri yükleyebiliyorsun.
- İçe aktarma sihirbazına şablon indirme geldi: bir yıllık boş bütçe tablosu, örnek rakamlarla.
- İçe aktarma artık yalnız Excel kabul ediyor.

### Patch Changes

- Durum ve Yatırımlar'daki ana tutar her girişte yerleşmiş rakamın hemen altından canlanıyor; Taksitler'deki aylık tutar da sayıyor.
- Mali Tablo'da içinde bulunulan ay her iki görünümde aynı şekilde boyanıyor; renk işareti taşıyan hücre de ayını gösteriyor.
- Abonelik satırında imleç vurgusu kartın kenarına yapışmıyor.
- İzlenen bir aboneliğin kimin olduğu "Sonraki" ile aynı şeritte yazıyor.
- Canlı piyasa detayında dönem değişimi, aralık ve kapanış tek blokta.
- Ödeme Yöntemleri formunda marka işareti ismin hizasında duruyor.
- Marka logoları tek boyutta çiziliyor; 16 piksellik logo yayımlayan kurumlar için daha iyi bir kaynak yok.

### Internal

- Marka işareti denetimi yenilendi.
- CSV'nin formül enjeksiyonu koruması `domain`'e taşındı ve tersine çevrilebilir yapıldı.
- Dışa aktarmaya satır tavanı eklendi.
- `.claude/rules/export-import-contract.md`: yeni bir alanın dışa aktarma yüzeyine de inmesini şart koşan kural.

## 1.4.3

### Patch Changes

- Site verisine izin vermeyen tarayıcılarda (Safari gizli mod, "tüm çerezleri engelle") giriş yapılamıyordu.
- Cihaz, çalışma alanının hangi hesaba ait olduğunu kaydedemediğinde giriş sürdürülmüyor; sebebi söyleyerek reddediyor.
- Hesap değiştirildiğinde tabloda sabitlenen satır ve kolon artık hesapla birlikte siliniyor.
- Tarayıcı belge deposunu kapattığında ekler sayfa yenilenene kadar kayıp görünüyordu.
- Klavyeyle kaydırılabilen alanlar tab durağı almıyordu.

### Internal

- Yönlendirme ve hedef-boyut e2e denetimleri artık gerçekten ölçüyor.
- `src/services/kv.ts` mutation taban kaydı eklendi; `release.yml` `gh release create`'in kendi hatasına bakıyor.

## 1.4.2

### Patch Changes

- Aydınlatma Metni'ne uygulamanın gerçekten istek attığı alıcılar eklendi: TCMB, exchangerate-api, Binance ve marka logosu için Google / DuckDuckGo / icon.horse.
- Geri bildirim satırı, e-posta adresinin de gönderildiğini söylüyor.
- "Hesap açmadan kullanabilirsiniz" cümlesi kaldırıldı — Helix hesapsız kullanılamıyor.
- 180 günlük hata kaydı süresini eşitlemenin tetiklediği yazıldı.
- Aydınlatma Metni ekranı klavyeyle kaydırılabiliyor.
- CHANGELOG ve README'deki iki kırık bağlantı kaldırıldı.

### Internal

- `DataGateScreen`: 20 ekranın tekrar ettiği yükleniyor çerçevesi tek bileşende.
- Lint ratchet (`lint-baseline.json`) ve gecelik "yayındaki sürüm" karşılaştırması.
- Tag'lerden otomatik GitHub Release.

## 1.4.1

### Patch Changes

- "Bu ay net değişim" ve benzeri satırların vurgusu çizgiye kadar uzanıyor.
- Hesap içinden şifre yenilendiğinde bağlantının hangi adrese gittiği yazıyor.
- Açık temada "Helix başka bir sekmede açık" ekranındaki durum yazısı okunur hale geldi.
- Şifre yenilendikten sonra çıkan "Expo Go'da Aç" düğmesi kaldırıldı.
- Piyasa detayında satış fiyatı üstte, alış altında; grafiğin altında aralığın en düşük ve en yüksek değeri ile değişim lira ve yüzde olarak yazıyor.

## 1.4.0

### Minor Changes

- Satır vurguları kartın kenarına kadar uzanıyor (özet, yaklaşanlar, ayarlar, hesap güvenliği, kurulum).
- Aydınlatma Metni onayı tek satıra indi: aynı yerde açılır, onaylanır, tekrar açılır.
- Giriş ekranındaki boşluklar tek ritme oturdu.
- Geri bildirimde yazı ya da ekran görüntüsü varken çıkılırsa uyarı veriliyor.
- Geri bildirimdeki Aydınlatma Metni bağlantısı gönderim notunun içine taşındı.
- Analizdeki sütun grafiğinde seçili sütun vurgulanıyor; vurgu ters yönde çalışıyordu.
- Pasta grafiğinde kilitlenen dilim koyu temada da görünüyor.
- Yatırım dağılımı telefonda da halka grafiği.
- Piyasa detayındaki grafik ekran açıkken kendini tazeliyor.
- Geri bildirim gönderimi hesap başına saatlik sınıra bağlandı.
- Tanıtım turu yalnızca hesap ilk kez oluşturulduğunda çıkıyor.
- Analizdeki pasta grafiği telefon genişliklerinde her zaman üstte, kategoriler altında.
- Giriş ekranındaki bağlantılar alt alta ve tek boyutta.
- Hesap oluşturma notu ülke adı yerine olan biteni söylüyor.
- Aydınlatma Metni onayı, onaylandığında görünür şekilde değişiyor.

## 1.3.0

### Minor Changes

- Kaydettikten hemen sonra "Düzenle"ye basınca az önce kaydedilen satır açılıyor.
- Okunamayan tutar "limit aşıldı" yerine okunamadığını söylüyor.
- Yapıştırılan `₺-5` eksi kalıyor; iade aynı büyüklükte harcamaya dönüşmüyor.
- Taksit önizlemesi kurulacak planla aynı rakamı gösteriyor.
- Yatırım işleminde hatalı tarih, tarih hatası olarak bildiriliyor.
- Eşitleme ve ekstre içe aktarma belirgin şekilde hızlandı.

## 1.2.0

### Minor Changes

- Uygulama telefonda yeniden açılıyor: Helix, Expo SDK 57'ye taşındı.
- App Store'daki Expo Go bir süredir eski sürümü çalıştıramıyordu; mobil taraf fiilen kapalıydı.
- Tarayıcıdaki görünüm ve davranış aynı kaldı.
- Önceki mobil güncelleme soyu kapandı; telefon yeni güncellemeyi bir kez indirir.

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
