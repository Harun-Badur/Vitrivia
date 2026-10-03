-- Wardrobe and outfits V1. Requires schema_products.sql and schema.sql.
-- Favorites remain in liked_products; wardrobe items are separate user-owned data.

create table if not exists public.wardrobe_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  image_url text not null,
  name text not null,
  category text not null,
  subcategory text,
  color text,
  secondary_colors jsonb not null default '[]'::jsonb
    check (jsonb_typeof(secondary_colors) = 'array'),
  pattern text,
  brand text,
  size text,
  season text,
  style_tags jsonb not null default '[]'::jsonb
    check (jsonb_typeof(style_tags) = 'array'),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.outfits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null,
  cover_image text,
  occasion text,
  notes text,
  scheduled_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.outfit_items (
  id uuid primary key default gen_random_uuid(),
  outfit_id uuid not null references public.outfits (id) on delete cascade,
  source_type text not null check (source_type in ('wardrobe', 'catalog')),
  wardrobe_item_id uuid references public.wardrobe_items (id) on delete cascade,
  product_id text references public.products (id) on delete restrict,
  position integer not null default 0 check (position >= 0),
  created_at timestamptz not null default now(),
  constraint outfit_items_source_matches_reference check (
    (source_type = 'wardrobe' and wardrobe_item_id is not null and product_id is null)
    or
    (source_type = 'catalog' and product_id is not null and wardrobe_item_id is null)
  )
);

create index if not exists wardrobe_items_user_created_at_idx
  on public.wardrobe_items (user_id, created_at desc);
create index if not exists outfits_user_created_at_idx
  on public.outfits (user_id, created_at desc);
create index if not exists outfit_items_outfit_position_idx
  on public.outfit_items (outfit_id, position, id);
create index if not exists outfit_items_wardrobe_item_id_idx
  on public.outfit_items (wardrobe_item_id)
  where wardrobe_item_id is not null;
create index if not exists outfit_items_product_id_idx
  on public.outfit_items (product_id)
  where product_id is not null;

create or replace function public.set_wardrobe_outfit_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_wardrobe_items_updated_at on public.wardrobe_items;
create trigger trg_wardrobe_items_updated_at
before update on public.wardrobe_items
for each row execute function public.set_wardrobe_outfit_updated_at();

drop trigger if exists trg_outfits_updated_at on public.outfits;
create trigger trg_outfits_updated_at
before update on public.outfits
for each row execute function public.set_wardrobe_outfit_updated_at();

alter table public.wardrobe_items enable row level security;
alter table public.outfits enable row level security;
alter table public.outfit_items enable row level security;

drop policy if exists wardrobe_items_select_own on public.wardrobe_items;
create policy wardrobe_items_select_own on public.wardrobe_items
for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists wardrobe_items_insert_own on public.wardrobe_items;
create policy wardrobe_items_insert_own on public.wardrobe_items
for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists wardrobe_items_update_own on public.wardrobe_items;
create policy wardrobe_items_update_own on public.wardrobe_items
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists wardrobe_items_delete_own on public.wardrobe_items;
create policy wardrobe_items_delete_own on public.wardrobe_items
for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists outfits_select_own on public.outfits;
create policy outfits_select_own on public.outfits
for select to authenticated using (user_id = (select auth.uid()));

drop policy if exists outfits_insert_own on public.outfits;
create policy outfits_insert_own on public.outfits
for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists outfits_update_own on public.outfits;
create policy outfits_update_own on public.outfits
for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

drop policy if exists outfits_delete_own on public.outfits;
create policy outfits_delete_own on public.outfits
for delete to authenticated using (user_id = (select auth.uid()));

-- Item ownership comes from the parent outfit. Wardrobe references must
-- additionally point to an item owned by the same authenticated user.
drop policy if exists outfit_items_select_own on public.outfit_items;
create policy outfit_items_select_own on public.outfit_items
for select to authenticated using (
  exists (
    select 1 from public.outfits as o
    where o.id = outfit_id and o.user_id = (select auth.uid())
  )
);

drop policy if exists outfit_items_insert_own on public.outfit_items;
create policy outfit_items_insert_own on public.outfit_items
for insert to authenticated with check (
  exists (
    select 1 from public.outfits as o
    where o.id = outfit_id and o.user_id = (select auth.uid())
  )
  and (
    source_type = 'catalog'
    or exists (
      select 1 from public.wardrobe_items as w
      where w.id = wardrobe_item_id and w.user_id = (select auth.uid())
    )
  )
);

drop policy if exists outfit_items_update_own on public.outfit_items;
create policy outfit_items_update_own on public.outfit_items
for update to authenticated
using (
  exists (
    select 1 from public.outfits as o
    where o.id = outfit_id and o.user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.outfits as o
    where o.id = outfit_id and o.user_id = (select auth.uid())
  )
  and (
    source_type = 'catalog'
    or exists (
      select 1 from public.wardrobe_items as w
      where w.id = wardrobe_item_id and w.user_id = (select auth.uid())
    )
  )
);

drop policy if exists outfit_items_delete_own on public.outfit_items;
create policy outfit_items_delete_own on public.outfit_items
for delete to authenticated using (
  exists (
    select 1 from public.outfits as o
    where o.id = outfit_id and o.user_id = (select auth.uid())
  )
);

grant select, insert, update, delete on public.wardrobe_items to authenticated;
grant select, insert, update, delete on public.outfits to authenticated;
grant select, insert, update, delete on public.outfit_items to authenticated;
