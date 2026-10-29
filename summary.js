"use strict";
(function () {
  var cfg = (typeof window !== "undefined" && window.APP_CONFIG) || {};
  var TAX = (typeof window !== "undefined" && window.TAXONOMY) || null;
  var NOTES = (typeof window !== "undefined" && window.NOTES) || null;

  /* ---------------- helpers ---------------- */
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function pad(n) { return String(n).padStart(2, "0"); }
  function dstr(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function fmtDate(s) {
    var p = (s || "").split("-").map(Number);
    if (!p[0] || !p[1] || !p[2]) return s || "\u2014";
    return new Date(p[0], p[1] - 1, p[2]).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  function weekKey(s) {
    var p = (s || "").split("-").map(Number);
    if (!p[0]) return "";
    var d = new Date(p[0], p[1] - 1, p[2]);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return dstr(d);
  }
  function monthKey(s) { return String(s || "").slice(0, 7); }
  function fmtMonth(k) {
    var p = String(k || "").split("-").map(Number);
    if (!p[0] || !p[1]) return k || "\u2014";
    return new Date(p[0], p[1] - 1, 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  }
  function money(n) {
    return "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function num(n) {
    return Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 3 });
  }

  /* ---------------- material master ---------------- */
  var DESC = {}, PRICE = {};
  (window.MATERIALS_TSV || "").split("\n").forEach(function (l) {
    var f = l.split("\t");
    if (f.length < 2 || !f[0]) return;
    DESC[f[0]] = f[1] || "";
    if (f.length > 2) {
      var p = parseFloat(String(f[2]).replace(/[^0-9.\-]/g, ""));
      if (isFinite(p)) PRICE[f[0]] = p;
    }
  });

  function classifyCode(code, desc) {
    var d = desc || DESC[code] || "";
    return TAX ? TAX.classify(d) : { type: "", cat: "", key: "?", label: "Unclassified" };
  }

  /* ---------------- state ---------------- */
  var S = {
    entries: [], period: "all", metric: "count", toastTimer: null,
    fType: null, fCat: null, fMonth: null, fNote: null,  // drill-down, set by clicking the dashboard
  };

  function toast(m) {
    var t = $("toast");
    t.textContent = m;
    t.classList.remove("hidden");
    clearTimeout(S.toastTimer);
    S.toastTimer = setTimeout(function () { t.classList.add("hidden"); }, 2600);
  }
  function setStatus(mode, text) {
    var pill = $("statusPill");
    pill.className = "pill " + (mode === "ok" ? "pill-ok" : mode === "err" ? "pill-err" : "pill-warn");
    $("statusText").textContent = text;
  }

  /* ---------------- load ---------------- */
  var SHARED = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY);
  function loadEntries() {
    if (SHARED) {
      var base = cfg.SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/" + (cfg.TABLE || "usage_entries");
      return fetch(base + "?select=*&order=used_on.desc", {
        headers: {
          apikey: cfg.SUPABASE_ANON_KEY,
          Authorization: "Bearer " + cfg.SUPABASE_ANON_KEY,
        },
      }).then(function (r) {
        if (!r.ok) throw new Error("load " + r.status);
        return r.json();
      }).then(function (rows) {
        return rows.map(function (r) {
          return {
            code: r.code, desc: r.description || "", qty: Number(r.qty) || 0,
            date: r.used_on, rectified: !!r.rectified, note: r.note || "",
            ts: Date.parse(r.created_at) || 0,
          };
        });
      });
    }
    var list = [];
    try { list = JSON.parse(localStorage.getItem("material-usage-entries") || "[]"); } catch (e) { list = []; }
    return Promise.resolve((Array.isArray(list) ? list : []).map(function (e) {
      return { code: e.code, desc: e.desc || "", qty: Number(e.qty) || 0, date: e.date, rectified: !!e.rectified, note: e.note || "", ts: e.ts || 0 };
    }));
  }

  /* ---------------- aggregation ---------------- */
  function periodEntries() {
    if (S.period === "all") return S.entries.slice();
    var d = new Date();
    d.setDate(d.getDate() - Number(S.period));
    var cut = dstr(d);
    return S.entries.filter(function (e) { return (e.date || "") >= cut; });
  }
  function noteBucket(e) {
    return NOTES ? NOTES.classifyNote(e.note) : { id: "none", label: "No note", tags: [] };
  }

  function matchesDrill(e) {
    if (!S.fType && !S.fCat && !S.fMonth && !S.fNote) return true;
    var c = classifyCode(e.code, e.desc);
    if (S.fType && (c.type || "") !== S.fType) return false;
    if (S.fCat && (c.cat || (c.type ? "-" : "")) !== S.fCat) return false;
    if (S.fMonth && monthKey(e.date) !== S.fMonth) return false;
    if (S.fNote && noteBucket(e).id !== S.fNote) return false;
    return true;
  }
  function drillEntries() { return periodEntries().filter(matchesDrill); }
  function drillActive() { return !!(S.fType || S.fCat || S.fMonth || S.fNote); }

  function valueOf(e) {
    var p = PRICE[e.code];
    return p == null ? 0 : p * e.qty;
  }
  function measure(e) { return S.metric === "value" ? valueOf(e) : 1; }
  function fmtMeasure(v) { return S.metric === "value" ? money(v) : num(v); }

  function aggregate(list) {
    var byType = {}, byCat = {}, byKey = {}, byItem = {}, weeks = {}, months = {}, catKeys = {};
    var typeCodes = {}, catCodes = {}, noteBuckets = {};
    var missingPrice = 0, totalVal = 0;
    list.forEach(function (e) {
      var c = classifyCode(e.code, e.desc);
      var tl = c.type ? (TAX ? TAX.typeLabel(c.type) : c.type) : "Unclassified";
      var cl = c.cat ? (TAX ? TAX.catLabel(c.cat) : c.cat) : (c.type ? "Unspecified" : "Unclassified");
      var m = measure(e);
      byType[tl] = (byType[tl] || 0) + m;
      byCat[cl] = (byCat[cl] || 0) + m;
      var tcode = c.type || "";
      var ccode = c.cat || (c.type ? "-" : "");
      if (!typeCodes[tcode]) typeCodes[tcode] = { code: tcode, label: tl, v: 0 };
      typeCodes[tcode].v += m;
      if (!catCodes[ccode]) catCodes[ccode] = { code: ccode, label: cl, v: 0 };
      catCodes[ccode].v += m;
      byKey[c.label] = (byKey[c.label] || 0) + m;
      catKeys[cl] = 1;
      var ik = e.code + "\u0000" + (e.desc || DESC[e.code] || "");
      if (!byItem[ik]) byItem[ik] = { code: e.code, desc: e.desc || DESC[e.code] || "", label: c.label, v: 0, n: 0, qty: 0 };
      byItem[ik].v += m;
      byItem[ik].n += 1;
      byItem[ik].qty += e.qty;
      var wk = weekKey(e.date);
      if (wk) {
        if (!weeks[wk]) weeks[wk] = { total: 0, cats: {} };
        weeks[wk].total += m;
        weeks[wk].cats[cl] = (weeks[wk].cats[cl] || 0) + m;
      }
      var nb = noteBucket(e);
      if (!noteBuckets[nb.id]) noteBuckets[nb.id] = { code: nb.id, label: nb.label, hint: nb.hint || "", v: 0, n: 0, ex: [] };
      noteBuckets[nb.id].v += m;
      noteBuckets[nb.id].n += 1;
      if (e.note && noteBuckets[nb.id].ex.length < 3) noteBuckets[nb.id].ex.push(e.note);

      var mk = monthKey(e.date);
      if (mk) {
        if (!months[mk]) months[mk] = { total: 0, cats: {}, types: {}, n: 0, val: 0 };
        months[mk].total += m;
        months[mk].cats[cl] = (months[mk].cats[cl] || 0) + m;
        months[mk].types[tl] = (months[mk].types[tl] || 0) + m;
        months[mk].n += 1;
        months[mk].val += valueOf(e);
      }
      if (PRICE[e.code] == null) missingPrice++;
      totalVal += valueOf(e);
    });
    return {
      byType: byType, byCat: byCat, byKey: byKey, weeks: weeks, months: months,
      typeCodes: typeCodes, catCodes: catCodes, noteBuckets: noteBuckets,
      cats: Object.keys(catKeys).sort(),
      items: Object.keys(byItem).map(function (k) { return byItem[k]; }),
      missingPrice: missingPrice, totalVal: totalVal, n: list.length,
    };
  }

  /* ---------------- rendering ---------------- */
  // Gas Blend Scrap Factor Report data colours (validated against white)
  var PALETTE = ["#014583", "#22a7c4", "#c27a12", "#457a94", "#147a6e", "#2563b0", "#b3617a", "#6f7378"];
  function colorFor(i) { return PALETTE[i % PALETTE.length]; }

  function pct(v, total) { return total ? (v / total) * 100 : 0; }

  /* Compact KPI strip */
  function kpiStrip(ag, list) {
    var dates = list.map(function (e) { return e.date; }).filter(Boolean).sort();
    var range = dates.length ? fmtDate(dates[0]) + " \u2013 " + fmtDate(dates[dates.length - 1]) : "\u2014";
    return '<div class="kpis">' +
      '<div class="kpi"><span>Entries</span><b>' + num(ag.n) + "</b></div>" +
      '<div class="kpi kpi-hi"><span>Value</span><b>' + money(ag.totalVal) + "</b></div>" +
      '<div class="kpi"><span>Dates</span><b class="kpi-sm">' + esc(range) + "</b></div>" +
      (ag.missingPrice
        ? '<div class="kpi"><span>No unit cost</span><b class="kpi-sm">' + num(ag.missingPrice) + " entries</b></div>"
        : "") +
      "</div>";
  }

  /* One stacked bar, segments clickable */
  function stackedBar(entries, total, dim) {
    var segs = entries.filter(function (x) { return x.v > 0; })
      .sort(function (x, y) { return y.v - x.v; });
    if (!segs.length) return "";
    var bar = segs.map(function (s, i) {
      var w = pct(s.v, total);
      var on = (dim === "type" ? S.fType : S.fCat) === s.code;
      return '<button type="button" class="seg' + (on ? " on" : "") + '" data-dim="' + dim +
        '" data-code="' + esc(s.code) + '" style="width:' + w.toFixed(2) + "%;background:" + colorFor(i) +
        '" title="' + esc(s.label) + ": " + esc(fmtMeasure(s.v)) + " (" + Math.round(w) + '%)"></button>';
    }).join("");
    var legend = segs.map(function (s, i) {
      var on = (dim === "type" ? S.fType : S.fCat) === s.code;
      return '<button type="button" class="lg' + (on ? " on" : "") + '" data-dim="' + dim +
        '" data-code="' + esc(s.code) + '"><span class="lg-dot" style="background:' + colorFor(i) + '"></span>' +
        esc(s.label) + "<b>" + esc(fmtMeasure(s.v)) + "</b><i>" + Math.round(pct(s.v, total)) + "%</i></button>";
    }).join("");
    return '<div class="sbar">' + bar + '</div><div class="lgs">' + legend + "</div>";
  }

  /* Sparkline of the monthly trend */
  function sparkline(ag) {
    var keys = Object.keys(ag.months).sort();
    if (keys.length < 2) return "";
    var vals = keys.map(function (k) { return ag.months[k].total; });
    var max = Math.max.apply(null, vals) || 1;
    var w = 168, h = 40, step = keys.length > 1 ? w / (keys.length - 1) : w;
    var pts = vals.map(function (v, i) { return (i * step).toFixed(1) + "," + (h - (v / max) * (h - 6) - 3).toFixed(1); });
    var last = vals[vals.length - 1], prev = vals[vals.length - 2];
    var dir = last > prev ? "up" : last < prev ? "down" : "flat";
    var arrow = dir === "up" ? "\u25b2" : dir === "down" ? "\u25bc" : "\u2013";
    var change = prev ? Math.round(((last - prev) / prev) * 100) : 0;
    return '<div class="spark"><svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<polyline points="' + pts.join(" ") + '" fill="none" stroke="#014583" stroke-width="2" stroke-linejoin="round" />' +
      '<circle cx="' + (w).toFixed(1) + '" cy="' + (h - (last / max) * (h - 6) - 3).toFixed(1) + '" r="2.5" fill="#014583" />' +
      "</svg>" +
      '<div class="spark-cap">' + esc(fmtMonth(keys[0])) + " \u2192 " + esc(fmtMonth(keys[keys.length - 1])) +
      ' <span class="dn-' + dir + '">' + arrow + " " + (prev ? (change > 0 ? "+" : "") + change + "%" : "\u2013") + "</span></div></div>";
  }

  function filterChip() {
    if (!drillActive()) return "";
    var bits = [];
    if (S.fType) bits.push(TAX ? TAX.typeLabel(S.fType) : S.fType);
    if (S.fCat) bits.push(S.fCat === "-" ? "Unspecified" : (TAX ? TAX.catLabel(S.fCat) : S.fCat));
    if (S.fMonth) bits.push(fmtMonth(S.fMonth));
    if (S.fNote) bits.push(NOTES ? NOTES.bucketLabel(S.fNote) : S.fNote);
    return '<div class="drill"><span class="drill-k">Filtered to</span> <b>' + esc(bits.join(" \u00b7 ")) +
      '</b><button type="button" class="drill-x" id="clearDrill">Clear</button></div>';
  }

  function renderTotals(agAll, agDrill, listAll) {
    var area = $("totalsArea");
    if (!agAll.n) {
      area.innerHTML = '<div class="empty">No entries in this period.</div>';
      return;
    }
    var totalAll = S.metric === "value" ? agAll.totalVal : agAll.n;
    var types = Object.keys(agAll.typeCodes).map(function (k) { return agAll.typeCodes[k]; });
    var cats = Object.keys(agAll.catCodes).map(function (k) { return agAll.catCodes[k]; });
    area.innerHTML =
      kpiStrip(drillActive() ? agDrill : agAll, drillActive() ? drillEntries() : listAll) +
      filterChip() +
      '<div class="dash">' +
      '<div class="dash-b"><div class="stat-h">Packaging vs ingredients</div>' + stackedBar(types, totalAll, "type") + "</div>" +
      '<div class="dash-b"><div class="stat-h">By product line</div>' + stackedBar(cats, totalAll, "cat") + "</div>" +
      '<div class="dash-b dash-narrow"><div class="stat-h">Monthly trend</div>' + sparkline(agAll) + "</div>" +
      "</div>" +
      '<p class="dash-hint">Click any colour or label to focus that slice \u2014 the tables, the trend, and the one-page report all follow.</p>';
  }

  function deltaCell(cur, prev) {
    if (prev == null) return "<td class='mx-n'>\u00b7</td>";
    var d = cur - prev;
    if (!prev && !cur) return "<td class='mx-n'>\u00b7</td>";
    var pct = prev ? Math.round((d / prev) * 100) : null;
    var cls = d > 0 ? "dn-up" : d < 0 ? "dn-down" : "dn-flat";
    var arrow = d > 0 ? "\u25b2" : d < 0 ? "\u25bc" : "\u2013";
    var txt = pct == null ? (d > 0 ? "new" : "\u2013") : (pct > 0 ? "+" : "") + pct + "%";
    return "<td class='mx-n " + cls + "'>" + arrow + " " + txt + "</td>";
  }

  function renderMonthly(ag) {
    var area = $("monthlyArea");
    var keys = Object.keys(ag.months).sort();
    if (!keys.length) {
      area.innerHTML = '<div class="empty">No entries in this period.</div>';
      return;
    }
    if (keys.length > 13) keys = keys.slice(-13);
    var cats = ag.cats;
    var max = 1;
    keys.forEach(function (k) { if (ag.months[k].total > max) max = ag.months[k].total; });
    var head = "<tr><th class='c-date'>Month</th>" +
      cats.map(function (c) { return "<th class='mx-n'>" + esc(c) + "</th>"; }).join("") +
      "<th class='mx-n'>Total</th><th class='mx-n'>vs prior</th><th></th></tr>";
    var rows = keys.map(function (k, i) {
      var m = ag.months[k];
      var prev = i > 0 ? ag.months[keys[i - 1]] : null;
      var cells = cats.map(function (c) {
        var v = m.cats[c] || 0;
        return "<td class='mx-n'>" + (v ? fmtMeasure(v) : "\u00b7") + "</td>";
      }).join("");
      var barW = Math.round((m.total / max) * 100);
      return "<tr data-month='" + esc(k) + "'" + (S.fMonth === k ? " class='is-sel'" : "") +
        "><td class='c-date'>" + esc(fmtMonth(k)) + "</td>" + cells +
        "<td class='mx-n mx-t'>" + fmtMeasure(m.total) + "</td>" +
        deltaCell(m.total, prev ? prev.total : null) +
        "<td class='mx-bar'><span style='width:" + barW + "%'></span></td></tr>";
    }).join("");
    area.innerHTML = '<div class="tbl-wrap"><table class="tbl mx"><thead>' + head + "</thead><tbody>" + rows + "</tbody></table></div>";
  }

  function renderWeekly(ag) {
    var area = $("weeklyArea");
    var wkKeys = Object.keys(ag.weeks).sort();
    if (!wkKeys.length) {
      area.innerHTML = '<div class="empty">No entries in this period.</div>';
      return;
    }
    if (wkKeys.length > 14) wkKeys = wkKeys.slice(-14);
    var cats = ag.cats;
    var max = 1;
    wkKeys.forEach(function (k) { if (ag.weeks[k].total > max) max = ag.weeks[k].total; });
    var head = "<tr><th class='c-date'>Week of</th>" +
      cats.map(function (c) { return "<th class='mx-n'>" + esc(c) + "</th>"; }).join("") +
      "<th class='mx-n'>Total</th><th></th></tr>";
    var rows = wkKeys.map(function (k) {
      var w = ag.weeks[k];
      var cells = cats.map(function (c) {
        var v = w.cats[c] || 0;
        return "<td class='mx-n'>" + (v ? fmtMeasure(v) : "\u00b7") + "</td>";
      }).join("");
      var barW = Math.round((w.total / max) * 100);
      return "<tr><td class='c-date'>" + esc(fmtDate(k)) + "</td>" + cells +
        "<td class='mx-n mx-t'>" + fmtMeasure(w.total) + "</td>" +
        "<td class='mx-bar'><span style='width:" + barW + "%'></span></td></tr>";
    }).join("");
    area.innerHTML = '<div class="tbl-wrap"><table class="tbl mx"><thead>' + head + "</thead><tbody>" + rows + "</tbody></table></div>";
  }

  function renderReasons(agAll, agDrill) {
    var area = $("reasonsArea");
    var src = agAll.noteBuckets;
    var rows = Object.keys(src).map(function (k) { return src[k]; })
      .sort(function (x, y) { return y.v - x.v; });
    if (!rows.length) {
      area.innerHTML = '<div class="empty">No entries in this period.</div>';
      return;
    }
    var total = rows.reduce(function (s, r) { return s + r.v; }, 0);
    var known = rows.filter(function (r) { return r.code !== "none" && r.code !== "other"; })
      .reduce(function (s, r) { return s + r.n; }, 0);
    var allN = rows.reduce(function (s, r) { return s + r.n; }, 0);

    var body = rows.map(function (r, i) {
      var on = S.fNote === r.code;
      var w = pct(r.v, total);
      var faded = r.code === "none" || r.code === "other";
      var ex = r.ex.length
        ? '<div class="rs-ex">' + r.ex.map(function (x) {
            return "<span>\u201c" + esc(String(x).slice(0, 70)) + (String(x).length > 70 ? "\u2026" : "") + "\u201d</span>";
          }).join("") + "</div>"
        : "";
      return '<button type="button" class="rs' + (on ? " on" : "") + (faded ? " rs-faded" : "") +
        '" data-note="' + esc(r.code) + '" title="' + esc(r.hint || "") + '">' +
        '<span class="rs-top"><span class="rs-label">' + esc(r.label) + "</span>" +
        "<b>" + esc(fmtMeasure(r.v)) + "</b><i>" + Math.round(w) + "%</i></span>" +
        '<span class="rs-bar"><span style="width:' + w.toFixed(1) + "%;background:" + colorFor(i) + '"></span></span>' +
        ex + "</button>";
    }).join("");

    area.innerHTML = '<div class="rs-list">' + body + "</div>" +
      '<p class="dash-hint">Buckets are guessed from the words in each note \u2014 ' +
      esc(num(known)) + " of " + esc(num(allN)) +
      " entries matched a known cause. Click one to focus it; hover for what it means. Patterns live in " +
      '<span class="mono">notes.js</span>.</p>';
  }

  function renderTop(ag) {
    var area = $("topArea");
    if (!ag.items.length) {
      area.innerHTML = '<div class="empty">No entries in this period.</div>';
      return;
    }
    var items = ag.items.slice().sort(function (a, b) { return b.v - a.v; }).slice(0, 15);
    var rows = items.map(function (it) {
      return "<tr><td class='mono'>" + esc(it.code) + "</td><td class='c-desc'>" + esc(it.desc) +
        "</td><td class='c-line'>" + esc(it.label) + "</td><td class='mx-n'>" + num(it.n) +
        "</td><td class='mx-n'>" + num(it.qty) + "</td><td class='mx-n mx-t'>" + fmtMeasure(it.v) + "</td></tr>";
    }).join("");
    area.innerHTML = '<div class="tbl-wrap"><table class="tbl"><thead><tr>' +
      "<th>Item (MAS)</th><th>Description</th><th>Category</th><th class='mx-n'>Entries</th>" +
      "<th class='mx-n'>Qty</th><th class='mx-n'>" + (S.metric === "value" ? "Value" : "Count") + "</th>" +
      "</tr></thead><tbody>" + rows + "</tbody></table></div>";
  }

  function renderAll() {
    var listAll = periodEntries();
    var agAll = aggregate(listAll);
    var listDrill = drillActive() ? listAll.filter(matchesDrill) : listAll;
    var agDrill = drillActive() ? aggregate(listDrill) : agAll;
    $("entryCount").textContent = agDrill.n + (agDrill.n === 1 ? " entry" : " entries");
    $("copySumBtn").disabled = !agDrill.n;
    $("exportBtn").disabled = !agDrill.n;
    $("reportBtn").disabled = !agDrill.n;
    renderTotals(agAll, agDrill, listAll);
    renderReasons(agAll, agDrill);
    renderMonthly(agDrill);
    renderWeekly(agDrill);
    renderTop(agDrill);
    return agDrill;
  }

  /* ---------------- copy + export ---------------- */
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

  function summaryRows() {
    var ag = aggregate(drillEntries());
    var label = S.period === "all" ? "all time" : "last " + S.period + " days";
    var title = "Material summary (" + label + ") \u2014 " + ag.n + " entries, " + money(ag.totalVal);
    var wkKeys = Object.keys(ag.weeks).sort();
    var cats = ag.cats;
    var head = ["Week of"].concat(cats).concat(["Total"]);
    var data = wkKeys.map(function (k) {
      var w = ag.weeks[k];
      return [k].concat(cats.map(function (c) { return w.cats[c] || 0; })).concat([w.total]);
    });
    var totals = ["All weeks"].concat(cats.map(function (c) { return ag.byCat[c] || 0; })).concat([
      S.metric === "value" ? ag.totalVal : ag.n,
    ]);
    data.push(totals);
    return { title: title, head: head, data: data, ag: ag };
  }

  function copySummary() {
    var s = summaryRows();
    var fmt = function (v) { return typeof v === "number" && S.metric === "value" ? Number(v).toFixed(2) : v; };
    var tsv = s.title + "\n" + [s.head].concat(s.data.map(function (r) { return r.map(fmt); }))
      .map(function (r) { return r.join("\t"); }).join("\n");
    var cellCss = "border:1px solid #8a8a8a;padding:4px 8px;";
    var th = s.head.map(function (x) { return '<th style="' + cellCss + 'background:#efefef;text-align:left">' + esc(x) + "</th>"; }).join("");
    var trs = s.data.map(function (r) {
      return "<tr>" + r.map(function (c, i) {
        return '<td style="' + cellCss + (i > 0 ? "text-align:right;" : "") + '">' + esc(fmt(c)) + "</td>";
      }).join("") + "</tr>";
    }).join("");
    var html = '<div style="font:13px Arial,sans-serif"><div style="font-weight:bold;margin-bottom:6px">' +
      esc(s.title) + '</div><table style="border-collapse:collapse;font:13px Arial,sans-serif"><tr>' +
      th + "</tr>" + trs + "</table></div>";
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

  function exportCsv() {
    var list = drillEntries();
    var ag = aggregate(list);
    var cell = function (v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; };
    var rows = [];
    rows.push(["Material summary", S.period === "all" ? "all time" : "last " + S.period + " days"]);
    rows.push([]);
    rows.push(["Type", "Entries or value"]);
    Object.keys(ag.byType).forEach(function (k) { rows.push([k, ag.byType[k]]); });
    rows.push([]);
    rows.push(["Product line", "Entries or value"]);
    Object.keys(ag.byCat).forEach(function (k) { rows.push([k, ag.byCat[k]]); });
    rows.push([]);
    rows.push(["Likely cause (from the note)", "Entries", "Measure"]);
    Object.keys(ag.noteBuckets).forEach(function (k) {
      var b = ag.noteBuckets[k];
      rows.push([b.label, b.n, b.v]);
    });
    rows.push([]);
    rows.push(["Week of"].concat(ag.cats).concat(["Total"]));
    Object.keys(ag.weeks).sort().forEach(function (k) {
      var w = ag.weeks[k];
      rows.push([k].concat(ag.cats.map(function (c) { return w.cats[c] || 0; })).concat([w.total]));
    });
    rows.push([]);
    rows.push(["Item (MAS)", "Description", "Category", "Entries", "Qty", "Unit $", "Value $"]);
    ag.items.slice().sort(function (a, b) { return b.v - a.v; }).forEach(function (it) {
      var up = PRICE[it.code];
      rows.push([it.code, it.desc, it.label, it.n, it.qty,
        up == null ? "" : up.toFixed(2),
        up == null ? "" : (up * it.qty).toFixed(2)]);
    });
    var csv = rows.map(function (r) { return r.map(cell).join(","); }).join("\r\n");
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "material-summary_" + dstr(new Date()) + ".csv";
    a.click();
    URL.revokeObjectURL(a.href);
    toast("CSV exported");
  }

  /* ---------------- one-page report ---------------- */
  function drillLabel() {
    var bits = [];
    if (S.fType) bits.push(TAX ? TAX.typeLabel(S.fType) : S.fType);
    if (S.fCat) bits.push(S.fCat === "-" ? "Unspecified" : (TAX ? TAX.catLabel(S.fCat) : S.fCat));
    if (S.fMonth) bits.push(fmtMonth(S.fMonth));
    if (S.fNote) bits.push(NOTES ? NOTES.bucketLabel(S.fNote) : S.fNote);
    return bits.join(" \u00b7 ");
  }

  function periodLabel() {
    return S.period === "all" ? "All time" : "Last " + S.period + " days";
  }

  function buildReport() {
    var list = drillEntries();
    var ag = aggregate(list);
    var metricName = S.metric === "value" ? "Value ($)" : "Entries";
    var dates = list.map(function (e) { return e.date; }).filter(Boolean).sort();
    var range = dates.length ? fmtDate(dates[0]) + " \u2013 " + fmtDate(dates[dates.length - 1]) : "\u2014";

    var kpis = '<div class="rp-kpis">' +
      '<div class="rp-kpi"><span>Entries</span><b>' + num(ag.n) + "</b></div>" +
      '<div class="rp-kpi"><span>Value</span><b>' + money(ag.totalVal) + "</b></div>" +
      '<div class="rp-kpi"><span>Production dates</span><b>' + esc(range) + "</b></div>" +
      (ag.missingPrice ? '<div class="rp-kpi"><span>No unit cost on file</span><b>' + num(ag.missingPrice) + "</b></div>" : "") +
      "</div>";

    function miniTable(obj) {
      var keys = Object.keys(obj).sort(function (x, y) { return obj[y] - obj[x]; });
      if (!keys.length) return "<p>None.</p>";
      var tot = keys.reduce(function (s, k) { return s + obj[k]; }, 0);
      return "<table class='rp-tbl'><tbody>" + keys.map(function (k) {
        var pct = tot ? Math.round((obj[k] / tot) * 100) : 0;
        return "<tr><td>" + esc(k) + "</td><td class='mx-n'>" + fmtMeasure(obj[k]) + "</td><td class='mx-n rp-pct'>" + pct + "%</td></tr>";
      }).join("") + "</tbody></table>";
    }

    // month-over-month, trimmed to fit a page
    var mKeys = Object.keys(ag.months).sort();
    var mShow = mKeys.slice(-6);
    var mMax = 1;
    mShow.forEach(function (k) { if (ag.months[k].total > mMax) mMax = ag.months[k].total; });
    var monthRows = mShow.map(function (k, i) {
      var m = ag.months[k];
      var prevKey = mKeys[mKeys.indexOf(k) - 1];
      var prev = prevKey ? ag.months[prevKey] : null;
      var barW = Math.round((m.total / mMax) * 100);
      return "<tr><td>" + esc(fmtMonth(k)) + "</td><td class='mx-n'>" + fmtMeasure(m.total) + "</td>" +
        deltaCell(m.total, prev ? prev.total : null) +
        "<td class='rp-bar'><span style='width:" + barW + "%'></span></td></tr>";
    }).join("");
    var monthBlock = mShow.length
      ? "<table class='rp-tbl'><thead><tr><th>Month</th><th class='mx-n'>" + esc(metricName) +
        "</th><th class='mx-n'>vs prior</th><th></th></tr></thead><tbody>" + monthRows + "</tbody></table>"
      : "<p>No monthly data.</p>";

    var topItems = ag.items.slice().sort(function (x, y) { return y.v - x.v; }).slice(0, 10);
    var topRows = topItems.map(function (it) {
      return "<tr><td class='mono'>" + esc(it.code) + "</td><td>" + esc(String(it.desc).slice(0, 42)) +
        "</td><td>" + esc(it.label) + "</td><td class='mx-n'>" + num(it.n) +
        "</td><td class='mx-n'>" + fmtMeasure(it.v) + "</td></tr>";
    }).join("");

    return '<div class="rp">' +
      '<div class="rp-head"><div><h1>Material Summary</h1>' +
      "<p>" + esc(periodLabel()) + (drillActive() ? " \u00b7 " + esc(drillLabel()) : "") +
      " \u00b7 measured by " + esc(metricName.toLowerCase()) +
      " \u00b7 generated " + esc(new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })) + "</p></div>" +
      '<div class="rp-brand">Material Usage Log</div></div>' +
      kpis +
      '<div class="rp-cols">' +
      "<div><h2>Packaging vs ingredients</h2>" + miniTable(ag.byType) +
      "<h2>By product line</h2>" + miniTable(ag.byCat) + "</div>" +
      "<div><h2>Month over month</h2>" + monthBlock +
      "<h2>Likely causes</h2>" + miniTable((function () {
        var o = {};
        Object.keys(ag.noteBuckets).forEach(function (k) { o[ag.noteBuckets[k].label] = ag.noteBuckets[k].v; });
        return o;
      })()) + "</div>" +
      "</div>" +
      "<h2>Most-affected items</h2>" +
      "<table class='rp-tbl'><thead><tr><th>Item</th><th>Description</th><th>Category</th>" +
      "<th class='mx-n'>Entries</th><th class='mx-n'>" + esc(metricName) + "</th></tr></thead><tbody>" +
      (topRows || "<tr><td colspan='5'>None.</td></tr>") + "</tbody></table>" +
      '<p class="rp-foot">Unit costs come from the Sage item master; items without a cost on file are counted but not valued.</p>' +
      "</div>";
  }

  function printReport() {
    var list = drillEntries();
    if (!list.length) { toast("Nothing to report for this filter"); return; }
    $("reportArea").innerHTML = buildReport();
    document.body.classList.add("printing");
    var done = function () {
      document.body.classList.remove("printing");
      window.removeEventListener("afterprint", done);
    };
    window.addEventListener("afterprint", done);
    setTimeout(function () {
      try { window.print(); } catch (e) { toast("Printing isn't available here"); done(); }
      setTimeout(done, 1500);
    }, 60);
  }

  /* ---------------- gate + init ---------------- */
  function unlock() {
    $("gateArea").classList.add("hidden");
    $("sumArea").classList.remove("hidden");
    setStatus("warn", "Loading\u2026");
    loadEntries().then(function (list) {
      S.entries = list;
      setStatus(SHARED ? "ok" : "warn", SHARED ? "Live shared log" : "This device only");
      renderAll();
    }).catch(function () {
      setStatus("err", "Couldn't load entries");
      $("totalsArea").innerHTML = '<div class="empty">Couldn\'t reach the shared log. Check the connection and press Refresh.</div>';
    });
  }

  function tryGate() {
    var pw = cfg.EXPORT_PASSWORD;
    if (!pw || $("gateInput").value === pw) { unlock(); return; }
    $("gateErr").classList.remove("hidden");
    $("gateInput").value = "";
    $("gateInput").focus();
  }

  var inited = false;
  function init() {
    if (inited) return;   // safe to call twice (readyState races)
    inited = true;
    $("gateBtn").addEventListener("click", tryGate);
    $("gateInput").addEventListener("keydown", function (e) { if (e.key === "Enter") tryGate(); });
    $("periodSel").addEventListener("change", function () { S.period = this.value; renderAll(); });
    $("metricSel").addEventListener("change", function () { S.metric = this.value; renderAll(); });
    $("copySumBtn").addEventListener("click", copySummary);
    $("exportBtn").addEventListener("click", exportCsv);
    $("reportBtn").addEventListener("click", printReport);

    $("totalsArea").addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      if (b.id === "clearDrill") { S.fType = S.fCat = S.fMonth = S.fNote = null; renderAll(); return; }
      var dim = b.getAttribute("data-dim"), code = b.getAttribute("data-code");
      if (!dim) return;
      if (dim === "type") S.fType = S.fType === code ? null : code;
      else S.fCat = S.fCat === code ? null : code;
      renderAll();
    });

    $("reasonsArea").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-note]");
      if (!b) return;
      var code = b.getAttribute("data-note");
      S.fNote = S.fNote === code ? null : code;
      renderAll();
    });

    $("monthlyArea").addEventListener("click", function (e) {
      var tr = e.target.closest("tr[data-month]");
      if (!tr) return;
      var mk = tr.getAttribute("data-month");
      S.fMonth = S.fMonth === mk ? null : mk;
      renderAll();
    });
    $("refreshBtn").addEventListener("click", function () {
      setStatus("warn", "Loading\u2026");
      loadEntries().then(function (list) {
        S.entries = list;
        setStatus(SHARED ? "ok" : "warn", SHARED ? "Live shared log" : "This device only");
        renderAll();
        toast("Refreshed");
      }).catch(function () { setStatus("err", "Couldn't load entries"); });
    });
    if (!cfg.EXPORT_PASSWORD) unlock();
    else setTimeout(function () { $("gateInput").focus(); }, 60);
  }

  if (typeof document !== "undefined") {
    window.__s = {
      aggregate: aggregate, classifyCode: classifyCode, weekKey: weekKey,
      setEntries: function (l) { S.entries = l; }, setMetric: function (m) { S.metric = m; },
      buildReport: buildReport, monthKey: monthKey, fmtMonth: fmtMonth,
      drillEntries: drillEntries, noteBucket: noteBucket,
      setDrill: function (t, c, m, nt) { S.fType = t || null; S.fCat = c || null; S.fMonth = m || null; S.fNote = nt || null; },
      getDrill: function () { return { type: S.fType, cat: S.fCat, month: S.fMonth, note: S.fNote }; },
      setPeriod: function (p) { S.period = p; }, renderAll: renderAll, PRICE: PRICE, DESC: DESC,
    };
    window.__s.init = init;
    if (document.readyState !== "loading") init();
    else document.addEventListener("DOMContentLoaded", init);
  }
})();
