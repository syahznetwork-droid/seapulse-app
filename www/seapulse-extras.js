/* SeaPulse Ops extras: file saving on Android, real cloud sync (Firebase REST), phone reminders. Created for Syah S. */
(function () {
  'use strict';
  var KEY = 'seapulse_ops_enterprise_v16', SK = 'sp-sync', RK = 'sp-rem';
  var origSet = Storage.prototype.setItem, origGet = Storage.prototype.getItem;
  var LOCAL = ['theme', 'workspaceDensity', 'userProfile', 'showWorldClockStrip'];
  var H = 36e5, started = Date.now(), lastAct = 0, applying = false, busy = false;
  var now = function () { return Date.now(); };
  var NAT = function () { try { return window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform() && Capacitor.Plugins; } catch (e) { return null; } };
  function jget(k, d) { try { return JSON.parse(origGet.call(localStorage, k)) || d; } catch (e) { return d; } }
  function jset(k, v) { origSet.call(localStorage, k, JSON.stringify(v)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fd(v) { var d = new Date(v); return isNaN(d) ? '-' : d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function toast(m) { var t = document.getElementById('spx-toast'); if (!t) { t = document.createElement('div'); t.id = 'spx-toast'; document.body.appendChild(t); } t.textContent = m; t.className = 'show'; clearTimeout(toast.h); toast.h = setTimeout(function () { t.className = ''; }, 4000); }
  ['pointerdown', 'keydown'].forEach(function (ev) { addEventListener(ev, function () { lastAct = now(); }, true); });

  /* ---------- 1. File saving on Android (PDF, backups, attachments) ---------- */
  async function nativeSave(name, blob) {
    var P = NAT(); if (!(P && P.Filesystem && P.Share)) return false;
    var b64 = await new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.onerror = rej; r.readAsDataURL(blob); });
    var w = await P.Filesystem.writeFile({ path: String(name).replace(/[\\/:*?"<>|]+/g, '_'), data: b64, directory: 'CACHE' });
    await P.Share.share({ title: name, url: w.uri }); return true;
  }
  window.SPsave = function (doc, name) { if (NAT()) { nativeSave(name, doc.output('blob')).catch(function () { toast('Could not save the file'); }); } else { doc.save(name); } };
  document.addEventListener('click', function (e) {
    if (!NAT()) return; var a = e.target.closest && e.target.closest('a[download]'); if (!a) return;
    var href = a.getAttribute('href'); if (!href || href === '#') return;
    e.preventDefault(); e.stopPropagation();
    fetch(a.href).then(function (r) { return r.blob(); }).then(function (b) { return nativeSave(a.getAttribute('download') || 'file', b); }).catch(function () { toast('Could not save the file'); });
  }, true);

  /* ---------- 2. Cloud sync (Firebase Auth + Firestore REST) ---------- */
  function Y() { var y = jget(SK, {}); if (!y.apiKey && window.SEAOPS_CFG && SEAOPS_CFG.apiKey) { y.apiKey = SEAOPS_CFG.apiKey; y.projectId = SEAOPS_CFG.projectId; } return y; }
  function saveY(y) { jset(SK, y); }
  function strip(o) { if (typeof o === 'string') return (o.length > 2000 && o.slice(0, 5) === 'data:') ? '' : o; if (Array.isArray(o)) return o.map(strip); if (o && typeof o === 'object') { var r = {}; for (var k in o) r[k] = strip(o[k]); return r; } return o; }
  function pack(raw) { var p = JSON.parse(raw); LOCAL.forEach(function (k) { delete p[k]; }); return JSON.stringify(strip(p)); }
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return h; }
  function merge(remoteStr) {
    var local = jget(KEY, {}), r = JSON.parse(remoteStr);
    LOCAL.forEach(function (k) { if (k in local) r[k] = local[k]; });
    var ld = {}; (local.shipments || []).forEach(function (s) { var d = s.documents || {}; Object.keys(d).forEach(function (k) { ld['S|' + s.id + '|' + k] = d[k]; }); });
    (r.shipments || []).forEach(function (s) { var d = s.documents || {}; Object.keys(d).forEach(function (k) { var l = ld['S|' + s.id + '|' + k]; if (l && l.data && !(d[k] && d[k].data)) d[k] = Object.assign({}, d[k], { data: l.data }); }); });
    var li = {}; (local.invoices || []).forEach(function (i) { li[i.id] = i.documentData; });
    (r.invoices || []).forEach(function (i) { if (!i.documentData && li[i.id]) i.documentData = li[i.id]; });
    return r;
  }
  Storage.prototype.setItem = function (k, v) {
    if (this === localStorage && k === KEY) {
      if (applying) return;
      var y = Y();
      if (y.refresh) { try { if (hash(pack(v)) !== y.base) { y.dirty = true; saveY(y); soon(); } } catch (e) {} }
      clearTimeout(Storage.prototype._rt); Storage.prototype._rt = setTimeout(function () { phoneSync(); }, 3000);
    }
    return origSet.apply(this, arguments);
  };
  function soon() { clearTimeout(soon.t); soon.t = setTimeout(function () { syncNow(); }, 4000); }
  async function tok() {
    var y = Y(); if (y.idToken && y.exp > now() + 60000) return y.idToken;
    var r = await fetch('https://securetoken.googleapis.com/v1/token?key=' + y.apiKey, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(y.refresh) });
    var d = await r.json(); if (!r.ok) throw new Error('Sign in again');
    y.idToken = d.id_token; y.refresh = d.refresh_token; y.exp = now() + (+d.expires_in) * 1000; saveY(y); return y.idToken;
  }
  function url() { var y = Y(); return 'https://firestore.googleapis.com/v1/projects/' + y.projectId + '/databases/(default)/documents/users/' + y.uid; }
  async function pull() {
    var t = await tok(), r = await fetch(url(), { headers: { Authorization: 'Bearer ' + t } });
    if (r.status === 404) return null; var d = await r.json(); if (!r.ok) throw new Error((d.error && d.error.message) || 'Download failed');
    return { time: d.updateTime, data: d.fields && d.fields.sp ? d.fields.sp.stringValue : null };
  }
  async function push(force) {
    var y = Y(), t = await tok(), raw = origGet.call(localStorage, KEY) || '{}', snap = pack(raw);
    if (snap.length > 900000) throw new Error('Data is too large to sync (' + Math.round(snap.length / 1024) + ' KB). Remove big items.');
    var pre = force ? '' : (y.last ? '&currentDocument.updateTime=' + encodeURIComponent(y.last) : '&currentDocument.exists=false');
    var r = await fetch(url() + '?updateMask.fieldPaths=sp&updateMask.fieldPaths=spAt' + pre, { method: 'PATCH', headers: { Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { sp: { stringValue: snap }, spAt: { integerValue: String(now()) } } }) });
    var d = await r.json();
    if (!r.ok) { var m = d.error && d.error.status; if (m === 'FAILED_PRECONDITION' || m === 'ABORTED' || m === 'ALREADY_EXISTS') return 'conflict'; throw new Error((d.error && d.error.message) || 'Upload failed'); }
    y = Y(); y.last = d.updateTime; y.base = hash(snap); y.at = now();
    y.dirty = hash(pack(origGet.call(localStorage, KEY) || '{}')) !== y.base; saveY(y); return 'ok';
  }
  function applyRemote(r) {
    var y = Y(); applying = true;
    origSet.call(localStorage, KEY, JSON.stringify(merge(r.data)));
    y.last = r.time; y.base = hash(pack(origGet.call(localStorage, KEY))); y.dirty = false; y.conflict = false; y.pending = null; y.at = now(); saveY(y);
    location.reload();
  }
  async function syncNow(manual) {
    var y = Y(); if (!y.refresh) { if (manual) openPanel('sync'); return { ok: false, msg: 'Sign in to Cloud sync first' }; }
    if (busy || (!manual && y.auto === false)) return { ok: false, msg: 'Busy' };
    busy = true; var msg = '', conflict = false, pending = null;
    try {
      var r = await pull(); y = Y();
      if (!r) { conflict = (await push()) === 'conflict'; }
      else if (!r.data) { y.last = r.time; saveY(y); conflict = (await push()) === 'conflict'; }
      else if (r.time === y.last) { if (y.dirty) conflict = (await push()) === 'conflict'; else { y.at = now(); saveY(y); } }
      else if (y.last && !y.dirty) { if (manual || now() - lastAct > 60000 || now() - started < 10000) { applyRemote(r); return { ok: true }; } pending = r; }
      else conflict = true;
      y = Y(); y.err = ''; y.conflict = conflict; y.pending = pending; saveY(y);
    } catch (e) { y = Y(); y.err = e.message === 'Failed to fetch' ? 'Cannot reach the cloud (offline or blocked).' : e.message; saveY(y); msg = y.err; }
    busy = false; y = Y();
    if (y.conflict && !syncNow.w) { syncNow.w = 1; toast('Sync conflict: open the cloud button'); } if (!y.conflict) syncNow.w = 0;
    banner(); render();
    return { ok: !y.err && !y.conflict, msg: msg || (y.conflict ? 'Conflict' : 'Synced') };
  }
  async function auth(create, email, pw) {
    var y = Y();
    try {
      var r = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:' + (create ? 'signUp' : 'signInWithPassword') + '?key=' + y.apiKey, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email, password: pw, returnSecureToken: true }) });
      var d = await r.json(); if (!r.ok) throw new Error((d.error && d.error.message) || 'auth');
      Object.assign(y, { email: email, uid: d.localId, idToken: d.idToken, refresh: d.refreshToken, exp: now() + (+d.expiresIn) * 1000, last: null, base: null, dirty: true, conflict: false, err: '' }); saveY(y);
      toast('Signed in'); await syncNow(true);
    } catch (e) { toast(e.message === 'Failed to fetch' ? 'Cannot reach Firebase from here' : 'Sign-in failed: ' + e.message); }
    render();
  }
  async function keepCloud() { try { var r = await pull(); if (!r || !r.data) return toast('Nothing in the cloud yet'); applyRemote(r); } catch (e) { var y = Y(); y.err = e.message; saveY(y); render(); } }
  async function keepLocal() { try { await push(true); var y = Y(); y.conflict = false; y.err = ''; saveY(y); toast('Cloud now matches this device'); } catch (e) { y = Y(); y.err = e.message; saveY(y); } render(); }

  /* ---------- 3. Phone reminders ---------- */
  function RS() { return Object.assign({ on: false, cut: true, ves: true, ts: true, inv: true, co: [3, 1, 0], vo: [5, 3, 1, 0], io: [3, 0], tm: '08:00' }, jget(RK, {})); }
  function hid32(s) { var x = 0; for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return Math.abs(x) % 2147483000 || 1; }
  var CUT = [['siCutoff', 'SI cut-off', 'chk_7'], ['vgmCutoff', 'VGM cut-off'], ['blCutoff', 'BL cut-off', 'chk_13'], ['customsCutoff', 'Customs cut-off', 'chk_9'], ['fumigationCutoff', 'Fumigation cut-off', 'chk_6'], ['portGateInCutoff', 'Port gate-in cut-off'], ['portGateOffCutoff', 'Port gate-off cut-off']];
  function dayWord(d) { return d === 0 ? ' today' : d === 1 ? ' tomorrow' : ' in ' + d + ' days'; }
  function reminders() {
    var s = RS(), p = jget(KEY, {}), o = [], hm = s.tm.split(':').map(Number);
    function dayAt(d, k, ev) { var x = new Date(d); x.setDate(x.getDate() - k); x.setHours(hm[0], hm[1], 0, 0); return (k === 0 && x >= ev) ? new Date(+ev - 2 * H) : x; }
    function add(key, at, ev, title, body) { if (at >= ev || at < now() - 3 * H) return; o.push({ id: hid32(key + '|' + (+at)), at: at, title: title, body: body }); }
    (p.shipments || []).filter(function (x) { return (x.status || 'Ongoing') === 'Ongoing'; }).forEach(function (x) {
      var c = x.cutoffs || {}, done = {}; (x.checklist || []).forEach(function (i) { if (i.completed) done[i.id] = 1; });
      var ref = x.cargoWiseNumber || x.id;
      if (s.cut) CUT.forEach(function (u) { if (!c[u[0]] || (u[2] && done[u[2]])) return; var ev = new Date(c[u[0]]); s.co.forEach(function (d) { add(x.id + u[0] + 'c' + d, dayAt(ev, d, ev), ev, '\u23F1 ' + u[1] + dayWord(d), ref + ' \u00B7 ' + fd(ev)); }); });
      var vs = [];
      if (s.ves) [['etd', 'Vessel departure', '\uD83D\uDEA2'], ['eta', 'Vessel arrival', '\u2693']].forEach(function (u) { if (c[u[0]]) vs.push([x.id + u[0], u[2] + ' ' + u[1], c[u[0]]]); });
      if (s.ts) (x.transshipmentLegs || []).forEach(function (t, i) { [['eta', 'arrival'], ['etd', 'departure']].forEach(function (u) { if (t[u[0]]) vs.push([x.id + 'ts' + i + u[0], '\u2693 T/S ' + u[1] + ' at ' + String(t.port || '').split(' - ')[0], t[u[0]]]); }); });
      vs.forEach(function (v) { var ev = new Date(v[2]); s.vo.forEach(function (d) { add(v[0] + 'v' + d, dayAt(ev, d, ev), ev, v[1] + dayWord(d), ref + ' \u00B7 ' + fd(ev)); }); });
    });
    if (s.inv) (p.invoices || []).filter(function (i) { return i.status === 'Pending' && i.dueDate; }).forEach(function (i) { var ev = new Date(i.dueDate + 'T23:59'), d0 = new Date(i.dueDate + 'T00:00'); s.io.forEach(function (d) { add('inv' + i.id + 'd' + d, dayAt(d0, d, ev), ev, '\uD83E\uDDFE Invoice ' + i.invoiceNumber + (d === 0 ? ' due today' : ' due in ' + d + ' day(s)'), i.vendorName + ' \u00B7 ' + i.currency + ' ' + i.amount); }); });
    return o.sort(function (a, b) { return a.at - b.at; });
  }
  async function phoneSync() {
    var P = NAT(), LN = P && P.LocalNotifications; if (!LN) return;
    try {
      var pend = await LN.getPending(); if (pend.notifications && pend.notifications.length) await LN.cancel({ notifications: pend.notifications.map(function (x) { return { id: x.id }; }) });
      if (!RS().on) return;
      var R = reminders().filter(function (r) { return r.at > now(); }).slice(0, 60);
      if (R.length) await LN.schedule({ notifications: R.map(function (r) { return { id: r.id, title: r.title, body: r.body, schedule: { at: r.at, allowWhileIdle: true } }; }) });
    } catch (e) {}
  }
  function webCheck() {
    if (NAT() || !RS().on || !window.Notification || Notification.permission !== 'granted') return;
    var sent = jget(RK + '-sent', {});
    reminders().filter(function (r) { return r.at <= now() && !sent[r.id]; }).forEach(function (r) { sent[r.id] = now(); try { new Notification(r.title, { body: r.body }); } catch (e) {} });
    Object.keys(sent).forEach(function (k) { if (now() - sent[k] > 2 * 864e5) delete sent[k]; }); jset(RK + '-sent', sent);
  }
  async function remToggle(on) {
    var s = RS(), LN = NAT() && NAT().LocalNotifications;
    if (!on) { s.on = false; } else {
      try { if (LN) { var r = await LN.requestPermissions(); s.on = r.display === 'granted'; } else if (window.Notification) { var p = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission(); s.on = p === 'granted'; } else s.on = false; } catch (e) { s.on = false; }
      if (!s.on) toast('Permission not granted. Allow notifications for this app in your phone settings.');
    }
    jset(RK, s); phoneSync(); render();
  }
  async function remTest() {
    var LN = NAT() && NAT().LocalNotifications; toast('Test arrives in 5 seconds. Lock the screen or open another app.');
    if (LN) { try { await LN.schedule({ notifications: [{ id: 1, title: '\uD83D\uDD14 SeaPulse test', body: 'Phone notifications are working.', schedule: { at: new Date(now() + 5000) } }] }); } catch (e) { toast('Could not schedule the test'); } }
    else setTimeout(function () { try { new Notification('\uD83D\uDD14 SeaPulse test', { body: 'Phone notifications are working.' }); } catch (e) { toast('Notifications are blocked or not supported here'); } }, 5000);
  }
  try { var LN0 = NAT() && NAT().LocalNotifications; if (LN0) LN0.addListener('localNotificationActionPerformed', function () {}); } catch (e) {}

  /* ---------- 4. Panel ---------- */
  var tab = 'sync', open = false;
  var css = '#spx-btn{position:fixed;left:12px;bottom:12px;z-index:99998;width:46px;height:46px;border-radius:50%;border:0;background:#0f172a;color:#fff;font-size:20px;box-shadow:0 3px 10px #0006;cursor:pointer}#spx-btn i{position:absolute;right:3px;top:3px;width:12px;height:12px;border-radius:50%;border:2px solid #0f172a}' +
    '#spx-panel{position:fixed;left:0;right:0;bottom:0;max-height:88vh;overflow:auto;z-index:99999;background:#fff;color:#0f172a;border-radius:16px 16px 0 0;box-shadow:0 -6px 24px #0007;padding:14px;font:14px/1.45 system-ui,sans-serif;display:none}@media(min-width:700px){#spx-panel{left:12px;right:auto;bottom:66px;width:430px;border-radius:14px}}' +
    '#spx-panel h3{margin:10px 0 6px;font-size:13px;color:#475569;text-transform:uppercase}#spx-panel input,#spx-panel select,#spx-panel textarea{font:inherit;padding:7px 8px;border:1px solid #cbd5e1;border-radius:8px;width:100%;box-sizing:border-box;margin:3px 0}#spx-panel button{font:inherit;padding:7px 12px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;cursor:pointer;margin:3px 3px 3px 0}#spx-panel button.p{background:#0284c7;color:#fff;border-color:#0284c7}' +
    '#spx-panel label.c{display:flex;gap:8px;align-items:center;padding:4px 0;cursor:pointer}#spx-panel label.c input{width:auto;margin:0}.spx-b{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;font-weight:600}.g{background:#dcfce7;color:#166534}.y{background:#fef3c7;color:#92400e}.r{background:#fee2e2;color:#991b1b}.spx-t button.on{background:#0f172a;color:#fff}' +
    '#spx-toast{position:fixed;left:50%;bottom:78px;transform:translateX(-50%) translateY(30px);background:#0f172a;color:#fff;padding:9px 14px;border-radius:99px;opacity:0;pointer-events:none;transition:.25s;z-index:100000;max-width:90vw;font:13px system-ui}#spx-toast.show{opacity:1;transform:translateX(-50%)}' +
    '#spx-ban{position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:100000;background:#0284c7;color:#fff;padding:8px 12px;border-radius:10px;font:13px system-ui;display:none}#spx-ban button{margin-left:8px;border:0;border-radius:6px;padding:3px 8px}';
  function mount() {
    if (document.getElementById('spx-btn')) return;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    var b = document.createElement('button'); b.id = 'spx-btn'; b.title = 'Cloud sync & phone reminders'; b.innerHTML = '\u2601<i></i>'; b.onclick = function () { openPanel(); }; document.body.appendChild(b);
    var p = document.createElement('div'); p.id = 'spx-panel'; document.body.appendChild(p);
    var ban = document.createElement('div'); ban.id = 'spx-ban'; document.body.appendChild(ban);
    p.addEventListener('click', function (e) { var a = e.target.getAttribute && e.target.getAttribute('data-a'); if (a) act(a, e.target); });
    p.addEventListener('change', function (e) { var a = e.target.getAttribute && e.target.getAttribute('data-c'); if (a) chg(a, e.target); });
    render(); banner();
  }
  function openPanel(t) { if (t) tab = t; open = !open || !!t; document.getElementById('spx-panel').style.display = open ? 'block' : 'none'; render(); }
  function banner() { var y = Y(), b = document.getElementById('spx-ban'); if (!b) return; if (y.pending) { b.style.display = 'block'; b.innerHTML = 'Newer data in the cloud <button data-a="upd">Update now</button>'; b.querySelector('button').onclick = function () { var y2 = Y(); if (y2.pending) applyRemote(y2.pending); }; } else b.style.display = 'none'; }
  function dot() { var y = Y(), d = document.querySelector('#spx-btn i'); if (!d) return; d.style.background = !y.refresh ? '#94a3b8' : y.conflict || y.err ? '#ef4444' : y.dirty ? '#f59e0b' : '#22c55e'; }
  function act(a, el) {
    var y = Y();
    if (a === 'tab') { tab = el.getAttribute('data-t'); render(); }
    else if (a === 'close') openPanel();
    else if (a === 'cfg') { var t = document.getElementById('spx-cfg').value, k = (t.match(/apiKey\s*[:=]\s*["']([^"']+)/) || [])[1], pr = (t.match(/projectId\s*[:=]\s*["']([^"']+)/) || [])[1]; if (!k || !pr) return toast('Could not find apiKey and projectId'); y.apiKey = k; y.projectId = pr; saveY(y); render(); }
    else if (a === 'in') auth(false, document.getElementById('spx-e').value.trim(), document.getElementById('spx-p').value);
    else if (a === 'up') auth(true, document.getElementById('spx-e').value.trim(), document.getElementById('spx-p').value);
    else if (a === 'sync') syncNow(true).then(render);
    else if (a === 'kc' || a === 'kl' || a === 'out' || a === 'reset') {
      if (el.getAttribute('data-ok') !== '1' && a !== 'reset') { el.setAttribute('data-ok', '1'); el.textContent = 'Tap again to confirm'; return; }
      if (a === 'kc') keepCloud(); else if (a === 'kl') keepLocal(); else if (a === 'out') { ['idToken', 'refresh', 'uid', 'last', 'base', 'email', 'exp', 'at', 'conflict', 'err', 'pending', 'dirty'].forEach(function (k) { delete y[k]; }); saveY(y); render(); banner(); }
    }
    else if (a === 'cfgreset') { saveY({}); render(); }
    else if (a === 'rtest') remTest();
  }
  function chg(c, el) {
    var y = Y(), s = RS();
    if (c === 'auto') { y.auto = el.checked; saveY(y); }
    else if (c === 'rem') remToggle(el.checked);
    else if (['cut', 'ves', 'ts', 'inv'].indexOf(c) >= 0) { s[c] = el.checked; jset(RK, s); phoneSync(); }
    else if (c === 'tm') { s.tm = el.value || '08:00'; jset(RK, s); phoneSync(); render(); }
    else { var k = c.split(':')[0], v = +c.split(':')[1]; s[k] = s[k].filter(function (x) { return x !== v; }); if (el.checked) s[k].push(v); s[k].sort(function (a, b) { return b - a; }); jset(RK, s); phoneSync(); render(); }
  }
  function chk(c, on, l) { return '<label class="c"><input type="checkbox" data-c="' + c + '"' + (on ? ' checked' : '') + '>' + l + '</label>'; }
  function grp(k, o, f) { var s = RS(); return '<div style="display:flex;flex-wrap:wrap;gap:0 14px">' + o.map(function (v) { return chk(k + ':' + v, s[k].indexOf(v) >= 0, f(v)); }).join('') + '</div>'; }
  function render() {
    dot(); var p = document.getElementById('spx-panel'); if (!p || !open) return;
    var y = Y(), s = RS(), h = '<div class="spx-t" style="display:flex;gap:6px;align-items:center"><button data-a="tab" data-t="sync" class="' + (tab === 'sync' ? 'on' : '') + '">\u2601 Cloud sync</button><button data-a="tab" data-t="rem" class="' + (tab === 'rem' ? 'on' : '') + '">\uD83D\uDD14 Phone reminders</button><button data-a="close" style="margin-left:auto">\u2715</button></div>';
    if (tab === 'sync') {
      h += '<p style="color:#64748b;font-size:12px">Keeps shipments, invoices and settings the same on your phone and laptop. Theme and your operator profile stay on each device. Attachments (uploaded files) stay on the device that added them.</p>';
      if (!y.apiKey) h += '<h3>Step 1: connect Firebase</h3><textarea id="spx-cfg" rows="5" placeholder="Paste the Firebase config (apiKey and projectId)"></textarea><button class="p" data-a="cfg">Save</button>';
      else if (!y.refresh) h += '<h3>Step 2: sign in</h3><div style="color:#64748b;font-size:12px">Project: ' + esc(y.projectId) + '. Same email and password on every device. Create the account the first time.</div><input id="spx-e" type="email" placeholder="Email" autocomplete="username"><input id="spx-p" type="password" placeholder="Password (6+ characters)" autocomplete="current-password"><button class="p" data-a="in">Sign in</button><button data-a="up">Create account</button><button data-a="cfgreset">Change project</button>';
      else {
        h += '<h3>Connected as ' + esc(y.email) + '</h3><div>' + (y.conflict ? '<span class="spx-b r">Conflict</span>' : y.dirty ? '<span class="spx-b y">Changes waiting to upload</span>' : '<span class="spx-b g">Up to date</span>') + ' <small style="color:#64748b">Last sync: ' + (y.at ? fd(y.at) : 'not yet') + '</small></div>' + (y.err ? '<p style="color:#b91c1c">' + esc(y.err) + '</p>' : '');
        if (y.conflict) h += '<div style="background:#fee2e2;padding:8px;border-radius:8px;margin:8px 0"><b>The cloud and this device both have different changes.</b><br>Choose which version to keep. The other is replaced.<br><button data-a="kc">Keep the cloud version</button><button data-a="kl">Keep this device\'s version</button></div>';
        h += '<div style="margin-top:8px"><button class="p" data-a="sync">Sync now</button><button data-a="kl">Upload this device</button><button data-a="kc">Download cloud</button></div>' + chk('auto', y.auto !== false, 'Sync automatically') + '<button data-a="out">Sign out</button>';
      }
    } else {
      var nat = !!NAT(), sa = window.matchMedia && matchMedia('(display-mode: standalone)').matches, perm = window.Notification ? Notification.permission : 'not supported';
      h += '<h3>Phone reminders</h3>' + chk('rem', s.on, '<b>Allow notifications on this phone</b>') + '<div style="color:#64748b;font-size:12px;margin:0 0 6px 26px">' + (nat ? 'Android app: reminders are scheduled on your phone and arrive even when the app is closed.' : 'Browser (' + perm + '): reminders arrive only while this page is open. Use the Android app for closed-app reminders.') + '</div>' +
        '<h3>Notify me about</h3>' + chk('cut', s.cut, 'Cut-off deadlines') + chk('ves', s.ves, 'Vessel ETD / ETA') + chk('ts', s.ts, 'Transhipment arrival / departure') + chk('inv', s.inv, 'Vendor invoices due') +
        '<h3>Cut-off reminders</h3>' + grp('co', [7, 5, 3, 2, 1, 0], function (v) { return v === 0 ? 'On the day' : v + (v === 1 ? ' day' : ' days') + ' before'; }) +
        '<h3>Vessel / transhipment reminders</h3>' + grp('vo', [5, 3, 1, 0], function (v) { return v === 0 ? 'On the day' : v + (v === 1 ? ' day' : ' days') + ' before'; }) +
        '<h3>Invoice reminders</h3>' + grp('io', [7, 3, 1, 0], function (v) { return v === 0 ? 'Due date' : v + (v === 1 ? ' day' : ' days') + ' before'; }) +
        '<h3>Reminder time</h3><input type="time" value="' + esc(s.tm) + '" data-c="tm"><div><button class="p" data-a="rtest">Send test notification</button></div>' +
        '<h3>Next reminders</h3>' + (reminders().filter(function (r) { return r.at > now(); }).slice(0, 6).map(function (r) { return '<div style="padding:4px 0;border-bottom:1px solid #e2e8f0">' + esc(r.title) + '<br><small style="color:#64748b">' + esc(r.body) + ' \u2014 sent ' + fd(r.at) + '</small></div>'; }).join('') || '<small style="color:#64748b">Nothing scheduled.</small>');
    }
    p.innerHTML = h;
  }
  window.SPX = { syncNow: syncNow, open: openPanel, status: function () { var y = Y(); return { status: (!y.refresh || y.conflict || y.err) ? 'error' : 'synced', lastSynced: y.at ? new Date(y.at).toLocaleTimeString('en-GB', { hour12: false }) : '-' }; } };
  function boot() { mount(); setTimeout(function () { syncNow(); phoneSync(); }, 2500); setInterval(function () { syncNow(); webCheck(); }, 60000); addEventListener('focus', function () { syncNow(); }); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
