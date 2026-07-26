# Faz 2 — operasyon kılavuzu

Yapıştıracağın komutlar ve her adımda ne görmen gerektiği. Kural yok — kurallar
[`PHASE2.md`](PHASE2.md) ve [`AGENTS.md`](../AGENTS.md) içinde, agent onları
zaten okuyor. Burada sadece **sen ne yapıyorsun** yazıyor.

## Kullanımı

Sırayı bozma, bir paket kapanmadan sonrakine geçme. Numara bir isim, sıra değil
— P4 nerede koşarsa koşsun P4.

**Claude Code'da:**

```
/paket P7
```

**Codex'te** (slash komutu yok, agent `AGENTS.md`'yi zaten okuyor):

```
Faz 2 paketi P7'yi çalıştır. Adımlar docs/PHASE2.md § How a package runs
içinde; onları takip et. Tasarımı onaylatmadan kod yazma.
```

İkisi de aynı altı adımı koşar. Fark yalnızca hangi araçları çağırdıkları.

**Biten:** P0 → P1 → P4 → P2. **Geri çekilen:** P3.
**Kalan sıra: P7 → P6 → P9.** P5 ve P8 backlog'da.

## Her turun şekli

Her pakette aynı beş durak var. İkisinde sen konuşuyorsun.

| Durak | Ne olur | Sen ne yaparsın |
|---|---|---|
| 1. Zemin | Kodu ve bağımlı paketleri doğrular | — |
| 2. **Tasarım** | Plan çıkarır, onay ekranı gelir | **Onayla / düzelt** |
| 3. Uygulama | Kod, `/simplify`, `verify`, review | — |
| 4. **Kanıt** | Ne değişti, testler, açık riskler | **Onayla / düzelt** |
| 5. Sevk | Branch, PR, CI, merge, handoff | Merge onayı |

Kod plan onayından önce yazılmaya başlarsa: **Esc**, sonra `Önce plan mode.`

## Düzeltme cümleleri

Hangi pakette olursan ol geçerli. Gördüğün sorunun karşısındakini yapıştır.

| Gördüğün | Yapıştır |
|---|---|
| **Şartnamedeki her maddeyi sorgusuz uygulamış** | `Şartname istek listesi, spesifikasyon değil. Her maddenin bedelini çıkar; pahalı olanı yapmadan önce bana itiraz et. En küçük çözüm kazanır.` |
| Yeni dosya/servis/store yığını, ya da mevcut bir primitive'in kopyası | `Bu kaç yeni dosya? Her biri için hangi mevcut yapının yetmediğini tek cümleyle yaz. Yetiyorsa onu kullan.` |
| Görünmesi imkânsız bir durum, ya da gerekçesi yazılamayan savunma kodu | `Bunu kullanıcı hangi gerçek senaryoda görüyor / bu hangi olay sırasını engelliyor? Yazamıyorsan arkasındaki kodu da yazma.` |
| Veri katmanına UI parametresi (`writeRows`, repo imzaları) | `Sunum katmanı veri katmanına girmiyor. Progress/cancel çağıranın kendi seviyesinde.` |
| İlerleme "satır" sayıyor | `İlerleme kullanıcının birimiyle sayılır: ay, kayıt, dosya, yıl. Veritabanı satırı değil.` |
| **Ölçmeden "düzeldi" demiş** | `Bunu neyle ölçtün? Renkse kontrast oranı, genişlikse gerçek fontla ölçüm, sağlayıcıysa çağrılan uç, bağımlılıksa açılan tarball. Sayı göster.` |
| **Aynı hatanın tek örneğini düzeltip sınıfı kapatmış** | `Bu hook/desen kaç yerde çağrılıyor? Hepsini oku, sonra hangilerinin gerçekten hatalı olduğunu söyle.` |
| Sadece değiştirdiği testi koşmuş | `Tek test dosyası kanıt değil. npm run verify koş.` |
| Bir özelliğin sadece bir parçasını yapıp "bitti" demiş | `Bu özellik kaç mekanizmadan oluşuyor? Değeri taşıyan parçayı yap, ya da özelliği bana karşı savunup küçült. Artığı teslim etme.` |
| Elle renk (`palette.x + "14"`) veya çıplak ölçü (`width: 120`) | `src/ui/ içinde çıplak değer olmaz. Token ekle; renkse tüm paletlere ve theme-contrast'a.` |
| Kapsam dışına taşma | `Bu paketin kapsamı PHASE2.md'de yazılı. Dışındakini not et, yapma.` |
| Kanıt yok, ya da baseline'a bakmadan güncellemiş | `Kanıt yok. verify çıktısını, değişen dosyaları ve varsa actual/diff görsellerini göster.` |
| Cihazda doğrulanmamışı doğrulanmış sayma | `Bu cihazda denenmedi. Öyle yaz.` |
| Owner kararını sorup beklemek yerine uygulamış | `Bu karar bana ait. Seçenekleri sun, uygulama.` |
| Metin üç noktayla kırpılmış | `Üç nokta yasak. Sar, kısalt veya düzeni değiştir.` |

## Paketler

Her paket için: yapıştıracağın komut, tasarım onayında **görmen gereken**,
**görürsen durman gereken**, ve konuşmamız gereken nokta.

---

### P0 — Faz 2 kurulumu ✅

Bu dosya, `PHASE2.md` ve `/paket` komutu. Ürün değişikliği yok.

---

### P1 — Görsel imza · `/paket P1`

Feature 2 (yüklenme) + Feature 4 (paletler).

✅ **Görmen gereken:** `Palette` şekli değişmiyor, `theme.ts` içinde palet
kaydı; tercih `kv helix.palette`; `theme-contrast.test.ts` sözleşmesi korunup
tüm paletler üzerinde döngüye alınıyor; loader tarafında tek gecikme eşiği +
çağıranın kendi fazlarından gelen ilerleme + bekleme görünürken iptal +
settings'teki 3 `ActivityIndicator`'ın tekleştirilmesi.

❌ **Durdur:** paralel bir tema sistemi; renklerin runtime'da üretilmesi
(`hsl()` hesabı); mavi/mor accent; **nefes alan logo** — konu kalıcı olarak
kapatıldı, öneri olarak bile getirilmeyecek; **takılma sayacı (`stalled`) ve
ayrı `retry` yolu** — iptal beklemeyle birlikte görünür, tekrar denemek zaten
butonun kendisi.

✅ **Kararlar alındı:** paletler Kil / Kum / Tarçın (#4); yüklenme markası
kalıcı olarak kapalı (#6). P1'de sorulacak bir şey kalmadı.

**Merge'ten sonra bir kez:** geri alma tatbikatı yap.
`git revert -m 1 <P1-merge>` → `npm run verify` → revert'i geri al. Makinenin
çalıştığını sekizinci pakette değil şimdi gör.

---

### P2 — Navigasyon kabuğu · `/paket P2`

Feature 1 (cam footer).

✅ **Görmen gereken:** `<Tabs tabBar={…}>` ile tek özel bileşen; içerik payı
hâlâ `tabBarHeight()`'tan; web'de gerçek `backdropFilter`, native'de katmanlı
yüzey; Reduce Transparency / Increase Contrast → düz yüzey; sekme sayısı **aynı**.

❌ **Durdur:** yeni bağımlılık (`expo-blur`, `reanimated`); native'de "blur"
denen ama blur olmayan şey; footer'ın kaybolması; `Screen` dışında ikinci bir
padding hesabı.

☎️ **Konuşalım:** yok. Sekme sayısı burada değişmiyor.

---

### P3 — Privacy Peek · **geri çekildi**

Yayına girdi, aynı gün kaldırıldı. Sebebi ve çıkarılan ders
[`PHASE2.md`](PHASE2.md#p3--privacy-peek--withdrawn-2026-07-26) içinde. Bu paket
çalıştırılmaz.

---

### P4 — Genişletilmiş döviz · `/paket P4`

✅ **Görmen gereken:** `FETCHED_FX_CURRENCIES` genişliyor, kaynak TCMB ∩
Frankfurter (ikisi de anahtarsız); tek `CurrencyPicker` mevcut dialog üstünde;
özet kartı **hiç değişmiyor**; `marketSellRateTry` 60 sn sözleşmesi aynı.

❌ **Durdur:** istemciye gömülen API anahtarı; uzun listenin segmented control'e
sıkıştırılması; para birimi değişince girilen tutarın sessizce çevrilmesi;
eski snapshot'ın "güncel" gösterilmesi.

☎️ **Konuşalım:** liste 15'ten uzunsa hangileri kalsın.

---

### P5 — Scenario Lab · **backlog**

✅ **Görmen gereken:** kendi tabloları; mevcut projection kodunu **okuyor**;
gerçek kayıt/outbox üretmiyor; "plan olarak uygula" açık onay + özet;
kesin/planlanan/senaryo değerleri etiketle ayrı.

❌ **Durdur:** senaryonun dashboard toplamlarına sızması; uydurma güvenlik
tamponu; projection matematiğinin kopyalanması.

☎️ **Konuşalım:** 6 şablonun hangileri olacağı.

---

### P6 — Yatırım · `/paket P6` ⚠️ en riskli domain işi

✅ **Görmen gereken:** yatırım nakdi mevcut transfer makinesini kullanıyor;
alış = transfer, gider değil; satış sonrası K/Z ayrı satır ve **senin açık
seçiminle**; tüketim kategorilerine dokunulmuyor; fiyatlar tarihiyle,
canlı gibi değil; yanlış toplam üretmemek için yazılmış testler.

❌ **Durdur:** paralel bir defter; yatırım hareketlerinin gelir/gider
raporlarına karışması; "son bilinen"i canlı göstermek.

☎️ **Konuşalım — paket başlamadan:** altıncı sekme mi, mevcut sekme içinde mi
(Karar #1); satıştan dönen paranın varsayılanı (Karar #2). İkisi de cevaplanmadan
`/paket P6` yapıştırma.

---

### P7 — Receipt Vault · `/paket P7`

✅ **Görmen gereken:** `attachments` tablosunda **sadece metadata**; dosyalar
private bucket'ta, policy `auth.uid()` path prefix'inde; yükleme kuyruğu
outbox'tan **ayrı**; export/backup/hesap silme dosyaları da kapsıyor.

❌ **Durdur:** dosya baytlarının sync payload'ına girmesi; büyük dosyanın defter
sync'ini bekletmesi; OCR (kapsam dışı); kamera (yeni native bağımlılık).

☎️ **Konuşalım:** dosya boyutu ve toplam saklama limiti.

---

### P8 — Paylaşılan listeler · **backlog** ⚠️ owner izolasyonunu delen tek paket

✅ **Görmen gereken:** üç tablo kendi RLS ailesiyle; `SYNCED_TABLES`'a
**eklenmiyor**; owner-scoped yol gevşetilmiyor; davet/ayrılma/paylaşımı kapatma
açık onay istiyor; **iki gerçek hesapla** izolasyon kanıtı.

❌ **Durdur:** mevcut politikaların gevşetilmesi; kişisel listenin yanlışlıkla
paylaşılabilmesi; her değişiklikte bildirim; izolasyonun sadece policy okunarak
"kanıtlanması".

☎️ **Konuşalım:** push bildirimi istiyor musun (Karar #5) — sunucu tarafı iş.

---

### P9 — Tur güncellemesi · `/paket P9`

✅ **Görmen gereken:** `tour.tsx` genişliyor; yeni kullanıcı ana tur, mevcut
kullanıcı "Helix'te Yeni" + bağlamsal ipucu; sürümlü `kv` anahtarı; **sadece
gerçekten ship edilen** özellikler anlatılıyor.

❌ **Durdur:** onboarding engine; mevcut kullanıcıya tam turun tekrarı;
login sonrası onboarding flash'ı; yayımlanmamış özelliğin tanıtılması.

☎️ **Konuşalım:** Türkçe metinler — son hâli senin onayınla.

---

## Geri alma kartı

| Ne istiyorsun | Komut |
|---|---|
| Bir paketi tamamen geri al | `git revert -m 1 <merge-sha>` → PR |
| Faz 2'nin tamamından çık | Paketleri ters sırada `git revert`; son Faz 1 commit'i `a8ca1d1` |

**Tek dal var: `main`.** Tag yok, uzun ömürlü dal yok, paket-dalı isimlendirmesi
yok. `main` korumalı olduğu için değişiklik bir PR ile giriyor, ama o PR'ı
taşıyan dal iskele: merge'de siliniyor. Bir şey yanlış giderse bir commit
geriye dönülür.

## Kalan sıra

**P7 → P6 → P9.** Sahibinin kararı, 2026-07-26. P5 ve P8 backlog'a alındı; bu
dosyadaki bölümleri sırf geri dönerlerse diye duruyor, sırada değiller.

## Bekleyen kararlar

Numaralar [`PHASE2.md`](PHASE2.md) ile aynı. Cevapladıkça oraya işlenir.

| # | Karar | Ne zaman lazım |
|---|---|---|
| 1 | Altıncı sekme mi, mevcut sekme içinde mi | P6'dan önce |
| 2 | Satış geliri: varsayılan transfer, gelir açık seçenek | P6'dan önce |
| 4 | Palet sayısı ve isimleri | P1 sırasında |
| 5 | Paylaşılan listede push bildirimi | P8'den önce |
| 6 | Yüklenme markası konusu yeniden açılsın mı | P1 sırasında |
