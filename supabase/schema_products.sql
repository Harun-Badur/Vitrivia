-- Kabin products tablosu + RLS
-- Supabase Dashboard > SQL Editor içinde çalıştırın.

create table if not exists public.products (
  id text not null,
  provider text not null check (
    provider in ('amazon', 'trendyol', 'hepsiburada', 'mock')
  ),
  external_id text not null,
  title text not null,
  brand text,
  price numeric not null,
  currency text not null default 'TRY',
  image_url text not null,
  product_url text not null,
  category text not null check (
    category in ('upper_body', 'lower_body', 'dresses')
  ),
  affiliate_url text,
  garment_description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, external_id)
);

create unique index if not exists products_id_key on public.products (id);

create or replace function public.set_products_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
before update on public.products
for each row
execute procedure public.set_products_updated_at();

alter table public.products enable row level security;

drop policy if exists products_select_anon on public.products;
create policy products_select_anon
on public.products
for select
to anon, authenticated
using (true);

grant select on public.products to anon, authenticated;
grant all on public.products to service_role;

alter table public.products add column if not exists garment_description text;

-- FAZ 2a multi-image gallery (nullable jsonb; scraper writes ordered URL array)
alter table public.products add column if not exists images jsonb null default null;

