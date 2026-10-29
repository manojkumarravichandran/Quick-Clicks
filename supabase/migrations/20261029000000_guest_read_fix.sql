-- Public read policies call is_admin(); guests must be able to run it (it returns false for them).
-- Without this, signed-out visitors get "permission denied for function is_admin" on packages.
grant execute on function public.is_admin() to anon;
