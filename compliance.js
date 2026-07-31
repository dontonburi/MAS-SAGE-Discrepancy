"use strict";
(function () {
  /* Edit the error-type list here — one line per option. */
  var ERROR_TYPES = [
    "FG reporting error (quantities/lot)",
    "Material/ingredient lot code reporting error",
    "Missing material usage proofs",
  ];

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
  function dstr(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function yesterdayStr() { var d = new Date(); d.setDate(d.getDate() - 1); return dstr(d); }
  function fmtDate(s) {
    var p = (s || "").split("-").map(Number);
    if (!p[0] || !p[1] || !p[2]) return s || "—";
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }
  function weekKey(s) { // Monday of the production week
    var p = (s || "").split("-").map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return dstr(d);
  }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function $(id) { return document.getElementById(id); }
  function safeParse(v) { try { var x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch (e) { return []; } }

  /* ---------------- storage ---------------- */
  var cfg = window.APP_CONFIG || {};
  var SHARED = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  var TABLE = cfg.COMPLIANCE_TABLE || "compliance_entries";
  var LS_KEY = "compliance-entries";

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
        id: r.id, date: r.prod_date, shift: Number(r.shift),
        lines: r.lines || [], type: r.error_type || "", note: r.note || "",
        ts: Date.parse(r.created_at) || Date.now(),
      };
    };
    store = {
      shared: true,
      load: function () {
        return fetch(BASE + "?select=*&order=prod_date.desc,created_at.desc", { headers: HEADERS })
          .then(function (r) { if (!r.ok) throw new Error("load " + r.status); return r.json(); })
          .then(function (rows) { return rows.map(norm); });
      },
      save: function (e) {
        var body = JSON.stringify([{ prod_date: e.date, shift: e.shift, lines: e.lines, error_type: e.type, note: e.note || null }]);
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
    };
  } else {
    var lsRead = function () { return safeParse(localStorage.getItem(LS_KEY) || "[]"); };
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
    };
  }

  /* ---------------- state ---------------- */
  var S = {
    entries: [], shift: null, linesSel: [], period: "all",
    confirmId: null, confirmTimer: null, toastTimer: null, saving: false,
  };

  /* ---------------- init ---------------- */
  function init() {
    $("dateInput").value = yesterdayStr();
    var ts = $("typeSel");
    ts.innerHTML = '<option value="">Select error type\u2026</option>' +
      ERROR_TYPES.map(function (t) { return '<option value="' + esc(t) + '">' + esc(t) + "</option>"; }).join("") +
      '<option value="__other">Other \u2014 type it</option>';

    setStatus(store.shared ? "loading" : "local");
    buildBoard();
    wireEvents();
    renderAll();

    store.load().then(function (list) {
      S.entries = list || [];
      setStatus(store.shared ? "ok" : "local");
      renderAll();
    }).catch(function () {
      setStatus("err");
      renderAll();
    });
  }

  function setStatus(mode) {
    var pill = $("statusPill"), text = $("statusText");
    pill.className = "pill";
    if (mode === "ok") { pill.classList.add("pill-ok"); text.textContent = "Live shared log"; }
    else if (mode === "loading") { pill.classList.add("pill-warn"); text.textContent = "Connecting\u2026"; }
    else if (mode === "err") { pill.classList.add("pill-err"); text.textContent = "Shared DB unreachable"; }
    else { pill.classList.add("pill-warn"); text.textContent = "Saved on this device only"; }
    if (store.shared) $("refreshBtn").classList.remove("hidden");
  }

  /* ---------------- board + shift ---------------- */
  function buildBoard() {
    var html = LINE_GROUPS.map(function (g) {
      var chips = g.items.map(function (it) {
        return '<button type="button" class="chip" data-line="' + esc(it[0]) + '" aria-pressed="false" title="' +
          esc(it[0]) + '"><span class="lamp"></span>' + esc(it[1]) + "</button>";
      }).join("");
      return '<div class="board-row' + (g.full ? " full" : "") + '"><span class="gname">' + esc(g.g) +
        '</span><div class="chips">' + chips + "</div></div>";
    }).join("");
    $("board").innerHTML = html;
  }
  function syncBoard() {
    $("board").querySelectorAll(".chip").forEach(function (ch) {
      var on = S.linesSel.indexOf(ch.getAttribute("data-line")) !== -1;
      ch.classList.toggle("on", on);
      ch.setAttribute("aria-pressed", on ? "true" : "false");
    });
    syncClearBtn();
  }
  function syncShift() {
    $("shiftGroup").querySelectorAll(".chip").forEach(function (b) {
      var on = Number(b.getAttribute("data-shift")) === S.shift;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    syncClearBtn();
  }

  /* ---------------- form ---------------- */
  function getType() {
    var v = $("typeSel").value;
    return v === "__other" ? $("typeOther").value.trim() : v;
  }
  function syncClearBtn() {
    var dirty = S.shift || S.linesSel.length || $("typeSel").value || $("noteInput").value;
    $("clearBtn").classList.toggle("hidden", !dirty);
  }
  function showErr(m) { var b = $("errBox"); b.textContent = m; b.classList.remove("hidden"); }
  function hideErr() { $("errBox").classList.add("hidden"); }
  function toast(m) {
    var t = $("toast");
    t.textContent = m;
    t.classList.remove("hidden");
    clearTimeout(S.toastTimer);
    S.toastTimer = setTimeout(function () { t.classList.add("hidden"); }, 2600);
  }
  function clearForm() {
    $("dateInput").value = yesterdayStr();
    S.shift = null; syncShift();
    S.linesSel = []; syncBoard();
    $("typeSel").value = "";
    $("typeOther").value = "";
    $("typeOther").classList.add("hidden");
    $("noteInput").value = "";
    hideErr();
    syncClearBtn();
  }

  function saveEntry() {
    if (S.saving) return;
    var date = $("dateInput").value;
    var missing = [];
    if (!date) missing.push("a production date");
    if (!S.shift) missing.push("a shift");
    if (S.linesSel.length === 0) missing.push("at least one line");
    if (!getType()) missing.push("an error type");
    if (missing.length) { showErr("Add " + missing.join(", ") + "."); return; }
    hideErr();
    var entry = {
      date: date, shift: S.shift,
      lines: ALL_LINES.filter(function (l) { return S.linesSel.indexOf(l) !== -1; }),
      type: getType(), note: $("noteInput").value.trim(),
    };
    S.saving = true;
    $("saveBtn").disabled = true;
    $("saveBtn").textContent = "Saving\u2026";
    store.save(entry).then(function (saved) {
      S.entries.push(saved);
      $("noteInput").value = "";
      renderAll();
      toast("Saved \u2014 Shift " + saved.shift + ", " + fmtDate(saved.date));
    }).catch(function (err) {
      var why = err && err.message && err.message !== "Failed to fetch" ? err.message : "check your connection and try again";
      showErr("Couldn't save \u2014 " + why + ". (If this mentions a missing table, run the compliance SQL from the README.)");
    }).finally(function () {
      S.saving = false;
      $("saveBtn").disabled = false;
      $("saveBtn").textContent = "Save record";
    });
  }

  function removeEntry(id) {
    S.confirmId = null;
    clearTimeout(S.confirmTimer);
    store.remove(id).then(function () {
      S.entries = S.entries.filter(function (e) { return e.id !== id; });
      renderAll();
      toast("Record deleted");
    }).catch(function () {
      renderAll();
      toast("Couldn't delete \u2014 try again");
    });
  }

  /* ---------------- stats ---------------- */
  function periodEntries() {
    if (S.period === "all") return S.entries.slice();
    var d = new Date();
    d.setDate(d.getDate() - Number(S.period));
    var cut = dstr(d);
    return S.entries.filter(function (e) { return e.date >= cut; });
  }

  function computeStats(list) {
    var byShift = { 1: 0, 2: 0, 3: 0 };
    var byType = {}, byLine = {}, weeks = {};
    list.forEach(function (e) {
      if (byShift[e.shift] != null) byShift[e.shift]++;
      byType[e.type] = (byType[e.type] || 0) + 1;
      (e.lines || []).forEach(function (l) { byLine[l] = (byLine[l] || 0) + 1; });
      var wk = weekKey(e.date);
      if (!weeks[wk]) weeks[wk] = { 1: 0, 2: 0, 3: 0, total: 0 };
      if (weeks[wk][e.shift] != null) weeks[wk][e.shift]++;
      weeks[wk].total++;
    });
    return { byShift: byShift, byType: byType, byLine: byLine, weeks: weeks };
  }

  function renderStats() {
    var area = $("statsArea");
    var list = periodEntries();
    $("copySummaryBtn").disabled = list.length === 0;
    if (list.length === 0) {
      area.innerHTML = '<div class="empty">No compliance records ' +
        (S.period === "all" ? "yet" : "in this period") + " \u2014 the scoreboard fills in as records are saved.</div>";
      return;
    }
    var st = computeStats(list);

    var chips = [1, 2, 3].map(function (s) {
      return '<div class="stat"><span class="stat-k">Shift ' + s + '</span><b>' + st.byShift[s] + "</b></div>";
    }).join("") + '<div class="stat stat-total"><span class="stat-k">Total</span><b>' + list.length + "</b></div>";

    var types = Object.keys(st.byType).sort(function (a, b) { return st.byType[b] - st.byType[a]; })
      .map(function (t) { return '<div class="stat"><span class="stat-k">' + esc(t) + '</span><b>' + st.byType[t] + "</b></div>"; }).join("");

    var lines = Object.keys(st.byLine).sort(function (a, b) { return st.byLine[b] - st.byLine[a]; }).slice(0, 6)
      .map(function (l) { return '<div class="stat"><span class="stat-k">' + esc(l) + '</span><b>' + st.byLine[l] + "</b></div>"; }).join("");

    var wkKeys = Object.keys(st.weeks).sort();
    if (wkKeys.length > 12) wkKeys = wkKeys.slice(-12);
    var maxTotal = 1;
    wkKeys.forEach(function (k) { if (st.weeks[k].total > maxTotal) maxTotal = st.weeks[k].total; });
    var rows = wkKeys.map(function (k) {
      var w = st.weeks[k];
      var barW = Math.round((w.total / maxTotal) * 100);
      return "<tr><td class='c-date'>Wk of " + esc(fmtDate(k)) + "</td>" +
        "<td class='mx-n'>" + w[1] + "</td><td class='mx-n'>" + w[2] + "</td><td class='mx-n'>" + w[3] + "</td>" +
        "<td class='mx-n mx-t'>" + w.total + "</td>" +
        "<td class='mx-bar'><span style='width:" + barW + "%'></span></td></tr>";
    }).join("");

    area.innerHTML =
      '<div class="stat-block"><div class="stat-h">Errors by shift</div><div class="stat-row">' + chips + "</div></div>" +
      '<div class="stat-block"><div class="stat-h">By error type</div><div class="stat-row">' + types + "</div></div>" +
      '<div class="stat-block"><div class="stat-h">Most involved lines</div><div class="stat-row">' + lines + "</div></div>" +
      '<div class="stat-block"><div class="stat-h">Week by week \u2014 is each shift improving?</div>' +
      '<div class="tbl-wrap"><table class="tbl mx"><thead><tr><th class="c-date">Week</th>' +
      "<th class='mx-n'>Shift 1</th><th class='mx-n'>Shift 2</th><th class='mx-n'>Shift 3</th><th class='mx-n'>Total</th><th></th></tr></thead>" +
      "<tbody>" + rows + "</tbody></table></div></div>";
  }

  /* ---------------- copy summary ---------------- */
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

  function copySummary() {
    var list = periodEntries();
    if (!list.length) return;
    var st = computeStats(list);
    var label = S.period === "all" ? "all time" : "last " + S.period + " days";
    var title = "Paperwork compliance summary (" + label + ") \u2014 " + list.length + " errors";
    var wkKeys = Object.keys(st.weeks).sort();
    var head = ["Week", "Shift 1", "Shift 2", "Shift 3", "Total"];
    var data = wkKeys.map(function (k) {
      var w = st.weeks[k];
      return ["Wk of " + fmtDate(k), w[1], w[2], w[3], w.total];
    });
    data.push(["All weeks", st.byShift[1], st.byShift[2], st.byShift[3], list.length]);

    var tsv = title + "\n" + [head].concat(data).map(function (r) { return r.join("\t"); }).join("\n");
    var cellCss = "border:1px solid #8a8a8a;padding:4px 8px;";
    var th = head.map(function (x) { return '<th style="' + cellCss + 'background:#efefef;text-align:left">' + esc(x) + "</th>"; }).join("");
    var trs = data.map(function (r) {
      return "<tr>" + r.map(function (c, i) {
        return '<td style="' + cellCss + (i > 0 ? "text-align:right;" : "") + '">' + esc(c) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    var html = '<div style="font:13px Arial,sans-serif"><div style="font-weight:bold;margin-bottom:6px">' + esc(title) +
      '</div><table style="border-collapse:collapse;font:13px Arial,sans-serif"><tr>' + th + "</tr>" + trs + "</table></div>";
    var done = function () { toast("Summary copied \u2014 paste it into an email"); };
    var fail = function () { toast("Couldn't copy \u2014 use Export CSV instead"); };
    if (navigator.clipboard && window.ClipboardItem && navigator.clipboard.write) {
      navigator.clipboard.write([new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([tsv], { type: "text/plain" }),
      })]).then(done).catch(function () { copyText(tsv).then(done).catch(fail); });
    } else {
      copyText(tsv).then(done).catch(fail);
    }
  }

  /* ---------------- log + export ---------------- */
  function sortedEntries() {
    return S.entries.slice().sort(function (a, b) {
      if (a.date < b.date) return 1;
      if (a.date > b.date) return -1;
      return (b.ts || 0) - (a.ts || 0);
    });
  }

  function renderLog() {
    var area = $("logArea");
    var vis = sortedEntries();
    var n = S.entries.length;
    $("entryCount").textContent = n + (n === 1 ? " record" : " records");
    $("exportBtn").textContent = "Export CSV (all " + n + ")";
    $("exportBtn").disabled = n === 0;
    if (!vis.length) {
      area.innerHTML = '<div class="empty">No records yet \u2014 save the first one above.</div>';
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
    [["c-date", "Date of production"], [null, "Shift"], [null, "Lines"], [null, "Type of error"], [null, "Note"], [null, ""]]
      .forEach(function (c) { hr.appendChild(mk("th", c[0] || "", c[1])); });
    thead.appendChild(hr);
    tbl.appendChild(thead);
    var tbody = document.createElement("tbody");
    vis.forEach(function (e) {
      var tr = document.createElement("tr");
      tr.dataset.id = e.id;
      tr.appendChild(mk("td", "c-date", fmtDate(e.date)));
      tr.appendChild(mk("td", "mx-n", String(e.shift)));
      tr.appendChild(mk("td", "c-line", (e.lines || []).join(", ")));
      tr.appendChild(mk("td", "c-desc", e.type));
      tr.appendChild(mk("td", "c-note", e.note || ""));
      var tdA = mk("td", "c-act");
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
    });
    tbl.appendChild(tbody);
    wrap.appendChild(tbl);
    area.innerHTML = "";
    area.appendChild(wrap);
  }

  function renderAll() { renderStats(); renderLog(); }

  function requestExport() {
    if (!cfg.EXPORT_PASSWORD) { doExportCsv(); return; }
    $("pwInput").value = "";
    $("pwErr").classList.add("hidden");
    $("pwModal").classList.remove("hidden");
    setTimeout(function () { $("pwInput").focus(); }, 50);
  }
  function closePw() { $("pwModal").classList.add("hidden"); }
  function tryPw() {
    if ($("pwInput").value === cfg.EXPORT_PASSWORD) { closePw(); doExportCsv(); }
    else {
      $("pwErr").classList.remove("hidden");
      $("pwInput").value = "";
      $("pwInput").focus();
    }
  }
  function doExportCsv() {
    var vis = sortedEntries();
    var cell = function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; };
    var rows = [["Date of production", "Shift", "Lines", "Type of error", "Note", "Logged at"]];
    vis.forEach(function (e) {
      rows.push([e.date, e.shift, (e.lines || []).join("; "), e.type, e.note || "", new Date(e.ts).toLocaleString()]);
    });
    var csv = rows.map(function (r) { return r.map(cell).join(","); }).join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "paperwork-compliance_" + dstr(new Date()) + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("CSV exported");
  }

  /* ---------------- events ---------------- */
  function wireEvents() {
    $("shiftGroup").addEventListener("click", function (e) {
      var b = e.target.closest(".chip");
      if (!b) return;
      var v = Number(b.getAttribute("data-shift"));
      S.shift = S.shift === v ? null : v;
      syncShift();
    });
    $("board").addEventListener("click", function (e) {
      var chip = e.target.closest(".chip");
      if (!chip) return;
      var id = chip.getAttribute("data-line");
      var i = S.linesSel.indexOf(id);
      if (i === -1) S.linesSel.push(id); else S.linesSel.splice(i, 1);
      syncBoard();
    });
    $("typeSel").addEventListener("change", function () {
      $("typeOther").classList.toggle("hidden", this.value !== "__other");
      if (this.value === "__other") $("typeOther").focus();
      syncClearBtn();
    });
    $("noteInput").addEventListener("input", syncClearBtn);
    $("saveBtn").addEventListener("click", saveEntry);
    $("clearBtn").addEventListener("click", clearForm);
    $("periodSel").addEventListener("change", function () { S.period = this.value; renderStats(); });
    $("copySummaryBtn").addEventListener("click", copySummary);
    $("refreshBtn").addEventListener("click", function () {
      setStatus("loading");
      store.load().then(function (list) {
        S.entries = list;
        setStatus("ok");
        renderAll();
        toast("Refreshed");
      }).catch(function () { setStatus("err"); });
    });
    $("exportBtn").addEventListener("click", requestExport);
    $("pwOk").addEventListener("click", tryPw);
    $("pwCancel").addEventListener("click", closePw);
    $("pwModal").addEventListener("click", function (e) { if (e.target === this) closePw(); });
    $("pwInput").addEventListener("keydown", function (e) {
      if (e.key === "Enter") tryPw();
      if (e.key === "Escape") closePw();
    });
    $("logArea").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      if (b.hasAttribute("data-ask")) {
        S.confirmId = b.getAttribute("data-ask");
        clearTimeout(S.confirmTimer);
        S.confirmTimer = setTimeout(function () { S.confirmId = null; renderLog(); }, 3500);
        renderLog();
        return;
      }
      if (b.hasAttribute("data-del")) removeEntry(b.getAttribute("data-del"));
    });
  }

  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
