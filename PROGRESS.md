# Otonom revizyon süreci — ilerleme durumu

Bu dosya token limiti nedeniyle süreç kesilirse kaldığı yerden devam etmek
içindir. "Devam et" denince buradaki **Sıradaki** bölümünden başla.

## Ortam notları (KRİTİK)
- **Expo SDK 54** (57'den düşürüldü). React Native 0.81.5, React 19.1.0,
  expo-router 6.0.24.
- **Node 22 zorunlu** yerel build/export için: `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`.
  Node 24/26 native TS stripping SDK 54'ü kırıyor. CI de Node 22'ye pinlendi.
- Tüm DB erişimi async (drizzle sqlite-proxy). `expo-sharing` app.json
  plugins'ten çıkarıldı (SDK 54'te config plugin yok).
- Doğrulama komutları: `npm run typecheck && npm test && npx expo lint`.
  Web export: `npx expo export -p web` (Node 22 PATH ile).
- E2E: scratchpad'de `flow.js` + `pages-sim.js` (Playwright).

## Tamamlanan
1. [x] **SDK 57→54 downgrade** (commit 73a4f44). typecheck/test/lint/export/runtime OK.
2. [x] **Core bug fixes** (kod yazıldı, typecheck/test temiz — E2E doğrulaması sürecek):
   - useLedger artık ledger'ı en erken veri ayına kadar geriye uzatıyor
     (açılış bakiyesi configuredStart'ta anchor'lı, geri hesaplanıyor) →
     geçmiş yıl/ay verisi görünür + tıklanabilir (hooks.ts).
   - Matriste tüm aylar + kategori hücreleri her zaman tıklanabilir.
   - İşlem düzenleme: transaction.tsx `?id=` param ile edit modu +
     repo.updateTransaction; cell-editor ve [month].tsx'e Pencil edit butonu.
   - Analiz arama: kategori adı/Türkçe ay/yıl/tutar haystack filtresi + boş sonuç mesajı.
   - Beyaz ekran: _layout fontları 2.5s grace ile bloklamıyor, spinner +
     retry butonu eklendi.

## Kalan aşamalar
3. Sayı formatı (binlik+kuruş her yerde), dinamik simge, abonelik "deneme" hizalama
4. Sticky ilk kolon (web+mobil), custom sticky kolon, mobil "Aylar Sütunda",
   mobil analiz sticky, footer kesilme, ellipsis okunabilirlik
5. Refactor/optimize/güvenlik (SonarQube/OWASP), klasör yapısı
6. README.md + CLAUDE.md + AGENTS.md güncelle
