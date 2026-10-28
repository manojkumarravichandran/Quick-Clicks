# Quick Clicks

On-demand photo and video shoots in Bengaluru. Customers book a scheduled shoot or request an
**instant** shoot from a real, nearby, online crew member, then track them live until delivery.

## What's in here

| Path | What it is |
| --- | --- |
| `app/` | Mobile-first web app (Vite + React + TypeScript + Tailwind + Leaflet maps) |
| `app/src/features/customer` | Home, packages, instant booking, scheduled booking, my shoots, live tracking |
| `app/src/features/crew` | Crew sign-up, go online/offline + live location, accept requests, job workflow |
| `app/src/features/admin` | Bookings desk, crew approval, assign crew, payments status, packages, users |
| `supabase/migrations` | Database schema, security rules (RLS) and booking logic (RPC functions) |
| `netlify.toml` | Netlify build config |

## How it works

- **Sign-in:** passwordless email link (Supabase Auth).
- **Crew:** a user applies at `/crew/join` → an admin approves and sets their tier (Lite/Pro/Ultra) →
  the crew member goes online and their phone shares location every ~15s while the app is open.
- **Instant shoot:** the customer's location is matched against online crew within 20 km
  (PostGIS distance). ETA is an estimate (20 km/h city average + 5 min). The chosen crew member gets
  the request in real time and accepts or declines. A crew member can only hold one instant job at a time.
- **Scheduled shoot:** customer picks package + date/time; an admin assigns a crew member, who accepts.
- **Job flow:** requested → accepted → en route → arrived → shooting → editing → delivered (with a
  link to the files). Every step is logged in `booking_events` and pushed live to the customer.
- **Security:** all booking writes go through database functions that check who is calling.
  Customers never see crew home locations (only rounded to ~1 km) or other customers' data.

## Run locally

```bash
cd app
npm install
npm run dev
```

The app points at the live Supabase project by default (`app/src/lib/supabase.ts`). To use a different
project, copy `app/.env.example` to `app/.env` and change the values.

## Deploy (Netlify)

1. In Netlify: **Add new site → Import from Git →** pick this repo. `netlify.toml` sets the build.
2. In Supabase dashboard → **Authentication → URL Configuration**:
   - **Site URL:** your Netlify URL (e.g. `https://quick-clicks.netlify.app`)
   - **Redirect URLs:** add `https://quick-clicks.netlify.app/**` and `http://localhost:5173/**`
3. Optional: **Authentication → Email Templates → Magic Link** — add `{{ .Token }}` so emails also
   include a 6-digit code (useful when the link opens in a different browser than the app).
4. Supabase's built-in email sender is rate-limited (a few emails per hour). Before launch, add your own
   SMTP (Resend, SendGrid, etc.) under **Authentication → SMTP Settings**.

## Make yourself admin

Sign in once, then run in the Supabase SQL editor:

```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```

## Not built yet

- Online payments (Razorpay). Payment status is tracked manually by admins for now.
- Push notifications / SMS. Crew must keep the app open to receive requests and share location.
- Ratings after delivery (the `rating` column exists; nothing writes it yet).
