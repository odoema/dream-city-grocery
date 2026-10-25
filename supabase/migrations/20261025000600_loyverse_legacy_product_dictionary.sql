-- DREAM CITY GROCERY: LOYVERSE LEGACY PRODUCT DICTIONARY
-- Reference-only. Does NOT import historical stock quantities.

begin;

create table if not exists public.dream_city_legacy_product_dictionary (
  id uuid primary key default gen_random_uuid(),
  source_system text not null default 'loyverse',
  source_handle text,
  source_sku text,
  source_name text not null,
  source_category text,
  display_name text not null,
  category_id uuid references public.dream_city_category_dictionary(id) on delete set null,
  description text,
  sold_by_weight boolean,
  source_cost numeric,
  source_barcode text,
  source_track_stock boolean,
  source_available_for_sale boolean,
  source_price numeric,
  source_low_stock numeric,
  lifecycle_status text not null default 'legacy' check (lifecycle_status in ('legacy','candidate','active','paused','discontinued')),
  notes text not null default '',
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system, source_handle)
);

create index if not exists dc_legacy_product_name_idx on public.dream_city_legacy_product_dictionary(lower(source_name));
create index if not exists dc_legacy_product_category_idx on public.dream_city_legacy_product_dictionary(source_category);
create index if not exists dc_legacy_product_sku_idx on public.dream_city_legacy_product_dictionary(source_sku);
create index if not exists dc_legacy_product_status_idx on public.dream_city_legacy_product_dictionary(lifecycle_status);

-- Add every category found in the Loyverse export. Existing cleaned mappings are preserved.
insert into public.dream_city_category_dictionary (source_name, display_name, normalized_key, department)
values
  ('Air freshener','Air freshener','air-freshener','Household'),
  ('All Purpose Cleaner','All Purpose Cleaner','all-purpose-cleaner','Household'),
  ('Baby Diaper','Baby Diaper','baby-diaper','Baby'),
  ('baby rattles','baby rattles','baby-rattles','Baby'),
  ('Baking Powder','Baking Powder','baking-powder','Food'),
  ('Balanites Oil','Balanites Oil','balanites-oil','Personal Care'),
  ('Ball','Ball','ball','Sports & Toys'),
  ('Ball Pen','Ball Pen','ball-pen','Stationery'),
  ('Bar Soap','Bar Soap','bar-soap','Personal Care'),
  ('Bathing Soap','Bathing Soap','bathing-soap','Personal Care'),
  ('Beauty Mirror','Beauty Mirror','beauty-mirror','Personal Care'),
  ('Birthday Candle','Birthday Candle','birthday-candle','Party & Events'),
  ('Biscuits','Biscuits','biscuits','Food'),
  ('blowing Wistle','blowing Wistle','blowing-whistle','Sports & Toys'),
  ('Books','Books','books','Stationery'),
  ('Boxer','Boxer','boxer','Clothing'),
  ('Bread','Bread','bread','Food'),
  ('Brush','Brush','brush','Personal Care'),
  ('Cake','Cake','cake','Food'),
  ('Carboxy Methyl Cellulose (CMC)','Carboxy Methyl Cellulose (CMC)','carboxy-methyl-cellulose-cmc','Food'),
  ('cello tape','cello tape','cello-tape','Stationery'),
  ('Chewing Gum','Chewing Gum','chewing-gum','Food'),
  ('Cider','Cider','cider','Beverages'),
  ('Coffee','Coffee','coffee','Food'),
  ('Comb','Comb','comb','Personal Care'),
  ('Cooking Oil','Cooking Oil','cooking-oil','Food'),
  ('Cream','Cream','cream','Personal Care'),
  ('Curry Powder','Curry Powder','curry-powder','Food'),
  ('Decorative Lights','Decorative Lights','decorative-lights','Party & Events'),
  ('Disinfectant','Disinfectant','disinfectant','Household'),
  ('Downy','Downy','downy','Household'),
  ('Drink','Drink','drink','Beverages'),
  ('Drinking Chocolate','Drinking Chocolate','drinking-chocolate','Beverages'),
  ('Drinking Milk','Drinking Milk','drinking-milk','Beverages'),
  ('Dry cell (Batteries)','Dry cell (Batteries)','dry-cell-batteries','Household'),
  ('Ear buds','Ear buds','ear-buds','Personal Care'),
  ('Eggs','Eggs','eggs','Food'),
  ('Essential Oil','Essential Oil','essential-oil','Personal Care'),
  ('Flavouring','Flavouring','flavouring','Food'),
  ('Gelatine Power','Gelatine Power','gelatine-power','Food'),
  ('Glucose','Glucose','glucose','Food'),
  ('Glycerine','Glycerine','glycerine','Personal Care'),
  ('Hair Conditioner','Hair Conditioner','hair-conditioner','Personal Care'),
  ('Hair Dye','Hair Dye','hair-dye','Personal Care'),
  ('Hair Food','Hair Food','hair-food','Personal Care'),
  ('Hair Gel','Hair Gel','hair-gel','Personal Care'),
  ('Hair Moisturizer','Hair Moisturizer','hair-moisturizer','Personal Care'),
  ('Hair Relaxer','Hair Relaxer','hair-relaxer','Personal Care'),
  ('Hair Scratcher','Hair Scratcher','hair-scratcher','Personal Care'),
  ('Hair Spray','Hair Spray','hair-spray','Personal Care'),
  ('Handkerchiefs','Handkerchiefs','handkerchiefs','Clothing'),
  ('Hanger','Hanger','hanger','Household'),
  ('Hibiscus Powder','Hibiscus Powder','hibiscus-powder','Food'),
  ('Honey','Honey','honey','Food'),
  ('Icing Sugar','Icing Sugar','icing-sugar','Food'),
  ('Insulating Tape','Insulating Tape','insulating-tape','Household'),
  ('jam','jam','jam','Food'),
  ('Jerican','Jerican','jerican','Household'),
  ('Juice','Juice','juice','Beverages'),
  ('Jus4 ever','Jus4 ever','jus4-ever','Beverages'),
  ('knickers','knickers','knickers','Clothing'),
  ('Lip Bulm','Lip Bulm','lip-bulm','Personal Care'),
  ('Lotion','Lotion','lotion','Personal Care'),
  ('Lotion Tube','Lotion Tube','lotion-tube','Personal Care'),
  ('Magic','Magic','magic','Other'),
  ('Marasi','Marasi','marasi','Other'),
  ('Margarine','Margarine','margarine','Food'),
  ('Match Box','Match Box','match-box','Household'),
  ('Mineral water','Mineral water','mineral-water','Beverages'),
  ('Miracle Oil','Miracle Oil','miracle-oil','Personal Care'),
  ('Mixed Spices','Mixed Spices','mixed-spices','Food'),
  ('Mosquito Repellent','Mosquito Repellent','mosquito-repellent','Household'),
  ('Nail Cutter','Nail Cutter','nail-cutter','Personal Care'),
  ('Noodles','Noodles','noodles','Food'),
  ('Omo','Omo','omo','Household'),
  ('Padlock','Padlock','padlock','Household'),
  ('Paper Box','Paper Box','paper-box','Household'),
  ('Party Fun Popper','Party Fun Popper','party-fun-popper','Party & Events'),
  ('Party Spray','Party Spray','party-spray','Party & Events'),
  ('Pencil','Pencil','pencil','Stationery'),
  ('Perfume','Perfume','perfume','Personal Care'),
  ('Petroleum Jelly','Petroleum Jelly','petroleum-jelly','Personal Care'),
  ('Powder Milk','Powder Milk','powder-milk','Beverages'),
  ('Powdered Drink','Powdered Drink','powdered-drink','Beverages'),
  ('Preservative','Preservative','preservative','Food'),
  ('Pure Sheabutter','Pure Sheabutter','pure-sheabutter','Personal Care'),
  ('Raisins','Raisins','raisins','Food'),
  ('Razer Blade','Razer Blade','razer-blade','Personal Care'),
  ('Rice','Rice','rice','Food'),
  ('Royco','Royco','royco','Food'),
  ('Salt','Salt','salt','Food'),
  ('Sanitary pads','Sanitary pads','sanitary-pads','Personal Care'),
  ('Scissor','Scissor','scissor','Stationery'),
  ('Shades','Shades','shades','Personal Care'),
  ('Shampoo','Shampoo','shampoo','Personal Care'),
  ('Shea Butter Food Oil','Shea Butter Food Oil','shea-butter-food-oil','Food'),
  ('Shea Butter Oil','Shea Butter Oil','shea-butter-oil','Personal Care'),
  ('Shea Butter Soap','Shea Butter Soap','shea-butter-soap','Personal Care'),
  ('Shoe Polish','Shoe Polish','shoe-polish','Household'),
  ('Smearing oil','Smearing oil','smearing-oil','Personal Care'),
  ('Soda','Soda','soda','Beverages'),
  ('Spaghetti','Spaghetti','spaghetti','Food'),
  ('sprinkles','sprinkles','sprinkles','Food'),
  ('stockings','stockings','stockings','Clothing'),
  ('Sugar','Sugar','sugar','Food'),
  ('Sweets','Sweets','sweets','Food'),
  ('Syrup','Syrup','syrup','Beverages'),
  ('Table Salt','Table Salt','table-salt','Food'),
  ('Tea','Tea','tea','Beverages'),
  ('Toilet Cleaner','Toilet Cleaner','toilet-cleaner','Household'),
  ('Toilet Paper','Toilet Paper','toilet-paper','Household'),
  ('Tomatoe Sauce','Tomatoe Sauce','tomatoe-sauce','Food'),
  ('Tooth Brush','Tooth Brush','tooth-brush','Personal Care'),
  ('Tooth Paste','Tooth Paste','tooth-paste','Personal Care'),
  ('Tooth Pick','Tooth Pick','tooth-pick','Personal Care'),
  ('Toys','Toys','toys','Sports & Toys'),
  ('under wear','under wear','under-wear','Clothing'),
  ('Washing Powder','Washing Powder','washing-powder','Household'),
  ('Washing Sponge','Washing Sponge','washing-sponge','Household'),
  ('Watches','Watches','watches','Other'),
  ('Wheat Flour','Wheat Flour','wheat-flour','Food'),
  ('White Ants Paste','White Ants Paste','white-ants-paste','Household'),
  ('wine','wine','wine','Beverages'),
  ('Yeast','Yeast','yeast','Food')
on conflict (source_system, source_name) do nothing;

/*
  Product rows from the supplied 341-item Loyverse export are loaded by the
  companion import script. Historical "In stock" is deliberately excluded.
*/

create or replace view public.dream_city_legacy_product_options
with (security_invoker = true)
as
select
  p.id,
  p.source_handle,
  p.source_sku,
  p.source_name,
  p.display_name,
  p.source_category,
  c.display_name as category_display_name,
  c.department,
  p.source_barcode,
  p.source_price,
  p.source_cost,
  p.source_low_stock,
  p.source_track_stock,
  p.source_available_for_sale,
  p.lifecycle_status
from public.dream_city_legacy_product_dictionary p
left join public.dream_city_category_dictionary c on c.id = p.category_id;

alter table public.dream_city_legacy_product_dictionary enable row level security;

drop policy if exists "staff can read legacy product dictionary"
  on public.dream_city_legacy_product_dictionary;

create policy "staff can read legacy product dictionary"
on public.dream_city_legacy_product_dictionary
for select
to authenticated
using (public.current_staff_role() in ('owner','manager','cashier','accountant'));

grant select on public.dream_city_legacy_product_dictionary to authenticated;
grant select on public.dream_city_legacy_product_options to authenticated;

comment on table public.dream_city_legacy_product_dictionary is
  'Reference-only product dictionary imported from Loyverse. Historical in-stock quantities are intentionally excluded and must never be treated as live Dream City inventory.';

commit;

select count(*) as category_count
from public.dream_city_category_dictionary
where source_system = 'loyverse';
