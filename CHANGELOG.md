# Değişiklik Kaydı

Yayımlanan her sürüm, en yeni üstte. Her sürüm üç satır:

1. **Ne değişti** — kullanıcının gördüğü şeyle, tek cümle.
2. **Kimi ilgilendiriyor** — neden önemli, kimi etkiliyor.
3. **Ne yapmalısın** — bir eylem gerekiyorsa o; gerekmiyorsa öyle yazar.

Yayımlanan sürüm numarası `app.json` içindeki `expo.version`'dır.
`package.json` aynı değeri taşır ve `tests/release-config.test.ts` ikisinin
ayrışmasını reddeder. Aynı test en üstteki başlığın o sürüm olmasını ve her
sürümün üç satırını da şart koşar — yani bu dosya güncellenmeden sürüm
yükseltilemez, ki bu kaydın boş kalmamasının tek gerçek garantisi budur.

Numaranın nasıl seçileceği ve etiketin nasıl atılacağı
[`docs/RELEASE.md`](docs/RELEASE.md) belgesindedir.

## 1.3.0

- **Ne değişti:** Kaydettikten hemen sonra "Düzenle"ye basınca artık az önce kaydettiğin satır açılıyor, listeye geri atılmıyor. Okunamayan bir tutar "limit aşıldı" yerine okunamadığını söylüyor, yapıştırılan `₺-5` eksi kalıyor, taksit önizlemesi kurulacak planın kendisiyle aynı rakamı gösteriyor ve yatırım işleminde hatalı tarih artık tarih hatası olarak bildiriliyor. Eşitleme ve ekstre içe aktarma belirgin şekilde hızlandı.
- **Kimi ilgilendiriyor:** Kaydedip hemen düzenleyen, taksitli alışveriş giren ya da iade yapıştıran herkesi — bunların hepsi sessizce yanlış davranıyordu. Hız farkını en çok defteri büyümüş ve birden fazla cihazda eşitleyen kullanıcı görür; eşitleme her satır için ayrı ayrı sorduğu soruyu artık sayfanın tamamı için bir kez soruyor.
- **Ne yapmalısın:** Bir şey yapmana gerek yok. Veritabanı göçü yok, verilerine dokunulmuyor.

## 1.2.0

- **Ne değişti:** Uygulama telefonda yeniden açılıyor. Helix, Expo'nun güncel sürümüne (SDK 57) taşındı; App Store'daki Expo Go bir süredir eski sürümü çalıştıramıyordu, yani mobil taraf fiilen kapalıydı. Tarayıcıdaki görünüm ve davranış aynı.
- **Kimi ilgilendiriyor:** Telefonunda Expo Go ile kullanan herkesi — kapalı olan yol yeniden açılıyor. Yalnızca tarayıcıdan kullananlar için görünen hiçbir şey değişmiyor; veriler, hesaplar ve eşitleme aynı kalıyor.
- **Ne yapmalısın:** Telefonunda Expo Go'yu güncelle ve Helix'i yeniden aç. Veritabanı göçü yok, verilerine dokunulmuyor. Önceki mobil güncelleme soyu bu sürümle kapanıyor, o yüzden telefon yeni güncellemeyi bir kez indirir.

## 1.1.0

- **Ne değişti:** İşlemlere eklediğin fiş ve faturalar artık tüm cihazlarında açılıyor; uygulamaya aydınlatma metni eklendi ve Ayarlar'dan okunabiliyor; eşitleme belirgin şekilde hızlandı; Helix ikinci bir sekmede açıldığında çıkan ekran ne olduğunu anlatıyor ve diğer sekmeyi kapattığında kendiliğinden açılıyor.
- **Kimi ilgilendiriyor:** Birden fazla cihazda kullanan herkesi — belgeler artık ekledikleri cihaza bağlı değil. Hesap açmadan kullananlar için hiçbir şey değişmedi: veriler yine cihazdan çıkmıyor.
- **Ne yapmalısın:** Yayın öncesi 32–36 numaralı veritabanı göçlerini uygula. Uygulanana kadar uygulama eskisi gibi çalışır; belge eşitlemesi, hızlanma ve saklama süresi ancak göçler uygulandığında devreye girer.

## 1.0.0

- **Ne değişti:** 2026-09-02'ye kadar yapılmış her şey.
- **Kimi ilgilendiriyor:** Bu tarihe kadar uygulama `main`'den sürekli yayımlandı ve sürüm numarası taşımadı. Geriye dönük olarak birden çok sürüme bölünmedi: o dönemin doğru kaydı commit geçmişinin kendisidir ve sonradan uydurulan bir değişiklik kaydı doğru değildir.
- **Ne yapmalısın:** Bir şey yapmana gerek yok.
