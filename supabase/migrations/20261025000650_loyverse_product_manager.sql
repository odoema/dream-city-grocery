-- Dream City Grocery: Loyverse-style product management extension
-- Safe/additive only. Does not import historical Loyverse stock.

begin;

alter table public.products
  add column if not exists description text not null default '',
  add column if not exists available_for_sale boolean not null default true,
  add column if not exists sold_by_weight boolean not null default false,
  add column if not exists track_stock boolean not null default true,
  add column if not exists composite_item boolean not null default false,
  add column if not exists variant_options jsonb not null default '[]'::jsonb,
  add column if not exists pos_representation jsonb not null default '{}'::jsonb,
  add column if not exists source_system text,
  add column if not exists source_item_id text,
  add column if not exists source_image_url text;

create index if not exists products_source_lookup_idx
  on public.products(source_system, source_item_id);

create or replace function public.log_product_manager_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    insert into public.audit_log(actor_id, action, entity_type, entity_id, details)
    values (
      auth.uid(),
      case when tg_op = 'INSERT' then 'product.created' else 'product.updated' end,
      'product',
      coalesce(new.id, old.id),
      jsonb_build_object(
        'operation', tg_op,
        'name', coalesce(new.name, old.name),
        'sku', coalesce(new.sku, old.sku),
        'image_path', coalesce(new.image_path, old.image_path),
        'source_system', coalesce(new.source_system, old.source_system)
      )
    );
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists product_manager_audit on public.products;
create trigger product_manager_audit
after insert or update on public.products
for each row execute function public.log_product_manager_change();

revoke all on function public.log_product_manager_change() from public, anon;
grant execute on function public.log_product_manager_change() to authenticated;

-- Storage bucket for product images. Private by default.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('product-images','product-images',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;

-- These policies are additive and mirror the existing Dream City product-manager role model.
drop policy if exists "active staff read product images" on storage.objects;
drop policy if exists "managers upload product images" on storage.objects;
drop policy if exists "managers update product images" on storage.objects;
drop policy if exists "managers delete product images" on storage.objects;

create policy "active staff read product images"
on storage.objects for select to authenticated
using (bucket_id = 'product-images' and public.is_active_staff());

create policy "managers upload product images"
on storage.objects for insert to authenticated
with check (bucket_id = 'product-images' and public.can_manage_products());

create policy "managers update product images"
on storage.objects for update to authenticated
using (bucket_id = 'product-images' and public.can_manage_products())
with check (bucket_id = 'product-images' and public.can_manage_products());

create policy "managers delete product images"
on storage.objects for delete to authenticated
using (bucket_id = 'product-images' and public.can_manage_products());

commit;
