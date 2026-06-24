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
  SUPABASE_URL: "https://nsnbctfyuqokjnmcoxpb.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_IUJORXP6vPxX2l86VtuXqQ_Hh-53xak",

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
