/* ShootRadar pilot: screens and behaviour. Data access lives in api.js. */
(function () {
  'use strict';
  var api = window.SR_API, cfg = window.SR_CONFIG || {}, total = window.SR_TOTAL;
  var TZ = 'Africa/Johannesburg';
  var CITIES = ['Johannesburg', 'Pretoria', 'Sun City', 'Cape Town', 'Durban'];
  var COORDS = { 'Johannesburg': [-26.2041, 28.0473], 'Pretoria': [-25.7479, 28.2293], 'Sun City': [-25.3346, 27.0927], 'Cape Town': [-33.9249, 18.4241], 'Durban': [-29.8587, 31.0218] };
  var CATS = { concert: 'Concert', festival: 'Festival', sport: 'Sport', business: 'Business', glam: 'Glam and awards', festive: 'Festive and family', graduation: 'Graduation', arts: 'Arts and theatre' };
  var SHORT = { concert: 'Concert', festival: 'Festival', sport: 'Sport', business: 'Business', glam: 'Glam', festive: 'Festive', graduation: 'Graduation', arts: 'Arts' };
  var ACCESS = {
    open: { label: 'Free public event', cls: 'good', f: 5 },
    ticket: { label: 'Ticket needed', cls: '', f: 3 },
    accreditation: { label: 'Pro gear needs accreditation', cls: 'warn', f: 2 },
    invite: { label: 'Invite or guests only', cls: 'stop', f: 1 }
  };
  var BASIS = { capacity: 'Venue capacity', organiser: 'Organiser figure', press: 'Press report', estimate: 'Our estimate' };
  var SIZE = { small: { label: 'Small', f: 2, sort: 400 }, medium: { label: 'Medium', f: 3, sort: 2500 }, large: { label: 'Large', f: 4, sort: 10000 }, huge: { label: 'Huge', f: 5, sort: 40000 } };
  var STATUS = { 'on-sale': ['On sale', 'good'], tbc: ['Details TBC', 'warn'], verify: ['Verify first', 'warn'], free: ['Free entry', 'good'], user: ['Added by a photographer', 'hot'], submitted: ['Unverified', 'warn'] };

  var main = document.getElementById('main'), dlg = document.getElementById('dlg'), lightbox = document.getElementById('lightbox');
  var state = { events: null, eventsError: '', profile: null, city: lsGet('city', 'All'), when: 'all', cat: 'all', sort: 'soonest', q: '', timer: null, limit: 0, lbKey: null };
  function pageSize() { try { return window.matchMedia('(max-width: 640px)').matches ? 8 : 12; } catch (e) { return 12; } }
  function pad3(n) { return ('00' + n).slice(-3); }
  function slug(t) { return String(t || '').normalize('NFKD').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).map(function (w) { return w.charAt(0).toUpperCase() + w.slice(1); }).join('').slice(0, 30); }

  /* ---------- helpers ---------- */
  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function lsGet(k, d) { try { var v = localStorage.getItem('sr.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem('sr.' + k, JSON.stringify(v)); } catch (e) { /* private mode: carry on without it */ } }
  function fmt(d, o) { return new Intl.DateTimeFormat('en-GB', Object.assign({ timeZone: TZ }, o)).format(d); }
  function fmtTime(d) { return fmt(d, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }); }
  function fmtDay(d) { return fmt(d, { weekday: 'short', day: 'numeric', month: 'short' }); }
  function fmtLong(d) { return fmt(d, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); }
  function isoDay(d) { var p = {}; new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d).forEach(function (x) { p[x.type] = x.value; }); return p.year + '-' + p.month + '-' + p.day; }
  function sast(day, time) { return new Date(day + 'T' + (time || '00:00') + ':00+02:00'); }
  function money(n) { var v = Math.round(n || 0); return (v < 0 ? '-R' : 'R') + Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function hhmm(m) { m = ((Math.round(m) % 1440) + 1440) % 1440; var h = Math.floor(m / 60), mm = m % 60; return (h < 10 ? '0' : '') + h + ':' + (mm < 10 ? '0' : '') + mm; }
  function firstName(s) { return String(s || '').trim().split(/\s+/)[0] || ''; }
  function normPhone(raw) {
    var d = String(raw || '').replace(/\D/g, '');
    if (d.length === 10 && d.charAt(0) === '0') d = '27' + d.slice(1);
    if (d.length === 9 && d.charAt(0) !== '0') d = '27' + d;
    return /^27\d{9}$/.test(d) ? d : '';
  }
  function prettyPhone(raw) { var d = normPhone(raw); return d ? '+27 ' + d.slice(2, 4) + ' ' + d.slice(4, 7) + ' ' + d.slice(7) : String(raw || ''); }
  function waLink(phone, text) { return 'https://wa.me/' + (normPhone(phone) || '') + '?text=' + encodeURIComponent(text); }
  function httpUrl(u) { return /^https?:\/\//i.test(u || '') ? u : ''; }
  function baseUrl() { return location.origin + location.pathname; }
  function galleryUrl(code) { return api.mode === 'demo' ? baseUrl() + '?demo#/g/' + code : baseUrl() + '?g=' + code; }
  function orderUrl(code) { return api.mode === 'demo' ? baseUrl() + '?demo#/o/' + code : baseUrl() + '?o=' + code; }
  var toastTimer = null;
  function toast(msg) { var t = document.getElementById('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3200); }
  function copy(text, okMsg) {
    try { navigator.clipboard.writeText(text).then(function () { toast(okMsg || 'Copied.'); }, function () { toast('Could not copy. Select the text and copy it.'); }); }
    catch (e) { toast('Could not copy. Select the text and copy it.'); }
  }
  function busy(btn, on, label) { if (!btn) return; if (on) { btn.dataset.label = btn.textContent; btn.disabled = true; btn.textContent = label || 'Working...'; } else { btn.disabled = false; if (btn.dataset.label) btn.textContent = btn.dataset.label; } }
  function showDialog(html, cat) {
    dlg.innerHTML = html; if (cat) dlg.dataset.cat = cat;
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); }
    dlg.scrollTop = 0;
    var x = $('[data-close]', dlg); if (x) x.focus();
  }
  function closeDialog() { if (dlg.open && dlg.close) dlg.close(); else dlg.removeAttribute('open'); }
  dlg.addEventListener('click', function (e) { if (e.target === dlg || e.target.closest('[data-close]')) closeDialog(); });

  /* ---------- event maths ---------- */
  function S(ev) { return new Date(ev.starts_at); }
  function E(ev) { return new Date(ev.ends_at); }
  function sizeOf(ev) { var c = ev.crowd || {}; if (c.size) return c.size; var n = c.n || 0; return n < 1000 ? 'small' : n < 5000 ? 'medium' : n < 20000 ? 'large' : 'huge'; }
  function crowdSort(ev) { var c = ev.crowd || {}; return c.n || SIZE[sizeOf(ev)].sort; }
  function crowdText(ev) { var c = ev.crowd || {}; return c.text || SIZE[sizeOf(ev)].label + ' crowd'; }
  function acc(ev) { return ACCESS[ev.access] || ACCESS.ticket; }
  function score(ev) {
    var f = ev.f || {}, g = f.glam == null ? 2 : f.glam, c = f.celebs == null ? 1 : f.celebs, s = f.spend == null ? 3 : f.spend;
    return Math.round((0.30 * SIZE[sizeOf(ev)].f + 0.20 * g + 0.15 * c + 0.20 * acc(ev).f + 0.15 * s) / 5 * 100);
  }
  function scoreWord(s) { return s >= 75 ? 'Excellent' : s >= 60 ? 'Strong' : s >= 45 ? 'Fair' : 'Niche'; }
  function hours(ev) { return (E(ev) - S(ev)) / 36e5; }
  function lastDay(ev) { var e = E(ev); return fmtTime(e) === '00:00' ? new Date(e.getTime() - 60000) : e; }
  function endLabel(ev) { var t = fmtTime(E(ev)); if (t === '00:00') return 'midnight'; return t + (isoDay(E(ev)) !== isoDay(S(ev)) ? ' next day' : ''); }
  function whenText(ev) {
    if (ev.days > 1) return fmtDay(S(ev)) + ' to ' + fmtDay(lastDay(ev)) + (ev.daily ? ', ' + ev.daily : '');
    var parts = [];
    if (ev.doors) parts.push(ev.doors);
    if (ev.show) parts.push(ev.show);
    if (!parts.length) parts.push('Starts ' + fmtTime(S(ev)));
    parts.push('ends ' + (ev.end_est ? '~' : '') + endLabel(ev) + (ev.end_est ? ' (est.)' : ''));
    parts.push((Math.round(hours(ev) * 2) / 2) + ' h');
    return parts.join(', ');
  }
  function timeLines(ev) {
    var out = [];
    function add(str) {
      String(str).split(/\s\u00b7\s|;\s/).forEach(function (part) {
        part = part.trim(); if (!part) return;
        var m = part.match(/^([A-Za-z][A-Za-z \-]{1,13}?)\s+(~?\d{1,2}:\d{2})$/);
        out.push(m ? [m[1], m[2]] : ['', part]);
      });
    }
    if (ev.days > 1) { out.push(['Dates', fmtDay(S(ev)) + ' to ' + fmtDay(lastDay(ev))]); if (ev.daily) out.push(['Daily', ev.daily]); return out; }
    if (ev.doors) add(ev.doors);
    if (ev.show) add(ev.show);
    if (!out.length) out.push(['Starts', fmtTime(S(ev))]);
    out.push(['Ends', (ev.end_est ? '~' : '') + endLabel(ev) + (ev.end_est ? ' (est.)' : '')]);
    out.push(['Length', (Math.round(hours(ev) * 2) / 2) + ' hours']);
    return out;
  }
  function timesHtml(ev) { return '<ul class="times">' + timeLines(ev).map(function (l) { return l[0] ? '<li><span>' + esc(l[0]) + '</span><em>' + esc(l[1]) + '</em></li>' : '<li class="full">' + esc(l[1]) + '</li>'; }).join('') + '</ul>'; }
  function sunset(day, lat, lng) {
    var y = +day.slice(0, 4), m = +day.slice(5, 7), d = +day.slice(8, 10);
    var doy = Math.round((Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 0)) / 864e5), g = 2 * Math.PI / 365 * (doy - 1);
    var eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    var decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    var r = Math.PI / 180, cosH = Math.cos(90.833 * r) / (Math.cos(lat * r) * Math.cos(decl)) - Math.tan(lat * r) * Math.tan(decl);
    return 720 - 4 * (lng - Math.acos(Math.max(-1, Math.min(1, cosH))) / r) - eq + 120;
  }
  function lightNote(ev) { var c = COORDS[ev.city]; if (!c) return ''; var ss = sunset(isoDay(S(ev)), c[0], c[1]); return 'Sunset ' + hhmm(ss) + ', golden light from about ' + hhmm(ss - 60); }
  function upcoming(ev) { return E(ev).getTime() >= Date.now(); }
  function byId(id) { return (state.events || []).filter(function (e) { return e.id === id; })[0] || null; }

  /* ---------- events screen ---------- */
  function passes(ev, ignoreCity) {
    var now = Date.now(), s = S(ev).getTime(), e = E(ev).getTime();
    if (e < now) return false;
    // Listings longer than 10 days from feeds or users are standing offers or have faulty dates. Researched events are checked by hand.
    if (ev.origin !== 'research' && e - s > 10 * 864e5) return false;
    if (!ignoreCity && state.city !== 'All' && ev.city !== state.city) return false;
    if (state.cat !== 'all' && ev.cat !== state.cat) return false;
    if (state.when === 'week' && s > now + 7 * 864e5) return false;
    if (state.when === 'month' && s > now + 30 * 864e5) return false;
    if (state.when === 'weekend') { var w = weekend(); if (!(s < w[1] && e >= w[0])) return false; }
    if (state.q) {
      var hay = [ev.name, ev.venue, ev.area, ev.city, (ev.tags || []).join(' '), (ev.organiser || {}).name].join(' ').toLowerCase();
      if (hay.indexOf(state.q.toLowerCase()) === -1) return false;
    }
    return true;
  }
  function weekend() {
    var today = isoDay(new Date()), dow = new Date(today + 'T12:00:00Z').getUTCDay();
    var start = sast(today).getTime() + (dow === 0 ? -2 : dow === 6 ? -1 : 5 - dow) * 864e5;
    return [start, start + 3 * 864e5];
  }
  function sorted(list) {
    var a = list.slice();
    if (state.sort === 'score') a.sort(function (x, y) { return score(y) - score(x) || S(x) - S(y); });
    else if (state.sort === 'crowd') a.sort(function (x, y) { return crowdSort(y) - crowdSort(x) || S(x) - S(y); });
    else a.sort(function (x, y) { return S(x) - S(y); });
    return a;
  }
  function dots(sc) { var on = Math.round(sc / 20), h = ''; for (var i = 1; i <= 5; i++) h += '<i' + (i <= on ? ' class="on"' : '') + '></i>'; return '<span class="dots" aria-hidden="true">' + h + '</span>'; }
  function passHtml(ev) {
    var s = S(ev), sc = score(ev), st = STATUS[ev.status] || STATUS['on-sale'], o = ev.organiser || {};
    var hasContact = o.phone || o.email;
    return '<article class="pass">' +
      '<button type="button" class="rowcard" data-open="' + esc(ev.id) + '"><span class="strip" data-cat="' + esc(ev.cat) + '"></span>' +
        '<span class="d"><b>' + fmt(s, { day: 'numeric' }) + '</b><span>' + fmt(s, { month: 'short' }) + '</span><span>' + fmt(s, { weekday: 'short' }) + '</span></span>' +
        '<span class="t"><strong>' + esc(ev.name) + '</strong><small>' + esc(ev.city + ', ' + crowdText(ev).toLowerCase()) + '</small></span>' +
        '<span class="s" aria-label="Photo score ' + sc + '">' + sc + '</span></button>' +
      '<div class="band" data-cat="' + esc(ev.cat) + '"><span>' + esc(SHORT[ev.cat] || ev.cat) + '</span><span>' + esc(ev.city) + '</span></div>' +
      '<div class="pass-body">' +
        '<h3>' + esc(ev.name) + '</h3>' +
        '<div class="stamp" aria-hidden="true"><b>' + fmt(s, { day: 'numeric' }) + '</b><span>' + fmt(s, { month: 'short' }) + '</span><span>' + fmt(s, { weekday: 'short' }) + '</span></div>' +
        '<p class="where">' + esc(ev.venue) + (ev.area && ev.venue.indexOf(ev.area) === -1 ? ', ' + esc(ev.area) : '') + '</p>' +
        timesHtml(ev) +
        '<div class="facts"><span class="crowd">' + esc(crowdText(ev)) + '<small>' + esc(BASIS[(ev.crowd || {}).basis] || 'Our estimate') + '</small></span></div>' +
        '<div class="facts"><span class="pill ' + acc(ev).cls + '">' + esc(acc(ev).label) + '</span><span class="pill ' + st[1] + '">' + esc(st[0]) + '</span>' +
          (hasContact ? '<span class="pill hot">Organiser contact</span>' : '') + (ev.minors ? '<span class="pill">Under-18s likely</span>' : '') + '</div>' +
      '</div>' +
      '<div class="pass-foot"><span class="score">' + dots(sc) + '<b aria-label="Photo score ' + sc + ' out of 100">' + sc + '</b> photo score</span>' +
        '<button type="button" class="btn sm" data-open="' + esc(ev.id) + '">Open</button></div></article>';
  }
  function renderEventList() {
    var chips = $('#chips'), grid = $('#grid'), sum = $('#sum');
    if (!grid) return;
    if (state.eventsError) { grid.innerHTML = '<div class="empty">' + esc(state.eventsError) + ' <button class="btn sm line" type="button" id="retry">Try again</button></div>'; sum.innerHTML = ''; chips.innerHTML = ''; return; }
    if (!state.events) { grid.innerHTML = '<div class="empty">Loading events...</div>'; return; }
    var counts = { All: 0 };
    state.events.forEach(function (ev) { if (passes(ev, true)) { counts.All++; counts[ev.city] = (counts[ev.city] || 0) + 1; } });
    var cities = CITIES.concat(Object.keys(counts).filter(function (c) { return c !== 'All' && CITIES.indexOf(c) === -1; }));
    chips.innerHTML = ['All'].concat(cities).map(function (c) { return '<button type="button" class="chip" data-city="' + esc(c) + '" aria-pressed="' + (state.city === c) + '">' + esc(c === 'All' ? 'All cities' : c) + ' <i>' + (counts[c] || 0) + '</i></button>'; }).join('');
    var list = sorted(state.events.filter(function (ev) { return passes(ev, false); }));
    var note = state.cat === 'graduation' ? '<p class="note" style="grid-column:1/-1">Most universities graduate between March and June, so December is quiet. Many campuses appoint one official photographer and ban others near the hall: read the camera access note before you go. Know of a school or preschool graduation? Add it with the button above.</p>' : '';
    if (!state.limit) state.limit = pageSize();
    var left = list.length - state.limit;
    grid.innerHTML = note + (list.length ? list.slice(0, state.limit).map(passHtml).join('') + (left > 0 ? '<div class="more" style="grid-column:1/-1"><button type="button" class="btn line" id="more">Show more (' + left + ' left)</button></div>' : '') : '<div class="empty">No events match. Try another city or type, or add one you know about.</div>');
    var active = (state.cat !== 'all') + (state.when !== 'all') + (state.sort !== 'soonest') + (state.q ? 1 : 0), ft = $('#f-toggle'); if (ft) ft.textContent = 'Filters' + (active ? ' (' + active + ')' : '');
    var w = weekend(), wk = list.filter(function (ev) { return S(ev).getTime() < w[1] && E(ev).getTime() >= w[0]; }).length;
    var best = list.slice().sort(function (a, b) { return score(b) - score(a); })[0];
    sum.innerHTML = list.length ? '<span><b>' + list.length + '</b> events</span><span><b>' + wk + '</b> this weekend</span>' + (best ? '<span>Top photo score: <b>' + score(best) + '</b> ' + esc(best.name) + '</span>' : '') : '';
  }
  function loadEvents(force) {
    if (state.events && !force) return Promise.resolve(state.events);
    state.eventsError = '';
    return api.listEvents().then(function (rows) { state.events = rows; return rows; }, function (e) { state.eventsError = e.message; state.events = null; return []; });
  }
  function viewEvents() {
    main.innerHTML =
      '<div class="head"><div><p class="kicker">South Africa, 5 cities</p><h1>Events worth shooting</h1><p>Pick a city, open an event for times, crowd, camera rules and the organiser\'s contact details.</p></div>' +
      '<button class="btn line" type="button" id="add-event">Add an event or graduation</button></div>' +
      '<div class="filters"><div class="chips" id="chips" role="group" aria-label="City"></div>' +
      '<div class="row"><button type="button" class="btn sm line f-toggle" id="f-toggle">Filters</button></div>' +
      '<div class="frow" id="frow"><div class="sheet-head"><span>Filters</span><button type="button" class="btn sm line" data-sheet-close>Close</button></div>' +
        '<label class="f" for="f-cat">Type<select id="f-cat"><option value="all">All types</option>' + Object.keys(CATS).map(function (k) { return '<option value="' + k + '">' + CATS[k] + '</option>'; }).join('') + '</select></label>' +
        '<label class="f" for="f-when">When<select id="f-when"><option value="all">All upcoming</option><option value="weekend">This weekend</option><option value="week">Next 7 days</option><option value="month">Next 30 days</option></select></label>' +
        '<label class="f" for="f-sort">Sort<select id="f-sort"><option value="soonest">Soonest first</option><option value="score">Best photo score</option><option value="crowd">Biggest crowd</option></select></label>' +
        '<label class="f q" for="f-q">Search<input id="f-q" type="search" placeholder="Artist, venue, organiser" autocomplete="off"></label>' +
      '<div class="sheet-foot"><button type="button" class="btn wide" data-sheet-close>Show events</button></div></div></div><div class="sum" id="sum" aria-live="polite"></div><div class="passes" id="grid"></div>';
    $('#f-cat').value = state.cat; $('#f-when').value = state.when; $('#f-sort').value = state.sort; $('#f-q').value = state.q;
    renderEventList();
    loadEvents().then(renderEventList);
  }

  /* ---------- event detail ---------- */
  function pitch(ev) {
    var p = state.profile || {}, o = ev.organiser || {};
    var name = p.name || '[your name]', brand = p.brand || '[your studio]', phone = p.phone ? prettyPhone(p.phone) : '[your WhatsApp number]';
    return 'Hi ' + (o.name && !/not confirmed/i.test(o.name) ? o.name + ' team' : 'there') + ',\n\n' +
      "I'm " + name + ' of ' + brand + ', an event photographer based in ' + (p.city || 'Gauteng') + '. I would like to photograph guests at ' + ev.name + ' at ' + ev.venue + ' on ' + fmtLong(S(ev)) + '.\n\n' +
      'What I offer:\n- Same-day photos you can use on your social media, free\n- Guests find their own photos in an online gallery by scanning a QR code, with consent recorded\n- I keep walkways and stages clear and follow your media rules\n\n' +
      'Could you tell me how to apply for accreditation or permission? I can send my portfolio and ID straight away.\n\nThank you,\n' + name + '\n' + brand + '\n' + phone;
  }
  function organiserHtml(ev) {
    var o = ev.organiser || {}, site = httpUrl(o.website), src = httpUrl((ev.source || {}).url);
    var rows = '';
    if (o.phone) rows += '<dt>Phone</dt><dd><a href="tel:' + esc(String(o.phone).replace(/[^\d+]/g, '')) + '">' + esc(o.phone.charAt(0) === '+' || normPhone(o.phone) ? prettyIntl(o.phone) : o.phone) + '</a></dd>';
    if (o.email) rows += '<dt>Email</dt><dd><a href="mailto:' + esc(o.email) + '">' + esc(o.email) + '</a></dd>';
    if (site) rows += '<dt>Website</dt><dd><a href="' + esc(site) + '" target="_blank" rel="noopener">' + esc(site.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')) + '</a></dd>';
    if (!rows) rows = '<dt>Contact</dt><dd>No phone or email published yet.' + (src ? ' Use the <a href="' + esc(src) + '" target="_blank" rel="noopener">listing</a> to reach them.' : '') + '</dd>';
    return '<div class="org"><div class="row" style="justify-content:space-between"><strong>' + esc(o.name || 'Organiser not listed') + '</strong></div><dl>' + rows + '</dl>' + (o.note ? '<p class="hint">' + esc(o.note) + '</p>' : '') + '</div>';
  }
  function prettyIntl(p) { var d = String(p).replace(/\D/g, ''); if (/^27\d{9}$/.test(d)) return '+27 ' + d.slice(2, 4) + ' ' + d.slice(4, 7) + ' ' + d.slice(7); return p; }
  function barRow(label, v) { return '<div class="barrow"><span>' + label + '</span><span class="b"><i style="width:' + (v / 5 * 100) + '%"></i></span><b>' + v + '</b></div>'; }
  function openEvent(id) {
    var ev = byId(id); if (!ev) return;
    var s = S(ev), c = ev.crowd || {}, f = ev.f || {}, sc = score(ev), st = STATUS[ev.status] || STATUS['on-sale'], o = ev.organiser || {};
    var t = ev.ticket || {}, src = ev.source || {}, p = state.profile || {};
    var hrs = ev.days > 1 ? 5 : Math.max(1, Math.min(5, Math.round(hours(ev))));
    var mine = api.user() && ev.created_by === api.user().id;
    var map = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ev.venue + ', ' + (ev.address || ev.city));
    var subject = 'Photographer accreditation request: ' + ev.name + ' (' + fmtDay(s) + ')';
    showDialog(
      '<div class="dh" data-cat="' + esc(ev.cat) + '"><div><h2 id="dlg-title">' + esc(ev.name) + '</h2><p>' + esc((CATS[ev.cat] || ev.cat) + ', ' + ev.city + ', ' + st[0] + ', photo score ' + sc + ' (' + scoreWord(sc) + ')') + '</p></div><button class="dx" type="button" data-close>Close</button></div>' +
      '<div class="db">' +
        (ev.status === 'verify' || ev.status === 'submitted' ? '<p class="note">This listing has not been verified. Confirm the details with the organiser before you plan around it.</p>' : '') +
        '<div class="fg">' +
          '<div class="fact"><h4>When</h4><p>' + esc(ev.days > 1 ? fmtDay(s) + ' to ' + fmtDay(lastDay(ev)) : fmtLong(s)) + '</p>' + timesHtml(ev) + (ev.time_note ? '<p>' + esc(ev.time_note) + '</p>' : '') + '</div>' +
          '<div class="fact"><h4>Start, end, duration</h4><p>Starts ' + fmtTime(s) + ', ends ' + (ev.end_est ? 'about ' : '') + (ev.days > 1 ? fmtTime(E(ev)) + ' on the last day' : endLabel(ev)) + '</p><p>' + (ev.days > 1 ? ev.days + ' days' : (Math.round(hours(ev) * 2) / 2) + ' hours') + (ev.end_est ? ' (end time estimated)' : '') + ', times in SAST</p></div>' +
          '<div class="fact"><h4>Where</h4><p>' + esc(ev.venue) + '</p><p>' + esc(ev.address || ev.city) + ', <a href="' + esc(map) + '" target="_blank" rel="noopener">Open map</a></p></div>' +
          '<div class="fact"><h4>Crowd</h4><p>' + esc(crowdText(ev)) + '</p><p>' + esc((BASIS[c.basis] || 'Our estimate') + (c.note ? ': ' + c.note : '')) + '</p></div>' +
          '<div class="fact"><h4>Camera access</h4><p><span class="pill ' + acc(ev).cls + '">' + esc(acc(ev).label) + '</span></p><p>' + esc(ev.access_note || '') + '</p></div>' +
          '<div class="fact"><h4>Tickets</h4><p>' + esc(t.seller || 'See listing') + '</p><p>' + esc(t.price || '') + (httpUrl(t.url) ? ', <a href="' + esc(t.url) + '" target="_blank" rel="noopener">Ticket site</a>' : '') + '</p></div>' +
          '<div class="fact"><h4>Light</h4><p>' + esc(lightNote(ev)) + '</p><p>' + (ev.outdoor ? 'Outdoor event' : 'Indoor event') + '</p></div>' +
          '<div class="fact"><h4>Source</h4><p>' + (httpUrl(src.url) ? '<a href="' + esc(src.url) + '" target="_blank" rel="noopener">' + esc(src.name || 'Listing') + '</a>' : esc(src.name || 'Added in the app')) + '</p><p>' + (ev.created_by || ev.status === 'submitted' ? 'Added by a user' : 'Checked ' + esc(ev.checked_at ? fmt(new Date(ev.checked_at), { day: 'numeric', month: 'short', year: 'numeric' }) : (cfg.dataChecked || ''))) + ', <a href="#/sources" data-close>all sources</a></p></div>' +
        '</div>' +
        (ev.minors ? '<p class="note">Under-18s are likely here. Get a parent or guardian\'s consent before you photograph a child or share their photos.</p>' : '') +
        '<div class="sect"><h3>Organiser</h3>' + organiserHtml(ev) + '</div>' +
        '<div class="sect"><h3>Message to the organiser</h3><label class="f" for="pitch">Edit it, then send it<textarea id="pitch" rows="10">' + esc(pitch(ev)) + '</textarea></label>' +
          '<div class="row" style="margin-top:8px"><button type="button" class="btn sm" id="pitch-copy">Copy</button>' +
          (o.email ? '<a class="btn sm line" id="pitch-mail" href="#">Email organiser</a>' : '') +
          (normPhone(o.phone) && /^27[678]/.test(normPhone(o.phone)) ? '<a class="btn sm line" id="pitch-wa" target="_blank" rel="noopener" href="#">WhatsApp organiser</a>' : '') + '</div>' +
          (!p.name ? '<p class="hint" id="pitch-hint" style="margin-top:6px">' + (api.user() ? 'Fill in your <a href="#/profile" data-close>profile</a>' : '<a href="#/profile" data-close>Sign in</a> and fill in your profile') + ' and your name, studio and number appear here.</p>' : '') + '</div>' +
        (ev.tips ? '<div class="sect"><h3>Shoot plan</h3><p>' + esc(ev.tips) + '</p><div class="row" style="margin-top:8px">' + (ev.tags || []).map(function (x) { return '<span class="pill">' + esc(x) + '</span>'; }).join('') + '</div></div>' : '') +
        '<div class="sect"><h3>Why it scores ' + sc + '</h3><div class="bars">' + barRow('Crowd size', SIZE[sizeOf(ev)].f) + barRow('Access', acc(ev).f) + barRow('Glam', f.glam == null ? 2 : f.glam) + barRow('Celebrities', f.celebs == null ? 1 : f.celebs) + barRow('Spending power', f.spend == null ? 3 : f.spend) + '</div></div>' +
        '<div class="sect"><h3>Is it worth going?</h3><div class="calc">' +
          '<label class="f" for="k-h">Hours shooting<input type="number" id="k-h" min="1" max="16" value="' + hrs + '"></label>' +
          '<label class="f" for="k-r">People approached per hour<input type="number" id="k-r" min="0" value="12"></label>' +
          '<label class="f" for="k-b">Share who buy (%)<input type="number" id="k-b" min="0" max="100" value="20"></label>' +
          '<label class="f" for="k-s">Average sale (R)<input type="number" id="k-s" min="0" value="' + (p.price ? Math.min(p.price * 2, p.bundle || p.price * 2) : 120) + '"></label>' +
          '<label class="f" for="k-c">Your costs (R)<input type="number" id="k-c" min="0" value="350"></label></div><p id="k-out" style="margin-top:10px" aria-live="polite"></p></div>' +
        '<div class="row"><button type="button" class="btn hot" data-newgal="' + esc(ev.id) + '">Create a gallery for this event</button>' +
          '<a class="btn line" target="_blank" rel="noopener" href="' + esc(waLink('', ev.name + '\n' + fmtDay(s) + ', ' + whenText(ev) + '\n' + ev.venue + ', ' + ev.city + '\nCrowd: ' + crowdText(ev) + (httpUrl(src.url) ? '\n' + src.url : '') + '\nFound on ShootRadar')) + '">Share on WhatsApp</a>' +
          (mine ? '<button type="button" class="btn line danger" data-delevent="' + esc(ev.id) + '">Delete my event</button>' : '') + '</div>' +
      '</div>', ev.cat);
    function calc() {
      var g = function (i) { var el = $('#' + i, dlg); return el ? Math.max(0, +el.value || 0) : 0; };
      var sales = g('k-h') * g('k-r') * g('k-b') / 100, rev = sales * g('k-s'), profit = rev - g('k-c');
      $('#k-out', dlg).innerHTML = 'About <b>' + Math.round(sales) + '</b> sales, <b>' + money(rev) + '</b> revenue, <b>' + money(profit) + '</b> ' + (profit >= 0 ? 'profit' : 'loss') + '. Break-even after <b>' + (g('k-s') > 0 ? Math.ceil(g('k-c') / g('k-s')) : 0) + '</b> sales.';
    }
    calc(); $$('.calc input', dlg).forEach(function (i) { i.addEventListener('input', calc); });
    // Signed in but the profile has not loaded yet: fetch it and fill the message with the real details.
    if (api.user() && !(state.profile && state.profile.name)) {
      var before = $('#pitch', dlg).value;
      api.getProfile().then(function (pr) {
        var box = $('#pitch', dlg);
        if (!pr || !pr.name || !box || box.value !== before) return;
        state.profile = pr; box.value = pitch(ev);
        var h = $('#pitch-hint', dlg); if (h) h.remove();
      }, function () { });
    }
    $('#pitch-copy', dlg).addEventListener('click', function () { copy($('#pitch', dlg).value, 'Message copied.'); });
    var m = $('#pitch-mail', dlg); if (m) m.addEventListener('click', function () { m.href = 'mailto:' + o.email + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent($('#pitch', dlg).value); });
    var w = $('#pitch-wa', dlg); if (w) w.addEventListener('click', function () { w.href = waLink(o.phone, $('#pitch', dlg).value); });
  }

  /* ---------- add event ---------- */
  function openAdd() {
    showDialog(
      '<div class="dh"><div><h2 id="dlg-title">Add an event or graduation</h2><p>Schools, organisers and photographers can add what the ticket sites miss.</p></div><button class="dx" type="button" data-close>Close</button></div>' +
      '<form class="db" id="add-form" novalidate><div class="grid2">' +
        '<label class="f full" for="a-name">Event name<input type="text" id="a-name" maxlength="140" autocomplete="off" placeholder="e.g. Little Stars Preschool graduation"></label>' +
        '<label class="f" for="a-kind">Type<select id="a-kind"><option value="graduation:school">Graduation: preschool or school</option><option value="graduation:college">Graduation: university or college</option><option value="concert">Concert</option><option value="festival">Festival or party</option><option value="sport">Sport</option><option value="business">Business, conference or expo</option><option value="glam">Gala, awards or pageant</option><option value="festive">Festive, church or family</option></select></label>' +
        '<label class="f" for="a-city">City<select id="a-city">' + CITIES.map(function (c) { return '<option' + ((state.city !== 'All' ? state.city : (state.profile || {}).city) === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label>' +
        '<label class="f full" for="a-venue">Venue and address<input type="text" id="a-venue" autocomplete="off" placeholder="e.g. Community hall, 12 Main Rd, Soweto"></label>' +
        '<label class="f" for="a-date">Date<input type="date" id="a-date"></label>' +
        '<label class="f" for="a-size">Expected crowd<select id="a-size"><option value="small" selected>Small (under 1,000)</option><option value="medium">Medium (1,000 to 5,000)</option><option value="large">Large (5,000 to 20,000)</option><option value="huge">Huge (over 20,000)</option></select></label>' +
        '<label class="f" for="a-start">Starts<input type="time" id="a-start" value="09:00"></label>' +
        '<label class="f" for="a-end">Ends (best guess)<input type="time" id="a-end" value="12:00"></label>' +
        '<label class="f full" for="a-access">Can photographers get in?<select id="a-access"><option value="invite">Guests or invite only</option><option value="ticket">Anyone with a ticket</option><option value="open">Free public event</option><option value="accreditation">Needs accreditation</option></select></label>' +
        '<label class="f" for="a-oname">Organiser or school name<input type="text" id="a-oname" autocomplete="off"></label>' +
        '<label class="f" for="a-ophone">Organiser phone<input type="tel" id="a-ophone" autocomplete="off" placeholder="e.g. 011 555 0100"></label>' +
        '<label class="f" for="a-oemail">Organiser email<input type="email" id="a-oemail" autocomplete="off"></label>' +
        '<label class="f" for="a-link">Link to the listing<input type="url" id="a-link" placeholder="https://"></label>' +
      '</div><p class="hint">Only add an organiser\'s business contact details, not a private person\'s number.</p><p class="err" id="a-err" role="alert"></p>' +
      '<div class="row"><button class="btn hot" type="submit">Add event</button></div></form>');
    $('#add-form', dlg).addEventListener('submit', function (e) {
      e.preventDefault();
      var v = function (i) { return $('#' + i, dlg).value.trim(); };
      var name = v('a-name'), date = v('a-date'), st = v('a-start') || '09:00', en = v('a-end') || '12:00', link = v('a-link'), email = v('a-oemail');
      var err = name.length < 3 ? 'Give the event a name.' : !date ? 'Choose the date.' : (link && !httpUrl(link)) ? 'The link must start with https://' : (email && !/^\S+@\S+\.\S+$/.test(email)) ? 'That email address does not look right.' : '';
      $('#a-err', dlg).textContent = err; if (err) return;
      var start = sast(date, st), end = sast(date, en); if (end <= start) end = new Date(end.getTime() + 864e5);
      var kind = v('a-kind').split(':'), cat = kind[0], school = kind[1] === 'school', college = kind[1] === 'college';
      var row = {
        name: name, cat: cat, city: v('a-city'), venue: v('a-venue') || 'Venue to be confirmed', area: '', address: v('a-venue') || v('a-city'),
        starts_at: start.toISOString(), ends_at: end.toISOString(), end_est: true, days: 1,
        crowd: { basis: 'estimate', size: v('a-size'), note: 'Estimate from the person who added it' },
        ticket: { seller: link ? 'See listing' : 'Not given', url: link, price: '' }, source: { name: link ? 'Listing' : 'Added in the app', url: link },
        organiser: { name: v('a-oname'), phone: v('a-ophone'), email: email, website: '' },
        access: v('a-access'), access_note: 'Added by a user. Confirm camera rules with the organiser.',
        tags: cat === 'graduation' ? [school ? 'School or preschool' : 'University or college', 'Families', 'Gowns'] : ['Added by a user'],
        f: cat === 'graduation' ? { glam: 4, celebs: 0, spend: school ? 3 : 4 } : { glam: 2, celebs: 1, spend: 3 },
        outdoor: false, minors: school, tips: school ? 'Agree the shoot with the school first, and get each parent\'s consent before you photograph or share a child\'s photos.' : 'Confirm access with the organiser, then create a gallery so guests can find their photos.'
      };
      var btn = $('button[type="submit"]', dlg); busy(btn, true, 'Adding...');
      api.addEvent(row).then(function () { closeDialog(); toast('Event added. Thank you.'); state.city = row.city; lsSet('city', row.city); return loadEvents(true); }).then(function () { if (currentRoute().name === 'events') renderEventList(); },
        function (er) { busy(btn, false); $('#a-err', dlg).textContent = er.message; });
    });
  }

  /* ---------- sign in ---------- */
  function authPanel(intro) {
    return '<div class="panel" style="max-width:460px"><h2>Sign in</h2><p class="hint">' + esc(intro) + '</p>' +
      '<form id="auth-form" class="stack" novalidate>' +
        '<label class="f" for="au-email">Email<input type="email" id="au-email" autocomplete="email"></label>' +
        '<label class="f" for="au-pass">Password (8 characters or more)<input type="password" id="au-pass" autocomplete="current-password"></label>' +
        '<p class="err" id="au-err" role="alert"></p>' +
        '<div class="row"><button class="btn hot" type="submit" data-mode="in">Sign in</button><button class="btn line" type="submit" data-mode="up">Create account</button></div></form></div>';
  }
  function bindAuth() {
    var form = $('#auth-form'); if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var mode = (e.submitter && e.submitter.dataset.mode) || 'in', email = $('#au-email').value.trim(), pass = $('#au-pass').value, errEl = $('#au-err');
      var err = !/^\S+@\S+\.\S+$/.test(email) ? 'Enter your email address.' : pass.length < 8 ? 'Use a password of 8 characters or more.' : '';
      errEl.textContent = err; if (err) return;
      busy(e.submitter, true);
      (mode === 'up' ? api.signUp(email, pass) : api.signIn(email, pass)).then(function (r) {
        if (r && r.needsConfirm) { busy(e.submitter, false); errEl.style.color = 'var(--leaf)'; errEl.textContent = 'Account created. Open the confirmation email we sent you, then sign in here.'; return; }
        return afterAuth().then(route);
      }, function (er) { busy(e.submitter, false); errEl.style.color = ''; errEl.textContent = er.message; });
    });
  }
  function afterAuth() {
    if (!api.user()) { state.profile = null; return Promise.resolve(); }
    return api.getProfile().then(function (p) { state.profile = p; }, function () { state.profile = null; });
  }

  /* ---------- profile ---------- */
  function viewProfile() {
    if (!api.user()) { main.innerHTML = '<div class="head"><div><h1>Profile</h1></div></div>' + authPanel('Photographers sign in to create galleries. Browsing events needs no account.'); bindAuth(); return; }
    var p = state.profile || { price: 60, bundle: 150, city: 'Johannesburg' };
    main.innerHTML = '<div class="head"><div><h1>Profile</h1><p>These details appear on your galleries, watermarks and messages.</p></div><button class="btn line" type="button" id="signout">Sign out</button></div>' +
      '<div class="cols"><form class="panel" id="prof" novalidate><h2>Your details</h2><div class="grid2">' +
        '<label class="f" for="p-name">Your name<input type="text" id="p-name" autocomplete="name" value="' + esc(p.name) + '"></label>' +
        '<label class="f" for="p-brand">Studio or brand (on watermarks)<input type="text" id="p-brand" value="' + esc(p.brand) + '"></label>' +
        '<label class="f" for="p-phone">Your WhatsApp number<input type="tel" id="p-phone" autocomplete="tel" placeholder="e.g. 072 555 0101" value="' + esc(p.phone) + '"></label>' +
        '<label class="f" for="p-city">Home city<select id="p-city">' + CITIES.map(function (c) { return '<option' + (p.city === c ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label>' +
        '<label class="f full" for="p-pay">Payment link (Yoco, SnapScan, PayFast or similar)<input type="url" id="p-pay" placeholder="https://" value="' + esc(p.pay_link) + '"></label>' +
        '<label class="f" for="p-price">Price per photo (R)<input type="number" id="p-price" min="0" step="5" value="' + esc(p.price) + '"></label>' +
        '<label class="f" for="p-bundle">All photos, one client (R)<input type="number" id="p-bundle" min="0" step="5" value="' + esc(p.bundle) + '"></label>' +
      '</div><p class="err" id="p-err" role="alert"></p><div class="row"><button class="btn hot" type="submit">Save profile</button><span class="hint">Signed in as ' + esc(api.user().email || '') + '</span></div></form>' +
      '<div class="panel"><h2>How the pilot works</h2><ol class="steps">' +
        '<li><div><b>Find an event</b><span>Filter by city, check the camera rules and contact the organiser.</span></div></li>' +
        '<li><div><b>Create a gallery</b><span>You get a QR code. Print it or show it on your phone at the shoot.</span></div></li>' +
        '<li><div><b>Upload after the shoot</b><span>Photos are watermarked and numbered on your phone before they upload.</span></div></li>' +
        '<li><div><b>Clients pick and pay</b><span>They scan, tick their photos and pay you with your own link, EFT or cash.</span></div></li>' +
        '<li><div><b>Mark as paid</b><span>The clean photos unlock on the client\'s page for 14 days.</span></div></li></ol>' +
        '<p class="hint">The pilot is free and has room for roughly 1,500 photos in total across all photographers. Delete old galleries to free space.</p></div></div>';
    $('#signout').addEventListener('click', function () { api.signOut().then(function () { state.profile = null; route(); }); });
    $('#prof').addEventListener('submit', function (e) {
      e.preventDefault();
      var pay = $('#p-pay').value.trim(), phone = $('#p-phone').value.trim();
      var err = !$('#p-name').value.trim() ? 'Enter your name.' : !normPhone(phone) ? 'Enter a South African mobile number, for example 072 555 0101.' : (pay && !/^https:\/\//i.test(pay)) ? 'The payment link must start with https://' : '';
      $('#p-err').textContent = err; if (err) return;
      var btn = $('#prof button[type="submit"]'); busy(btn, true, 'Saving...');
      api.saveProfile({ name: $('#p-name').value.trim(), brand: $('#p-brand').value.trim(), phone: normPhone(phone), pay_link: pay, price: Math.max(0, Math.round(+$('#p-price').value || 0)), bundle: Math.max(0, Math.round(+$('#p-bundle').value || 0)), city: $('#p-city').value })
        .then(function (row) { state.profile = row; busy(btn, false); toast('Profile saved.'); }, function (er) { busy(btn, false); $('#p-err').textContent = er.message; });
    });
  }

  /* ---------- galleries ---------- */
  function viewGalleries() {
    if (!api.user()) { main.innerHTML = '<div class="head"><div><h1>My galleries</h1><p>A gallery is where clients find and request their photos after scanning your QR code.</p></div></div>' + authPanel('Sign in or create a free account to make your first gallery.'); bindAuth(); return; }
    main.innerHTML = '<div class="head"><div><h1>My galleries</h1><p>One gallery per shoot. Clients scan its QR code, pick their photos and pay you directly.</p></div><button class="btn hot" type="button" id="new-gal">New gallery</button></div>' +
      (!(state.profile && normPhone(state.profile.phone)) ? '<p class="note" style="margin-bottom:14px">Add your name and WhatsApp number on the <a href="#/profile">Profile</a> tab first, so clients can reach you.</p>' : '') +
      '<div class="tiles" id="gal-tiles"></div><div class="stack" id="gal-list"><div class="empty">Loading...</div></div>';
    $('#new-gal').addEventListener('click', function () { openNewGallery(null); });
    api.listGalleries().then(function (list) {
      var photos = 0, orders = 0, paid = 0, rev = 0;
      list.forEach(function (g) { photos += g.photo_count; g.order_list.forEach(function (o) { orders++; if (o.status !== 'requested') { paid++; rev += o.amount; } }); });
      $('#gal-tiles').innerHTML = '<div class="tile"><span>Galleries</span><b>' + list.length + '</b></div><div class="tile"><span>Photos</span><b>' + photos + '</b></div><div class="tile"><span>Paid orders</span><b>' + paid + ' / ' + orders + '</b></div><div class="tile"><span>Revenue</span><b>' + money(rev) + '</b></div>';
      $('#gal-list').innerHTML = list.length ? list.map(function (g) {
        var req = g.order_list.filter(function (o) { return o.status === 'requested'; }).length;
        return '<article class="gal"><div class="row" style="justify-content:space-between"><h3>' + esc(g.title) + '</h3><span class="pill mono">' + esc(g.code) + '</span></div>' +
          '<div class="meta"><span>' + (g.event_date ? esc(fmtDay(sast(g.event_date, '12:00'))) : 'No date') + '</span><span>Photos <b>' + g.photo_count + '</b></span><span>Requests <b>' + g.order_list.length + '</b></span>' + (req ? '<span class="pill hot">' + req + ' waiting for payment</span>' : '') + (g.kids ? '<span class="pill warn">Children\'s event</span>' : '') + '</div>' +
          '<div class="row"><a class="btn sm" href="#/gallery/' + esc(g.id) + '">Manage</a><a class="btn sm line" href="' + esc(galleryUrl(g.code)) + '" target="_blank" rel="noopener">View as client</a></div></article>';
      }).join('') : '<div class="empty">No galleries yet. Create one before your next shoot, then print or show its QR code.</div>';
    }, function (e) { $('#gal-list').innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
  }
  function openNewGallery(eventId) {
    if (!api.user()) { closeDialog(); location.hash = '#/galleries'; toast('Sign in to create a gallery.'); return; }
    var p = state.profile || {}, now = Date.now();
    var evs = (state.events || []).filter(function (e) { return E(e).getTime() > now - 3 * 864e5; }).sort(function (a, b) { return S(a) - S(b); });
    showDialog('<div class="dh"><div><h2 id="dlg-title">New gallery</h2><p>You get a QR code as soon as it is created.</p></div><button class="dx" type="button" data-close>Close</button></div>' +
      '<form class="db" id="gal-form" novalidate><div class="grid2">' +
        '<label class="f full" for="g-event">Event<select id="g-event"><option value="">Another event (type the name below)</option>' + evs.map(function (e) { return '<option value="' + esc(e.id) + '"' + (e.id === eventId ? ' selected' : '') + '>' + esc(fmtDay(S(e)) + ', ' + e.name) + '</option>'; }).join('') + '</select></label>' +
        '<label class="f full" for="g-title">Gallery name (clients see this)<input type="text" id="g-title" maxlength="90"></label>' +
        '<label class="f" for="g-date">Shoot date<input type="date" id="g-date"></label><span></span>' +
        '<label class="f" for="g-price">Price per photo (R)<input type="number" id="g-price" min="0" step="5" value="' + esc(p.price == null ? 60 : p.price) + '"></label>' +
        '<label class="f" for="g-bundle">All of one client\'s photos (R)<input type="number" id="g-bundle" min="0" step="5" value="' + esc(p.bundle == null ? 150 : p.bundle) + '"></label>' +
      '</div><label class="check" for="g-kids"><input type="checkbox" id="g-kids"> This is a children\'s event (preschool, school, kids\' party)</label>' +
      '<div id="g-kidbox" hidden class="stack"><p class="note">Anyone with this gallery\'s QR code or link can see every watermarked photo in it. Share it only with the parents, and do not post the link publicly.</p>' +
        '<label class="check" for="g-guard"><input type="checkbox" id="g-guard"> The school and each child\'s parent or guardian have agreed to the photos and to this shared gallery</label></div>' +
      '<p class="err" id="g-err" role="alert"></p><div class="row"><button class="btn hot" type="submit">Create gallery</button></div></form>');
    function fill() { var ev = byId($('#g-event', dlg).value); if (ev) { $('#g-title', dlg).value = ev.name.slice(0, 90); $('#g-date', dlg).value = isoDay(S(ev)); if (ev.minors && ev.cat === 'graduation') { $('#g-kids', dlg).checked = true; $('#g-kidbox', dlg).hidden = false; } } }
    if (!$('#g-date', dlg).value) $('#g-date', dlg).value = isoDay(new Date());
    fill();
    $('#g-event', dlg).addEventListener('change', fill);
    $('#g-kids', dlg).addEventListener('change', function (e) { $('#g-kidbox', dlg).hidden = !e.target.checked; });
    $('#gal-form', dlg).addEventListener('submit', function (e) {
      e.preventDefault();
      var title = $('#g-title', dlg).value.trim(), kids = $('#g-kids', dlg).checked, guard = $('#g-guard', dlg).checked;
      var err = title.length < 3 ? 'Give the gallery a name.' : (kids && !guard) ? 'For a children\'s event, confirm that the school and parents have agreed.' : '';
      $('#g-err', dlg).textContent = err; if (err) return;
      var btn = $('button[type="submit"]', dlg); busy(btn, true, 'Creating...');
      api.createGallery({ event_id: $('#g-event', dlg).value || null, title: title, event_date: $('#g-date', dlg).value || null, kids: kids, guardian_ok: kids && guard, price: Math.max(0, Math.round(+$('#g-price', dlg).value || 0)), bundle: Math.max(0, Math.round(+$('#g-bundle', dlg).value || 0)) })
        .then(function (g) { closeDialog(); location.hash = '#/gallery/' + g.id; }, function (er) { busy(btn, false); $('#g-err', dlg).textContent = er.message; });
    });
  }

  /* ---------- image processing (on the photographer's device) ---------- */
  function loadImage(file) {
    if (window.createImageBitmap) return createImageBitmap(file, { imageOrientation: 'from-image' }).then(function (b) { return { el: b, w: b.width, h: b.height, done: function () { if (b.close) b.close(); } }; }, function () { return viaTag(file); });
    return viaTag(file);
  }
  function viaTag(file) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () { res({ el: img, w: img.naturalWidth, h: img.naturalHeight, done: function () { URL.revokeObjectURL(url); } }); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('Could not read ' + file.name)); };
      img.src = url;
    });
  }
  function draw(src, max) { var k = Math.min(1, max / Math.max(src.w, src.h)), w = Math.max(1, Math.round(src.w * k)), h = Math.max(1, Math.round(src.h * k)), cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').drawImage(src.el, 0, 0, w, h); return cv; }
  function toBlob(cv, q) { return new Promise(function (res, rej) { cv.toBlob(function (b) { b ? res(b) : rej(new Error('Could not process the photo.')); }, 'image/jpeg', q); }); }
  function makeVersions(file, brand, seq) {
    return loadImage(file).then(function (src) {
      var full = draw(src, 2000), pv = draw(src, 1000); src.done();
      var g = pv.getContext('2d'), w = pv.width, h = pv.height, fs = Math.max(13, Math.round(Math.max(w, h) / 24)), mark = (brand || 'ShootRadar') + '  /  PREVIEW  /  #' + seq;
      g.save(); g.translate(w / 2, h / 2); g.rotate(-Math.PI / 7);
      g.font = '600 ' + fs + 'px "Instrument Sans", Arial, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.4)'; g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = Math.max(1, fs / 16);
      var tw = g.measureText(mark).width + fs * 2, span = Math.max(w, h) * 1.2;
      for (var y = -span; y <= span; y += fs * 3.2) for (var x = -span; x <= span; x += tw) { g.strokeText(mark, x, y); g.fillText(mark, x, y); }
      g.restore();
      return Promise.all([toBlob(pv, 0.72), toBlob(full, 0.86)]).then(function (b) { return { preview: b[0], full: b[1], w: w, h: h, seq: seq }; });
    });
  }

  /* ---------- gallery admin ---------- */
  function viewGalleryAdmin(id) {
    if (!api.user()) { location.hash = '#/galleries'; return; }
    main.innerHTML = '<div class="empty">Loading gallery...</div>';
    var data = null;
    function refresh() { return api.getGalleryAdmin(id).then(function (d) { data = d; paint(); }, function (e) { main.innerHTML = '<div class="empty">' + esc(e.message) + ' <a href="#/galleries">Back to galleries</a></div>'; }); }
    function orderHtml(o) {
      var seqs = data.photos.filter(function (p) { return o.photo_ids.indexOf(p.id) !== -1; }).map(function (p) { return '#' + p.seq; });
      var paid = o.status !== 'requested', g = data.gallery, pr = state.profile || {}, link = orderUrl(o.code);
      var payMsg = 'Hi ' + firstName(o.client_name) + '! Your ' + seqs.length + ' photo' + (seqs.length === 1 ? '' : 's') + ' from ' + g.title + ' ' + (seqs.length === 1 ? 'is' : 'are') + ' reserved (order ' + o.code + ').\nTotal: R' + o.amount + '.\n' + (pr.pay_link ? 'Pay here: ' + pr.pay_link + '\n' : '') + 'Use reference ' + o.code + '. Once you have paid, your clean photos unlock here: ' + link;
      var doneMsg = 'Thank you, ' + firstName(o.client_name) + '! Payment received for order ' + o.code + '. Download your photos here (the link works for 14 days): ' + link + '\nThey are for your personal use; please tag ' + (pr.brand || pr.name || 'me') + ' when you post them.';
      return '<div class="order" data-order="' + esc(o.id) + '"><div class="order-top"><h4>' + esc(o.client_name) + '</h4><span class="row"><span class="pill mono">' + esc(o.code) + '</span><span class="pill ' + (o.status === 'requested' ? 'warn">Waiting for payment' : o.status === 'paid' ? 'good">Paid' : 'good">Delivered') + '</span></span></div>' +
        '<p class="hint">' + (o.client_phone ? 'WhatsApp ' + esc(prettyPhone(o.client_phone)) + ', ' : '') + esc(seqs.length + ' photo' + (seqs.length === 1 ? '' : 's') + ': ' + seqs.join(', ')) + (o.guardian ? ', guardian: ' + esc(o.guardian) : '') + '</p>' +
        '<div class="row"><span class="pill ' + (o.portfolio ? 'good">Portfolio use OK' : '">No portfolio use') + '</span><span class="pill ' + (o.offers ? 'good">Wants offers' : '">No marketing') + '</span></div>' +
        '<div class="row"><label class="vh" for="amt-' + esc(o.id) + '">Amount in rand</label><input class="amt" type="number" min="0" id="amt-' + esc(o.id) + '" value="' + esc(o.amount) + '">' +
          (paid ? '' : '<button type="button" class="btn sm hot" data-paid="' + esc(o.id) + '">Mark as paid</button>') +
          '<a class="btn sm line" target="_blank" rel="noopener" href="' + esc(waLink(o.client_phone, paid ? doneMsg : payMsg)) + '">' + (paid ? 'Send download link' : 'Send payment message') + '</a>' +
          (o.status === 'paid' ? '<button type="button" class="btn sm line" data-delivered="' + esc(o.id) + '">Mark delivered</button>' : '') +
          (paid ? '<button type="button" class="btn sm line" data-relink="' + esc(o.id) + '">Renew download links</button>' : '') +
          '<button type="button" class="btn sm line danger" data-delorder="' + esc(o.id) + '">Remove</button></div></div>';
    }
    function paint() {
      var g = data.gallery, url = galleryUrl(g.code), bytes = data.photos.reduce(function (s, p) { return s + (p.bytes || 0); }, 0);
      var paidOrders = data.orders.filter(function (o) { return o.status !== 'requested'; });
      main.innerHTML = '<p style="margin-bottom:10px"><a href="#/galleries">&larr; All galleries</a></p>' +
        '<div class="head"><div><p class="kicker">Gallery ' + esc(g.code) + (g.kids ? ', children\'s event' : '') + '</p><h1>' + esc(g.title) + '</h1><p>' + (g.event_date ? esc(fmtLong(sast(g.event_date, '12:00'))) + ', ' : '') + 'R' + g.price + ' per photo' + (g.bundle ? ', R' + g.bundle + ' for all of one client\'s photos' : '') + '</p></div></div>' +
        '<div class="tiles"><div class="tile"><span>Photos</span><b>' + data.photos.length + '</b></div><div class="tile"><span>Requests</span><b>' + data.orders.length + '</b></div><div class="tile"><span>Paid</span><b>' + paidOrders.length + '</b></div><div class="tile"><span>Revenue</span><b>' + money(paidOrders.reduce(function (s, o) { return s + o.amount; }, 0)) + '</b></div></div>' +
        '<div class="cols"><div class="stack"><div class="panel"><h2>Share with clients</h2><div class="qrbox"><div class="qr" id="qr"></div><strong>' + esc(g.code) + '</strong><small>Scan to find your photos</small></div>' +
          '<div class="linkbox" id="g-link">' + esc(url) + '</div><div class="row"><button type="button" class="btn sm" id="copy-link">Copy link</button><button type="button" class="btn sm line" id="poster">Save QR poster</button>' +
          '<a class="btn sm line" target="_blank" rel="noopener" href="' + esc(waLink('', 'Your photos from ' + g.title + ' are here. Tick the ones you want: ' + url)) + '">Share on WhatsApp</a></div>' +
          (g.kids ? '<p class="note">Children\'s gallery: share this code only with the parents.</p>' : '') + '</div>' +
          '<div class="panel"><h2>Danger zone</h2><p class="hint">Deleting removes the photos and requests for good and frees space.</p><div><button type="button" class="btn sm line danger" id="del-gal">Delete this gallery</button></div></div></div>' +
        '<div class="stack"><div class="panel"><div class="row" style="justify-content:space-between"><h2>Photos</h2><label class="btn hot sm" for="up" style="position:relative;overflow:hidden">Add photos<input type="file" id="up" accept="image/*" multiple style="position:absolute;inset:0;opacity:0;cursor:pointer"></label></div>' +
          '<div id="up-state" hidden><div class="progress"><i id="up-bar"></i></div><p class="hint" id="up-text" style="margin-top:6px"></p></div>' +
          (data.photos.length ? '<div class="thumbs">' + data.photos.map(function (p) { return '<div class="thumb"><img loading="lazy" src="' + esc(api.previewUrl(p.preview_path)) + '" alt="Photo ' + p.seq + '"><span class="n">#' + p.seq + '</span><button type="button" class="x" data-delphoto="' + esc(p.id) + '" aria-label="Delete photo ' + p.seq + '">Delete</button></div>'; }).join('') + '</div><p class="hint">' + (bytes / 1048576).toFixed(1) + ' MB used by this gallery.</p>' : '<div class="empty">No photos yet. After the shoot, add them here: each one is resized, numbered and watermarked on this device, then uploaded.</div>') + '</div>' +
          '<div class="panel"><div class="row" style="justify-content:space-between"><h2>Client requests</h2><button type="button" class="btn sm line" id="reload">Refresh</button></div>' +
          (data.orders.length ? data.orders.map(orderHtml).join('') : '<div class="empty">No requests yet. When a client picks photos, their request appears here with their WhatsApp number.</div>') + '</div></div></div>';
      try { new window.QRCode($('#qr'), { text: url, width: 196, height: 196, colorDark: '#111111', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M }); } catch (e) { $('#qr').textContent = 'QR unavailable'; }
    }
    function find(list, oid) { return list.filter(function (x) { return x.id === oid; })[0]; }
    function nameFor(p) { var pr = state.profile || {}; return [slug(pr.brand || pr.name) || 'ShootRadar', slug(data.gallery.title), pad3(p.seq)].filter(Boolean).join('-') + '.jpg'; }
    main.onclick = function (e) {
      var t = e.target.closest('button'); if (!t || !data) return;
      if (t.id === 'copy-link') copy(galleryUrl(data.gallery.code), 'Gallery link copied.');
      else if (t.id === 'reload') refresh().then(function () { toast('Up to date.'); });
      else if (t.id === 'poster') savePoster(data.gallery);
      else if (t.id === 'del-gal') { if (t.dataset.sure) { busy(t, true, 'Deleting...'); api.deleteGallery(id).then(function () { toast('Gallery deleted.'); location.hash = '#/galleries'; }, function (er) { busy(t, false); toast(er.message); }); } else { t.dataset.sure = '1'; t.textContent = 'Tap again to delete everything'; } }
      else if (t.dataset.delphoto) { if (t.dataset.sure) { api.deletePhoto(find(data.photos, t.dataset.delphoto)).then(refresh, function (er) { toast(er.message); }); } else { t.dataset.sure = '1'; t.textContent = 'Sure?'; } }
      else if (t.dataset.paid) { var o = find(data.orders, t.dataset.paid), amt = Math.max(0, Math.round(+$('#amt-' + o.id).value || 0)); busy(t, true, 'Unlocking...'); api.markPaid(o, amt, data.photos, nameFor).then(function () { toast('Marked as paid. The client\'s photos are unlocked.'); return refresh(); }, function (er) { busy(t, false); toast(er.message); }); }
      else if (t.dataset.relink) { var ro = find(data.orders, t.dataset.relink); busy(t, true, 'Renewing...'); api.markPaid(ro, ro.amount, data.photos, nameFor).then(function () { toast('New download links are ready for 14 days.'); return refresh(); }, function (er) { busy(t, false); toast(er.message); }); }
      else if (t.dataset.delivered) api.setOrderStatus(find(data.orders, t.dataset.delivered), 'delivered').then(refresh, function (er) { toast(er.message); });
      else if (t.dataset.delorder) { if (t.dataset.sure) api.deleteOrder(find(data.orders, t.dataset.delorder)).then(refresh, function (er) { toast(er.message); }); else { t.dataset.sure = '1'; t.textContent = 'Tap again to remove'; } }
    };
    main.onchange = function (e) {
      if (e.target.id !== 'up' || !data) return;
      var files = Array.prototype.slice.call(e.target.files || []).filter(function (f) { return /^image\//.test(f.type); });
      if (!files.length) return;
      var seq = data.photos.reduce(function (m, p) { return Math.max(m, p.seq); }, 0), done = 0, failed = 0, brand = (state.profile || {}).brand || (state.profile || {}).name;
      $('#up-state').hidden = false;
      var chain = Promise.resolve();
      files.forEach(function (file) {
        chain = chain.then(function () {
          seq++; $('#up-text').textContent = 'Uploading ' + (done + failed + 1) + ' of ' + files.length + '...';
          return makeVersions(file, brand, seq).then(function (v) { return api.uploadPhoto(data.gallery, v); }).then(function () { done++; }, function () { failed++; seq--; })
            .then(function () { $('#up-bar').style.width = Math.round((done + failed) / files.length * 100) + '%'; });
        });
      });
      chain.then(function () { toast(done + ' photo' + (done === 1 ? '' : 's') + ' added' + (failed ? ', ' + failed + ' failed' : '') + '.'); return refresh(); });
    };
    refresh();
  }
  function savePoster(g) {
    var holder = document.createElement('div'), p = state.profile || {};
    try { new window.QRCode(holder, { text: galleryUrl(g.code), width: 560, height: 560, colorDark: '#111111', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M }); } catch (e) { toast('Could not make the poster.'); return; }
    var qr = holder.querySelector('canvas'), cv = document.createElement('canvas'); cv.width = 800; cv.height = 1100;
    var c = cv.getContext('2d'); c.fillStyle = '#ffffff'; c.fillRect(0, 0, 800, 1100); c.fillStyle = '#1b1814'; c.fillRect(0, 0, 800, 150);
    c.fillStyle = '#ffffff'; c.font = '800 54px "Bricolage Grotesque", Arial, sans-serif'; c.textAlign = 'center'; c.fillText('FIND YOUR PHOTOS', 400, 95);
    c.fillStyle = '#1b1814'; c.font = '600 32px "Instrument Sans", Arial, sans-serif'; c.fillText(g.title.length > 40 ? g.title.slice(0, 39) + '…' : g.title, 400, 215);
    if (qr) c.drawImage(qr, 120, 260, 560, 560);
    c.font = '500 30px Arial, sans-serif'; c.fillText('1. Scan   2. Tick your photos   3. Pay   4. Download', 400, 890);
    c.font = '700 56px "Spline Sans Mono", monospace'; c.fillText(g.code, 400, 975);
    c.fillStyle = '#635b50'; c.font = '400 24px Arial, sans-serif'; c.fillText([p.brand || p.name, p.phone ? prettyPhone(p.phone) : ''].filter(Boolean).join('     '), 400, 1040);
    cv.toBlob(function (b) { if (!b) return; var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'shootradar-' + g.code + '.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000); }, 'image/png');
  }

  /* ---------- client: gallery ---------- */
  function viewClientGallery(code) {
    main.innerHTML = '<div class="empty">Opening gallery...</div>';
    var picked = lsGet('pick.' + code, []), data = null;
    api.getGallery(code).then(function (d) {
      if (!d) { main.innerHTML = '<div class="empty">We could not find a gallery with the code ' + esc(code) + '. Check the code on the photographer\'s card and try again.</div>'; return; }
      data = d; picked = picked.filter(function (pid) { return d.photos.some(function (p) { return p.id === pid; }); });
      var g = d.gallery, ph = d.photographer;
      document.title = g.title + ', ShootRadar';
      main.innerHTML = '<div class="ghead"><p class="kicker" style="color:inherit;opacity:.75">Photos by ' + esc(ph.brand || ph.name || 'your photographer') + '</p><h1>' + esc(g.title) + '</h1>' +
        '<p>' + (g.event_date ? esc(fmtLong(sast(g.event_date, '12:00'))) + ', ' : '') + 'R' + g.price + ' per photo' + (g.bundle ? ', R' + g.bundle + ' for all of yours' : '') + '</p></div>' +
        '<div id="mybar"></div><details class="findbox"><summary>Already requested or paid? Find your order</summary><form id="find" novalidate><label class="f" for="fo-phone">Your WhatsApp number<input type="tel" id="fo-phone" autocomplete="tel" placeholder="e.g. 082 123 4567"></label><label class="f" for="fo-code">Order code<input type="text" id="fo-code" autocomplete="off" placeholder="e.g. SR-4ND2ZX"></label><button class="btn" type="submit">Find order</button></form><p class="err" id="fo-err" role="alert"></p><p class="hint">The code is in the WhatsApp message from your photographer.</p></details>' +
        (d.photos.length ? '<p class="hint" style="margin-bottom:12px">Find yourself, tap the circle on each photo you want, then press Request. Previews carry a watermark; the photos you pay for are clean.</p><div class="pgrid" id="pgrid">' +
          d.photos.map(function (p, i) { return '<div class="ph" data-pid="' + esc(p.id) + '"><button type="button" class="open" data-view="' + i + '" aria-label="View photo ' + p.seq + '"><img loading="lazy" src="' + esc(api.previewUrl(p.path)) + '" alt="Photo ' + p.seq + '"></button><span class="n">#' + p.seq + '</span><button type="button" class="pick" data-pick="' + esc(p.id) + '" aria-pressed="false" aria-label="Select photo ' + p.seq + '">+</button></div>'; }).join('') + '</div>' +
          '<div class="cart" id="cart"><div><b id="cart-n"></b><span id="cart-t"></span></div><button type="button" class="btn hot" id="cart-go">Request photos</button></div>'
          : '<div class="empty">The photographer has not uploaded photos yet. Keep this page and check again later' + (normPhone(ph.phone) ? ', or <a target="_blank" rel="noopener" href="' + esc(waLink(ph.phone, 'Hi, I was photographed at ' + g.title + '. Are the photos up yet? Gallery ' + g.code)) + '">message them on WhatsApp</a>' : '') + '.</div>');
      sync(); loadMine();
    }, function (e) { main.innerHTML = '<div class="empty">' + esc(e.message) + '</div>'; });
    // Orders made on this phone: show a way back to them and mark their photos so nobody pays twice.
    function loadMine() {
      var list = myOrders().filter(function (x) { return !x.g || x.g === data.gallery.code; }).slice(0, 6);
      if (!list.length) return;
      Promise.all(list.map(function (x) { return api.getOrder(x.code).then(function (o) { return o; }, function () { return null; }); })).then(function (orders) {
        if (currentRoute().name !== 'gallery-client' || !data) return;
        orders = orders.filter(function (o) { return o && o.gallery.code === data.gallery.code; });
        if (!orders.length) return;
        var bar = $('#mybar'); if (!bar) return;
        bar.innerHTML = '<div class="mybar"><strong>Your orders on this phone:</strong>' + orders.map(function (o) { return '<a class="btn sm ' + (o.status === 'requested' ? 'line' : 'hot') + '" href="#/o/' + esc(o.code) + '">' + esc(o.code) + ', ' + (o.status === 'requested' ? 'waiting for payment' : 'download') + '</a>'; }).join('') + '</div>';
        orders.forEach(function (o) {
          o.photos.forEach(function (p) {
            var el = $('.ph[data-pid="' + p.id + '"]', main), b = el && $('.pick', el); if (!b) return;
            var tag = document.createElement('span'); tag.className = 'bought'; tag.textContent = o.status === 'requested' ? 'Requested' : 'Bought'; b.replaceWith(tag);
            var i = picked.indexOf(p.id); if (i !== -1) picked.splice(i, 1);
          });
        });
        sync();
      });
    }
    function sync() {
      if (!data || !data.photos.length) return;
      $$('.ph', main).forEach(function (el) { var on = picked.indexOf(el.dataset.pid) !== -1; el.classList.toggle('on', on); var b = $('.pick', el); if (!b) return; b.setAttribute('aria-pressed', on); b.textContent = on ? '\u2713' : '+'; });
      var n = picked.length;
      $('#cart-n').textContent = n ? n + ' photo' + (n === 1 ? '' : 's') + ', ' + money(total(n, data.gallery.price, data.gallery.bundle)) : 'No photos selected';
      $('#cart-t').textContent = n ? 'You pay the photographer directly' : 'Tap the circle on a photo to select it';
      $('#cart-go').disabled = !n;
      lsSet('pick.' + code, picked);
      if (!lightbox.hidden) paintLightbox();
    }
    function taken(pid) { var el = $('.ph[data-pid="' + pid + '"]', main); return el && !$('.pick', el); }
    function toggle(pid) { if (taken(pid)) { toast('You already requested this photo.'); return; } var i = picked.indexOf(pid); if (i === -1) { if (picked.length >= 60) { toast('You can request up to 60 photos at once.'); return; } picked.push(pid); } else picked.splice(i, 1); sync(); }
    var at = 0;
    function paintLightbox() {
      var p = data.photos[at], on = picked.indexOf(p.id) !== -1, got = taken(p.id);
      lightbox.innerHTML = '<div class="stage"><img src="' + esc(api.previewUrl(p.path)) + '" alt="Photo ' + p.seq + '"></div><div class="bar"><button type="button" class="btn sm line" data-lb="prev"' + (at === 0 ? ' disabled' : '') + '>Back</button><span class="mono">#' + p.seq + '</span>' +
        (got ? '<span class="pill good">Already yours</span>' : '<button type="button" class="btn sm ' + (on ? 'line' : 'hot') + '" data-lb="pick">' + (on ? 'Selected \u2713' : 'Select') + '</button>') + '<button type="button" class="btn sm line" data-lb="next"' + (at === data.photos.length - 1 ? ' disabled' : '') + '>Next</button><button type="button" class="btn sm line" data-lb="close">Close</button></div>';
    }
    lightbox.onclick = function (e) {
      var b = e.target.closest('[data-lb]'); if (!b) { if (e.target === lightbox || e.target.classList.contains('stage')) lightbox.hidden = true; return; }
      var a = b.dataset.lb;
      if (a === 'close') lightbox.hidden = true; else if (a === 'prev') { at--; paintLightbox(); } else if (a === 'next') { at++; paintLightbox(); } else if (a === 'pick') toggle(data.photos[at].id);
    };
    main.onclick = function (e) {
      var t = e.target.closest('button'); if (!t || !data) return;
      if (t.dataset.pick) toggle(t.dataset.pick);
      else if (t.dataset.view) { at = +t.dataset.view; lightbox.hidden = false; paintLightbox(); }
      else if (t.id === 'cart-go') openRequest();
    };
    main.onchange = null;
    // Swipe left or right, or use the arrow keys, to move between photos.
    function step(d) { var n = at + d; if (!data || n < 0 || n >= data.photos.length) return; at = n; paintLightbox(); }
    state.lbStep = step;
    state.lbKey = function (k) { if (k === 'ArrowRight') step(1); else if (k === 'ArrowLeft') step(-1); };
    main.onsubmit = function (e) {
      if (e.target.id !== 'find') return;
      e.preventDefault();
      var phone = normPhone($('#fo-phone').value), oc = $('#fo-code').value.trim(), errEl = $('#fo-err'), btn = $('#find button');
      var err = !phone ? 'Enter the WhatsApp number you used, for example 082 123 4567.' : oc.length < 6 ? 'Enter your order code, for example SR-4ND2ZX.' : '';
      errEl.textContent = err; if (err) return;
      busy(btn, true, 'Looking...');
      api.findOrder(oc, phone).then(function (found) {
        busy(btn, false);
        if (!found) { errEl.textContent = 'No order matches that number and code. Check the code in your photographer\'s WhatsApp message.'; return; }
        rememberOrder(found, data ? data.gallery.code : ''); location.hash = '#/o/' + found;
      }, function (er) { busy(btn, false); errEl.textContent = er.message; });
    };
    function openRequest() {
      var g = data.gallery, n = picked.length, saved = lsGet('client', {});
      showDialog('<div class="dh"><div><h2 id="dlg-title">Request ' + n + ' photo' + (n === 1 ? '' : 's') + '</h2><p>' + esc(money(total(n, g.price, g.bundle)) + ', paid directly to the photographer') + '</p></div><button class="dx" type="button" data-close>Close</button></div>' +
        '<form class="db" id="req" novalidate><label class="f" for="r-name">Your name<input type="text" id="r-name" autocomplete="name" maxlength="80" value="' + esc(saved.name || '') + '"></label>' +
        '<label class="f" for="r-phone">Your WhatsApp number<input type="tel" id="r-phone" autocomplete="tel" placeholder="e.g. 082 123 4567" value="' + esc(saved.phone || '') + '"></label>' +
        (g.kids ? '<label class="f" for="r-guard">Parent or guardian\'s full name<input type="text" id="r-guard" maxlength="80"></label>' : '') +
        '<label class="check" for="r-consent"><input type="checkbox" id="r-consent"> ' + (g.kids ? 'I am the parent or guardian of the child in these photos, and I agree that the photographer may contact me on WhatsApp about this order' : 'These photos are of me or my group, and I agree that the photographer may contact me on WhatsApp about this order') + ' (required)</label>' +
        '<label class="check" for="r-port"><input type="checkbox" id="r-port"> The photographer may use these photos in their portfolio and adverts</label>' +
        '<label class="check" for="r-offers"><input type="checkbox" id="r-offers"> Send me offers for future events</label>' +
        '<p class="err" id="r-err" role="alert"></p><div class="row"><button class="btn hot" type="submit">Send request</button></div></form>');
      $('#req', dlg).addEventListener('submit', function (e) {
        e.preventDefault();
        var name = $('#r-name', dlg).value.trim(), phone = normPhone($('#r-phone', dlg).value), guard = g.kids ? $('#r-guard', dlg).value.trim() : '';
        var err = name.length < 2 ? 'Enter your name.' : !phone ? 'Enter a South African mobile number, for example 082 123 4567.' : (g.kids && guard.length < 2) ? 'Enter the parent or guardian\'s name.' : !$('#r-consent', dlg).checked ? 'Please tick the first box to continue.' : '';
        $('#r-err', dlg).textContent = err; if (err) return;
        var btn = $('button[type="submit"]', dlg); busy(btn, true, 'Sending...');
        lsSet('client', { name: name, phone: $('#r-phone', dlg).value.trim() });
        api.createOrder({ code: g.code, name: name, phone: phone, photoIds: picked.slice(), consent: true, portfolio: $('#r-port', dlg).checked, offers: $('#r-offers', dlg).checked, guardian: guard })
          .then(function (oc) { lsSet('pick.' + code, []); rememberOrder(oc, g.code); closeDialog(); location.hash = '#/o/' + oc; }, function (er) { busy(btn, false); $('#r-err', dlg).textContent = er.message; });
      });
    }
  }

  function myOrders() { return lsGet('orders', []).map(function (x) { return typeof x === 'string' ? { code: x, g: '' } : x; }).filter(function (x) { return x && x.code; }); }
  function rememberOrder(code, g) { var list = myOrders().filter(function (x) { return x.code !== code; }); list.unshift({ code: code, g: g }); lsSet('orders', list.slice(0, 20)); }

  /* ---------- client: order ---------- */
  function viewClientOrder(code) {
    main.innerHTML = '<div class="empty">Opening your order...</div>';
    function load(quiet) {
      return api.getOrder(code).then(function (o) {
        if (currentRoute().name !== 'order') return;
        if (!o) { main.innerHTML = '<div class="empty">We could not find order ' + esc(code) + '.</div>'; return; }
        var ph = o.photographer, paid = o.status !== 'requested', seqs = o.photos.map(function (p) { return '#' + p.seq; });
        var msg = 'Hi ' + firstName(ph.name) + ", it's " + o.client_name + '. I requested ' + o.photos.length + ' photo' + (o.photos.length === 1 ? '' : 's') + ' from ' + o.gallery.title + ' (' + seqs.join(', ') + '). My order code is ' + o.code + ' and the total is R' + o.amount + '. ' + (paid ? 'Thank you!' : 'How would you like me to pay?');
        document.title = 'Order ' + o.code + ', ShootRadar';
        main.innerHTML = '<div class="ghead"><p class="kicker" style="color:inherit;opacity:.75">Order ' + esc(o.code) + '</p><h1>' + (paid ? 'Your photos are ready' : 'Request sent') + '</h1><p>' + esc(o.gallery.title + ', ' + o.photos.length + ' photo' + (o.photos.length === 1 ? '' : 's') + ', ' + money(o.amount)) + '</p></div>' +
          '<div class="cols"><div class="panel"><h2>What happens next</h2><ol class="steps">' +
            '<li class="done"><div><b>Request sent</b><span>' + esc(ph.brand || ph.name || 'The photographer') + ' can see your photos and number.</span></div></li>' +
            '<li class="' + (paid ? 'done' : 'now') + '"><div><b>Pay ' + esc(money(o.amount)) + '</b><span>Use reference ' + esc(o.code) + '. You pay the photographer directly.</span></div></li>' +
            '<li class="' + (paid ? 'now' : '') + '"><div><b>Download</b><span>' + (paid ? 'Your clean photos are below.' : 'Your clean photos appear on this page once the photographer confirms payment.') + '</span></div></li></ol>' +
            (paid ? '' : '<div class="row">' + (/^https:\/\//i.test(ph.pay_link) ? '<a class="btn hot" target="_blank" rel="noopener" href="' + esc(ph.pay_link) + '">Pay now</a>' : '') +
              (normPhone(ph.phone) ? '<a class="btn' + (/^https:\/\//i.test(ph.pay_link) ? ' line' : ' hot') + '" target="_blank" rel="noopener" href="' + esc(waLink(ph.phone, msg)) + '">Message the photographer</a>' : '') +
              '<button type="button" class="btn line" id="again">Check again</button></div><p class="hint">Keep this page: save the link or screenshot your order code. ' + (normPhone(ph.phone) ? 'Photographer: ' + esc(prettyPhone(ph.phone)) + '.' : '') + '</p>') +
            '<div class="row"><a class="btn sm line" href="#/g/' + esc(o.gallery.code) + '">Back to the gallery</a><button type="button" class="btn sm line" id="copy-order">Copy order link</button></div></div>' +
          '<div class="panel"><h2>' + (paid ? 'Download your photos' : 'Your selection') + '</h2>' +
            (paid ? (o.downloads.length ? '<div class="thumbs">' + o.photos.map(function (p) { var d = o.downloads.filter(function (x) { return x.seq === p.seq; })[0]; return '<div class="thumb"><img loading="lazy" src="' + esc(api.previewUrl(p.path)) + '" alt="Photo ' + p.seq + '"><span class="n">#' + p.seq + '</span>' + (d ? '<a class="x dl" style="text-decoration:none;top:auto;bottom:4px" href="' + esc(d.url) + '" download="' + esc(d.name || 'photo-' + p.seq + '.jpg') + '">Download</a>' : '') + '</div>'; }).join('') + '</div><div class="row"><button type="button" class="btn hot" id="dl-all">Download all ' + o.downloads.length + '</button></div><p class="hint">Photos save to your Downloads folder. If your phone asks to allow several downloads, say yes. The links work for 14 days and the photos are for your personal use.</p>' : '<div class="empty">The download links have expired. Ask the photographer to mark the order as paid again.</div>')
              : '<div class="thumbs">' + o.photos.map(function (p) { return '<div class="thumb"><img loading="lazy" src="' + esc(api.previewUrl(p.path)) + '" alt="Photo ' + p.seq + '"><span class="n">#' + p.seq + '</span></div>'; }).join('') + '</div>') + '</div></div>';
        var again = $('#again'); if (again) again.addEventListener('click', function () { busy(again, true, 'Checking...'); load(false).then(function () { if (!quiet) toast('Checked just now.'); }); });
        var all = $('#dl-all'); if (all) all.addEventListener('click', function () {
          var links = $$('a.dl', main); all.disabled = true;
          links.forEach(function (a, i) { setTimeout(function () { a.click(); if (i === links.length - 1) { all.disabled = false; toast('Downloads started.'); } }, i * 900); });
        });
        rememberOrder(o.code, o.gallery.code);
        $('#copy-order').addEventListener('click', function () { copy(orderUrl(o.code), 'Order link copied.'); });
        clearTimeout(state.timer);
        if (!paid) state.timer = setTimeout(function () { if (currentRoute().name === 'order' && !dlg.open) load(true); }, 10000);
      }, function (e) { if (!quiet) main.innerHTML = '<div class="empty">' + esc(e.message) + ' <a href="' + esc(orderUrl(code)) + '">Try again</a></div>'; });
    }
    main.onclick = null; main.onchange = null;
    load(false);
  }

  /* ---------- data sources ---------- */
  var PLAN = [
    ['Checked every day', 'A job runs at about 05:10 and reads these feeds directly.', ['Ticketmaster South Africa (includes Big Concerts shows)', 'Quicket']],
    ['Researched every week', 'Listings without a feed are searched and read, and new events are added with a link to the source.',
      ['Ticket sellers: Webtickets, Howler, Ticketpro, Blu Blood, Computicket (partial: no public feed)', 'City listings: Gauteng Tourism, Time Out Johannesburg, Cape Town and Durban, What\'s On in Joburg, Bizcommunity',
        'Venues: SunBet Arena, Sandton Convention Centre, FNB Stadium, CTICC, GrandWest, DHL Stadium, Durban ICC, Moses Mabhida, Kirstenbosch, Sun City',
        'Sport: SA Rugby and URC fixtures, PSL, Cricket South Africa', 'Graduations: Wits, UJ, UP, Unisa, TUT, UCT, UWC, CPUT, UKZN, DUT']],
    ['Added by people', 'Photographers, schools and organisers add events in the app. These show as Unverified or Added by a photographer.', ['The "Add an event or graduation" button']]
  ];
  function runDate(r) { return fmt(new Date(r.ran_at), { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + fmtTime(new Date(r.ran_at)); }
  function loadRuns() { return api.listRuns().then(function (runs) { state.runs = runs; paintFooter(); return runs; }, function () { state.runs = state.runs || []; return state.runs; }); }
  function paintFooter() {
    var el = document.getElementById('foot-data'), last = (state.runs || [])[0];
    el.innerHTML = (last ? 'Events last refreshed on ' + esc(runDate(last)) + '. ' : 'Event details were checked on ' + esc(cfg.dataChecked || 'a recent date') + '. ') +
      'Each event links to its source; plans change, so confirm with the organiser before you travel. <a href="#/sources">Data sources and refresh log</a>';
  }
  function viewSources() {
    main.innerHTML = '<div class="head"><div><p class="kicker">Where the events come from</p><h1>Data sources</h1><p>What ShootRadar checks, how often, and what the last refreshes found.</p></div></div>' +
      '<div class="cols"><div class="stack">' + PLAN.map(function (g) { return '<div class="panel"><h2>' + esc(g[0]) + '</h2><p class="hint">' + esc(g[1]) + '</p><ul class="srclist">' + g[2].map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>'; }).join('') + '</div>' +
      '<div class="panel"><h2>Refresh log</h2><div id="runs" class="stack"><div class="empty">Loading...</div></div></div></div>';
    loadRuns().then(function (runs) {
      var box = document.getElementById('runs'); if (!box) return;
      box.innerHTML = runs.length ? runs.map(function (r) {
        return '<div class="order"><div class="order-top"><h4>' + esc(runDate(r)) + '</h4><span class="pill ' + (r.kind === 'feeds' ? 'good">Daily feeds' : 'hot">Weekly research') + '</span></div>' +
          '<p class="hint">' + r.added + ' added, ' + r.updated + ' updated, ' + r.removed + ' removed</p><table class="srctable"><tbody>' +
          (r.sources || []).map(function (x) { return '<tr><td>' + esc(x.name) + '</td><td><span class="pill ' + (x.status === 'ok' ? 'good">Checked' : x.status === 'skipped' ? 'warn">Skipped' : 'stop">Failed') + '</span></td><td class="mono">' + esc(x.found == null ? '' : x.found) + '</td></tr>' + (x.note ? '<tr><td colspan="3" class="hint">' + esc(x.note) + '</td></tr>' : ''); }).join('') + '</tbody></table></div>';
      }).join('') : '<div class="empty">No refresh has been recorded yet.</div>';
    });
  }

  /* ---------- router ---------- */
  function currentRoute() {
    var h = (location.hash || '').replace(/^#\/?/, ''), parts = h.split('/').filter(Boolean);
    if (parts[0] === 'g' && parts[1]) return { name: 'gallery-client', arg: decodeURIComponent(parts[1]).toUpperCase() };
    if (parts[0] === 'o' && parts[1]) return { name: 'order', arg: decodeURIComponent(parts[1]).toUpperCase() };
    if (parts[0] === 'gallery' && parts[1]) return { name: 'gallery-admin', arg: parts[1] };
    if (parts[0] === 'galleries') return { name: 'galleries' };
    if (parts[0] === 'profile') return { name: 'profile' };
    if (parts[0] === 'sources') return { name: 'sources' };
    return { name: 'events' };
  }
  function route() {
    var r = currentRoute(), client = r.name === 'gallery-client' || r.name === 'order';
    clearTimeout(state.timer); lightbox.hidden = true; if (dlg.open) closeDialog();
    main.onclick = null; main.onchange = null; main.onsubmit = null; state.lbKey = null; state.lbStep = null;
    document.body.classList.toggle('client', client);
    var logo = $('.logo'); if (logo) { if (client) { logo.removeAttribute('href'); logo.setAttribute('tabindex', '-1'); } else { logo.setAttribute('href', '#/events'); logo.removeAttribute('tabindex'); } }
    document.title = 'ShootRadar';
    $$('#nav a').forEach(function (a) { var on = a.dataset.nav === (r.name === 'gallery-admin' ? 'galleries' : r.name); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    if (r.name === 'events') viewEvents();
    else if (r.name === 'galleries') viewGalleries();
    else if (r.name === 'gallery-admin') viewGalleryAdmin(r.arg);
    else if (r.name === 'profile') viewProfile();
    else if (r.name === 'sources') viewSources();
    else if (r.name === 'gallery-client') viewClientGallery(r.arg);
    else viewClientOrder(r.arg);
    window.scrollTo(0, 0);
  }

  /* ---------- global listeners ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target.closest('button, a'); if (!t) return;
    if (t.dataset.city) { state.city = t.dataset.city; state.limit = 0; lsSet('city', state.city); renderEventList(); var again = $('#chips [aria-pressed="true"]'); if (again) again.focus(); }
    else if (t.dataset.open) openEvent(t.dataset.open);
    else if (t.id === 'add-event') openAdd();
    else if (t.id === 'more') { state.limit += pageSize(); renderEventList(); }
    else if (t.id === 'f-toggle') { var fr = $('#frow'); if (fr) fr.classList.add('open'); }
    else if (t.hasAttribute('data-sheet-close')) { var fr2 = $('#frow'); if (fr2) fr2.classList.remove('open'); }
    else if (t.id === 'theme') cycleTheme();
    else if (t.classList.contains('js-install')) { if (installEvt) { installEvt.prompt(); installEvt = null; $$('.js-install').forEach(function (b) { b.hidden = true; }); } }
    else if (t.id === 'retry') loadEvents(true).then(renderEventList);
    else if (t.dataset.newgal) openNewGallery(t.dataset.newgal);
    else if (t.dataset.delevent) { if (t.dataset.sure) api.deleteEvent(t.dataset.delevent).then(function () { closeDialog(); toast('Event deleted.'); return loadEvents(true); }).then(renderEventList, function (er) { toast(er.message); }); else { t.dataset.sure = '1'; t.textContent = 'Tap again to delete'; } }
  });
  document.addEventListener('input', function (e) { if (e.target.id === 'f-q') { state.q = e.target.value.trim(); state.limit = 0; renderEventList(); } });
  document.addEventListener('change', function (e) {
    var id = e.target.id;
    if (id === 'f-cat') state.cat = e.target.value; else if (id === 'f-when') state.when = e.target.value; else if (id === 'f-sort') state.sort = e.target.value; else return;
    state.limit = 0; renderEventList();
  });
  document.addEventListener('keydown', function (e) { if (lightbox.hidden) return; if (e.key === 'Escape') lightbox.hidden = true; else if (state.lbKey) state.lbKey(e.key); });
  var sx = 0, sy = 0;
  lightbox.addEventListener('touchstart', function (e) { var t = e.changedTouches[0]; sx = t.clientX; sy = t.clientY; }, { passive: true });
  lightbox.addEventListener('touchend', function (e) { var t = e.changedTouches[0], dx = t.clientX - sx, dy = t.clientY - sy; if (state.lbStep && Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.5) state.lbStep(dx < 0 ? 1 : -1); }, { passive: true });
  var installEvt = null;
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; $$('.js-install').forEach(function (b) { b.hidden = false; }); });
  var THEMES = ['system', 'light', 'dark'];
  function paintTheme() { var t = lsGet('theme', 'system'), b = document.getElementById('theme'); if (THEMES.indexOf(t) === -1) t = 'system'; if (t === 'system') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t); if (b) b.innerHTML = '<span class="tl">Theme: </span>' + t; }
  function cycleTheme() { var t = lsGet('theme', 'system'); lsSet('theme', THEMES[(THEMES.indexOf(t) + 1) % 3] || 'system'); paintTheme(); }
  window.addEventListener('hashchange', route);

  /* ---------- start ---------- */
  (function start() {
    var q = new URLSearchParams(location.search), g = q.get('g'), o = q.get('o');
    if (g || o) { try { history.replaceState(null, '', location.pathname + (api.mode === 'demo' ? '?demo' : '') + '#/' + (g ? 'g/' + encodeURIComponent(g) : 'o/' + encodeURIComponent(o))); } catch (e) { location.hash = '#/' + (g ? 'g/' + g : 'o/' + o); } }
    paintFooter(); loadRuns();
    $('#foot-help').href = waLink(cfg.supportWhatsApp, 'Hi, I have a problem with ShootRadar: ');
    if (api.mode === 'demo') { var flag = document.createElement('div'); flag.className = 'demo-flag'; flag.textContent = 'Demo mode: nothing is saved and everything resets when you reload.'; document.body.insertBefore(flag, document.getElementById('top')); }
    if (CITIES.indexOf(state.city) === -1) state.city = 'All';
    paintTheme();
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(function () { });
    api.init(function () { afterAuth().then(route); }).then(afterAuth).then(route, route);
    loadEvents();
  })();
})();
