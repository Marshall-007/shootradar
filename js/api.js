/* Data layer. One interface, two back ends:
   - live: Supabase (database, login, photo storage)
   - demo: in-memory, used when the address ends in ?demo so the app can be tried without an account. */
(function () {
  'use strict';
  var cfg = window.SR_CONFIG || {};
  var DEMO = /[?&]demo\b/.test(location.search);
  var ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  function code(n) { var s = ''; for (var i = 0; i < n; i++) s += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length)); return s; }
  function fail(error, fallback) {
    var msg = (error && (error.message || error.error_description)) || fallback || 'Something went wrong.';
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) msg = 'No connection. Check your signal and try again.';
    var e = new Error(msg); e.cause = error; throw e;
  }
  function total(n, price, bundle) { var t = n * price; return bundle > 0 && bundle < t ? bundle : t; }

  /* ================= Live (Supabase) ================= */
  function live() {
    var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
    var user = null;
    function uid() { if (!user) fail(null, 'Please sign in first.'); return user.id; }
    function ok(res, fallback) { if (res.error) fail(res.error, fallback); return res.data; }
    var api = {
      mode: 'live',
      init: function (onChange) {
        sb.auth.onAuthStateChange(function (_evt, session) {
          var next = session ? session.user : null;
          var changed = (next && next.id) !== (user && user.id);
          user = next;
          if (changed) onChange(user);
        });
        return sb.auth.getSession().then(function (r) { user = r.data && r.data.session ? r.data.session.user : null; return user; });
      },
      user: function () { return user; },
      signUp: function (email, password) {
        return sb.auth.signUp({ email: email, password: password }).then(function (r) {
          if (r.error) fail(r.error);
          if (r.data.session) { user = r.data.user; return { needsConfirm: false }; }
          // No session came back: try to sign in straight away. It only fails if email confirmation is switched on.
          return sb.auth.signInWithPassword({ email: email, password: password }).then(function (r2) {
            if (r2.error) { user = null; return { needsConfirm: true }; }
            user = r2.data.user; return { needsConfirm: false };
          });
        });
      },
      signIn: function (email, password) {
        return sb.auth.signInWithPassword({ email: email, password: password }).then(function (r) {
          if (r.error) fail(r.error, 'Could not sign in.');
          user = r.data.user; return user;
        });
      },
      signOut: function () { return sb.auth.signOut().then(function () { user = null; }); },
      getProfile: function () {
        return sb.from('profiles').select('*').eq('id', uid()).maybeSingle().then(function (r) { return ok(r) || null; });
      },
      saveProfile: function (p) {
        var row = { id: uid(), name: p.name, brand: p.brand, phone: p.phone, pay_link: p.pay_link, price: p.price, bundle: p.bundle, city: p.city };
        return sb.from('profiles').upsert(row).select().single().then(function (r) { return ok(r, 'Could not save your profile.'); });
      },
      listEvents: function () {
        return sb.from('events').select('*').gte('ends_at', new Date(Date.now() - 3 * 864e5).toISOString()).order('starts_at').limit(1500).then(function (r) { return ok(r, 'Could not load events.'); });
      },
      listRuns: function () { return sb.from('refresh_runs').select('*').order('ran_at', { ascending: false }).limit(12).then(function (r) { return ok(r, 'Could not load the refresh log.'); }); },
      addEvent: function (ev) {
        var row = Object.assign({}, ev, { created_by: user ? user.id : null, status: user ? 'user' : 'submitted' });
        // Visitors who are not signed in cannot read back their own row, so do not ask for it.
        if (!user) return sb.from('events').insert(row).then(function (r) { ok(r, 'Could not add the event.'); return null; });
        return sb.from('events').insert(row).select().single().then(function (r) { return ok(r, 'Could not add the event.'); });
      },
      deleteEvent: function (id) { return sb.from('events').delete().eq('id', id).then(function (r) { ok(r); }); },
      listGalleries: function () {
        return sb.from('galleries').select('*, photos(count), orders(status, amount)').eq('photographer_id', uid()).order('created_at', { ascending: false })
          .then(function (r) {
            return ok(r, 'Could not load your galleries.').map(function (g) {
              g.photo_count = g.photos && g.photos[0] ? g.photos[0].count : 0;
              g.order_list = g.orders || [];
              delete g.photos; delete g.orders;
              return g;
            });
          });
      },
      createGallery: function (g) {
        function attempt(n) {
          var row = Object.assign({}, g, { photographer_id: uid(), code: code(6) });
          return sb.from('galleries').insert(row).select().single().then(function (r) {
            if (r.error && r.error.code === '23505' && n < 4) return attempt(n + 1);
            return ok(r, 'Could not create the gallery.');
          });
        }
        return attempt(0);
      },
      getGalleryAdmin: function (id) {
        return Promise.all([
          sb.from('galleries').select('*').eq('id', id).single(),
          sb.from('photos').select('*').eq('gallery_id', id).order('seq'),
          sb.from('orders').select('*').eq('gallery_id', id).order('created_at', { ascending: false })
        ]).then(function (rs) { return { gallery: ok(rs[0], 'Gallery not found.'), photos: ok(rs[1]), orders: ok(rs[2]) }; });
      },
      deleteGallery: function (id) {
        return sb.from('photos').select('preview_path, full_path').eq('gallery_id', id).then(function (r) {
          var rows = ok(r);
          var jobs = [];
          if (rows.length) {
            jobs.push(sb.storage.from('previews').remove(rows.map(function (p) { return p.preview_path; })));
            jobs.push(sb.storage.from('originals').remove(rows.map(function (p) { return p.full_path; })));
          }
          return Promise.all(jobs);
        }).then(function () { return sb.from('galleries').delete().eq('id', id); }).then(function (r) { ok(r, 'Could not delete the gallery.'); });
      },
      uploadPhoto: function (gallery, item) {
        var id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : code(12).toLowerCase();
        var base = uid() + '/' + gallery.id + '/' + id + '.jpg';
        var opts = { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false };
        return sb.storage.from('previews').upload(base, item.preview, opts).then(function (r) {
          ok(r, 'Upload failed.');
          return sb.storage.from('originals').upload(base, item.full, opts);
        }).then(function (r) {
          ok(r, 'Upload failed.');
          return sb.from('photos').insert({ gallery_id: gallery.id, photographer_id: uid(), seq: item.seq, preview_path: base, full_path: base, w: item.w, h: item.h, bytes: item.preview.size + item.full.size }).select().single();
        }).then(function (r) { return ok(r, 'Upload failed.'); });
      },
      deletePhoto: function (p) {
        return Promise.all([sb.storage.from('previews').remove([p.preview_path]), sb.storage.from('originals').remove([p.full_path])])
          .then(function () { return sb.from('photos').delete().eq('id', p.id); }).then(function (r) { ok(r); });
      },
      previewUrl: function (path) { return sb.storage.from('previews').getPublicUrl(path).data.publicUrl; },
      // Each link is signed for 14 days and carries a file name, so the browser saves the photo instead of opening it.
      markPaid: function (order, amount, photos, nameFor) {
        var mine = photos.filter(function (p) { return order.photo_ids.indexOf(p.id) !== -1; });
        return Promise.all(mine.map(function (p) {
          var name = nameFor(p);
          return sb.storage.from('originals').createSignedUrl(p.full_path, 60 * 60 * 24 * 14, { download: name }).then(function (r) {
            return { seq: p.seq, name: name, url: ok(r, 'Could not prepare the download links.').signedUrl };
          });
        })).then(function (links) {
          var row = { status: order.status === 'delivered' ? 'delivered' : 'paid', amount: amount, downloads: links };
          if (!order.paid_at) row.paid_at = new Date().toISOString();
          return sb.from('orders').update(row).eq('id', order.id).select().single();
        }).then(function (r) { return ok(r, 'Could not mark the order as paid.'); });
      },
      setOrderStatus: function (order, status) {
        return sb.from('orders').update({ status: status }).eq('id', order.id).select().single().then(function (r) { return ok(r); });
      },
      deleteOrder: function (order) { return sb.from('orders').delete().eq('id', order.id).then(function (r) { ok(r); }); },
      getGallery: function (c) { return sb.rpc('get_gallery', { p_code: c }).then(function (r) { return ok(r, 'Could not open the gallery.'); }); },
      createOrder: function (o) {
        return sb.rpc('create_order', { p_code: o.code, p_name: o.name, p_phone: o.phone, p_photo_ids: o.photoIds, p_consent: o.consent, p_portfolio: o.portfolio, p_offers: o.offers, p_guardian: o.guardian })
          .then(function (r) { return ok(r, 'Could not send your request.'); });
      },
      getOrder: function (c) { return sb.rpc('get_order', { p_code: c }).then(function (r) { return ok(r, 'Could not find that order.'); }); },
      findOrder: function (c, phone) { return sb.rpc('find_order', { p_code: c, p_phone: phone }).then(function (r) { return ok(r, 'Could not look up that order.') || null; }); }
    };
    return api;
  }

  /* ================= Demo (in memory) ================= */
  function demo() {
    var user = null, onChange = function () { };
    var db = { profiles: {}, events: (window.SR_DEMO_EVENTS || []).slice(), galleries: [], photos: [], orders: [], blobs: {} };
    var n = 0;
    function id() { n++; return '00000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
    function later(v) { return new Promise(function (res) { setTimeout(function () { res(typeof v === 'function' ? v() : v); }, 30); }); }
    function need() { if (!user) fail(null, 'Please sign in first.'); return user.id; }
    function pubProfile(pid) { var p = db.profiles[pid] || {}; return { name: p.name || '', brand: p.brand || '', phone: p.phone || '', pay_link: p.pay_link || '' }; }
    var api = {
      mode: 'demo',
      init: function (cb) { onChange = cb; return later(null); },
      user: function () { return user; },
      signUp: function (email) { user = { id: 'demo-user', email: email }; onChange(user); return later({ needsConfirm: false }); },
      signIn: function (email) { user = { id: 'demo-user', email: email }; onChange(user); return later(user); },
      signOut: function () { user = null; onChange(null); return later(); },
      getProfile: function () { return later(db.profiles[need()] || null); },
      saveProfile: function (p) { db.profiles[need()] = Object.assign({ id: user.id }, p); return later(db.profiles[user.id]); },
      listEvents: function () { return later(function () { return db.events.slice().sort(function (a, b) { return new Date(a.starts_at) - new Date(b.starts_at); }); }); },
      listRuns: function () { return later((window.SR_DEMO_RUNS || []).slice().reverse()); },
      addEvent: function (ev) { var row = Object.assign({ id: 'u-' + code(8).toLowerCase(), created_at: new Date().toISOString() }, ev, { created_by: user ? user.id : null, status: user ? 'user' : 'submitted' }); db.events.push(row); return later(user ? row : null); },
      deleteEvent: function (eid) { db.events = db.events.filter(function (e) { return e.id !== eid; }); return later(); },
      listGalleries: function () {
        var me = need();
        return later(function () {
          return db.galleries.filter(function (g) { return g.photographer_id === me; }).map(function (g) {
            return Object.assign({}, g, {
              photo_count: db.photos.filter(function (p) { return p.gallery_id === g.id; }).length,
              order_list: db.orders.filter(function (o) { return o.gallery_id === g.id; }).map(function (o) { return { status: o.status, amount: o.amount }; })
            });
          }).reverse();
        });
      },
      createGallery: function (g) { var row = Object.assign({ id: id(), code: code(6), photographer_id: need(), created_at: new Date().toISOString() }, g); db.galleries.push(row); return later(row); },
      getGalleryAdmin: function (gid) {
        return later(function () {
          var g = db.galleries.filter(function (x) { return x.id === gid; })[0];
          if (!g) fail(null, 'Gallery not found.');
          return { gallery: g, photos: db.photos.filter(function (p) { return p.gallery_id === gid; }).sort(function (a, b) { return a.seq - b.seq; }), orders: db.orders.filter(function (o) { return o.gallery_id === gid; }).slice().reverse() };
        });
      },
      deleteGallery: function (gid) { db.galleries = db.galleries.filter(function (g) { return g.id !== gid; }); db.photos = db.photos.filter(function (p) { return p.gallery_id !== gid; }); db.orders = db.orders.filter(function (o) { return o.gallery_id !== gid; }); return later(); },
      uploadPhoto: function (gallery, item) {
        var pid = id(), path = need() + '/' + gallery.id + '/' + pid + '.jpg';
        db.blobs['p:' + path] = URL.createObjectURL(item.preview);
        db.blobs['f:' + path] = URL.createObjectURL(item.full);
        var row = { id: pid, gallery_id: gallery.id, photographer_id: user.id, seq: item.seq, preview_path: path, full_path: path, w: item.w, h: item.h, bytes: item.preview.size + item.full.size };
        db.photos.push(row); return later(row);
      },
      deletePhoto: function (p) { db.photos = db.photos.filter(function (x) { return x.id !== p.id; }); return later(); },
      previewUrl: function (path) { return db.blobs['p:' + path] || ''; },
      markPaid: function (order, amount, photos, nameFor) {
        var o = db.orders.filter(function (x) { return x.id === order.id; })[0];
        if (o.status === 'requested') o.status = 'paid';
        o.amount = amount; o.paid_at = o.paid_at || new Date().toISOString();
        o.downloads = photos.filter(function (p) { return o.photo_ids.indexOf(p.id) !== -1; }).map(function (p) { return { seq: p.seq, name: nameFor(p), url: db.blobs['f:' + p.full_path] }; });
        return later(o);
      },
      setOrderStatus: function (order, status) { var o = db.orders.filter(function (x) { return x.id === order.id; })[0]; o.status = status; return later(o); },
      deleteOrder: function (order) { db.orders = db.orders.filter(function (x) { return x.id !== order.id; }); return later(); },
      getGallery: function (c) {
        return later(function () {
          var g = db.galleries.filter(function (x) { return x.code === String(c).trim().toUpperCase(); })[0];
          if (!g) return null;
          return { gallery: { id: g.id, code: g.code, title: g.title, event_date: g.event_date, kids: g.kids, price: g.price, bundle: g.bundle }, photographer: pubProfile(g.photographer_id),
            photos: db.photos.filter(function (p) { return p.gallery_id === g.id; }).sort(function (a, b) { return a.seq - b.seq; }).map(function (p) { return { id: p.id, seq: p.seq, path: p.preview_path, w: p.w, h: p.h }; }) };
        });
      },
      createOrder: function (o) {
        return later(function () {
          var g = db.galleries.filter(function (x) { return x.code === String(o.code).trim().toUpperCase(); })[0];
          if (!g) fail(null, 'Gallery not found');
          if (!o.consent) fail(null, 'Consent is required');
          if (g.kids && !(o.guardian || '').trim()) fail(null, 'A parent or guardian name is required for this gallery');
          var c = 'SR-' + code(6);
          db.orders.push({ id: id(), code: c, gallery_id: g.id, photographer_id: g.photographer_id, client_name: o.name, client_phone: o.phone, photo_ids: o.photoIds.slice(), consent: true, portfolio: !!o.portfolio, offers: !!o.offers, guardian: o.guardian || '', status: 'requested', amount: total(o.photoIds.length, g.price, g.bundle), downloads: [], created_at: new Date().toISOString() });
          return c;
        });
      },
      getOrder: function (c) {
        return later(function () {
          var o = db.orders.filter(function (x) { return x.code === String(c).trim().toUpperCase(); })[0];
          if (!o) return null;
          var g = db.galleries.filter(function (x) { return x.id === o.gallery_id; })[0];
          return { code: o.code, status: o.status, amount: o.amount, client_name: o.client_name, created_at: o.created_at, downloads: o.status === 'requested' ? [] : o.downloads,
            gallery: { code: g.code, title: g.title, price: g.price, bundle: g.bundle }, photographer: pubProfile(o.photographer_id),
            photos: db.photos.filter(function (p) { return o.photo_ids.indexOf(p.id) !== -1; }).sort(function (a, b) { return a.seq - b.seq; }).map(function (p) { return { id: p.id, seq: p.seq, path: p.preview_path }; }) };
        });
      },
      findOrder: function (c, phone) {
        return later(function () {
          var want = String(c).trim().toUpperCase(); if (want.indexOf('SR-') !== 0) want = 'SR-' + want;
          var digits = String(phone || '').replace(/\D/g, '').slice(-9);
          var o = db.orders.filter(function (x) { return x.code === want && digits.length === 9 && String(x.client_phone).replace(/\D/g, '').slice(-9) === digits; })[0];
          return o ? o.code : null;
        });
      }
    };
    return api;
  }

  window.SR_API = (DEMO || !cfg.supabaseUrl || !window.supabase) ? demo() : live();
  window.SR_TOTAL = total;
})();
