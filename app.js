// ============================================================
// KG Plasterceil Pass & License Tracker
// Frontend app.js
// ============================================================

let supabaseClient = null;
let currentMode = null; // viewer / editor
let people = [];
let items = [];
let selectedItemNames = new Set();

const $ = (id) => document.getElementById(id);

function showToast(message) {
  const t = $("toast");
  t.textContent = message;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 2600);
}

function setMsg(message) {
  $("loginMsg").textContent = message || "";
}

function cleanSupabaseUrl(url) {
  return String(url || "")
    .trim()
    .replace(/\/+$/g, "")
    .replace(/\/rest\/v1$/i, "")
    .replace(/\/auth\/v1$/i, "")
    .replace(/\/storage\/v1$/i, "");
}

function requireConfig() {
  const cfg = window.KG_CONFIG || {};
  cfg.SUPABASE_URL = cleanSupabaseUrl(cfg.SUPABASE_URL);

  if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes("PASTE_")) {
    throw new Error("config.js not set. Put your Supabase Project URL.");
  }
  if (!cfg.SUPABASE_URL.startsWith("https://") || !cfg.SUPABASE_URL.includes(".supabase.co")) {
    throw new Error("Supabase URL wrong. Use only https://xxxxx.supabase.co");
  }
  if (!cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY.includes("PASTE_")) {
    throw new Error("config.js not set. Put your Supabase anon public key.");
  }
  return cfg;
}

function initSupabase() {
  const cfg = requireConfig();
  supabaseClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: {
      storageKey: "kg-pass-license-auth-token-v2",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    }
  });
}

function todayAtMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDateOnly(dateStr) {
  if (!dateStr) return null;
  const parts = String(dateStr).split("-");
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]) - 1;
  const d = Number(parts[2]);
  return new Date(y, m, d);
}

function formatDateSG(dateStr) {
  if (!dateStr) return "No expiry date";
  const d = parseDateOnly(dateStr);
  if (!d || Number.isNaN(d.getTime())) return dateStr;
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function daysRemaining(dateStr) {
  const d = parseDateOnly(dateStr);
  if (!d) return null;
  const t = todayAtMidnight();
  return Math.round((d - t) / 86400000);
}

function statusForItem(item) {
  const days = daysRemaining(item.expiry_date);

  if (days === null) {
    return {
      key: "none",
      label: "No Expiry Date",
      group: 5,
      badgeClass: "",
      daysText: "No expiry date"
    };
  }

  if (days < 0) {
    return {
      key: "expired",
      label: "Expired",
      group: 1,
      badgeClass: "red",
      daysText: `${Math.abs(days)} days expired`
    };
  }

  if (item.category === "pass") {
    if (days <= 15) return { key: "red", label: "Red", group: 2, badgeClass: "red", daysText: `${days} days left` };
    if (days <= 30) return { key: "yellow", label: "Yellow", group: 3, badgeClass: "yellow", daysText: `${days} days left` };
  }

  if (item.category === "license") {
    if (days <= 35) return { key: "red", label: "Red", group: 2, badgeClass: "red", daysText: `${days} days left` };
    if (days <= 60) return { key: "yellow", label: "Yellow", group: 3, badgeClass: "yellow", daysText: `${days} days left` };
  }

  return {
    key: "normal",
    label: "Normal",
    group: 4,
    badgeClass: "green",
    daysText: `${days} days left`
  };
}

function personById(id) {
  return people.find((p) => p.id === id) || null;
}

function combinedRows() {
  return items
    .filter((item) => !item.is_archived)
    .map((item) => {
      const person = personById(item.person_id);
      const status = statusForItem(item);
      return { item, person, status };
    })
    .filter((row) => row.person && !row.person.is_archived)
    .sort((a, b) => {
      if (a.status.group !== b.status.group) return a.status.group - b.status.group;
      const da = parseDateOnly(a.item.expiry_date);
      const db = parseDateOnly(b.item.expiry_date);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da - db;
    });
}


function normalizeName(name) {
  return String(name || "").trim().toLowerCase();
}

function cleanFolderName(name) {
  return String(name || "Unknown")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .slice(0, 80) || "Unknown";
}

function cleanFileName(name) {
  return String(name || "file")
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 140) || "file";
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function getSelectedStatuses() {
  return Array.from(document.querySelectorAll(".status-filter:checked")).map((x) => x.value);
}

function filteredRows() {
  const query = $("searchInput").value.trim();
  const allowPass = $("filterPass") ? $("filterPass").checked : true;
  const allowLicense = $("filterLicense") ? $("filterLicense").checked : true;
  const statuses = getSelectedStatuses();

  return combinedRows().filter((row) => {
    if (row.item.category === "pass" && !allowPass) return false;
    if (row.item.category === "license" && !allowLicense) return false;
    if (statuses.length && !statuses.includes(row.status.key)) return false;
    if (selectedItemNames.size > 0 && !selectedItemNames.has(normalizeName(row.item.item_name))) return false;
    if (!rowMatchesSearch(row, query)) return false;
    return true;
  });
}

function renderItemNameFilters() {
  const box = $("itemNameFilters");
  if (!box) return;
  const oldSelected = new Set(selectedItemNames);
  box.innerHTML = "";

  const map = new Map();
  for (const item of items.filter((x) => !x.is_archived)) {
    const key = normalizeName(item.item_name);
    if (!key) continue;
    if (!map.has(key)) map.set(key, { label: item.item_name, count: 0 });
    map.get(key).count++;
  }

  const names = Array.from(map.entries()).sort((a, b) => a[1].label.localeCompare(b[1].label));
  if (names.length === 0) {
    box.innerHTML = `<span class="muted">No pass/license item yet.</span>`;
    return;
  }

  for (const [key, obj] of names) {
    const label = document.createElement("label");
    label.className = "check-pill";
    const checked = oldSelected.size === 0 || oldSelected.has(key) ? "checked" : "";
    label.innerHTML = `<input type="checkbox" class="item-name-filter" value="${escapeAttr(key)}" ${checked}> ${escapeHtml(obj.label)} (${obj.count})`;
    box.appendChild(label);
  }
}

function updateSelectedItemNamesFromUI() {
  const all = Array.from(document.querySelectorAll(".item-name-filter"));
  const checked = all.filter((x) => x.checked).map((x) => x.value);
  selectedItemNames = new Set(checked);
  if (checked.length === all.length) selectedItemNames = new Set();
}

function renderGraph() {
  const box = $("graphBox");
  if (!box) return;

  const rows = filteredRows();
  const mode = $("graphMode") ? $("graphMode").value : "status";
  const counts = new Map();

  if (mode === "category") {
    for (const row of rows) {
      const label = row.item.category === "pass" ? "Site Pass" : "License";
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  } else if (mode === "item") {
    for (const row of rows) {
      const label = row.item.item_name || "Unknown";
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  } else {
    const labelMap = { expired: "Expired", red: "Red", yellow: "Yellow", normal: "Normal", none: "No Date" };
    for (const row of rows) {
      const label = labelMap[row.status.key] || row.status.label;
      counts.set(label, (counts.get(label) || 0) + 1);
    }
  }

  const data = Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  box.innerHTML = "";
  if (data.length === 0) {
    box.innerHTML = `<p class="muted">No data for graph.</p>`;
    return;
  }

  const max = Math.max(...data.map((x) => x.count), 1);
  for (const row of data.slice(0, 20)) {
    const width = Math.max(5, Math.round((row.count / max) * 100));
    const div = document.createElement("div");
    div.className = "graph-row";
    div.innerHTML = `
      <div class="graph-label" title="${escapeAttr(row.label)}">${escapeHtml(row.label)}</div>
      <div class="graph-track"><div class="graph-bar" style="width:${width}%"></div></div>
      <div class="graph-value">${row.count}</div>
    `;
    box.appendChild(div);
  }
}

function renderAll() {
  renderSummary();
  renderGraph();
  renderCards();
}

async function login() {
  try {
    initSupabase();
  } catch (err) {
    setMsg(err.message);
    return;
  }

  const cfg = window.KG_CONFIG;
  const pin = $("pinInput").value.trim();

  let email = "";
  let password = "";

  if (pin === cfg.VIEW_PIN) {
    currentMode = "viewer";
    email = cfg.VIEW_EMAIL;
    password = cfg.VIEW_PASSWORD;
  } else if (pin === cfg.EDIT_PIN) {
    currentMode = "editor";
    email = cfg.EDIT_EMAIL;
    password = cfg.EDIT_PASSWORD;
  } else {
    setMsg("Wrong PIN.");
    return;
  }

  setMsg("Opening...");

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

  if (error) {
    const msg = String(error.message || "");
    if (msg.toLowerCase().includes("invalid path") || msg.includes("404")) {
      setMsg("Login failed: Supabase URL wrong/cache. Upload V2 index.html app.js config.js and Ctrl+F5.");
    } else {
      setMsg("Login failed: " + msg);
    }
    return;
  }

  $("loginScreen").classList.add("hidden");
  $("appScreen").classList.remove("hidden");

  $("modeText").textContent = currentMode === "editor"
    ? "Edit mode: can add, edit, delete, upload copy"
    : "View mode: can see only";

  $("editorPanel").classList.toggle("hidden", currentMode !== "editor");

  await loadAll();
}

async function logout() {
  if (supabaseClient) {
    await supabaseClient.auth.signOut();
  }
  currentMode = null;
  people = [];
  items = [];
  $("pinInput").value = "";
  $("appScreen").classList.add("hidden");
  $("loginScreen").classList.remove("hidden");
  setMsg("");
}

async function loadAll() {
  const peopleRes = await supabaseClient
    .from("people")
    .select("*")
    .eq("is_archived", false)
    .order("name", { ascending: true });

  if (peopleRes.error) {
    showToast("People load error: " + peopleRes.error.message);
    return;
  }

  const itemsRes = await supabaseClient
    .from("expiry_items")
    .select("*")
    .eq("is_archived", false);

  if (itemsRes.error) {
    showToast("Items load error: " + itemsRes.error.message);
    return;
  }

  people = peopleRes.data || [];
  items = itemsRes.data || [];

  renderPersonDropdown();
  renderItemNameFilters();
  renderAll();
}

function renderPersonDropdown() {
  const sel = $("itemPerson");
  sel.innerHTML = "";
  for (const p of people) {
    const opt = document.createElement("option");
    opt.value = p.id;
    opt.textContent = `${p.name}${p.nickname ? " / " + p.nickname : ""} - ${p.role}`;
    sel.appendChild(opt);
  }
}

function renderSummary() {
  const rows = filteredRows();

  let expired = 0;
  let red = 0;
  let yellow = 0;
  let normal = 0;

  for (const row of rows) {
    if (row.status.key === "expired") expired++;
    else if (row.status.key === "red") red++;
    else if (row.status.key === "yellow") yellow++;
    else if (row.status.key === "normal") normal++;
  }

  $("expiredCount").textContent = expired;
  $("redCount").textContent = red;
  $("yellowCount").textContent = yellow;
  $("normalCount").textContent = normal;
  $("workerCount").textContent = people.filter((p) => p.role === "Worker").length;
  $("foremanCount").textContent = people.filter((p) => p.role === "Foreman").length;
}

function rowMatchesSearch(row, query) {
  if (!query) return true;

  const person = row.person;
  const item = row.item;
  const status = row.status;

  const haystack = [
    person.name,
    person.nickname,
    person.role,
    person.notes,
    item.category,
    item.item_name,
    item.notes,
    item.expiry_date,
    status.key,
    status.label,
    status.daysText,
    item.file_name
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes(query.toLowerCase());
}

function renderCards() {
  const list = $("cardList");
  list.innerHTML = "";

  const rows = filteredRows();
  const withCopy = rows.filter((r) => !!r.item.file_path).length;

  $("listInfo").textContent = `${rows.length} item(s) shown | ${withCopy} with uploaded copy`;

  if (rows.length === 0) {
    list.innerHTML = `<div class="item-card"><b>No record found.</b><p class="muted">Try clear filter or search other word.</p></div>`;
    return;
  }

  for (const row of rows) {
    const { item, person, status } = row;

    const card = document.createElement("article");
    card.className = `item-card status-${status.key}`;

    const categoryLabel = item.category === "pass" ? "Site Pass" : "License";
    const nickText = person.nickname ? ` / ${escapeHtml(person.nickname)}` : "";
    const notes = [person.notes, item.notes].filter(Boolean).join(" | ");

    card.innerHTML = `
      <div class="item-top">
        <div>
          <div class="person-name">${escapeHtml(person.name)}${nickText}</div>
          <div class="item-title">${escapeHtml(item.item_name)} (${categoryLabel})</div>
        </div>
        <div class="badges">
          <span class="badge">${escapeHtml(person.role)}</span>
          <span class="badge ${status.badgeClass}">${escapeHtml(status.label)}</span>
          <span class="badge">${escapeHtml(status.daysText)}</span>
        </div>
      </div>

      <div class="badges">
        <span class="badge">Expiry: ${formatDateSG(item.expiry_date)}</span>
        ${item.file_path ? `<span class="badge green">Copy uploaded</span>` : `<span class="badge">No copy</span>`}
      </div>

      ${notes ? `<div class="notes">${escapeHtml(notes)}</div>` : ""}

      <div class="card-actions">
        ${item.file_path ? `<button class="small-btn" data-action="download" data-id="${item.id}">Download Copy</button>` : ""}
        ${currentMode === "editor" ? `
          <button class="small-btn" data-action="edit-person" data-id="${person.id}">Edit Person</button>
          <button class="small-btn" data-action="edit-item" data-id="${item.id}">Edit Item</button>
        ` : ""}
      </div>
    `;

    list.appendChild(card);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function savePerson() {
  if (currentMode !== "editor") return;

  const id = $("personId").value || null;
  const payload = {
    name: $("personName").value.trim(),
    nickname: $("personNickname").value.trim() || null,
    role: $("personRole").value,
    notes: $("personNotes").value.trim() || null
  };

  if (!payload.name) {
    showToast("Person name required.");
    return;
  }

  let res;
  if (id) {
    res = await supabaseClient.from("people").update(payload).eq("id", id);
  } else {
    res = await supabaseClient.from("people").insert(payload);
  }

  if (res.error) {
    showToast("Save person error: " + res.error.message);
    return;
  }

  resetPersonForm();
  await loadAll();
  showToast("Person saved.");
}

function resetPersonForm() {
  $("personId").value = "";
  $("personName").value = "";
  $("personNickname").value = "";
  $("personRole").value = "Worker";
  $("personNotes").value = "";
}

async function deletePerson() {
  if (currentMode !== "editor") return;

  const id = $("personId").value;
  if (!id) {
    showToast("Choose person first.");
    return;
  }

  if (!confirm("Delete/archive this person? Their items will hide too.")) return;

  const res = await supabaseClient
    .from("people")
    .update({ is_archived: true })
    .eq("id", id);

  if (res.error) {
    showToast("Delete person error: " + res.error.message);
    return;
  }

  resetPersonForm();
  await loadAll();
  showToast("Person deleted.");
}

function editPerson(id) {
  const p = people.find((x) => x.id === id);
  if (!p) return;

  $("personId").value = p.id;
  $("personName").value = p.name || "";
  $("personNickname").value = p.nickname || "";
  $("personRole").value = p.role || "Worker";
  $("personNotes").value = p.notes || "";

  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function saveItem() {
  if (currentMode !== "editor") return;

  const id = $("itemId").value || null;
  const fileInput = $("itemFile");
  const chosenFile = fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;

  const payload = {
    person_id: $("itemPerson").value,
    category: $("itemCategory").value,
    item_name: $("itemName").value.trim(),
    expiry_date: $("itemExpiryDate").value || null,
    notes: $("itemNotes").value.trim() || null
  };

  if (!payload.person_id) {
    showToast("Choose person first.");
    return;
  }

  if (!payload.item_name) {
    showToast("Pass/license name required.");
    return;
  }

  let itemId = id;
  let res;

  if (id) {
    res = await supabaseClient.from("expiry_items").update(payload).eq("id", id).select("*").single();
  } else {
    res = await supabaseClient.from("expiry_items").insert(payload).select("*").single();
  }

  if (res.error) {
    showToast("Save item error: " + res.error.message);
    return;
  }

  itemId = res.data.id;

  if (chosenFile) {
    const uploadOk = await uploadFileForItem(itemId, payload.person_id, chosenFile);
    if (!uploadOk) return;
  }

  resetItemForm();
  await loadAll();
  showToast("Item saved.");
}

async function uploadFileForItem(itemId, personId, file) {
  const cfg = window.KG_CONFIG;
  const allowed = ["application/pdf", "image/jpeg", "image/png"];
  const fileName = file.name || "copy";
  const mime = file.type || "";

  if (!allowed.includes(mime)) {
    showToast("Only PDF, JPG, PNG allowed.");
    return false;
  }

  if (file.size > 5 * 1024 * 1024) {
    showToast("File too big. Max 5MB.");
    return false;
  }

  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filePath = `${personId}/${itemId}/${Date.now()}-${safeName}`;

  const up = await supabaseClient.storage
    .from(cfg.STORAGE_BUCKET)
    .upload(filePath, file, {
      cacheControl: "3600",
      upsert: true,
      contentType: mime
    });

  if (up.error) {
    showToast("Upload error: " + up.error.message);
    return false;
  }

  const upd = await supabaseClient
    .from("expiry_items")
    .update({
      file_path: filePath,
      file_name: fileName,
      file_mime_type: mime,
      file_size_bytes: file.size
    })
    .eq("id", itemId);

  if (upd.error) {
    showToast("Save file info error: " + upd.error.message);
    return false;
  }

  return true;
}

function resetItemForm() {
  $("itemId").value = "";
  $("existingFilePath").value = "";
  $("itemCategory").value = "pass";
  $("itemName").value = "";
  $("itemExpiryDate").value = "";
  $("itemNotes").value = "";
  $("itemFile").value = "";
  $("currentFileBox").classList.add("hidden");
  $("currentFileBox").innerHTML = "";
}

function editItem(id) {
  const item = items.find((x) => x.id === id);
  if (!item) return;

  $("itemId").value = item.id;
  $("existingFilePath").value = item.file_path || "";
  $("itemPerson").value = item.person_id;
  $("itemCategory").value = item.category || "pass";
  $("itemName").value = item.item_name || "";
  $("itemExpiryDate").value = item.expiry_date || "";
  $("itemNotes").value = item.notes || "";
  $("itemFile").value = "";

  if (item.file_path) {
    $("currentFileBox").classList.remove("hidden");
    $("currentFileBox").innerHTML = `
      <b>Current copy:</b> ${escapeHtml(item.file_name || item.file_path)}
      <br><button class="small-btn" type="button" onclick="downloadCopy('${item.id}')">Download Current Copy</button>
      <button class="danger-outline" type="button" onclick="deleteCurrentFile('${item.id}')">Delete Copy</button>
    `;
  } else {
    $("currentFileBox").classList.add("hidden");
    $("currentFileBox").innerHTML = "";
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteItem() {
  if (currentMode !== "editor") return;

  const id = $("itemId").value;
  if (!id) {
    showToast("Choose item first.");
    return;
  }

  if (!confirm("Delete/archive this pass/license item?")) return;

  const res = await supabaseClient
    .from("expiry_items")
    .update({ is_archived: true })
    .eq("id", id);

  if (res.error) {
    showToast("Delete item error: " + res.error.message);
    return;
  }

  resetItemForm();
  await loadAll();
  showToast("Item deleted.");
}

async function deleteCurrentFile(itemId) {
  if (currentMode !== "editor") return;

  const item = items.find((x) => x.id === itemId);
  if (!item || !item.file_path) return;

  if (!confirm("Delete uploaded copy?")) return;

  const cfg = window.KG_CONFIG;

  const del = await supabaseClient.storage
    .from(cfg.STORAGE_BUCKET)
    .remove([item.file_path]);

  if (del.error) {
    showToast("Delete file error: " + del.error.message);
    return;
  }

  const upd = await supabaseClient
    .from("expiry_items")
    .update({
      file_path: null,
      file_name: null,
      file_mime_type: null,
      file_size_bytes: null
    })
    .eq("id", itemId);

  if (upd.error) {
    showToast("Clear file info error: " + upd.error.message);
    return;
  }

  resetItemForm();
  await loadAll();
  showToast("Copy deleted.");
}

async function downloadCopy(itemId) {
  const item = items.find((x) => x.id === itemId);
  if (!item || !item.file_path) {
    showToast("No file.");
    return;
  }

  const cfg = window.KG_CONFIG;

  const res = await supabaseClient.storage
    .from(cfg.STORAGE_BUCKET)
    .createSignedUrl(item.file_path, 60);

  if (res.error) {
    showToast("Download error: " + res.error.message);
    return;
  }

  window.open(res.data.signedUrl, "_blank", "noopener,noreferrer");
}


async function getSignedUrl(item) {
  const cfg = window.KG_CONFIG;
  const res = await supabaseClient.storage.from(cfg.STORAGE_BUCKET).createSignedUrl(item.file_path, 120);
  if (res.error) throw new Error(res.error.message);
  return res.data.signedUrl;
}

function getFileExtension(fileName, mime) {
  const name = String(fileName || "");
  const match = name.match(/(\.[a-zA-Z0-9]{1,8})$/);
  if (match) return match[1].toLowerCase();
  if (mime === "application/pdf") return ".pdf";
  if (mime === "image/png") return ".png";
  if (mime === "image/jpeg") return ".jpg";
  return ".file";
}

function csvCell(value) {
  const s = String(value ?? "");
  if (/[",\n]/.test(s)) return `"${s.replaceAll('"', '""')}"`;
  return s;
}

function makeCsv(rows) {
  const headers = ["folder", "file", "person", "nickname", "role", "category", "item_name", "expiry_date", "status", "days", "original_file", "error"];
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map((h) => csvCell(row[h] || "")).join(","));
  return lines.join("\n");
}

async function downloadFilteredCopies() {
  const rows = filteredRows().filter((row) => row.item.file_path);

  if (rows.length === 0) {
    showToast("No uploaded copies in current filter.");
    return;
  }

  if (!window.JSZip) {
    showToast("ZIP library not loaded. Check internet connection.");
    return;
  }

  if (!confirm(`Download ${rows.length} uploaded copy/copies grouped by pass/license folder?`)) return;

  showToast("Preparing ZIP... please wait.");

  const zip = new JSZip();
  const usedNames = new Set();
  const manifest = [];

  for (const row of rows) {
    const item = row.item;
    const person = row.person;

    try {
      const url = await getSignedUrl(item);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();

      const folderName = cleanFolderName(item.item_name);
      const ext = getFileExtension(item.file_name, item.file_mime_type);
      const expiry = item.expiry_date ? item.expiry_date : "no-date";
      const personName = cleanFileName(`${person.name}${person.nickname ? "_" + person.nickname : ""}`);
      let fileName = `${personName}_${cleanFileName(item.item_name)}_${expiry}${ext}`;

      let path = `${folderName}/${fileName}`;
      let counter = 2;
      while (usedNames.has(path.toLowerCase())) {
        fileName = `${personName}_${cleanFileName(item.item_name)}_${expiry}_${counter}${ext}`;
        path = `${folderName}/${fileName}`;
        counter++;
      }
      usedNames.add(path.toLowerCase());

      zip.file(path, blob);
      manifest.push({ folder: folderName, file: fileName, person: person.name, nickname: person.nickname || "", role: person.role, category: item.category, item_name: item.item_name, expiry_date: item.expiry_date || "", status: row.status.label, days: row.status.daysText, original_file: item.file_name || "", error: "" });
    } catch (err) {
      manifest.push({ folder: cleanFolderName(item.item_name), file: "DOWNLOAD_FAILED", person: person.name, nickname: person.nickname || "", role: person.role, category: item.category, item_name: item.item_name, expiry_date: item.expiry_date || "", status: "FAILED", days: "", original_file: item.file_name || "", error: err.message });
    }
  }

  zip.file("README_FILE_LIST.csv", makeCsv(manifest));

  const content = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  const today = new Date().toISOString().slice(0, 10);
  a.href = URL.createObjectURL(content);
  a.download = `KG_pass_license_filtered_${today}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);

  showToast("ZIP downloaded.");
}

function selectAllItemNames() {
  document.querySelectorAll(".item-name-filter").forEach((x) => { x.checked = true; });
  selectedItemNames = new Set();
  renderAll();
}

function clearItemNames() {
  document.querySelectorAll(".item-name-filter").forEach((x) => { x.checked = false; });
  selectedItemNames = new Set(["__NONE_SELECTED__"]);
  renderAll();
}

function clearAllFilters() {
  $("searchInput").value = "";
  if ($("filterPass")) $("filterPass").checked = true;
  if ($("filterLicense")) $("filterLicense").checked = true;
  document.querySelectorAll(".status-filter").forEach((x) => { x.checked = true; });
  document.querySelectorAll(".item-name-filter").forEach((x) => { x.checked = true; });
  selectedItemNames = new Set();
  renderAll();
}

window.downloadCopy = downloadCopy;
window.deleteCurrentFile = deleteCurrentFile;

function handleCardClick(e) {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;

  const action = btn.dataset.action;
  const id = btn.dataset.id;

  if (action === "download") downloadCopy(id);
  if (action === "edit-person") editPerson(id);
  if (action === "edit-item") editItem(id);
}

document.addEventListener("DOMContentLoaded", () => {
  $("loginBtn").addEventListener("click", login);
  $("pinInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") login();
  });

  $("logoutBtn").addEventListener("click", logout);
  $("refreshBtn").addEventListener("click", loadAll);

  $("searchInput").addEventListener("input", renderAll);
  $("clearSearchBtn").addEventListener("click", () => {
    $("searchInput").value = "";
    renderAll();
  });

  $("downloadFilteredBtn").addEventListener("click", downloadFilteredCopies);
  $("clearAllFiltersBtn").addEventListener("click", clearAllFilters);
  $("selectAllItemNamesBtn").addEventListener("click", selectAllItemNames);
  $("clearItemNamesBtn").addEventListener("click", clearItemNames);
  $("graphMode").addEventListener("change", renderGraph);
  $("filterPass").addEventListener("change", renderAll);
  $("filterLicense").addEventListener("change", renderAll);
  document.addEventListener("change", (e) => {
    if (e.target.classList.contains("status-filter")) renderAll();
    if (e.target.classList.contains("item-name-filter")) {
      updateSelectedItemNamesFromUI();
      renderAll();
    }
  });

  $("savePersonBtn").addEventListener("click", savePerson);
  $("resetPersonBtn").addEventListener("click", resetPersonForm);
  $("deletePersonBtn").addEventListener("click", deletePerson);

  $("saveItemBtn").addEventListener("click", saveItem);
  $("resetItemBtn").addEventListener("click", resetItemForm);
  $("deleteItemBtn").addEventListener("click", deleteItem);

  $("cardList").addEventListener("click", handleCardClick);
});
