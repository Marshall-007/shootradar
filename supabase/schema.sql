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

-- ---------- Row level security ----------
alter table public.profiles enable row level security;
alter table public.events enable row level security;
alter table public.galleries enable row level security;
alter table public.photos enable row level security;
alter table public.orders enable row level security;

drop policy if exists profiles_own on public.profiles;
create policy profiles_own on public.profiles for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists events_read on public.events;
create policy events_read on public.events for select to anon, authenticated using (true);

drop policy if exists events_add_public on public.events;
create policy events_add_public on public.events for insert to anon
  with check (status = 'submitted' and created_by is null);

drop policy if exists events_add_member on public.events;
create policy events_add_member on public.events for insert to authenticated
  with check (status in ('submitted', 'user') and (created_by = auth.uid() or created_by is null));

drop policy if exists events_edit_own on public.events;
create policy events_edit_own on public.events for update to authenticated
  using (created_by = auth.uid()) with check (created_by = auth.uid() and status in ('submitted', 'user'));

drop policy if exists events_delete_own on public.events;
create policy events_delete_own on public.events for delete to authenticated using (created_by = auth.uid());

drop policy if exists galleries_own on public.galleries;
create policy galleries_own on public.galleries for all to authenticated
  using (photographer_id = auth.uid()) with check (photographer_id = auth.uid());

drop policy if exists photos_own on public.photos;
create policy photos_own on public.photos for all to authenticated
  using (photographer_id = auth.uid()) with check (photographer_id = auth.uid());

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
                                 'kids', g.kids, 'price', g.price, 'bundle', g.bundle),
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

drop policy if exists sr_previews_insert on storage.objects;
create policy sr_previews_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'previews' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists sr_previews_delete on storage.objects;
create policy sr_previews_delete on storage.objects for delete to authenticated
  using (bucket_id = 'previews' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists sr_previews_read on storage.objects;
create policy sr_previews_read on storage.objects for select to authenticated
  using (bucket_id = 'previews' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists sr_originals_insert on storage.objects;
create policy sr_originals_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'originals' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists sr_originals_read on storage.objects;
create policy sr_originals_read on storage.objects for select to authenticated
  using (bucket_id = 'originals' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists sr_originals_delete on storage.objects;
create policy sr_originals_delete on storage.objects for delete to authenticated
  using (bucket_id = 'originals' and (storage.foldername(name))[1] = auth.uid()::text);
