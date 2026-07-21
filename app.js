"use strict";
(function () {
  /* ---------------- data ---------------- */
  var MATERIALS = (window.MATERIALS_TSV || "")
    .split("\n")
    .filter(function (l) { return l.indexOf("\t") > 0; })
    .map(function (l) {
      var i = l.indexOf("\t");
      return { c: l.slice(0, i), d: l.slice(i + 1) };
    });

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
        lot: r.lot || "", shift: r.shift == null ? null : Number(r.shift),
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
        var body = JSON.stringify([{ code: e.code, description: e.desc, qty: e.qty, lot: e.lot || null, shift: e.shift, entered_by: e.by || null, note: e.note || null, used_on: e.date, lines: e.lines }]);
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
    store = {
      shared: false,
      load: function () { return Promise.resolve(lsRead()); },
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
    entries: [], sel: null, linesSel: [], shift: null, shown: [], hi: 0,
    confirmId: null, confirmTimer: null, toastTimer: null, saving: false,
    ftext: "", fline: "",
  };

  /* ---------------- init ---------------- */
  function init() {
    $("dateInput").value = todayStr();
    try { $("nameInput").value = localStorage.getItem(NAME_KEY) || ""; } catch (e) {}
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

  function syncShift() {
    var btns = $("shiftGroup").querySelectorAll(".chip");
    btns.forEach(function (b) {
      var on = Number(b.getAttribute("data-shift")) === S.shift;
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
    var dirty = S.sel || $("matInput").value || $("qtyInput").value || $("lotInput").value || $("noteInput").value || S.shift || S.linesSel.length;
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
    $("dateInput").value = todayStr();
    S.shift = 3;
    syncShift();
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
    $("qtyInput").value = "";
    $("noteInput").value = "";
    $("dateInput").value = todayStr();
    S.shift = null;
    syncShift();
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
    if (!S.shift) missing.push("a shift");
    if (!$("nameInput").value.trim()) missing.push("your name");
    if (S.linesSel.length === 0) missing.push("at least one line");
    if (missing.length) { showErr("Add " + missing.join(", ") + "."); return; }
    hideErr();

    var entry = {
      code: S.sel.c, desc: S.sel.d, qty: Number(qty), date: date,
      lot: $("lotInput").value.trim(), shift: S.shift,
      by: $("nameInput").value.trim(), note: $("noteInput").value.trim(), rectified: false,
      lines: ALL_LINES.filter(function (l) { return S.linesSel.indexOf(l) !== -1; }),
    };
    S.saving = true;
    $("saveBtn").disabled = true;
    $("saveBtn").textContent = "Saving…";
    store.save(entry).then(function (saved) {
      S.entries.push(saved);
      clearPick();
      $("matInput").value = "";
      $("lotInput").value = "";
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
    return S.entries.filter(function (e) {
      if (S.fline && (e.lines || []).indexOf(S.fline) === -1) return false;
      if (q && (e.code + " " + e.desc + " " + (e.lot || "") + " " + (e.by || "") + " " + (e.note || "")).toUpperCase().indexOf(q) === -1) return false;
      return true;
    }).sort(function (a, b) {
      if (a.date < b.date) return 1;
      if (a.date > b.date) return -1;
      return (b.ts || 0) - (a.ts || 0);
    });
  }

  function renderLog() {
    var area = $("logArea");
    var vis = visibleEntries();
    var n = S.entries.length;
    $("entryCount").textContent = n + (n === 1 ? " entry" : " entries");
    $("exportBtn").textContent = "Export CSV (" + vis.length + ")";
    $("exportBtn").disabled = vis.length === 0;
    $("copyTableBtn").textContent = "Copy table (" + vis.length + ")";
    $("copyTableBtn").disabled = vis.length === 0;

    if (vis.length === 0) {
      area.innerHTML = '<div class="empty">' + (n === 0
        ? "No usage logged yet. Fill out the ticket above — or press <strong>Load example</strong> to see how one is filled."
        : "No entries match these filters.") + "</div>";
      return;
    }

    var HEADS = '<th class="c-r"></th><th class="c-date">Batch/Production date</th><th>Item (MAS)</th>' +
      '<th>Lot code</th><th>Description</th><th>Line</th><th>Shift</th><th class="c-qty">Qtty missing</th>' +
      '<th>Note</th><th>Name</th><th></th>';
    area.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr>' + HEADS + "</tr></thead><tbody>" +
      vis.map(function (e) {
        var rect = '<button type="button" class="rect' + (e.rectified ? " on" : "") + '" data-rect="' + esc(e.id) +
          '" aria-pressed="' + (e.rectified ? "true" : "false") + '" title="' +
          (e.rectified ? "Being rectified — click to unmark" : "Mark as being rectified") + '">\u2713</button>';
        var del = S.confirmId === e.id
          ? '<button type="button" class="ghost sm danger" data-del="' + esc(e.id) + '">Confirm delete</button>'
          : '<button type="button" class="ghost sm" data-ask="' + esc(e.id) + '">Delete</button>';
        return '<tr class="' + (e.rectified ? "done" : "") + '">' +
          '<td class="c-r">' + rect + "</td>" +
          '<td class="c-date">' + esc(fmtDate(e.date)) + "</td>" +
          '<td class="c-code">' + esc(e.code) + "</td>" +
          '<td class="c-lot">' + esc(e.lot || "") + "</td>" +
          '<td class="c-desc">' + esc(e.desc) + "</td>" +
          '<td class="c-line">' + esc((e.lines || []).join(", ")) + "</td>" +
          "<td>" + esc(e.shift || "") + "</td>" +
          '<td class="c-qty">' + esc(fmtQty(e.qty)) + "</td>" +
          '<td class="c-note">' + esc(e.note || "") + "</td>" +
          "<td>" + esc(e.by || "") + "</td>" +
          '<td class="c-act"><button type="button" class="ghost sm" data-reuse="' + esc(e.id) +
          '" title="Refill the form with this material and lines">Reuse</button>' + del + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }

  function removeEntry(id) {
    S.confirmId = null;
    clearTimeout(S.confirmTimer);
    store.remove(id).then(function () {
      S.entries = S.entries.filter(function (e) { return e.id !== id; });
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
    $("qtyInput").value = "";
    $("dateInput").value = todayStr();
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
    var vis = visibleEntries();
    if (!vis.length) return;
    var clean = function (c) { return String(c == null ? "" : c).replace(/[\t\n\r]+/g, " "); };
    var head = ["Batch/Production date", "Item (MAS)", "Lot code", "Description", "Line", "Shift", "Qtty missing", "Note", "Name"];
    var data = vis.map(function (e) {
      return [e.date, e.code, e.lot || "", e.desc, (e.lines || []).join(", "), e.shift || "", fmtQty(e.qty), e.note || "", e.by || ""];
    });
    var title = "MAS material adjustments for approval (" + vis.length + ")";
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

  function refresh() {
    setStatus("loading");
    store.load().then(function (list) {
      S.entries = list;
      setStatus("ok");
      renderLog();
      toast("Log refreshed");
    }).catch(function () {
      setStatus("err");
      toast("Couldn't reach the shared database");
    });
  }

  function exportCsv() {
    var vis = visibleEntries();
    var cell = function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; };
    var rows = [["Batch/Production date", "Item (MAS)", "Lot code", "Description", "Line", "Shift", "Qtty missing", "Note", "Name", "Rectified", "Logged at"]];
    vis.forEach(function (e) {
      rows.push([e.date, e.code, e.lot || "", e.desc, (e.lines || []).join("; "), e.shift || "", e.qty, e.note || "", e.by || "", e.rectified ? "Yes" : "", new Date(e.ts).toLocaleString()]);
    });
    var csv = rows.map(function (r) { return r.map(cell).join(","); }).join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "material-usage-log_" + todayStr() + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
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
    $("noteInput").addEventListener("input", syncClearBtn);
    $("shiftGroup").addEventListener("click", function (e) {
      var b = e.target.closest(".chip");
      if (!b) return;
      var v = Number(b.getAttribute("data-shift"));
      S.shift = S.shift === v ? null : v;
      syncShift();
    });
    $("saveBtn").addEventListener("click", saveEntry);
    $("clearBtn").addEventListener("click", clearForm);
    $("exampleBtn").addEventListener("click", loadExample);
    $("refreshBtn").addEventListener("click", refresh);
    $("copyTableBtn").addEventListener("click", copyTable);
    $("exportBtn").addEventListener("click", exportCsv);

    $("searchInput").addEventListener("input", function () { S.ftext = this.value; renderLog(); });
    $("lineFilter").addEventListener("change", function () { S.fline = this.value; renderLog(); });

    $("logArea").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
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
