# Faz 2 — operasyon kılavuzu

Yapıştıracağın komutlar ve her adımda ne görmen gerektiği. Kural yok — kurallar
[`PHASE2.md`](PHASE2.md) ve [`AGENTS.md`](../AGENTS.md) içinde, agent onları
zaten okuyor. Burada sadece **sen ne yapıyorsun** yazıyor.

## Kullanımı

Sırayı bozma. Her paket tek komutla başlar:

```
/paket P1
```

Bir paket kapanmadan sonrakine geçme. Paketler birbirinin bağımlılığını çözüyor;
sıra bozulunca aynı iş iki kez yapılır.

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
| Yeni dosya/servis/store yığını | `Bu kaç yeni dosya? Her biri için hangi mevcut yapının yetmediğini tek cümleyle yaz. Yetiyorsa onu kullan.` |
| Mevcut bir primitive'in kopyası | `Bu projede zaten var. Yenisini kurma, mevcudu genişlet.` |
| Flag iş mantığının içinde | `Flag sadece mount noktasında. Domain veya repo yoluna flag girmeyecek.` |
| Kapsam dışına taşma | `Bu paketin kapsamı PHASE2.md'de yazılı. Dışındakini not et, yapma.` |
| "Düzelttim" ama kanıt yok | `Kanıt yok. verify çıktısını ve değişen dosyaları göster.` |
| Baseline'a bakmadan güncelleme | `Baseline'ı görmeden kaydetme. actual/diff görsellerini aç ve neyin neden değiştiğini yaz.` |
| Cihazda doğrulanmamışı doğrulanmış sayma | `Bu cihazda denenmedi. Öyle yaz.` |
| Metin üç noktayla kırpılmış | `Üç nokta yasak. Sar, kısalt veya düzeni değiştir.` |

## Paketler

Her paket için: yapıştıracağın komut, tasarım onayında **görmen gereken**,
**görürsen durman gereken**, ve konuşmamız gereken nokta.

---

### P0 — Faz 2 kurulumu ✅

Bu dosya, `PHASE2.md`, `/paket` komutu, `src/config/features.ts` ve
`v1-pre-phase2` tag'i. Ürün değişikliği yok. Bittiğinde P1'e geç.

---

### P1 — Görsel imza · `/paket P1`

Feature 2 (yüklenme) + Feature 4 (paletler).

✅ **Görmen gereken:** `Palette` şekli değişmiyor, `theme.ts` içinde palet
kaydı; tercih `kv helix.palette`; `theme-contrast.test.ts` sözleşmesi
korunup tüm paletler üzerinde döngüye alınıyor; loader tarafında gecikmeli
gösterim + gerçek determinate progress + settings'teki 3 `ActivityIndicator`'ın
tekleştirilmesi.

❌ **Durdur:** paralel bir tema sistemi; renklerin runtime'da üretilmesi
(`hsl()` hesabı); mavi/mor accent; **nefes alan logo** — bu bir commit önce
bilerek silindi, geri gelmesi ayrı bir karar.

☎️ **Konuşalım:** kaç palet ve isimleri (Karar #4). Agent öneri getirir, sen
seçersin.

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

### P3 — Privacy Peek · `/paket P3`

✅ **Görmen gereken:** maskeleme `Amount` primitive'i + `<Private>` içinde;
placeholder genişliği `amount-layout.ts`'ten; **accessibility label de maskeli**;
cihaz-bazlı `kv`, hesaba yazılmıyor; mevcut `PrivacyCover` aynen duruyor.

❌ **Durdur:** ekran ekran maskeleme; hesap verisine yazılan tercih; maskeliyken
ekran okuyucunun rakamı okuması; her toggle'da toast.

☎️ **Konuşalım:** sıkı mod ilk sürüme girsin mi (Karar #3). Varsayılan: hayır.

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

### P5 — Scenario Lab · `/paket P5`

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

### P8 — Paylaşılan listeler · `/paket P8` ⚠️ owner izolasyonunu delen tek paket

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
| Bir özelliği anında kapat | `src/config/features.ts` içinde `false` → deploy |
| Bir paketi tamamen geri al | `git revert -m 1 <merge-sha>` → PR |
| Faz 2'nin tamamından çık | `git revert` ile paketleri ters sırada, ya da `v1-pre-phase2` tag'ine dön |

Faz 2 için yeni branch stratejisi, workflow veya deploy hattı **yok**. Mevcut
`main` korumalı akış aynen geçerli.

## Bekleyen kararlar

Numaralar [`PHASE2.md`](PHASE2.md) ile aynı. Cevapladıkça oraya işlenir.

| # | Karar | Ne zaman lazım |
|---|---|---|
| 1 | Altıncı sekme mi, mevcut sekme içinde mi | P6'dan önce |
| 2 | Satış geliri: varsayılan transfer, gelir açık seçenek | P6'dan önce |
| 3 | Privacy Peek sıkı mod ilk sürümde mi | P3 sırasında |
| 4 | Palet sayısı ve isimleri | P1 sırasında |
| 5 | Paylaşılan listede push bildirimi | P8'den önce |
| 6 | Yüklenme markası konusu yeniden açılsın mı | P1 sırasında |
