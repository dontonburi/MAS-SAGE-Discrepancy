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
  SUPABASE_URL: "",       // e.g. "https://abcd1234.supabase.co"
  SUPABASE_ANON_KEY: "",  // the long "anon public" key from Supabase settings
  TABLE: "usage_entries",
};
