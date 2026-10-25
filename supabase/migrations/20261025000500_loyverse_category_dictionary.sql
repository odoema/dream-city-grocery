/*
  Dream City Grocery - Loyverse Category Dictionary

  PURPOSE
  -------
  Preserve the category vocabulary from the former Loyverse system as a
  reference/design layer without importing historical quantities or stock.

  IMPORTANT
  ---------
  - This migration does NOT create products.
  - This migration does NOT change inventory.
  - This migration does NOT change prices or accounting.
  - source_name preserves the Loyverse category exactly as supplied.
  - display_name is the worker-facing cleaned label.
  - department is an optional higher-level navigation group.

  The dictionary is intended to power product onboarding, searchable
  dropdowns, POS filters, Buy filters and future product import mapping.
*/

begin;

create table if not exists public.dream_city_category_dictionary (
  id uuid primary key default gen_random_uuid(),
  source_system text not null default 'loyverse',
  source_name text not null,
  display_name text not null,
  normalized_key text not null,
  department text not null default 'Other',
  active boolean not null default true,
  sort_order integer not null default 100,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system, source_name),
  unique (source_system, normalized_key)
);

create index if not exists dream_city_category_dictionary_active_idx
  on public.dream_city_category_dictionary(active, sort_order, display_name);

create index if not exists dream_city_category_dictionary_department_idx
  on public.dream_city_category_dictionary(department, active, sort_order);

insert into public.dream_city_category_dictionary
  (source_name, display_name, normalized_key, department, sort_order)
values
  ('Air freshener', 'Air Freshener', 'air-freshener', 'Household', 10),
  ('All Purpose Cleaner', 'All Purpose Cleaner', 'all-purpose-cleaner', 'Household', 20),
  ('Baby Diaper', 'Baby Diaper', 'baby-diaper', 'Baby', 30),
  ('baby rattles', 'Baby Rattles', 'baby-rattles', 'Baby', 40),
  ('Baking Powder', 'Baking Powder', 'baking-powder', 'Food', 50),
  ('Balanites Oil', 'Balanites Oil', 'balanites-oil', 'Personal Care', 60),
  ('Ball', 'Ball', 'ball', 'Sports & Toys', 70),
  ('Ball Pen', 'Ball Pen', 'ball-pen', 'Stationery', 80),
  ('Baloons', 'Balloons', 'baloons', 'Party & Events', 90),
  ('Bar Soap', 'Bar Soap', 'bar-soap', 'Personal Care', 100),
  ('Bathing Soap', 'Bathing Soap', 'bathing-soap', 'Personal Care', 110),
  ('Beauty Mirror', 'Beauty Mirror', 'beauty-mirror', 'Personal Care', 120),
  ('Birthday Candle', 'Birthday Candle', 'birthday-candle', 'Party & Events', 130),
  ('Biscuits', 'Biscuits', 'biscuits', 'Food', 140),
  ('blowing Wistle', 'Blowing Whistle', 'blowing-whistle', 'Sports & Toys', 150),
  ('Blue Band', 'Blue Band', 'blue-band', 'Food', 160),
  ('Books', 'Books', 'books', 'Stationery', 170),
  ('Boxer', 'Boxer', 'boxer', 'Clothing', 180),
  ('Bread', 'Bread', 'bread', 'Food', 190),
  ('Brush', 'Brush', 'brush', 'Personal Care', 200),
  ('Cake', 'Cake', 'cake', 'Food', 210),
  ('Carboxy Methyl Cellulose (CMC)', 'Carboxy Methyl Cellulose (CMC)', 'carboxy-methyl-cellulose-cmc', 'Food', 220),
  ('cello tape', 'Cello Tape', 'cello-tape', 'Stationery', 230),
  ('Chewing Gum', 'Chewing Gum', 'chewing-gum', 'Food', 240),
  ('Cider', 'Cider', 'cider', 'Beverages', 250),
  ('Coffee', 'Coffee', 'coffee', 'Food', 260),
  ('Comb', 'Comb', 'comb', 'Personal Care', 270),
  ('Cooking Oil', 'Cooking Oil', 'cooking-oil', 'Food', 280),
  ('Cream', 'Cream', 'cream', 'Personal Care', 290),
  ('Curry Powder', 'Curry Powder', 'curry-powder', 'Food', 300),
  ('Decorative Lights', 'Decorative Lights', 'decorative-lights', 'Party & Events', 310),
  ('Disinfectant', 'Disinfectant', 'disinfectant', 'Household', 320),
  ('Downy', 'Downy', 'downy', 'Household', 330),
  ('Drink', 'Drink', 'drink', 'Beverages', 340),
  ('Drinking Chocolate', 'Drinking Chocolate', 'drinking-chocolate', 'Beverages', 350),
  ('Drinking Milk', 'Drinking Milk', 'drinking-milk', 'Beverages', 360),
  ('Dry cell (Batteries)', 'Dry Cell (Batteries)', 'dry-cell-batteries', 'Household', 370),
  ('Ear buds', 'Ear Buds', 'ear-buds', 'Personal Care', 380),
  ('Eggs', 'Eggs', 'eggs', 'Food', 390),
  ('Essential Oil', 'Essential Oil', 'essential-oil', 'Personal Care', 400),
  ('Flavouring', 'Flavouring', 'flavouring', 'Food', 410),
  ('Gelatine Power', 'Gelatine Powder', 'gelatine-powder', 'Food', 420),
  ('Glucose', 'Glucose', 'glucose', 'Food', 430),
  ('Glycerine', 'Glycerine', 'glycerine', 'Personal Care', 440),
  ('Hair Conditioner', 'Hair Conditioner', 'hair-conditioner', 'Personal Care', 450),
  ('Hair Dye', 'Hair Dye', 'hair-dye', 'Personal Care', 460),
  ('Hair Food', 'Hair Food', 'hair-food', 'Personal Care', 470),
  ('Hair Gel', 'Hair Gel', 'hair-gel', 'Personal Care', 480),
  ('Hair Moisturizer', 'Hair Moisturizer', 'hair-moisturizer', 'Personal Care', 490),
  ('Hair Relaxer', 'Hair Relaxer', 'hair-relaxer', 'Personal Care', 500),
  ('Hair Scratcher', 'Hair Scratcher', 'hair-scratcher', 'Personal Care', 510),
  ('Hair Spray', 'Hair Spray', 'hair-spray', 'Personal Care', 520),
  ('Handkerchiefs', 'Handkerchiefs', 'handkerchiefs', 'Clothing', 530),
  ('Hanger', 'Hanger', 'hanger', 'Household', 540),
  ('Hibiscus Powder', 'Hibiscus Powder', 'hibiscus-powder', 'Food', 550),
  ('Honey', 'Honey', 'honey', 'Food', 560),
  ('Icing Sugar', 'Icing Sugar', 'icing-sugar', 'Food', 570),
  ('Insulating Tape', 'Insulating Tape', 'insulating-tape', 'Household', 580),
  ('jam', 'Jam', 'jam', 'Food', 590),
  ('Jerican', 'Jerican', 'jerican', 'Household', 600),
  ('Juice', 'Juice', 'juice', 'Beverages', 610),
  ('Jus4 ever', 'Jus4 ever', 'jus4-ever', 'Beverages', 620),
  ('Kake', 'Cake', 'kake', 'Food', 630),
  ('knickers', 'Knickers', 'knickers', 'Clothing', 640),
  ('Lip Bulm', 'Lip Balm', 'lip-bulm', 'Personal Care', 650),
  ('Lotion', 'Lotion', 'lotion', 'Personal Care', 660),
  ('Lotion Tube', 'Lotion Tube', 'lotion-tube', 'Personal Care', 670),
  ('Magic', 'Magic', 'magic', 'Other', 680),
  ('Marasi', 'Marasi', 'marasi', 'Other', 690),
  ('Margarine', 'Margarine', 'margarine', 'Food', 700),
  ('Match Box', 'Match Box', 'match-box', 'Household', 710),
  ('Mineral water', 'Mineral Water', 'mineral-water', 'Beverages', 720),
  ('Miracle Oil', 'Miracle Oil', 'miracle-oil', 'Personal Care', 730),
  ('Mixed Spices', 'Mixed Spices', 'mixed-spices', 'Food', 740),
  ('Moringa Capsules', 'Moringa Capsules', 'moringa-capsules', 'Health & Wellness', 750),
  ('Mosquito Repellent', 'Mosquito Repellent', 'mosquito-repellent', 'Household', 760),
  ('Muscle Relaxer', 'Muscle Relaxer', 'muscle-relaxer', 'Health & Wellness', 770),
  ('Nail Cutter', 'Nail Cutter', 'nail-cutter', 'Personal Care', 780),
  ('Noodles', 'Noodles', 'noodles', 'Food', 790),
  ('Omo', 'Omo', 'omo', 'Household', 800),
  ('Padlock', 'Padlock', 'padlock', 'Household', 810),
  ('Paper Box', 'Paper Box', 'paper-box', 'Household', 820),
  ('Party Fun Popper', 'Party Fun Popper', 'party-fun-popper', 'Party & Events', 830),
  ('Party Spray', 'Party Spray', 'party-spray', 'Party & Events', 840),
  ('Pencil', 'Pencil', 'pencil', 'Stationery', 850),
  ('Perfume', 'Perfume', 'perfume', 'Personal Care', 860),
  ('Petroleum Jelly', 'Petroleum Jelly', 'petroleum-jelly', 'Personal Care', 870),
  ('Plastic Carrier Bags- Kavera', 'Plastic Carrier Bags - Kavera', 'plastic-carrier-bags-kavera', 'Household', 880),
  ('Poilet Paper', 'Toilet Paper', 'poilet-paper', 'Household', 890),
  ('Powder Milk', 'Powder Milk', 'powder-milk', 'Beverages', 900),
  ('Powdered Drink', 'Powdered Drink', 'powdered-drink', 'Beverages', 910),
  ('Preservative', 'Preservative', 'preservative', 'Food', 920),
  ('Pure Sheabutter', 'Pure Shea Butter', 'pure-sheabutter', 'Personal Care', 930),
  ('Raisins', 'Raisins', 'raisins', 'Food', 940),
  ('Razer Blade', 'Razor Blade', 'razer-blade', 'Personal Care', 950),
  ('Rice', 'Rice', 'rice', 'Food', 960),
  ('Royco', 'Royco', 'royco', 'Food', 970),
  ('Salt', 'Salt', 'salt', 'Food', 980),
  ('Sanitary pads', 'Sanitary Pads', 'sanitary-pads', 'Personal Care', 990)

on conflict (source_system, source_name)
do update set
  display_name = excluded.display_name,
  normalized_key = excluded.normalized_key,
  department = excluded.department,
  sort_order = excluded.sort_order,
  updated_at = now();

/*
  Worker-facing category view.
  The original Loyverse value remains available for audit/reference.
*/
create or replace view public.dream_city_category_options
with (security_invoker = true)
as
select
  id,
  source_system,
  source_name,
  display_name,
  department,
  normalized_key,
  sort_order
from public.dream_city_category_dictionary
where active = true;

comment on table public.dream_city_category_dictionary is
  'Dream City product category dictionary seeded from the former Loyverse category vocabulary. Historical quantities are intentionally excluded.';

comment on view public.dream_city_category_options is
  'Worker-facing category options for product search, dropdowns and navigation.';

alter table public.dream_city_category_dictionary enable row level security;

drop policy if exists "staff can read category dictionary"
  on public.dream_city_category_dictionary;

create policy "staff can read category dictionary"
  on public.dream_city_category_dictionary
  for select
  to authenticated
  using (
    public.current_staff_role() in ('owner','manager','cashier','accountant')
  );

/*
  Expose read access to the authenticated application only.
  RLS remains the authorization boundary.
*/
grant select on public.dream_city_category_dictionary to authenticated;
grant select on public.dream_city_category_options to authenticated;

commit;
