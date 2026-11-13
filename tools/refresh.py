"""Daily event refresh for ShootRadar. Runs in GitHub Actions (see .github/workflows/refresh.yml).

What it does, in order:
  1. Applies supabase/schema.sql and supabase/seed.sql, so database changes and researched events go live.
  2. Pulls events from the feeds that have an API key saved as a GitHub secret (Ticketmaster, Quicket).
  3. Adds new events, updates changed ones, removes feed events that have disappeared or ended.
  4. Writes one row to refresh_runs saying which sources were checked and what changed.

Secrets used: SUPABASE_DB_URL (required), TICKETMASTER_API_KEY and QUICKET_API_KEY (each optional).
A source without a key, or one that fails, is logged and skipped; it never stops the others.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

ROOT = Path(__file__).resolve().parent.parent
SAST = timezone(timedelta(hours=2))
NOW = datetime.now(timezone.utc)
HORIZON_DAYS = 75
MAX_EVENT_DAYS = 10  # longer listings are standing offers (tours, classes) or have faulty dates, so they are left out

CITY_WORDS = {
    'Johannesburg': ['johannesburg', 'sandton', 'soweto', 'randburg', 'midrand', 'roodepoort', 'nasrec', 'rosebank',
                     'braamfontein', 'fourways', 'bryanston', 'kempton park', 'boksburg', 'benoni', 'germiston', 'alberton'],
    'Pretoria': ['pretoria', 'centurion', 'tshwane', 'menlyn', 'hatfield', 'irene'],
    'Sun City': ['sun city'],
    'Cape Town': ['cape town', 'kaapstad', 'bellville', 'stellenbosch', 'goodwood', 'newlands', 'green point', 'constantia',
                  'paarl', 'somerset west', 'durbanville', 'franschhoek'],
    'Durban': ['durban', 'umhlanga', 'ethekwini', 'ballito', 'pinetown', 'westville'],
}
CAPACITY = [('fnb stadium', 94736), ('sunbet arena', 8500), ('grand arena', 7000), ('grandwest', 7000),
            ('dhl stadium', 58310), ('cape town stadium', 58310), ('emirates airline park', 62567), ('ellis park', 62567)]
STOP = set('the a an and of at in on for with live tour world presents ft feat featuring vs v south africa sa 2026 2027'.split())
SKIP_NAME = re.compile(r'\b(parking|park and ride|park & ride|vip package|hospitality|upgrade|voucher|gift card|shuttle)\b', re.I)


def get_json(url, timeout=40):
    req = urllib.request.Request(url, headers={'User-Agent': 'ShootRadar-refresh/1.0', 'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode('utf-8'))


def city_of(*parts):
    text = ' '.join(str(p or '') for p in parts).lower()
    for city, words in CITY_WORDS.items():
        if any(w in text for w in words):
            return city
    return None


def parse_dt(value, naive_tz=SAST):
    if not value:
        return None
    try:
        d = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    except ValueError:
        return None
    return d if d.tzinfo else d.replace(tzinfo=naive_tz)


def words(name):
    return {w for w in re.findall(r'[a-z0-9]+', name.lower()) if w not in STOP and len(w) > 1}


def same_event(a_name, a_start, a_city, b_name, b_start, b_city):
    if a_city != b_city or a_start.astimezone(SAST).date() != b_start.astimezone(SAST).date():
        return False
    wa, wb = words(a_name), words(b_name)
    if not wa or not wb:
        return False
    return len(wa & wb) / min(len(wa), len(wb)) >= 0.5


def capacity(venue):
    v = (venue or '').lower()
    for key, n in CAPACITY:
        if key in v:
            return n
    return None


def clock(d):
    return d.astimezone(SAST).strftime('%H:%M')


# ---------------- Ticketmaster ----------------
def from_ticketmaster(key):
    out, seen = [], set()
    end = (NOW + timedelta(days=HORIZON_DAYS)).strftime('%Y-%m-%dT%H:%M:%SZ')
    for page in range(6):
        q = urllib.parse.urlencode({'apikey': key, 'countryCode': 'ZA', 'size': 200, 'page': page, 'sort': 'date,asc',
                                    'startDateTime': NOW.strftime('%Y-%m-%dT%H:%M:%SZ'), 'endDateTime': end})
        data = get_json('https://app.ticketmaster.com/discovery/v2/events.json?' + q)
        items = (data.get('_embedded') or {}).get('events') or []
        for e in items:
            row = map_ticketmaster(e)
            if not row:
                continue
            k = (re.sub(r'\W+', '', row['name'].lower()), row['starts_at'].date(), row['venue'].lower())
            if k in seen:
                continue
            seen.add(k)
            out.append(row)
        if page + 1 >= ((data.get('page') or {}).get('totalPages') or 1):
            break
    return out


def map_ticketmaster(e):
    name = (e.get('name') or '').strip()
    if len(name) < 3 or SKIP_NAME.search(name):
        return None
    dates = e.get('dates') or {}
    st = dates.get('start') or {}
    if st.get('dateTBD') or st.get('dateTBA'):
        return None
    code = ((dates.get('status') or {}).get('code') or '').lower()
    if code in ('cancelled', 'canceled'):
        return None
    start = parse_dt(st.get('dateTime'))
    time_known = bool(st.get('localTime')) and not st.get('timeTBA')
    if not start and st.get('localDate'):
        start = parse_dt(st['localDate'] + 'T' + (st.get('localTime') or '19:00:00'))
    if not start:
        return None
    end = parse_dt((dates.get('end') or {}).get('dateTime'))
    end_est = not end or end <= start
    if end_est:
        end = start + timedelta(hours=3, minutes=30)
    if (end - start) > timedelta(days=MAX_EVENT_DAYS):
        return None
    venue = (((e.get('_embedded') or {}).get('venues')) or [{}])[0]
    vname = venue.get('name') or 'Venue to be confirmed'
    vcity = (venue.get('city') or {}).get('name') or ''
    line1 = (venue.get('address') or {}).get('line1') or ''
    city = city_of(vcity, vname, line1) or (vcity.strip() or None)
    if not city:
        return None
    cls = (e.get('classifications') or [{}])[0]
    segment = ((cls.get('segment') or {}).get('name') or '').strip()
    genre = ((cls.get('genre') or {}).get('name') or '').strip()
    cat = {'Music': 'concert', 'Sports': 'sport', 'Arts & Theatre': 'arts'}.get(segment, 'festival')
    cap = capacity(vname)
    crowd = ({'basis': 'capacity', 'n': cap, 'text': 'Up to {:,}'.format(cap), 'note': 'Venue capacity'} if cap
             else {'basis': 'estimate', 'size': 'medium' if cat in ('concert', 'sport') else 'small', 'note': 'No figure published'})
    prices = e.get('priceRanges') or []
    price = ''
    if prices and prices[0].get('min') is not None:
        lo, hi = prices[0].get('min'), prices[0].get('max')
        price = 'R{:,.0f}'.format(lo) + ('–R{:,.0f}'.format(hi) if hi and hi != lo else '')
    promoter = (e.get('promoter') or {}).get('name') or ''
    big = cat in ('concert', 'sport')
    return {
        'id': 'tm-' + str(e.get('id')), 'name': name[:140], 'cat': cat, 'city': city, 'venue': vname, 'area': vcity,
        'address': ', '.join(p for p in [line1, vcity] if p), 'starts_at': start, 'ends_at': end, 'end_est': end_est,
        'days': 1, 'daily': None, 'doors': None, 'show': ('Starts ' + clock(start)) if time_known else 'Time to be confirmed',
        'time_note': None if time_known else 'Ticketmaster has not published a start time yet.',
        'crowd': crowd, 'ticket': {'seller': 'Ticketmaster', 'url': e.get('url') or '', 'price': price or 'See Ticketmaster'},
        'source': {'name': 'Ticketmaster', 'url': e.get('url') or 'https://www.ticketmaster.co.za'},
        'organiser': {'name': promoter or 'See the Ticketmaster listing', 'note': 'Ask the promoter or venue about media accreditation.'},
        'status': 'on-sale' if code == 'onsale' else 'tbc',
        'access': 'accreditation' if big else 'ticket',
        'access_note': ('Large venues usually ban professional cameras without the promoter\'s accreditation. Arrivals outside the venue are open.'
                        if big else 'Ticketed event; ask the venue before photographing inside.'),
        'tags': [t for t in [segment, genre] if t and t != 'Undefined'][:3],
        'f': {'concert': {'glam': 3, 'celebs': 3, 'spend': 4}, 'sport': {'glam': 2, 'celebs': 2, 'spend': 3},
              'arts': {'glam': 3, 'celebs': 1, 'spend': 4}}.get(cat, {'glam': 2, 'celebs': 1, 'spend': 3}),
        'outdoor': False, 'minors': False,
        'tips': 'Listed automatically from Ticketmaster. Check the camera rules, then plan to shoot arrivals and queues.',
        'origin': 'ticketmaster',
    }


# ---------------- Quicket ----------------
def from_quicket(key):
    out, raw_seen, shape = [], 0, ''
    for page in range(1, 16):
        q = urllib.parse.urlencode({'api_key': key, 'pageSize': 100, 'page': page})
        data = get_json('https://api.quicket.co.za/api/events?' + q)
        items = data.get('results') if isinstance(data, dict) else data
        if not isinstance(items, list):
            raise ValueError('Unexpected response shape: ' + ', '.join(sorted(data.keys()))[:120] if isinstance(data, dict) else 'not a list')
        if items and not shape:
            shape = ', '.join(sorted(items[0].keys()))[:200]
        raw_seen += len(items)
        for e in items:
            row = map_quicket(e)
            if row:
                out.append(row)
        pages = data.get('pages') if isinstance(data, dict) else None
        if not items or (pages and page >= pages):
            break
    out.sort(key=lambda r: r['starts_at'])
    return out[:150], raw_seen, shape


QUICKET_CATS = [('graduat', 'graduation'), ('music', 'concert'), ('concert', 'concert'), ('festival', 'festival'), ('party', 'festival'), ('nightlife', 'festival'),
                ('sport', 'sport'), ('fitness', 'sport'), ('business', 'business'), ('conference', 'business'), ('expo', 'business'),
                ('tech', 'business'), ('fashion', 'glam'), ('award', 'glam'), ('gala', 'glam'), ('arts', 'arts'), ('theatre', 'arts'),
                ('comedy', 'arts'), ('film', 'arts'), ('family', 'festive'), ('kids', 'festive'), ('christmas', 'festive')]


def map_quicket(e):
    if not isinstance(e, dict):
        return None
    name = (e.get('name') or '').strip()
    if len(name) < 3:
        return None
    start, end = parse_dt(e.get('startDate')), parse_dt(e.get('endDate'))
    if not start or start > NOW + timedelta(days=HORIZON_DAYS):
        return None
    end_est = not end or end <= start
    if end_est:
        end = start + timedelta(hours=4)
    if end < NOW or (end - start) > timedelta(days=MAX_EVENT_DAYS):
        return None
    venue = e.get('venue') or {}
    loc = e.get('locality') or {}
    vname = (venue.get('name') or '').strip()
    if re.search(r'\bonline\b|\bvirtual\b|\bzoom\b', (vname + ' ' + name).lower()):
        return None
    country = str(loc.get('levelOne') or '')
    if country and 'south africa' not in country.lower():
        return None
    addr = ', '.join(str(p).strip() for p in [venue.get('addressLine1'), venue.get('addressLine2')] if p)
    city = city_of(loc.get('levelThree'), addr, vname) or city_of(loc.get('levelTwo'))
    if not city:
        return None
    cats = ' '.join(str((c or {}).get('name') or '') for c in (e.get('categories') or []) if isinstance(c, dict)).lower()
    cat = next((v for k, v in QUICKET_CATS if k in cats or k in name.lower()), 'festival')
    org = e.get('organiser') or {}
    organiser = {'name': (org.get('name') or '').strip() or 'See the Quicket listing'}
    phone = org.get('phone') or org.get('mobile')
    if phone:
        organiser['phone'] = str(phone)
    if str(org.get('pageUrl') or '').startswith('http'):
        organiser['website'] = org['pageUrl']
    prices = [t.get('price') for t in (e.get('tickets') or []) if isinstance(t, dict) and isinstance(t.get('price'), (int, float))]
    price = 'Free' if prices and max(prices) == 0 else ('From R{:,.0f}'.format(min(p for p in prices if p > 0)) if any(p > 0 for p in prices) else 'See Quicket')
    days = max(1, (end.astimezone(SAST).date() - start.astimezone(SAST).date()).days + (0 if clock(end) == '00:00' else 1))
    days = 1 if (end - start) <= timedelta(hours=20) else days
    url = e.get('url') or ''
    return {
        'id': 'qk-' + str(e.get('id')), 'name': name[:140], 'cat': cat, 'city': city, 'venue': vname or 'Venue on the listing',
        'area': str(loc.get('levelThree') or ''), 'address': addr or city, 'starts_at': start, 'ends_at': end, 'end_est': end_est,
        'days': days, 'daily': ('From ' + clock(start) + ' daily') if days > 1 else None, 'doors': None,
        'show': None if days > 1 else 'Starts ' + clock(start), 'time_note': None,
        'crowd': {'basis': 'estimate', 'size': 'small', 'note': 'Quicket listing; no attendance figure published'},
        'ticket': {'seller': 'Quicket', 'url': url, 'price': price}, 'source': {'name': 'Quicket', 'url': url or 'https://www.quicket.co.za'},
        'organiser': organiser, 'status': 'free' if price == 'Free' else 'on-sale', 'access': 'ticket',
        'access_note': 'Smaller organiser-run event: message the organiser, they often welcome a photographer.',
        'tags': [str((c or {}).get('name')) for c in (e.get('categories') or []) if isinstance(c, dict) and c.get('name')][:3],
        'f': {'glam': 2, 'celebs': 0, 'spend': 2}, 'outdoor': False, 'minors': cat in ('festive', 'graduation'),
        'tips': 'Listed automatically from Quicket. Contact the organiser first and offer guests a QR gallery.',
        'origin': 'quicket',
    }


# ---------------- Database ----------------
COLS = ['id', 'name', 'cat', 'city', 'venue', 'area', 'address', 'starts_at', 'ends_at', 'end_est', 'days', 'daily', 'doors', 'show',
        'time_note', 'crowd', 'ticket', 'source', 'organiser', 'status', 'access', 'access_note', 'tags', 'f', 'outdoor', 'minors',
        'tips', 'origin']
JSON_COLS = {'crowd', 'ticket', 'source', 'organiser', 'f'}


def upsert(cur, rows):
    added = updated = 0
    sql = ('insert into public.events (' + ', '.join(COLS) + ', checked_at) values (' + ', '.join(['%s'] * len(COLS)) + ', now()) '
           'on conflict (id) do update set ' + ', '.join(c + ' = excluded.' + c for c in COLS if c != 'id') +
           ', checked_at = now() returning (xmax = 0)')
    for r in rows:
        cur.execute(sql, [Jsonb(r[c]) if c in JSON_COLS else r[c] for c in COLS])
        if cur.fetchone()[0]:
            added += 1
        else:
            updated += 1
    return added, updated


def main():
    url = os.environ.get('SUPABASE_DB_URL', '').strip()
    if not url:
        print('SUPABASE_DB_URL is not set; nothing to do.')
        return 1
    sources, added, updated, removed = [], 0, 0, 0
    with psycopg.connect(url, autocommit=True, prepare_threshold=None) as conn:
        cur = conn.cursor()
        for name in ('schema.sql', 'seed.sql'):
            cur.execute((ROOT / 'supabase' / name).read_text())
            print('applied', name)
        cur.execute("select name, starts_at, city from public.events where origin not in ('ticketmaster', 'quicket') and ends_at > now() - interval '1 day'")
        curated = cur.fetchall()
        kept_feed = []
        feeds = [('Ticketmaster South Africa', 'ticketmaster', 'TICKETMASTER_API_KEY', from_ticketmaster),
                 ('Quicket', 'quicket', 'QUICKET_API_KEY', from_quicket)]
        for label, origin, env, fetch in feeds:
            key = os.environ.get(env, '').strip()
            entry = {'name': label, 'kind': 'feed', 'status': 'ok', 'found': 0, 'note': ''}
            sources.append(entry)
            if not key:
                entry.update(status='skipped', note='No API key saved yet')
                continue
            try:
                result = fetch(key)
                rows = result[0] if isinstance(result, tuple) else result
                if isinstance(result, tuple):
                    entry['note'] = '{} listings read'.format(result[1])
                    if not rows and result[2]:
                        entry['note'] += '; fields: ' + result[2]
                fresh = [r for r in rows
                         if not any(same_event(r['name'], r['starts_at'], r['city'], n, s, c) for n, s, c in curated)
                         and not any(same_event(r['name'], r['starts_at'], r['city'], k['name'], k['starts_at'], k['city']) for k in kept_feed)]
                kept_feed.extend(fresh)
                a, u = upsert(cur, fresh)
                added += a
                updated += u
                entry['found'] = len(fresh)
                ids = [r['id'] for r in fresh]
                if rows:
                    cur.execute('delete from public.events where origin = %s and not (id = any(%s::text[]))', [origin, ids])
                    removed += cur.rowcount
                else:
                    cur.execute("delete from public.events where origin = %s and ends_at < now() - interval '2 days'", [origin])
                    removed += cur.rowcount
            except urllib.error.HTTPError as ex:
                entry.update(status='failed', note='HTTP {} from the feed'.format(ex.code))
            except Exception as ex:  # one bad feed must not stop the run
                entry.update(status='failed', note=(type(ex).__name__ + ': ' + str(ex))[:180])
            print(label, entry['status'], entry['found'], entry['note'])
        cur.execute("select count(*) from public.events where origin = 'user' and ends_at > now()")
        sources.append({'name': 'Added by users in the app', 'kind': 'users', 'status': 'ok', 'found': cur.fetchone()[0], 'note': ''})
        cur.execute("select count(*) from public.events where origin = 'research' and ends_at > now()")
        sources.append({'name': 'Researched listings (see the latest research run)', 'kind': 'research', 'status': 'ok',
                        'found': cur.fetchone()[0], 'note': 'Upcoming events currently held from research'})
        cur.execute('insert into public.refresh_runs (kind, sources, added, updated, removed) values (%s, %s, %s, %s, %s)',
                    ['feeds', Jsonb(sources), added, updated, removed])
        cur.execute("delete from public.refresh_runs where ran_at < now() - interval '60 days'")
    print('done: added', added, 'updated', updated, 'removed', removed)
    return 0


if __name__ == '__main__':
    sys.exit(main())
