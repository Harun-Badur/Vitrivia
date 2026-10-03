# Geliştirme

`npm ci` ile lockfile'a bağlı kurulum yapın. `.env.example` dosyasını `.env` olarak kopyalayın; kullanmadığınız opsiyonel değişkenleri boş bırakın veya kaldırın. Python servisinde `HOST`, `PORT` ve model varsayılanlarını kullanmak için bu değişkenleri servis ortamına boş değerle aktarmayın. Sunucu değişkenleri istemci build ortamından ayrıdır.

```bash
npm start
npm run android
npm run ios
npm run lint
npm test -- --runInBand
npx tsc --noEmit
```

Jest ana config'i `__tests__/**/*.test.ts` dosyalarını seçer. Native servisler için mevcut izole config'ler:

```bash
npx jest --config __tests__/accountDetails.jest.cjs --runInBand
npx jest --config __tests__/styleSheets.jest.cjs --runInBand
npx jest --config __tests__/wardrobeCutout.jest.cjs --runInBand
```

Python servis testleri kendi README'sindeki unittest komutuyla çalıştırılır; Python bağımlılıkları ayrı kurulur. `supabase/tests/discover_recommendation_cache_rls.sql` ayrı migrate edilmiş test veritabanında çalıştırılmalıdır. Lint ve app TypeScript config'i Edge Functions ve scriptlerin tamamını doğrulamaz.

## Veri araçları

`package.json` içindeki `import:feed`, `refresh:images`, `seed:catalog`, `seed:attributes`, `seed:expansion` ve `simulate:price-drop` komutları mevcut araçlardır. Bunlar veritabanına yazabilir veya gerçek bildirim gönderebilir; hedef projesini ve script argümanlarını inceleyin. Bu repository hazırlığı sırasında çalıştırılmamıştır.

`dryRunPdfCatalog.ts` ve `importApprovedPdfCatalog.ts` belirli yerel katalog girdileri/raporlarına bağlıdır. `scripts/data/pdf_catalog_*` raporları ve kökteki PDF extraction metni yerel artifact olarak ignore edilir. Bu tek seferlik araçlar temiz checkout'ta raporlar yeniden hazırlanmadıkça çalışmaz. Diğer kaynak, TSV input/example ve test fixture'ları korunur.

Öneri cache snapshot/preparation/job consumer komutları için [cache belgesi](../src/recommendationCache/README.md) kullanılmalıdır. Çıktılar `output/` altında tutulabilir; kullanıcı context içeren snapshot'ları commit etmeyin.

## Değişiklik disiplini

UI, öneri algoritması ve schema değişikliklerini repository bakımından ayrı tutun. Kontrol başarısızlıklarını gizlemeyin; PR'da doğrulama sonucunu ve kapsamını belirtin. Lockfile'ı dependency değişikliği yokken yeniden üretmeyin. Commit öncesi `git diff`, `git status` ve staged içerikte credential kontrolü yapın. Yerel build, cache, model ve özel kullanıcı verileri repoya girmez.
