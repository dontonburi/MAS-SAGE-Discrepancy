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
     than being guessed into one of those, so the count stays honest. "Not enough
     qty" is different (the lot is there, just short) and has its own bucket.
   - Rules were rebuilt in Oct 2026 against all 780 notes in the live log,
     including the team's common typos ("fully use", "has been remove", "recieved").

   To tune: edit a pattern, or add a rule above the ambiguous ones. */
(function () {
  var BUCKETS = [
    {
      id: "depleted",
      label: "Already used up",
      hint: "Received, but the lot was fully consumed before this batch.",
      // real spellings: "fully used", "has been fully use", "fullyu used", "fully sed",
      // "used fully", "completed use", "completely used", "fully consumed"
      re: /(fully\s*(u?se?d?|consumed)\b|fullyu\s*used|\bused\s+fully\b|complete(d|ly)\s+(use|consumed)|\bdepleted\b|\bused up\b|already (been )?used|no stock left|nothing left)/i,
    },
    {
      id: "removed",
      label: "Lot removed from MAS",
      hint: "The lot existed but was taken out (adjustment, physical count, or cleanup).",
      re: /\b(remov(e|ed)|taken out|written off|wrote off)\b/i,
    },
    {
      id: "short",
      label: "Received short",
      hint: "Only part of the quantity was booked in.",
      re: /(\bonly\s+[\d,.]+\s+(were\s+|was\s+)?rec(ei|ie)ved|\bwe only rec(ei|ie)ved|\bonly rec(ei|ie)ved)/i,
    },
    {
      id: "receiving",
      label: "Not received / receiving error",
      hint: "Never booked in, or booked in wrong.",
      re: /(receiving error|incorrect receiving|received wrong|miss(ed)? receiving|(never|not|hasn'?t|haven'?t|didn'?t|wasn'?t|needs to be)\s+(been\s+|be\s+)?rec(ei|ie)v|receiv\w*\s+(error|issue|problem)|missing\s+receiv)/i,
    },
    {
      id: "allocated",
      label: "On hand but can't pull",
      hint: "MAS shows stock, but it's allocated, held, expired, or otherwise unavailable.",
      re: /(\ballocated\b|(not|no|un)\s*(able|available)\s+to\s+pull|not able to pull|showing on hand|shows on hand|\b0 available\b|\bexp(\.|iry|ired|iration)?\s+(date|of)\b|\bexp\.?\s+date\b)/i,
    },
    {
      id: "notenough",
      label: "Not enough qty in MAS",
      hint: "The lot is in MAS but holds less than production used.",
      re: /(not enough|\bonly ha(ve|d)\b|need(ed)? additional|i need [\d,]+ more|still missing|missing [\d,]+)/i,
    },
    {
      id: "notinmas",
      label: "Not in MAS — cause unclear",
      hint: "System shows nothing and the note doesn't say why: could be not received, used up, or removed.",
      re: /(not\s+(in|on|ni|is)\s+(mas|ams|sage|the system)|no qty in (mas|sage)|qty not (in|is) mas|not anymore in the system|nothing in (mas|sage|the system)|zero in mas|missing (from|in) (mas|sage|the system))/i,
    },
    {
      id: "count",
      label: "Inventory count error",
      hint: "EOY or physical count is off.",
      re: /\b(eoy|physical count|cycle count|inventory count|bad count|miscount|counted wrong|count issue)\b/i,
    },
    {
      id: "rework",
      label: "Rework",
      hint: "Rework not recorded, or rework needing extra material.",
      re: /\brework/i,
    },
    {
      id: "label",
      label: "Label or sticker mismatch",
      hint: "Label/sticker counts disagree with the system.",
      re: /\b(labels?|stickers?|sticker count)\b/i,
    },
    {
      id: "wrongid",
      label: "Wrong item or lot recorded",
      hint: "Production wrote down the wrong item code or lot.",
      re: /(correct item|wrong (item|lot|code)|converted into|writing down the wrong)/i,
    },
    {
      id: "elsewhere",
      label: "Stock is elsewhere",
      hint: "Sitting under another item, lot, warehouse, bin, or site.",
      re: /(\b(it'?s|its|they'?re|there is|there'?s|some)\s+(at|under|in)\b|\bunder\s+(wh|vsw|\d{4,})|\bat\s+(dc\d|000)\b|\bhold bin\b|transfer(r)?ing out|wrong (location|warehouse)|another (item|location|warehouse))/i,
    },
    {
      id: "lotsub",
      label: "Use another lot",
      hint: "A different (usually older) lot will be consumed to cover it.",
      re: /(will be consumed|is being consumed|be consumed|take from|pull from|oldest lot|consume (the )?(older|other|another)|actual lot is|\buse lot\b|\buse \d{6,})/i,
    },
    {
      id: "usage",
      label: "Usage / reporting mismatch",
      hint: "Overpull, or production reported different numbers.",
      re: /\b(overpull|over ?pull|over ?used|production (team )?(is |i )?reporting|reporting \d|reported an additional|short by|still short|variance|i only needed?)\b/i,
    },
    {
      id: "pending",
      label: "Needs follow-up",
      hint: "A question or request for someone to check.",
      re: /((^|\b)(pending|tbd|to be determined|follow ?up|checking|investigating|waiting on)\b|could you (please )?help|can you help|can we check|need help|what do we do|ok to pull\?)/i,
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
