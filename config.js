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
  // Paste your key below (Supabase: Project Settings -> API Keys).
  // Use the "anon public" key, or the "Publishable" key on newer projects.
  // The app stays in device-only mode until this is filled in.
  SUPABASE_ANON_KEY: "",
  TABLE: "usage_entries",
};
