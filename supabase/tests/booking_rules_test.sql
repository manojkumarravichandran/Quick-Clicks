-- Booking rules and access control. Runs in a transaction and rolls back.
-- Each check raises an exception (failing the run) when the rule is broken.
\set ON_ERROR_STOP on
begin;

create function pg_temp.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create function pg_temp.as_admin_db() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claims', '', true); end $$;
create function pg_temp.refused(p_sql text) returns boolean language plpgsql as $$
begin execute p_sql; return false; exception when others then return true; end $$;
create function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin if not coalesce(p_ok, false) then raise exception 'FAILED: %', p_what; end if; end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;

-- Fixtures
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'c1@test.dev', '{"full_name":"Asha Rao"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'c2@test.dev', '{}'),
  ('00000000-0000-0000-0000-0000000000a1', 'a1@test.dev', '{}'),
  ('00000000-0000-0000-0000-0000000000d1', 'admin@test.dev', '{}');
update public.profiles set role = 'admin' where id = '00000000-0000-0000-0000-0000000000d1';

-- Crew applies, admin approves as Pro, crew goes online in Indiranagar.
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select pg_temp.check((public.apply_as_crew('Ravi', 'photographer', 'bio')).approved = false, 'new crew start unapproved');
select pg_temp.check(pg_temp.refused($$select public.crew_set_online(true, 12.978, 77.64)$$), 'unapproved crew cannot go online');
select pg_temp.check(pg_temp.refused($$select public.admin_set_crew_approval(auth.uid(), true)$$), 'crew cannot approve themselves');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000d1');
select public.admin_set_crew_approval('00000000-0000-0000-0000-0000000000a1', true, 'pro');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select public.crew_set_online(true, 12.9784, 77.6408);
select pg_temp.check((select market_id from public.crew_members where id = auth.uid())
                     = (select id from public.markets where slug = 'bengaluru'), 'crew defaults to the first market');

-- Markets / location
select pg_temp.as_admin_db();
select pg_temp.check(public.market_for_location(12.97, 77.60) = (select id from public.markets where slug = 'bengaluru'),
                     'a Bengaluru point maps to the Bengaluru market');
select pg_temp.check(public.market_for_location(51.5, -0.12) is null, 'London maps to no market');

-- Customer privileges
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
select pg_temp.check(pg_temp.refused($$update public.profiles set role = 'admin' where id = auth.uid()$$), 'customer cannot self-promote');
select pg_temp.check(pg_temp.refused($$insert into public.bookings (customer_id, package_id, market_id, mode, address, price_amount, currency)
  select auth.uid(), id, market_id, 'instant', 'x', 1, 'INR' from public.packages limit 1$$), 'customer cannot insert bookings directly');
select pg_temp.check(pg_temp.refused($$select public.handle_new_user()$$), 'trigger functions are not callable');
select pg_temp.check((select count(*) from public.crew_members) = 0, 'customers cannot read crew rows');
select pg_temp.check((select count(*) from public.nearby_crew(12.9756, 77.6050, 20)) = 1, 'nearby crew is found');
select pg_temp.check((select approx_lat from public.nearby_crew(12.9756, 77.6050, 20)) = 12.98, 'crew position is rounded for privacy');
select pg_temp.check(pg_temp.refused($$select public.request_instant_booking('00000000-0000-0000-0000-0000000000a1',
  (select id from public.packages where slug = 'instant-ultra'), 12.9756, 77.6050, 'MG Rd', '1', '')$$), 'pro crew cannot take an ultra job');

-- Instant booking happy path, priced in the market's currency
create temp table t_booking as
  select * from public.request_instant_booking('00000000-0000-0000-0000-0000000000a1',
    (select id from public.packages where slug = 'instant-lite-photo'), 12.9756, 77.6050, 'MG Road', '9999999999', '');
select pg_temp.check((select status = 'requested' and currency = 'INR' and price_amount = 2499 from t_booking), 'instant booking created in INR');
select pg_temp.check((select count(*) from public.nearby_crew(12.9756, 77.6050, 20)) = 0, 'requested crew is hidden from others');

-- Another customer cannot see or touch it
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c2');
select pg_temp.check((select count(*) from public.bookings) = 0, 'other customers cannot see the booking');
select pg_temp.check(pg_temp.refused(format('select public.cancel_booking(%L)', (select id from t_booking))), 'other customers cannot cancel');
select pg_temp.check(pg_temp.refused(format('select public.crew_advance(%L)', (select id from t_booking))), 'customers cannot advance jobs');

-- Crew runs the job to delivery
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select public.crew_respond((select id from t_booking), true);
select public.crew_advance((select id from t_booking));       -- en_route
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
select pg_temp.check((select count(*) from public.booking_crew_location((select id from t_booking))) = 1, 'customer sees live crew location');
select pg_temp.check(pg_temp.refused(format('select public.submit_review(%L, 5, %L)', (select id from t_booking), 'x')),
                     'cannot review before delivery');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select public.crew_advance((select id from t_booking));       -- arrived
select public.crew_advance((select id from t_booking));       -- shooting
select public.crew_advance((select id from t_booking));       -- editing
select pg_temp.check(pg_temp.refused(format('select public.crew_advance(%L)', (select id from t_booking))), 'delivery needs a link');
select public.crew_advance((select id from t_booking), 'https://drive.example/x');

-- Review flows into crew rating and public testimonials
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
select public.submit_review((select id from t_booking), 4, 'Lovely photos, very quick.');
select pg_temp.check((select customer_name from public.public_reviews(null, 5)) = 'Asha', 'testimonials show first name only');
select pg_temp.check((select shoots_delivered from public.public_stats(null)) = 1, 'stats count delivered shoots');
select pg_temp.as_admin_db();
select pg_temp.check((select rating from public.crew_members where id = '00000000-0000-0000-0000-0000000000a1') = 4.0,
                     'crew rating follows reviews');

-- Scheduled booking keeps shoot type + slot and needs 2h notice
select pg_temp.act_as('00000000-0000-0000-0000-0000000000c1');
select pg_temp.check(pg_temp.refused($$select public.create_scheduled_booking((select id from public.packages where slug = 'starter'),
  now() + interval '30 minutes', 'Addr', '1')$$), 'scheduled booking needs 2 hours notice');
select pg_temp.check((select shoot_type = 'food' and time_slot = 'Morning (7–10am)' and currency = 'INR'
  from public.create_scheduled_booking((select id from public.packages where slug = 'starter'),
    now() + interval '1 day', 'Addr', '1', '', null, null, 'food', 'Morning (7–10am)')), 'scheduled booking stores type and slot');

-- Public data
select pg_temp.as_admin_db();
set local role anon;
select pg_temp.check((select count(*) from public.gallery_items) = 33, 'gallery is public');
select pg_temp.check((select count(*) from public.markets_public) = 1, 'markets are public');
select pg_temp.check((select count(*) from public.site_settings) = 1, 'settings are public');
select pg_temp.check(pg_temp.refused($$update public.site_settings set business_name = 'x'$$) or
                     (select business_name from public.site_settings) <> 'x', 'guests cannot edit settings');
select pg_temp.check(pg_temp.refused($$select public.submit_review(gen_random_uuid(), 5, '')$$), 'guests cannot review');

rollback;
