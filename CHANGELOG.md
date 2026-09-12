# Değişiklik Kaydı

Yayımlanan her sürümde neyin değiştiği, en yeni üstte. Sürüm numarası
`app.json` içindeki `expo.version`'dır; nasıl seçildiği geliştiricinin kendi
sürüm defterinde yazılıdır ve bu depoya dahil değildir.

## 1.7.1

### Patch Changes

- Excel içe aktarımı, tablonun kendi bakiye formülünü okuyor. Hangi kolonun gelir, hangisinin gider olduğunu ve hangilerinin bakiyeye hiç girmediğini artık başlıktaki kelimeye değil, senin "Kalan" ya da "Güncel Bakiye" hücrendeki formüle bakarak belirliyor. "Ek" gibi adı bir şey söylemeyen bir gelir kolonu gider sayılmıyor, "Düzenleme Tarihi" gibi para olmayan bir kolon tabloya girmiyor.
- Bir hücre kendi değerinden fazlasını yazmıyor. Yorumunda taksit listesi olan hücre önceden atlanıyor, yerine yorumdan kurulan planlar yazılıyordu; hücrede 23.672,13 yazan ev kredisi tabloya 46.000 olarak düşüyordu. Artık hücrede ne yazıyorsa tabloya o giriyor.
- Aynı taksit iki isimle yazıldığında tek plan oluyor. Bir sayfada "Ev Kredisi", diğerinde "Kredi" yazan tek bir kredi, aynı tutar ve aynı vade olmasına rağmen iki plan açıyor ve her ayı iki kez borçlandırıyordu. Plan artık adıyla değil, takvimiyle tanınıyor.
- Excel'den kurulan taksit planları yalnızca tablonun yazmadığı aylara satır yazıyor. Tablonun doldurduğu bir ay o taksiti zaten kolon toplamının içinde taşıyor; planın eklediği şey, tablonun bittiği yerden sonrası.
- Ay başı bakiyesi, aktarılan en erken aya yazılıyor. Önceden ilk bakiye kolonunu taşıyan yıl neredeyse oraya yazılıyordu, ondan önceki aylar geriye doğru hesaplanıp eksiye düşüyordu. O ay için bir rakam veren kolon yoksa sıfırdan başlıyor.
- Tablonun kendi bakiyesini elle yeniden başlattığı yerde uygulama da yeniden başlıyor. Bir sayfa "ay başında elimde şu kadar vardı" diyorsa ve önceki aylar o rakamı tutmuyorsa, aradaki fark bir düzeltme satırı olarak yazılıyor; böylece o aydan sonrası tablonun kendi rakamlarıyla birebir aynı gidiyor.

## 1.7.0

### Minor Changes

- Kredi kartı ekstresindeki taksitler Taksitler ekranına düşüyor. Bir satır "3/9" diyorsa artık tek bir harcama değil, arkasındaki planın kendisi yazılıyor: ilk taksitin ayı, toplam adedi ve aylık tutarıyla. Aynı planın bir sonraki ekstresi aynı plana denk geliyor, yanına ikincisini açmıyor.
- Bir ekstre yalnız kendi ayına yazıyor. Ekran artık dönemi ve kartı soruyor; kabul edilen her satır o dönemin ödeme gününe düşüyor, satırın üstündeki tarih alışverişin yapıldığı gün olarak saklanıyor. Önceden her satır kendi tarihine gidiyordu ve bir temmuz ekstresi, içindeki alışverişlerin yapıldığı bütün aylara dağılıyordu.
- Ekstre satırı kendi kalemine oturuyor. İşyeri adı kolon adlarından biriyle eşleşiyorsa oraya, eşleşmiyorsa uygulamanın kendi Türkçe sözlüğüyle aynı konuyu anlatan kolona gidiyor; hiçbiri tutmazsa kalemsiz kalıyor ve ekran bunu söylüyor. Önceden her satır ilk gider kolonuna yazılıyor, bu da hiçbir yerde belirtilmiyordu.
- Mali Tablo'nun iki bakiye kolonu artık senin. Kolonlar ekranının altından ikisini de yeniden adlandırabilir, ay başı kolonunu kullanmıyorsan kapatabilirsin.
- Excel'de açılış bakiyesinin hangi kolondan okunacağını sen seçiyorsun. Başlık kuralının bulduğu kolon bir varsayım; liste artık tablonun bütün kolonlarını, her birinin vereceği rakamla birlikte gösteriyor.
- Excel'deki taksitler kolon başlığına bakılmadan okunuyor. Taksitini ve tek çekimini aynı kolonda tutan bir tablo önceden hiç plan üretmiyordu.
- Canlı piyasa kartındaki "Alış" gerçek tezgâha yaklaştı. Emir defterinin iki tarafı birbirine yapışık olduğu için kart, altını aldığın fiyata satabileceğini söylüyordu; satış fiyatından ölçülmüş bir makas düşülüyor — altın %1,25, dolar %0,22, euro %0,42.

### Patch Changes

- Veri sıfırlama, biten bir silmeye "hiçbir şey silinmedi" demiyor. Silme tek bir işlemde tamamlanıyor; sonraki toparlama adımı aksarsa bu ayrıca söyleniyor, kayıtlar gitmişken seni tekrar denemeye göndermiyor.
- Sıfırlama, planı silinmiş taksit satırlarını da alıyor. Bu satırları hiçbir kapsam sahiplenmiyordu; her şeyi silen bir sıfırlamadan sonra bile Durum ekranında bir bakiye kalıyordu.
- Mali Tablo, hiç kayıt olmayan yılları geri okuyla açmıyor. Bir yıllık veriyi on yıllık bir tablodan aktarınca geri kalan dokuz yıl boş satırlarla geziliyordu.
- Taksitler ekranında ay okları yalnızca taksitin olduğu aylar arasında geziniyor; geri gidince ileri gelebiliyorsun.
- Mali Tablo hücresindeki kayıt satırı işyeri adıyla başlıyor; "Harcama · 3 Ağustos" altına geçti.
- Abonelik maliyeti, aylık ve yıllık rakamı piyasa kartındaki alış/satış düzeniyle veriyor.
- Sıfırlama ekranı, yatırım kapsamının cüzdanın açılış nakdini de sıfırladığını söylüyor.
- Boş yatırım grafiğinin yanındaki "grafik sıfırdan başlıyor" cümlesi kaldırıldı; halkanın kendisi zaten boş.

### Internal

- Bakım geçişi, onaylanamayan tek bir bekleyen ödeme yüzünden bütünüyle durmuyor; kart ekstresi taraması ve gecikme işaretlemesi o satırın arkasında kalmıyor.
- `matchStatementCategory`, `statementPlanSpec`, `parseBalanceColumns` ve kuyumcu makası için testler eklendi; sıfırlamanın "her şey, tüm tarihler" sözü tek bir uçtan uca testle ölçülüyor.

## 1.6.0

### Minor Changes

- Canlı piyasa verisi, cihazın ulaşamadığı ağlarda da gelebiliyor. Fiyat kaynağı bazı ağlarda çözümlenmiyor ve uygulamanın buna karşı yapabileceği bir şey yoktu; istek artık önce doğrudan deneniyor, olmazsa Supabase üzerinden yapılıyor. Ulaşabilen bir cihaz bu ek adımı hiç ödemiyor.
- Piyasa detay ekranı beslemenin durumunu söylüyor. Fiyat son bilinen değerse bunu yazıyor, grafik çizilemiyorsa sebebini — "Piyasa servisine ulaşılamıyor" — söylüyor. Önceden yalnız "geçmiş veriye ulaşılamıyor" diyordu ve bu, okuyanı bir grafik hatası aramaya gönderiyordu.

### Internal

- Canlı Piyasalar ekranına altı e2e testi geldi; bu ekranın daha önce hiç tarayıcı kapsamı yoktu ve iki kez baştan yazılmıştı.
- `supabase/functions/market-proxy` sıkı bir izin listesiyle yazıldı: URL'i çağıran seçmiyor, fonksiyon kendisi kuruyor. Altı test bu sınırı kaynağından doğruluyor.

## 1.5.1

### Patch Changes

- Excel çıktısındaki varlık türleri, uygulamanın kendi adlarını kullanıyor: "Kıymetli Maden", "Borsa", "BES" — dosya artık aktarıldığı ekranla aynı şeyi söylüyor. Önceki sürümde "Metal", "Hisse" ve "Emeklilik" yazıyordu.

### Internal

- Canlı Piyasa ekranına e2e kapsamı geldi. Ekran iki kez baştan yazılmış ama CI'da hiçbir tarayıcı açmamıştı; artık beslemeye ulaşılamadığında sebebini söylediği, cevap geldiğinde fiyatı, grafiği ve aralık bloğunu çizdiği ve dört aralık seçeneğinin de cevap verdiği ölçülüyor.
- `knip`'in gösterdiği altı gereksiz export kaldırıldı ve ay adları `buildLedgerGrids`'e dışarıdan geçirilmiyor; denetim artık hiçbir şey bulmuyor.

## 1.5.0

### Minor Changes

- CSV çıktısı yerini Excel çıktısına bıraktı. Mali tablon her yıl kendi sayfasında, aboneliklerin ve yatırımların ayrı sayfalarda iniyor; Mali Tablo sayfasını Excel'de düzenleyip aynı sihirbazdan geri yükleyebiliyorsun. Abonelik ve yatırım sayfaları okumak için.
- İçe aktarma sihirbazına şablon indirme geldi: bir yıllık boş bütçe tablosu, örnek rakamlarla. Doldurup geri yüklenebiliyor — elinde uygun bir tablo yoksa başlangıç noktası.
- İçe aktarma artık yalnız Excel kabul ediyor; ekranın adı da "Excel'den İçe Aktar".

### Patch Changes

- Durum ve Yatırımlar'daki ana tutar her girişte yeniden canlanıyor, ama sıfırdan değil — yerleşmiş rakamın hemen altından. Taksitler'deki aylık tutar da artık sayıyor.
- Mali Tablo'da içinde bulunulan ay, satır odaklı ve kolon odaklı görünümde aynı şekilde boyanıyor. Renk işareti taşıyan bir hücre de artık ayını gösteriyor: vurgu işaretin yerine geçiyordu, artık üstünde duruyor.
- Abonelik satırında imleç üzerine gelince yanan alan kartın kenarına yapışmıyor; iki yanında da eşit bir boşluk kalıyor.
- İzlenen bir aboneliğin kimin olduğu, "Sonraki" ile aynı şeritte rozet olarak yazıyor.
- Canlı piyasa detayında dönem değişimi, aralık ve kapanış tek blokta; değişim en büyük figür ve tek renkli olan.
- Ödeme Yöntemleri formunda marka işareti, ismin hizasında duruyor — etiketle input'un ortasında değil.
- Marka logoları tek boyutta çiziliyor. Yedi servis, markaların kendi siteleri, kardeş alan adları ve Wikipedia ölçüldü: 16 piksellik logo yayımlayan kurumlar için daha iyi bir kaynak yok, o yüzden küçük ama keskin yerine aynı boyda tercih edildi. Ada Bank ve ICBC kendi `.com` adreslerinden tam boy geliyor.

### Internal

- Marka işareti denetimi yenilendi; birkaç alan adının en iyi kaynağı değişmişti.
- CSV'nin formül enjeksiyonu koruması silinmedi, `domain`'e taşındı ve tersine çevrilebilir yapıldı — dışa aktarılan dosya geri okunduğu için.
- Dışa aktarmaya satır tavanı eklendi; JSON yedeğinin hep vardı, bunun yoktu.
- `.claude/rules/export-import-contract.md`: yeni bir alanın dışa aktarma yüzeyine de inmesini şart koşan duran kural.

## 1.4.3

### Patch Changes

- Site verisine izin vermeyen bir tarayıcıda (Safari gizli mod, "tüm çerezleri engelle") giriş yapılamıyordu: hesap aslında doğrulanmış oluyor, ekran "İşlem tamamlanamadı" diyor ve her deneme aynı yerde aynı şekilde başarısız oluyordu.
- Cihaz, çalışma alanının hangi hesaba ait olduğunu kaydedemediğinde giriş artık sürdürülmüyor; gerçek sebebi söyleyerek reddediyor. Bu kayıt, cihazdaki verinin başka bir hesaba açılmamasını sağlayan tek işaret.
- Hesap değiştirildiğinde tabloda sabitlenen satır ve kolon, önceki hesabın kaydı olarak cihazda kalıyordu. Yeni hesaba hiç gösterilmiyordu, ama artık hesapla birlikte siliniyor.
- Tarayıcı belge deposunu kapattığında (depolama temizliği ya da başka bir sekmenin şema yükseltmesi) ekler, sayfa yenilenene kadar kalıcı olarak kayıp görünüyordu.
- Klavyeyle kaydırılabilen alanlar tab durağı almıyordu; bunu kuran kanca hiç çalışmıyormuş.

### Internal

- Yönlendirme ve hedef-boyut e2e denetimleri artık gerçekten ölçüyor: sabit kalan bir yolu "yönlendirme olmadı" sanan bekleme kaldırıldı, SC 2.5.8 istisnası yalnızca yüksekliği kapsıyor.
- `src/services/kv.ts` mutation taban kaydı eklendi; `release.yml` artık `gh release create`'in kendi hatasına bakıyor.

## 1.4.2

### Patch Changes

- Aydınlatma Metni'ne uygulamanın gerçekten istek attığı alıcılar eklendi: TCMB, exchangerate-api, Binance, ve marka logosu için Google / DuckDuckGo / icon.horse. Sonuncular yazdığın kurumun alan adını görüyor.
- Geri bildirim satırı, e-posta adresinin de gönderildiğini söylüyor.
- "Hesap açmadan kullanabilirsiniz" cümlesi kaldırıldı — Helix hesapsız kullanılamıyor.
- 180 günlük hata kaydı süresini eşitlemenin tetiklediği yazıldı.
- Aydınlatma Metni ekranı klavyeyle kaydırılabiliyor (`scrollable-region-focusable`).
- CHANGELOG ve README'deki iki kırık bağlantı kaldırıldı.

### Internal

- `DataGateScreen`: 20 ekranın tekrar ettiği yükleniyor çerçevesi tek bileşende.
- Lint ratchet (`lint-baseline.json`) ve gecelik "yayındaki sürüm" karşılaştırması.
- Tag'lerden otomatik GitHub Release.

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
