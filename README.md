# ShootRadar pilot

Events worth shooting in South Africa, plus photo galleries that clients open from a QR code.
The pilot runs free: a static site on Cloudflare Pages and a Supabase free project for the database, login and photo storage.

## What it does

- **Events:** 28 real events in Johannesburg, Pretoria, Sun City, Cape Town and Durban, with times, crowd figure and its source, camera rules, organiser contact details and a ready-made message to the organiser. Graduations are an event type. Anyone can add an event or graduation; those show as "Unverified".
- **Galleries:** a photographer creates a gallery per shoot and gets a QR code. Clients see a numbered, watermarked preview made on the photographer's device; the original file uploads untouched (up to 50 MB) and is removed 7 days after upload to recycle the free storage. An event gallery can have private client galleries, each with its own QR code.
- **Clients:** scan the QR, browse the gallery, tick their photos and send a request. They pay the photographer directly (payment link, EFT or cash). When the photographer marks the request as paid, the full-quality originals unlock on the client's page until they expire. The photographer can decline a request, and anyone can ask for a photo of themselves to be removed.

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

## After an update

When `supabase/schema.sql` or `supabase/seed.sql` changes, paste the new version into the SQL Editor and run it again. Both are safe to rerun and keep existing galleries, photos and orders.

## Install on a phone

Open the site in Chrome on Android, then choose **Install app** (in Chrome's menu, or the button at the bottom of the page). It gets a home-screen icon and opens full-screen. On iPhone, use Safari's Share menu and **Add to Home Screen**.

## Free-plan limits to watch

| Limit | Free allowance | What it means here |
|---|---|---|
| Photo storage | 1 GB | Originals are removed 7 days after upload; previews stay. Delete old galleries to free space. |
| Data transfer | 5 GB a month | Enough for a pilot; heavy gallery browsing uses it up. |
| Inactivity | Project pauses after 7 days with no activity | Open the app weekly, or restore the project from the Supabase dashboard. |
| Cloudflare Pages | 500 deploys a month, unlimited traffic | No practical limit for the pilot. |

## How events are refreshed

- **Every day (about 05:10 SAST):** the GitHub workflow `Refresh events` runs `tools/refresh.py`. It applies `supabase/schema.sql` and `supabase/seed.sql`, pulls Ticketmaster South Africa and Quicket, adds new events, updates changed ones, removes feed events that have gone, and writes a row to the refresh log.
- **Every week:** a scheduled Claude task researches listings that have no feed, updates `tools/events.json` and `tools/research_log.json`, rebuilds the seed and pushes. The push triggers the same workflow.
- **In the app:** the footer shows the last refresh, and the Data sources page lists every source and the last runs.

GitHub secrets used (repository Settings > Secrets and variables > Actions): `SUPABASE_DB_URL` (session pooler connection string, required), `TICKETMASTER_API_KEY`, `QUICKET_API_KEY`. A feed without a key is skipped and logged.

To run it by hand: Actions tab > Refresh events > Run workflow.

## Updating the events by hand

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

## Access and admin

- Signed-out visitors see only a gallery-code box and the photographer sign-in. Events, galleries and uploads need an approved account; the database rules enforce this, not just the screens.
- New sign-ups are pending until an admin approves them on the Admin tab. The Data sources page and refresh log are admin-only.
- Make the first admin once, in the Supabase SQL editor (replace the email):
  `update public.profiles set is_admin = true, approved = true where email = 'you@example.com';`
- The Admin tab shows total photo storage against the 1 GB limit and how much each photographer uses.
- Expired originals are removed when an approved photographer (their own) or an admin (everyone's) opens the app.
