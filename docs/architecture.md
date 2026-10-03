# Mimari

`index.ts` URL polyfill'ini yükler ve Expo Router girişine geçer. `app/_layout.tsx` kök navigasyon, auth/onboarding ve uygulama başlangıcını yönetir. Sekme ekranları `app/(tabs)/`, dolap alt ekranları `app/wardrobe/` içindedir.

## Veri ve durum

- `lib/supabase.ts`: environment ile yapılandırılan Supabase istemcisi.
- `hooks/useAuth*`: oturum bağlamı; `services/` profil, hesap, favori, ürün ve geçmiş erişimini kapsar.
- `store/useAppStore.ts` ile discovery/favorites/profile/wardrobe slice'ları Zustand durumunu yönetir.
- `services/productRepository.ts`, katalog adapter'ı ve `productService.ts` ürün erişimi ve eşlemeyi kapsar. `data/` mock ve örnek katalog içerir.
- `services/wardrobeService.ts`: kullanıcıya göre AsyncStorage kayıtları; fotoğraflar cihazın document directory'sine kopyalanır. SQL dosyalarının bulunması dolabın otomatik cloud sync yaptığı anlamına gelmez.

## Öneriler

`src/intelligence/` arama/filtre, ranking, tamamlayıcı ürünler ve kombin hesaplamalarını içerir. `src/recommendationCache/` canonical fingerprint, serialization codec, feed packet ve bellek cache katmanıdır. Node araçları hazır sonuçları dosyaya veya Supabase'e yazar. Discover consumer hazır paketleri okur; özel job istekleri ayrı worker tarafından işlenir. Worker uygulama içinde kendiliğinden çalışmaz. Ayrıntılar ve snapshot ön koşulları [cache README](../src/recommendationCache/README.md) içindedir.

## Sunucu sınırı

Supabase `vton-proxy`, `recs-feed` ve `delete-account` Edge Functions içerir. `vton-proxy` oturum/kota kontrolünden sonra FASHN Try-On Max çağrısı yapar. Sunucu service-role ve FASHN secretlarını kullanır; istemci yalnızca public değişkenleri alır. SQL temel şemalar, migrations ve RLS testleri `supabase/` içindedir.

## Dolap cutout

İsteğe bağlı `services/wardrobe-cutout/` Python servisi Supabase oturumunu doğrular ve yüklenen JPEG'i rembg/U2-Net CPU ile PNG'ye dönüştürür. Uygulama çıktı için cihaz kaydı ve özel `wardrobe-cutouts` Storage bucket'ını kullanır. Model cache ve kullanıcı fotoğrafları repository'ye eklenmez. Kurulum ve sınırlamalar [servis README](../services/wardrobe-cutout/README.md) içindedir.

## Diğer entegrasyonlar

Mağaza bağlantıları/affiliate parametreleri deep-link yardımcıları üzerinden oluşturulur. Expo Notifications token kaydı ve fiyat simülasyon script'i bulunur; periyodik fiyat tarama altyapısı belgelenmiş bir production servisi değildir. Sentry yalnızca DSN tanımlandığında başlatılır.
