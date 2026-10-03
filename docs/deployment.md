# Deployment

Bu depo kaynak ve mevcut yayın config'ini içerir; GitHub'a push uygulamanın production ortamına deploy edilmesi veya mağaza onayı anlamına gelmez.

## Supabase kurulumu

Temel SQL dosyaları migrations klasöründen ayrıdır. Yeni projede mevcut SQL ön koşullarını inceleyin: önce `schema_products.sql`, ardından `schema.sql`; fiyat takibi, rate limit, variations ve model studio dosyaları ilgili özellikleri sağlar. `recs_v1.sql`, `recs_v1_p1.sql` ve `recs_v1_trend.sql` öneri altyapısını genişletir. Sonrasında `supabase/migrations/` dosyalarını bağımlılık ve kronoloji sırasıyla değerlendirin. Migration dosya adlarının bazıları aynı tarih prefix'ini kullanır; doğrudan CLI migration akışını doğrulamadan uygulamayın.

Mevcut production veritabanına SQL dosyalarının tamamını körlemesine uygulamayın. Önce ayrı test projesinde şema/RLS/RPC/Storage kontrolleri ve yedekleme yapın. Tamamen doğrulanmış tek komutlu bootstrap bu depoda yoktur. Supabase CLI config'inde mevcut projenin public project ref'i korunmuştur; kendi hedef projenize bilinçli şekilde link edin.

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy vton-proxy
npx supabase functions deploy recs-feed
npx supabase functions deploy delete-account
```

FASHN anahtarını Supabase secret store üzerinden tanımlayın. `SUPABASE_URL` ve `SUPABASE_SERVICE_ROLE_KEY` fonksiyon ortamında mevcut olmalıdır; private değerleri kod/config içine kopyalamayın. JWT verification ve fonksiyon içi kullanıcı kontrolü korunur. Auth provider, doğrulama e-postaları, redirect adresleri ve RLS politikalarını gerçek kayıt/giriş akışıyla test edin.

## Öneri worker ve cutout

`20260929_discover_recommendation_cache.sql` cache/job tabloları ve erişim politikalarını içerir. Cache kullanımı için import snapshot/preparation adımları ve ayrı `scripts/processRecommendationJobs.ts --watch` consumer'ı gerekir. Worker service-role key'i yalnızca sunucu ortamında alır. CLI kullanımı [cache README](../src/recommendationCache/README.md) içinde açıklanmıştır.

Cutout özelliği için `20260930_wardrobe_cutout_storage.sql`, private Storage bucket ve ayrı Python servisi gerekir. Production'da telefonun erişebildiği HTTPS endpoint'i kullanın; model/service sağlığını test edin. Repository bir production servis supervisor veya HTTPS gateway'i sağlamaz.

## EAS

`eas.json` profilleri ilgili EAS environment'ını seçer. Önceden dosyada bulunan gerçek Supabase URL/key değerleri kaldırılmıştır. Build öncesinde her ilgili EAS ortamında gereken `EXPO_PUBLIC_*` değerlerini güvenli yönetim arayüzü/CLI üzerinden tanımlayın. Bu public değerler bundle'a gömülür; service-role, FASHN anahtarı, EAS token veya signing credential eklemeyin. EAS credentials/CI erişimi ayrı yönetilir.

| Profil | Mevcut Android çıktısı |
| --- | --- |
| development | Internal APK, development client |
| preview | Internal APK |
| production | AAB, autoIncrement |

```bash
eas build --platform android --profile preview
eas build --platform android --profile production
eas submit --platform android --profile production
```

Submit profili Android internal track / draft kullanır. iOS signing ve mağaza submit gereksinimleri ayrıca yapılandırılmalıdır. Bundle identifier, package, scheme, owner ve EAS project ID mevcut değerleri korur. Bu hazırlık herhangi bir cloud build, mağaza submit veya SQL deploy yapmamıştır.

## Yayın ön koşulları

- Test, lint ve typecheck sonuçlarını değerlendirin; başarılı kabul etmeyin.
- Gerçek cihazda auth, keşif, favoriler, öneriler, dolap, kamera/galeri, FASHN ve hesap silme akışlarını doğrulayın.
- `lib/privacy.ts` içindeki mevcut privacy/support adreslerini, marka adını ve mağaza beyanlarını yayın öncesi doğrulayın. Kodda support için TODO bulunur.
- `app.json` kamera, internet, titreşim ve bildirim izinlerini tanımlar; mikrofon engellenir. Gizlilik/mağaza metinlerinin gerçek kullanım ile uyumunu inceleyin.
- Tarihsel anon key bulgusu için SECURITY.md'yi okuyun. History rewrite yapılmamıştır.
- Web script'i vardır; web dependency/özellik uyumluluğu ve deployment bu hazırlıkta doğrulanmamıştır.
