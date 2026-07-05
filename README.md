# Helix — Kişisel Finans & Abonelik Yönetimi

Local-first kişisel finans uygulaması: aylık nakit akışı + taksit motoru + abonelik yönetimi.
Excel'deki gelir-gider dokümanının uygulamalaşmış hali. **iOS + web** (tek kod tabanı, Expo).

## Mimari özet

- **Local-first:** `expo-sqlite` (WAL) + Drizzle ORM. UI asla ağ beklemez; uçak modunda tam işlev.
- **Sync:** Supabase (Postgres + Auth), outbox pattern → push/pull/merge (LWW). Tombstone silme, hard delete yok.
- **Güvenlik:** her tabloda RLS (`auth.uid() = user_id`), iOS'ta Face ID kilidi, secret'lar `.env`'de.
- **Para:** tüm tutarlar integer kuruş. Kur: TCMB `today.xml` → Frankfurter fallback → cache.
- **Domain motorları** (`src/domain/`, saf TS): zincirleme bakiye, taksit motoru, recurrence
  (ay sonu kırpma), beklenen ödeme/gelir, YTD analytics, sınırlı computed-column motoru.
  `npm test` ile 56 birim testi (Excel'den doğrulanan golden bakiye zinciri dahil).

## Kurulum

```bash
npm install
cp .env.example .env   # Supabase URL + anon key doldur (boş bırakılırsa yalnız-yerel mod)
npm run web            # veya: npm run ios
npm test               # domain birim testleri
npm run typecheck
```

### Supabase kurulumu (tek seferlik)

1. [supabase.com](https://supabase.com) → yeni proje (Free tier).
2. SQL Editor'da `supabase/migrations/00000000000001_init.sql` içeriğini çalıştır.
3. Settings → API'den `URL` ve `anon` key'i `.env`'e yaz (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`).
4. GitHub repo → Settings → Secrets and variables → Actions: `SUPABASE_URL` ve
   `SUPABASE_SERVICE_ROLE_KEY` ekle (keep-alive cron için; service key **asla** `.env`'e girmez).
5. Actions sekmesinden `supabase-keepalive` workflow'unu bir kez elle çalıştırıp doğrula.
   Bu cron 3 günde bir DB'ye yazar/okur — Free tier'ın 7 günlük pause'unu engeller (kritik).

## Manuel test senaryoları (kritik akışlar)

1. **Onboarding:** kayıt → şablon seç → başlangıç ayı + açılış bakiyesi → kişi/kaynak ekle → bitir.
2. **Toplu geçmiş girişi:** 3 geçmiş ayı kategorilere toplam girerek doldur → Nakit Akışı kartları,
   geniş ekranda matris ve Analiz YTD toplamları Excel ile birebir karşılaştır.
3. **Taksit:** "6 taksit, 2'si ödendi" harcama ekle → aylara dağılım, `2/6` ilerleme, bitiş ayı doğru;
   Taksitler ekranında "bu ay toplam yükümlülük" elle hesapla, karşılaştır.
4. **§2.7 ileri tarihli ödeme:** yarın tarihli gider ekle → bugün bakiye değişmez; ertesi gün açınca
   (veya cihaz saatini ilerletince) "gerçekleşti" olur ve bakiyeye düşer.
5. **§2.8 izleme-only:** ikinci kişiye (ör. Betül) taksit ekle → bakiye değişmez; Taksitler'de
   "Takip edilenler" bölümünde görünür, bildirimi çalışır.
6. **Maaş kuralı:** Ayarlar → Düzenli gelirler'e maaş ekle → Dashboard'da "beklenen gelir" düşer;
   farklı tutarla onayla → bakiyeye gerçek tutar yansır.
7. **Catch-up:** birkaç gün girmeden aç → "Son giriş: X (n gün önce)" banner'ı → Mutabakat
   ekranında aradaki vadesi gelmiş kalemleri onayla/atla/düzelt.
8. **Offline:** uçak modunda aç → kilit, giriş, tüm ekranlar ve kayıt çalışır; ağ gelince
   Ayarlar → Senkronizasyon "Güncel" olur.
9. **Çok cihaz:** iki istemcide aynı hesapla gir → birinde ekle/düzenle/sil/geri al → diğerinde
   sync sonrası aynı durum (silinenler dahil).
10. **RLS:** ikinci bir Supabase kullanıcısı oluştur → birinci kullanıcının verisi hiçbir sorguda dönmez.
11. **Yedek:** JSON dışa aktar → temiz kuruluma içe aktar → veriler birebir.
12. **Tema/bildirim:** koyu-açık temada tüm ekranları gez; bildirim izni ver, yaklaşan ödeme bildirimi planlanıyor mu kontrol et (Ayarlar → gün sayısı).

## Bilinen sınırlar (Faz 1)

- Web'de zamanlanmış bildirim yok (platform kısıtı) — in-app gösterim var.
- Kur çevrimi girişte snapshot'lanır; TCMB hafta sonu kur yayınlamaz → son bilinen kur + ⚠ rozet.
- Taksitler takvim ayına yazılır; kart ekstre dönemi (kesim tarihi) Faz 2 (şemada alan hazır).
- CSV import/mutabakat, bütçe uyarıları, takvim görünümü, widget → Faz 2.
