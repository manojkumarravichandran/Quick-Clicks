-- Trigger/helper functions are never meant to be called over the API.
revoke execute on function public.handle_new_user(), public.bookings_touch(), public.bookings_log_event()
  from authenticated, anon, public;

-- nearby_crew: hide crew who are already being asked (pending instant request in the
-- last 3 minutes) and round public coordinates to ~1 km to protect crew privacy.
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
    round(extensions.st_y(c.location::extensions.geometry)::numeric, 2)::double precision,
    round(extensions.st_x(c.location::extensions.geometry)::numeric, 2)::double precision
  from public.crew_members c, me
  where c.approved and c.is_online and c.location is not null
    and c.location_updated_at > now() - interval '10 minutes'
    and extensions.st_dwithin(c.location, me.g, least(p_radius_km, 50) * 1000)
    and not exists (
      select 1 from public.bookings b where b.crew_id = c.id and b.mode = 'instant'
        and (b.status in ('accepted', 'en_route', 'arrived', 'shooting')
             or (b.status = 'requested' and b.created_at > now() - interval '3 minutes'))
    )
  order by c.location operator(extensions.<->) me.g
  limit 30;
$$;

-- crew_respond: a crew member can only be on one instant job at a time, and
-- instant requests older than 15 minutes are stale.
create or replace function public.crew_respond(p_booking_id uuid, p_accept boolean)
returns public.bookings language plpgsql security definer set search_path = ''
as $$
declare b public.bookings; r public.bookings;
begin
  select * into b from public.bookings
  where id = p_booking_id and crew_id = (select auth.uid()) and status = 'requested' for update;
  if not found then raise exception 'This request is no longer open'; end if;

  if p_accept and b.mode = 'instant' then
    if b.created_at < now() - interval '15 minutes' then
      raise exception 'This request has expired';
    end if;
    if exists (select 1 from public.bookings x where x.crew_id = b.crew_id and x.id <> b.id and x.mode = 'instant'
               and x.status in ('accepted', 'en_route', 'arrived', 'shooting')) then
      raise exception 'Finish your current instant job before accepting another';
    end if;
  end if;

  update public.bookings set
    status = case when p_accept then 'accepted'::public.booking_status else 'declined'::public.booking_status end,
    accepted_at = case when p_accept then now() else null end
  where id = p_booking_id
  returning * into r;
  return r;
end;
$$;
