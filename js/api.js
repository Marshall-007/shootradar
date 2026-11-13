/* Data layer. One interface, two back ends:
   - live: Supabase (database, login, photo storage)
   - demo: in-memory, used when the address ends in ?demo so the app can be tried without an account. */
(function () {
  'use strict';
  var cfg = window.SR_CONFIG || {};
  var DEMO = /[?&]demo\b/.test(location.search);
  var ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var KEEP_DAYS = 7;
  var MAX_ORIGINAL = 50 * 1024 * 1024;
  function code(n) { var s = ''; for (var i = 0; i < n; i++) s += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length)); return s; }
  function fail(error, fallback) {
    var msg = (error && (error.message || error.error_description)) || fallback || 'Something went wrong.';
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) msg = 'No connection. Check your signal and try again.';
    if (/row-level security|violates row level/i.test(msg)) msg = 'Your account is not approved for this yet.';
    var e = new Error(msg); e.cause = error; throw e;
  }
  function total(n, price, bundle) { var t = n * price; return bundle > 0 && bundle < t ? bundle : t; }
  function extOf(file) { var m = /\.([A-Za-z0-9]{2,5})$/.exec(file.name || ''); return (m ? m[1] : 'jpg').toLowerCase(); }
  function gone(p) { return p.full_deleted || new Date(p.expires_at).getTime() <= Date.now(); }
  function expiryDate() { return new Date(Date.now() + KEEP_DAYS * 864e5).toISOString(); }

  /* ================= Live (Supabase) ================= */
  function live() {
    var sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
    var user = null;
    function uid() { if (!user) fail(null, 'Please sign in first.'); return user.id; }
    function ok(res, fallback) { if (res.error) fail(res.error, fallback); return res.data; }
    function removeFiles(rows) {
      var jobs = [];
      if (rows.length) {
        jobs.push(sb.storage.from('previews').remove(rows.map(function (p) { return p.preview_path; })));
        jobs.push(sb.storage.from('originals').remove(rows.map(function (p) { return p.full_path; })));
      }
      return Promise.all(jobs);
    }
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
      // Creates a pending profile on first sign-in, so the admin can see and approve the photographer.
      getProfile: function () { uid(); return sb.rpc('my_profile').then(function (r) { return ok(r) || null; }); },
      saveProfile: function (p) {
        var row = { id: uid(), name: p.name, brand: p.brand, phone: p.phone, pay_link: p.pay_link, price: p.price, bundle: p.bundle, city: p.city };
        return sb.from('profiles').upsert(row).select().single().then(function (r) { return ok(r, 'Could not save your profile.'); });
      },
      listProfiles: function () { return sb.from('profiles').select('*').order('created_at', { ascending: false }).limit(500).then(function (r) { return ok(r, 'Could not load the photographers.'); }); },
      setApproved: function (id, approved) { return sb.from('profiles').update({ approved: approved }).eq('id', id).select().single().then(function (r) { return ok(r, 'Could not change the approval.'); }); },
      storageUsage: function () { return sb.rpc('storage_usage').then(function (r) { return ok(r, 'Could not load storage figures.') || []; }); },
      listEvents: function () {
        return sb.from('events').select('*').gte('ends_at', new Date(Date.now() - 3 * 864e5).toISOString()).order('starts_at').limit(1500).then(function (r) { return ok(r, 'Could not load events.'); });
      },
      listRuns: function () { return sb.from('refresh_runs').select('*').order('ran_at', { ascending: false }).limit(12).then(function (r) { return ok(r, 'Could not load the refresh log.'); }); },
      addEvent: function (ev) {
        var row = Object.assign({}, ev, { created_by: uid(), status: 'user' });
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
          sb.from('orders').select('*').eq('gallery_id', id).order('created_at', { ascending: false }),
          sb.from('galleries').select('*, photos(count), orders(status)').eq('parent_id', id).order('created_at'),
          sb.from('takedowns').select('*').eq('gallery_id', id).order('created_at', { ascending: false })
        ]).then(function (rs) {
          var g = ok(rs[0], 'Gallery not found.');
          var kids = ok(rs[3]).map(function (c) { c.photo_count = c.photos && c.photos[0] ? c.photos[0].count : 0; c.order_count = (c.orders || []).length; delete c.photos; delete c.orders; return c; });
          var out = { gallery: g, photos: ok(rs[1]), orders: ok(rs[2]), children: kids, takedowns: ok(rs[4]), parent: null };
          if (!g.parent_id) return out;
          return sb.from('galleries').select('id, title, code').eq('id', g.parent_id).maybeSingle().then(function (r) { out.parent = r.data || null; return out; });
        });
      },
      deleteGallery: function (id) {
        return sb.from('galleries').select('id').eq('parent_id', id).then(function (r) {
          var ids = [id].concat(ok(r).map(function (x) { return x.id; }));
          return sb.from('photos').select('preview_path, full_path').in('gallery_id', ids);
        }).then(function (r) { return removeFiles(ok(r)); })
          .then(function () { return sb.from('galleries').delete().eq('id', id); }).then(function (r) { ok(r, 'Could not delete the gallery.'); });
      },
      // The preview is watermarked and small; the original goes up untouched so the client gets the full quality.
      uploadPhoto: function (gallery, item) {
        if (item.file.size > MAX_ORIGINAL) fail(null, 'That photo is larger than 50 MB.');
        var id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : code(12).toLowerCase();
        var base = uid() + '/' + gallery.id + '/' + id, pv = base + '.jpg', full = base + '.' + extOf(item.file);
        return sb.storage.from('previews').upload(pv, item.preview, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false }).then(function (r) {
          ok(r, 'Upload failed.');
          return sb.storage.from('originals').upload(full, item.file, { contentType: item.file.type || 'image/jpeg', upsert: false });
        }).then(function (r) {
          ok(r, 'Upload failed.');
          return sb.from('photos').insert({ gallery_id: gallery.id, photographer_id: uid(), seq: item.seq, preview_path: pv, full_path: full, w: item.w, h: item.h, bytes: item.preview.size + item.file.size, expires_at: expiryDate() }).select().single();
        }).then(function (r) { return ok(r, 'Upload failed.'); });
      },
      replaceOriginal: function (photo, file) {
        if (file.size > MAX_ORIGINAL) fail(null, 'That photo is larger than 50 MB.');
        return sb.storage.from('originals').upload(photo.full_path, file, { contentType: file.type || 'image/jpeg', upsert: true }).then(function (r) {
          ok(r, 'Upload failed.');
          return sb.from('photos').update({ full_deleted: false, expires_at: expiryDate(), bytes: file.size }).eq('id', photo.id).select().single();
        }).then(function (r) { return ok(r, 'Upload failed.'); });
      },
      deletePhoto: function (p) {
        return removeFiles([p]).then(function () { return sb.from('photos').delete().eq('id', p.id); }).then(function (r) { ok(r); });
      },
      // Removes originals older than 7 days. Runs for the signed-in photographer's own photos; for an admin, everyone's.
      cleanupExpired: function () {
        return sb.from('photos').select('id, full_path').eq('full_deleted', false).lt('expires_at', new Date().toISOString()).limit(300).then(function (r) {
          var rows = r.data || [];
          if (!rows.length) return 0;
          return sb.storage.from('originals').remove(rows.map(function (p) { return p.full_path; })).then(function (res) {
            if (res.error) return 0;
            return sb.from('photos').update({ full_deleted: true }).in('id', rows.map(function (p) { return p.id; })).then(function () { return rows.length; });
          });
        }).catch(function () { return 0; });
      },
      previewUrl: function (path) { return sb.storage.from('previews').getPublicUrl(path).data.publicUrl; },
      // Each link carries a file name so the browser saves the photo, and stops working when the original is removed.
      markPaid: function (order, amount, photos, nameFor) {
        var mine = photos.filter(function (p) { return order.photo_ids.indexOf(p.id) !== -1; });
        var lost = mine.filter(gone);
        if (lost.length) fail(null, 'The original has expired for photo ' + lost.map(function (p) { return '#' + p.seq; }).join(', ') + '. Re-upload it, then try again.');
        return Promise.all(mine.map(function (p) {
          var name = nameFor(p), secs = Math.max(300, Math.min(KEEP_DAYS * 86400, Math.floor((new Date(p.expires_at).getTime() - Date.now()) / 1000)));
          return sb.storage.from('originals').createSignedUrl(p.full_path, secs, { download: name }).then(function (r) {
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
      dismissTakedown: function (id) { return sb.from('takedowns').delete().eq('id', id).then(function (r) { ok(r); }); },
      getGallery: function (c) { return sb.rpc('get_gallery', { p_code: c }).then(function (r) { return ok(r, 'Could not open the gallery.'); }); },
      createOrder: function (o) {
        return sb.rpc('create_order', { p_code: o.code, p_name: o.name, p_phone: o.phone, p_photo_ids: o.photoIds, p_consent: o.consent, p_portfolio: o.portfolio, p_offers: o.offers, p_guardian: o.guardian })
          .then(function (r) { return ok(r, 'Could not send your request.'); });
      },
      getOrder: function (c) { return sb.rpc('get_order', { p_code: c }).then(function (r) { return ok(r, 'Could not find that order.'); }); },
      findOrder: function (c, phone) { return sb.rpc('find_order', { p_code: c, p_phone: phone }).then(function (r) { return ok(r, 'Could not look up that order.') || null; }); },
      requestTakedown: function (t) {
        return sb.rpc('request_takedown', { p_code: t.code, p_photo_id: t.photoId, p_name: t.name, p_phone: t.phone, p_reason: t.reason }).then(function (r) { return ok(r, 'Could not send your request.'); });
      }
    };
    return api;
  }

  /* ================= Demo (in memory) ================= */
  function demo() {
    var user = null, onChange = function () { };
    var db = { profiles: {}, events: (window.SR_DEMO_EVENTS || []).slice(), galleries: [], photos: [], orders: [], takedowns: [], blobs: {} };
    // Two other photographers, so the admin console has something to approve.
    db.profiles['demo-2'] = { id: 'demo-2', email: 'lerato@example.com', name: 'Lerato Khumalo', brand: 'LK Frames', phone: '27835550144', city: 'Pretoria', approved: false, is_admin: false, created_at: '2026-11-12T09:00:00+02:00' };
    db.profiles['demo-3'] = { id: 'demo-3', email: 'sipho@example.com', name: 'Sipho Dube', brand: 'Dube Studio', phone: '27715550177', city: 'Durban', approved: true, is_admin: false, created_at: '2026-11-11T15:00:00+02:00' };
    var n = 0;
    function id() { n++; return '00000000-0000-4000-8000-' + ('000000000000' + n).slice(-12); }
    function later(v) { return new Promise(function (res, rej) { setTimeout(function () { try { res(typeof v === 'function' ? v() : v); } catch (e) { rej(e); } }, 30); }); }
    function need() { if (!user) fail(null, 'Please sign in first.'); return user.id; }
    function pubProfile(pid) { var p = db.profiles[pid] || {}; return { name: p.name || '', brand: p.brand || '', phone: p.phone || '', pay_link: p.pay_link || '' }; }
    function mine() { var me = need(); if (!db.profiles[me]) db.profiles[me] = { id: me, email: user.email, name: '', brand: '', phone: '', pay_link: '', price: 60, bundle: 150, city: 'Johannesburg', approved: !/pending/i.test(user.email), is_admin: !/pending/i.test(user.email), created_at: new Date().toISOString() }; return db.profiles[me]; }
    function find(list, key, val) { return list.filter(function (x) { return x[key] === val; })[0]; }
    var api = {
      mode: 'demo',
      init: function (cb) { onChange = cb; return later(null); },
      user: function () { return user; },
      signUp: function (email) { user = { id: /pending/i.test(email) ? 'demo-pending' : 'demo-user', email: email }; onChange(user); return later({ needsConfirm: false }); },
      signIn: function (email) { user = { id: /pending/i.test(email) ? 'demo-pending' : 'demo-user', email: email }; onChange(user); return later(user); },
      signOut: function () { user = null; onChange(null); return later(); },
      getProfile: function () { return later(function () { return mine(); }); },
      saveProfile: function (p) { return later(function () { return Object.assign(mine(), p); }); },
      listProfiles: function () { return later(function () { mine(); return Object.keys(db.profiles).map(function (k) { return db.profiles[k]; }).sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); }); }); },
      setApproved: function (pid, v) { return later(function () { db.profiles[pid].approved = v; return db.profiles[pid]; }); },
      storageUsage: function () { return later(function () { var m = {}; db.photos.forEach(function (p) { var u = m[p.photographer_id] || (m[p.photographer_id] = { id: p.photographer_id, bytes: 0, files: 0 }); u.bytes += p.bytes || 0; u.files += p.full_deleted ? 1 : 2; }); m['demo-3'] = { id: 'demo-3', bytes: 212 * 1048576, files: 96 }; return Object.keys(m).map(function (k) { return m[k]; }); }); },
      listEvents: function () { return later(function () { return db.events.slice().sort(function (a, b) { return new Date(a.starts_at) - new Date(b.starts_at); }); }); },
      listRuns: function () { return later((window.SR_DEMO_RUNS || []).slice().reverse()); },
      addEvent: function (ev) { var row = Object.assign({ id: 'u-' + code(8).toLowerCase(), created_at: new Date().toISOString(), origin: 'user' }, ev, { created_by: need(), status: 'user' }); db.events.push(row); return later(row); },
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
      createGallery: function (g) { var row = Object.assign({ id: id(), code: code(6), photographer_id: need(), created_at: new Date().toISOString(), parent_id: null, private: false }, g); db.galleries.push(row); return later(row); },
      getGalleryAdmin: function (gid) {
        return later(function () {
          var g = find(db.galleries, 'id', gid);
          if (!g) fail(null, 'Gallery not found.');
          var parent = g.parent_id ? find(db.galleries, 'id', g.parent_id) : null;
          return {
            gallery: g, parent: parent ? { id: parent.id, title: parent.title, code: parent.code } : null,
            photos: db.photos.filter(function (p) { return p.gallery_id === gid; }).sort(function (a, b) { return a.seq - b.seq; }),
            orders: db.orders.filter(function (o) { return o.gallery_id === gid; }).slice().reverse(),
            children: db.galleries.filter(function (c) { return c.parent_id === gid; }).map(function (c) { return Object.assign({}, c, { photo_count: db.photos.filter(function (p) { return p.gallery_id === c.id; }).length, order_count: db.orders.filter(function (o) { return o.gallery_id === c.id; }).length }); }),
            takedowns: db.takedowns.filter(function (t) { return t.gallery_id === gid; }).slice().reverse()
          };
        });
      },
      deleteGallery: function (gid) {
        var ids = [gid].concat(db.galleries.filter(function (g) { return g.parent_id === gid; }).map(function (g) { return g.id; }));
        function keep(x) { return ids.indexOf(x.gallery_id) === -1; }
        db.galleries = db.galleries.filter(function (g) { return ids.indexOf(g.id) === -1; }); db.photos = db.photos.filter(keep); db.orders = db.orders.filter(keep); db.takedowns = db.takedowns.filter(keep);
        return later();
      },
      uploadPhoto: function (gallery, item) {
        if (item.file.size > MAX_ORIGINAL) return later(function () { fail(null, 'That photo is larger than 50 MB.'); });
        var pid = id(), base = need() + '/' + gallery.id + '/' + pid, full = base + '.' + extOf(item.file);
        db.blobs['p:' + base + '.jpg'] = URL.createObjectURL(item.preview);
        db.blobs['f:' + full] = URL.createObjectURL(item.file);
        var row = { id: pid, gallery_id: gallery.id, photographer_id: user.id, seq: item.seq, preview_path: base + '.jpg', full_path: full, w: item.w, h: item.h, bytes: item.preview.size + item.file.size, expires_at: expiryDate(), full_deleted: false };
        db.photos.push(row); return later(row);
      },
      replaceOriginal: function (photo, file) { var p = find(db.photos, 'id', photo.id); db.blobs['f:' + p.full_path] = URL.createObjectURL(file); p.full_deleted = false; p.expires_at = expiryDate(); p.bytes = file.size; return later(p); },
      deletePhoto: function (p) { db.photos = db.photos.filter(function (x) { return x.id !== p.id; }); db.takedowns = db.takedowns.filter(function (t) { return t.photo_id !== p.id; }); return later(); },
      cleanupExpired: function () { var c = 0; db.photos.forEach(function (p) { if (!p.full_deleted && new Date(p.expires_at) < new Date()) { p.full_deleted = true; c++; } }); return later(c); },
      previewUrl: function (path) { return db.blobs['p:' + path] || ''; },
      markPaid: function (order, amount, photos, nameFor) {
        return later(function () {
          var o = find(db.orders, 'id', order.id), mineP = photos.filter(function (p) { return o.photo_ids.indexOf(p.id) !== -1; }), lost = mineP.filter(gone);
          if (lost.length) fail(null, 'The original has expired for photo ' + lost.map(function (p) { return '#' + p.seq; }).join(', ') + '. Re-upload it, then try again.');
          if (o.status === 'requested') o.status = 'paid';
          o.amount = amount; o.paid_at = o.paid_at || new Date().toISOString();
          o.downloads = mineP.map(function (p) { return { seq: p.seq, name: nameFor(p), url: db.blobs['f:' + p.full_path] }; });
          return o;
        });
      },
      setOrderStatus: function (order, status) { var o = find(db.orders, 'id', order.id); o.status = status; return later(o); },
      deleteOrder: function (order) { db.orders = db.orders.filter(function (x) { return x.id !== order.id; }); return later(); },
      dismissTakedown: function (tid) { db.takedowns = db.takedowns.filter(function (t) { return t.id !== tid; }); return later(); },
      getGallery: function (c) {
        return later(function () {
          var g = find(db.galleries, 'code', String(c).trim().toUpperCase());
          if (!g) return null;
          return { gallery: { id: g.id, code: g.code, title: g.title, event_date: g.event_date, kids: g.kids, price: g.price, bundle: g.bundle, private: g.private }, photographer: pubProfile(g.photographer_id),
            photos: db.photos.filter(function (p) { return p.gallery_id === g.id; }).sort(function (a, b) { return a.seq - b.seq; }).map(function (p) { return { id: p.id, seq: p.seq, path: p.preview_path, w: p.w, h: p.h }; }) };
        });
      },
      createOrder: function (o) {
        return later(function () {
          var g = find(db.galleries, 'code', String(o.code).trim().toUpperCase());
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
          var o = find(db.orders, 'code', String(c).trim().toUpperCase());
          if (!o) return null;
          var g = find(db.galleries, 'id', o.gallery_id), ph = db.photos.filter(function (p) { return o.photo_ids.indexOf(p.id) !== -1; }).sort(function (a, b) { return a.seq - b.seq; });
          return { code: o.code, status: o.status, amount: o.amount, client_name: o.client_name, created_at: o.created_at, downloads: (o.status === 'paid' || o.status === 'delivered') ? o.downloads : [],
            expires_at: ph.length ? ph.map(function (p) { return p.expires_at; }).sort()[0] : null,
            gallery: { code: g.code, title: g.title, price: g.price, bundle: g.bundle }, photographer: pubProfile(o.photographer_id),
            photos: ph.map(function (p) { return { id: p.id, seq: p.seq, path: p.preview_path }; }) };
        });
      },
      findOrder: function (c, phone) {
        return later(function () {
          var want = String(c).trim().toUpperCase(); if (want.indexOf('SR-') !== 0) want = 'SR-' + want;
          var digits = String(phone || '').replace(/\D/g, '').slice(-9);
          var o = db.orders.filter(function (x) { return x.code === want && digits.length === 9 && String(x.client_phone).replace(/\D/g, '').slice(-9) === digits; })[0];
          return o ? o.code : null;
        });
      },
      requestTakedown: function (t) {
        return later(function () {
          var g = find(db.galleries, 'code', String(t.code).trim().toUpperCase());
          if (!g) fail(null, 'Gallery not found');
          db.takedowns.push({ id: id(), gallery_id: g.id, photo_id: t.photoId, photographer_id: g.photographer_id, name: t.name, phone: t.phone, reason: t.reason || '', created_at: new Date().toISOString() });
          return true;
        });
      }
    };
    return api;
  }

  window.SR_API = (DEMO || !cfg.supabaseUrl || !window.supabase) ? demo() : live();
  window.SR_TOTAL = total;
  window.SR_GONE = gone;
})();
