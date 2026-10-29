-- Go global: markets (cities) own currency, locale, timezone, phone prefix,
-- service radius and contacts. Packages and bookings carry an amount + currency
-- instead of a rupee-only price.

create table public.markets (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  country_code char(2) not null,           -- ISO 3166-1 alpha-2
  currency char(3) not null,               -- ISO 4217
  locale text not null default 'en',       -- BCP 47, used for number/date formatting
  timezone text not null,                  -- IANA, e.g. Asia/Kolkata
  phone_prefix text not null,              -- country calling code digits, e.g. 91
  center extensions.geography(point, 4326) not null,
  service_radius_km numeric(5,1) not null default 40,   -- scheduled shoots
  instant_radius_km numeric(5,1) not null default 20,   -- instant shoots
  whatsapp text,                           -- digits incl. country code; falls back to site_settings
  email text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  check (currency = upper(currency) and country_code = upper(country_code)),
  check (instant_radius_km between 1 and 50 and service_radius_km between 1 and 200)
);

alter table public.markets enable row level security;
create policy "markets: public read active" on public.markets for select to anon, authenticated
  using (is_active or (select public.is_admin()));
create policy "markets: admin write" on public.markets for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

insert into public.markets (slug, name, country_code, currency, locale, timezone, phone_prefix, center, sort_order)
values ('bengaluru', 'Bengaluru', 'IN', 'INR', 'en-IN', 'Asia/Kolkata', '91',
        extensions.st_setsrid(extensions.st_makepoint(77.5946, 12.9716), 4326)::extensions.geography, 10);

-- Markets with their center as plain numbers, for the app.
create view public.markets_public with (security_invoker = true) as
  select m.id, m.slug, m.name, m.country_code, m.currency, m.locale, m.timezone, m.phone_prefix,
         extensions.st_y(m.center::extensions.geometry) as center_lat,
         extensions.st_x(m.center::extensions.geometry) as center_lng,
         m.service_radius_km, m.instant_radius_km, m.whatsapp, m.email, m.is_active, m.sort_order
  from public.markets m;
grant select on public.markets_public to anon, authenticated;

-- Which market serves a point (closest active one within its service radius).
create or replace function public.market_for_location(p_lat double precision, p_lng double precision)
returns uuid language sql stable security definer set search_path = ''
as $$
  select m.id from public.markets m
  where m.is_active
    and extensions.st_dwithin(m.center, extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
                              m.service_radius_km * 1000)
  order by m.center operator(extensions.<->) extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
  limit 1;
$$;

-- ── Profiles: preferred market ────────────────────────
alter table public.profiles add column market_id uuid references public.markets (id) on delete set null;
grant update (market_id) on public.profiles to authenticated;

-- ── Packages: per market, amount + currency ───────────
alter table public.packages add column market_id uuid references public.markets (id) on delete cascade;
update public.packages set market_id = (select id from public.markets where slug = 'bengaluru');
alter table public.packages alter column market_id set not null;
alter table public.packages rename column price_inr to price_amount;
alter table public.packages alter column price_amount type numeric(12,2);
alter table public.packages add column currency char(3);
update public.packages set currency = 'INR';
alter table public.packages alter column currency set not null;
alter table public.packages drop constraint packages_slug_key;
alter table public.packages add constraint packages_market_slug_key unique (market_id, slug);
create index packages_market_idx on public.packages (market_id, category, sort_order);

-- A package's currency always matches its market.
create or replace function public.packages_sync_currency()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  select currency into new.currency from public.markets where id = new.market_id;
  return new;
end;
$$;
create trigger packages_sync_currency before insert or update of market_id, currency on public.packages
  for each row execute function public.packages_sync_currency();

-- ── Crew: home market ─────────────────────────────────
alter table public.crew_members add column market_id uuid references public.markets (id) on delete set null;
update public.crew_members set market_id = (select id from public.markets where slug = 'bengaluru');

drop function public.apply_as_crew(text, public.crew_kind, text);
create function public.apply_as_crew(p_display_name text, p_kind public.crew_kind, p_bio text default '',
                                     p_market_id uuid default null)
returns public.crew_members language plpgsql security definer set search_path = ''
as $$
declare r public.crew_members; v_market uuid;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first'; end if;
  v_market := coalesce(p_market_id, (select market_id from public.profiles where id = (select auth.uid())),
                       (select id from public.markets where is_active order by sort_order limit 1));
  if not exists (select 1 from public.markets where id = v_market and is_active) then
    raise exception 'Unknown city';
  end if;
  insert into public.crew_members (id, display_name, kind, bio, market_id)
  values ((select auth.uid()), p_display_name, p_kind, coalesce(p_bio, ''), v_market)
  on conflict (id) do update set display_name = excluded.display_name, kind = excluded.kind,
    bio = excluded.bio, market_id = excluded.market_id
  returning * into r;
  return r;
end;
$$;

-- ── Bookings: market + amount + currency ──────────────
alter table public.bookings add column market_id uuid references public.markets (id);
update public.bookings set market_id = (select id from public.markets where slug = 'bengaluru');
alter table public.bookings alter column market_id set not null;
alter table public.bookings rename column price_inr to price_amount;
alter table public.bookings alter column price_amount type numeric(12,2);
alter table public.bookings add column currency char(3);
update public.bookings set currency = 'INR';
alter table public.bookings alter column currency set not null;
create index bookings_market_idx on public.bookings (market_id, created_at desc);

create or replace function public.request_instant_booking(
  p_crew_id uuid, p_package_id uuid, p_lat double precision, p_lng double precision,
  p_address text, p_contact_phone text, p_notes text default ''
)
returns public.bookings language plpgsql security definer set search_path = ''
as $$
declare
  v_pkg public.packages;
  v_market public.markets;
  v_dist numeric;
  v_point extensions.geography := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
  r public.bookings;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first'; end if;
  select * into v_pkg from public.packages where id = p_package_id and is_active and category = 'instant';
  if not found then raise exception 'Unknown instant package'; end if;
  select * into v_market from public.markets where id = v_pkg.market_id and is_active;
  if not found then raise exception 'This city is not taking bookings right now'; end if;

  select round((extensions.st_distance(c.location, v_point) / 1000)::numeric, 1) into v_dist
  from public.nearby_crew(p_lat, p_lng, v_market.instant_radius_km) n
  join public.crew_members c on c.id = n.crew_id
  where n.crew_id = p_crew_id
    and c.kind = v_pkg.crew_kind and c.tier >= v_pkg.tier;
  if v_dist is null then raise exception 'That crew member is no longer available nearby'; end if;

  if exists (select 1 from public.bookings where customer_id = (select auth.uid()) and mode = 'instant'
             and status in ('requested', 'accepted', 'en_route', 'arrived', 'shooting')) then
    raise exception 'You already have an active instant booking';
  end if;

  insert into public.bookings (customer_id, crew_id, package_id, market_id, mode, address, location, contact_phone,
                               notes, price_amount, currency, distance_km, eta_minutes)
  values ((select auth.uid()), p_crew_id, p_package_id, v_market.id, 'instant', p_address, v_point, p_contact_phone,
          coalesce(p_notes, ''), v_pkg.price_amount, v_pkg.currency, v_dist, public.estimate_eta_minutes(v_dist))
  returning * into r;
  return r;
end;
$$;

-- ── Package badges + featured hero ────────────────────
alter table public.packages
  add column badge text,
  add column is_featured boolean not null default false;

update public.packages set badge = 'Most popular' where slug = 'pro';
update public.packages set badge = 'Most loved' where slug = 'wedding-luxe';
update public.packages set is_featured = true where slug = 'starter';

-- Feature lists as on the original site.
update public.packages set features = array['Up to 3 hours shoot', '1 edited reel (60–90 sec)', '10 edited photos',
  'DSLR / mirrorless camera', '3-hour post-shoot delivery'] where slug = 'starter';
update public.packages set features = array['Up to 5 hours shoot', '2 edited reels + BTS reel', '25 edited photos',
  'Cinema camera + DSLR', 'Same-day delivery', 'Colour grading', 'Pro lighting setup'] where slug = 'pro';
update public.packages set features = array['Full day (8 hours)', '4 reels + full video edit', '50+ edited photos',
  '2 cinema cameras + drone', '2-shooter crew', 'Colour grading + sound design', 'Dedicated creative director',
  'Priority 24-hour delivery'] where slug = 'elite';
update public.packages set features = array['1-day coverage (6 hours)', '1 cinematographer or 2 candid photographers',
  'Cinematic film (5–8 min) or candid edited photos', '1 Instagram highlight reel', 'Drone highlights', 'Standard delivery']
  where slug = 'wedding-intimate';
update public.packages set features = array['1 full day coverage', '1 cinematographer + 2 candid photographers',
  'Cinematic feature film (5–8 min) or candid edited photos', '1 Instagram highlight reel', 'Drone highlights', 'Standard delivery']
  where slug = 'wedding-luxe';
update public.packages set features = array['2+ days full coverage', '2 cinematographers + 2 candid photographers',
  'Complimentary pre-shoot (4 hours)', 'Cinematic feature film + 4K reels', 'Edited photos', 'Drone highlights',
  'Priority 5-day delivery'] where slug = 'wedding-royal';

-- ── Shoot types ("What we shoot") + per-market "from" prices ──
create table public.shoot_types (
  slug text primary key,
  name text not null,
  icon text not null default '📷',
  sort_order integer not null default 0,
  is_active boolean not null default true
);
alter table public.shoot_types enable row level security;
create policy "shoot types: public read" on public.shoot_types for select to anon, authenticated
  using (is_active or (select public.is_admin()));
create policy "shoot types: admin write" on public.shoot_types for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

insert into public.shoot_types (slug, name, icon, sort_order) values
  ('brand', 'Brand / Product', '🎬', 10),
  ('wedding', 'Wedding', '💍', 20),
  ('portrait', 'Portrait / Personal', '📸', 30),
  ('food', 'Food & Restaurant', '🍽', 40),
  ('fashion', 'Fashion / Lifestyle', '👗', 50),
  ('corporate', 'Corporate', '🏢', 60),
  ('events', 'Events', '🎉', 70),
  ('drone', 'Drone', '🚁', 80),
  ('real-estate', 'Real Estate', '🏠', 90),
  ('baby-maternity', 'Baby & Maternity', '👶', 100),
  ('other', 'Other', '✨', 110);

create table public.market_shoot_prices (
  market_id uuid not null references public.markets (id) on delete cascade,
  shoot_type text not null references public.shoot_types (slug) on delete cascade,
  from_amount numeric(12,2) not null check (from_amount >= 0),
  primary key (market_id, shoot_type)
);
alter table public.market_shoot_prices enable row level security;
create policy "shoot prices: public read" on public.market_shoot_prices for select to anon, authenticated using (true);
create policy "shoot prices: admin write" on public.market_shoot_prices for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

insert into public.market_shoot_prices (market_id, shoot_type, from_amount)
select m.id, v.slug, v.amount from public.markets m,
  (values ('brand', 4999), ('wedding', 29999), ('portrait', 4999), ('food', 4999),
          ('fashion', 7999), ('corporate', 9999), ('events', 7999), ('drone', 9999)) v(slug, amount)
where m.slug = 'bengaluru';

-- ── Bookings: shoot type + preferred time slot ────────
alter table public.bookings
  add column shoot_type text references public.shoot_types (slug),
  add column time_slot text;

drop function public.create_scheduled_booking(uuid, timestamptz, text, text, text, double precision, double precision);
create function public.create_scheduled_booking(
  p_package_id uuid, p_scheduled_at timestamptz, p_address text, p_contact_phone text,
  p_notes text default '', p_lat double precision default null, p_lng double precision default null,
  p_shoot_type text default null, p_time_slot text default null
)
returns public.bookings language plpgsql security definer set search_path = ''
as $$
declare v_pkg public.packages; r public.bookings;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first'; end if;
  select * into v_pkg from public.packages where id = p_package_id and is_active and category in ('shoot', 'wedding');
  if not found then raise exception 'Unknown package'; end if;
  if not exists (select 1 from public.markets where id = v_pkg.market_id and is_active) then
    raise exception 'This city is not taking bookings right now';
  end if;
  if p_scheduled_at < now() + interval '2 hours' then raise exception 'Pick a time at least 2 hours from now'; end if;
  if p_shoot_type is not null and not exists (select 1 from public.shoot_types where slug = p_shoot_type) then
    raise exception 'Unknown shoot type';
  end if;

  insert into public.bookings (customer_id, package_id, market_id, mode, scheduled_at, address, location, contact_phone,
                               notes, price_amount, currency, shoot_type, time_slot)
  values ((select auth.uid()), p_package_id, v_pkg.market_id, 'scheduled', p_scheduled_at, p_address,
          case when p_lat is not null and p_lng is not null
            then extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography end,
          p_contact_phone, coalesce(p_notes, ''), v_pkg.price_amount, v_pkg.currency, p_shoot_type,
          nullif(trim(p_time_slot), ''))
  returning * into r;
  return r;
end;
$$;

-- ── Gallery ───────────────────────────────────────────
create table public.gallery_items (
  id uuid primary key default gen_random_uuid(),
  market_id uuid references public.markets (id) on delete cascade,   -- null = shown in every market
  title text not null,
  category text not null check (category in ('wedding', 'brand', 'portrait', 'food', 'events', 'other')),
  kind text not null default 'photo' check (kind in ('photo', 'video')),
  image_url text,                 -- photo, or thumbnail for a video
  video_url text,                 -- YouTube / Instagram / Drive link for videos
  subtitle text not null default '',
  width integer,
  height integer,
  sort_order integer not null default 0,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  check (kind = 'video' and video_url is not null or kind = 'photo' and image_url is not null)
);
create index gallery_items_order_idx on public.gallery_items (sort_order, created_at);
alter table public.gallery_items enable row level security;
create policy "gallery: public read published" on public.gallery_items for select to anon, authenticated
  using (is_published or (select public.is_admin()));
create policy "gallery: admin write" on public.gallery_items for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- Public storage bucket for gallery uploads (admins write, everyone reads).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gallery', 'gallery', true, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy "gallery bucket: admin insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'gallery' and (select public.is_admin()));
create policy "gallery bucket: admin update" on storage.objects for update to authenticated
  using (bucket_id = 'gallery' and (select public.is_admin()));
create policy "gallery bucket: admin delete" on storage.objects for delete to authenticated
  using (bucket_id = 'gallery' and (select public.is_admin()));

-- ── Site settings: brand-wide (single row) ────────────
create table public.site_settings (
  id integer primary key default 1 check (id = 1),
  business_name text not null,
  tagline text not null default '',
  about text not null default '',
  whatsapp text,                  -- default contact; a market's own contacts win
  instagram text,                 -- handle without @
  email text,
  gear jsonb not null default '[]',   -- [{ "icon": "🎥", "name": "...", "desc": "..." }]
  faqs jsonb not null default '[]',   -- [{ "q": "...", "a": "..." }]
  updated_at timestamptz not null default now()
);
alter table public.site_settings enable row level security;
create policy "settings: public read" on public.site_settings for select to anon, authenticated using (true);
create policy "settings: admin update" on public.site_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

insert into public.site_settings (business_name, tagline, about, whatsapp, instagram, email, gear, faqs) values (
  'Quick Clicks',
  'Cinema · Delivered',
  'We craft cinema-grade photo & video content for brands, creators and weddings — delivered the same day.',
  '919731112426',
  'filmsbyjones',
  'Projects@filmsbyjones.com',
  '[{"icon":"🎥","name":"Video cameras","desc":"Professional Sony cameras"},
    {"icon":"📸","name":"Photo cameras","desc":"Sony & Canon professional cameras"},
    {"icon":"🚁","name":"Drone","desc":"DJI Mavic 3 Pro & DJI Mavic 4 Pro"},
    {"icon":"💡","name":"Lighting","desc":"Aputure & Profoto"},
    {"icon":"🎙","name":"Audio","desc":"DJI & Rode microphones"},
    {"icon":"🎬","name":"Video editing","desc":"Premiere Pro · After Effects · DaVinci Resolve · Blender"},
    {"icon":"🖼","name":"Photo editing","desc":"Lightroom · Photoshop"}]',
  '[{"q":"How fast is delivery really?","a":"For Starter & Pro packages, edited reels and photos are delivered within 3 hours of your shoot wrapping. We edit on-location in parallel with shooting."},
    {"q":"Do I need a concept ready?","a":"Not at all. We brief you before the shoot and help with direction, poses and storytelling. Just show up!"},
    {"q":"What areas do you cover?","a":"Each city lists its coverage. In Bengaluru: Indiranagar, Koramangala, Whitefield, HSR, JP Nagar, MG Road, Yelahanka & more. Instant shoots cover 20 km around you; travel charges may apply beyond 25 km for scheduled shoots."},
    {"q":"Can I request revisions?","a":"Yes! Starter: 1 revision. Pro: 2 revisions. Elite: unlimited within 48 hours. Wedding packages have their own revision terms."},
    {"q":"How do I pay?","a":"50% advance on booking (UPI / card / bank transfer). Remaining 50% on shoot day before we begin. Full advance for wedding packages."}]'
);

-- ── Reviews (replace hard-coded testimonials) ─────────
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  customer_id uuid not null references public.profiles (id) on delete cascade,
  crew_id uuid references public.crew_members (id) on delete set null,
  market_id uuid references public.markets (id) on delete set null,
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '',
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);
create index reviews_crew_idx on public.reviews (crew_id);
create index reviews_market_idx on public.reviews (market_id, created_at desc);
alter table public.reviews enable row level security;
create policy "reviews: read own, crew's or admin" on public.reviews for select to authenticated
  using (customer_id = (select auth.uid()) or crew_id = (select auth.uid()) or (select public.is_admin()));
create policy "reviews: admin update" on public.reviews for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "reviews: admin delete" on public.reviews for delete to authenticated
  using ((select public.is_admin()));

-- Keep crew rating = average of their reviews.
create or replace function public.reviews_refresh_crew_rating()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare v_crew uuid := coalesce(new.crew_id, old.crew_id);
begin
  if v_crew is not null then
    update public.crew_members set rating = coalesce(
      (select round(avg(rating)::numeric, 1) from public.reviews where crew_id = v_crew), 5.0)
    where id = v_crew;
  end if;
  return null;
end;
$$;
create trigger reviews_refresh_crew_rating after insert or update or delete on public.reviews
  for each row execute function public.reviews_refresh_crew_rating();

-- Customer rates a delivered booking (once; can edit later).
create or replace function public.submit_review(p_booking_id uuid, p_rating integer, p_comment text default '')
returns public.reviews language plpgsql security definer set search_path = ''
as $$
declare b public.bookings; r public.reviews;
begin
  select * into b from public.bookings where id = p_booking_id and customer_id = (select auth.uid());
  if not found then raise exception 'Booking not found'; end if;
  if b.status <> 'delivered' then raise exception 'You can rate a shoot once it has been delivered'; end if;
  if p_rating not between 1 and 5 then raise exception 'Rating must be 1 to 5 stars'; end if;
  insert into public.reviews (booking_id, customer_id, crew_id, market_id, rating, comment)
  values (b.id, b.customer_id, b.crew_id, b.market_id, p_rating, left(coalesce(trim(p_comment), ''), 1000))
  on conflict (booking_id) do update set rating = excluded.rating, comment = excluded.comment
  returning * into r;
  return r;
end;
$$;

-- Public testimonials: first name only, plus what was shot. Null market = all markets.
create or replace function public.public_reviews(p_market_id uuid default null, p_limit integer default 10)
returns table (id uuid, rating smallint, comment text, customer_name text, shoot_type text, package_name text,
               market_name text, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.rating, r.comment,
    coalesce(nullif(split_part(trim(p.full_name), ' ', 1), ''), 'Customer'),
    st.name, pk.name, m.name, r.created_at
  from public.reviews r
  join public.bookings b on b.id = r.booking_id
  join public.profiles p on p.id = r.customer_id
  join public.packages pk on pk.id = b.package_id
  left join public.markets m on m.id = r.market_id
  left join public.shoot_types st on st.slug = b.shoot_type
  where r.is_public and length(trim(r.comment)) > 0
    and (p_market_id is null or r.market_id = p_market_id)
  order by r.created_at desc
  limit least(greatest(p_limit, 1), 50);
$$;

-- Real numbers for the home page stats row.
create or replace function public.public_stats(p_market_id uuid default null)
returns table (shoots_delivered integer, avg_rating numeric, review_count integer, crew_online integer)
language sql stable security definer set search_path = ''
as $$
  select
    (select count(*)::integer from public.bookings
      where status = 'delivered' and (p_market_id is null or market_id = p_market_id)),
    (select round(avg(rating)::numeric, 1) from public.reviews where p_market_id is null or market_id = p_market_id),
    (select count(*)::integer from public.reviews where p_market_id is null or market_id = p_market_id),
    (select count(*)::integer from public.crew_members
      where approved and is_online and location_updated_at > now() - interval '10 minutes'
        and (p_market_id is null or market_id = p_market_id));
$$;

-- ── Compatibility for the currently deployed app ──────
-- Read-only copies of the old rupee column so the live site keeps working until the
-- new frontend ships. Drop in a later migration once nothing reads price_inr.
alter table public.packages add column price_inr integer generated always as (price_amount::integer) stored;
alter table public.bookings add column price_inr integer generated always as (price_amount::integer) stored;

-- ── Function permissions ──────────────────────────────
revoke execute on function
  public.market_for_location(double precision, double precision),
  public.packages_sync_currency(), public.reviews_refresh_crew_rating(),
  public.apply_as_crew(text, public.crew_kind, text, uuid),
  public.create_scheduled_booking(uuid, timestamptz, text, text, text, double precision, double precision, text, text),
  public.submit_review(uuid, integer, text), public.public_reviews(uuid, integer), public.public_stats(uuid)
from public, anon, authenticated;

grant execute on function
  public.apply_as_crew(text, public.crew_kind, text, uuid),
  public.create_scheduled_booking(uuid, timestamptz, text, text, text, double precision, double precision, text, text),
  public.submit_review(uuid, integer, text)
to authenticated;
grant execute on function
  public.market_for_location(double precision, double precision),
  public.public_reviews(uuid, integer), public.public_stats(uuid)
to anon, authenticated;

-- Portfolio from the original site (files in app/public/gallery).
insert into public.gallery_items (title, category, kind, image_url, width, height, sort_order) values
  ('Rooftop Restaurant', 'food', 'photo', '/gallery/rooftop-restaurant.jpg', 800, 531, 0),
  ('Wine Store', 'food', 'photo', '/gallery/wine-store.jpg', 800, 531, 10),
  ('Craft Brewery', 'food', 'photo', '/gallery/craft-brewery.jpg', 800, 428, 20),
  ('Cinema Hall', 'brand', 'photo', '/gallery/cinema-hall.jpg', 800, 448, 30),
  ('Food Art', 'food', 'photo', '/gallery/food-art.jpg', 531, 800, 40),
  ('Sacred Earth Café', 'food', 'photo', '/gallery/sacred-earth-cafe.jpg', 529, 800, 50),
  ('Food Styling', 'food', 'photo', '/gallery/food-styling.jpg', 533, 800, 60),
  ('Cookies & Milk', 'food', 'photo', '/gallery/cookies-milk.jpg', 531, 800, 70),
  ('Portrait — Golden Hour', 'portrait', 'photo', '/gallery/portrait-golden-hour.jpg', 641, 800, 80),
  ('Portrait — Natural Light', 'portrait', 'photo', '/gallery/portrait-natural-light.jpg', 641, 800, 90),
  ('Portrait — Candid', 'portrait', 'photo', '/gallery/portrait-candid.jpg', 647, 800, 100),
  ('Fashion — Editorial', 'portrait', 'photo', '/gallery/fashion-editorial.jpg', 538, 800, 110),
  ('Fashion — Architecture', 'portrait', 'photo', '/gallery/fashion-architecture.jpg', 537, 800, 120),
  ('Fashion — Lifestyle', 'portrait', 'photo', '/gallery/fashion-lifestyle.jpg', 537, 800, 130),
  ('SixtySkinz — Day Cream', 'brand', 'photo', '/gallery/sixtyskinz-day-cream.jpg', 600, 900, 140),
  ('SixtySkinz — Serums', 'brand', 'photo', '/gallery/sixtyskinz-serums.jpg', 600, 900, 150),
  ('SixtySkinz — Conditioner', 'brand', 'photo', '/gallery/sixtyskinz-conditioner.jpg', 600, 900, 160),
  ('SixtySkinz — Product', 'brand', 'photo', '/gallery/sixtyskinz-product.jpg', 606, 900, 170),
  ('SixtySkinz — Gel', 'brand', 'photo', '/gallery/sixtyskinz-gel.jpg', 900, 770, 180),
  ('Bridal Jewellery', 'wedding', 'photo', '/gallery/bridal-jewellery.jpg', 800, 559, 190),
  ('Temple Jewellery', 'wedding', 'photo', '/gallery/temple-jewellery.jpg', 797, 800, 200),
  ('Diamond Set', 'wedding', 'photo', '/gallery/diamond-set.jpg', 797, 800, 210),
  ('Bridal Necklace', 'wedding', 'photo', '/gallery/bridal-necklace.jpg', 797, 800, 220),
  ('Candid — Couple', 'wedding', 'photo', '/gallery/candid-couple.jpg', 800, 432, 230),
  ('Bride Portrait', 'wedding', 'photo', '/gallery/bride-portrait.jpg', 800, 570, 240),
  ('Wedding Dress', 'wedding', 'photo', '/gallery/wedding-dress.jpg', 800, 678, 250),
  ('Pre-Wedding — Fort', 'wedding', 'photo', '/gallery/pre-wedding-fort.jpg', 800, 533, 260),
  ('Wedding Ceremony', 'wedding', 'photo', '/gallery/wedding-ceremony.jpg', 783, 800, 270),
  ('Pre-Wedding — Golden Hour', 'wedding', 'photo', '/gallery/pre-wedding-golden-hour.jpg', 800, 625, 280),
  ('Haldi Ceremony', 'wedding', 'photo', '/gallery/haldi-ceremony.jpg', 800, 491, 290),
  ('Groom Portrait', 'wedding', 'photo', '/gallery/groom-portrait.jpg', 800, 464, 300),
  ('Temple Pre-Wedding', 'wedding', 'photo', '/gallery/temple-pre-wedding.jpg', 644, 800, 310),
  ('Church Wedding', 'wedding', 'photo', '/gallery/church-wedding.jpg', 847, 900, 320);
