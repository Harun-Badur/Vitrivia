# Dolap arka plan silme servisi

Yalnızca `addWardrobeItem` ile eklenen kullanıcı fotoğraflarını işler. Favori/katalog ürünleri bu servise gönderilmez; mevcut katalog veya Dolap kayıtları için toplu işlem yapmaz.

AI, `rembg` + `u2netp` ile kendi bilgisayarınızda/sunucunuzda CPU üzerinde çalışır. Ücretli görsel API'si ve uygulamaya yeni native bağımlılık eklenmez. Bu çözüm telefonda model çalıştırmaz; telefonun erişebileceği yerel/self-hosted bir servis gerekir. [rembg kaynak ve kullanım belgesi](https://github.com/danielgatis/rembg).

## Kurulum

1. `supabase/migrations/20260930_wardrobe_cutout_storage.sql` migration'ını uygulayın. Sadece `wardrobe-cutouts` adlı özel Storage bucket'ını ve kullanıcı klasörü RLS kurallarını oluşturur.
2. Python 3.12 ile bu klasörde `pip install -r requirements.txt` çalıştırın. `SUPABASE_URL` ve `SUPABASE_ANON_KEY` ortam değişkenlerini mevcut projenize göre tanımlayın. Service-role anahtarı gerekmez.
3. `python server.py` çalıştırın. Telefonla aynı ağda denemek için `HOST=0.0.0.0` kullanın. İlk çalıştırmada model indirilir, sonraki görsel işlemleri local yapılır. Supabase yalnızca oturum doğrulaması ve Storage için kullanılır.
4. Uygulamanın `.env` dosyasına `EXPO_PUBLIC_WARDROBE_CUTOUT_URL=http://BILGISAYARIN_LAN_IP_ADRESI:7010/v1/wardrobe/cutout` ekleyip Expo'yu yeniden başlatın. Yayın sürümünde servis için HTTPS adresi kullanın.

Docker alternatifi: bu klasörde `docker build -t vitrivia-wardrobe-cutout .` ardından `docker run --rm -p 7010:7010 --env-file /path/to/cutout.env vitrivia-wardrobe-cutout`. `cutout.env` sadece `SUPABASE_URL` ve `SUPABASE_ANON_KEY` içermelidir. Docker image model dosyasını içerir.

Windows'ta proje kökünden `pwsh -File services/wardrobe-cutout/start.ps1 -Setup` ilk kurulumu yapıp mevcut servisi başlatır. Sonraki başlatmalar için `pwsh -File services/wardrobe-cutout/start.ps1` yeterlidir. Script mevcut `.env` dosyasından yalnızca Supabase URL ve anon key'i okur; CPU sanal ortamı `.venv`, model önbelleği `.models` klasöründedir. `GET /health` servisin hazır olduğunu gösterir.

## Saklama ve hata davranışı

- Orijinal fotoğrafın kalıcı cihaz kopyası `WardrobeItem.imageUrl` alanında aynen korunur.
- JPEG işlem kopyası orijinali değiştirmez. Çıktı alpha kanallı PNG'dir; fotoğraf EXIF/GPS bilgisi çıktıya taşınmaz.
- PNG önce cihazda `cutoutLocalUri`, sonra özel bucket'ta `<auth-user-id>/<wardrobe-item-id>/cutout.png` olarak saklanır. `cutoutStoragePath`, süreli `cutoutUrl` ve `cutoutUrlExpiresAt` mevcut AsyncStorage kıyafet kaydına eklenir. Yeni bir kıyafet senkronizasyonu/tablo yazma akışı oluşturulmaz.
- Dolap kartları ve Kombin Oluştur aynı cutout kaynağını kullanır: önce Storage cutout URL'si, yoksa cihazdaki PNG, henüz hazır değilse orijinal. Dolap kartı bir kaynağı yükleyemezse sıradaki kaynağı dener. Kart stilleri ve navigation değişmez.
- İşleme mevcut yerel kayıt tamamlandıktan sonra başlar. Servis tanımlı değilse kayıt `pending` kalır; ağ/servis/Storage hatasında `error` olur. Sonraki Dolap hydration'ında yeniden denenir. Upload hatası sonrasında hazır yerel PNG tekrar üretilmez. İmzalı URL'ler hydration sırasında yenilenir; local PNG çevrimdışı kullanılabilir.
- Servis sadece yüklenen JPEG baytlarını kabul eder; harici görsel URL'si veya katalog kimliği kabul etmez. Supabase JWT doğrulanır. Görseller disk veya loglara yazılmaz; tek CPU inference ve 12 MiB giriş/çıkış sınırı uygulanır.

Genel foreground modeli fotoğraftaki ana nesneyi ayırır. Birinin üzerinde çekilen kıyafette kişiyi de foreground içinde tutabilir; bu servis ayrı bir kıyafet segmentasyonu modeli değildir.

## Kontroller

`python -m unittest discover -s . -p 'test_*.py'` PNG alpha/metadata, hatalı giriş ve endpoint kimlik doğrulamasını model indirmeden test eder. Gerçek model kontrolü için `python smoke.py /path/to/garment.jpg /path/to/cutout.png` çalıştırın.
