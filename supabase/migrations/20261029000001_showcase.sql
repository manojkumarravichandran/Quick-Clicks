-- Showcase features carried over from the original filmsbyjones site:
-- gallery, shoot categories, package badges, site settings (gear/FAQ/contact),
-- real customer reviews (replacing hard-coded testimonials) and live stats.

-- ── Packages: badges + featured hero ──────────────────
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

-- ── Shoot types ("What we shoot") ─────────────────────
create table public.shoot_types (
  slug text primary key,
  name text not null,
  icon text not null default '📷',
  from_price_inr integer,          -- null = not shown as a "from" price chip
  sort_order integer not null default 0,
  is_active boolean not null default true
);
alter table public.shoot_types enable row level security;
create policy "shoot types: public read" on public.shoot_types for select to anon, authenticated
  using (is_active or (select public.is_admin()));
create policy "shoot types: admin write" on public.shoot_types for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

insert into public.shoot_types (slug, name, icon, from_price_inr, sort_order) values
  ('brand', 'Brand / Product', '🎬', 4999, 10),
  ('wedding', 'Wedding', '💍', 29999, 20),
  ('portrait', 'Portrait / Personal', '📸', 4999, 30),
  ('food', 'Food & Restaurant', '🍽', 4999, 40),
  ('fashion', 'Fashion / Lifestyle', '👗', 7999, 50),
  ('corporate', 'Corporate', '🏢', 9999, 60),
  ('events', 'Events', '🎉', 7999, 70),
  ('drone', 'Drone', '🚁', 9999, 80),
  ('real-estate', 'Real Estate', '🏠', null, 90),
  ('baby-maternity', 'Baby & Maternity', '👶', null, 100),
  ('other', 'Other', '✨', null, 110);

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
  if p_scheduled_at < now() + interval '2 hours' then raise exception 'Pick a time at least 2 hours from now'; end if;
  if p_shoot_type is not null and not exists (select 1 from public.shoot_types where slug = p_shoot_type) then
    raise exception 'Unknown shoot type';
  end if;

  insert into public.bookings (customer_id, package_id, mode, scheduled_at, address, location, contact_phone, notes,
                               price_inr, shoot_type, time_slot)
  values ((select auth.uid()), p_package_id, 'scheduled', p_scheduled_at, p_address,
          case when p_lat is not null and p_lng is not null
            then extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography end,
          p_contact_phone, coalesce(p_notes, ''), v_pkg.price_inr, p_shoot_type, nullif(trim(p_time_slot), ''))
  returning * into r;
  return r;
end;
$$;
revoke execute on function public.create_scheduled_booking(uuid, timestamptz, text, text, text, double precision, double precision, text, text) from public, anon;
grant execute on function public.create_scheduled_booking(uuid, timestamptz, text, text, text, double precision, double precision, text, text) to authenticated;

-- ── Gallery ───────────────────────────────────────────
create table public.gallery_items (
  id uuid primary key default gen_random_uuid(),
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

-- ── Site settings (single row) ────────────────────────
create table public.site_settings (
  id integer primary key default 1 check (id = 1),
  business_name text not null,
  tagline text not null default '',
  about text not null default '',
  city text not null default 'Bengaluru',
  whatsapp text,                  -- digits with country code, e.g. 919876543210
  instagram text,                 -- handle without @
  email text,
  service_areas text not null default '',
  gear jsonb not null default '[]',   -- [{ "icon": "🎥", "name": "...", "desc": "..." }]
  faqs jsonb not null default '[]',   -- [{ "q": "...", "a": "..." }]
  updated_at timestamptz not null default now()
);
alter table public.site_settings enable row level security;
create policy "settings: public read" on public.site_settings for select to anon, authenticated using (true);
create policy "settings: admin update" on public.site_settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

insert into public.site_settings (business_name, tagline, about, whatsapp, instagram, email, service_areas, gear, faqs) values (
  'Quick Clicks',
  'Cinema · Delivered',
  'We craft cinema-grade photo & video content for brands, creators and weddings in Bengaluru — delivered the same day.',
  '919731112426',
  'filmsbyjones',
  'Projects@filmsbyjones.com',
  'Indiranagar, Koramangala, Whitefield, HSR, JP Nagar, MG Road, Yelahanka & more',
  '[{"icon":"🎥","name":"Video cameras","desc":"Professional Sony cameras"},
    {"icon":"📸","name":"Photo cameras","desc":"Sony & Canon professional cameras"},
    {"icon":"🚁","name":"Drone","desc":"DJI Mavic 3 Pro & DJI Mavic 4 Pro"},
    {"icon":"💡","name":"Lighting","desc":"Aputure & Profoto"},
    {"icon":"🎙","name":"Audio","desc":"DJI & Rode microphones"},
    {"icon":"🎬","name":"Video editing","desc":"Premiere Pro · After Effects · DaVinci Resolve · Blender"},
    {"icon":"🖼","name":"Photo editing","desc":"Lightroom · Photoshop"}]',
  '[{"q":"How fast is delivery really?","a":"For Starter & Pro packages, edited reels and photos are delivered within 3 hours of your shoot wrapping. We edit on-location in parallel with shooting."},
    {"q":"Do I need a concept ready?","a":"Not at all. We brief you before the shoot and help with direction, poses and storytelling. Just show up!"},
    {"q":"What areas do you cover?","a":"All of Bengaluru — Indiranagar, Koramangala, Whitefield, HSR, JP Nagar, MG Road, Yelahanka & more. Instant shoots cover 20 km around you. Travel charges may apply beyond 25 km for scheduled shoots."},
    {"q":"Can I request revisions?","a":"Yes! Starter: 1 revision. Pro: 2 revisions. Elite: unlimited within 48 hours. Wedding packages have their own revision terms."},
    {"q":"How do I pay?","a":"50% advance on booking (UPI / card / bank transfer). Remaining 50% on shoot day before we begin. Full advance for wedding packages."}]'
);

-- ── Reviews ───────────────────────────────────────────
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references public.bookings (id) on delete cascade,
  customer_id uuid not null references public.profiles (id) on delete cascade,
  crew_id uuid references public.crew_members (id) on delete set null,
  rating smallint not null check (rating between 1 and 5),
  comment text not null default '',
  is_public boolean not null default true,
  created_at timestamptz not null default now()
);
create index reviews_crew_idx on public.reviews (crew_id);
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
revoke execute on function public.reviews_refresh_crew_rating() from public, anon, authenticated;

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
  insert into public.reviews (booking_id, customer_id, crew_id, rating, comment)
  values (b.id, b.customer_id, b.crew_id, p_rating, left(coalesce(trim(p_comment), ''), 1000))
  on conflict (booking_id) do update set rating = excluded.rating, comment = excluded.comment
  returning * into r;
  return r;
end;
$$;

-- Public testimonials: first name only, plus what was shot.
create or replace function public.public_reviews(p_limit integer default 10)
returns table (id uuid, rating smallint, comment text, customer_name text, shoot_type text, package_name text, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select r.id, r.rating, r.comment,
    coalesce(nullif(split_part(trim(p.full_name), ' ', 1), ''), 'Customer'),
    st.name, pk.name, r.created_at
  from public.reviews r
  join public.bookings b on b.id = r.booking_id
  join public.profiles p on p.id = r.customer_id
  join public.packages pk on pk.id = b.package_id
  left join public.shoot_types st on st.slug = b.shoot_type
  where r.is_public and length(trim(r.comment)) > 0
  order by r.created_at desc
  limit least(greatest(p_limit, 1), 50);
$$;

-- Real numbers for the home page stats row.
create or replace function public.public_stats()
returns table (shoots_delivered integer, avg_rating numeric, review_count integer, crew_online integer)
language sql stable security definer set search_path = ''
as $$
  select
    (select count(*)::integer from public.bookings where status = 'delivered'),
    (select round(avg(rating)::numeric, 1) from public.reviews),
    (select count(*)::integer from public.reviews),
    (select count(*)::integer from public.crew_members
      where approved and is_online and location_updated_at > now() - interval '10 minutes');
$$;

revoke execute on function public.submit_review(uuid, integer, text), public.public_reviews(integer), public.public_stats()
  from public, anon;
grant execute on function public.submit_review(uuid, integer, text) to authenticated;
grant execute on function public.public_reviews(integer), public.public_stats() to anon, authenticated;

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
