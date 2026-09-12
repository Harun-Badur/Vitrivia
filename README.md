# Kabin

**Kaydır, dene, keşfet.** Moda ürünlerini swipe ile gez, yapay zekâ ile sanal dene, beğendiğini pazaryerinde aç.

## Özellikler

- Tinder benzeri kart yığını: sağa beğen, sola geç
- Kategori rozetleri: üst giyim, alt giyim, elbise
- AI sanal deneme (FASHN Try-On Max, Edge `vton-proxy`)
- Trendyol ve Hepsiburada derin bağlantıları (kanonikal ürün URL)
- Supabase ürün feed’i; bağlantı yoksa yerel mock katalog
- Fiyat takibi (MVP: manuel/script) ve Expo push token kaydı

## Tech stack

| Katman | Teknoloji |
|--------|-----------|
| Uygulama | Expo 54, React Native 0.81, TypeScript |
| Jestür / animasyon | Gesture Handler, Reanimated |
| Durum | Zustand |
| Veri | PostgreSQL (Supabase), anon RLS okuma |
| Sanal deneme | FASHN Try-On Max (`1k` / `fast`) via `vton-proxy` |
| Katalog scriptleri | Node (`tsx`), Cheerio |

## Mimari

```
Expo (Kabin)  --feed-->  Supabase (products)
       |                      ^
       |                      |  lokal seed / import (service_role)
       +--try-on-->  Supabase Edge Function (vton-proxy)  --Bearer FASHN_API_KEY-->  FASHN Try-On Max
       +--hesap sil--> Supabase Edge Function (delete-account)
       +--Satın Al--> Trendyol / Hepsiburada ürün sayfası
```

Uygulama yalnızca `EXPO_PUBLIC_*` değişkenlerini görür. `SUPABASE_SERVICE_ROLE_KEY` ve `FASHN_API_KEY` cihaza gömülmez.

Sanal deneme istemcisi FASHN ayrıntılarını görmez. Kota (`consume_vton_quota`, dakikada 3 / günde 20) ve telemetry event isimleri korunur.

## Kurulum

### Ön koşullar

- Node.js 20+
- npm
- Expo Go (cihaz) veya Android emülatör
- (İsteğe bağlı) Supabase projesi — canlı feed için

### Ortam değişkenleri

`.env.example` dosyasını `.env` olarak kopyala ve değerleri doldur:

| Değişken | Nerede | Açıklama |
|----------|--------|----------|
| `EXPO_PUBLIC_SUPABASE_URL` | Uygulama | Supabase proje URL’si |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Uygulama | Anon / public key (RLS ile okuma) |
| `EXPO_PUBLIC_VTON_PROXY_URL` | Uygulama | `recs-feed` / `delete-account` adresini türetmek için hâlâ okunur |
| `EXPO_PUBLIC_AFFILIATE_TAGS_JSON` | Uygulama | Boş bırakılırsa URL’ye affiliate parametresi eklenmez |
| `EXPO_PUBLIC_SENTRY_DSN` | Uygulama | Boşsa Sentry **hiç** `init` edilmez. DSN: [sentry.io](https://sentry.io) → Create project → **React Native** → **Client Keys (DSN)** |
| `SUPABASE_SERVICE_ROLE_KEY` | Yalnızca script | Feed import / seed. `EXPO_PUBLIC_` **olmaz** |
| `AFFILIATE_TAGS_JSON` | Script | Seed tarafı etiketleri |

Şema sırası (SQL Editor):
1. `supabase/schema_products.sql`
2. `supabase/schema.sql`
3. `supabase/price_tracking.sql`
4. `supabase/rate_limits.sql`
5. `supabase/variations.sql`
6. `supabase/model_studio.sql`

EAS bulut derlemesi `.env` dosyasını görmez; `EXPO_PUBLIC_*` değerleri
`eas.json` profillerinin `env` bloğunda olmalı (anon key istemciye zaten
gömülür). `SUPABASE_SERVICE_ROLE_KEY` buraya **asla** yazılmaz.

### Auth (e-posta)

Supabase Dashboard → **Authentication → Providers → Email**:
**Confirm email** kapalı olmalı. Açık kalırsa kayıt session dönmez, giriş
`email not confirmed` ile düşer ve APK'da "İşlem tamamlanamadı" gibi genel
bir mesaj görünebilir. Geliştirme / dahili test için e-posta doğrulamasını
kapat; yayında açacaksan kullanıcıya doğrulama bağlantısını açıkça söyle.

### Edge Function deploy

```bash
npx supabase login
npx supabase link --project-ref <PROJECT_REF>
npx supabase functions deploy delete-account
npx supabase functions deploy recs-feed
```

### Geliştirme sunucusu

```bash
npm install
npx expo start
```

Cache temizlemek için: `npx expo start -c`

### Kalite (lint / test)

```bash
npm run lint
npm test
```

Sentry DSN boşsa SDK `init` çağrılmaz; Expo Go bu yüzden etkilenmez. DSN almak için [sentry.io](https://sentry.io) üzerinde **React Native** projesi oluştur, **Settings → Client Keys (DSN)** değerini kopyala ve `EXPO_PUBLIC_SENTRY_DSN` olarak `.env` / EAS `env` bloğuna yaz. Native debug sembolleri için EAS’te ayrıca `SENTRY_ORG`, `SENTRY_PROJECT` ve `SENTRY_AUTH_TOKEN` tanımlanabilir; boş DSN ile bunlar gerekmez.

### Fiyat düşüşü testi (MVP, scraping yok)

İlk katalog ürününün `current_price` değerini %10 düşürür, ilgili beğenilere `price_alerts` yazar. Push varsayılan **dry-run**:

```bash
npx ts-node scripts/simulate-price-drop.ts
```

Aynı komut proje içinde `tsx` ile de çalışır: `npx tsx scripts/simulate-price-drop.ts`

Gerçek Expo push göndermek için: `npx tsx scripts/simulate-price-drop.ts --send`

## Build & Release

Uygulama kimliği: Android `com.kabin.app`, iOS `app.kabin.mobile`. Sürüm
`app.json` içinde tutulur (`version` + `android.versionCode`); `eas.json`
`appVersionSource: "local"` kullandığı için sürüm numaralarının tek kaynağı
`app.json`'dır.

### Tek seferlik kurulum

```bash
npm install -g eas-cli
eas login              # expo.dev hesabı
eas init               # extra.eas.projectId değerini app.json'a yazar
```

### Build profilleri

| Profil | Çıktı | Kullanım |
|--------|-------|----------|
| `development` | APK + dev client | Cihazda native modül debug |
| `preview` | APK | Dahili test, cihaza doğrudan kurulum |
| `production` | AAB | Play Store yüklemesi (`autoIncrement`) |

```bash
# Dahili test için kurulabilir APK
eas build --platform android --profile preview

# Play Store için AAB (versionCode otomatik artar)
eas build --platform android --profile production

# Play Console'a yükle (internal track, draft)
eas submit --platform android --profile production
```

Yerel manifest doğrulaması (bulut kredisi harcamaz):

```bash
npx expo config --type public
npx expo prebuild --platform android --no-install   # android/ üretir, gitignore'da
```

`prebuild` çalıştırdıktan sonra `android/` klasörünü sil ve `package.json`
içindeki `android`/`ios` script'lerinin `expo start --android` olarak kaldığını
doğrula; prebuild bunları `expo run:*` olarak değiştiriyor ve proje CNG
(managed) akışında kalmalı.

### İzinler

Manifeste yalnızca `INTERNET`, `POST_NOTIFICATIONS`, `VIBRATE` (bildirim
titreşimi) ve galeri okuma izinleri girer.
`expo-image-picker` varsayılan olarak `CAMERA` ve `RECORD_AUDIO` da
ekliyor; ikisi de `android.blockedPermissions` ile kaldırılıyor çünkü uygulama
kamera ya da mikrofon kullanmıyor. Bu listeyi genişletmeden önce Play Console
"Veri güvenliği" formunun da güncellenmesi gerekir.

### Marka varlıkları

`assets/` altındaki simge mercan zeminde (`#FE382B`) beyaz **K**; splash
sıcak kırık beyaz zeminde (`#F7F4F0`) mercan K. Boyutlar: `icon.png` 1024×1024,
`android-icon-foreground.png` 1024×1024, `notification-icon.png` bildirim glifi.

## Tasarım sistemi

Tema tek kaynaktan gelir: [`lib/theme.ts`](lib/theme.ts). Ekranlarda ham hex
kullanılmaz. Palet "Beyaz Taban + Mercan Aksan" 60-30-10 dengesine dayanır:
%60 beyaz/kırık beyaz zemin, %30 antrasit tipografi, %10 mercan aksan.

| Token | Değer | Kullanım |
|-------|-------|----------|
| `colors.bg` / `surface` | `#F7F4F0` / `#F5F3EF` | Canvas / kart zemini |
| `colors.text` / `textSecondary` | `#111827` / `#6B7280` | Başlık / yardımcı metin |
| `colors.border` / `hairline` | `#EAE6E1` / `#F3F4F6` | Kart kenarı / ayırıcı |
| `colors.accent` | `#FE382B` | Birincil CTA, aktif sekme, "MAĞAZAYA" |
| `colors.stampAdd` / `stampPass` | `#22C55E` / `#EF4444` | "EKLE" / "GEÇ" damgaları |
| `colors.accentDark` | `#D92B1F` | Küçük metin, link, indirim rozeti yazısı |
| `colors.accentSoft` | `rgba(254,56,43,0.1)` | Rozet ve switch zemini |
| `colors.tabInactive` | `#9CA3AF` | Pasif sekme |
| `colors.destructive` | `#DC2626` | Yalnızca minimal silme metin butonları |
| `colors.inverseSurface` / `inverseText` | antrasit / beyaz | Toast, dolgulu CTA yazısı |

`radius`: kart 24, buton 16, chip full. `spacing`: 4 / 8 / 12 / 16 / 24 / 32.
`shadows.card` yumuşaktır (`opacity 0.08`, `radius 16`); derinlik border ile
desteklenir. Süreler ve deste derinlik basamakları
[`lib/motion.ts`](lib/motion.ts) içinde.

İkincil butonlar beyaz zemin + `border` + antrasit metin, birincil butonlar
dolgulu `accent` + beyaz metindir. Ürün görselinin altına koyu scrim
uygulanmaz; bilgi alanı kartın alt bandında beyaz zeminde durur.

Fiyat alarmı bir kullanıcı ayarı değil, **sistem davranışıdır**: beğeni
kaydedilirken `notify_on_price_drop` her zaman `true` yazılır, arayüzde alarm
anahtarı yoktur.

## Proje yapısı

Navigasyon `expo-router` ile dosya tabanlıdır; giriş noktası `index.ts`
polyfill'leri yükleyip `expo-router/entry`'ye devreder.

```
kabin/
├── index.ts                # polyfill'ler + expo-router/entry
├── app.json                # Expo adı: Kabin
├── app/                    # router: dosya = route
│   ├── _layout.tsx         # kök Stack + onboarding + auth gate
│   ├── auth.tsx            # oturum yoksa buraya düşer
│   └── (tabs)/
│       ├── _layout.tsx     # Keşfet / Dolap / Profil
│       ├── index.tsx       # Keşfet (swipe feed)
│       ├── liked.tsx       # Dolabım
│       └── profile.tsx     # Profil + hesap silme
├── components/
│   ├── SwipeCard.tsx
│   └── VirtualTryOnModal.tsx
├── data/                   # mock katalog + sample CSV
├── hooks/                  # useAuth + AuthProvider
├── lib/                    # tema, hareket, Supabase client, deep link, rıza
├── scripts/                # import, seed, görsel çıkarma
├── services/               # feed, hesap, satın al
├── store/                  # Zustand
├── supabase/               # SQL şema + Edge Functions
└── types/
```

## Roadmap

- Kullanıcı dolabı ve beğeni geçmişi
- Öneri sıralaması (stil / beden)
- Affiliate etiketlerinin canlıya alınması
- Daha fazla pazaryeri
- Mağaza yayını (EAS / Play Store)

## Davet paylaşımı

Profildeki **Arkadaşını Davet Et** paylaşım metni şimdilik gizlilik politikası
URL’sini (`PRIVACY_URL`) kullanır. Mağaza yayını sonrası bu link Play Store /
App Store ürün sayfasıyla değiştirilecek.

## Gizlilik ve hesap silme

Gizlilik politikası: <https://github.com/Harun-Badur/kabin-privacy>
(kaynak: [PRIVACY_POLICY.md](PRIVACY_POLICY.md))

Sanal deneme fotoğrafı yalnızca o deneme için işlenir ve saklanmaz; özellik ilk
kullanımda uygulama içinde açık rıza ister.

### Hesap silme

**Uygulama içinden:** Profil sekmesi → **Hesabımı Sil** → onay. Hesap,
beğeniler, geçilen ürünler, fiyat alarmları, bildirim tokenları ve kota
sayaçları cascade ile kalıcı olarak silinir.

**Web üzerinden (Google Play zorunluluğu):** Uygulamaya erişimi olmayan
kullanıcılar, hesap kaydıyla aynı adresten **destek@kabin.app** adresine
"Hesap silme talebi" konulu e-posta göndererek silme talep edebilir. Talepler
30 gün içinde işleme alınır. Adımların web erişimli tarifi gizlilik
politikasının [Hesap silme](https://github.com/Harun-Badur/kabin-privacy#4-hesap-silme)
bölümünde yayınlanır ve Play Console "Veri silme" alanına bu URL girilir.

## Güvenlik

Ayrıntı: [SECURITY.md](SECURITY.md). `.env` commit edilmez. Service role anahtarı uygulama paketinde yer almaz.
