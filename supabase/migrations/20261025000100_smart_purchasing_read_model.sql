-- Dream City Grocery Smart Purchasing read model.
-- READ-ONLY: does not create purchases, change stock, or post accounting entries.
-- Target: dedicated Supabase project nohdgmylncjtdymfshfy ONLY.
--
-- Purpose:
--   Give staff a simple, explainable shopping list based on actual sales velocity,
--   current stock, reorder level and confirmed incoming stock.
--
-- Initial policy (deliberately transparent):
--   recent demand = 14-day units sold / 14
--   baseline demand = 30-day units sold / 30
--   adjusted daily demand = 60% recent + 40% baseline
--   target stock = adjusted daily demand * 5 cover days + reorder_level
--   confirmed incoming = quantities still outstanding on open purchase orders
--   recommended purchase = max(target stock - on hand - confirmed incoming, 0)
--
-- A future settings table can make cover days / safety stock configurable without
-- changing the analytical model. Pack-size rounding is intentionally deferred
-- because the current products table has no pack-size field.

begin;

create or replace view public.smart_purchase_recommendations
with (security_invoker = true)
as
with sales_14 as (
  select
    si.product_id,
    sum(si.quantity) as units_14d
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  where s.status = 'completed'
    and s.created_at >= now() - interval '14 days'
  group by si.product_id
),
sales_30 as (
  select
    si.product_id,
    sum(si.quantity) as units_30d
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  where s.status = 'completed'
    and s.created_at >= now() - interval '30 days'
  group by si.product_id
),
incoming as (
  select
    poi.product_id,
    sum(poi.quantity_ordered - poi.quantity_received) as incoming_qty
  from public.purchase_order_items poi
  join public.purchase_orders po on po.id = poi.purchase_order_id
  where po.status in ('ordered','part_received')
    and poi.quantity_ordered > poi.quantity_received
  group by poi.product_id
)
select
  p.id as product_id,
  p.sku,
  p.name as product_name,
  p.unit,
  p.category_id,
  c.name as category_name,
  p.supplier_id,
  s.name as supplier_name,
  p.quantity_on_hand,
  p.reorder_level,
  coalesce(s14.units_14d, 0)::numeric(14,3) as units_sold_14d,
  coalesce(s30.units_30d, 0)::numeric(14,3) as units_sold_30d,
  round(coalesce(s14.units_14d, 0) / 14.0, 3) as recent_daily_demand,
  round(coalesce(s30.units_30d, 0) / 30.0, 3) as baseline_daily_demand,
  round(
    (coalesce(s14.units_14d, 0) / 14.0) * 0.60
    + (coalesce(s30.units_30d, 0) / 30.0) * 0.40,
    3
  ) as adjusted_daily_demand,
  5::numeric as target_cover_days,
  coalesce(i.incoming_qty, 0)::numeric(14,3) as confirmed_incoming_qty,
  round(
    (
      ((coalesce(s14.units_14d, 0) / 14.0) * 0.60
       + (coalesce(s30.units_30d, 0) / 30.0) * 0.40) * 5
      + p.reorder_level
      - p.quantity_on_hand
      - coalesce(i.incoming_qty, 0)
    ),
    3
  ) as raw_recommended_qty,
  greatest(
    round(
      (
        ((coalesce(s14.units_14d, 0) / 14.0) * 0.60
         + (coalesce(s30.units_30d, 0) / 30.0) * 0.40) * 5
        + p.reorder_level
        - p.quantity_on_hand
        - coalesce(i.incoming_qty, 0)
      ),
      3
    ),
    0
  ) as recommended_qty,
  round(
    greatest(
      round(
        (
          ((coalesce(s14.units_14d, 0) / 14.0) * 0.60
           + (coalesce(s30.units_30d, 0) / 30.0) * 0.40) * 5
          + p.reorder_level
          - p.quantity_on_hand
          - coalesce(i.incoming_qty, 0)
        ),
        3
      ),
      0
    ) * p.buying_price,
    2
  ) as estimated_purchase_cost,
  case
    when p.quantity_on_hand <= 0 and (
      (coalesce(s14.units_14d, 0) / 14.0) * 0.60
      + (coalesce(s30.units_30d, 0) / 30.0) * 0.40
    ) > 0 then 'urgent'
    when p.quantity_on_hand <= p.reorder_level then 'recommended'
    when greatest(
      round(
        (
          ((coalesce(s14.units_14d, 0) / 14.0) * 0.60
           + (coalesce(s30.units_30d, 0) / 30.0) * 0.40) * 5
          + p.reorder_level
          - p.quantity_on_hand
          - coalesce(i.incoming_qty, 0)
        ),
        3
      ),
      0
    ) > 0 then 'recommended'
    else 'watch'
  end as recommendation_priority,
  case
    when (
      (coalesce(s14.units_14d, 0) / 14.0) * 0.60
      + (coalesce(s30.units_30d, 0) / 30.0) * 0.40
    ) > 0 then round(
      p.quantity_on_hand /
      nullif(
        (coalesce(s14.units_14d, 0) / 14.0) * 0.60
        + (coalesce(s30.units_30d, 0) / 30.0) * 0.40,
        0
      ),
      1
    )
    else null
  end as estimated_days_of_stock,
  p.buying_price as latest_known_buying_price,
  now() as calculated_at
from public.products p
left join public.categories c on c.id = p.category_id
left join public.suppliers s on s.id = p.supplier_id
left join sales_14 s14 on s14.product_id = p.id
left join sales_30 s30 on s30.product_id = p.id
left join incoming i on i.product_id = p.id
where p.active = true;

create index if not exists purchase_order_items_product_status_idx
  on public.purchase_order_items(product_id, purchase_order_id);

comment on view public.smart_purchase_recommendations is
  'Explainable read-only shopping recommendations. Never changes stock or creates a purchase.';

commit;
