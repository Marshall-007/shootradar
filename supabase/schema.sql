-- ShootRadar pilot: database, security rules and photo storage.
-- Paste this whole file into Supabase > SQL Editor and run it once. It is safe to run again.

-- ---------- Tables ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  brand text not null default '',
  phone text not null default '',
  pay_link text not null default '',
  price integer not null default 60,
  bundle integer not null default 150,
  city text not null default 'Johannesburg',
  created_at timestamptz not null default now()
);

create table if not exists public.events (
  id text primary key default ('u-' || substr(md5(random()::text || clock_timestamp()::text), 1, 10)),
  name text not null,
  cat text not null default 'festival',
  city text not null,
  venue text not null default '',
  area text not null default '',
  address text not null default '',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  end_est boolean not null default true,
  days integer not null default 1,
  daily text,
  doors text,
  show text,
  time_note text,
  crowd jsonb not null default '{}'::jsonb,
  ticket jsonb not null default '{}'::jsonb,
  source jsonb not null default '{}'::jsonb,
  organiser jsonb not null default '{}'::jsonb,
  status text not null default 'submitted',
  access text not null default 'ticket',
  access_note text,
  tags text[] not null default '{}',
  f jsonb not null default '{"glam":2,"celebs":1,"spend":3}'::jsonb,
  outdoor boolean not null default false,
  minors boolean not null default false,
  tips text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint events_name_len check (char_length(name) between 3 and 140),
  constraint events_order check (ends_at >= starts_at)
);
create index if not exists events_starts_idx on public.events (starts_at);

create table if not exists public.galleries (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  photographer_id uuid not null references auth.users(id) on delete cascade,
  event_id text references public.events(id) on delete set null,
  title text not null,
  event_date date,
  kids boolean not null default false,
  guardian_ok boolean not null default false,
  price integer not null default 60,
  bundle integer not null default 150,
  created_at timestamptz not null default now(),
  constraint galleries_kids_consent check (not kids or guardian_ok)
);
create index if not exists galleries_owner_idx on public.galleries (photographer_id);

create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references public.galleries(id) on delete cascade,
  photographer_id uuid not null references auth.users(id) on delete cascade,
  seq integer not null,
  preview_path text not null,
  full_path text not null,
  w integer not null default 0,
  h integer not null default 0,
  bytes integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists photos_gallery_idx on public.photos (gallery_id, seq);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  gallery_id uuid not null references public.galleries(id) on delete cascade,
  photographer_id uuid not null references auth.users(id) on delete cascade,
  client_name text not null,
  client_phone text not null default '',
  photo_ids uuid[] not null,
  consent boolean not null default false,
  portfolio boolean not null default false,
  offers boolean not null default false,
  guardian text not null default '',
  status text not null default 'requested',
  amount integer not null default 0,
  downloads jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  constraint orders_status check (status in ('requested', 'paid', 'delivered'))
);
create index if not exists orders_gallery_idx on public.orders (gallery_id);

-- Photographer approval: sign-ups start as pending until an admin approves them.
alter table public.profiles add column if not exists approved boolean not null default false;
alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.profiles add column if not exists email text;
insert into public.profiles (id, email) select u.id, u.email from auth.users u
on conflict (id) do update set email = excluded.email;

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_admin);
$$;
create or replace function public.is_approved() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and (approved or is_admin));
$$;

-- Nobody can approve themselves or make themselves admin: only an admin, or the SQL editor, can change those two fields.
create or replace function public.profiles_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if tg_op = 'INSERT' then
      new.approved := false; new.is_admin := false;
    else
      new.approved := old.approved; new.is_admin := old.is_admin; new.email := old.email;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before insert or update on public.profiles for each row execute function public.profiles_guard();

-- Returns the signed-in photographer's profile, creating a pending one on first sign-in.
create or replace function public.my_profile() returns public.profiles language plpgsql security definer set search_path = public as $$
declare p public.profiles;
begin
  if auth.uid() is null then return null; end if;
  insert into public.profiles (id, email) values (auth.uid(), (select email from auth.users where id = auth.uid()))
  on conflict (id) do nothing;
  select * into p from public.profiles where id = auth.uid();
  return p;
end;
$$;
revoke all on function public.my_profile() from public;
grant execute on function public.my_profile() to authenticated;

-- Private client galleries hang off an event gallery and have their own code.
alter table public.galleries add column if not exists parent_id uuid references public.galleries(id) on delete cascade;
alter table public.galleries add column if not exists private boolean not null default false;

-- Originals are kept untouched and removed 7 days after upload to recycle the free storage.
alter table public.photos add column if not exists expires_at timestamptz not null default (now() + interval '7 days');
alter table public.photos add column if not exists full_deleted boolean not null default false;

alter table public.orders drop constraint if exists orders_status;
alter table public.orders add constraint orders_status check (status in ('requested', 'paid', 'delivered', 'declined'));

-- Requests from the public to take a photo down.
create table if not exists public.takedowns (
  id uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references public.galleries(id) on delete cascade,
  photo_id uuid not null references public.photos(id) on delete cascade,
  photographer_id uuid not null references auth.users(id) on delete cascade,
  name text not null default '',
  phone text not null default '',
  reason text not null default '',
  created_at timestamptz not null default now()
);
alter table public.takedowns enable row level security;
drop policy if exists takedowns_own on public.takedowns;
create policy takedowns_own on public.takedowns for all to authenticated
  using (photographer_id = auth.uid()) with check (photographer_id = auth.uid());

-- Where each event came from, and when it was last checked against its source.
alter table public.events add column if not exists origin text not null default 'user';
alter table public.events add column if not exists checked_at timestamptz;

-- One row per refresh: which sources were checked and what changed. Shown on the Data sources page.
create table if not exists public.refresh_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  kind text not null,
  sources jsonb not null default '[]'::jsonb,
  added integer not null default 0,
  updated integer not null default 0,
  removed integer not null default 0,
  run_key text unique
);
alter table public.refresh_runs enable row level security;
drop policy if exists refresh_runs_read on public.refresh_runs;
create policy refresh_runs_read on public.refresh_runs for select to authenticated using (public.is_admin());
revoke select on public.refresh_runs from anon;
grant select on public.refresh_runs to authenticated;

-- ---------- Row level security ----------
alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.galleries enable row level security;
alter table public.photos enable row level security;
alter table public.orders enable row level security;

drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
drop policy if exists profiles_admin on public.profiles;
create policy profiles_admin on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists events_read on public.events;
create policy events_read on public.events for select to authenticated using (public.is_approved());

drop policy if exists events_add_public on public.events;

drop policy if exists events_add_member on public.events;
create policy events_add_member on public.events for insert to authenticated
  with check (public.is_approved() and status in ('submitted', 'user') and created_by = auth.uid());

drop policy if exists events_edit_own on public.events;
create policy events_edit_own on public.events for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid() and status in ('submitted', 'user'));

drop policy if exists events_delete_own on public.events;
create policy events_delete_own on public.events for delete to authenticated using (created_by = auth.uid());

drop policy if exists galleries_own on public.galleries;
create policy galleries_own on public.galleries for all to authenticated
  using (photographer_id = auth.uid()) with check (photographer_id = auth.uid() and public.is_approved());

drop policy if exists photos_own on public.photos;
create policy photos_own on public.photos for all to authenticated
  using (photographer_id = auth.uid()) with check (photographer_id = auth.uid() and public.is_approved());
drop policy if exists photos_admin on public.photos;
create policy photos_admin on public.photos for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Clients create and read orders only through the functions below.
drop policy if exists orders_own_read on public.orders;
create policy orders_own_read on public.orders for select to authenticated using (photographer_id = auth.uid());
drop policy if exists orders_own_update on public.orders;
create policy orders_own_update on public.orders for update to authenticated
  using (photographer_id = auth.uid()) with check (photographer_id = auth.uid());
drop policy if exists orders_own_delete on public.orders;
create policy orders_own_delete on public.orders for delete to authenticated using (photographer_id = auth.uid());

-- ---------- Functions the public gallery uses ----------
create or replace function public.get_gallery(p_code text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'gallery', json_build_object('id', g.id, 'code', g.code, 'title', g.title, 'event_date', g.event_date,
                                 'kids', g.kids, 'price', g.price, 'bundle', g.bundle, 'private', g.private),
    'photographer', json_build_object('name', coalesce(pr.name, ''), 'brand', coalesce(pr.brand, ''),
                                      'phone', coalesce(pr.phone, ''), 'pay_link', coalesce(pr.pay_link, '')),
    'photos', (select coalesce(json_agg(json_build_object('id', p.id, 'seq', p.seq, 'path', p.preview_path,
                                                          'w', p.w, 'h', p.h) order by p.seq), '[]'::json)
               from public.photos p where p.gallery_id = g.id))
  from public.galleries g
  left join public.profiles pr on pr.id = g.photographer_id
  where g.code = upper(trim(p_code));
$$;

create or replace function public.create_order(
  p_code text, p_name text, p_phone text, p_photo_ids uuid[],
  p_consent boolean, p_portfolio boolean, p_offers boolean, p_guardian text)
returns text language plpgsql security definer set search_path = public as $$
declare
  g public.galleries%rowtype;
  n integer;
  total integer;
  new_code text;
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
begin
  select * into g from public.galleries where code = upper(trim(p_code));
  if not found then raise exception 'Gallery not found'; end if;
  if not coalesce(p_consent, false) then raise exception 'Consent is required'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Name is required'; end if;
  if g.kids and char_length(trim(coalesce(p_guardian, ''))) < 2 then
    raise exception 'A parent or guardian name is required for this gallery';
  end if;
  n := coalesce(array_length(p_photo_ids, 1), 0);
  if n < 1 or n > 60 then raise exception 'Choose between 1 and 60 photos'; end if;
  if (select count(*) from public.photos where gallery_id = g.id and id = any(p_photo_ids)) <> n then
    raise exception 'Some photos are not in this gallery';
  end if;
  total := n * g.price;
  if g.bundle > 0 and g.bundle < total then total := g.bundle; end if;
  loop
    new_code := 'SR-';
    for i in 1..6 loop
      new_code := new_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.orders where code = new_code);
  end loop;
  insert into public.orders (code, gallery_id, photographer_id, client_name, client_phone, photo_ids,
                             consent, portfolio, offers, guardian, amount)
  values (new_code, g.id, g.photographer_id, left(trim(p_name), 80), left(coalesce(p_phone, ''), 20), p_photo_ids,
          true, coalesce(p_portfolio, false), coalesce(p_offers, false), left(coalesce(p_guardian, ''), 80), total);
  return new_code;
end;
$$;

create or replace function public.get_order(p_code text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'code', o.code, 'status', o.status, 'amount', o.amount, 'client_name', o.client_name,
    'created_at', o.created_at,
    'downloads', case when o.status in ('paid', 'delivered') then o.downloads else '[]'::jsonb end,
    'expires_at', (select min(p.expires_at) from public.photos p where p.id = any(o.photo_ids)),
    'gallery', json_build_object('code', g.code, 'title', g.title, 'price', g.price, 'bundle', g.bundle),
    'photographer', json_build_object('name', coalesce(pr.name, ''), 'brand', coalesce(pr.brand, ''),
                                      'phone', coalesce(pr.phone, ''), 'pay_link', coalesce(pr.pay_link, '')),
    'photos', (select coalesce(json_agg(json_build_object('id', p.id, 'seq', p.seq, 'path', p.preview_path) order by p.seq), '[]'::json)
               from public.photos p where p.id = any(o.photo_ids)))
  from public.orders o
  join public.galleries g on g.id = o.gallery_id
  left join public.profiles pr on pr.id = o.photographer_id
  where o.code = upper(trim(p_code));
$$;

-- Anyone looking at a gallery can ask for a photo to be taken down.
create or replace function public.request_takedown(p_code text, p_photo_id uuid, p_name text, p_phone text, p_reason text)
returns boolean language plpgsql security definer set search_path = public as $$
declare g public.galleries%rowtype;
begin
  select * into g from public.galleries where code = upper(trim(p_code));
  if not found then raise exception 'Gallery not found'; end if;
  if not exists (select 1 from public.photos where id = p_photo_id and gallery_id = g.id) then raise exception 'Photo not found'; end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 then raise exception 'Name is required'; end if;
  if (select count(*) from public.takedowns where photo_id = p_photo_id) >= 5 then return true; end if;
  insert into public.takedowns (gallery_id, photo_id, photographer_id, name, phone, reason)
  values (g.id, p_photo_id, g.photographer_id, left(trim(p_name), 80), left(coalesce(p_phone, ''), 20), left(coalesce(p_reason, ''), 300));
  return true;
end;
$$;
revoke all on function public.request_takedown(text, uuid, text, text, text) from public;
grant execute on function public.request_takedown(text, uuid, text, text, text) to anon, authenticated;

-- Lets a client who lost their page find it again with their WhatsApp number and order code.
create or replace function public.find_order(p_code text, p_phone text)
returns text language sql stable security definer set search_path = public as $$
  select o.code from public.orders o
  where o.code = case when upper(trim(p_code)) like 'SR-%' then upper(trim(p_code)) else 'SR-' || upper(trim(p_code)) end
    and length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) >= 9
    and right(regexp_replace(o.client_phone, '\D', '', 'g'), 9) = right(regexp_replace(p_phone, '\D', '', 'g'), 9);
$$;
revoke all on function public.find_order(text, text) from public;
grant execute on function public.find_order(text, text) to anon, authenticated;

revoke all on function public.get_gallery(text) from public;
revoke all on function public.create_order(text, text, text, uuid[], boolean, boolean, boolean, text) from public;
revoke all on function public.get_order(text) from public;
grant execute on function public.get_gallery(text) to anon, authenticated;
grant execute on function public.create_order(text, text, text, uuid[], boolean, boolean, boolean, text) to anon, authenticated;
grant execute on function public.get_order(text) to anon, authenticated;

-- ---------- Photo storage ----------
-- previews: watermarked, public. originals: clean copies, private, shared by expiring link once paid.
insert into storage.buckets (id, name, public, file_size_limit)
values ('previews', 'previews', true, 1048576), ('originals', 'originals', false, 5242880)
on conflict (id) do nothing;
-- Originals are stored untouched, so allow full-size camera files (50 MB each).
update storage.buckets set file_size_limit = 52428800 where id = 'originals';

drop policy if exists sr_previews_insert on storage.objects;
create policy sr_previews_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'previews' and (storage.foldername(name))[1] = auth.uid()::text and public.is_approved());
drop policy if exists sr_previews_delete on storage.objects;
create policy sr_previews_delete on storage.objects for delete to authenticated
  using (bucket_id = 'previews' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists sr_previews_read on storage.objects;
create policy sr_previews_read on storage.objects for select to authenticated
  using (bucket_id = 'previews' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists sr_originals_insert on storage.objects;
create policy sr_originals_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'originals' and (storage.foldername(name))[1] = auth.uid()::text and public.is_approved());
drop policy if exists sr_originals_read on storage.objects;
create policy sr_originals_read on storage.objects for select to authenticated
  using (bucket_id = 'originals' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists sr_originals_delete on storage.objects;
create policy sr_originals_delete on storage.objects for delete to authenticated
  using (bucket_id = 'originals' and (storage.foldername(name))[1] = auth.uid()::text);

-- Replacing an expired original needs update rights; an admin may clear anyone's expired originals.
drop policy if exists sr_originals_update on storage.objects;
create policy sr_originals_update on storage.objects for update to authenticated
  using (bucket_id = 'originals' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'originals' and (storage.foldername(name))[1] = auth.uid()::text and public.is_approved());
drop policy if exists sr_originals_admin on storage.objects;
create policy sr_originals_admin on storage.objects for all to authenticated
  using (bucket_id = 'originals' and public.is_admin()) with check (bucket_id = 'originals' and public.is_admin());

-- Admin console: how much photo storage each photographer is using, read from the stored files themselves.
create or replace function public.storage_usage() returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  return (select coalesce(json_agg(json_build_object('id', t.u, 'bytes', t.b, 'files', t.n)), '[]'::json) from (
    select split_part(o.name, '/', 1) as u, coalesce(sum((o.metadata->>'size')::bigint), 0) as b, count(*) as n
    from storage.objects o where o.bucket_id in ('previews', 'originals') group by 1) t);
end;
$$;
revoke all on function public.storage_usage() from public;
grant execute on function public.storage_usage() to authenticated;
