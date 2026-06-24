// ============================================================
// KG Plasterceil Pass & License Tracker
// Supabase config
// ============================================================
//
// DONKEY STEP:
// Replace the 2 values below with your own Supabase project values.
//
// Where to find:
// Supabase > Project Settings > API
//
// Project URL     = SUPABASE_URL
// anon public key = SUPABASE_ANON_KEY
//
// IMPORTANT:
// The anon key is okay to put in GitHub Pages.
// NEVER put service_role key here.
// ============================================================

window.KG_CONFIG = {
  SUPABASE_URL: "PASTE_YOUR_SUPABASE_PROJECT_URL_HERE",
  SUPABASE_ANON_KEY: "PASTE_YOUR_SUPABASE_ANON_PUBLIC_KEY_HERE",

  // Visible PINs typed by staff.
  // Behind the scenes, the website logs in to Supabase Auth user.
  VIEW_PIN: "1234",
  EDIT_PIN: "hengonghuat",

  VIEW_EMAIL: "kg-view@kgplasterceil.local",
  VIEW_PASSWORD: "kgview1234",

  EDIT_EMAIL: "kg-edit@kgplasterceil.local",
  EDIT_PASSWORD: "hengonghuat",

  STORAGE_BUCKET: "kg-pass-license-files"
};
