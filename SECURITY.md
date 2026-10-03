# Güvenlik

Vitrify kişisel fotoğrafları, kullanıcı oturumlarını ve mağaza bağlantılarını işler. Credential, erişim tokenı, kullanıcı export'u veya private key repository'ye eklenmemelidir.

## Ortam ve erişim sınırları

- `.env*` dosyaları ignore edilir; yalnızca boş `.env.example` takip edilir.
- `EXPO_PUBLIC_*` değerleri uygulama bundle'ında görünür. Supabase anon key bir sunucu secretı değildir, ancak güvenlik RLS ve kullanıcı doğrulamasına dayanır.
- `SUPABASE_SERVICE_ROLE_KEY` ve `FASHN_API_KEY` yalnızca sunucu/Node ortamlarında tutulur; mobil build'e veya EAS config'ine yazılmaz.
- Signing keys, keystore, credentials, EAS/GitHub tokenları, model cache ve build çıktıları commit edilmez.

## Fotoğraf işleme

Sanal deneme, kullanıcının fotoğrafını Supabase `vton-proxy` üzerinden FASHN'a gönderir. Önceki güvenlik metnindeki sağlayıcıya fotoğraf gönderilmediği ifadesi mevcut kod için geçerli değildir. İsteğe bağlı dolap cutout servisi yüklenen JPEG'i ayrı Python sunucusunda işler; uygulama çıktıyı cihazda ve private Supabase Storage'da tutabilir. Gizlilik metni ve kullanıcı rızası gerçek veri akışlarıyla uyumlu olmalıdır.

## 2026-10-03 repository hazırlığı bulgusu

Git geçmişindeki `eas.json` dosyasında gerçek Supabase proje URL'leri ve `role=anon` JWT bulundu. İlgili commit'ler: `869027d` ve `a500786`. Hazırlık commit'i bu değerleri mevcut dosyadan kaldırır ve EAS ortam yapılandırmasını kullanır. Geçmişteki kopyalar halen erişilebilir; history rewrite veya force push yapılmamıştır.

Tüm erişilebilir Git blob'larına uygulanan pattern taramasında bu anon key dışında service-role JWT, FASHN anahtarı, tanınan private token veya private-key materyali tespit edilmedi. Pattern taraması mutlak güvence sağlamaz. Yerel `.env` dosyası yayın dışında tutulur.

## Bir erişim bilgisi açığa çıkarsa

İlgili serviste credential'ı iptal edin/yenileyin; etkilenmiş erişimleri ve RLS politikalarını inceleyin. Secretı mevcut dosyadan kaldırmak geçmişten silmez. Geçmiş temizliği depo sahibi tarafından açıkça onaylanmalı ve diğer kullanıcılarla koordine edilmelidir. Gerçek değerleri GitHub issue veya PR açıklamasında paylaşmayın.
