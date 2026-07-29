<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/brand/horizontal-dark.png">
  <img src="assets/brand/horizontal-light.png" alt="Helix" width="520">
</picture>

### Paran bugün nerede, yarın ne olacak — tek bakışta.

**Nakit akışını, taksitlerini, aboneliklerini ve bütçelerini cihazında tutan,**
**internetsiz de çalışan kişisel finans uygulaması.**

*An offline-first personal finance workspace for cash flow, installments,
subscriptions and budgets — with a spreadsheet mind and a mobile heart.*

[![Helix'i aç](https://img.shields.io/badge/Helix'i_aç-BA5B38?style=for-the-badge&logo=expo&logoColor=white)](https://topraksv.github.io/helix/)

[![ci](https://github.com/topraksv/helix/actions/workflows/ci.yml/badge.svg)](https://github.com/topraksv/helix/actions/workflows/ci.yml)
[![Expo SDK 54](https://img.shields.io/badge/Expo-SDK%2054-0F0F0D?logo=expo&logoColor=white)](https://docs.expo.dev/versions/v54.0.0/)
[![Node 22](https://img.shields.io/badge/Node-22-0F0F0D?logo=nodedotjs&logoColor=5FA04E)](#kurulum)
[![Proprietary](https://img.shields.io/badge/license-proprietary-BA5B38)](LICENSE)

</div>

<p align="center">
  <img src="assets/screenshots/dashboard-dark.png" alt="Özet ekranı: güncel bakiye, ay sonu tahmini, bu ayın akış özeti ve canlı piyasalar" width="300">
</p>

## Neden Helix?

Bir Excel tablosu para takibi için güçlüdür — ta ki formül bozulana, ileri
tarihli bir harcama bugünkü bakiyeye karışana ya da bir taksidin kaçıncı ayda
olduğunu unutana kadar. Helix, tablonun tanıdık **ay × kalem** düzenini korur;
hesaplamayı, tekrarları ve veri güvenliğini senin yerine üstlenir.

- **Ekle:** Gelir, gider, taksit veya aboneliği tek formdan kaydet. Tutarı
  "400+500" gibi bir toplam olarak bile yazabilirsin.
- **Gör:** Güncel bakiye, ay sonu tahmini, yaklaşan ödeme takvimi ve kategori
  bütçelerin tek özet ekranında birleşir.
- **Rahat ol:** Her kayıt önce cihazına yazılır; internet yokken de her şey
  çalışır. Bağlantı gelince yalnızca senin hesabına eşitlenir, silinenler tek
  dokunuşla geri alınır.

## Ekranlar

| Mali Tablo | Abonelikler | Analiz |
|:---:|:---:|:---:|
| <img src="assets/screenshots/cash-flow-dark.png" alt="Mali Tablo: 2026 Temmuz ayı bakiyesi, akış özeti ve düzenlenebilir kalem listesi" width="240"> | <img src="assets/screenshots/subscriptions-dark.png" alt="Abonelikler: aylık ve yıllık maliyet özeti, yeni abonelik eylemi ve boş durum" width="240"> | <img src="assets/screenshots/analytics-dark.png" alt="Analiz: dönem ve kategori seçimi, işlem arama alanı ve açılabilir arama filtreleri" width="240"> |
| Her ay × kalem hücresi düzenlenebilir; mevcut ay otomatik odaklanır. | Aylık/yıllık toplam maliyet, sonraki ödeme tarihi ve otomatik ödeme bir arada. | Dönem bazlı grafikler, kategori bütçe durumu ve tüm geçmişte işlem arama. |

## Neler yapabilirsin?

| İhtiyacın | Gideceğin yer | Yapabileceklerin |
|---|---|---|
| **Şu anki durumum ne?** | **Özet** | Güncel bakiye, ay sonu tahmini, yaklaşan ödemeler, aylık grafikler ve canlı altın–döviz fiyatları |
| **Ay ay ayrıntı** | **Mali Tablo** | Satır/sütun/ay odaklı matris, hücre detayı ve notları, toplu geçmiş girişi |
| **Tekrarlayan ödemeler** | **Abonelikler** | Aylık/yıllık maliyet, ödeme günü, deneme dönemi, otomatik ödeme |
| **Maaş ve düzenli gelirler** | **Ayarlar → Düzenli Gelirler** | Aylık, haftalık veya iki haftalık gelir kuralları; günü gelince onayla, gerçek tutarıyla işlensin |
| **Taksit ve kredi kartı** | **Mali Tablo → Taksitler** | Gerçek satın alma günü + ekstre dönemi; nakit etkisi son ödeme tarihinde |
| **Bütçe hedefleri** | **Ayarlar → Bütçeler** | Kategori başına aylık hedef, kalan tutar ve aşım uyarısı |
| **Hızlı hesap ve kur** | **Hesap** | Hesap makinesi + canlı kurla TRY/USD/EUR/GBP dönüşümü |
| **Bir işlemi bulmak** | **Mali Tablo → Analiz** | Metin, tutar, tür, kategori ve ödeme yöntemiyle arama |
| **Verini taşımak** | **Ayarlar** | JSON yedek/geri yükleme, CSV dışa aktarma, sihirbazlı Excel içe aktarma |

## Local-first çalışma modeli

Her yazma önce cihazdaki SQLite veritabanına, veri ve outbox kaydı tek
transaction olacak şekilde iner. Uygulama çevrimdışıyken tam işlevlidir; bağlantı
geldiğinde outbox Supabase'e gönderilir ve sunucunun normalize ettiği `updated_at`
cevabı beklenir. Silme işlemleri tombstone'dur, bu yüzden geri alınabilir ve
cihazlar arasında tutarlı kalır. Bozuk veya yabancı satırlar cursor'ı ilerletmez;
`sync_dead_letters` içine karantinaya alınır.

Supabase yapılandırılmazsa uygulama **hesapsız (local-only)** açılır ve hiçbir
finansal veri dışarı çıkmaz.

## Platformlar

| Platform | Durum |
|---|---|
| Web | Uygulamayı etkileyen `main` değişiklikleri yeşil kapıdan sonra GitHub Pages'e otomatik yayımlanır — [canlı sürüm](https://topraksv.github.io/helix/) |
| iOS | CI native fingerprint'i eşleştirir: uyumlu preview binary varsa OTA, yoksa yeni internal preview build üretir |
| Android | Paket yapılandırması ve OTA bundle'ı var; imzalı production store build'i ve fiziksel kabul **henüz yapılmadı** |

Native modül, ikon, SDK veya runtime değişiklikleri OTA ile teslim edilemez;
fingerprint'i değiştirir ve yeni binary gerektirir. Store submission otomatik
değildir; fiziksel cihaz kabulü yapılmadan mobil teslim doğrulanmış sayılmaz.

## Mimari özet

| Katman | Karar |
|---|---|
| Uygulama | Expo SDK 54, React Native 0.81, React 19, Expo Router |
| Yerel veri | `expo-sqlite` (async) + Drizzle; UI doğrudan SQL çağırmaz |
| Veri erişimi | [`src/data/repo.ts`](src/data/repo.ts) kararlı facade; implementasyonlar `src/data/repo/` altında |
| Saf mantık | `src/domain/` — para, tarih, bakiye, taksit, recurrence; React ve I/O içermez |
| Sync | Atomik yazım + outbox, server-authoritative `updated_at`, dead-letter karantinası |
| Remote | Supabase Auth/Postgres; owner-only RLS |
| Para/tarih | Integer kuruş; `YYYY-MM-DD` tarih, `YYYY-MM` ay anahtarları |
| Arayüz | Ortak primitive'ler + tek tema kaynağı ([`src/ui/theme.ts`](src/ui/theme.ts)) |

## Tasarım

Sıcak kâğıt tonları üzerinde kil vurgusu: **Warm Organic Editorial**. Fraunces
başlıklar, Inter gövde, botanik çift sarmal logosu. Gelirler yeşil, giderler
kırmızı; light/dark tüm rol çiftleri otomatik kontrast sözleşmesinden geçer.
Metinler asla üç noktayla kırpılmaz, hareket sistemi Reduced Motion tercihine
uyar, grafikler ekran okuyucu için tam değerli özet taşır.

## Gizlilik ve güvenlik

- **Hesapsız mod:** Bütün finansal veri cihazındaki SQLite veritabanında kalır.
- **Hesaplı mod:** Değişiklikler yalnızca senin hesabına eşitlenir. Her tablo
  owner-only RLS ile korunur; başka bir hesap satırlarını okuyamaz.
- **Anahtarlar:** Client yalnız publishable anon anahtarı taşır; service-role
  anahtarı yalnızca GitHub Actions secret'ındadır.
- **Bildirimler:** İzin yalnızca Ayarlar'dan istenir; kilit ekranında finansal
  ayrıntı varsayılan olarak gizlidir.
- **Dış istekler:** Kur, piyasa ve logo istekleri salt okunur; boyut, şekil,
  tarih ve host doğrulamasından geçer.
- **Loglama:** Production'da token, tutar, not veya e-posta persist edilmez.

## Kurulum

> **Node 22 zorunlu.** Expo SDK 54 araç zinciri Node 24+ ile uyumlu değildir.

```bash
git clone https://github.com/topraksv/helix.git
cd helix
npm ci
cp .env.example .env     # boş bırakılırsa uygulama local-only açılır

npm run web              # web development
npm run ios              # iOS development build
```

Kalite kapısı tek komuttur:

```bash
npm run verify           # typecheck + Vitest + lint
npm run test:e2e:smoke   # kritik tarayıcı senaryoları
npm run verify:full      # + production export, bundle bütçesi, tüm Playwright
```

GitHub Actions aynı adımları `main` push'unda değişikliğin riskine göre koşar:
düşük riskli değişiklikte smoke E2E, yüksek riskli değişiklikte iki shard'a
bölünmüş tam E2E paketi. Web ancak hepsi geçtiğinde yayımlanır.

## Teslim modeli

`main`'e push değişiklikleri önce tek risk kapısından geçirir. Web, aynı koşuda
export edilip bütçesi ölçülen immutable artefaktı yayımlar. Ortak uygulama kodu
için EAS workflow iOS native fingerprint'ini kontrol eder; eşleşen preview
binary varsa OTA yayımlar, yoksa yalnız yeni internal binary oluşturur. Native
değişiklik hiçbir zaman eski binary'ye OTA olarak gönderilmez. Geri alma
`git revert` iledir; force push ve history rewrite kullanılmaz.

## Lisans / License

**Proprietary — all rights reserved.** © 2026 Ömer Toprak Şavlı.

Kaynak; şeffaflık ve inceleme için görünürdür, açık kaynak değildir. Yazılı izin
olmadan çalıştırma, kopyalama, değiştirme, dağıtma veya ticari kullanım hakkı
vermez. Tam koşullar [LICENSE](LICENSE) içindedir.
