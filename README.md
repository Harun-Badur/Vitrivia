# Vitrify

Vitrify, moda ürünlerini keşfetme, favorilere kaydetme, kişisel dolap oluşturma ve sanal deneme için geliştirilmiş Expo / React Native uygulamasıdır. GitHub deposu `Vitrivia` adını taşır; mevcut package adı, uygulama kimlikleri ve deep-link şeması `kabin` adını korur. Expo görüntüleme adı şu anda `Vitirify` olarak yapılandırılmıştır.

## Mevcut özellikler

- Kaydırılabilir ürün keşfi; arama, kategori ve ürün filtreleri.
- Supabase oturum yönetimi, profil, favoriler ve geçilen ürünler.
- Stil/beden tercihleri, ürün önerileri ve katalog/dolap temelli kombin seçimi.
- Fotoğrafla kişisel dolap kaydı ve kayıtlı kombinler; dolap verileri cihazda kullanıcı bazlı AsyncStorage içinde tutulur.
- FASHN Try-On Max üzerinden sanal deneme ve deneme geçmişi.
- İsteğe bağlı self-hosted Python servisiyle dolap fotoğraflarının arka planını kaldırma.
- Mağaza ürün bağlantıları ve yapılandırılabilir affiliate parametreleri.
- Katalog import/seed araçları, fiyat düşüşü simülasyonu ve Expo bildirim token kaydı. Otomatik fiyat izleme servisi varsayılmamalıdır.

## Teknoloji

Mevcut `package.json`: Expo 57, React Native 0.86, React 19.2, TypeScript 6, Expo Router, Zustand, AsyncStorage, Supabase JS, Reanimated, Gesture Handler ve isteğe bağlı Sentry. Jest / jest-expo ve ESLint geliştirme kontrolleri için kullanılır. Kesin sürümler `package-lock.json` içindedir. Arka plan silme servisi Python, rembg ve CPU U2-Net kullanır.

## Proje yapısı

| Dizin | İçerik |
| --- | --- |
| `app/` | Expo Router ekranları; sekmeler, auth ve dolap rotaları |
| `components/`, `hooks/` | Arayüz bileşenleri ve oturum hook'ları |
| `services/`, `lib/` | Veri erişimi, entegrasyonlar ve yardımcı fonksiyonlar |
| `store/`, `types/` | Zustand domain slice'ları ve TypeScript tipleri |
| `src/intelligence/` | Ürün arama/filtreleme, öneri ve kombin hesaplamaları |
| `src/recommendationCache/` | Fingerprint, codec, paket ve bellek önbelleği |
| `supabase/` | Temel SQL dosyaları, migrations, Edge Functions ve RLS testleri |
| `scripts/`, `data/` | Katalog araçları ve örnek/mock veri |
| `assets/`, `__tests__/` | Uygulama görselleri ve testler |
| `services/wardrobe-cutout/` | İsteğe bağlı Python HTTP servisi |
| `docs/` | Mimari, geliştirme ve yayın notları |

## Kurulum ve yerel geliştirme

Node.js ve npm kurulu olmalıdır. Bu hazırlık Node 24 ile yapılmıştır; bağımlılıkların desteklediği runtime'ı kullanın.

```bash
npm ci
```

PowerShell'de `Copy-Item .env.example .env`; diğer kabuklarda `cp .env.example .env` çalıştırın. Gereken değerleri yalnızca yerel `.env` dosyasında doldurun, ardından:

```bash
npm start
npm run android
npm run ios
```

Android için cihaz veya emülatör gerekir. Yerel iOS simulator/build için macOS ve Xcode gerekir; Windows'ta uygun fiziksel cihaz veya EAS cloud build kullanın. Expo Go uyumluluğu kullanılan SDK/native modüllere bağlıdır; development build gerekebilir. Metro önbelleğini temizlemek için `npx expo start --clear` kullanılabilir.

### Environment variables

`.env.example` gerçek değer içermez. Üç çalışma ortamını ayrı yapılandırın:

| Ortam | Değişkenler |
| --- | --- |
| Mobil istemci | `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_VTON_PROXY_URL`, `EXPO_PUBLIC_RECS_FEED_URL`, `EXPO_PUBLIC_WARDROBE_CUTOUT_URL`, `EXPO_PUBLIC_AFFILIATE_TAGS_JSON`, `EXPO_PUBLIC_SENTRY_DSN` |
| Node import/cache araçları | `EXPO_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, gerektiğinde `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `AFFILIATE_TAGS_JSON` |
| Supabase Edge Functions | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FASHN_API_KEY`; isteğe bağlı `FASHN_RESOLUTION`, `FASHN_GENERATION_MODE`, `FASHN_PROMPT` |
| Python cutout servisi | `SUPABASE_URL`, `SUPABASE_ANON_KEY`; isteğe bağlı `HOST`, `PORT`, `WARDROBE_CUTOUT_MODEL` |

`EXPO_PUBLIC_*` değerleri istemci bundle'ına gömülür. Anon key yalnızca RLS ile kullanılmalıdır; service-role key, FASHN anahtarı ve private credential bu prefix ile tanımlanamaz. Sunucu secretlarını mobil build ortamından ayrı tutun. Sentry DSN boşken Sentry başlatılmaz. Feed adresi boşsa kod mevcut proxy/Supabase adresinden türetmeyi dener. Cutout adresi tanımlı değilse arka plan silme tamamlanmaz.

### Supabase ve Try-On

`lib/supabase.ts` istemci bağlantısını kurar. Canlı kullanımda uygun Supabase schema, RLS, auth ayarları ve Storage gerekir. Temel SQL dosyaları migration klasöründen ayrı olduğundan yeni projede yalnızca migrations çalıştırmak tam kurulum sağlamaz; [deployment notlarını](docs/deployment.md) okuyun.

`vton-proxy`, kullanıcının oturumunu doğrular, kota uygular ve FASHN isteğini sunucudan gönderir. FASHN anahtarı yalnızca Edge Function secret store'da tutulur. `recs-feed` ve `delete-account` diğer mevcut Edge Functions'dır. Gerçek API çağrıları ve veri yazan scriptler test hesabı/projesi üzerinde kontrollü çalıştırılmalıdır.

### Web durumu

`npm run web` ve favicon yapılandırması bulunur; bu repo doğrulanmış bir web deployment sunmaz. `react-dom` ve `react-native-web` doğrudan dependency olarak tanımlı değildir. Native dosya, kamera ve bildirim davranışları ayrıca test edilmeden web parity varsayılmamalıdır. Bu hazırlıkta dependency eklenmemiştir.

## Kontroller

```bash
npm run lint
npm test -- --runInBand
npx tsc --noEmit
```

Bazı native servis/bileşen testlerinin ayrıca izole Jest config'leri vardır; [development dokümanına](docs/development.md) bakın. SQL RLS testleri migrate edilmiş ayrı bir PostgreSQL ortamı gerektirir. Bu komutların bulunması mevcut projenin tüm kontrollerden geçtiği anlamına gelmez.

## Production ve güvenlik

`eas.json` development, preview ve production ortamlarını seçer; gerçek bağlantı değerleri repo içinde tutulmaz. Build öncesinde ilgili EAS ortamında istemci değişkenlerini tanımlayın. Android preview APK, production AAB üretir; submit ayarı internal track / draft'tır. [Yayın adımları ve kalan ön koşullar](docs/deployment.md) belgelenmiştir.

`.env*`, credentials, signing keys, node_modules, Expo/build/cache dosyaları ve yerel test çıktıları ignore edilir. Yalnızca boş `.env.example` takip edilir. EAS tokenları, keystore ve sunucu secretlarını commit etmeyin. Git geçmişinde daha önce yer almış değerler yeni commit ile geçmişten silinmez; [SECURITY.md](SECURITY.md) içindeki geçmiş bulgusunu okuyun.

## Katkı ve geliştirme kuralları

Küçük, açıklanabilir değişiklikler yapın; dependency migration, UI/UX, öneri motoru veya schema değişikliklerini ayrı kapsamda inceleyin. `npm ci` ile lockfile'ı kullanın; ilgili test/lint/typecheck sonucunu PR'a ekleyin. Commit öncesinde diff ve secret kontrolü yapın. Kişisel fotoğraf, kullanıcı export'u, import raporu ve erişim bilgisi eklemeyin. Force push veya history rewrite ancak depo sahibinin açık onayıyla yapılmalıdır.

Lisans: [LICENSE](LICENSE). Gizlilik metni: [PRIVACY_POLICY.md](PRIVACY_POLICY.md).
