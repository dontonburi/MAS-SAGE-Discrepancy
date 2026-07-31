// ---------------------------------------------------------------------------
// Storage configuration
//
// Leave everything blank  ->  entries are saved in the browser on each device
//                             (fine for a single shared floor computer).
//
// Fill in Supabase values ->  entries go to one shared database that the whole
//                             team sees, from any device. Setup takes ~10 min;
//                             step-by-step instructions are in README.md.
// ---------------------------------------------------------------------------
window.APP_CONFIG = {
  SUPABASE_URL: "https://tvoufsqcgyisdljctbsy.supabase.co",
  // Publishable key — safe to be public; access is controlled by the
  // Row Level Security policies on the table (see README.md).
  SUPABASE_ANON_KEY: "sb_publishable_GeohBi29H7w_k4TVwVWKTQ_H_5UyTXS",
  TABLE: "usage_entries",
  // Password required before the CSV export downloads. Change it here;
  // leave it "" to turn the password off. Note: this deters casual clicks,
  // but anyone who reads the page source can find it.
  EXPORT_PASSWORD: "COTY82626!!",
};
