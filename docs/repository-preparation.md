# Repository hazırlık kontrolü — 2026-10-03

Bu rapor yalnızca repository yükleme hazırlığının sonuçlarını kaydeder; uygulamanın production kabul testi değildir.

- Mevcut `main`, `origin/main` ile başlangıçta aynı commit'teydi; fetch sonrası da ayrışma yoktu.
- Mevcut yerel kaynak, test, asset ve SQL değişiklikleri korunarak yüklemeye dahil edildi. Bu hazırlık iş mantığı veya dependency migration yapmadı.
- Kaynak/config/dokümantasyon taraması ve `.env` içindeki gerçek değerlerin yayın adaylarında birebir araması bulgu vermedi. Boş `.env.example` dışında env dosyası takip edilmiyor.
- Erişilebilir 445 tarihsel Git blob'u tarandı. `eas.json` içindeki anon JWT ve Supabase URL'leri SECURITY.md'de kaydedildi. Service-role/private key bulgusu olmadı. Tarihsel kopyalar silinmedi.
- Büyük yerel video/analiz dosyaları `output/` ve geçici dosyalar `tmp/` altında ignore edildi; dosyalar diskten silinmedi. Yayın adaylarında 5 MiB üzeri dosya yoktu.
- `npm run lint`: başarılı. Generated klasörler dışlandı; mevcut CommonJS Jest config'lerinin `module` global'i tanımlandı.
- `npm test -- --runInBand`: 65 suite test çalıştırılmadan durdu. `jest-expo` setup'ı `expo-modules-core` modülünü çözemedi. Lockfile bu paketi Expo'nun nested dependency'si olarak içeriyor; dependency değiştirilmedi.
- `npx tsc --noEmit`: başarısız. `__tests__/scrollPose.test.ts` olmayan `components/deckv2/scrollPose` modülünü import ediyor. Test/source silinmedi veya davranışı değiştirilmedi.
- İzole `accountDetails.jest.cjs` testi: 1 suite / 7 test başarılı. Bu sonuç ana Jest suite'lerini doğrulamaz.
- SQL/RLS testleri, Python inference, cihaz/web kontrolleri, cloud build ve deployment bu hazırlıkta yapılmadı.

Build öncesinde EAS ortam değişkenlerini tanımlayın. Tam yayın ön koşulları için [deployment](deployment.md), credential geçmişi için [SECURITY.md](../SECURITY.md) okuyun. Ana test/typecheck sorunlarını ayrı bir değişiklik kapsamında çözün.
