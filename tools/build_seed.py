"""Builds supabase/seed.sql and js/demo-data.js from tools/events.json.

Run: python3 tools/build_seed.py
Edit tools/events.json to add or correct events, then run this and paste seed.sql into Supabase.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
events = json.loads((ROOT / 'tools' / 'events.json').read_text())


def q(v):
    if v is None:
        return 'null'
    if isinstance(v, bool):
        return 'true' if v else 'false'
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def qj(v):
    return q(json.dumps(v or {}, ensure_ascii=False)) + '::jsonb'


def qarr(v):
    return 'array[' + ','.join(q(x) for x in (v or [])) + ']::text[]'


def ts(s):
    return q(s + ':00+02:00') + '::timestamptz'


cols = ['id', 'name', 'cat', 'city', 'venue', 'area', 'address', 'starts_at', 'ends_at', 'end_est', 'days', 'daily',
        'doors', 'show', 'time_note', 'crowd', 'ticket', 'source', 'organiser', 'status', 'access', 'access_note',
        'tags', 'f', 'outdoor', 'minors', 'tips']
rows = []
demo = []
for e in events:
    vals = [q(e['id']), q(e['name']), q(e['cat']), q(e['city']), q(e['venue']), q(e.get('area', '')),
            q(e.get('address', '')), ts(e['start']), ts(e['end']), q(bool(e.get('endEst'))), q(e.get('days', 1)),
            q(e.get('daily')), q(e.get('doors')), q(e.get('show')), q(e.get('timeNote')), qj(e.get('crowd')),
            qj(e.get('ticket')), qj(e.get('source')), qj(e.get('organiser')), q(e.get('status', 'on-sale')),
            q(e.get('access', 'ticket')), q(e.get('accessNote')), qarr(e.get('tags')), qj(e.get('f')),
            q(bool(e.get('outdoor'))), q(bool(e.get('minors'))), q(e.get('tips'))]
    rows.append('(' + ', '.join(vals) + ')')
    demo.append({
        'id': e['id'], 'name': e['name'], 'cat': e['cat'], 'city': e['city'], 'venue': e['venue'],
        'area': e.get('area', ''), 'address': e.get('address', ''),
        'starts_at': e['start'] + ':00+02:00', 'ends_at': e['end'] + ':00+02:00', 'end_est': bool(e.get('endEst')),
        'days': e.get('days', 1), 'daily': e.get('daily'), 'doors': e.get('doors'), 'show': e.get('show'),
        'time_note': e.get('timeNote'), 'crowd': e.get('crowd') or {}, 'ticket': e.get('ticket') or {},
        'source': e.get('source') or {}, 'organiser': e.get('organiser') or {}, 'status': e.get('status', 'on-sale'),
        'access': e.get('access', 'ticket'), 'access_note': e.get('accessNote'), 'tags': e.get('tags') or [],
        'f': e.get('f') or {}, 'outdoor': bool(e.get('outdoor')), 'minors': bool(e.get('minors')),
        'tips': e.get('tips'), 'created_by': None})

sql = ['-- ShootRadar pilot: event list. Run after schema.sql. Safe to run again: it refreshes these events.',
       'insert into public.events (' + ', '.join(cols) + ') values',
       ',\n'.join(rows),
       'on conflict (id) do update set ' + ', '.join(c + ' = excluded.' + c for c in cols if c != 'id') + ';', '']
(ROOT / 'supabase' / 'seed.sql').write_text('\n'.join(sql))
(ROOT / 'js' / 'demo-data.js').write_text('window.SR_DEMO_EVENTS = ' + json.dumps(demo, ensure_ascii=False) + ';\n')
print(len(events), 'events written')
