"use strict";
/* Sorts the free-text note on an entry into a likely root-cause bucket.

   These rules were written from the notes the team has actually typed —
   "Receiving Error", "Depleted, please take from 2368866", "it's under WH",
   "NOT IN MAS", "Reworked but not recorded?" and so on.

   Two things worth knowing before trusting the numbers:
   - Rules are checked in order and the FIRST match wins, so specific causes
     ("this was received, but completely used") beat vague ones ("NOT IN MAS").
     Anything else a note matches is kept as a secondary tag.
   - "Not in MAS" on its own is genuinely ambiguous — it can mean never received,
     already consumed, or a lot that was removed. It gets its own bucket rather
     than being guessed into one of those, so the count stays honest.

   To tune: edit a pattern, or add a rule above the ambiguous ones. */
(function () {
  var BUCKETS = [
    {
      id: "depleted",
      label: "Already used up",
      hint: "Received, but the lot was fully consumed before this batch.",
      re: /\b(depleted|completely used|fully used|used up|already (been )?used|no stock left|nothing left)\b/i,
    },
    {
      id: "receiving",
      label: "Not received / receiving error",
      hint: "Never booked in, or booked in wrong.",
      re: /(receiving error|incorrect receiving|(never|not|hasn'?t|haven'?t|didn'?t|wasn'?t)\s+(been\s+)?receiv|receiv\w*\s+(error|issue|problem)|missing\s+receiv)/i,
    },
    {
      id: "count",
      label: "Inventory count error",
      hint: "EOY or physical count is off.",
      re: /\b(eoy|physical count|cycle count|inventory count|bad count|miscount|counted wrong|count issue)\b/i,
    },
    {
      id: "rework",
      label: "Rework not recorded",
      hint: "Material was reworked but the transaction never happened.",
      re: /\brework/i,
    },
    {
      id: "label",
      label: "Label or sticker mismatch",
      hint: "Label/sticker counts disagree with the system.",
      re: /\b(labels?|stickers?)\b/i,
    },
    {
      id: "elsewhere",
      label: "Stock is elsewhere",
      hint: "Sitting under another item, lot, warehouse, or site.",
      re: /(\b(it'?s|its|they'?re|there is|there'?s|some)\s+(at|under|in)\b|\bunder\s+(wh|\d{4,})|\bat\s+(dc\d|000)\b|wrong (location|warehouse)|another (item|location|warehouse))/i,
    },
    {
      id: "lotsub",
      label: "Lot substitution planned",
      hint: "A different lot will be consumed to cover it.",
      re: /(will be consumed|is being consumed|be consumed|take from|pull from|consume (the )?(older|other|another)|actual lot is|use lot)/i,
    },
    {
      id: "usage",
      label: "Usage / reporting mismatch",
      hint: "Overpull, or production reported different numbers.",
      re: /\b(overpull|over ?pull|over ?used|production (team )?(is )?reporting|reporting \d|short by|still short|variance)\b/i,
    },
    {
      id: "notinmas",
      label: "Not in MAS \u2014 cause unclear",
      hint: "System shows nothing (or not enough) and the note doesn't say why.",
      re: /(not (in|on) mas|no[t]? .{0,12}in the system|not enough qty|missing (from|in) (mas|the system)|nothing in mas|zero in mas)/i,
    },
    {
      id: "pending",
      label: "Pending follow-up",
      hint: "Flagged for someone to check.",
      re: /(^|\b)(pending|tbd|to be determined|follow ?up|checking|investigating|waiting on)\b/i,
    },
  ];

  function classifyNote(text) {
    var t = String(text == null ? "" : text).trim();
    if (!t) return { id: "none", label: "No note", tags: [], hint: "Nothing was written on the entry." };
    var primary = null, tags = [];
    for (var i = 0; i < BUCKETS.length; i++) {
      if (BUCKETS[i].re.test(t)) {
        if (!primary) primary = BUCKETS[i];
        else tags.push(BUCKETS[i].id);
      }
    }
    if (!primary) {
      return { id: "other", label: "Uncategorised note", tags: [], hint: "A note was written but it matches no known pattern." };
    }
    return { id: primary.id, label: primary.label, hint: primary.hint, tags: tags };
  }

  function bucketLabel(id) {
    if (id === "none") return "No note";
    if (id === "other") return "Uncategorised note";
    for (var i = 0; i < BUCKETS.length; i++) if (BUCKETS[i].id === id) return BUCKETS[i].label;
    return id;
  }

  var api = { classifyNote: classifyNote, bucketLabel: bucketLabel, BUCKETS: BUCKETS };
  if (typeof window !== "undefined") window.NOTES = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
