-- Separate, private storage for user-uploaded wardrobe cutouts only.
-- Does not modify products, liked_products, or existing wardrobe records.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wardrobe-cutouts', 'wardrobe-cutouts', false, 12582912, array['image/png'])
on conflict (id) do nothing;

create policy wardrobe_cutouts_select_own on storage.objects
for select to authenticated
using (
  bucket_id = 'wardrobe-cutouts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy wardrobe_cutouts_insert_own on storage.objects
for insert to authenticated
with check (
  bucket_id = 'wardrobe-cutouts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy wardrobe_cutouts_update_own on storage.objects
for update to authenticated
using (
  bucket_id = 'wardrobe-cutouts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
)
with check (
  bucket_id = 'wardrobe-cutouts'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
