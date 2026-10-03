-- Expand the existing provider constraint without changing product rows.
alter table public.products
  drop constraint if exists products_provider_check;

alter table public.products
  add constraint products_provider_check
  check (provider in (
    'amazon', 'trendyol', 'hepsiburada', 'mock',
    'boyner', 'mavi', 'lcw', 'defacto', 'flo'
  ));
