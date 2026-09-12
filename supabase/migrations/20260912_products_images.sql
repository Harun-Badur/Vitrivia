-- FAZ 2a: multi-image gallery column on products
-- images: ordered JSON array of product CDN URLs (cap enforced in scraper)
-- null default; backfill from legacy image_url for existing rows

alter table public.products
  add column if not exists images jsonb null default null;

update public.products
set images = jsonb_build_array(image_url)
where images is null
  and image_url is not null
  and btrim(image_url) <> '';
