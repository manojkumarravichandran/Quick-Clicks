-- Job location as plain lat/lng for anyone who can see the booking.
create or replace function public.booking_location(p_booking_id uuid)
returns table (lat double precision, lng double precision)
language sql stable security definer set search_path = ''
as $$
  select extensions.st_y(b.location::extensions.geometry), extensions.st_x(b.location::extensions.geometry)
  from public.bookings b
  where b.id = p_booking_id and b.location is not null
    and (b.customer_id = (select auth.uid()) or b.crew_id = (select auth.uid()) or (select public.is_admin()));
$$;
revoke execute on function public.booking_location(uuid) from public, anon;
grant execute on function public.booking_location(uuid) to authenticated;
