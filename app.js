"use strict";
(function () {
  /* ---------------- data ---------------- */
  var MATERIALS = [];
  var PRICE = {}; // item unit costs — never rendered in the UI, exports only
  (window.MATERIALS_TSV || "").split("\n").forEach(function (l) {
    var f = l.split("\t");
    if (f.length < 2 || !f[0]) return;
    MATERIALS.push({ c: f[0], d: f[1] || "" });
    if (f.length > 2) {
      var pv = parseFloat(String(f[2]).replace(/[^0-9.\-]/g, ""));
      if (isFinite(pv)) PRICE[f[0]] = pv;
    }
  });
  function priceOf(code) { return Object.prototype.hasOwnProperty.call(PRICE, code) ? PRICE[code] : null; }
  function money(n) { return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

  var LINE_GROUPS = [
    { g: "Aerosol", items: [["Aerosol A", "A"], ["Aerosol B", "B"], ["Aerosol C", "C"], ["Aerosol D", "D"]] },
    { g: "Pops", items: [["Pops A", "A"], ["Pops B", "B"], ["Pops C", "C"], ["Pops D", "D"], ["Pops E", "E"]] },
    { g: "Drinks", items: [["Rainbow (Drinks)", "Rainbow"]] },
    { g: "Gallon", items: [["Gallon", "1 Gal"], ["2.5 Gallon", "2.5 Gal"]] },
    {
      g: "Processing", full: true,
      items: [
        ["Processing A", "A"], ["Processing B", "B"], ["Processing C", "C"], ["Processing D", "D"],
        ["Pops Processing", "Pops"], ["Drinks Processing", "Drinks"],
      ],
    },
  ];
  // Team roster shown in the "Entered by" dropdown — edit names here.
  var TEAM = ["Dafne", "Marlen", "Marina", "Brooklyn"];

  var ALL_LINES = [];
  LINE_GROUPS.forEach(function (g) { g.items.forEach(function (it) { ALL_LINES.push(it[0]); }); });

  /* ---------------- helpers ---------------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function todayStr() {
    var d = new Date();
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function yesterdayStr() {
    var d = new Date();
    d.setDate(d.getDate() - 1);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function cutoffDay() {
    var d = new Date();
    d.setDate(d.getDate() - 5);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function enteredDay(ts) {
    var d = new Date(ts || 0);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function fmtDay(day) {
    var p = (day || "").split("-").map(Number);
    if (!p[0]) return day || "";
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }
  function fmtDate(s) {
    var p = (s || "").split("-").map(Number);
    if (!p[0] || !p[1] || !p[2]) return s || "—";
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  function fmtTime(ts) {
    return new Date(ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
  function fmtQty(q) { return Number(q).toLocaleString("en-US", { maximumFractionDigits: 3 }); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function $(id) { return document.getElementById(id); }

  /* ---------------- storage adapters ---------------- */
  var cfg = window.APP_CONFIG || {};
  var SHARED = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  var TABLE = cfg.TABLE || "usage_entries";
  var LS_KEY = "material-usage-entries";
  var NAME_KEY = "material-usage-name";

  // Every adapter returns entries shaped: {id, code, desc, qty, date, lines[], ts}
  var store;
  if (SHARED) {
    var BASE = cfg.SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/" + TABLE;
    var HEADERS = {
      apikey: cfg.SUPABASE_ANON_KEY,
      Authorization: "Bearer " + cfg.SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    };
    var norm = function (r) {
      return {
        id: r.id, code: r.code, desc: r.description, qty: Number(r.qty),
        lot: r.lot || "", po: r.po || "",
        shifts: (r.shifts && r.shifts.length ? r.shifts : (r.shift == null ? [] : [r.shift])).map(Number),
        by: r.entered_by || "", note: r.note || "", rectified: !!r.rectified,
        date: r.used_on, lines: r.lines || [], ts: Date.parse(r.created_at) || Date.now(),
      };
    };
    store = {
      shared: true,
      load: function () {
        return fetch(BASE + "?select=*&order=used_on.desc,created_at.desc", { headers: HEADERS })
          .then(function (r) { if (!r.ok) throw new Error("load " + r.status); return r.json(); })
          .then(function (rows) { return rows.map(norm); });
      },
      save: function (e) {
        var body = JSON.stringify([{ code: e.code, description: e.desc, qty: e.qty, lot: e.lot || null, po: e.po || null, shifts: e.shifts, entered_by: e.by || null, note: e.note || null, used_on: e.date, lines: e.lines }]);
        return fetch(BASE, {
          method: "POST",
          headers: Object.assign({ Prefer: "return=representation" }, HEADERS),
          body: body,
        })
          .then(function (r) {
            if (!r.ok) {
              return r.json().catch(function () { return {}; }).then(function (j) {
                throw new Error(j.message || j.hint || ("HTTP " + r.status));
              });
            }
            return r.json();
          })
          .then(function (rows) { return norm(rows[0]); });
      },
      remove: function (id) {
        return fetch(BASE + "?id=eq." + encodeURIComponent(id), { method: "DELETE", headers: HEADERS })
          .then(function (r) { if (!r.ok) throw new Error("delete " + r.status); });
      },
      update: function (id, fields) {
        return fetch(BASE + "?id=eq." + encodeURIComponent(id), {
          method: "PATCH",
          headers: Object.assign({ Prefer: "return=representation" }, HEADERS),
          body: JSON.stringify(fields),
        })
          .then(function (r) { if (!r.ok) throw new Error("update " + r.status); return r.json(); })
          .then(function (rows) { if (!rows.length) throw new Error("no row updated"); });
      },
    };
  } else {
    var lsRead = function () {
      try {
        var x = JSON.parse(localStorage.getItem(LS_KEY) || "[]");
        return Array.isArray(x) ? x : [];
      } catch (e) { return []; }
    };
    var lsWrite = function (list) { localStorage.setItem(LS_KEY, JSON.stringify(list)); };
    var legacyShifts = function (e) {
      if (e.shifts) return e;
      return Object.assign({}, e, { shifts: e.shift == null ? [] : [Number(e.shift)] });
    };
    store = {
      shared: false,
      load: function () { return Promise.resolve(lsRead().map(legacyShifts)); },
      save: function (e) {
        var entry = Object.assign({}, e, { id: uid(), ts: Date.now() });
        var list = lsRead(); list.push(entry); lsWrite(list);
        return Promise.resolve(entry);
      },
      remove: function (id) {
        lsWrite(lsRead().filter(function (e) { return e.id !== id; }));
        return Promise.resolve();
      },
      update: function (id, fields) {
        lsWrite(lsRead().map(function (e) { return e.id === id ? Object.assign({}, e, fields) : e; }));
        return Promise.resolve();
      },
    };
  }

  /* ---------------- state ---------------- */
  var S = {
    entries: [], sel: null, linesSel: [], shifts: [], copySel: {}, shown: [], hi: 0,
    confirmId: null, confirmTimer: null, toastTimer: null, saving: false, editNoteId: null,
    ftext: "", fline: "", fdate: "", fstatus: "recent", fname: "", fstatus: "", fname: "",
  };

  /* ---------------- init ---------------- */
  function init() {
    $("dateInput").value = yesterdayStr();
    var nameSel = $("nameSelect");
    nameSel.innerHTML = '<option value="">Select name\u2026</option>' +
      TEAM.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + "</option>"; }).join("") +
      '<option value="__other">Other \u2014 type name</option>';
    var storedName = "";
    try { storedName = localStorage.getItem(NAME_KEY) || ""; } catch (e) {}
    if (storedName) {
      if (TEAM.indexOf(storedName) !== -1) nameSel.value = storedName;
      else { nameSel.value = "__other"; $("nameOther").value = storedName; $("nameOther").classList.remove("hidden"); }
    }
    $("matCount").textContent = MATERIALS.length.toLocaleString("en-US");

    setStatus(store.shared ? "loading" : "local");
    $("subline").textContent = store.shared
      ? "Shared team log — entries saved here are visible to everyone who opens this page."
      : "Entries are saved in this browser only. See README.md to set up a shared team database.";

    buildBoard();
    buildLineFilter();
    wireEvents();
    renderLog();

    store.load().then(function (list) {
      S.entries = list;
      setStatus(store.shared ? "ok" : "local");
      refreshNameFilter();
      renderLog();
    }).catch(function () {
      setStatus("err");
      renderLog();
    });
  }

  function setStatus(mode) {
    var pill = $("statusPill"), text = $("statusText");
    pill.className = "pill";
    if (mode === "ok") { pill.classList.add("pill-ok"); text.textContent = "Live shared log"; }
    else if (mode === "loading") { pill.classList.add("pill-warn"); text.textContent = "Connecting…"; }
    else if (mode === "err") { pill.classList.add("pill-err"); text.textContent = "Shared DB unreachable"; }
    else { pill.classList.add("pill-warn"); text.textContent = "Saved on this device only"; }
    if (store.shared) $("refreshBtn").classList.remove("hidden");
  }

  function getName() {
    var v = $("nameSelect").value;
    return v === "__other" ? $("nameOther").value.trim() : v;
  }

  /* ---------------- line board ---------------- */
  function buildBoard() {
    var html = LINE_GROUPS.map(function (g) {
      var chips = g.items.map(function (it) {
        return '<button type="button" class="chip" data-line="' + esc(it[0]) + '" aria-pressed="false" title="' +
          esc(it[0]) + '"><span class="lamp"></span>' + esc(it[1]) + "</button>";
      }).join("");
      return '<div class="board-row' + (g.full ? " full" : "") + '"><span class="gname">' + esc(g.g) + '</span><div class="chips">' + chips + "</div></div>";
    }).join("");
    $("board").innerHTML = html;
  }

  function syncBoard() {
    var chips = $("board").querySelectorAll(".chip");
    chips.forEach(function (ch) {
      var on = S.linesSel.indexOf(ch.getAttribute("data-line")) !== -1;
      ch.classList.toggle("on", on);
      ch.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var n = S.linesSel.length;
    $("selSummary").textContent = n ? n + " line" + (n > 1 ? "s" : "") + " selected" : "";
    syncClearBtn();
  }

  function syncShifts() {
    var btns = $("shiftGroup").querySelectorAll(".chip");
    btns.forEach(function (b) {
      var on = S.shifts.indexOf(Number(b.getAttribute("data-shift"))) !== -1;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    syncClearBtn();
  }

  function buildLineFilter() {
    var sel = $("lineFilter");
    LINE_GROUPS.forEach(function (g) {
      var og = document.createElement("optgroup");
      og.label = g.g;
      g.items.forEach(function (it) {
        var o = document.createElement("option");
        o.value = it[0]; o.textContent = it[0];
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
  }

  /* ---------------- material combobox ---------------- */
  function search(q) {
    q = q.trim().toUpperCase();
    if (!q) return [];
    var toks = q.split(/\s+/), out = [];
    for (var i = 0; i < MATERIALS.length; i++) {
      var m = MATERIALS[i];
      var C = m.c.toUpperCase();
      var hay = C + " " + m.d.toUpperCase();
      var all = true;
      for (var t = 0; t < toks.length; t++) if (hay.indexOf(toks[t]) === -1) { all = false; break; }
      if (!all) continue;
      var score = C === q ? 0 : C.indexOf(toks[0]) === 0 ? 1 : C.indexOf(toks[0]) !== -1 ? 2 : 3;
      out.push([score, m]);
    }
    out.sort(function (a, b) { return a[0] - b[0] || (a[1].c > b[1].c ? 1 : -1); });
    return out.map(function (x) { return x[1]; });
  }

  function renderDrop() {
    var drop = $("matDrop");
    var q = $("matInput").value;
    var selLabel = S.sel ? S.sel.c + " — " + S.sel.d : null;
    if (!q.trim() || q === selLabel) { drop.classList.add("hidden"); return; }

    var results = search(q);
    S.shown = results.slice(0, 50);
    if (S.hi >= S.shown.length) S.hi = 0;

    var html = S.shown.map(function (m, i) {
      return '<button type="button" class="opt' + (i === S.hi ? " hi" : "") + '" data-idx="' + i + '">' +
        '<span class="mono opt-code">' + esc(m.c) + '</span><span class="opt-desc">' + esc(m.d) + "</span></button>";
    }).join("");
    if (results.length > 50) {
      html += '<div class="more">…' + (results.length - 50) + " more — keep typing to narrow it down</div>";
    }
    if (S.shown.length === 0 && !S.sel) {
      html += '<button type="button" class="opt" data-unlisted="1"><span class="opt-desc">' +
        "No match in the item list — use \u201C" + esc(q.trim()) + "\u201D as an unlisted code</span></button>";
    }
    if (!html) { drop.classList.add("hidden"); return; }
    drop.innerHTML = html;
    drop.classList.remove("hidden");
  }

  function pickMaterial(m) {
    S.sel = m;
    $("matInput").value = m.c + " — " + m.d;
    $("matDrop").classList.add("hidden");
    $("pickedCode").textContent = m.c;
    $("pickedDesc").textContent = m.d;
    $("pickedBox").classList.remove("hidden");
    hideErr();
    syncClearBtn();
  }
  function clearPick() {
    S.sel = null;
    $("pickedBox").classList.add("hidden");
  }

  /* ---------------- form actions ---------------- */
  function syncClearBtn() {
    var dirty = S.sel || $("matInput").value || $("qtyInput").value || $("lotInput").value || $("poInput").value || $("noteInput").value || S.shifts.length || S.linesSel.length;
    $("clearBtn").classList.toggle("hidden", !dirty);
  }
  function showErr(msg) { var b = $("errBox"); b.textContent = msg; b.classList.remove("hidden"); }
  function hideErr() { $("errBox").classList.add("hidden"); }
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(S.toastTimer);
    S.toastTimer = setTimeout(function () { t.classList.add("hidden"); }, 2600);
  }

  function loadExample() {
    var m = null;
    for (var i = 0; i < MATERIALS.length; i++) if (MATERIALS[i].c === "10498") { m = MATERIALS[i]; break; }
    pickMaterial(m || MATERIALS[0]);
    $("lotInput").value = "S340C";
    $("qtyInput").value = "250";
    $("dateInput").value = yesterdayStr();
    S.shifts = [3];
    syncShifts();
    S.linesSel = ["Processing B", "Processing C"];
    syncBoard();
    $("noteInput").value = "Found during batch reconcile — 250 short on MAS.";
    $("exampleNote").classList.remove("hidden");
    hideErr();
  }
  function clearForm() {
    clearPick();
    $("matInput").value = "";
    $("lotInput").value = "";
    $("poInput").value = "";
    $("qtyInput").value = "";
    $("noteInput").value = "";
    $("dateInput").value = yesterdayStr();
    S.shifts = [];
    syncShifts();
    S.linesSel = [];
    syncBoard();
    $("exampleNote").classList.add("hidden");
    $("matDrop").classList.add("hidden");
    hideErr();
    syncClearBtn();
  }

  function saveEntry() {
    if (S.saving) return;
    var qty = $("qtyInput").value, date = $("dateInput").value;
    var missing = [];
    if (!S.sel) missing.push("a material");
    if (!qty || Number(qty) <= 0) missing.push("a quantity");
    if (!date) missing.push("a date");
    if (!S.shifts.length) missing.push("a shift");
    if (!getName()) missing.push("your name");
    if (S.linesSel.length === 0) missing.push("at least one line");
    if (missing.length) { showErr("Add " + missing.join(", ") + "."); return; }
    hideErr();

    var entry = {
      code: S.sel.c, desc: S.sel.d, qty: Number(qty), date: date,
      lot: $("lotInput").value.trim(), po: $("poInput").value.trim(), shifts: S.shifts.slice().sort(),
      by: getName(), note: $("noteInput").value.trim(), rectified: false,
      lines: ALL_LINES.filter(function (l) { return S.linesSel.indexOf(l) !== -1; }),
    };
    S.saving = true;
    $("saveBtn").disabled = true;
    $("saveBtn").textContent = "Saving…";
    store.save(entry).then(function (saved) {
      S.entries.push(saved);
      refreshNameFilter();
      clearPick();
      $("matInput").value = "";
      $("lotInput").value = "";
      $("poInput").value = "";
      $("qtyInput").value = "";
      $("noteInput").value = "";
      try { localStorage.setItem(NAME_KEY, saved.by || ""); } catch (e2) {}
      $("exampleNote").classList.add("hidden");
      renderLog();
      syncClearBtn();
      toast(store.shared
        ? "Saved — " + saved.code + " on " + saved.lines.length + " line" + (saved.lines.length > 1 ? "s" : "")
        : "Saved on this device — " + saved.code);
      $("matInput").focus();
    }).catch(function (err) {
      var why = err && err.message && err.message !== "Failed to fetch" ? err.message : "check your connection and try again";
      showErr("Couldn't save the entry — " + why + ". (If this mentions a missing column, run the SQL update from the README.)");
    }).finally(function () {
      S.saving = false;
      $("saveBtn").disabled = false;
      $("saveBtn").textContent = "Save entry";
    });
  }

  /* ---------------- copy table for approval ---------------- */
  function copyText(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t);
    try {
      var ta = document.createElement("textarea");
      ta.value = t;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      return Promise.resolve();
    } catch (e) { return Promise.reject(e); }
  }

  /* ---------------- log ---------------- */
  function visibleEntries() {
    var q = S.ftext.trim().toUpperCase();
    var cut = cutoffDay();
    return S.entries.filter(function (e) {
      if (S.fstatus === "open" && e.rectified) return false;
      if (S.fstatus === "resolved" && !e.rectified) return false;
      if (S.fstatus === "" && e.rectified && enteredDay(e.ts) < cut) return false;
      if (S.fname && (e.by || "") !== S.fname) return false;
      if (S.fdate && e.date !== S.fdate) return false;
      if (S.fline && (e.lines || []).indexOf(S.fline) === -1) return false;
      if (q && (e.code + " " + e.desc + " " + (e.lot || "") + " " + (e.po || "") + " " + (e.by || "") + " " + (e.note || "")).toUpperCase().indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) {
      var da = enteredDay(a.ts), db = enteredDay(b.ts);
      if (da < db) return 1;
      if (da > db) return -1;
      if (a.date < b.date) return 1;
      if (a.date > b.date) return -1;
      return (b.ts || 0) - (a.ts || 0);
    });
  }

  function refreshNameFilter() {
    var sel = $("nameFilter");
    var have = {};
    TEAM.forEach(function (n) { have[n] = 1; });
    S.entries.forEach(function (e) { if (e.by) have[e.by] = 1; });
    var names = Object.keys(have).sort();
    var cur = S.fname;
    sel.innerHTML = '<option value="">All names</option>' +
      names.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + "</option>"; }).join("");
    if (cur && names.indexOf(cur) !== -1) sel.value = cur;
    else { sel.value = ""; S.fname = ""; }
  }

  function updateCopyLabel(vis) {
    var selCount = vis.filter(function (e) { return S.copySel[e.id]; }).length;
    $("copyTableBtn").textContent = selCount
      ? "Copy table (" + selCount + " selected)"
      : "Copy table (" + vis.length + ")";
    $("copyTableBtn").disabled = vis.length === 0;
    var all = $("selAll");
    if (all) {
      var elig = vis.filter(function (e) { return !e.rectified; });
      var eligSel = elig.filter(function (e) { return S.copySel[e.id]; }).length;
      all.disabled = elig.length === 0;
      all.checked = elig.length > 0 && eligSel === elig.length;
      all.indeterminate = !all.checked && selCount > 0;
    }
    $("clearSelBtn").classList.toggle("hidden", Object.keys(S.copySel).length === 0);
  }

  function setRowSel(id, on, tr) {
    if (on) S.copySel[id] = true; else delete S.copySel[id];
    if (tr) {
      tr.classList.toggle("is-sel", on);
      var cb = tr.querySelector("[data-sel]");
      if (cb) cb.checked = on;
    }
    var vis = visibleEntries();
    var ent = null;
    for (var i = 0; i < S.entries.length; i++) if (S.entries[i].id === id) { ent = S.entries[i]; break; }
    if (ent) {
      var day = enteredDay(ent.ts);
      var gcb = document.querySelector('#logArea [data-grpsel="' + day + '"]');
      if (gcb) {
        var rowsD = vis.filter(function (r) { return enteredDay(r.ts) === day; });
        var eligD = rowsD.filter(function (r) { return !r.rectified; });
        var cE = eligD.filter(function (r) { return S.copySel[r.id]; }).length;
        var cAll = rowsD.filter(function (r) { return S.copySel[r.id]; }).length;
        gcb.disabled = eligD.length === 0;
        gcb.checked = eligD.length > 0 && cE === eligD.length;
        gcb.indeterminate = !gcb.checked && cAll > 0;
      }
    }
    updateCopyLabel(vis);
  }

  function syncNameFilter() {
    var nf = $("nameFilter");
    var names = {};
    S.entries.forEach(function (e) { if (e.by) names[e.by] = 1; });
    var list = Object.keys(names).sort();
    var sig = list.join("|");
    if (nf.getAttribute("data-sig") === sig) return;
    if (S.fname && list.indexOf(S.fname) === -1) S.fname = "";
    nf.innerHTML = '<option value="">All names</option>' +
      list.map(function (n) { return '<option value="' + esc(n) + '">' + esc(n) + "</option>"; }).join("");
    nf.setAttribute("data-sig", sig);
    nf.value = S.fname;
  }

  function syncResetBtn() {
    var active = S.ftext || S.fdate || S.fname || S.fline || S.fstatus !== "recent";
    $("resetFilters").classList.toggle("hidden", !active);
  }

  function renderLog() {
    syncNameFilter();
    syncResetBtn();
    var area = $("logArea");
    var vis = visibleEntries();
    var n = S.entries.length;
    $("entryCount").textContent = n + (n === 1 ? " entry" : " entries");
    $("exportBtn").textContent = "Export CSV (" + vis.length + ")";
    $("exportBtn").disabled = vis.length === 0;

    if (vis.length === 0) {
      area.innerHTML = '<div class="empty">' + (n === 0
        ? "No usage logged yet. Fill out the ticket above — or press <strong>Load example</strong> to see how one is filled."
        : "No entries match these filters.") + "</div>";
      updateCopyLabel(vis);
      return;
    }

    var mk = function (tag, cls, text) {
      var el = document.createElement(tag);
      if (cls) el.className = cls;
      if (text != null) el.textContent = text;
      return el;
    };

    var wrap = mk("div", "tbl-wrap");
    var tbl = mk("table", "tbl");
    var thead = document.createElement("thead");
    var hr = document.createElement("tr");
    var thSel = mk("th", "c-sel");
    var selAll = document.createElement("input");
    selAll.type = "checkbox";
    selAll.id = "selAll";
    selAll.title = "Select all shown";
    thSel.appendChild(selAll);
    hr.appendChild(thSel);
    hr.appendChild(mk("th", "c-r", ""));
    [["c-date", "Batch/Production date"], [null, "Item (MAS)"], [null, "Lot code"], [null, "Description"],
     [null, "Line"], [null, "Shift"], ["c-qty", "Qtty missing"], [null, "Note"], [null, "Name"], [null, ""]
    ].forEach(function (c) { hr.appendChild(mk("th", c[0] || "", c[1])); });
    thead.appendChild(hr);
    tbl.appendChild(thead);

    var tbody = document.createElement("tbody");
    var days = [], byDay = {};
    vis.forEach(function (e) {
      var d = enteredDay(e.ts);
      if (!byDay[d]) { byDay[d] = []; days.push(d); }
      byDay[d].push(e);
    });

    var renderRow = function (e) {
      var tr = document.createElement("tr");
      tr.dataset.id = e.id;
      if (e.rectified) tr.classList.add("is-done");
      if (S.copySel[e.id]) tr.classList.add("is-sel");

      var tdSel = mk("td", "c-sel");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.setAttribute("data-sel", e.id);
      cb.checked = !!S.copySel[e.id];
      tdSel.appendChild(cb);
      tr.appendChild(tdSel);

      var tdR = mk("td", "c-r");
      var rb = mk("button", "rect" + (e.rectified ? " on" : ""), "\u2713");
      rb.type = "button";
      rb.setAttribute("data-rect", e.id);
      rb.setAttribute("aria-pressed", e.rectified ? "true" : "false");
      rb.title = e.rectified ? "Being rectified — click to unmark" : "Mark as being rectified";
      tdR.appendChild(rb);
      tr.appendChild(tdR);

      tr.appendChild(mk("td", "c-date", fmtDate(e.date)));
      tr.appendChild(mk("td", "c-code", e.code));
      tr.appendChild(mk("td", "c-lot", e.lot || (e.po ? "PO " + e.po : "")));
      tr.appendChild(mk("td", "c-desc", e.desc));
      tr.appendChild(mk("td", "c-line", (e.lines || []).join(", ")));
      tr.appendChild(mk("td", null, (e.shifts || []).join(", ")));
      tr.appendChild(mk("td", "c-qty", fmtQty(e.qty)));
      var tdN = mk("td", "c-note");
      if (S.editNoteId === e.id) {
        var ta = document.createElement("textarea");
        ta.className = "note-ta";
        ta.value = e.note || "";
        ta.setAttribute("data-noteta", e.id);
        tdN.appendChild(ta);
        var nba = mk("div", "note-edit-actions");
        var sv = mk("button", "ghost sm", "Save");
        sv.type = "button"; sv.setAttribute("data-notesave", e.id);
        var cx = mk("button", "ghost sm", "Cancel");
        cx.type = "button"; cx.setAttribute("data-notecancel", e.id);
        nba.appendChild(sv); nba.appendChild(cx);
        tdN.appendChild(nba);
      } else {
        tdN.textContent = e.note || "";
      }
      tr.appendChild(tdN);
      tr.appendChild(mk("td", null, e.by || ""));

      var tdA = mk("td", "c-act");
      var nb = mk("button", "ghost sm", "Note");
      nb.type = "button";
      nb.setAttribute("data-noteedit", e.id);
      nb.title = "Add or edit the note — for context found later";
      tdA.appendChild(nb);
      var ru = mk("button", "ghost sm", "Reuse");
      ru.type = "button";
      ru.setAttribute("data-reuse", e.id);
      ru.title = "Refill the form with this material and lines";
      tdA.appendChild(ru);
      if (S.confirmId === e.id) {
        var cd = mk("button", "ghost sm danger", "Confirm delete");
        cd.type = "button";
        cd.setAttribute("data-del", e.id);
        tdA.appendChild(cd);
      } else {
        var dl = mk("button", "ghost sm", "Delete");
        dl.type = "button";
        dl.setAttribute("data-ask", e.id);
        tdA.appendChild(dl);
      }
      tr.appendChild(tdA);
      tbody.appendChild(tr);
    };

    days.forEach(function (day) {
      var rows = byDay[day];
      var gtr = document.createElement("tr");
      gtr.className = "grp";
      gtr.dataset.grp = day;
      var gtd = mk("td", "c-sel");
      var gcb = document.createElement("input");
      gcb.type = "checkbox";
      gcb.setAttribute("data-grpsel", day);
      gcb.title = "Select everything entered this day";
      var elig = rows.filter(function (r) { return !r.rectified; });
      var eligSel = elig.filter(function (r) { return S.copySel[r.id]; }).length;
      var anySel = rows.filter(function (r) { return S.copySel[r.id]; }).length;
      gcb.disabled = elig.length === 0;
      gcb.checked = elig.length > 0 && eligSel === elig.length;
      gcb.indeterminate = !gcb.checked && anySel > 0;
      gtd.appendChild(gcb);
      gtr.appendChild(gtd);
      var lab = mk("td", "grp-lab", "Entered " + fmtDay(day) + " \u00b7 " + rows.length + (rows.length === 1 ? " entry" : " entries"));
      lab.colSpan = 11;
      gtr.appendChild(lab);
      tbody.appendChild(gtr);
      rows.forEach(renderRow);
    });

    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
    area.innerHTML = "";
    area.appendChild(wrap);
    updateCopyLabel(vis);
  }

  function removeEntry(id) {
    S.confirmId = null;
    clearTimeout(S.confirmTimer);
    store.remove(id).then(function () {
      S.entries = S.entries.filter(function (e) { return e.id !== id; });
      delete S.copySel[id];
      renderLog();
      toast("Entry deleted");
    }).catch(function () {
      renderLog();
      toast("Couldn't delete — try again");
    });
  }

  function reuse(id) {
    var e = null;
    for (var i = 0; i < S.entries.length; i++) if (S.entries[i].id === id) { e = S.entries[i]; break; }
    if (!e) return;
    pickMaterial({ c: e.code, d: e.desc });
    S.linesSel = (e.lines || []).filter(function (l) { return ALL_LINES.indexOf(l) !== -1; });
    syncBoard();
    $("lotInput").value = e.lot || "";
    $("poInput").value = e.po || "";
    $("qtyInput").value = "";
    $("dateInput").value = yesterdayStr();
    $("exampleNote").classList.add("hidden");
    window.scrollTo({ top: 0, behavior: "smooth" });
    setTimeout(function () { $("qtyInput").focus(); }, 350);
  }

  function toggleRect(id) {
    var e = null;
    for (var i = 0; i < S.entries.length; i++) if (S.entries[i].id === id) { e = S.entries[i]; break; }
    if (!e) return;
    var next = !e.rectified;
    store.update(id, { rectified: next }).then(function () {
      e.rectified = next;
      renderLog();
      toast(next ? "Marked as being rectified" : "Rectification unmarked");
    }).catch(function () {
      toast("Couldn't update — try again");
    });
  }

  function copyTable() {
    var pool = visibleEntries();
    var chosen = pool.filter(function (e) { return S.copySel[e.id]; });
    var vis = chosen.length ? chosen : pool;
    if (!vis.length) return;
    var clean = function (c) { return String(c == null ? "" : c).replace(/[\t\n\r]+/g, " "); };
    var head = ["Batch/Production date", "Item (MAS)", "Lot code", "Description", "Line", "Shift", "Qtty missing", "$ Total", "Note", "Name", "Date entered"];
    var data = vis.map(function (e) {
      var up = priceOf(e.code);
      var tot = up != null ? money(up * Number(e.qty)) : "";
      return [e.date, e.code, e.lot || (e.po ? "PO " + e.po : ""), e.desc, (e.lines || []).join(", "), (e.shifts || []).join(", "), fmtQty(e.qty), tot, e.note || "", e.by || "", fmtDate(enteredDay(e.ts))];
    });
    var daysIn = {};
    vis.forEach(function (e) { daysIn[enteredDay(e.ts)] = true; });
    var dayKeys = Object.keys(daysIn);
    var title = "MAS material adjustments for approval" +
      (dayKeys.length === 1 ? " \u2014 entered " + fmtDate(dayKeys[0]) : "") +
      " (" + vis.length + ")";
    var tsv = title + "\n" + [head].concat(data).map(function (r) { return r.map(clean).join("\t"); }).join("\n");
    var cellCss = "border:1px solid #8a8a8a;padding:4px 8px;";
    var th = head.map(function (x) { return '<th style="' + cellCss + 'background:#efefef;text-align:left">' + esc(x) + "</th>"; }).join("");
    var trs = data.map(function (r, i) {
      var pretty = r.slice(); pretty[0] = fmtDate(vis[i].date);
      return "<tr>" + pretty.map(function (c) { return '<td style="' + cellCss + '">' + esc(c) + "</td>"; }).join("") + "</tr>";
    }).join("");
    var html = '<div style="font:13px Arial,sans-serif"><div style="font-weight:bold;margin-bottom:6px">' + esc(title) +
      '</div><table style="border-collapse:collapse;font:13px Arial,sans-serif"><tr>' + th + "</tr>" + trs + "</table></div>";
    var done = function () { toast("Table copied — paste it into an email or Excel"); };
    var fail = function () { toast("Couldn't copy — use Export CSV instead"); };
    if (navigator.clipboard && window.ClipboardItem && navigator.clipboard.write) {
      navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([tsv], { type: "text/plain" }),
      })]).then(done).catch(function () { copyText(tsv).then(done).catch(fail); });
    } else {
      copyText(tsv).then(done).catch(fail);
    }
  }

  function saveNote(id) {
    var ta = document.querySelector('[data-noteta="' + id + '"]');
    if (!ta) return;
    var v = ta.value.trim();
    store.update(id, { note: v }).then(function () {
      for (var i = 0; i < S.entries.length; i++) if (S.entries[i].id === id) { S.entries[i].note = v; break; }
      S.editNoteId = null;
      renderLog();
      toast("Note updated");
    }).catch(function () {
      toast("Couldn't update the note — try again");
    });
  }

  function refresh() {
    setStatus("loading");
    store.load().then(function (list) {
      S.entries = list;
      setStatus("ok");
      refreshNameFilter();
      renderLog();
      toast("Log refreshed");
    }).catch(function () {
      setStatus("err");
      toast("Couldn't reach the shared database");
    });
  }

  function requestExport() {
    if (!cfg.EXPORT_PASSWORD) { doExportCsv(); return; }
    $("pwInput").value = "";
    $("pwErr").classList.add("hidden");
    $("pwModal").classList.remove("hidden");
    setTimeout(function () { $("pwInput").focus(); }, 50);
  }
  function closePw() { $("pwModal").classList.add("hidden"); }
  function tryPw() {
    if ($("pwInput").value === cfg.EXPORT_PASSWORD) {
      closePw();
      doExportCsv();
    } else {
      $("pwErr").classList.remove("hidden");
      $("pwInput").value = "";
      $("pwInput").focus();
    }
  }

  function doExportCsv() {
    var vis = visibleEntries();
    var cell = function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; };
    var rows = [["Batch/Production date", "Item (MAS)", "Lot code", "PO", "Description", "Line", "Shift", "Qtty missing", "Unit $", "$ Total", "Note", "Name", "Date entered", "Rectified", "Logged at"]];
    vis.forEach(function (e) {
      var up = priceOf(e.code);
      rows.push([e.date, e.code, e.lot || "", e.po || "", e.desc, (e.lines || []).join("; "), (e.shifts || []).join(", "), e.qty,
        up != null ? up.toFixed(2) : "", up != null ? (up * Number(e.qty)).toFixed(2) : "",
        e.note || "", e.by || "", enteredDay(e.ts), e.rectified ? "Yes" : "", new Date(e.ts).toLocaleString()]);
    });
    var csv = rows.map(function (r) { return r.map(cell).join(","); }).join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "material-usage-log_" + todayStr() + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("CSV exported");
  }

  /* ---------------- events ---------------- */
  function wireEvents() {
    var matInput = $("matInput"), drop = $("matDrop");

    matInput.addEventListener("input", function () {
      clearPick(); S.hi = 0; renderDrop(); syncClearBtn();
    });
    matInput.addEventListener("focus", renderDrop);
    matInput.addEventListener("blur", function () {
      setTimeout(function () { drop.classList.add("hidden"); }, 150);
    });
    matInput.addEventListener("keydown", function (e) {
      if (drop.classList.contains("hidden")) return;
      if (e.key === "ArrowDown") { e.preventDefault(); S.hi = Math.min(S.hi + 1, S.shown.length - 1); renderDrop(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); S.hi = Math.max(S.hi - 1, 0); renderDrop(); }
      else if (e.key === "Enter") {
        e.preventDefault();
        if (S.shown[S.hi]) pickMaterial(S.shown[S.hi]);
        else if (matInput.value.trim() && !S.sel) pickMaterial({ c: matInput.value.trim(), d: "(not in item list)" });
      } else if (e.key === "Escape") { drop.classList.add("hidden"); }
    });

    drop.addEventListener("mousedown", function (e) { e.preventDefault(); });
    drop.addEventListener("click", function (e) {
      var opt = e.target.closest(".opt");
      if (!opt) return;
      if (opt.hasAttribute("data-unlisted")) {
        pickMaterial({ c: matInput.value.trim(), d: "(not in item list)" });
      } else {
        var m = S.shown[Number(opt.getAttribute("data-idx"))];
        if (m) pickMaterial(m);
      }
    });

    $("board").addEventListener("click", function (e) {
      var chip = e.target.closest(".chip");
      if (!chip) return;
      var id = chip.getAttribute("data-line");
      var i = S.linesSel.indexOf(id);
      if (i === -1) S.linesSel.push(id); else S.linesSel.splice(i, 1);
      syncBoard();
    });

    $("qtyInput").addEventListener("input", syncClearBtn);
    $("lotInput").addEventListener("input", syncClearBtn);
    $("poInput").addEventListener("input", syncClearBtn);
    $("noteInput").addEventListener("input", syncClearBtn);
    $("shiftGroup").addEventListener("click", function (e) {
      var b = e.target.closest(".chip");
      if (!b) return;
      var v = Number(b.getAttribute("data-shift"));
      var i = S.shifts.indexOf(v);
      if (i === -1) S.shifts.push(v); else S.shifts.splice(i, 1);
      S.shifts.sort();
      syncShifts();
    });
    $("nameSelect").addEventListener("change", function () {
      $("nameOther").classList.toggle("hidden", this.value !== "__other");
      if (this.value === "__other") $("nameOther").focus();
      syncClearBtn();
    });
    $("nameOther").addEventListener("input", syncClearBtn);
    $("saveBtn").addEventListener("click", saveEntry);
    $("clearBtn").addEventListener("click", clearForm);
    $("exampleBtn").addEventListener("click", loadExample);
    $("refreshBtn").addEventListener("click", refresh);
    $("selectAllBtn").addEventListener("click", function () {
      visibleEntries().forEach(function (en) { if (!en.rectified) S.copySel[en.id] = true; });
      renderLog();
    });
    $("clearSelBtn").addEventListener("click", function () { S.copySel = {}; renderLog(); });
    $("copyTableBtn").addEventListener("click", copyTable);
    $("exportBtn").addEventListener("click", requestExport);
    $("pwOk").addEventListener("click", tryPw);
    $("pwCancel").addEventListener("click", closePw);
    $("pwModal").addEventListener("click", function (e) { if (e.target === this) closePw(); });
    $("pwInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") tryPw();
      if (e.key === "Escape") closePw();
    });

    $("searchInput").addEventListener("input", function () { S.ftext = this.value; renderLog(); });
    $("lineFilter").addEventListener("change", function () { S.fline = this.value; renderLog(); });
    $("statusFilter").addEventListener("change", function () { S.fstatus = this.value; renderLog(); });
    $("nameFilter").addEventListener("change", function () { S.fname = this.value; renderLog(); });
    $("resetFilters").addEventListener("click", function () {
      S.ftext = ""; S.fdate = ""; S.fname = ""; S.fline = ""; S.fstatus = "recent";
      $("searchInput").value = "";
      $("dateFilter").value = "";
      $("nameFilter").value = "";
      $("lineFilter").value = "";
      $("statusFilter").value = "recent";
      renderLog();
    });
    $("dateFilter").addEventListener("input", function () { S.fdate = this.value; renderLog(); });
    $("dateFilter").addEventListener("change", function () { S.fdate = this.value; renderLog(); });

    $("logArea").addEventListener("keydown", function (e) {
      if (e.key === "Escape" && e.target.getAttribute && e.target.getAttribute("data-noteta")) {
        S.editNoteId = null;
        renderLog();
      }
    });
    $("logArea").addEventListener("click", function (e) {
      var t = e.target;
      if (t && t.id === "selAll") {
        var visNow = visibleEntries();
        var on = t.checked;
        visNow.forEach(function (en) {
          if (on) { if (!en.rectified) S.copySel[en.id] = true; }
          else delete S.copySel[en.id];
        });
        renderLog();
        return;
      }
      if (t && t.getAttribute && t.getAttribute("data-grpsel")) {
        var gday = t.getAttribute("data-grpsel");
        var gon = t.checked;
        visibleEntries().forEach(function (en) {
          if (enteredDay(en.ts) !== gday) return;
          if (gon) { if (!en.rectified) S.copySel[en.id] = true; }
          else delete S.copySel[en.id];
        });
        renderLog();
        return;
      }
      if (t && t.getAttribute && t.getAttribute("data-sel")) {
        setRowSel(t.getAttribute("data-sel"), t.checked, t.closest("tr"));
        return;
      }
      if (e.target.closest && e.target.closest("textarea")) return;
      var b = e.target.closest("button");
      if (!b) {
        var rowEl = e.target.closest("tbody tr");
        var dragging = window.getSelection ? window.getSelection().toString() : "";
        if (rowEl && rowEl.dataset.id && !dragging) {
          setRowSel(rowEl.dataset.id, !S.copySel[rowEl.dataset.id], rowEl);
        } else if (rowEl && rowEl.dataset.grp && !dragging) {
          var gd = rowEl.dataset.grp;
          var rowsG = visibleEntries().filter(function (r) { return enteredDay(r.ts) === gd; });
          var eligG = rowsG.filter(function (r) { return !r.rectified; });
          var allSel = eligG.length > 0 && eligG.every(function (r) { return S.copySel[r.id]; });
          rowsG.forEach(function (r) {
            if (allSel) delete S.copySel[r.id];
            else if (!r.rectified) S.copySel[r.id] = true;
          });
          renderLog();
        }
        return;
      }
      if (b.hasAttribute("data-noteedit")) {
        S.editNoteId = b.getAttribute("data-noteedit");
        renderLog();
        var ta = document.querySelector('[data-noteta]');
        if (ta) { ta.focus(); ta.selectionStart = ta.value.length; }
        return;
      }
      if (b.hasAttribute("data-notesave")) { saveNote(b.getAttribute("data-notesave")); return; }
      if (b.hasAttribute("data-notecancel")) { S.editNoteId = null; renderLog(); return; }
      if (b.hasAttribute("data-rect")) { toggleRect(b.getAttribute("data-rect")); return; }
      if (b.hasAttribute("data-reuse")) { reuse(b.getAttribute("data-reuse")); return; }
      if (b.hasAttribute("data-ask")) {
        S.confirmId = b.getAttribute("data-ask");
        clearTimeout(S.confirmTimer);
        S.confirmTimer = setTimeout(function () { S.confirmId = null; renderLog(); }, 3500);
        renderLog();
        return;
      }
      if (b.hasAttribute("data-del")) { removeEntry(b.getAttribute("data-del")); }
    });
  }

  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
