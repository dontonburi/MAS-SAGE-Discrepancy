"use strict";
(function () {
  var cfg = (typeof window !== "undefined" && window.APP_CONFIG) || {};
  var TAX = (typeof window !== "undefined" && window.TAXONOMY) || null;

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
  var S = { entries: [], period: "all", metric: "count", toastTimer: null };

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
            date: r.used_on, rectified: !!r.rectified,
            ts: Date.parse(r.created_at) || 0,
          };
        });
      });
    }
    var list = [];
    try { list = JSON.parse(localStorage.getItem("material-usage-entries") || "[]"); } catch (e) { list = []; }
    return Promise.resolve((Array.isArray(list) ? list : []).map(function (e) {
      return { code: e.code, desc: e.desc || "", qty: Number(e.qty) || 0, date: e.date, rectified: !!e.rectified, ts: e.ts || 0 };
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
  function valueOf(e) {
    var p = PRICE[e.code];
    return p == null ? 0 : p * e.qty;
  }
  function measure(e) { return S.metric === "value" ? valueOf(e) : 1; }
  function fmtMeasure(v) { return S.metric === "value" ? money(v) : num(v); }

  function aggregate(list) {
    var byType = {}, byCat = {}, byKey = {}, byItem = {}, weeks = {}, catKeys = {};
    var missingPrice = 0, totalVal = 0;
    list.forEach(function (e) {
      var c = classifyCode(e.code, e.desc);
      var tl = c.type ? (TAX ? TAX.typeLabel(c.type) : c.type) : "Unclassified";
      var cl = c.cat ? (TAX ? TAX.catLabel(c.cat) : c.cat) : (c.type ? "Unspecified" : "Unclassified");
      var m = measure(e);
      byType[tl] = (byType[tl] || 0) + m;
      byCat[cl] = (byCat[cl] || 0) + m;
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
      if (PRICE[e.code] == null) missingPrice++;
      totalVal += valueOf(e);
    });
    return {
      byType: byType, byCat: byCat, byKey: byKey, weeks: weeks,
      cats: Object.keys(catKeys).sort(),
      items: Object.keys(byItem).map(function (k) { return byItem[k]; }),
      missingPrice: missingPrice, totalVal: totalVal, n: list.length,
    };
  }

  /* ---------------- rendering ---------------- */
  function statRow(obj, totalForPct) {
    var keys = Object.keys(obj).sort(function (a, b) { return obj[b] - obj[a]; });
    if (!keys.length) return '<div class="empty">Nothing in this period.</div>';
    return '<div class="stat-row">' + keys.map(function (k) {
      var pct = totalForPct ? Math.round((obj[k] / totalForPct) * 100) : 0;
      return '<div class="stat"><span class="stat-k">' + esc(k) + "</span><b>" + fmtMeasure(obj[k]) +
        '</b><span class="stat-pct">' + pct + "%</span></div>";
    }).join("") + "</div>";
  }

  function renderTotals(ag) {
    var area = $("totalsArea");
    if (!ag.n) {
      area.innerHTML = '<div class="empty">No entries in this period.</div>';
      return;
    }
    var totalMeasure = S.metric === "value" ? ag.totalVal : ag.n;
    var head = '<div class="stat-row"><div class="stat stat-total"><span class="stat-k">Entries</span><b>' + num(ag.n) + "</b></div>" +
      '<div class="stat stat-total"><span class="stat-k">Value</span><b>' + money(ag.totalVal) + "</b></div>" +
      (ag.missingPrice
        ? '<div class="stat"><span class="stat-k">No unit cost on file</span><b>' + num(ag.missingPrice) + "</b></div>"
        : "") + "</div>";
    area.innerHTML =
      head +
      '<div class="stat-block"><div class="stat-h">Packaging vs ingredients</div>' + statRow(ag.byType, totalMeasure) + "</div>" +
      '<div class="stat-block"><div class="stat-h">By product line</div>' + statRow(ag.byCat, totalMeasure) + "</div>" +
      '<div class="stat-block"><div class="stat-h">Type \u00d7 line</div>' + statRow(ag.byKey, totalMeasure) + "</div>";
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
    var list = periodEntries();
    var ag = aggregate(list);
    $("entryCount").textContent = ag.n + (ag.n === 1 ? " entry" : " entries");
    $("copySumBtn").disabled = !ag.n;
    $("exportBtn").disabled = !ag.n;
    renderTotals(ag);
    renderWeekly(ag);
    renderTop(ag);
    return ag;
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
    var ag = aggregate(periodEntries());
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
    var list = periodEntries();
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

  function init() {
    $("gateBtn").addEventListener("click", tryGate);
    $("gateInput").addEventListener("keydown", function (e) { if (e.key === "Enter") tryGate(); });
    $("periodSel").addEventListener("change", function () { S.period = this.value; renderAll(); });
    $("metricSel").addEventListener("change", function () { S.metric = this.value; renderAll(); });
    $("copySumBtn").addEventListener("click", copySummary);
    $("exportBtn").addEventListener("click", exportCsv);
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
      setPeriod: function (p) { S.period = p; }, renderAll: renderAll, PRICE: PRICE, DESC: DESC,
    };
    if (document.readyState !== "loading") init();
    else document.addEventListener("DOMContentLoaded", init);
  }
})();
