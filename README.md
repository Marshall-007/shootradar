# ShootRadar pilot

Events worth shooting in South Africa, plus photo galleries that clients open from a QR code.
The pilot runs free: a static site on Cloudflare Pages and a Supabase free project for the database, login and photo storage.

## What it does

- **Events:** 28 real events in Johannesburg, Pretoria, Sun City, Cape Town and Durban, with times, crowd figure and its source, camera rules, organiser contact details and a ready-made message to the organiser. Graduations are an event type. Anyone can add an event or graduation; those show as "Unverified".
- **Galleries:** a photographer creates a gallery per shoot and gets a QR code. Photos are resized, numbered and watermarked on the photographer's device, then uploaded.
- **Clients:** scan the QR, browse the gallery, tick their photos and send a request. They pay the photographer directly (payment link, EFT or cash). When the photographer marks the request as paid, the clean photos unlock on the client's page for 14 days.

## Set up (once, about 15 minutes)

### 1. Supabase

1. Open the project, go to **SQL Editor**, paste all of `supabase/schema.sql` and run it.
2. Paste all of `supabase/seed.sql` and run it. This loads the events.
3. Go to **Authentication > Sign In / Providers > Email** and turn **Confirm email** off. The free plan sends only a few emails an hour, so pilot users would get stuck waiting for confirmation mail.
4. Check **Storage**: there should be two buckets, `previews` (public) and `originals` (private).

The project URL and publishable key are already in `js/config.js`. Never put the `service_role` key in this repository.

### 2. Cloudflare Pages

1. In the Cloudflare dashboard go to **Workers & Pages > Create > Pages > Connect to Git** and pick this repository.
2. Framework preset: **None**. Build command: leave empty. Build output directory: `/`.
3. Deploy. You get an address like `https://shootradar.pages.dev`. Every push to `main` redeploys.

### 3. Try it

- Add `?demo` to the address to try everything without an account. Nothing is saved in demo mode.
- Without `?demo`: create an account on the Profile tab, fill in your profile, create a gallery, upload two photos, then open the gallery link on another phone and request a photo.

## Free-plan limits to watch

| Limit | Free allowance | What it means here |
|---|---|---|
| Photo storage | 1 GB | Roughly 1,500 photos in total. Delete old galleries to free space. |
| Data transfer | 5 GB a month | Enough for a pilot; heavy gallery browsing uses it up. |
| Inactivity | Project pauses after 7 days with no activity | Open the app weekly, or restore the project from the Supabase dashboard. |
| Cloudflare Pages | 500 deploys a month, unlimited traffic | No practical limit for the pilot. |

## Updating the events

Edit `tools/events.json`, run `python3 tools/build_seed.py`, then paste the new `supabase/seed.sql` into the SQL Editor. Running it again updates existing events and adds new ones.

## Files

- `index.html`, `css/app.css`, `js/app.js`: the app.
- `js/api.js`: all database, login and storage calls, plus the in-memory demo mode.
- `js/config.js`: Supabase address, publishable key and the support WhatsApp number.
- `supabase/schema.sql`: tables, security rules, storage buckets and the three functions the public gallery uses.
- `supabase/seed.sql`, `js/demo-data.js`: generated from `tools/events.json`.

## Privacy notes

- Anyone with a gallery's code or link can see every watermarked photo in it. Galleries are never listed or searchable.
- A children's gallery cannot be created unless the photographer confirms that the school and parents have agreed, and requests in it need a parent or guardian's name.
- This is not legal advice. Have a POPIA attorney check the consent wording before shooting children's events.
