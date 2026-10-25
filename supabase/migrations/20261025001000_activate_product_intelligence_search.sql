begin;

-- Activate the reference-only Product Intelligence search used by product-intelligence.js.
-- This function searches the 341-product legacy catalogue only. It does not modify
-- live inventory, pricing, sales, purchasing, or accounting.

create or replace function public.search_dream_city_products(
  p_query text default '',
  p_limit integer default 12
)
returns table (
  source_handle text,
  source_sku text,
  product_name text,
  category text,
  source_cost numeric,
  source_price numeric,
  source_low_stock numeric,
  lifecycle_status text,
  match_score integer
)
language sql
stable
set search_path = public
as $$
  with q as (
    select lower(trim(coalesce(p_query, ''))) as term
  )
  select
    d.source_handle,
    d.source_sku,
    d.source_name as product_name,
    d.source_category as category,
    d.source_cost,
    d.source_price,
    d.source_low_stock,
    d.lifecycle_status,
    case
      when q.term = '' then 0
      when lower(coalesce(d.source_name,'')) = q.term then 100
      when lower(coalesce(d.source_name,'')) like q.term || '%' then 90
      when lower(coalesce(d.source_sku,'')) = q.term then 95
      when lower(coalesce(d.source_sku,'')) like q.term || '%' then 85
      when lower(coalesce(d.source_category,'')) like q.term || '%' then 70
      when lower(coalesce(d.source_name,'')) like '%' || q.term || '%' then 60
      when lower(coalesce(d.source_category,'')) like '%' || q.term || '%' then 50
      else 10
    end as match_score
  from public.dream_city_legacy_product_dictionary d
  cross join q
  where q.term = ''
     or lower(coalesce(d.source_name,'')) like '%' || q.term || '%'
     or lower(coalesce(d.source_sku,'')) like '%' || q.term || '%'
     or lower(coalesce(d.source_category,'')) like '%' || q.term || '%'
  order by match_score desc, d.source_name asc
  limit greatest(1, least(coalesce(p_limit,12), 50));
$$;

comment on function public.search_dream_city_products(text, integer)
is 'Reference-only product intelligence search over the 341-product Loyverse legacy catalogue. Does not change live inventory, pricing or accounting.';

revoke all on function public.search_dream_city_products(text, integer) from public, anon;
grant execute on function public.search_dream_city_products(text, integer) to authenticated;

commit;
