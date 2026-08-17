"use strict";
/* Material taxonomy — turns an item description into a type + category.
   Descriptions from Sage look like "PK-A-CAN 7 BREW 15OZ" or "IN-P-Mojito MM":
     first part  = what it is      PK packaging, IN ingredient
     second part = which product   A aerosol, P pops, D drinks, W water, ...
   Real data is messy ("IN_A_...", "PK- A- ...", "IN-A 3 Fold Vanilla"), so the
   parser tolerates spaces, underscores, and missing dashes.

   To name a category that currently shows as its bare letter, add it here. */
(function () {
  var TYPE_LABELS = {
    PK: "Packaging",
    IN: "Ingredients",
  };

  var CAT_LABELS = {
    A: "Aerosol",
    P: "Pops",
    D: "Drinks",
    W: "Water",
    // M: "",
    // C: "",
    // E: "",
    // T: "",
  };

  /* A few real materials predate the naming convention and carry no prefix.
     Add a rule here if the team starts logging something else uncategorised;
     first match wins, and these only apply when there is no PK-/IN- prefix. */
  var OVERRIDES = [
    { re: /\b(city|spring|distilled|reverse osmosis|ro)\s+water\b/i, type: "IN", cat: "W" },
    { re: /\b(pallets?|chep)\b/i, type: "PK", cat: "" },
  ];

  // Description prefix: TYPE separator CATEGORY separator rest.
  // Accepts "-", "_", spaces, and repeated or missing separators.
  var PREFIX = /^\s*(IN|PK)[\s\-_]*([A-Z]{1,2})(?=[\s\-_])/i;

  function classify(desc) {
    var d = String(desc == null ? "" : desc);
    var m = PREFIX.exec(d);
    if (!m) {
      for (var i = 0; i < OVERRIDES.length; i++) {
        if (OVERRIDES[i].re.test(d)) {
          var o = OVERRIDES[i];
          return {
            type: o.type, cat: o.cat, key: o.type + "-" + (o.cat || "?"),
            label: (TYPE_LABELS[o.type] || o.type) + (o.cat ? " \u00b7 " + (CAT_LABELS[o.cat] || o.cat) : " \u00b7 Unspecified"),
          };
        }
      }
      return { type: "", cat: "", key: "?", label: "Unclassified" };
    }
    var type = m[1].toUpperCase();
    var cat = m[2].toUpperCase();
    // Two-letter categories (e.g. "TA") aren't a known bucket — keep the first
    // letter only when the pair isn't itself a label we know.
    if (cat.length === 2 && !CAT_LABELS[cat]) cat = cat.charAt(0);
    return {
      type: type,
      cat: cat,
      key: type + "-" + cat,
      label: (TYPE_LABELS[type] || type) + " \u00b7 " + (CAT_LABELS[cat] || cat),
    };
  }

  function typeLabel(t) { return TYPE_LABELS[t] || (t ? t : "Unclassified"); }
  function catLabel(c) { return CAT_LABELS[c] || (c ? c : "Unclassified"); }

  var api = {
    classify: classify,
    typeLabel: typeLabel,
    catLabel: catLabel,
    TYPE_LABELS: TYPE_LABELS,
    CAT_LABELS: CAT_LABELS,
  };
  if (typeof window !== "undefined") window.TAXONOMY = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
