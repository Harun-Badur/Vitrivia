-- Requires schema_products.sql and recs_v1.sql.
-- Existing products and product_attributes rows are not backfilled.

alter table public.product_attributes
  add column if not exists outfit_role text;

alter table public.product_attributes
  drop constraint if exists product_attributes_outfit_role_check;

alter table public.product_attributes
  add constraint product_attributes_outfit_role_check
  check (
    outfit_role is null or outfit_role in (
      'top', 'bottom', 'outerwear', 'one_piece',
      'shoes', 'bag', 'hat', 'accessory'
    )
  );

alter table public.products
  drop constraint if exists products_category_check;

alter table public.products
  add constraint products_category_check
  check (category in (
    'upper_body', 'lower_body', 'dresses',
    'shoes', 'bags', 'hats', 'accessories'
  ));
