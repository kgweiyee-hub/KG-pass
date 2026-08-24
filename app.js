/* KG License / Site Pass Tracker V5.9 */
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
    visibleDownloadPeople: [],
    visibleNameListPeople: []
  };

  const bulkSelected = new Map(); // personId -> { person_id, expiry_date, no_expiry, notes }
  const massSelected = new Set(); // item ids
  const downloadSelectedTypes = new Set(); // name key only
  const downloadSelectedPeople = new Set(); // person ids
  const nameListSelectedPeople = new Set(); // person ids for nickname/name-list export
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

  function formatNameListDate(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";

    // Supabase date fields normally save as YYYY-MM-DD. Export must look like 06/Mar/2027.
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
      const year = iso[1];
      const monthIndex = Number(iso[2]) - 1;
      const day = iso[3];
      if (monthIndex >= 0 && monthIndex < 12) return `${day}/${months[monthIndex]}/${year}`;
    }

    // If user typed special words like IPA, N.A, or already typed a date manually, keep it exactly.
    return raw;
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

  function comparePeopleByName(a, b) {
    const nc = String(a?.name || "").localeCompare(String(b?.name || ""), undefined, {
      numeric: true,
      sensitivity: "base"
    });
    if (nc !== 0) return nc;
    return compareManualNumber(a, b);
  }

  function comparePeopleByNickname(a, b) {
    const ac = String(a?.nickname || a?.name || "").localeCompare(String(b?.nickname || b?.name || ""), undefined, {
      numeric: true,
      sensitivity: "base"
    });
    if (ac !== 0) return ac;
    return comparePeopleByName(a, b);
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

  function parseTrackingDate(value) {
    const raw = String(value || "").trim();
    if (!raw) return null;

    // Main saved format from <input type="date">: YYYY-MM-DD
    let m = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return Number.isNaN(d.getTime()) ? null : d;
    }

    // Support Excel-style dates the user may type, e.g. 06/Mar/2027, 06-Mar-2027, 06 Mar 2027.
    const monthMap = {
      jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
      may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
      oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
    };
    m = raw.match(/^(\d{1,2})[\/\-\s]+([A-Za-z]{3,9})[\/\-\s]+(\d{4})$/);
    if (m) {
      const monthIndex = monthMap[m[2].toLowerCase()];
      if (monthIndex !== undefined) {
        const d = new Date(Number(m[3]), monthIndex, Number(m[1]));
        return Number.isNaN(d.getTime()) ? null : d;
      }
    }

    // Support 06/03/2027 or 06-03-2027 as DD/MM/YYYY.
    m = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) {
      const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
      return Number.isNaN(d.getTime()) ? null : d;
    }

    return null;
  }

  function daysUntil(dateString) {
    const parsed = parseTrackingDate(dateString);
    if (!parsed) return null;
    const today = new Date(`${todayISO()}T00:00:00`);
    const target = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    return Math.round((target - today) / 86400000);
  }

  function expiryInfoFromDate(dateString) {
    // One simple tracking rule:
    // Black = expired, Red = 0-14 days, Yellow = 15-30 days, Green = more than 30 days.
    if (!dateString) return { key: "nodate", label: "No Date", days: null, rank: 999999999 };
    const days = daysUntil(dateString);
    if (days === null || Number.isNaN(days)) return { key: "nodate", label: "No Date / Text", days: null, rank: 999999999 };
    if (days < 0) return { key: "expired", label: `Black Expired ${Math.abs(days)}d`, days, rank: -1 };
    if (days <= 14) return { key: "red", label: days === 0 ? "Red Today" : `Red ${days}d`, days, rank: days };
    if (days <= 30) return { key: "yellow", label: `Yellow ${days}d`, days, rank: days };
    return { key: "normal", label: `Green ${days}d`, days, rank: days };
  }

  function expiryInfo(item) {
    return expiryInfoFromDate(item?.expiry_date);
  }

  function wpIcExpiryInfo(person) {
    return expiryInfoFromDate(person?.wp_ic_expiry_date);
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

  function wpIcExpiryPill(person) {
    const info = wpIcExpiryInfo(person);
    return `<span class="status-pill ${safeHtml(info.key)}">${safeHtml(info.label)}</span>`;
  }

  function itemMatchesExpiryFilter(item, filter) {
    if (!filter || filter === "all") return true;
    const key = expiryInfo(item).key;
    if (filter === "red") return key === "red" || key === "expired";
    return key === filter;
  }

  function personMatchesWpIcExpiryFilter(person, filter) {
    if (!filter || filter === "all") return true;
    const key = wpIcExpiryInfo(person).key;
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
    for (const id of [...nameListSelectedPeople]) {
      if (!getPerson(id)) nameListSelectedPeople.delete(id);
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
    renderWpIcExpiry();
    renderPeople();
    renderNameListPicker();
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

  function dashboardFilteredWpSummaryRows() {
    const q = normalizeText($("dashSearch").value);
    const peopleStatus = $("dashPeopleStatus").value;
    const itemName = normalizeText($("dashItemName").value);
    const expiryStatus = $("dashExpiryStatus").value;
    const wpSearchText = "wp wp/ic wp ic work permit";

    return state.people.filter((p) => {
      const date = String(p.wp_ic_expiry_date || "").trim();
      if (!date) return false;
      const pStatus = String(p.status || "active").toLowerCase();
      if (peopleStatus !== "all" && pStatus !== peopleStatus) return false;
      if (itemName && !wpSearchText.includes(itemName)) return false;
      if (q && !`${personSearchText(p)} ${wpSearchText}`.includes(q)) return false;
      if (!personMatchesWpIcExpiryFilter(p, expiryStatus)) return false;
      return true;
    }).map((p) => ({
      id: `wp-${p.id}`,
      person_id: p.id,
      item_name: "WP",
      expiry_date: p.wp_ic_expiry_date,
      is_wp_summary: true
    }));
  }

  function renderExpiryDateSummary(rows) {
    const el = $("dashboardExpirySummary");
    if (!el) return;

    const summaryRows = [...rows, ...dashboardFilteredWpSummaryRows()];
    if (!summaryRows.length) {
      el.innerHTML = `<div class="muted">No expiry summary. Filter has no records.</div>`;
      return;
    }

    const groups = new Map();
    summaryRows.forEach((it) => {
      const key = it.expiry_date || "NO_DATE";
      if (!groups.has(key)) {
        groups.set(key, { expiry_date: it.expiry_date || "", items: [] });
      }
      groups.get(key).items.push(it);
    });

    const sortedGroups = [...groups.values()].sort(compareExpiryDateGroups);
    el.innerHTML = `
      <div class="summary-title">Expiry Date Summary</div>
      <div class="summary-help">Uses current filter. Includes License / Site Pass expiry and WP expiry. People inside each date are sorted by manual number.</div>
      <div class="expiry-summary-list">
        ${sortedGroups.map((group) => {
          const first = group.items[0];
          const info = expiryInfo(first);
          const sortedItems = [...group.items].sort(compareItems);
          const preview = sortedItems.slice(0, 8).map((it) => {
            const p = getPerson(it.person_id);
            return `${safeHtml(getManualNumber(p) || "-")}. ${safeHtml(p?.nickname || p?.name || "Unknown")} - ${safeHtml(it.is_wp_summary ? "WP" : (it.item_name || ""))}`;
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

  function selectedDownloadTypeNames() {
    const byKey = new Map(allTypeRows().map((t) => [makeTypeKey(t.category, t.name), t.name]));
    return [...downloadSelectedTypes].map((key) => ({ key, name: byKey.get(key) || key }));
  }

  function downloadMatchingItemsForPerson(personId) {
    const selected = selectedDownloadTypeKeys();
    return state.items.filter((it) => {
      if (String(it.person_id) !== String(personId)) return false;
      if (selected.size && !selected.has(makeTypeKey(it.category, it.item_name))) return false;
      return true;
    });
  }

  function downloadPersonMatchInfo(personId) {
    const selected = selectedDownloadTypeNames();
    const personItems = state.items.filter((it) => String(it.person_id) === String(personId));
    const personKeys = new Set(personItems.map((it) => makeTypeKey(it.category, it.item_name)));
    const has = selected.filter((t) => personKeys.has(t.key));
    const missing = selected.filter((t) => !personKeys.has(t.key));
    const matchingItems = downloadMatchingItemsForPerson(personId);
    const fileCount = matchingItems.filter((it) => it.file_path).length;
    return { selected, has, missing, matchingItems, fileCount };
  }

  function downloadPersonPassesFilterOk(personId) {
    const mode = $("downloadMatchMode") ? $("downloadMatchMode").value : "any";
    const info = downloadPersonMatchInfo(personId);
    if (!info.selected.length) return true;
    if (mode === "all_people") return true;
    if (mode === "all") return info.missing.length === 0;
    return info.has.length > 0;
  }

  function compareDownloadPeopleByMatchThenManual(a, b) {
    const ai = downloadPersonMatchInfo(a.id);
    const bi = downloadPersonMatchInfo(b.id);
    const selectedCount = Math.max(ai.selected.length, bi.selected.length);

    // When pass/license names are selected, sort like:
    // all selected matched first, then missing 1, missing 2, and so on.
    if (selectedCount > 0) {
      const ac = ai.has.length;
      const bc = bi.has.length;
      if (ac !== bc) return bc - ac;

      const am = ai.missing.length;
      const bm = bi.missing.length;
      if (am !== bm) return am - bm;

      const af = ai.fileCount;
      const bf = bi.fileCount;
      if (af !== bf) return bf - af;
    }

    return comparePeople(a, b);
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
      if (!downloadPersonPassesFilterOk(p.id)) return false;
      if (onlyWithFile && !downloadMatchingItemsForPerson(p.id).some((it) => it.file_path)) return false;
      return true;
    });

    // Keep already ticked people visible even if the pass filter changes,
    // but still sort the full list by best pass/license match first.
    const pinned = [...downloadSelectedPeople].map(getPerson).filter(Boolean);
    const byId = new Map();
    [...filtered, ...pinned].forEach((p) => byId.set(String(p.id), p));
    return [...byId.values()].sort(compareDownloadPeopleByMatchThenManual);
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
      const info = downloadPersonMatchInfo(p.id);
      const hasText = info.has.map((t) => t.name).join(", ");
      const missingText = info.missing.map((t) => t.name).join(", ");
      let matchHtml = `<span class="muted">No pass selected</span>`;
      if (info.selected.length) {
        const missingCount = info.selected.length - info.has.length;
        const rankLabel = missingCount === 0 ? "All match" : `Missing ${missingCount}`;
        const rankClass = missingCount === 0 ? "normal" : "missing";
        matchHtml = `
          <div class="match-line"><span class="pill ${rankClass}">${safeHtml(rankLabel)}</span> <span class="pill">Has ${info.has.length}/${info.selected.length}</span> ${safeHtml(hasText || "-")}</div>
          ${info.missing.length ? `<div class="match-line"><span class="pill missing">Missing</span> ${safeHtml(missingText)}</div>` : ""}
        `;
      }
      return `
        <tr class="${checked ? "selected-row" : ""}">
          <td><input type="checkbox" data-action="download-toggle-person" data-id="${safeHtml(p.id)}" ${checked ? "checked" : ""}></td>
          <td><b>${safeHtml(getManualNumber(p))}</b></td>
          <td><div class="person-name">${safeHtml(p.name || "")}</div><div class="person-sub">${safeHtml(p.nickname || "")}</div></td>
          <td>${statusPill(p.status)}</td>
          <td>${safeHtml(p.role || "")}</td>
          <td>${matchHtml}</td>
          <td><span class="pill normal">${info.fileCount}</span></td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="7" class="muted">No people found. Choose Has ANY / Has ALL / Show all people, or change the people filter.</td></tr>`;
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
    const matchMode = $("downloadMatchMode") ? $("downloadMatchMode").value : "any";
    const matchLabel = matchMode === "all" ? "People filter: has ALL selected" : matchMode === "all_people" ? "People filter: show all for Excel" : "People filter: has ANY selected";
    el.innerHTML = `
      <span class="pill">Selected license/site pass: ${downloadSelectedTypes.size}</span>
      <span class="pill">Selected people: ${downloadSelectedPeople.size}</span>
      <span class="pill">${safeHtml(matchLabel)}</span>
      <span class="pill">Sort: all match first, then missing 1, missing 2...</span>
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



  function xmlEscape(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function xlsxColName(index) {
    let n = index + 1;
    let name = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      name = String.fromCharCode(65 + rem) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  function xlsxInlineCell(rowNo, colIndex, value, styleIndex) {
    const ref = `${xlsxColName(colIndex)}${rowNo}`;
    const text = xmlEscape(value);
    return `<c r="${ref}" s="${styleIndex}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
  }

  function xlsxRow(rowNo, cells, styleIndex, height) {
    const ht = height ? ` ht="${height}" customHeight="1"` : "";
    return `<row r="${rowNo}" spans="1:17"${ht}>${cells.map((value, colIndex) => xlsxInlineCell(rowNo, colIndex, value, styleIndex)).join("")}</row>`;
  }

  function nameListRows(allPeople = false, selectedPeopleOnly = false, selectedSet = downloadSelectedPeople) {
    let rows;
    if (selectedPeopleOnly) {
      rows = [...selectedSet].map(getPerson).filter(Boolean);
    } else {
      rows = allPeople ? [...state.people] : filterPeople("peopleSearch", "peopleStatusFilter");
    }
    // Excel name list must be arranged by NAME, not manual number.
    return rows.sort(comparePeopleByName);
  }

  function nameListExportColumns(person, index) {
    return [
      String(index + 1),
      person?.name || "",
      person?.uen || "",
      person?.company_name || "",
      formatNameListDate(person?.date_of_birth),
      person?.wp_ic_number || "",
      person?.wp_ic_last4 || last4(person?.wp_ic_number) || "",
      formatNameListDate(person?.wp_ic_expiry_date),
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

  function nameListStyleXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac">
  <fonts count="4" x14ac:knownFonts="1">
    <font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="14"/><name val="Times New Roman"/><family val="1"/></font>
    <font><sz val="10"/><name val="Times New Roman"/><family val="1"/></font>
    <font><b/><sz val="10"/><name val="Times New Roman"/><family val="1"/></font>
  </fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="7">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="49" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="49" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="49" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="49" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="49" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;
  }

  function nameListWorkbookXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <fileVersion appName="xl"/>
  <workbookPr defaultThemeVersion="124226"/>
  <bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="17640"/></bookViews>
  <sheets><sheet name="Name List" sheetId="1" r:id="rId1"/></sheets>
  <calcPr calcId="191029"/>
</workbook>`;
  }

  function nameListThemeXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme"><a:themeElements><a:clrScheme name="Office"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4><a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="Office"><a:majorFont><a:latin typeface="Cambria"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme><a:fmtScheme name="Office"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="9525" cap="flat" cmpd="sng" algn="ctr"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements><a:objectDefaults/><a:extraClrSchemeLst/></a:theme>`;
  }

  function buildNameListSheetXml(rows) {
    const headers = [
      "S/N",
      "NAME",
      "UEN",
      "COMPANY",
      "DATE OF BIRTH ",
      "W.P NO",
      "Last 4 Digital No （WP）",
      "DATE EXPIRY",
      "FIN NO.",
      "Last 4 Digital No （Fin No)",
      "Type of Permit",
      "Occupation",
      "SEX",
      " Nationality",
      "Address",
      "Postal Code",
      "Contact No."
    ];
    const colWidths = [4.28515625, 29.42578125, 13.7109375, 25.85546875, 14.140625, 14.5703125, 14.5703125, 17.28515625, 15.140625, 15.140625, 10.28515625, 26.42578125, 8.5703125, 13.85546875, 40.7109375, 11.7109375, 12.28515625];
    const centerCols = new Set([0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 13, 15, 16]);
    const bodyRows = rows.map((p, i) => nameListExportColumns(p, i));
    const lastRow = bodyRows.length + 5;
    const colsXml = colWidths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");

    const titleCells = [
      `<row r="1" spans="1:17" ht="26.25" customHeight="1">${xlsxInlineCell(1, 0, "KG PLASTERCEIL PTE LTD", 1)}</row>`,
      `<row r="2" spans="1:17" ht="14.25" customHeight="1">${xlsxInlineCell(2, 0, "7 Mandai Link #07-01 Mandai Connection Singapore 728653", 2)}</row>`,
      `<row r="3" spans="1:17" ht="14.25" customHeight="1">${xlsxInlineCell(3, 0, "CO.REG NO : 200916977D", 2)}</row>`,
      `<row r="4" spans="1:17" ht="18.75" customHeight="1">${xlsxInlineCell(4, 0, " TEL : 68446001   FAX : 62590272", 2)}</row>`
    ];
    const headerRow = xlsxRow(5, headers, 3, 31.5);
    const dataRows = bodyRows.map((row, i) => {
      const rowNo = i + 6;
      const cells = row.map((value, colIndex) => {
        const style = centerCols.has(colIndex) ? 5 : (colIndex === 1 || colIndex === 11 || colIndex === 14 ? 6 : 4);
        return xlsxInlineCell(rowNo, colIndex, value, style);
      }).join("");
      return `<row r="${rowNo}" spans="1:17" ht="15.75" customHeight="1">${cells}</row>`;
    }).join("\n");

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac">
  <dimension ref="A1:Q${lastRow}"/>
  <sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A6" sqref="A6"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="15" x14ac:dyDescent="0.25"/>
  <cols>${colsXml}</cols>
  <sheetData>
    ${titleCells.join("\n")}
    ${headerRow}
    ${dataRows}
  </sheetData>
  <mergeCells count="4"><mergeCell ref="A1:Q1"/><mergeCell ref="A2:Q2"/><mergeCell ref="A3:Q3"/><mergeCell ref="A4:Q4"/></mergeCells>
  <pageMargins left="0.25" right="0.25" top="0.25" bottom="0.25" header="0.3" footer="0.3"/>
  <pageSetup orientation="landscape"/>
</worksheet>`;
  }

  async function downloadNameListXlsx(rows, fileName) {
    if (!window.JSZip) throw new Error("Excel writer not loaded. Check internet/CDN, then refresh.");
    const zip = new JSZip();
    zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
    zip.folder("_rels").file(".rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`);
    zip.folder("docProps").file("core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>KG Pass &amp; License Tracker</dc:creator><cp:lastModifiedBy>KG Pass &amp; License Tracker</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified></cp:coreProperties>`);
    zip.folder("docProps").file("app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>KG Pass &amp; License Tracker</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>Name List</vt:lpstr></vt:vector></TitlesOfParts><Company>KG Plasterceil Pte Ltd</Company></Properties>`);
    const xl = zip.folder("xl");
    xl.file("workbook.xml", nameListWorkbookXml());
    xl.folder("_rels").file("workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>`);
    xl.folder("worksheets").file("sheet1.xml", buildNameListSheetXml(rows));
    xl.file("styles.xml", nameListStyleXml());
    xl.folder("theme").file("theme1.xml", nameListThemeXml());
    const content = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(content);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function exportPeopleNameListExcel(allPeople = false, selectedPeopleOnly = false, selectedSet = downloadSelectedPeople) {
    const rows = nameListRows(allPeople, selectedPeopleOnly, selectedSet);
    if (!rows.length) return toast("No people to export.", true);
    const fileName = selectedPeopleOnly
      ? `KG_name_list_selected_people_${todayISO()}.xlsx`
      : (allPeople ? `KG_name_list_all_${todayISO()}.xlsx` : `KG_name_list_filtered_${todayISO()}.xlsx`);
    try {
      await downloadNameListXlsx(rows, fileName);
      toast(`Excel name list exported (${rows.length} people, same sample style, sorted by name).`);
    } catch (err) {
      toast(err.message || "Cannot export Excel.", true);
    }
  }


  function normalizeNameKey(value) {
    return String(value || "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  function normalizeExcelHeader(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/<br\s*\/?\s*>/g, " ")
      .replace(/[（）]/g, "")
      .replace(/[^a-z0-9]+/g, "")
      .trim();
  }

  function excelSerialToDateText(serial) {
    const n = Number(serial);
    if (!Number.isFinite(n) || n < 1 || n > 80000) return "";
    // Excel 1900 date system. Good for work pass and DOB fields.
    const utc = Math.round((n - 25569) * 86400 * 1000);
    const d = new Date(utc);
    if (Number.isNaN(d.getTime())) return "";
    const day = String(d.getUTCDate()).padStart(2, "0");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
    return `${day}/${months[d.getUTCMonth()]}/${d.getUTCFullYear()}`;
  }

  function excelText(value, field = "") {
    if (value === null || value === undefined) return "";
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const day = String(value.getDate()).padStart(2, "0");
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"];
      return `${day}/${months[value.getMonth()]}/${value.getFullYear()}`;
    }
    const text = String(value).replace(/\u00a0/g, " ").trim();
    if ((field === "date_of_birth" || field === "wp_ic_expiry_date") && /^\d+(\.\d+)?$/.test(text)) {
      return excelSerialToDateText(text) || text;
    }
    return text;
  }

  function csvToRows(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;
    const str = String(text || "").replace(/^\ufeff/, "");
    for (let i = 0; i < str.length; i += 1) {
      const ch = str[i];
      if (ch === '"') {
        if (inQuotes && str[i + 1] === '"') { cell += '"'; i += 1; }
        else inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        row.push(cell); cell = "";
      } else if ((ch === "\n" || ch === "\r") && !inQuotes) {
        if (ch === "\r" && str[i + 1] === "\n") i += 1;
        row.push(cell); cell = "";
        if (row.some((v) => String(v).trim())) rows.push(row);
        row = [];
      } else {
        cell += ch;
      }
    }
    row.push(cell);
    if (row.some((v) => String(v).trim())) rows.push(row);
    return rows;
  }

  function xlsxRefToColRow(ref) {
    const match = String(ref || "").match(/^([A-Z]+)(\d+)$/i);
    if (!match) return null;
    let col = 0;
    for (const ch of match[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
    return { col: col - 1, row: Number(match[2]) - 1 };
  }

  function xlsxXmlText(node, tagName) {
    const found = node.getElementsByTagName(tagName)[0];
    return found ? (found.textContent || "") : "";
  }

  async function readXlsxRowsWithJsZip(file) {
    if (!window.JSZip) throw new Error("Excel reader not loaded. Check internet/CDN, then refresh.");
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const parser = new DOMParser();
    let sheetPath = "xl/worksheets/sheet1.xml";
    const workbookFile = zip.file("xl/workbook.xml");
    const relsFile = zip.file("xl/_rels/workbook.xml.rels");
    if (workbookFile && relsFile) {
      const workbookXml = parser.parseFromString(await workbookFile.async("text"), "application/xml");
      const firstSheet = workbookXml.getElementsByTagName("sheet")[0];
      const rid = firstSheet ? (firstSheet.getAttribute("r:id") || firstSheet.getAttribute("id")) : "";
      const relsXml = parser.parseFromString(await relsFile.async("text"), "application/xml");
      for (const rel of [...relsXml.getElementsByTagName("Relationship")]) {
        if (rel.getAttribute("Id") === rid) {
          const target = rel.getAttribute("Target") || "worksheets/sheet1.xml";
          sheetPath = "xl/" + target.replace(/^\/+/, "").replace(/^xl\//, "");
          break;
        }
      }
    }

    const sheetFile = zip.file(sheetPath) || zip.file("xl/worksheets/sheet1.xml");
    if (!sheetFile) throw new Error("Cannot find first worksheet inside Excel file.");

    const shared = [];
    const sharedFile = zip.file("xl/sharedStrings.xml");
    if (sharedFile) {
      const sharedXml = parser.parseFromString(await sharedFile.async("text"), "application/xml");
      for (const si of [...sharedXml.getElementsByTagName("si")]) {
        const texts = [...si.getElementsByTagName("t")].map((t) => t.textContent || "").join("");
        shared.push(texts);
      }
    }

    const sheetXml = parser.parseFromString(await sheetFile.async("text"), "application/xml");
    const out = [];
    for (const c of [...sheetXml.getElementsByTagName("c")]) {
      const pos = xlsxRefToColRow(c.getAttribute("r"));
      if (!pos) continue;
      const t = c.getAttribute("t") || "";
      let value = "";
      if (t === "s") value = shared[Number(xlsxXmlText(c, "v"))] || "";
      else if (t === "inlineStr") value = xlsxXmlText(c, "t");
      else value = xlsxXmlText(c, "v") || xlsxXmlText(c, "t") || "";
      if (!out[pos.row]) out[pos.row] = [];
      out[pos.row][pos.col] = value;
    }
    return out.map((r) => r || []).filter((r) => r.some((v) => String(v || "").trim()));
  }

  async function readPeopleExcelRows(file) {
    const ext = String(file.name || "").split(".").pop().toLowerCase();
    if (ext === "csv") return csvToRows(await file.text());
    if (window.XLSX) {
      const buffer = await file.arrayBuffer();
      const workbook = window.XLSX.read(buffer, { type: "array", cellDates: true, cellText: true });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error("No worksheet found in this Excel file.");
      const sheet = workbook.Sheets[sheetName];
      return window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false, blankrows: false });
    }
    if (ext === "xlsx") return readXlsxRowsWithJsZip(file);
    throw new Error("Excel reader not loaded. Please use .xlsx or .csv, then refresh and try again.");
  }


  const PEOPLE_IMPORT_ALIASES = [
    { field: "manual_no", aliases: ["manualno", "manualnumber", "no", "number", "personno", "workerno"] },
    { field: "name", aliases: ["name", "fullname", "workername", "personname"] },
    { field: "uen", aliases: ["uen", "uennumber"] },
    { field: "company_name", aliases: ["company", "companyname", "companynameuen"] },
    { field: "date_of_birth", aliases: ["dateofbirth", "dob", "birthdate"] },
    { field: "wp_ic_number", aliases: ["wpno", "wpnumber", "wpicnumber", "wporicnumber", "wpornricnumber", "wpornumber", "icnumber", "icno", "wpicno", "wpornricno", "wpnoicno", "wpic"] },
    { field: "wp_ic_last4", aliases: ["last4digitalnowp", "last4digitnowp", "last4digitalwp", "last4digitwp", "last4wp", "wpiclast4", "last4digitalno", "last4digitno"] },
    { field: "wp_ic_expiry_date", aliases: ["dateexpiry", "expirydate", "wpicexpirydate", "wporicexpirydate", "wpicexpiry", "wpexpiry", "icexpiry", "dateexpire", "expiry"] },
    { field: "fin_number", aliases: ["finno", "finnumber", "fin", "finno."] },
    { field: "fin_last4", aliases: ["last4digitalnofinno", "last4digitnofinno", "last4digitalfinno", "last4digitfinno", "last4fin", "finlast4", "last4digitalnofin"] },
    { field: "permit_type", aliases: ["typeofpermit", "permittype", "permit", "passtype"] },
    { field: "occupation", aliases: ["occupation", "job", "trade"] },
    { field: "sex", aliases: ["sex", "gender"] },
    { field: "nationality", aliases: ["nationality", "country"] },
    { field: "address", aliases: ["address", "homeaddress", "residentialaddress"] },
    { field: "postal_code", aliases: ["postalcode", "postcode", "zipcode", "postal"] },
    { field: "contact_no", aliases: ["contactno", "contactnumber", "phone", "phoneno", "mobileno", "mobilenumber", "tel", "telno"] },
    { field: "role", aliases: ["role", "position"] },
    { field: "status", aliases: ["status", "activepause"] }
  ];

  function mapExcelHeaders(headerRow) {
    const columns = {};
    const normalized = headerRow.map(normalizeExcelHeader);
    normalized.forEach((head, index) => {
      if (!head) return;
      for (const def of PEOPLE_IMPORT_ALIASES) {
        if (columns[def.field] !== undefined) continue;
        if (def.aliases.includes(head)) {
          columns[def.field] = index;
          break;
        }
      }
    });
    return columns;
  }

  function findPeopleExcelHeaderRow(rows) {
    for (let i = 0; i < Math.min(rows.length, 20); i += 1) {
      const cols = mapExcelHeaders(rows[i] || []);
      const score = Object.keys(cols).length;
      if (cols.name !== undefined && score >= 3) return { index: i, columns: cols };
    }
    return null;
  }

  function valueFromExcelRow(row, columns, field) {
    const index = columns[field];
    if (index === undefined) return undefined;
    return excelText(row[index], field);
  }

  function personPatchFromExcelRow(row, columns) {
    const patch = {};
    Object.keys(columns).forEach((field) => {
      if (field === "role" || field === "status") return;
      const value = valueFromExcelRow(row, columns, field);
      if (value === undefined) return;
      patch[field] = value || null;
    });

    const wpIcNumber = patch.wp_ic_number || "";
    const finNumber = patch.fin_number || "";
    if (columns.wp_ic_last4 === undefined || !patch.wp_ic_last4) {
      patch.wp_ic_last4 = last4(wpIcNumber) || patch.wp_ic_last4 || null;
    }
    if (columns.fin_last4 === undefined || !patch.fin_last4) {
      patch.fin_last4 = last4(finNumber) || patch.fin_last4 || null;
    }
    return patch;
  }

  function extractManualFromName(name) {
    const match = String(name || "").trim().match(/^([A-Za-z]+\s*-?\s*\d+[A-Za-z0-9-]*|\d+[A-Za-z]*)\b/);
    return match ? match[1].replace(/\s+/g, "") : "";
  }

  function setPeopleImportResult(html, good = false, bad = false) {
    const box = $("peopleImportResult");
    if (!box) return;
    box.innerHTML = html;
    box.classList.toggle("good", !!good);
    box.classList.toggle("bad", !!bad);
  }

  async function importPeopleExcel() {
    if (!isEditor()) return toast("Edit PIN needed to upload Excel.", true);
    const fileInput = $("peopleExcelImportFile");
    const file = fileInput && fileInput.files && fileInput.files[0];
    if (!file) return toast("Choose Excel file first.", true);

    const btn = $("importPeopleExcelBtn");
    const done = setBusy(btn, "Reading...");
    try {
      const rows = await readPeopleExcelRows(file);
      const header = findPeopleExcelHeaderRow(rows);
      if (!header) throw new Error("Cannot find NAME column. Please use the name-list Excel format.");

      const byName = new Map();
      const skipped = [];
      for (let i = header.index + 1; i < rows.length; i += 1) {
        const row = rows[i] || [];
        const name = valueFromExcelRow(row, header.columns, "name");
        if (!name) {
          const hasAnyValue = row.some((cell) => excelText(cell));
          if (hasAnyValue) skipped.push(i + 1);
          continue;
        }
        const patch = personPatchFromExcelRow(row, header.columns);
        patch.name = name;
        const roleValue = valueFromExcelRow(row, header.columns, "role");
        const statusValue = valueFromExcelRow(row, header.columns, "status");
        if (roleValue) patch.role = normalizePersonRoleForSave(roleValue);
        if (statusValue) patch.status = normalizeText(statusValue) === "pause" ? "pause" : "active";
        patch.is_archived = false;
        byName.set(normalizeNameKey(name), { excelRow: i + 1, patch });
      }

      const importRows = [...byName.values()];
      if (!importRows.length) throw new Error("No people rows found below the header.");

      const existingByName = new Map(state.people.map((p) => [normalizeNameKey(p.name), p]));
      let updated = 0;
      let inserted = 0;
      const errors = [];

      done();
      const doneSaving = setBusy(btn, "Saving...");
      try {
        for (const row of importRows) {
          const key = normalizeNameKey(row.patch.name);
          const existing = existingByName.get(key);
          if (existing) {
            const patch = { ...row.patch };
            if (!patch.role) delete patch.role;
            if (!patch.status) delete patch.status;
            const { error } = await supabaseClient.from("people").update(patch).eq("id", existing.id);
            if (error) {
              errors.push(`Row ${row.excelRow} ${row.patch.name}: ${error.message}`);
            } else {
              updated += 1;
            }
          } else {
            const patch = {
              manual_no: row.patch.manual_no || extractManualFromName(row.patch.name) || null,
              role: row.patch.role || "Worker",
              status: row.patch.status || "active",
              ...row.patch
            };
            const { error, data } = await supabaseClient.from("people").insert(patch).select("id").single();
            if (error) {
              errors.push(`Row ${row.excelRow} ${row.patch.name}: ${error.message}`);
            } else {
              inserted += 1;
              existingByName.set(key, { ...patch, id: data?.id });
            }
          }
        }
      } finally {
        doneSaving();
      }

      await loadAll();
      const duplicateCount = Math.max(0, (rows.length - header.index - 1 - skipped.length) - importRows.length);
      const goodHtml = `
        <b>Excel import completed.</b><br>
        Updated same NAME: <b>${updated}</b><br>
        Added new NAME: <b>${inserted}</b><br>
        Duplicate NAME rows inside Excel: <b>${duplicateCount}</b> (last row kept)<br>
        Skipped rows without NAME: <b>${skipped.length}</b>
        ${errors.length ? `<br><br><b>Errors:</b><br>${errors.slice(0, 8).map(safeHtml).join("<br>")}${errors.length > 8 ? "<br>..." : ""}` : ""}
      `;
      setPeopleImportResult(goodHtml, errors.length === 0, errors.length > 0);
      toast(`Excel saved. Updated ${updated}, added ${inserted}.`);
    } catch (err) {
      const msg = String(err.message || err || "Cannot import Excel.");
      const extra = /column .* does not exist|schema cache|people_role_check|people_status_check|constraint/i.test(msg)
        ? `<br><br><b>Please run this SQL first:</b><br><code>database/19_V5_9_IMPORT_AND_NAME_LIST_FIX.sql</code>`
        : "";
      setPeopleImportResult(`<b>Excel import failed.</b><br>${safeHtml(msg)}${extra}`, false, true);
      toast(msg, true);
      done();
    }
  }

  function clearPeopleImport() {
    const fileInput = $("peopleExcelImportFile");
    if (fileInput) fileInput.value = "";
    setPeopleImportResult("No Excel uploaded yet.");
  }

  function wpIcExpiryFilteredPeople() {
    const q = normalizeText($("wpicSearch").value);
    const status = $("wpicStatus").value;
    const role = $("wpicRole").value;
    const expiryStatus = $("wpicExpiryStatus").value;

    return state.people.filter((p) => {
      const pStatus = String(p.status || "active").toLowerCase();
      const pRole = String(p.role || "worker").toLowerCase();
      if (status !== "all" && pStatus !== status) return false;
      if (role !== "all" && pRole !== role) return false;
      if (q && !personSearchText(p).includes(q)) return false;
      if (!personMatchesWpIcExpiryFilter(p, expiryStatus)) return false;
      return true;
    }).sort((a, b) => {
      const ai = wpIcExpiryInfo(a);
      const bi = wpIcExpiryInfo(b);
      const ar = ai.rank ?? 999999999;
      const br = bi.rank ?? 999999999;
      if (ar !== br) return ar - br;
      const ad = String(a.wp_ic_expiry_date || "");
      const bd = String(b.wp_ic_expiry_date || "");
      if (ad !== bd) return ad.localeCompare(bd);
      return comparePeople(a, b);
    });
  }

  function renderWpIcExpirySummary(rows) {
    const summary = $("wpicSummary");
    const box = $("wpicExpirySummary");
    if (!summary || !box) return;

    const counts = { total: rows.length, expired: 0, red: 0, yellow: 0, normal: 0, nodate: 0 };
    rows.forEach((p) => {
      const key = wpIcExpiryInfo(p).key;
      counts[key] = (counts[key] || 0) + 1;
    });
    summary.innerHTML = `
      <span class="pill">Total: ${counts.total}</span>
      <span class="pill expired">Black Expired: ${counts.expired}</span>
      <span class="pill red">Red 1-14 days: ${counts.red}</span>
      <span class="pill yellow">Yellow 15-30 days: ${counts.yellow}</span>
      <span class="pill normal">Green &gt;30 days: ${counts.normal}</span>
      <span class="pill nodate">No Date/Text: ${counts.nodate}</span>
    `;

    if (!rows.length) {
      box.innerHTML = `<div class="muted">No WP/IC expiry summary. Filter has no people.</div>`;
      return;
    }

    const groups = new Map();
    rows.forEach((p) => {
      const key = p.wp_ic_expiry_date || "NO_DATE";
      if (!groups.has(key)) groups.set(key, { expiry_date: p.wp_ic_expiry_date || "", people: [] });
      groups.get(key).people.push(p);
    });

    const sortedGroups = [...groups.values()].sort(compareExpiryDateGroups);
    box.innerHTML = `
      <div class="summary-title">WP / IC Expiry Date Summary</div>
      <div class="summary-help">Uses current filter. Black expired, red 1-14 days, yellow 15-30 days, green more than 30 days.</div>
      <div class="expiry-summary-list">
        ${sortedGroups.map((group) => {
          const first = group.people[0];
          const info = expiryInfoFromDate(group.expiry_date);
          const sortedPeople = [...group.people].sort(comparePeople);
          const preview = sortedPeople.slice(0, 8).map((p) => {
            return `${safeHtml(getManualNumber(p) || "-")}. ${safeHtml(p.nickname || p.name || "Unknown")} - ${safeHtml(p.wp_ic_number || "No WP/IC No")}`;
          }).join("<br>");
          const more = sortedPeople.length > 8 ? `<br><b>+${sortedPeople.length - 8} more</b>` : "";
          const dateLabel = group.expiry_date || "No Date / Text";
          return `
            <div class="expiry-summary-card ${safeHtml(info.key)}">
              <div class="expiry-summary-head">
                <b>${safeHtml(dateLabel)}</b>
                <span class="status-pill ${safeHtml(info.key)}">${safeHtml(info.label)}</span>
                <span class="pill">${sortedPeople.length}</span>
              </div>
              <div class="expiry-summary-preview">${preview}${more}</div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderWpIcExpiry() {
    const body = $("wpicBody");
    if (!body) return;
    const rows = wpIcExpiryFilteredPeople();
    renderWpIcExpirySummary(rows);

    body.innerHTML = rows.map((p) => `
      <tr>
        <td><b>${safeHtml(getManualNumber(p))}</b></td>
        <td><div class="person-name">${safeHtml(p.name || "")}</div><div class="person-sub">${safeHtml(p.nickname || "")}</div></td>
        <td>${safeHtml(p.role || "")}</td>
        <td>${statusPill(p.status)}</td>
        <td>${safeHtml(p.wp_ic_number || "-")}</td>
        <td>${safeHtml(p.wp_ic_last4 || last4(p.wp_ic_number) || "-")}</td>
        <td><b>${safeHtml(p.wp_ic_expiry_date || "-")}</b><br>${wpIcExpiryPill(p)}</td>
        <td>
          <div class="person-sub"><b>Company:</b> ${safeHtml(p.company_name || "-")}</div>
          <div class="person-sub"><b>Permit:</b> ${safeHtml(p.permit_type || "-")}</div>
          <div class="person-sub"><b>Occupation:</b> ${safeHtml(p.occupation || "-")}</div>
          <div class="person-sub"><b>Contact:</b> ${safeHtml(p.contact_no || "-")}</div>
        </td>
        <td class="editor-only"><button data-action="edit-person" data-id="${safeHtml(p.id)}">Edit</button></td>
      </tr>
    `).join("") || `<tr><td colspan="9" class="muted">No people found.</td></tr>`;
    showEditorOnly();
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
          <div class="person-sub">WP/IC Exp: ${safeHtml(p.wp_ic_expiry_date || "-")} ${wpIcExpiryPill(p)}</div>
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

  function nameListPickerFilteredRows() {
    const searchEl = $("nameListPickerSearch");
    const statusEl = $("nameListPickerStatus");
    const roleEl = $("nameListPickerRole");
    const keepTopEl = $("nameListShowTickedTop");
    if (!searchEl || !statusEl || !roleEl) return [];
    const q = normalizeText(searchEl.value);
    const status = statusEl.value;
    const role = roleEl.value;
    const keepTop = !keepTopEl || keepTopEl.checked;

    const filtered = state.people.filter((p) => {
      const pStatus = String(p.status || "active").toLowerCase();
      const pRole = String(p.role || "worker").toLowerCase();
      if (status !== "all" && pStatus !== status) return false;
      if (role !== "all" && pRole !== role) return false;
      if (q && !personSearchText(p).includes(q)) return false;
      return true;
    }).sort(comparePeopleByNickname);

    if (!keepTop) return filtered;
    const pinned = [...nameListSelectedPeople].map(getPerson).filter(Boolean).sort(comparePeopleByNickname);
    const all = [...pinned, ...filtered.filter((p) => !nameListSelectedPeople.has(String(p.id)))];
    return all;
  }

  function renderNameListPicker() {
    const body = $("nameListPickerBody");
    if (!body) return;
    const rows = nameListPickerFilteredRows();
    state.visibleNameListPeople = rows;
    const count = $("nameListSelectedCount");
    if (count) count.textContent = `${nameListSelectedPeople.size} selected`;
    body.innerHTML = rows.map((p) => {
      const checked = nameListSelectedPeople.has(String(p.id));
      return `
        <tr class="${checked ? "selected-row" : ""}">
          <td><input type="checkbox" data-action="name-list-toggle-person" data-id="${safeHtml(p.id)}" ${checked ? "checked" : ""}></td>
          <td><div class="nickname-cell">${safeHtml(p.nickname || "-")}</div></td>
          <td><div class="person-name">${safeHtml(p.name || "")}</div></td>
          <td><b>${safeHtml(getManualNumber(p))}</b></td>
          <td>${statusPill(p.status)}</td>
          <td>${safeHtml(p.role || "")}</td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="6" class="muted">No people found. Try search nickname or change status.</td></tr>`;
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
      nameListSelectedPeople.delete(String(id));
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
    ["downloadPeopleSearch", "downloadPeopleStatus", "downloadPeopleRole", "downloadMatchMode", "downloadOnlyWithFile"].forEach((id) => $(id).addEventListener("input", () => { renderDownloadPeople(); renderDownloadSummary(); }));
    $("downloadTickVisibleTypesBtn").addEventListener("click", () => { state.visibleDownloadTypes.forEach((t) => downloadSelectedTypes.add(makeTypeKey(t.category, t.name))); renderDownloadTypes(); renderDownloadPeople(); renderDownloadSummary(); });
    $("downloadUntickVisibleTypesBtn").addEventListener("click", () => { state.visibleDownloadTypes.forEach((t) => downloadSelectedTypes.delete(makeTypeKey(t.category, t.name))); renderDownloadTypes(); renderDownloadPeople(); renderDownloadSummary(); });
    $("downloadClearTypesBtn").addEventListener("click", () => { downloadSelectedTypes.clear(); renderDownloadTypes(); renderDownloadPeople(); renderDownloadSummary(); });
    $("downloadTickVisiblePeopleBtn").addEventListener("click", () => { state.visibleDownloadPeople.forEach((p) => downloadSelectedPeople.add(String(p.id))); renderDownloadPeople(); renderDownloadSummary(); });
    $("downloadUntickVisiblePeopleBtn").addEventListener("click", () => { state.visibleDownloadPeople.forEach((p) => downloadSelectedPeople.delete(String(p.id))); renderDownloadPeople(); renderDownloadSummary(); });
    $("downloadClearPeopleBtn").addEventListener("click", () => { downloadSelectedPeople.clear(); renderDownloadPeople(); renderDownloadSummary(); });
    $("downloadByTypeBtn").addEventListener("click", downloadSelectedTypeZip);
    $("downloadExportPeopleExcelBtn").addEventListener("click", () => exportPeopleNameListExcel(false, true, downloadSelectedPeople));

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

    ["wpicSearch", "wpicStatus", "wpicRole", "wpicExpiryStatus"].forEach((id) => {
      if ($(id)) $(id).addEventListener("input", renderWpIcExpiry);
    });
    if ($("resetWpicFiltersBtn")) $("resetWpicFiltersBtn").addEventListener("click", () => {
      $("wpicSearch").value = "";
      $("wpicStatus").value = "active";
      $("wpicRole").value = "all";
      $("wpicExpiryStatus").value = "all";
      renderWpIcExpiry();
    });

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
    if ($("importPeopleExcelBtn")) $("importPeopleExcelBtn").addEventListener("click", importPeopleExcel);
    if ($("clearPeopleImportBtn")) $("clearPeopleImportBtn").addEventListener("click", clearPeopleImport);
    ["nameListPickerSearch", "nameListPickerStatus", "nameListPickerRole", "nameListShowTickedTop"].forEach((id) => { if ($(id)) $(id).addEventListener("input", renderNameListPicker); });
    if ($("nameListTickVisibleBtn")) $("nameListTickVisibleBtn").addEventListener("click", () => { state.visibleNameListPeople.forEach((p) => nameListSelectedPeople.add(String(p.id))); renderNameListPicker(); });
    if ($("nameListUntickVisibleBtn")) $("nameListUntickVisibleBtn").addEventListener("click", () => { state.visibleNameListPeople.forEach((p) => nameListSelectedPeople.delete(String(p.id))); renderNameListPicker(); });
    if ($("nameListClearSelectedBtn")) $("nameListClearSelectedBtn").addEventListener("click", () => { nameListSelectedPeople.clear(); renderNameListPicker(); });
    if ($("nameListExportSelectedBtn")) $("nameListExportSelectedBtn").addEventListener("click", () => exportPeopleNameListExcel(false, true, nameListSelectedPeople));
    ["peopleSearch", "peopleStatusFilter"].forEach((id) => $(id).addEventListener("input", () => { renderPeople(); renderNameListPicker(); }));

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
      if (action === "name-list-toggle-person") {
        if (el.checked) nameListSelectedPeople.add(String(id));
        else nameListSelectedPeople.delete(String(id));
        renderNameListPicker();
      }
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
