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

## 1.1.0

- **Ne değişti:** İşlemlere eklediğin fiş ve faturalar artık tüm cihazlarında açılıyor; uygulamaya aydınlatma metni eklendi ve Ayarlar'dan okunabiliyor; eşitleme belirgin şekilde hızlandı; Helix ikinci bir sekmede açıldığında çıkan ekran ne olduğunu anlatıyor ve diğer sekmeyi kapattığında kendiliğinden açılıyor.
- **Kimi ilgilendiriyor:** Birden fazla cihazda kullanan herkesi — belgeler artık ekledikleri cihaza bağlı değil. Hesap açmadan kullananlar için hiçbir şey değişmedi: veriler yine cihazdan çıkmıyor.
- **Ne yapmalısın:** Yayın öncesi 32–36 numaralı veritabanı göçlerini uygula. Uygulanana kadar uygulama eskisi gibi çalışır; belge eşitlemesi, hızlanma ve saklama süresi ancak göçler uygulandığında devreye girer.

## 1.0.0

- **Ne değişti:** 2026-09-02'ye kadar yapılmış her şey.
- **Kimi ilgilendiriyor:** Bu tarihe kadar uygulama `main`'den sürekli yayımlandı ve sürüm numarası taşımadı. Geriye dönük olarak birden çok sürüme bölünmedi: o dönemin doğru kaydı commit geçmişinin kendisidir ve sonradan uydurulan bir değişiklik kaydı doğru değildir.
- **Ne yapmalısın:** Bir şey yapmana gerek yok.
