-- Quick Clicks: initial schema
-- Customers book photo/video shoots (scheduled or instant). Crew go online,
-- share location, accept requests and move bookings through their lifecycle.
-- All booking writes go through security-definer RPCs so rules live in one place.

create extension if not exists postgis with schema extensions;

-- ── Enums ─────────────────────────────────────────────
create type public.user_role as enum ('customer', 'crew', 'admin');
create type public.package_category as enum ('shoot', 'wedding', 'instant');
create type public.crew_kind as enum ('photographer', 'videographer', 'full_crew');
create type public.crew_tier as enum ('lite', 'pro', 'ultra');
create type public.booking_mode as enum ('scheduled', 'instant');
create type public.booking_status as enum (
  'requested', 'accepted', 'declined', 'en_route', 'arrived',
  'shooting', 'editing', 'delivered', 'cancelled'
);
create type public.payment_status as enum ('unpaid', 'advance_paid', 'paid', 'refunded');

-- ── Tables ────────────────────────────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  phone text,
  role public.user_role not null default 'customer',
  created_at timestamptz not null default now()
);

create table public.packages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  category public.package_category not null,
  tier public.crew_tier,            -- for instant packages: which crew tier serves it
  crew_kind public.crew_kind,       -- for instant packages: which crew kind serves it
  price_inr integer not null check (price_inr >= 0),
  duration_hours numeric(4,1) not null,
  description text not null default '',
  features text[] not null default '{}',
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.crew_members (
  id uuid primary key references public.profiles (id) on delete cascade,
  display_name text not null,
  kind public.crew_kind not null,
  tier public.crew_tier not null default 'lite',
  bio text not null default '',
  approved boolean not null default false,
  is_online boolean not null default false,
  location extensions.geography(point, 4326),
  location_updated_at timestamptz,
  rating numeric(2,1) not null default 5.0,
  created_at timestamptz not null default now()
);
create index crew_members_location_idx on public.crew_members using gist (location);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles (id) on delete cascade,
  crew_id uuid references public.crew_members (id) on delete set null,
  package_id uuid not null references public.packages (id),
  mode public.booking_mode not null,
  status public.booking_status not null default 'requested',
  scheduled_at timestamptz,
  address text not null,
  location extensions.geography(point, 4326),
  contact_phone text,
  notes text not null default '',
  price_inr integer not null,
  distance_km numeric(5,1),
  eta_minutes integer,
  deliverables_url text,
  payment_status public.payment_status not null default 'unpaid',
  cancel_reason text,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index bookings_customer_idx on public.bookings (customer_id, created_at desc);
create index bookings_crew_idx on public.bookings (crew_id, created_at desc);
create index bookings_status_idx on public.bookings (status);

create table public.booking_events (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  status public.booking_status not null,
  actor_id uuid references public.profiles (id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);
create index booking_events_booking_idx on public.booking_events (booking_id, created_at);

-- ── Helpers ───────────────────────────────────────────
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin');
$$;

-- Rough city-traffic ETA: 20 km/h average plus 5 minutes to get moving.
create or replace function public.estimate_eta_minutes(distance_km numeric)
returns integer language sql immutable set search_path = ''
as $$ select (ceil(distance_km / 20.0 * 60) + 5)::integer; $$;

-- New auth user -> profile row
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, phone)
  values (new.id, new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'phone')
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Booking timestamps + event log
create or replace function public.bookings_touch()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger bookings_touch before update on public.bookings
  for each row execute function public.bookings_touch();

create or replace function public.bookings_log_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.booking_events (booking_id, status, actor_id, note)
    values (new.id, new.status, (select auth.uid()), new.cancel_reason);
  end if;
  return new;
end;
$$;
create trigger bookings_log_event after insert or update on public.bookings
  for each row execute function public.bookings_log_event();

-- ── RLS ───────────────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.packages enable row level security;
alter table public.crew_members enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_events enable row level security;

create policy "profiles: read own or admin" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy "profiles: update own" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "profiles: admin update" on public.profiles for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
-- Users may only edit name/phone; role changes go through admin_set_role().
revoke update on public.profiles from authenticated, anon;
grant update (full_name, phone) on public.profiles to authenticated;

create policy "packages: public read active" on public.packages for select to anon, authenticated
  using (is_active or (select public.is_admin()));
create policy "packages: admin write" on public.packages for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "crew: read own or admin" on public.crew_members for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy "crew: admin write" on public.crew_members for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "bookings: read own" on public.bookings for select to authenticated
  using (customer_id = (select auth.uid()) or crew_id = (select auth.uid()) or (select public.is_admin()));
create policy "bookings: admin update" on public.bookings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

create policy "events: read if booking visible" on public.booking_events for select to authenticated
  using (exists (
    select 1 from public.bookings b where b.id = booking_id
      and (b.customer_id = (select auth.uid()) or b.crew_id = (select auth.uid()) or (select public.is_admin()))
  ));

-- ── RPCs: crew ────────────────────────────────────────
create or replace function public.apply_as_crew(p_display_name text, p_kind public.crew_kind, p_bio text default '')
returns public.crew_members language plpgsql security definer set search_path = ''
as $$
declare r public.crew_members;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first'; end if;
  insert into public.crew_members (id, display_name, kind, bio)
  values ((select auth.uid()), p_display_name, p_kind, coalesce(p_bio, ''))
  on conflict (id) do update set display_name = excluded.display_name, kind = excluded.kind, bio = excluded.bio
  returning * into r;
  return r;
end;
$$;

create or replace function public.crew_set_online(p_online boolean, p_lat double precision default null, p_lng double precision default null)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.crew_members set
    is_online = p_online,
    location = case when p_lat is not null and p_lng is not null
      then extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography else location end,
    location_updated_at = case when p_lat is not null then now() else location_updated_at end
  where id = (select auth.uid()) and approved;
  if not found then raise exception 'Not an approved crew member'; end if;
end;
$$;

create or replace function public.crew_update_location(p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.crew_members set
    location = extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography,
    location_updated_at = now()
  where id = (select auth.uid()) and approved;
  if not found then raise exception 'Not an approved crew member'; end if;
end;
$$;

-- ── RPCs: customer ────────────────────────────────────
-- Crew is "available" when approved, online, pinged in the last 10 minutes
-- and not already on an active instant job.
create or replace function public.nearby_crew(p_lat double precision, p_lng double precision, p_radius_km double precision default 20)
returns table (
  crew_id uuid, display_name text, kind public.crew_kind, tier public.crew_tier, rating numeric,
  distance_km numeric, eta_minutes integer, approx_lat double precision, approx_lng double precision
)
language sql stable security definer set search_path = ''
as $$
  with me as (select extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography as g)
  select c.id, c.display_name, c.kind, c.tier, c.rating,
    round((extensions.st_distance(c.location, me.g) / 1000)::numeric, 1) as distance_km,
    public.estimate_eta_minutes((extensions.st_distance(c.location, me.g) / 1000)::numeric),
    round(extensions.st_y(c.location::extensions.geometry)::numeric, 3)::double precision,
    round(extensions.st_x(c.location::extensions.geometry)::numeric, 3)::double precision
  from public.crew_members c, me
  where c.approved and c.is_online and c.location is not null
    and c.location_updated_at > now() - interval '10 minutes'
    and extensions.st_dwithin(c.location, me.g, p_radius_km * 1000)
    and not exists (
      select 1 from public.bookings b where b.crew_id = c.id and b.mode = 'instant'
        and b.status in ('accepted', 'en_route', 'arrived', 'shooting')
    )
  order by c.location operator(extensions.<->) me.g
  limit 30;
$$;

create or replace function public.request_instant_booking(
  p_crew_id uuid, p_package_id uuid, p_lat double precision, p_lng double precision,
  p_address text, p_contact_phone text, p_notes text default ''
)
returns public.bookings language plpgsql security definer set search_path = ''
as $$
declare
  v_pkg public.packages;
  v_dist numeric;
  v_point extensions.geography := extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography;
  r public.bookings;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first'; end if;
  select * into v_pkg from public.packages where id = p_package_id and is_active and category = 'instant';
  if not found then raise exception 'Unknown instant package'; end if;

  select round((extensions.st_distance(c.location, v_point) / 1000)::numeric, 1) into v_dist
  from public.nearby_crew(p_lat, p_lng, 20) n
  join public.crew_members c on c.id = n.crew_id
  where n.crew_id = p_crew_id
    and c.kind = v_pkg.crew_kind and c.tier >= v_pkg.tier;  -- higher tiers can take lower-tier jobs
  if v_dist is null then raise exception 'That crew member is no longer available nearby'; end if;

  if exists (select 1 from public.bookings where customer_id = (select auth.uid()) and mode = 'instant'
             and status in ('requested', 'accepted', 'en_route', 'arrived', 'shooting')) then
    raise exception 'You already have an active instant booking';
  end if;

  insert into public.bookings (customer_id, crew_id, package_id, mode, address, location, contact_phone,
                               notes, price_inr, distance_km, eta_minutes)
  values ((select auth.uid()), p_crew_id, p_package_id, 'instant', p_address, v_point, p_contact_phone,
          coalesce(p_notes, ''), v_pkg.price_inr, v_dist, public.estimate_eta_minutes(v_dist))
  returning * into r;
  return r;
end;
$$;

create or replace function public.create_scheduled_booking(
  p_package_id uuid, p_scheduled_at timestamptz, p_address text, p_contact_phone text,
  p_notes text default '', p_lat double precision default null, p_lng double precision default null
)
returns public.bookings language plpgsql security definer set search_path = ''
as $$
declare v_pkg public.packages; r public.bookings;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first'; end if;
  select * into v_pkg from public.packages where id = p_package_id and is_active and category in ('shoot', 'wedding');
  if not found then raise exception 'Unknown package'; end if;
  if p_scheduled_at < now() + interval '2 hours' then raise exception 'Pick a time at least 2 hours from now'; end if;

  insert into public.bookings (customer_id, package_id, mode, scheduled_at, address, location, contact_phone, notes, price_inr)
  values ((select auth.uid()), p_package_id, 'scheduled', p_scheduled_at, p_address,
          case when p_lat is not null and p_lng is not null
            then extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography end,
          p_contact_phone, coalesce(p_notes, ''), v_pkg.price_inr)
  returning * into r;
  return r;
end;
$$;

-- Live crew position for the customer while the crew is coming to them.
create or replace function public.booking_crew_location(p_booking_id uuid)
returns table (lat double precision, lng double precision, updated_at timestamptz, display_name text)
language sql stable security definer set search_path = ''
as $$
  select extensions.st_y(c.location::extensions.geometry), extensions.st_x(c.location::extensions.geometry),
         c.location_updated_at, c.display_name
  from public.bookings b join public.crew_members c on c.id = b.crew_id
  where b.id = p_booking_id
    and (b.customer_id = (select auth.uid()) or (select public.is_admin()))
    and b.status in ('accepted', 'en_route', 'arrived');
$$;

-- Crew name/kind for a booking the caller can see (customers can't read crew_members directly).
create or replace function public.booking_crew_info(p_booking_id uuid)
returns table (display_name text, kind public.crew_kind, tier public.crew_tier, rating numeric)
language sql stable security definer set search_path = ''
as $$
  select c.display_name, c.kind, c.tier, c.rating
  from public.bookings b join public.crew_members c on c.id = b.crew_id
  where b.id = p_booking_id
    and (b.customer_id = (select auth.uid()) or b.crew_id = (select auth.uid()) or (select public.is_admin()));
$$;

-- Customer/contact details for crew on their assigned booking.
create or replace function public.booking_customer_info(p_booking_id uuid)
returns table (full_name text, phone text, lat double precision, lng double precision)
language sql stable security definer set search_path = ''
as $$
  select p.full_name, coalesce(b.contact_phone, p.phone),
         extensions.st_y(b.location::extensions.geometry), extensions.st_x(b.location::extensions.geometry)
  from public.bookings b join public.profiles p on p.id = b.customer_id
  where b.id = p_booking_id
    and (b.crew_id = (select auth.uid()) or (select public.is_admin()))
    and b.status not in ('declined', 'cancelled');
$$;

-- ── RPCs: lifecycle ───────────────────────────────────
create or replace function public.crew_respond(p_booking_id uuid, p_accept boolean)
returns public.bookings language plpgsql security definer set search_path = ''
as $$
declare r public.bookings;
begin
  update public.bookings set
    status = case when p_accept then 'accepted'::public.booking_status else 'declined'::public.booking_status end,
    accepted_at = case when p_accept then now() else null end
  where id = p_booking_id and crew_id = (select auth.uid()) and status = 'requested'
  returning * into r;
  if not found then raise exception 'This request is no longer open'; end if;
  return r;
end;
$$;

-- Crew moves a job forward one step at a time.
create or replace function public.crew_advance(p_booking_id uuid, p_deliverables_url text default null)
returns public.bookings language plpgsql security definer set search_path = ''
as $$
declare b public.bookings; v_next public.booking_status;
begin
  select * into b from public.bookings where id = p_booking_id and crew_id = (select auth.uid()) for update;
  if not found then raise exception 'Booking not found'; end if;
  v_next := case b.status
    when 'accepted' then 'en_route'
    when 'en_route' then 'arrived'
    when 'arrived' then 'shooting'
    when 'shooting' then 'editing'
    when 'editing' then 'delivered'
  end;
  if v_next is null then raise exception 'Nothing to advance from status %', b.status; end if;
  if v_next = 'delivered' and coalesce(trim(p_deliverables_url), '') = '' then
    raise exception 'Add the deliverables link before marking delivered';
  end if;
  update public.bookings set status = v_next,
    deliverables_url = coalesce(nullif(trim(p_deliverables_url), ''), deliverables_url)
  where id = p_booking_id returning * into b;
  return b;
end;
$$;

create or replace function public.cancel_booking(p_booking_id uuid, p_reason text default null)
returns public.bookings language plpgsql security definer set search_path = ''
as $$
declare r public.bookings;
begin
  update public.bookings set status = 'cancelled', cancel_reason = nullif(trim(p_reason), '')
  where id = p_booking_id
    and status in ('requested', 'accepted', 'en_route')
    and (customer_id = (select auth.uid()) or crew_id = (select auth.uid()) or (select public.is_admin()))
  returning * into r;
  if not found then raise exception 'This booking can no longer be cancelled'; end if;
  return r;
end;
$$;

-- ── RPCs: admin ───────────────────────────────────────
create or replace function public.admin_assign_crew(p_booking_id uuid, p_crew_id uuid)
returns public.bookings language plpgsql security definer set search_path = ''
as $$
declare r public.bookings;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if not exists (select 1 from public.crew_members where id = p_crew_id and approved) then
    raise exception 'Crew member is not approved';
  end if;
  update public.bookings set crew_id = p_crew_id, status = 'requested'
  where id = p_booking_id and status in ('requested', 'declined')
  returning * into r;
  if not found then raise exception 'Booking cannot be reassigned in its current status'; end if;
  return r;
end;
$$;

create or replace function public.admin_set_crew_approval(p_crew_id uuid, p_approved boolean, p_tier public.crew_tier default null)
returns public.crew_members language plpgsql security definer set search_path = ''
as $$
declare r public.crew_members;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  update public.crew_members set approved = p_approved, tier = coalesce(p_tier, tier),
    is_online = case when p_approved then is_online else false end
  where id = p_crew_id returning * into r;
  if not found then raise exception 'Crew member not found'; end if;
  update public.profiles set role = case when p_approved then 'crew'::public.user_role else 'customer'::public.user_role end
  where id = p_crew_id and role <> 'admin';
  return r;
end;
$$;

create or replace function public.admin_set_role(p_user_id uuid, p_role public.user_role)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  update public.profiles set role = p_role where id = p_user_id;
end;
$$;

-- Lock down function execution: helpers stay internal, RPCs need a signed-in user.
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.is_admin(), public.apply_as_crew(text, public.crew_kind, text),
  public.crew_set_online(boolean, double precision, double precision),
  public.crew_update_location(double precision, double precision),
  public.nearby_crew(double precision, double precision, double precision),
  public.request_instant_booking(uuid, uuid, double precision, double precision, text, text, text),
  public.create_scheduled_booking(uuid, timestamptz, text, text, text, double precision, double precision),
  public.booking_crew_location(uuid), public.booking_crew_info(uuid), public.booking_customer_info(uuid),
  public.crew_respond(uuid, boolean), public.crew_advance(uuid, text), public.cancel_booking(uuid, text),
  public.admin_assign_crew(uuid, uuid), public.admin_set_crew_approval(uuid, boolean, public.crew_tier),
  public.admin_set_role(uuid, public.user_role)
to authenticated;
-- Guests can see crew availability on the map before signing in.
grant execute on function public.nearby_crew(double precision, double precision, double precision) to anon;
grant execute on function public.estimate_eta_minutes(numeric) to anon, authenticated;

-- ── Realtime ──────────────────────────────────────────
alter publication supabase_realtime add table public.bookings;

-- ── Seed packages ─────────────────────────────────────
insert into public.packages (slug, name, category, tier, crew_kind, price_inr, duration_hours, description, features, sort_order) values
  ('starter', 'Starter', 'shoot', null, null, 4999, 3, 'For creators and small brands',
    array['Up to 3 hours shoot', '1 edited reel (60–90 sec)', '10 edited photos', 'Delivery within 24 hours'], 10),
  ('pro', 'Pro', 'shoot', null, null, 8999, 5, 'For growing brands and influencers',
    array['Up to 5 hours shoot', '2 edited reels + BTS reel', '25 edited photos', 'Pro lighting setup', 'Same-day delivery'], 20),
  ('elite', 'Elite', 'shoot', null, null, 14999, 8, 'Full production for bigger brands',
    array['Full day (8 hours)', '4 reels + full video edit', '50+ edited photos', '2-person crew + drone', 'Colour grading + sound design'], 30),
  ('wedding-intimate', 'Wedding Intimate', 'wedding', null, null, 29999, 6, '1 day, 6 hours coverage',
    array['6 hours coverage', '1 cinematographer or 2 candid photographers', 'Highlight reel', 'Drone highlights'], 40),
  ('wedding-luxe', 'Wedding Luxe', 'wedding', null, null, 59999, 10, '1 full day coverage',
    array['Full day coverage', '1 cinematographer + 2 candid photographers', 'Feature film (5–8 min)', 'Highlight reel', 'Drone highlights'], 50),
  ('wedding-royal', 'Wedding Royal', 'wedding', null, null, 119999, 20, '2+ full days coverage',
    array['2+ days coverage', '2 cinematographers + 2 candid photographers', 'Pre-wedding shoot (4 hours)', 'Feature film + 4K reels', 'Priority delivery'], 60),
  ('instant-lite-photo', 'Lite Photographer', 'instant', 'lite', 'photographer', 2499, 1, 'Solo photographer, 1 hour',
    array['1 hour', 'Edited photos', 'Phone-ready reel'], 100),
  ('instant-lite-video', 'Lite Videographer', 'instant', 'lite', 'videographer', 2999, 1, 'Solo videographer, 1 hour',
    array['1 hour', '1 edited reel'], 110),
  ('instant-pro-photo', 'Pro Photographer', 'instant', 'pro', 'photographer', 4999, 2, 'Pro photographer, 2 hours',
    array['2 hours', 'Pro camera', 'Edited photos + reel'], 120),
  ('instant-pro-video', 'Pro Videographer', 'instant', 'pro', 'videographer', 5999, 2, 'Pro videographer, 2 hours',
    array['2 hours', 'Cinema camera', 'Edited reel'], 130),
  ('instant-ultra', 'Ultra Full Crew', 'instant', 'ultra', 'full_crew', 9999, 3, 'Photo + video crew with drone and lights, 3 hours',
    array['3 hours', 'Photo + video', 'Drone', 'Lighting'], 140);
