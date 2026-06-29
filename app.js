/* KG License / Site Pass Tracker V5.1 */
(() => {
  const $ = (id) => document.getElementById(id);
  const cfg = window.KG_CONFIG || {};

  let supabaseClient = null;
  let mode = "viewer";
  let state = {
    people: [],
    items: [],
    types: [],
    visibleBulkPeople: [],
    visibleMassItems: [],
    visibleDownloadTypes: [],
    visibleDownloadPeople: []
  };

  const bulkSelected = new Map(); // personId -> { person_id, expiry_date, no_expiry, notes }
  const massSelected = new Set(); // item ids
  const downloadSelectedTypes = new Set(); // name key only
  const downloadSelectedPeople = new Set(); // person ids
  const DEFAULT_ITEM_CATEGORY = "license"; // keep database safe, but UI no longer separates license/site pass
  const PEOPLE_DETAIL_FIELDS = [
    ["company_name", "personCompanyName"],
    ["uen", "personUen"],
    ["date_of_birth", "personDateOfBirth"],
    ["wp_ic_number", "personWpIcNumber"],
    ["wp_ic_last4", "personWpIcLast4"],
    ["wp_ic_expiry_date", "personWpIcExpiryDate"],
    ["fin_number", "personFinNumber"],
    ["fin_last4", "personFinLast4"],
    ["permit_type", "personPermitType"],
    ["occupation", "personOccupation"],
    ["sex", "personSex"],
    ["nationality", "personNationality"],
    ["address", "personAddress"],
    ["postal_code", "personPostalCode"],
    ["contact_no", "personContactNo"]
  ];

  function cleanSupabaseUrl(url) {
    return String(url || "")
      .trim()
      .replace(/\/+$/g, "")
      .replace(/\/rest\/v1$/i, "")
      .replace(/\/auth\/v1$/i, "")
      .replace(/\/storage\/v1$/i, "");
  }

  function initClient() {
    const url = cleanSupabaseUrl(cfg.SUPABASE_URL);
    const key = String(cfg.SUPABASE_ANON_KEY || "").trim();
    if (!url || !key || !window.supabase) {
      throw new Error("Supabase config missing. Check config.js.");
    }
    supabaseClient = window.supabase.createClient(url, key);
  }

  function toast(message, isError = false) {
    const el = $("toast");
    el.textContent = message;
    el.style.background = isError ? "#991b1b" : "#111827";
    el.classList.remove("hidden");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => el.classList.add("hidden"), 3600);
  }

  function setBusy(button, busyText = "Saving...") {
    if (!button) return () => {};
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = busyText;
    return () => {
      button.disabled = false;
      button.textContent = oldText;
    };
  }

  function isEditor() {
    return mode === "editor";
  }

  function showEditorOnly() {
    document.querySelectorAll(".editor-only").forEach((el) => {
      el.style.display = isEditor() ? "" : "none";
    });
  }

  function normalizeText(value) {
    return String(value || "").trim().toLowerCase();
  }

  function safeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function safeFileName(value) {
    return String(value || "file")
      .replace(/[^a-z0-9._ -]+/gi, "_")
      .replace(/\s+/g, "_")
      .slice(0, 120);
  }

  function last4(value) {
    const raw = String(value || "").replace(/\s+/g, "");
    return raw.length >= 4 ? raw.slice(-4) : "";
  }

  function inputValue(id) {
    const el = $(id);
    return el ? el.value.trim() : "";
  }

  function setInputValue(id, value) {
    const el = $(id);
    if (el) el.value = value || "";
  }

  function personDetailLines(person) {
    const pairs = [
      ["Company", person?.company_name],
      ["UEN", person?.uen],
      ["DOB", person?.date_of_birth],
      ["WP/IC", person?.wp_ic_number],
      ["WP/IC Exp", person?.wp_ic_expiry_date],
      ["FIN", person?.fin_number],
      ["Permit", person?.permit_type],
      ["Occupation", person?.occupation],
      ["Sex", person?.sex],
      ["Nationality", person?.nationality],
      ["Address", person?.address],
      ["Postal", person?.postal_code]
    ];
    return pairs
      .filter(([, value]) => String(value || "").trim())
      .slice(0, 8)
      .map(([label, value]) => `<div class="person-sub"><b>${safeHtml(label)}:</b> ${safeHtml(value)}</div>`)
      .join("");
  }

  function getManualNumber(person) {
    const manual = String((person && person.manual_no) || "").trim();
    if (manual) return manual;
    const name = String((person && person.name) || "").trim();
    // Support front manual numbers like 1, 10, A1, A-10, A 10.
    const match = name.match(/^([A-Za-z]+\s*-?\s*\d+[A-Za-z0-9-]*|\d+[A-Za-z]*)\b/);
    return match ? match[1].replace(/\s+/g, "") : "";
  }

  function manualSortString(person) {
    return String(getManualNumber(person) || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
  }

  function compareManualNumber(a, b) {
    const av = manualSortString(a);
    const bv = manualSortString(b);
    if (!av && !bv) return 0;
    if (!av) return 1;
    if (!bv) return -1;
    // Full natural manual sort: 1, 2, 10 and A1, A2, A10, B1.
    const c = av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
    if (c !== 0) return c;
    return av.length - bv.length;
  }

  function comparePeople(a, b) {
    const mc = compareManualNumber(a, b);
    if (mc !== 0) return mc;
    return String(a?.name || "").localeCompare(String(b?.name || ""), undefined, {
      numeric: true,
      sensitivity: "base"
    });
  }

  function compareItems(a, b) {
    const ap = getPerson(a.person_id);
    const bp = getPerson(b.person_id);
    const pc = comparePeople(ap || {}, bp || {});
    if (pc !== 0) return pc;
    return String(a.item_name || "").localeCompare(String(b.item_name || ""), undefined, {
      numeric: true,
      sensitivity: "base"
    });
  }

  function personDisplay(person) {
    if (!person) return "Unknown person";
    const no = getManualNumber(person);
    const left = no ? `${no}. ` : "";
    const nick = person.nickname ? ` / ${person.nickname}` : "";
    return `${left}${person.name || ""}${nick}`.trim();
  }

  function personSearchText(person) {
    return normalizeText([
      getManualNumber(person),
      person?.manual_no,
      person?.name,
      person?.nickname,
      person?.role,
      person?.status,
      person?.company_name,
      person?.uen,
      person?.date_of_birth,
      person?.wp_ic_number,
      person?.wp_ic_last4,
      person?.wp_ic_expiry_date,
      person?.fin_number,
      person?.fin_last4,
      person?.permit_type,
      person?.occupation,
      person?.sex,
      person?.nationality,
      person?.address,
      person?.postal_code,
      person?.contact_no
    ].join(" "));
  }

  function itemSearchText(item) {
    const p = getPerson(item.person_id);
    return normalizeText([
      personSearchText(p),
      item.category,
      item.item_name,
      item.cert_number,
      item.expiry_date,
      item.notes,
      item.file_name
    ].join(" "));
  }

  function getPerson(id) {
    return state.people.find((p) => String(p.id) === String(id));
  }

  function getItem(id) {
    return state.items.find((it) => String(it.id) === String(id));
  }

  function todayISO() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function daysUntil(dateString) {
    if (!dateString) return null;
    const today = new Date(`${todayISO()}T00:00:00`);
    const target = new Date(`${dateString}T00:00:00`);
    return Math.round((target - today) / 86400000);
  }

  function expiryInfo(item) {
    // V4.9 one simple rule for all license/site pass items:
    // Black = expired, Red = 0-14 days, Yellow = 15-30 days, Green = more than 30 days.
    if (!item.expiry_date) return { key: "nodate", label: "No Date", days: null, rank: 999999999 };
    const days = daysUntil(item.expiry_date);
    if (days < 0) return { key: "expired", label: `Black Expired ${Math.abs(days)}d`, days, rank: -1 };
    if (days <= 14) return { key: "red", label: days === 0 ? "Red Today" : `Red ${days}d`, days, rank: days };
    if (days <= 30) return { key: "yellow", label: `Yellow ${days}d`, days, rank: days };
    return { key: "normal", label: `Green ${days}d`, days, rank: days };
  }

  function expiryGroupSortValue(dateString) {
    if (!dateString) return Number.POSITIVE_INFINITY;
    const days = daysUntil(dateString);
    if (days === null || Number.isNaN(days)) return Number.POSITIVE_INFINITY;
    return days;
  }

  function compareExpiryDateGroups(a, b) {
    const ad = expiryGroupSortValue(a.expiry_date);
    const bd = expiryGroupSortValue(b.expiry_date);
    if (ad !== bd) return ad - bd;
    return String(a.expiry_date || "").localeCompare(String(b.expiry_date || ""));
  }

  function categoryLabel(_category) {
    return "License / Site Pass";
  }

  function statusPill(status) {
    const s = String(status || "active").toLowerCase();
    return `<span class="status-pill status-${safeHtml(s)}">${s === "pause" ? "Pause" : "Active"}</span>`;
  }

  function categoryPill(_category) {
    return `<span class="status-pill category-license">License / Site Pass</span>`;
  }

  function expiryPill(item) {
    const info = expiryInfo(item);
    return `<span class="status-pill ${safeHtml(info.key)}">${safeHtml(info.label)}</span>`;
  }

  function itemMatchesExpiryFilter(item, filter) {
    if (!filter || filter === "all") return true;
    const key = expiryInfo(item).key;
    if (filter === "red") return key === "red" || key === "expired";
    return key === filter;
  }

  function activeTypes(_category = "all") {
    // V4.9: show all old License and Site Pass setup names together.
    // Database category is kept for safety, but the screen no longer separates them.
    const seen = new Map();
    state.types
      .filter((t) => !t.is_archived)
      .forEach((t) => {
        const name = String(t.name || "").trim();
        const key = normalizeText(name);
        if (!key) return;
        if (!seen.has(key)) seen.set(key, { ...t, name, category: t.category || DEFAULT_ITEM_CATEGORY });
      });
    return [...seen.values()].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base", numeric: true }));
  }

  function allTypeNames(_category = "all") {
    const names = new Set();
    activeTypes("all").forEach((t) => names.add(String(t.name || "").trim()));
    state.items.forEach((it) => {
      if (it.item_name) names.add(String(it.item_name).trim());
    });
    return [...names].filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
  }

  function makeTypeKey(_category, name) {
    return normalizeText(name);
  }

  function allTypeRows() {
    const rows = new Map();
    activeTypes("all").forEach((t) => {
      const key = makeTypeKey(t.category, t.name);
      if (!rows.has(key)) rows.set(key, { id: t.id, category: t.category || DEFAULT_ITEM_CATEGORY, name: t.name, record_count: 0, file_count: 0, people_ids: new Set() });
    });
    state.items.forEach((it) => {
      if (!it.item_name) return;
      const key = makeTypeKey(it.category, it.item_name);
      if (!rows.has(key)) rows.set(key, { id: null, category: it.category || DEFAULT_ITEM_CATEGORY, name: it.item_name, record_count: 0, file_count: 0, people_ids: new Set() });
      const row = rows.get(key);
      row.record_count += 1;
      if (it.file_path) row.file_count += 1;
      row.people_ids.add(String(it.person_id));
    });
    return [...rows.values()].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base", numeric: true }));
  }

  function manualFilePrefix(person) {
    const raw = getManualNumber(person);
    return safeFileName(raw || "NO_NO");
  }

  function findPersonFromInput(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;
    return state.people.find((p) => personOptionValue(p) === raw) || null;
  }

  function personOptionValue(person) {
    const shortId = String(person.id || "").slice(0, 6);
    return `${personDisplay(person)} [${shortId}]`;
  }

  async function login() {
    const pin = $("pinInput").value.trim();
    const loginMsg = $("loginMsg");
    loginMsg.textContent = "";

    let email, password;
    if (pin === String(cfg.EDIT_PIN || "")) {
      mode = "editor";
      email = cfg.EDIT_EMAIL;
      password = cfg.EDIT_PASSWORD;
    } else if (pin === String(cfg.VIEW_PIN || "")) {
      mode = "viewer";
      email = cfg.VIEW_EMAIL;
      password = cfg.VIEW_PASSWORD;
    } else {
      loginMsg.textContent = "Wrong PIN.";
      return;
    }

    const done = setBusy($("loginBtn"), "Logging in...");
    try {
      initClient();
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
      $("loginScreen").classList.add("hidden");
      $("appScreen").classList.remove("hidden");
      $("loginModeText").textContent = isEditor()
        ? "Edit Mode: can add, edit, delete and upload."
        : "View Mode: can view, search and download only.";
      showEditorOnly();
      await loadAll();
      toast("Login successful.");
    } catch (err) {
      loginMsg.textContent = err.message || "Cannot login.";
    } finally {
      done();
    }
  }

  async function logout() {
    try { await supabaseClient?.auth.signOut(); } catch (_) {}
    mode = "viewer";
    $("pinInput").value = "";
    $("appScreen").classList.add("hidden");
    $("loginScreen").classList.remove("hidden");
  }

  async function loadAll() {
    if (!supabaseClient) initClient();
    const [peopleRes, itemsRes, typesRes] = await Promise.all([
      supabaseClient.from("people").select("*").or("is_archived.is.null,is_archived.eq.false"),
      supabaseClient.from("expiry_items").select("*").or("is_archived.is.null,is_archived.eq.false"),
      supabaseClient.from("pass_license_types").select("*").or("is_archived.is.null,is_archived.eq.false")
    ]);

    if (peopleRes.error) throw peopleRes.error;
    if (itemsRes.error) throw itemsRes.error;
    if (typesRes.error) throw typesRes.error;

    state.people = (peopleRes.data || []).sort(comparePeople);
    state.items = (itemsRes.data || []).sort(compareItems);
    state.types = (typesRes.data || []).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base", numeric: true }));

    removeMissingSelections();
    renderAll();
  }

  function removeMissingSelections() {
    for (const id of [...bulkSelected.keys()]) {
      if (!getPerson(id)) bulkSelected.delete(id);
    }
    for (const id of [...massSelected]) {
      if (!getItem(id)) massSelected.delete(id);
    }
    for (const id of [...downloadSelectedPeople]) {
      if (!getPerson(id)) downloadSelectedPeople.delete(id);
    }
    const validTypeKeys = new Set(allTypeRows().map((t) => makeTypeKey(t.category, t.name)));
    for (const key of [...downloadSelectedTypes]) {
      if (!validTypeKeys.has(key)) downloadSelectedTypes.delete(key);
    }
  }

  function renderAll() {
    renderDatalists();
    renderDashboard();
    renderDownloadTypes();
    renderDownloadPeople();
    renderDownloadSummary();
    renderBulkPeople();
    renderBulkSelected();
    renderMassItems();
    renderMassSelected();
    renderTypes();
    renderPeople();
  }

  function renderDatalists() {
    $("allTypeNames").innerHTML = allTypeNames("all").map((n) => `<option value="${safeHtml(n)}"></option>`).join("");
    $("peopleOptions").innerHTML = state.people.map((p) => `<option value="${safeHtml(personOptionValue(p))}"></option>`).join("");
  }

  function dashboardFilteredItems() {
    const q = normalizeText($("dashSearch").value);
    const peopleStatus = $("dashPeopleStatus").value;
    const itemName = normalizeText($("dashItemName").value);
    const expiryStatus = $("dashExpiryStatus").value;

    return state.items.filter((it) => {
      const p = getPerson(it.person_id);
      if (!p) return false;
      const pStatus = String(p.status || "active").toLowerCase();
      if (peopleStatus !== "all" && pStatus !== peopleStatus) return false;
      if (itemName && !normalizeText(it.item_name).includes(itemName)) return false;
      if (q && !itemSearchText(it).includes(q)) return false;
      if (!itemMatchesExpiryFilter(it, expiryStatus)) return false;
      return true;
    }).sort(compareItems);
  }

  function renderExpiryDateSummary(rows) {
    const el = $("dashboardExpirySummary");
    if (!el) return;
    if (!rows.length) {
      el.innerHTML = `<div class="muted">No expiry summary. Filter has no records.</div>`;
      return;
    }

    const groups = new Map();
    rows.forEach((it) => {
      const key = it.expiry_date || "NO_DATE";
      if (!groups.has(key)) {
        groups.set(key, { expiry_date: it.expiry_date || "", items: [] });
      }
      groups.get(key).items.push(it);
    });

    const sortedGroups = [...groups.values()].sort(compareExpiryDateGroups);
    el.innerHTML = `
      <div class="summary-title">Expiry Date Summary</div>
      <div class="summary-help">Uses current filter. People inside each date are sorted by manual number.</div>
      <div class="expiry-summary-list">
        ${sortedGroups.map((group) => {
          const first = group.items[0];
          const info = expiryInfo(first);
          const sortedItems = [...group.items].sort(compareItems);
          const preview = sortedItems.slice(0, 8).map((it) => {
            const p = getPerson(it.person_id);
            return `${safeHtml(getManualNumber(p) || "-")}. ${safeHtml(p?.nickname || p?.name || "Unknown")} - ${safeHtml(it.item_name || "")}`;
          }).join("<br>");
          const more = sortedItems.length > 8 ? `<br><b>+${sortedItems.length - 8} more</b>` : "";
          const dateLabel = group.expiry_date || "No Date";
          return `
            <div class="expiry-summary-card ${safeHtml(info.key)}">
              <div class="expiry-summary-head">
                <b>${safeHtml(dateLabel)}</b>
                <span class="status-pill ${safeHtml(info.key)}">${safeHtml(info.label)}</span>
                <span class="pill">${sortedItems.length}</span>
              </div>
              <div class="expiry-summary-preview">${preview}${more}</div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderDashboard() {
    const rows = dashboardFilteredItems();
    const counts = { total: rows.length, expired: 0, red: 0, yellow: 0, normal: 0, nodate: 0 };
    rows.forEach((it) => {
      const key = expiryInfo(it).key;
      counts[key] = (counts[key] || 0) + 1;
    });
    $("dashboardSummary").innerHTML = `
      <span class="pill">Total: ${counts.total}</span>
      <span class="pill expired">Black Expired: ${counts.expired}</span>
      <span class="pill red">Red 1-14 days: ${counts.red}</span>
      <span class="pill yellow">Yellow 15-30 days: ${counts.yellow}</span>
      <span class="pill normal">Green &gt;30 days: ${counts.normal}</span>
      <span class="pill nodate">No Date: ${counts.nodate}</span>
    `;
    renderExpiryDateSummary(rows);

    $("dashboardBody").innerHTML = rows.map((it) => {
      const p = getPerson(it.person_id);
      const fileCell = it.file_path
        ? `<button data-action="download-file" data-id="${safeHtml(it.id)}">Download</button><div class="person-sub">${safeHtml(it.file_name || "file")}</div>`
        : `<span class="muted">No file</span>`;
      return `
        <tr>
          <td><b>${safeHtml(getManualNumber(p))}</b></td>
          <td><div class="person-name">${safeHtml(p?.name || "Unknown")}</div><div class="person-sub">${safeHtml(p?.nickname || "")}</div></td>
          <td>${statusPill(p?.status)}</td>
          <td><b>${safeHtml(it.item_name || "")}</b><div class="person-sub">${safeHtml(it.notes || "")}</div></td>
          <td>${safeHtml(it.cert_number || "-")}</td>
          <td>${safeHtml(it.expiry_date || "-")}<br>${expiryPill(it)}</td>
          <td>${fileCell}</td>
          <td class="editor-only"><div class="actions">
            <button data-action="edit-item" data-id="${safeHtml(it.id)}">Edit</button>
            <button class="danger ghost" data-action="delete-item" data-id="${safeHtml(it.id)}">Delete</button>
          </div></td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="8" class="muted">No records found.</td></tr>`;
    showEditorOnly();
  }

  function filterPeople(searchId, statusId, roleId = null) {
    const q = normalizeText($(searchId).value);
    const status = $(statusId).value;
    const role = roleId ? $(roleId).value : "all";

    return state.people.filter((p) => {
      const pStatus = String(p.status || "active").toLowerCase();
      const pRole = String(p.role || "worker").toLowerCase();
      if (status !== "all" && pStatus !== status) return false;
      if (role !== "all" && pRole !== role) return false;
      if (q && !personSearchText(p).includes(q)) return false;
      return true;
    }).sort(comparePeople);
  }

  function renderBulkPeople() {
    const filtered = filterPeople("bulkPeopleSearch", "bulkPeopleStatus", "bulkRoleFilter");
    const pinned = [...bulkSelected.keys()].map(getPerson).filter(Boolean).sort(comparePeople);
    const all = [...pinned, ...filtered.filter((p) => !bulkSelected.has(String(p.id)))];
    state.visibleBulkPeople = all;

    $("bulkPeopleBody").innerHTML = all.map((p) => {
      const checked = bulkSelected.has(String(p.id));
      return `
        <tr class="${checked ? "selected-row" : ""}">
          <td><input type="checkbox" data-action="bulk-toggle-person" data-id="${safeHtml(p.id)}" ${checked ? "checked" : ""}></td>
          <td><b>${safeHtml(getManualNumber(p))}</b></td>
          <td><div class="person-name">${safeHtml(p.name || "")}</div></td>
          <td>${safeHtml(p.nickname || "")}</td>
          <td>${statusPill(p.status)}</td>
          <td>${safeHtml(p.role || "")}</td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="6" class="muted">No people found.</td></tr>`;
  }

  function renderBulkSelected() {
    const box = $("bulkSelectedBox");
    const ids = [...bulkSelected.keys()].sort((a, b) => comparePeople(getPerson(a) || {}, getPerson(b) || {}));
    $("bulkSelectedCount").textContent = String(ids.length);
    if (!ids.length) {
      box.className = "selected-box empty";
      box.textContent = "No people ticked yet.";
      return;
    }
    box.className = "selected-box";
    box.innerHTML = ids.map((id) => {
      const p = getPerson(id);
      const row = bulkSelected.get(id) || {};
      return `
        <div class="selected-card">
          <div>
            <div class="name-line">${safeHtml(personDisplay(p))}</div>
            <div class="sub-line">${safeHtml(p?.role || "")} · ${safeHtml(p?.status || "active")}</div>
          </div>
          <input type="date" value="${safeHtml(row.expiry_date || "")}" data-action="bulk-expiry" data-id="${safeHtml(id)}" ${row.no_expiry ? "disabled" : ""}>
          <input value="${safeHtml(row.cert_number || "")}" placeholder="Cert No." data-action="bulk-cert" data-id="${safeHtml(id)}">
          <label class="check-line"><input type="checkbox" data-action="bulk-no-expiry" data-id="${safeHtml(id)}" ${row.no_expiry ? "checked" : ""}> No date</label>
          <button class="danger ghost" data-action="bulk-remove-person" data-id="${safeHtml(id)}">X</button>
        </div>
      `;
    }).join("");
  }

  function massFilteredItems() {
    const q = normalizeText($("massSearch").value);
    const peopleStatus = $("massPeopleStatus").value;
    const itemName = normalizeText($("massItemName").value);

    return state.items.filter((it) => {
      const p = getPerson(it.person_id);
      if (!p) return false;
      const pStatus = String(p.status || "active").toLowerCase();
      if (peopleStatus !== "all" && pStatus !== peopleStatus) return false;
      if (itemName && !normalizeText(it.item_name).includes(itemName)) return false;
      if (q && !itemSearchText(it).includes(q)) return false;
      return true;
    }).sort(compareItems);
  }

  function renderMassItems() {
    const filtered = massFilteredItems();
    const pinned = [...massSelected].map(getItem).filter(Boolean).sort(compareItems);
    const all = [...pinned, ...filtered.filter((it) => !massSelected.has(String(it.id)))];
    state.visibleMassItems = all;

    $("massItemsBody").innerHTML = all.map((it) => {
      const p = getPerson(it.person_id);
      const checked = massSelected.has(String(it.id));
      return `
        <tr class="${checked ? "selected-row" : ""}">
          <td><input type="checkbox" data-action="mass-toggle-item" data-id="${safeHtml(it.id)}" ${checked ? "checked" : ""}></td>
          <td><b>${safeHtml(getManualNumber(p))}</b></td>
          <td><div class="person-name">${safeHtml(p?.name || "Unknown")}</div><div class="person-sub">${safeHtml(p?.nickname || "")}</div></td>
          <td>${statusPill(p?.status)}</td>
          <td><b>${safeHtml(it.item_name || "")}</b></td>
          <td>${safeHtml(it.cert_number || "-")}</td>
          <td>${safeHtml(it.expiry_date || "-")}<br>${expiryPill(it)}</td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="7" class="muted">No records found.</td></tr>`;
  }

  function renderMassSelected() {
    const box = $("massSelectedBox");
    const ids = [...massSelected].sort((a, b) => compareItems(getItem(a) || {}, getItem(b) || {}));
    $("massSelectedCount").textContent = String(ids.length);
    if (!ids.length) {
      box.className = "selected-box empty";
      box.textContent = "No records ticked yet.";
      return;
    }
    box.className = "selected-box";
    box.innerHTML = ids.map((id) => {
      const it = getItem(id);
      const p = getPerson(it?.person_id);
      return `
        <div class="selected-card mass">
          <div>
            <div class="name-line">${safeHtml(personDisplay(p))}</div>
            <div class="sub-line">${safeHtml(it?.item_name || "")} · Cert: ${safeHtml(it?.cert_number || "-")} · ${safeHtml(it?.expiry_date || "No date")}</div>
          </div>
          <button class="danger ghost" data-action="mass-remove-item" data-id="${safeHtml(id)}">X</button>
        </div>
      `;
    }).join("");
  }

  function downloadTypeFilteredRows() {
    const q = normalizeText($("downloadTypeSearch").value);
    const rows = allTypeRows().filter((t) => {
      if (q && !normalizeText(t.name).includes(q)) return false;
      return true;
    });
    const pinned = allTypeRows().filter((t) => downloadSelectedTypes.has(makeTypeKey(t.category, t.name)));
    const pinnedKeys = new Set(pinned.map((t) => makeTypeKey(t.category, t.name)));
    return [...pinned, ...rows.filter((t) => !pinnedKeys.has(makeTypeKey(t.category, t.name)))];
  }

  function selectedDownloadTypeKeys() {
    return new Set([...downloadSelectedTypes]);
  }

  function personHasSelectedDownloadType(personId) {
    const selected = selectedDownloadTypeKeys();
    if (!selected.size) return true;
    return state.items.some((it) => String(it.person_id) === String(personId) && selected.has(makeTypeKey(it.category, it.item_name)));
  }

  function downloadMatchingItemsForPerson(personId) {
    const selected = selectedDownloadTypeKeys();
    return state.items.filter((it) => {
      if (String(it.person_id) !== String(personId)) return false;
      if (selected.size && !selected.has(makeTypeKey(it.category, it.item_name))) return false;
      return true;
    });
  }

  function downloadPeopleFilteredRows() {
    const q = normalizeText($("downloadPeopleSearch").value);
    const status = $("downloadPeopleStatus").value;
    const role = $("downloadPeopleRole").value;
    const onlyWithFile = $("downloadOnlyWithFile").checked;

    const filtered = state.people.filter((p) => {
      const pStatus = String(p.status || "active").toLowerCase();
      const pRole = String(p.role || "worker").toLowerCase();
      if (status !== "all" && pStatus !== status) return false;
      if (role !== "all" && pRole !== role) return false;
      if (q && !personSearchText(p).includes(q)) return false;
      if (!personHasSelectedDownloadType(p.id)) return false;
      if (onlyWithFile && !downloadMatchingItemsForPerson(p.id).some((it) => it.file_path)) return false;
      return true;
    }).sort(comparePeople);

    const pinned = [...downloadSelectedPeople].map(getPerson).filter(Boolean).sort(comparePeople);
    const pinnedIds = new Set(pinned.map((p) => String(p.id)));
    return [...pinned, ...filtered.filter((p) => !pinnedIds.has(String(p.id)))];
  }

  function downloadZipRows() {
    const selectedTypes = selectedDownloadTypeKeys();
    const selectedPeople = new Set([...downloadSelectedPeople]);
    if (!selectedTypes.size || !selectedPeople.size) return [];
    return state.items.filter((it) => {
      if (!it.file_path) return false;
      if (!selectedTypes.has(makeTypeKey(it.category, it.item_name))) return false;
      if (!selectedPeople.has(String(it.person_id))) return false;
      return true;
    }).sort(compareItems);
  }

  function renderDownloadTypes() {
    const body = $("downloadTypesBody");
    if (!body) return;
    const rows = downloadTypeFilteredRows();
    state.visibleDownloadTypes = rows;
    $("downloadSelectedTypeCount").textContent = String(downloadSelectedTypes.size);
    body.innerHTML = rows.map((t) => {
      const key = makeTypeKey(t.category, t.name);
      const checked = downloadSelectedTypes.has(key);
      return `
        <tr class="${checked ? "selected-row" : ""}">
          <td><input type="checkbox" data-action="download-toggle-type" data-key="${safeHtml(key)}" ${checked ? "checked" : ""}></td>
          <td><b>${safeHtml(t.name || "")}</b></td>
          <td><span class="pill">${t.record_count}</span></td>
          <td><span class="pill normal">${t.file_count}</span></td>
          <td><span class="pill">${t.people_ids.size}</span></td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="5" class="muted">No license/site pass type found.</td></tr>`;
  }

  function renderDownloadPeople() {
    const body = $("downloadPeopleBody");
    if (!body) return;
    const rows = downloadPeopleFilteredRows();
    state.visibleDownloadPeople = rows;
    $("downloadSelectedPeopleCount").textContent = String(downloadSelectedPeople.size);
    body.innerHTML = rows.map((p) => {
      const checked = downloadSelectedPeople.has(String(p.id));
      const matching = downloadMatchingItemsForPerson(p.id);
      const fileCount = matching.filter((it) => it.file_path).length;
      return `
        <tr class="${checked ? "selected-row" : ""}">
          <td><input type="checkbox" data-action="download-toggle-person" data-id="${safeHtml(p.id)}" ${checked ? "checked" : ""}></td>
          <td><b>${safeHtml(getManualNumber(p))}</b></td>
          <td><div class="person-name">${safeHtml(p.name || "")}</div><div class="person-sub">${safeHtml(p.nickname || "")}</div></td>
          <td>${statusPill(p.status)}</td>
          <td>${safeHtml(p.role || "")}</td>
          <td><span class="pill">${matching.length}</span></td>
          <td><span class="pill normal">${fileCount}</span></td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="7" class="muted">No people found. Tick license/site pass type or change people filter.</td></tr>`;
  }

  function renderDownloadSummary() {
    const el = $("downloadSummary");
    if (!el) return;
    const rows = downloadZipRows();
    const folders = new Map();
    rows.forEach((it) => folders.set(it.item_name || "Unknown", (folders.get(it.item_name || "Unknown") || 0) + 1));
    const folderText = [...folders.entries()]
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { sensitivity: "base", numeric: true }))
      .map(([name, count]) => `<span class="pill">${safeHtml(name)}: ${count}</span>`)
      .join(" ") || `<span class="muted">No file ready yet.</span>`;
    el.innerHTML = `
      <span class="pill">Selected license/site pass: ${downloadSelectedTypes.size}</span>
      <span class="pill">Selected people: ${downloadSelectedPeople.size}</span>
      <span class="pill normal">Files ready: ${rows.length}</span>
      <div class="download-folder-preview">${folderText}</div>
    `;
  }

  function setDownloadType(key, checked) {
    if (checked) downloadSelectedTypes.add(key);
    else downloadSelectedTypes.delete(key);
    renderDownloadTypes();
    renderDownloadPeople();
    renderDownloadSummary();
  }

  function setDownloadPerson(id, checked) {
    id = String(id);
    if (checked) downloadSelectedPeople.add(id);
    else downloadSelectedPeople.delete(id);
    renderDownloadPeople();
    renderDownloadSummary();
  }

  function renderTypes() {
    const q = normalizeText($("typeSearch").value);
    const rows = activeTypes("all").filter((t) => {
      if (q && !normalizeText(t.name).includes(q)) return false;
      return true;
    });

    $("typesBody").innerHTML = rows.map((t) => {
      const count = state.items.filter((it) => normalizeText(it.item_name) === normalizeText(t.name)).length;
      return `
        <tr>
          <td><b>${safeHtml(t.name || "")}</b></td>
          <td><span class="pill">${count}</span></td>
          <td class="editor-only"><div class="actions">
            <button data-action="edit-type" data-id="${safeHtml(t.id)}">Edit</button>
            <button class="danger ghost" data-action="delete-type" data-id="${safeHtml(t.id)}">Delete</button>
          </div></td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="3" class="muted">No setup names found.</td></tr>`;
    showEditorOnly();
  }



  function excelCell(value) {
    const text = String(value ?? "");
    return `<td style="mso-number-format:'\@';">${safeHtml(text)}</td>`;
  }

  function nameListRows(allPeople = false) {
    const rows = allPeople ? [...state.people].sort(comparePeople) : filterPeople("peopleSearch", "peopleStatusFilter");
    return rows;
  }

  function nameListExportColumns(person) {
    return [
      person?.name || "",
      person?.uen || "",
      person?.company_name || "",
      person?.date_of_birth || "",
      person?.wp_ic_number || "",
      person?.wp_ic_last4 || last4(person?.wp_ic_number) || "",
      person?.wp_ic_expiry_date || "",
      person?.fin_number || "",
      person?.fin_last4 || last4(person?.fin_number) || "",
      person?.permit_type || "",
      person?.occupation || "",
      person?.sex || "",
      person?.nationality || "",
      person?.address || "",
      person?.postal_code || "",
      person?.contact_no || ""
    ];
  }

  function exportPeopleNameListExcel(allPeople = false) {
    const rows = nameListRows(allPeople);
    if (!rows.length) return toast("No people to export.", true);

    const headers = [
      "NAME",
      "UEN",
      "COMPANY",
      "DATE OF BIRTH",
      "W.P NO",
      "Last 4 Digital No(WP)",
      "DATE EXPIRY",
      "FIN NO.",
      "Last 4 Digital No （Fin No)",
      "Type of Permit",
      "Occupation",
      "SEX",
      "Nationality",
      "Address",
      "Postal Code",
      "Contact No."
    ];

    const tableRows = rows.map((p) => `<tr>${nameListExportColumns(p).map(excelCell).join("")}</tr>`).join("\n");
    const headerRow = headers.map((h) => `<th style="background:#dbeafe;font-weight:bold;border:1px solid #999;mso-number-format:'\@';">${safeHtml(h)}</th>`).join("");
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    table { border-collapse: collapse; font-family: Arial, sans-serif; font-size: 11pt; }
    th, td { border: 1px solid #999; padding: 6px; vertical-align: top; mso-number-format:'\@'; }
    th { font-weight: bold; }
    .text { mso-number-format:'\@'; }
  </style>
</head>
<body>
  <table>
    <thead><tr>${headerRow}</tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
</body>
</html>`;
    const blob = new Blob(["\ufeff" + html], { type: "application/vnd.ms-excel;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = allPeople ? `KG_name_list_all_${todayISO()}.xls` : `KG_name_list_filtered_${todayISO()}.xls`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast(`Excel name list exported (${rows.length} people).`);
  }

  function renderPeople() {
    const rows = filterPeople("peopleSearch", "peopleStatusFilter");
    $("peopleBody").innerHTML = rows.map((p) => `
      <tr>
        <td><b>${safeHtml(getManualNumber(p))}</b></td>
        <td><div class="person-name">${safeHtml(p.name || "")}</div></td>
        <td>${safeHtml(p.nickname || "")}</td>
        <td>${safeHtml(p.role || "")}</td>
        <td>${statusPill(p.status)}</td>
        <td>${personDetailLines(p) || `<span class="muted">-</span>`}</td>
        <td>
          <div>${safeHtml(p.contact_no || "-")}</div>
          <div class="person-sub">WP/IC Last 4: ${safeHtml(p.wp_ic_last4 || "-")}</div>
          <div class="person-sub">FIN Last 4: ${safeHtml(p.fin_last4 || "-")}</div>
        </td>
        <td class="editor-only"><div class="actions">
          <button data-action="edit-person" data-id="${safeHtml(p.id)}">Edit</button>
          <button class="danger ghost" data-action="delete-person" data-id="${safeHtml(p.id)}">Delete</button>
        </div></td>
      </tr>
    `).join("") || `<tr><td colspan="8" class="muted">No people found.</td></tr>`;
    showEditorOnly();
  }

  async function ensureType(_category, name) {
    const cleanName = String(name || "").trim();
    if (!cleanName) return;
    const exists = state.types.find((t) => normalizeText(t.name) === normalizeText(cleanName));
    if (exists) return;
    const { data, error } = await supabaseClient.from("pass_license_types").insert({ category: DEFAULT_ITEM_CATEGORY, name: cleanName }).select("*").single();
    if (error) throw error;
    state.types.push(data);
  }

  async function uploadFileForItem(item, file) {
    if (!file) return null;
    const okTypes = ["application/pdf", "image/jpeg", "image/png"];
    const fileName = file.name || "file";
    const extOk = /\.(pdf|jpg|jpeg|png)$/i.test(fileName);
    if (!okTypes.includes(file.type) && !extOk) {
      throw new Error("Only PDF, JPG, JPEG, PNG allowed.");
    }
    if (file.size > 5 * 1024 * 1024) {
      throw new Error("File too big. Max 5MB.");
    }
    const path = `${item.person_id}/${item.id}/${Date.now()}-${safeFileName(fileName)}`;
    const { error: uploadError } = await supabaseClient.storage.from(cfg.STORAGE_BUCKET).upload(path, file, { upsert: false });
    if (uploadError) throw uploadError;
    return {
      file_path: path,
      file_name: fileName,
      file_mime_type: file.type || null,
      file_size_bytes: file.size || null
    };
  }

  async function saveItem() {
    if (!isEditor()) return toast("View mode cannot save.", true);
    const btn = $("saveItemBtn");
    const done = setBusy(btn);
    try {
      const editId = $("itemEditId").value;
      const person = editId ? getPerson(getItem(editId)?.person_id) : findPersonFromInput($("itemPersonInput").value);
      if (!person) throw new Error("Choose person from the typing list.");
      const category = editId ? (getItem(editId)?.category || DEFAULT_ITEM_CATEGORY) : DEFAULT_ITEM_CATEGORY;
      const itemName = $("itemNameInput").value.trim();
      if (!itemName) throw new Error("Enter license/site pass name.");
      const noExpiry = $("itemNoExpiry").checked;
      const expiryDate = noExpiry ? null : ($("itemExpiry").value || null);
      const certNumber = $("itemCertNumber").value.trim() || null;
      const notes = $("itemNotes").value.trim() || null;
      await ensureType(category, itemName);

      let row;
      if (editId) {
        const { data, error } = await supabaseClient.from("expiry_items")
          .update({ category, item_name: itemName, cert_number: certNumber, expiry_date: expiryDate, notes })
          .eq("id", editId)
          .select("*")
          .single();
        if (error) throw error;
        row = data;
      } else {
        const { data, error } = await supabaseClient.from("expiry_items")
          .insert({ person_id: person.id, category, item_name: itemName, cert_number: certNumber, expiry_date: expiryDate, notes, is_archived: false })
          .select("*")
          .single();
        if (error) throw error;
        row = data;
      }

      const file = $("itemFile").files[0];
      if (file) {
        const fileData = await uploadFileForItem(row, file);
        const { data, error } = await supabaseClient.from("expiry_items").update(fileData).eq("id", row.id).select("*").single();
        if (error) throw error;
        row = data;
      }

      clearItemForm();
      await loadAll();
      toast("Item saved.");
    } catch (err) {
      toast(err.message || "Cannot save item.", true);
    } finally {
      done();
    }
  }

  function editItem(id) {
    const it = getItem(id);
    const p = getPerson(it?.person_id);
    if (!it || !p) return;
    $("itemEditId").value = it.id;
    $("itemPersonInput").value = personOptionValue(p);
    $("itemPersonInput").disabled = true;
    $("itemNameInput").value = it.item_name || "";
    $("itemCertNumber").value = it.cert_number || "";
    $("itemExpiry").value = it.expiry_date || "";
    $("itemNoExpiry").checked = !it.expiry_date;
    $("itemExpiry").disabled = !it.expiry_date;
    $("itemNotes").value = it.notes || "";
    $("itemFile").value = "";
    switchTab("dashboardTab");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function clearItemForm() {
    $("itemEditId").value = "";
    $("itemPersonInput").value = "";
    $("itemPersonInput").disabled = false;
    $("itemNameInput").value = "";
    $("itemCertNumber").value = "";
    $("itemExpiry").value = "";
    $("itemNoExpiry").checked = false;
    $("itemExpiry").disabled = false;
    $("itemNotes").value = "";
    $("itemFile").value = "";
  }

  async function deleteItem(id) {
    if (!isEditor()) return;
    const it = getItem(id);
    if (!it) return;
    const p = getPerson(it.person_id);
    if (!confirm(`Delete/hide this record?\n\n${personDisplay(p)}\n${it.item_name}`)) return;
    const { error } = await supabaseClient.from("expiry_items").update({ is_archived: true }).eq("id", id);
    if (error) return toast(error.message, true);
    massSelected.delete(String(id));
    await loadAll();
    toast("Record deleted/hidden.");
  }

  async function downloadFile(id) {
    const it = getItem(id);
    if (!it?.file_path) return toast("No file.", true);
    const { data, error } = await supabaseClient.storage.from(cfg.STORAGE_BUCKET).createSignedUrl(it.file_path, 60);
    if (error) return toast(error.message, true);
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.download = it.file_name || "download";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function downloadFilteredZip() {
    const rows = dashboardFilteredItems().filter((it) => it.file_path);
    if (!rows.length) return toast("Filtered list has no uploaded files.", true);
    if (!window.JSZip) return toast("ZIP tool not loaded. Check internet/CDN.", true);

    const btn = $("downloadFilteredBtn");
    const done = setBusy(btn, "Making ZIP...");
    try {
      const zip = new JSZip();
      const readme = [["Manual No", "Name", "Nickname", "Item", "Cert No", "Expiry", "Original File", "Zip Folder"]];

      for (const it of rows) {
        const p = getPerson(it.person_id);
        const { data, error } = await supabaseClient.storage.from(cfg.STORAGE_BUCKET).createSignedUrl(it.file_path, 60);
        if (error) throw error;
        const res = await fetch(data.signedUrl);
        if (!res.ok) throw new Error(`Cannot fetch ${it.file_name || it.file_path}`);
        const blob = await res.blob();
        const folder = safeFileName(it.item_name || "Unknown");
        const ext = (it.file_name || "file").split(".").pop() || "file";
        const fileName = `${manualFilePrefix(p)}_${safeFileName(p?.nickname || p?.name || "person")}_${safeFileName(it.item_name || "item")}_${it.expiry_date || "NO_DATE"}.${ext}`;
        zip.folder(folder).file(fileName, blob);
        readme.push([getManualNumber(p), p?.name || "", p?.nickname || "", it.item_name || "", it.cert_number || "", it.expiry_date || "", it.file_name || "", folder]);
      }

      const csv = readme.map((r) => r.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
      zip.file("README_FILE_LIST.csv", csv);
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `KG_license_site_pass_filtered_${todayISO()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast("ZIP downloaded.");
    } catch (err) {
      toast(err.message || "Cannot download ZIP.", true);
    } finally {
      done();
    }
  }

  async function downloadSelectedTypeZip() {
    const rows = downloadZipRows();
    if (!downloadSelectedTypes.size) return toast("Tick license/site pass type first.", true);
    if (!downloadSelectedPeople.size) return toast("Tick people first.", true);
    if (!rows.length) return toast("Selected people/license/site pass has no uploaded files.", true);
    if (!window.JSZip) return toast("ZIP tool not loaded. Check internet/CDN.", true);

    const btn = $("downloadByTypeBtn");
    const done = setBusy(btn, "Making ZIP...");
    try {
      const zip = new JSZip();
      const readme = [["Manual No", "Name", "Nickname", "Item", "Cert No", "Expiry", "Original File", "Zip Folder"]];

      for (const it of rows) {
        const p = getPerson(it.person_id);
        const { data, error } = await supabaseClient.storage.from(cfg.STORAGE_BUCKET).createSignedUrl(it.file_path, 60);
        if (error) throw error;
        const res = await fetch(data.signedUrl);
        if (!res.ok) throw new Error(`Cannot fetch ${it.file_name || it.file_path}`);
        const blob = await res.blob();
        const folder = safeFileName(it.item_name || "Unknown");
        const ext = (it.file_name || "file").split(".").pop() || "file";
        const fileName = `${manualFilePrefix(p)}_${safeFileName(p?.nickname || p?.name || "person")}_${safeFileName(it.item_name || "item")}_${it.expiry_date || "NO_DATE"}.${ext}`;
        zip.folder(folder).file(fileName, blob);
        readme.push([getManualNumber(p), p?.name || "", p?.nickname || "", it.item_name || "", it.cert_number || "", it.expiry_date || "", it.file_name || "", folder]);
      }

      const csv = readme.map((r) => r.map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
      zip.file("README_FILE_LIST.csv", csv);
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `KG_license_site_pass_by_type_${todayISO()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast("ZIP downloaded.");
    } catch (err) {
      toast(err.message || "Cannot download ZIP.", true);
    } finally {
      done();
    }
  }

  function toggleBulkPerson(id, checked) {
    id = String(id);
    if (checked) {
      if (!bulkSelected.has(id)) bulkSelected.set(id, { person_id: id, expiry_date: "", no_expiry: false, cert_number: "", notes: "" });
    } else {
      bulkSelected.delete(id);
    }
    renderBulkPeople();
    renderBulkSelected();
  }

  function applyBulkSameDate() {
    const sameDate = $("bulkSameDate").value;
    const noExpiry = $("bulkSameNoExpiry").checked;
    if (!bulkSelected.size) return toast("Tick people first.", true);
    if (!sameDate && !noExpiry) return toast("Choose date or tick no expiry first.", true);
    for (const [id, row] of bulkSelected) {
      row.no_expiry = noExpiry;
      row.expiry_date = noExpiry ? "" : sameDate;
      bulkSelected.set(id, row);
    }
    renderBulkSelected();
  }

  async function bulkAdd() {
    if (!isEditor()) return toast("View mode cannot add.", true);
    const category = DEFAULT_ITEM_CATEGORY;
    const itemName = $("bulkItemName").value.trim();
    if (!itemName) return toast("Enter license/site pass name.", true);
    if (!bulkSelected.size) return toast("Tick at least one person.", true);

    const btn = $("bulkAddBtn");
    const done = setBusy(btn, "Adding...");
    try {
      await ensureType(category, itemName);
      const skipDuplicate = $("bulkSkipDuplicate").checked;
      const rows = [];
      let skipped = 0;

      for (const [id, sel] of bulkSelected) {
        const duplicate = state.items.some((it) =>
          String(it.person_id) === String(id) &&
          normalizeText(it.item_name) === normalizeText(itemName)
        );
        if (skipDuplicate && duplicate) {
          skipped++;
          continue;
        }
        rows.push({
          person_id: id,
          category,
          item_name: itemName,
          expiry_date: sel.no_expiry ? null : (sel.expiry_date || null),
          cert_number: sel.cert_number || null,
          notes: sel.notes || null,
          is_archived: false
        });
      }

      if (!rows.length) {
        return toast(`No records added. ${skipped} duplicate skipped.`, true);
      }

      const { error } = await supabaseClient.from("expiry_items").insert(rows);
      if (error) throw error;
      bulkSelected.clear();
      await loadAll();
      toast(`Added ${rows.length} record(s). ${skipped ? `${skipped} duplicate skipped.` : ""}`);
    } catch (err) {
      toast(err.message || "Cannot bulk add.", true);
    } finally {
      done();
    }
  }

  async function massApply() {
    if (!isEditor()) return;
    if (!massSelected.size) return toast("Tick records first.", true);
    const noExpiry = $("massNoExpiry").checked;
    const expiryDate = $("massNewExpiry").value;
    const newItemName = $("massNewItemName").value.trim();
    const newCertNumber = $("massNewCertNumber").value.trim();

    const patch = {};
    if (noExpiry) patch.expiry_date = null;
    else if (expiryDate) patch.expiry_date = expiryDate;
    if (newItemName) patch.item_name = newItemName;
    if (newCertNumber) patch.cert_number = newCertNumber;

    if (!Object.keys(patch).length) return toast("Choose something to change first.", true);
    if (patch.item_name) await ensureType(DEFAULT_ITEM_CATEGORY, patch.item_name);

    const btn = $("massApplyBtn");
    const done = setBusy(btn, "Applying...");
    try {
      const { error } = await supabaseClient.from("expiry_items").update(patch).in("id", [...massSelected]);
      if (error) throw error;
      massSelected.clear();
      $("massNewExpiry").value = "";
      $("massNoExpiry").checked = false;
      $("massNewItemName").value = "";
      $("massNewCertNumber").value = "";
      await loadAll();
      toast("Mass edit done.");
    } catch (err) {
      toast(err.message || "Cannot mass edit.", true);
    } finally {
      done();
    }
  }

  async function massDelete() {
    if (!isEditor()) return;
    if (!massSelected.size) return toast("Tick records first.", true);
    if (!confirm(`Delete/hide ${massSelected.size} selected record(s)?`)) return;
    const btn = $("massDeleteBtn");
    const done = setBusy(btn, "Deleting...");
    try {
      const { error } = await supabaseClient.from("expiry_items").update({ is_archived: true }).in("id", [...massSelected]);
      if (error) throw error;
      massSelected.clear();
      await loadAll();
      toast("Selected records deleted/hidden.");
    } catch (err) {
      toast(err.message || "Cannot delete.", true);
    } finally {
      done();
    }
  }

  async function saveType() {
    if (!isEditor()) return;
    const id = $("typeEditId").value;
    const name = $("typeName").value.trim();
    if (!name) return toast("Enter license/site pass name.", true);
    const btn = $("saveTypeBtn");
    const done = setBusy(btn);
    try {
      if (id) {
        const oldType = state.types.find((t) => String(t.id) === String(id));
        const { error } = await supabaseClient.from("pass_license_types").update({ category: DEFAULT_ITEM_CATEGORY, name, updated_at: new Date().toISOString() }).eq("id", id);
        if (error) throw error;
        if (oldType && normalizeText(oldType.name) !== normalizeText(name)) {
          await supabaseClient.from("expiry_items")
            .update({ item_name: name })
            .ilike("item_name", oldType.name);
          await supabaseClient.from("pass_license_types")
            .update({ name, updated_at: new Date().toISOString() })
            .ilike("name", oldType.name);
        }
      } else {
        await ensureType(DEFAULT_ITEM_CATEGORY, name);
      }
      clearTypeForm();
      await loadAll();
      toast("Setup saved.");
    } catch (err) {
      toast(err.message || "Cannot save setup.", true);
    } finally {
      done();
    }
  }

  function editType(id) {
    const t = state.types.find((x) => String(x.id) === String(id));
    if (!t) return;
    $("typeEditId").value = t.id;
    $("typeName").value = t.name || "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function clearTypeForm() {
    $("typeEditId").value = "";
    $("typeName").value = "";
  }

  async function deleteType(id) {
    if (!isEditor()) return;
    const t = state.types.find((x) => String(x.id) === String(id));
    if (!t) return;
    const count = state.items.filter((it) => normalizeText(it.item_name) === normalizeText(t.name)).length;
    const ok = confirm(`Delete/hide this setup name?\n\n${t.name}\n\nThis will also hide ${count} matching worker record(s).`);
    if (!ok) return;
    try {
      const { error: typeError } = await supabaseClient.from("pass_license_types")
        .update({ is_archived: true, updated_at: new Date().toISOString() })
        .ilike("name", t.name);
      if (typeError) throw typeError;
      const { error: itemError } = await supabaseClient.from("expiry_items")
        .update({ is_archived: true })
        .ilike("item_name", t.name);
      if (itemError) throw itemError;
      await loadAll();
      toast("Setup name and matching records hidden.");
    } catch (err) {
      toast(err.message || "Cannot delete setup.", true);
    }
  }

  function normalizePersonRoleForSave(role) {
    const r = String(role || "").trim().toLowerCase();
    if (r === "foreman") return "Foreman";
    return "Worker";
  }

  async function savePerson() {
    if (!isEditor()) return;
    const id = $("personEditId").value;
    const name = $("personName").value.trim();
    if (!name) return toast("Enter person name.", true);
    const wpIcNumber = inputValue("personWpIcNumber");
    const finNumber = inputValue("personFinNumber");
    const patch = {
      manual_no: $("personManualNo").value.trim() || null,
      name,
      nickname: $("personNickname").value.trim() || null,
      role: normalizePersonRoleForSave($("personRole").value),
      status: $("personStatus").value,
      notes: $("personNotes").value.trim() || null,
      company_name: inputValue("personCompanyName") || null,
      uen: inputValue("personUen") || null,
      date_of_birth: inputValue("personDateOfBirth") || null,
      wp_ic_number: wpIcNumber || null,
      wp_ic_last4: inputValue("personWpIcLast4") || last4(wpIcNumber) || null,
      wp_ic_expiry_date: inputValue("personWpIcExpiryDate") || null,
      fin_number: finNumber || null,
      fin_last4: inputValue("personFinLast4") || last4(finNumber) || null,
      permit_type: inputValue("personPermitType") || null,
      occupation: inputValue("personOccupation") || null,
      sex: inputValue("personSex") || null,
      nationality: inputValue("personNationality") || null,
      address: inputValue("personAddress") || null,
      postal_code: inputValue("personPostalCode") || null,
      contact_no: inputValue("personContactNo") || null,
      is_archived: false
    };
    const btn = $("savePersonBtn");
    const done = setBusy(btn);
    try {
      if (id) {
        const { error } = await supabaseClient.from("people").update(patch).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabaseClient.from("people").insert(patch);
        if (error) throw error;
      }
      clearPersonForm();
      await loadAll();
      toast("Person saved.");
    } catch (err) {
      toast(err.message || "Cannot save person.", true);
    } finally {
      done();
    }
  }

  function editPerson(id) {
    const p = getPerson(id);
    if (!p) return;
    $("personEditId").value = p.id;
    $("personManualNo").value = getManualNumber(p);
    $("personName").value = p.name || "";
    $("personNickname").value = p.nickname || "";
    $("personRole").value = normalizePersonRoleForSave(p.role || "Worker");
    $("personStatus").value = String(p.status || "active").toLowerCase();
    $("personNotes").value = p.notes || "";
    PEOPLE_DETAIL_FIELDS.forEach(([field, inputId]) => setInputValue(inputId, p[field] || ""));
    switchTab("peopleTab");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function clearPersonForm() {
    $("personEditId").value = "";
    $("personManualNo").value = "";
    $("personName").value = "";
    $("personNickname").value = "";
    $("personRole").value = "Worker";
    $("personStatus").value = "active";
    $("personNotes").value = "";
    PEOPLE_DETAIL_FIELDS.forEach(([, inputId]) => setInputValue(inputId, ""));
  }

  async function deletePerson(id) {
    if (!isEditor()) return;
    const p = getPerson(id);
    if (!p) return;
    if (!confirm(`Delete/hide this person and all their records?\n\n${personDisplay(p)}`)) return;
    try {
      const { error: personError } = await supabaseClient.from("people").update({ is_archived: true }).eq("id", id);
      if (personError) throw personError;
      const { error: itemError } = await supabaseClient.from("expiry_items").update({ is_archived: true }).eq("person_id", id);
      if (itemError) throw itemError;
      bulkSelected.delete(String(id));
      downloadSelectedPeople.delete(String(id));
      await loadAll();
      toast("Person deleted/hidden.");
    } catch (err) {
      toast(err.message || "Cannot delete person.", true);
    }
  }

  function switchTab(tabId) {
    document.querySelectorAll(".tab").forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tabId));
    document.querySelectorAll(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === tabId));
  }

  function attachEvents() {
    $("loginBtn").addEventListener("click", login);
    $("pinInput").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });
    $("logoutBtn").addEventListener("click", logout);
    $("refreshBtn").addEventListener("click", () => loadAll().then(() => toast("Refreshed.")).catch((e) => toast(e.message, true)));

    document.querySelectorAll(".tab").forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.tab)));

    ["dashSearch", "dashPeopleStatus", "dashItemName", "dashExpiryStatus"].forEach((id) => $(id).addEventListener("input", renderDashboard));
    $("resetDashFiltersBtn").addEventListener("click", () => {
      $("dashSearch").value = "";
      $("dashPeopleStatus").value = "active";
      $("dashItemName").value = "";
      $("dashExpiryStatus").value = "all";
      renderDashboard();
    });
    $("downloadFilteredBtn").addEventListener("click", downloadFilteredZip);

    ["downloadTypeSearch"].forEach((id) => $(id).addEventListener("input", () => { renderDownloadTypes(); renderDownloadSummary(); }));
    ["downloadPeopleSearch", "downloadPeopleStatus", "downloadPeopleRole", "downloadOnlyWithFile"].forEach((id) => $(id).addEventListener("input", () => { renderDownloadPeople(); renderDownloadSummary(); }));
    $("downloadTickVisibleTypesBtn").addEventListener("click", () => { state.visibleDownloadTypes.forEach((t) => downloadSelectedTypes.add(makeTypeKey(t.category, t.name))); renderDownloadTypes(); renderDownloadPeople(); renderDownloadSummary(); });
    $("downloadUntickVisibleTypesBtn").addEventListener("click", () => { state.visibleDownloadTypes.forEach((t) => downloadSelectedTypes.delete(makeTypeKey(t.category, t.name))); renderDownloadTypes(); renderDownloadPeople(); renderDownloadSummary(); });
    $("downloadClearTypesBtn").addEventListener("click", () => { downloadSelectedTypes.clear(); renderDownloadTypes(); renderDownloadPeople(); renderDownloadSummary(); });
    $("downloadTickVisiblePeopleBtn").addEventListener("click", () => { state.visibleDownloadPeople.forEach((p) => downloadSelectedPeople.add(String(p.id))); renderDownloadPeople(); renderDownloadSummary(); });
    $("downloadUntickVisiblePeopleBtn").addEventListener("click", () => { state.visibleDownloadPeople.forEach((p) => downloadSelectedPeople.delete(String(p.id))); renderDownloadPeople(); renderDownloadSummary(); });
    $("downloadClearPeopleBtn").addEventListener("click", () => { downloadSelectedPeople.clear(); renderDownloadPeople(); renderDownloadSummary(); });
    $("downloadByTypeBtn").addEventListener("click", downloadSelectedTypeZip);

    $("saveItemBtn").addEventListener("click", saveItem);
    $("clearItemFormBtn").addEventListener("click", clearItemForm);
    $("itemNoExpiry").addEventListener("change", () => {
      $("itemExpiry").disabled = $("itemNoExpiry").checked;
      if ($("itemNoExpiry").checked) $("itemExpiry").value = "";
    });

    ["bulkPeopleSearch", "bulkPeopleStatus", "bulkRoleFilter"].forEach((id) => $(id).addEventListener("input", renderBulkPeople));
    $("applyBulkSameDateBtn").addEventListener("click", applyBulkSameDate);
    $("bulkAddBtn").addEventListener("click", bulkAdd);
    $("bulkTickVisibleBtn").addEventListener("click", () => {
      state.visibleBulkPeople.forEach((p) => bulkSelected.set(String(p.id), bulkSelected.get(String(p.id)) || { person_id: String(p.id), expiry_date: "", no_expiry: false, cert_number: "", notes: "" }));
      renderBulkPeople(); renderBulkSelected();
    });
    $("bulkUntickVisibleBtn").addEventListener("click", () => {
      state.visibleBulkPeople.forEach((p) => bulkSelected.delete(String(p.id)));
      renderBulkPeople(); renderBulkSelected();
    });
    $("bulkClearSelectedBtn").addEventListener("click", () => { bulkSelected.clear(); renderBulkPeople(); renderBulkSelected(); });

    ["massSearch", "massPeopleStatus", "massItemName"].forEach((id) => $(id).addEventListener("input", renderMassItems));
    $("massTickVisibleBtn").addEventListener("click", () => { state.visibleMassItems.forEach((it) => massSelected.add(String(it.id))); renderMassItems(); renderMassSelected(); });
    $("massUntickVisibleBtn").addEventListener("click", () => { state.visibleMassItems.forEach((it) => massSelected.delete(String(it.id))); renderMassItems(); renderMassSelected(); });
    $("massClearSelectedBtn").addEventListener("click", () => { massSelected.clear(); renderMassItems(); renderMassSelected(); });
    $("massApplyBtn").addEventListener("click", massApply);
    $("massDeleteBtn").addEventListener("click", massDelete);
    $("massNoExpiry").addEventListener("change", () => { if ($("massNoExpiry").checked) $("massNewExpiry").value = ""; });

    $("saveTypeBtn").addEventListener("click", saveType);
    $("clearTypeFormBtn").addEventListener("click", clearTypeForm);
    ["typeSearch"].forEach((id) => $(id).addEventListener("input", renderTypes));

    $("savePersonBtn").addEventListener("click", savePerson);
    $("clearPersonFormBtn").addEventListener("click", clearPersonForm);
    $("exportPeopleNameListBtn").addEventListener("click", () => exportPeopleNameListExcel(false));
    $("exportAllPeopleNameListBtn").addEventListener("click", () => exportPeopleNameListExcel(true));
    ["peopleSearch", "peopleStatusFilter"].forEach((id) => $(id).addEventListener("input", renderPeople));

    document.body.addEventListener("click", async (e) => {
      const el = e.target.closest("[data-action]");
      if (!el) return;
      const action = el.dataset.action;
      const id = el.dataset.id;

      if (action === "edit-item") editItem(id);
      if (action === "delete-item") await deleteItem(id);
      if (action === "download-file") await downloadFile(id);
      if (action === "bulk-remove-person") toggleBulkPerson(id, false);
      if (action === "mass-remove-item") { massSelected.delete(String(id)); renderMassItems(); renderMassSelected(); }
      if (action === "edit-type") editType(id);
      if (action === "delete-type") await deleteType(id);
      if (action === "edit-person") editPerson(id);
      if (action === "delete-person") await deletePerson(id);
    });

    document.body.addEventListener("change", (e) => {
      const el = e.target.closest("[data-action]");
      if (!el) return;
      const action = el.dataset.action;
      const id = el.dataset.id;
      if (action === "download-toggle-type") setDownloadType(el.dataset.key, el.checked);
      if (action === "download-toggle-person") setDownloadPerson(id, el.checked);
      if (action === "bulk-toggle-person") toggleBulkPerson(id, el.checked);
      if (action === "bulk-expiry") {
        const row = bulkSelected.get(String(id));
        if (row) { row.expiry_date = el.value; bulkSelected.set(String(id), row); }
      }
      if (action === "bulk-cert") {
        const row = bulkSelected.get(String(id));
        if (row) { row.cert_number = el.value.trim(); bulkSelected.set(String(id), row); }
      }
      if (action === "bulk-no-expiry") {
        const row = bulkSelected.get(String(id));
        if (row) {
          row.no_expiry = el.checked;
          if (el.checked) row.expiry_date = "";
          bulkSelected.set(String(id), row);
          renderBulkSelected();
        }
      }
      if (action === "mass-toggle-item") {
        if (el.checked) massSelected.add(String(id));
        else massSelected.delete(String(id));
        renderMassItems();
        renderMassSelected();
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    attachEvents();
    try {
      initClient();
    } catch (err) {
      $("loginMsg").textContent = err.message;
    }
  });
})();
