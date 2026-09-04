// ============================================================
// THE BALLOT — app logic
// Shared state lives in a jsonbin.io bin (see config.js).
// ============================================================

const API_BASE = `https://api.jsonbin.io/v3/b/${CONFIG.JSONBIN_BIN_ID}`;
const EMPTY_STATE = { events: [], dressCode: { options: [] }, decorations: [], itemsNeeded: [], adminPassword: null, auditLog: [] };

let state = structuredClone(EMPTY_STATE);
let myName = "";
let isAdmin = sessionStorage.getItem("ballot_admin") === "1";
let pollTimer = null;
let saving = false;
let expandedSuggPanels = new Set();
let expandedDecorSuggPanels = new Set();

// ============================================================
// Predefined allowed names
// ============================================================
const ALLOWED_NAMES = [
  "Abdul Hannan", "Adan Fatima", "Ali Amir", "Alishba Rafi", "Amna Arshad",
  "Anass Shafi Shahid", "Azbah Naveed", "Hammad Ijaz", "Huda Shahzadi",
  "Mahnoor Asmat", "Malik Alizan Zawar", "Manahil Umar", "Muhammad Abdullah",
  "Muhammad Abdullah Shahbaz", "Muhammad Awais Afzal", "Muhammad Hamza Qamar",
  "Muhammad Junaid Dhillon", "Muhammad Moaaz", "Muhammad Sobhan Chattha",
  "Muhammad Uzair", "Noor Ul Ain", "Rehan Ullah Khan", "Syeda Malaika",
  "Tayyaba Sohail", "Mohid Sadiq", "Eshal Amir"
];

// ============================================================
// Smart name matching logic
// ============================================================
function parseNameParts(fullName) {
  const parts = fullName.trim().toLowerCase().split(/\s+/);
  return { full: parts.join(""), parts, first: parts[0] || "", last: parts[parts.length - 1] || "" };
}

function findMatchingNames(input) {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return { matches: [], needsFullName: false, notInList: false };

  const inputParts = trimmed.split(/\s+/);
  const inputFull = trimmed.replace(/\s+/g, "");

  for (const name of ALLOWED_NAMES) {
    const np = parseNameParts(name);

    // Exact full match (with or without spaces)
    if (np.full === inputFull || name.toLowerCase() === trimmed) {
      return { exactMatch: name, matches: [name], needsFullName: false, notInList: false };
    }

    // Single word input — match any part of the name
    if (inputParts.length === 1 && np.parts.includes(inputParts[0])) {
      return { exactMatch: name, matches: [name], needsFullName: false, notInList: false };
    }

    // Multi-word input — first name must match, then remaining parts must all exist
    if (inputParts.length >= 2 && np.first === inputParts[0]) {
      const remaining = inputParts.slice(1);
      if (remaining.every(rp => np.parts.includes(rp))) {
        return { exactMatch: name, matches: [name], needsFullName: false, notInList: false };
      }
    }
  }

  return { matches: [], needsFullName: false, notInList: true };
}

function validateName(input) {
  const result = findMatchingNames(input);

  if (result.exactMatch) {
    return { valid: true, name: result.exactMatch };
  }

  return { valid: false, message: "You are not in the selected list" };
}

// ---------- DOM refs ----------
const el = (id) => document.getElementById(id);
const eventsContainer = el("eventsContainer");
const dressContainer = el("dressContainer");
const decorContainer = el("decorContainer");
const itemsContainer = el("itemsContainer");
const statusLine = el("statusLine");
const whoDisplay = el("whoDisplay");
const adminBtn = el("adminBtn");
const dashboardBtn = el("dashboardBtn");

// ============================================================
// Remote storage
// ============================================================
function normalize(record) {
  record = record || {};
  record.events = record.events || [];
  record.events.forEach((ev) => {
    ev.activities = ev.activities || [];
    ev.activities.forEach((act) => {
      act.yesVoters = act.yesVoters || [];
      act.noVoters = act.noVoters || [];
      act.suggestions = (act.suggestions || []).map((sg) => ({
        ...sg,
        upVoters: sg.upVoters || sg.voters || [],
        downVoters: sg.downVoters || []
      }));
    });
  });
  record.dressCode = record.dressCode || { options: [] };
  record.dressCode.options = record.dressCode.options || [];
  record.dressCode.options.forEach((opt) => {
    opt.voters = opt.voters || [];
  });
  record.decorations = (record.decorations || []).map((cat) => ({
    ...cat,
    // migrate old name → new name
    name: cat.name === "Suggestion Box" ? "Feedback Box" : cat.name,
    ideas: (cat.ideas || []).map((idea) => ({
      ...idea,
      yesVoters: idea.yesVoters || [],
      noVoters: idea.noVoters || [],
      suggestions: (idea.suggestions || []).map((sg) => ({
        ...sg,
        upVoters: sg.upVoters || sg.voters || [],
        downVoters: sg.downVoters || []
      }))
    }))
  }));
  record.itemsNeeded = (record.itemsNeeded || []).map((cat) => ({
    ...cat,
    items: (cat.items || []).map((item) => ({
      ...item,
      checked: item.checked || false
    }))
  }));
  record.adminPassword = record.adminPassword || null;
  record.auditLog = (record.auditLog || []).map((entry) => ({
    id: entry.id || uid(),
    type: entry.type || "unknown",
    user: entry.user || "",
    details: entry.details || "",
    timestamp: entry.timestamp || ""
  }));
  return record;
}

async function fetchState() {
  const res = await fetch(`${API_BASE}/latest`, {
    headers: { "X-Master-Key": CONFIG.JSONBIN_API_KEY }
  });
  if (!res.ok) throw new Error("Could not load data");
  const json = await res.json();
  return normalize(json.record || EMPTY_STATE);
}

async function saveState(newState) {
  saving = true;
  try {
    const res = await fetch(API_BASE, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": CONFIG.JSONBIN_API_KEY
      },
      body: JSON.stringify(newState)
    });
    if (!res.ok) throw new Error("Save failed");
    state = newState;
  } catch (e) {
    setStatus("Couldn't save — check your connection");
  } finally {
    saving = false;
  }
}

async function refresh(silent) {
  try {
    if (!silent) setStatus("Loading…");
    state = await fetchState();
    setStatus("");
    render();
  } catch (e) {
    setStatus(e.message);
  }
}

async function mutate(fn) {
  try {
    setStatus("Saving…");
    const fresh = await fetchState();
    fn(fresh);
    await saveState(fresh);
    render();
  } catch (e) {
    setStatus("Something went wrong — try again.");
  }
}

function mutateOptimistic(fn) {
  fn(state);
  render();
  saving = true;
  fetch(API_BASE, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "X-Master-Key": CONFIG.JSONBIN_API_KEY
    },
    body: JSON.stringify(state)
  }).then((res) => {
    if (!res.ok) throw new Error();
    saving = false;
  }).catch(() => {
    saving = false;
    setStatus("Save failed — reconnecting…");
    refresh(true);
  });
}

function setStatus(msg) {
  statusLine.textContent = msg;
}

// ============================================================
// Identity & Audit Logging
// ============================================================
function uid() {
  return Math.random().toString(36).slice(2, 10);
}

async function recordAuditLog(entry) {
  const now = new Date();
  const timeStr = now.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " at " + now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true });

  const logItem = {
    id: uid(),
    timestamp: timeStr,
    ...entry
  };

  // Prepend to local state immediately
  state.auditLog = state.auditLog || [];
  state.auditLog.unshift(logItem);
  if (state.auditLog.length > 200) state.auditLog = state.auditLog.slice(0, 200);

  // If dashboard is currently open, refresh view immediately
  if (isAdmin && !el("dashboardOverlay").classList.contains("hidden")) {
    renderDashboard();
  }

  // Persist to remote storage
  try {
    const fresh = await fetchState();
    fresh.auditLog = fresh.auditLog || [];
    fresh.auditLog.unshift(logItem);
    if (fresh.auditLog.length > 200) fresh.auditLog = fresh.auditLog.slice(0, 200);
    await saveState(fresh);
    state = fresh;
    if (isAdmin && !el("dashboardOverlay").classList.contains("hidden")) {
      renderDashboard();
    }
  } catch (e) {
    console.error("Failed to persist audit log:", e);
  }
}

function clearAuditLog() {
  if (!confirm("Are you sure you want to clear all audit logs?")) return;
  mutate((s) => {
    s.auditLog = [];
  });
}
window.clearAuditLog = clearAuditLog;

function ensureName(cb) {
  if (myName) return cb();
  const overlay = el("nameOverlay");
  const input = el("nameInput");
  const msgEl = el("nameMessage");
  const suggEl = el("nameSuggestions");
  const memeBox = el("nameMemeBox");

  overlay.classList.remove("hidden");
  input.value = "";
  msgEl.textContent = "";
  msgEl.style.color = "var(--ink-soft)";
  suggEl.innerHTML = "";
  input.style.borderColor = "";
  memeBox.style.display = "none";

  const finish = () => {
    const val = input.value.trim();
    if (!val) return;

    const result = validateName(val);

    if (result.valid) {
      myName = result.name;
      memeBox.style.display = "none";
      overlay.classList.add("hidden");
      updateWhoDisplay();
      cb();
    } else {
      msgEl.textContent = "";
      msgEl.style.color = "var(--no)";
      input.style.borderColor = "var(--no)";
      memeBox.style.display = "block";
      recordAuditLog({
        type: "wrong_name",
        user: val,
        details: `Entered name "${val}" (not on the allowed list)`
      });
      input.value = "";
      input.focus();
    }
  };

  el("nameSaveBtn").onclick = finish;
  input.onkeydown = (e) => { if (e.key === "Enter") finish(); };
  input.focus();
}

function updateWhoDisplay() {
  whoDisplay.innerHTML = myName ? `Voting as <b>${escapeHtml(myName)}</b>` : "";
  if (isAdmin) whoDisplay.innerHTML += `<span class="admin-tag">ADMIN</span>`;
  adminBtn.textContent = isAdmin ? "Log out admin" : "Admin";
  dashboardBtn.classList.toggle("hidden", !isAdmin);
}

// ============================================================
// Generic prompt modal
// ============================================================
function showPrompt(title, hint, fields, onSubmit) {
  el("promptTitle").textContent = title;
  el("promptHint").textContent = hint;
  const container = el("promptFields");
  container.innerHTML = fields.map((f) =>
    `<input type="text" id="pf_${f.id}" placeholder="${escapeHtml(f.placeholder || "")}" />`
  ).join("");
  el("promptOverlay").classList.remove("hidden");
  const firstInput = container.querySelector("input");
  if (firstInput) firstInput.focus();
  const close = () => el("promptOverlay").classList.add("hidden");
  el("promptCancelBtn").onclick = close;
  const submit = () => {
    const values = {};
    let valid = true;
    fields.forEach((f) => {
      const v = el(`pf_${f.id}`).value.trim();
      if (f.required !== false && !v) valid = false;
      values[f.id] = v;
    });
    if (!valid) return;
    close();
    onSubmit(values);
  };
  el("promptOkBtn").onclick = submit;
  container.querySelectorAll("input").forEach((inp) => {
    inp.onkeydown = (e) => { if (e.key === "Enter") submit(); };
  });
}

// ============================================================
// Admin
// ============================================================
const ADMIN_NAMES = ["Muhammad Awais Afzal", "Abdul Hannan"];

adminBtn.onclick = () => {
  if (isAdmin) {
    isAdmin = false;
    sessionStorage.removeItem("ballot_admin");
    el("dashboardOverlay").classList.add("hidden");
    updateWhoDisplay();
    render();
    return;
  }
  if (!ADMIN_NAMES.includes(myName)) {
    el("notAdminOverlay").classList.remove("hidden");
    recordAuditLog({
      type: "admin_attempt",
      user: myName || "(No name entered)",
      details: "Pressed the Admin button"
    });
    return;
  }
  el("adminOverlay").classList.remove("hidden");
  el("adminPassInput").value = "";
  el("adminPassInput").style.borderColor = "";
  if (el("adminWrongPassBox")) el("adminWrongPassBox").style.display = "none";
  el("adminPassInput").focus();
};
el("adminCancelBtn").onclick = () => {
  el("adminOverlay").classList.add("hidden");
  if (el("adminWrongPassBox")) el("adminWrongPassBox").style.display = "none";
  el("adminPassInput").style.borderColor = "";
};
el("adminLoginBtn").onclick = tryAdminLogin;
el("adminPassInput").onkeydown = (e) => { if (e.key === "Enter") tryAdminLogin(); };

dashboardBtn.onclick = () => {
  if (!isAdmin) return;
  renderDashboard();
  el("dashboardOverlay").classList.remove("hidden");
};
el("dashboardCloseBtn").onclick = () => el("dashboardOverlay").classList.add("hidden");
el("changePassBtn").onclick = changeAdminPassword;

function tryAdminLogin() {
  const val = el("adminPassInput").value;
  const correctPass = state.adminPassword || CONFIG.ADMIN_PASSWORD;
  if (val === correctPass) {
    isAdmin = true;
    sessionStorage.setItem("ballot_admin", "1");
    el("adminOverlay").classList.add("hidden");
    if (el("adminWrongPassBox")) el("adminWrongPassBox").style.display = "none";
    updateWhoDisplay();
    render();
  } else {
    el("adminPassInput").style.borderColor = "var(--no)";
    if (el("adminWrongPassBox")) el("adminWrongPassBox").style.display = "block";
    recordAuditLog({
      type: "wrong_password",
      user: myName || "(No name entered)",
      details: "Entered incorrect admin password"
    });
    el("adminPassInput").value = "";
    el("adminPassInput").focus();
  }
}

function changeAdminPassword() {
  if (!isAdmin) return;
  showPrompt(
    "Change admin password",
    "This replaces the password everyone must use to log in as admin.",
    [{ id: "pass", placeholder: "New admin password" }],
    (v) => {
      mutate((s) => { s.adminPassword = v.pass; });
      setStatus("Admin password updated.");
    }
  );
}

// ============================================================
// Sorting
// ============================================================
function sortByScore(arr, scoreFn) {
  return arr
    .map((item, i) => ({ item, i, score: scoreFn(item) }))
    .sort((a, b) => (b.score - a.score) || (a.i - b.i))
    .map((x) => x.item);
}
const activityScore = (a) => a.yesVoters.length - a.noVoters.length;
const suggestionScore = (sg) => sg.upVoters.length - sg.downVoters.length;
const dressScore = (opt) => opt.voters.length;
const decorIdeaScore = (idea) => idea.yesVoters.length - idea.noVoters.length;

// ============================================================
// Actions — Events & Activities
// ============================================================
el("addEventBtn").onclick = () => ensureName(() => {
  showPrompt("Add a heading", "e.g. \"Saturday Night\" or \"Team Offsite\"", [
    { id: "heading", placeholder: "Heading" }
  ], (v) => {
    mutate((s) => {
      s.events.push({ id: uid(), heading: v.heading, addedBy: myName, activities: [] });
    });
  });
});

function addActivity(eventId) {
  ensureName(() => {
    showPrompt("Add an activity", "Everyone will be able to vote yes or no.", [
      { id: "name", placeholder: "Activity name" }
    ], (v) => {
      mutate((s) => {
        const ev = s.events.find((e) => e.id === eventId);
        if (!ev) return;
        ev.activities.push({
          id: uid(), name: v.name, addedBy: myName,
          yesVoters: [], noVoters: [], suggestions: []
        });
      });
    });
  });
}

function deleteEvent(eventId) {
  if (!confirm("Delete this whole heading and its activities?")) return;
  mutate((s) => { s.events = s.events.filter((e) => e.id !== eventId); });
}

function deleteActivity(eventId, activityId) {
  if (!confirm("Delete this activity?")) return;
  mutate((s) => {
    const ev = s.events.find((e) => e.id === eventId);
    if (!ev) return;
    ev.activities = ev.activities.filter((a) => a.id !== activityId);
  });
}

function voteActivity(eventId, activityId, choice) {
  ensureName(() => {
    mutateOptimistic((s) => {
      const ev = s.events.find((e) => e.id === eventId);
      const act = ev && ev.activities.find((a) => a.id === activityId);
      if (!act) return;
      const inYes = act.yesVoters.includes(myName);
      const inNo = act.noVoters.includes(myName);
      act.yesVoters = act.yesVoters.filter((n) => n !== myName);
      act.noVoters = act.noVoters.filter((n) => n !== myName);
      if (choice === "yes" && !inYes) act.yesVoters.push(myName);
      if (choice === "no" && !inNo) act.noVoters.push(myName);
    });
  });
}

// ============================================================
// Actions — Suggestions
// ============================================================
function addSuggestion(eventId, activityId) {
  ensureName(() => {
    showPrompt("Add a suggestion", "A specific idea for this activity — others can upvote or downvote it.", [
      { id: "text", placeholder: "Suggestion" }
    ], (v) => {
      mutate((s) => {
        const ev = s.events.find((e) => e.id === eventId);
        const act = ev && ev.activities.find((a) => a.id === activityId);
        if (!act) return;
        act.suggestions.push({ id: uid(), text: v.text, addedBy: myName, upVoters: [], downVoters: [] });
      });
    });
  });
}

function voteSuggestion(eventId, activityId, suggId, dir) {
  ensureName(() => {
    mutateOptimistic((s) => {
      const ev = s.events.find((e) => e.id === eventId);
      const act = ev && ev.activities.find((a) => a.id === activityId);
      const sugg = act && act.suggestions.find((x) => x.id === suggId);
      if (!sugg) return;
      const inUp = sugg.upVoters.includes(myName);
      const inDown = sugg.downVoters.includes(myName);
      sugg.upVoters = sugg.upVoters.filter((n) => n !== myName);
      sugg.downVoters = sugg.downVoters.filter((n) => n !== myName);
      if (dir === "up" && !inUp) sugg.upVoters.push(myName);
      if (dir === "down" && !inDown) sugg.downVoters.push(myName);
    });
  });
}

function deleteSuggestion(eventId, activityId, suggId) {
  if (!confirm("Delete this suggestion?")) return;
  mutate((s) => {
    const ev = s.events.find((e) => e.id === eventId);
    const act = ev && ev.activities.find((a) => a.id === activityId);
    if (!act) return;
    act.suggestions = act.suggestions.filter((x) => x.id !== suggId);
  });
}

// ============================================================
// Actions — Dress code
// ============================================================
el("addDressBtn").onclick = () => ensureName(() => {
  showPrompt("Add a dressing option", "e.g. \"Black tie\" or \"Casual\"", [
    { id: "name", placeholder: "Dress option" }
  ], (v) => {
    mutate((s) => {
      s.dressCode.options.push({ id: uid(), name: v.name, addedBy: myName, voters: [] });
    });
  });
});

function voteDress(optId) {
  ensureName(() => {
    mutateOptimistic((s) => {
      const opt = s.dressCode.options.find((o) => o.id === optId);
      if (!opt) return;
      if (opt.voters.includes(myName)) opt.voters = opt.voters.filter((n) => n !== myName);
      else opt.voters.push(myName);
    });
  });
}

function deleteDress(optId) {
  if (!confirm("Delete this dressing option?")) return;
  mutate((s) => { s.dressCode.options = s.dressCode.options.filter((o) => o.id !== optId); });
}

// ============================================================
// Actions — Decorations (categories → ideas with yes/no vote)
// ============================================================
el("addDecorBtn").onclick = () => ensureName(() => {
  showPrompt("Add a decoration category", "e.g. \"Stage Decor\", \"Entrance\", \"Lighting\"", [
    { id: "name", placeholder: "Category name" }
  ], (v) => {
    mutate((s) => {
      s.decorations.push({ id: uid(), name: v.name, addedBy: myName, ideas: [] });
    });
  });
});

function addDecorIdea(catId) {
  ensureName(() => {
    showPrompt("Add a decoration idea", "Everyone will be able to vote yes or no.", [
      { id: "name", placeholder: "Decoration idea" }
    ], (v) => {
      mutate((s) => {
        const cat = s.decorations.find((c) => c.id === catId);
        if (!cat) return;
        cat.ideas.push({
          id: uid(), name: v.name, addedBy: myName,
          yesVoters: [], noVoters: []
        });
      });
    });
  });
}

function deleteDecorCat(catId) {
  if (!confirm("Delete this decoration category and all its ideas?")) return;
  mutate((s) => { s.decorations = s.decorations.filter((c) => c.id !== catId); });
}

function voteDecorIdea(catId, ideaId, choice) {
  ensureName(() => {
    mutateOptimistic((s) => {
      const cat = s.decorations.find((c) => c.id === catId);
      const idea = cat && cat.ideas.find((i) => i.id === ideaId);
      if (!idea) return;
      const inYes = idea.yesVoters.includes(myName);
      const inNo = idea.noVoters.includes(myName);
      idea.yesVoters = idea.yesVoters.filter((n) => n !== myName);
      idea.noVoters = idea.noVoters.filter((n) => n !== myName);
      if (choice === "yes" && !inYes) idea.yesVoters.push(myName);
      if (choice === "no" && !inNo) idea.noVoters.push(myName);
    });
  });
}

function deleteDecorIdea(catId, ideaId) {
  if (!confirm("Delete this decoration idea?")) return;
  mutate((s) => {
    const cat = s.decorations.find((c) => c.id === catId);
    if (!cat) return;
    cat.ideas = cat.ideas.filter((i) => i.id !== ideaId);
  });
}

// ============================================================
// Actions — Decoration Suggestions
// ============================================================
function addDecorSugg(catId, ideaId) {
  ensureName(() => {
    showPrompt("Add a suggestion", "A specific idea for this decoration — others can upvote or downvote it.", [
      { id: "text", placeholder: "Suggestion" }
    ], (v) => {
      mutate((s) => {
        const cat = s.decorations.find((c) => c.id === catId);
        const idea = cat && cat.ideas.find((i) => i.id === ideaId);
        if (!idea) return;
        idea.suggestions.push({ id: uid(), text: v.text, addedBy: myName, upVoters: [], downVoters: [] });
      });
    });
  });
}

function voteDecorSugg(catId, ideaId, suggId, dir) {
  ensureName(() => {
    mutateOptimistic((s) => {
      const cat = s.decorations.find((c) => c.id === catId);
      const idea = cat && cat.ideas.find((i) => i.id === ideaId);
      const sugg = idea && idea.suggestions.find((x) => x.id === suggId);
      if (!sugg) return;
      const inUp = sugg.upVoters.includes(myName);
      const inDown = sugg.downVoters.includes(myName);
      sugg.upVoters = sugg.upVoters.filter((n) => n !== myName);
      sugg.downVoters = sugg.downVoters.filter((n) => n !== myName);
      if (dir === "up" && !inUp) sugg.upVoters.push(myName);
      if (dir === "down" && !inDown) sugg.downVoters.push(myName);
    });
  });
}

function deleteDecorSugg(catId, ideaId, suggId) {
  if (!confirm("Delete this suggestion?")) return;
  mutate((s) => {
    const cat = s.decorations.find((c) => c.id === catId);
    const idea = cat && cat.ideas.find((i) => i.id === ideaId);
    if (!idea) return;
    idea.suggestions = idea.suggestions.filter((x) => x.id !== suggId);
  });
}

function toggleDecorSuggPanel(ideaId) {
  const panel = document.getElementById(`dsugg-${ideaId}`);
  if (!panel) return;
  if (panel.classList.contains("hidden")) {
    expandedDecorSuggPanels.add(ideaId);
    panel.classList.remove("hidden");
  } else {
    expandedDecorSuggPanels.delete(ideaId);
    panel.classList.add("hidden");
  }
}

// ============================================================
// Actions — Items Needed
// ============================================================
el("addItemBtn").onclick = () => ensureName(() => {
  showPrompt("Add an item", "e.g. \"Projector\", \"Speaker system\", \"Decoration lights\"", [
    { id: "name", placeholder: "Item name" },
    { id: "qty", placeholder: "Quantity (optional)", required: false }
  ], (v) => {
    mutate((s) => {
      // Find or create "General" category
      let cat = s.itemsNeeded.find((c) => c.name === "General");
      if (!cat) {
        cat = { id: uid(), name: "General", addedBy: myName, items: [] };
        s.itemsNeeded.push(cat);
      }
      cat.items.push({
        id: uid(), name: v.name, qty: v.qty || "", addedBy: myName, checked: false
      });
    });
  });
});

function addItemCategory() {
  ensureName(() => {
    showPrompt("Add items category", "e.g. \"Decorations\", \"Food & Drinks\", \"Equipment\"", [
      { id: "name", placeholder: "Category name" }
    ], (v) => {
      mutate((s) => {
        s.itemsNeeded.push({ id: uid(), name: v.name, addedBy: myName, items: [] });
      });
    });
  });
}

function toggleItemChecked(catId, itemId) {
  mutateOptimistic((s) => {
    const cat = s.itemsNeeded.find((c) => c.id === catId);
    const item = cat && cat.items.find((i) => i.id === itemId);
    if (!item) return;
    item.checked = !item.checked;
  });
}

function deleteItem(catId, itemId) {
  if (!confirm("Delete this item?")) return;
  mutate((s) => {
    const cat = s.itemsNeeded.find((c) => c.id === catId);
    if (!cat) return;
    cat.items = cat.items.filter((i) => i.id !== itemId);
  });
}

function deleteItemCat(catId) {
  if (!confirm("Delete this category and all its items?")) return;
  mutate((s) => { s.itemsNeeded = s.itemsNeeded.filter((c) => c.id !== catId); });
}

function toggleSuggPanel(actId) {
  const panel = document.getElementById(`sugg-${actId}`);
  if (!panel) return;
  if (panel.classList.contains("hidden")) {
    expandedSuggPanels.add(actId);
    panel.classList.remove("hidden");
  } else {
    expandedSuggPanels.delete(actId);
    panel.classList.add("hidden");
  }
}

// ============================================================
// Rendering
// ============================================================
function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function adminNote(addedBy) {
  return isAdmin ? `<span class="event-meta">added by ${escapeHtml(addedBy)}</span>` : "";
}

function render() {
  updateWhoDisplay();
  renderEvents();
  renderDress();
  renderDecorations();
  renderItems();
  if (isAdmin && !el("dashboardOverlay").classList.contains("hidden")) renderDashboard();
}

function renderEvents() {
  if (!state.events.length) {
    eventsContainer.innerHTML = `<div class="empty">No activities yet. Add a heading to get started.</div>`;
    return;
  }
  eventsContainer.innerHTML = state.events.map((ev, idx) => {
    const sortedActivities = sortByScore(ev.activities, activityScore);
    return `
    <div class="event">
      <div class="event-head">
        <div>
          <p class="event-num">Event ${String(idx + 1).padStart(2, "0")}</p>
          <h3>${escapeHtml(ev.heading)}</h3>
          ${adminNote(ev.addedBy)}
        </div>
        <div class="event-actions">
          <button class="btn small" onclick="addActivity('${ev.id}')">+ Add activity</button>
          ${isAdmin ? `<button class="btn small danger" onclick="deleteEvent('${ev.id}')">Delete</button>` : ""}
        </div>
      </div>
      ${sortedActivities.length === 0
        ? `<div class="empty" style="margin-top:10px;">No activities under this heading yet.</div>`
        : sortedActivities.map((act, i) => renderActivity(ev.id, act, i === 0 && activityScore(act) > 0)).join("")}
    </div>
  `;
  }).join("");
}

function renderActivity(eventId, act, isTop) {
  const yesN = act.yesVoters.length, noN = act.noVoters.length;
  const yesActive = myName && act.yesVoters.includes(myName);
  const noActive = myName && act.noVoters.includes(myName);
  const suggId = `sugg-${act.id}`;
  const sortedSuggestions = sortByScore(act.suggestions, suggestionScore);
  const suggExpanded = expandedSuggPanels.has(act.id);

  return `
    <div class="activity">
      <div class="activity-row">
        <div>
          <div class="activity-name">${escapeHtml(act.name)} ${isTop ? `<span class="top-badge">Top pick</span>` : ""}</div>
          ${isAdmin ? `<div class="activity-meta">added by ${escapeHtml(act.addedBy)}${yesN||noN ? " · " : ""}${yesN ? `yes: ${act.yesVoters.map(escapeHtml).join(", ")}` : ""}${yesN && noN ? " · " : ""}${noN ? `no: ${act.noVoters.map(escapeHtml).join(", ")}` : ""}</div>` : ""}
        </div>
        <div class="vote-group">
          <button class="vote-btn yes ${yesActive ? "active" : ""}" onclick="voteActivity('${eventId}','${act.id}','yes')">
            Yes <span class="count">${yesN}</span>
          </button>
          <button class="vote-btn no ${noActive ? "active" : ""}" onclick="voteActivity('${eventId}','${act.id}','no')">
            No <span class="count">${noN}</span>
          </button>
          ${isAdmin ? `<button class="btn small danger" onclick="deleteActivity('${eventId}','${act.id}')">Delete</button>` : ""}
        </div>
      </div>
      <div class="suggestions">
        <button class="suggestions-toggle" onclick="toggleSuggPanel('${act.id}')">
          ${act.suggestions.length} suggestion${act.suggestions.length === 1 ? "" : "s"} — view / add
        </button>
        <div id="${suggId}" class="${suggExpanded ? '' : 'hidden'}">
          <div class="sugg-list">
            ${sortedSuggestions.map((sg) => renderSuggestion(eventId, act.id, sg)).join("")}
          </div>
          <div class="add-inline">
            <button class="btn small gold" onclick="addSuggestion('${eventId}','${act.id}')">+ Add suggestion</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderSuggestion(eventId, activityId, sg) {
  const upActive = myName && sg.upVoters.includes(myName);
  const downActive = myName && sg.downVoters.includes(myName);
  const score = sg.upVoters.length - sg.downVoters.length;
  return `
    <div class="sugg-item">
      <div class="sugg-text">
        ${escapeHtml(sg.text)}
        ${isAdmin ? `<span class="sugg-meta">added by ${escapeHtml(sg.addedBy)}${sg.upVoters.length ? " · up: " + sg.upVoters.map(escapeHtml).join(", ") : ""}${sg.downVoters.length ? " · down: " + sg.downVoters.map(escapeHtml).join(", ") : ""}</span>` : ""}
      </div>
      <div class="sugg-vote-group">
        <button class="sugg-vote up ${upActive ? "active" : ""}" onclick="voteSuggestion('${eventId}','${activityId}','${sg.id}','up')">▲ ${sg.upVoters.length}</button>
        <span class="sugg-score">${score > 0 ? "+" + score : score}</span>
        <button class="sugg-vote down ${downActive ? "active" : ""}" onclick="voteSuggestion('${eventId}','${activityId}','${sg.id}','down')">▼ ${sg.downVoters.length}</button>
        ${isAdmin ? `<button class="btn ghost small" onclick="deleteSuggestion('${eventId}','${activityId}','${sg.id}')">✕</button>` : ""}
      </div>
    </div>
  `;
}

function renderDress() {
  if (!state.dressCode.options.length) {
    dressContainer.innerHTML = `<div class="empty">No dressing options yet. Add one to get started.</div>`;
    return;
  }
  const sortedOptions = sortByScore(state.dressCode.options, dressScore);
  dressContainer.innerHTML = sortedOptions.map((opt, i) => {
    const active = myName && opt.voters.includes(myName);
    const isTop = i === 0 && dressScore(opt) > 0;
    return `
      <div class="dress-item">
        <div>
          <div class="activity-name">${escapeHtml(opt.name)} ${isTop ? `<span class="top-badge">Leading</span>` : ""}</div>
          ${isAdmin ? `<div class="activity-meta">added by ${escapeHtml(opt.addedBy)}${opt.voters.length ? " · votes: " + opt.voters.map(escapeHtml).join(", ") : ""}</div>` : ""}
        </div>
        <div class="vote-group">
          <button class="vote-btn yes ${active ? "active" : ""}" onclick="voteDress('${opt.id}')">
            Vote <span class="count">${opt.voters.length}</span>
          </button>
          ${isAdmin ? `<button class="btn small danger" onclick="deleteDress('${opt.id}')">Delete</button>` : ""}
        </div>
      </div>
    `;
  }).join("");
}

function renderDecorations() {
  if (!state.decorations.length) {
    decorContainer.innerHTML = `<div class="empty">No decoration categories yet. Add one to get started.</div>`;
    return;
  }
  decorContainer.innerHTML = state.decorations.map((cat, idx) => {
    const sortedIdeas = sortByScore(cat.ideas, decorIdeaScore);
    const photoGallery = cat.name === "Photo Booth" ? `
      <div class="photobooth-gallery">
        <div class="photobooth-gallery-title">📸 Reference Photos — click to enlarge</div>
        <img class="pb-thumb" src="photobooth1.jpg" alt="Photo Booth Idea 1" onclick="openLightbox('photobooth1.jpg')">
        <img class="pb-thumb" src="photobooth2.jpg" alt="Photo Booth Idea 2" onclick="openLightbox('photobooth2.jpg')">
        <img class="pb-thumb" src="photobooth3.jpg" alt="Photo Booth Idea 3" onclick="openLightbox('photobooth3.jpg')">
      </div>` : cat.name === "Feedback Box" ? `
      <div class="photobooth-gallery">
        <div class="photobooth-gallery-title">📸 Reference Photo — click to enlarge</div>
        <img class="pb-thumb" src="feedbackbox1.jpg" alt="Feedback Box Reference" onclick="openLightbox('feedbackbox1.jpg')">
      </div>` : cat.name === "Whiteboard" ? `
      <div class="photobooth-gallery">
        <div class="photobooth-gallery-title">📸 Reference Photos — click to enlarge</div>
        <img class="pb-thumb" src="whiteboard1.jpg" alt="Whiteboard Idea 1" onclick="openLightbox('whiteboard1.jpg')">
        <img class="pb-thumb" src="whiteboard2.jpg" alt="Whiteboard Idea 2" onclick="openLightbox('whiteboard2.jpg')">
        <img class="pb-thumb" src="whiteboard3.jpg" alt="Whiteboard Idea 3" onclick="openLightbox('whiteboard3.jpg')">
      </div>` : cat.name === "Theme" ? `
      <div class="photobooth-gallery">
        <div class="photobooth-gallery-title">📸 Reference Photos — click to enlarge</div>
        <img class="pb-thumb" src="theme1.jpg" alt="Theme Idea 1" onclick="openLightbox('theme1.jpg')">
        <img class="pb-thumb" src="theme2.jpg" alt="Theme Idea 2" onclick="openLightbox('theme2.jpg')">
      </div>` : "";
    return `
    <div class="event">
      <div class="event-head">
        <div>
          <p class="event-num">Category ${String(idx + 1).padStart(2, "0")}</p>
          <h3>${escapeHtml(cat.name)}</h3>
          ${adminNote(cat.addedBy)}
        </div>
        <div class="event-actions">
          <button class="btn small" onclick="addDecorIdea('${cat.id}')">+ Add idea</button>
          ${isAdmin ? `<button class="btn small danger" onclick="deleteDecorCat('${cat.id}')">Delete</button>` : ""}
        </div>
      </div>
      ${sortedIdeas.length === 0
        ? `<div class="empty" style="margin-top:10px;">No ideas under this category yet.</div>`
        : sortedIdeas.map((idea, i) => renderDecorIdea(cat.id, idea, i === 0 && decorIdeaScore(idea) > 0)).join("")}
      ${photoGallery}
    </div>
  `;
  }).join("");
}

function renderDecorIdea(catId, idea, isTop) {
  const yesN = idea.yesVoters.length, noN = idea.noVoters.length;
  const yesActive = myName && idea.yesVoters.includes(myName);
  const noActive = myName && idea.noVoters.includes(myName);
  const dsuggId = `dsugg-${idea.id}`;
  const sortedDSuggs = sortByScore(idea.suggestions || [], suggestionScore);
  const dsuggExpanded = expandedDecorSuggPanels.has(idea.id);

  return `
    <div class="activity">
      <div class="activity-row">
        <div>
          <div class="activity-name">${escapeHtml(idea.name)} ${isTop ? `<span class="top-badge">Top pick</span>` : ""}</div>
          ${isAdmin ? `<div class="activity-meta">added by ${escapeHtml(idea.addedBy)}${yesN||noN ? " · " : ""}${yesN ? `yes: ${idea.yesVoters.map(escapeHtml).join(", ")}` : ""}${yesN && noN ? " · " : ""}${noN ? `no: ${idea.noVoters.map(escapeHtml).join(", ")}` : ""}</div>` : ""}
        </div>
        <div class="vote-group">
          <button class="vote-btn yes ${yesActive ? "active" : ""}" onclick="voteDecorIdea('${catId}','${idea.id}','yes')">
            Yes <span class="count">${yesN}</span>
          </button>
          <button class="vote-btn no ${noActive ? "active" : ""}" onclick="voteDecorIdea('${catId}','${idea.id}','no')">
            No <span class="count">${noN}</span>
          </button>
          ${isAdmin ? `<button class="btn small danger" onclick="deleteDecorIdea('${catId}','${idea.id}')">Delete</button>` : ""}
        </div>
      </div>
      <div class="suggestions">
        <button class="suggestions-toggle" onclick="toggleDecorSuggPanel('${idea.id}')">
          ${(idea.suggestions||[]).length} suggestion${(idea.suggestions||[]).length === 1 ? "" : "s"} — view / add
        </button>
        <div id="${dsuggId}" class="${dsuggExpanded ? '' : 'hidden'}">
          <div class="sugg-list">
            ${sortedDSuggs.map((sg) => renderDecorSuggItem(catId, idea.id, sg)).join("")}
          </div>
          <div class="add-inline">
            <button class="btn small gold" onclick="addDecorSugg('${catId}','${idea.id}')">+ Add suggestion</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderDecorSuggItem(catId, ideaId, sg) {
  const upActive = myName && sg.upVoters.includes(myName);
  const downActive = myName && sg.downVoters.includes(myName);
  const score = sg.upVoters.length - sg.downVoters.length;
  return `
    <div class="sugg-item">
      <div class="sugg-text">
        ${escapeHtml(sg.text)}
        ${isAdmin ? `<span class="sugg-meta">added by ${escapeHtml(sg.addedBy)}${sg.upVoters.length ? " · up: " + sg.upVoters.map(escapeHtml).join(", ") : ""}${sg.downVoters.length ? " · down: " + sg.downVoters.map(escapeHtml).join(", ") : ""}</span>` : ""}
      </div>
      <div class="sugg-vote-group">
        <button class="sugg-vote up ${upActive ? "active" : ""}" onclick="voteDecorSugg('${catId}','${ideaId}','${sg.id}','up')">▲ ${sg.upVoters.length}</button>
        <span class="sugg-score">${score > 0 ? "+" + score : score}</span>
        <button class="sugg-vote down ${downActive ? "active" : ""}" onclick="voteDecorSugg('${catId}','${ideaId}','${sg.id}','down')">▼ ${sg.downVoters.length}</button>
        ${isAdmin ? `<button class="btn ghost small" onclick="deleteDecorSugg('${catId}','${ideaId}','${sg.id}')">✕</button>` : ""}
      </div>
    </div>
  `;
}

// ============================================================
// Rendering — Items Needed
// ============================================================
function renderItems() {
  if (!state.itemsNeeded.length) {
    itemsContainer.innerHTML = `<div class="empty">No items needed yet. Add one to get started.</div>`;
    return;
  }
  const totalItems = state.itemsNeeded.reduce((n, cat) => n + cat.items.length, 0);
  const checkedItems = state.itemsNeeded.reduce((n, cat) => n + cat.items.filter(i => i.checked).length, 0);

  itemsContainer.innerHTML = state.itemsNeeded.map((cat) => {
    return `
    <div class="items-card">
      <div class="items-category">${escapeHtml(cat.name)} ${isAdmin ? `<button class="btn ghost small" onclick="deleteItemCat('${cat.id}')">✕</button>` : ""}</div>
      ${cat.items.length === 0
        ? `<div style="color:var(--ink-soft); font-size:13px; padding:6px 0;">No items yet</div>`
        : cat.items.map((item) => `
          <div class="item-row">
            <div class="item-check ${item.checked ? 'checked' : ''}" onclick="toggleItemChecked('${cat.id}','${item.id}')"></div>
            <span class="item-text ${item.checked ? 'done' : ''}">${escapeHtml(item.name)}</span>
            ${item.qty ? `<span class="item-qty">×${escapeHtml(item.qty)}</span>` : ""}
            ${isAdmin ? `<button class="item-del" onclick="deleteItem('${cat.id}','${item.id}')">✕</button>` : ""}
          </div>
        `).join("")}
    </div>
  `;
  }).join("") + `<div class="items-summary">${checkedItems} of ${totalItems} items checked</div>`;
}

// ============================================================
// Admin dashboard
// ============================================================
function voteLine(cls, label, names) {
  return `<span class="${cls}">${label} (${names.length})${names.length ? ": " + names.map(escapeHtml).join(", ") : ""}</span>`;
}

function renderDashboard() {
  const content = el("dashboardContent");
  const totalActivities = state.events.reduce((n, ev) => n + ev.activities.length, 0);
  const totalVotes = state.events.reduce((n, ev) =>
    n + ev.activities.reduce((m, a) => m + a.yesVoters.length + a.noVoters.length, 0), 0);
  const totalSuggVotes = state.events.reduce((n, ev) =>
    n + ev.activities.reduce((m, a) => m + a.suggestions.reduce((k, s) => k + s.upVoters.length + s.downVoters.length, 0), 0), 0);
  const totalDressVotes = state.dressCode.options.reduce((n, o) => n + o.voters.length, 0);
  const totalDecorVotes = state.decorations.reduce((n, cat) =>
    n + cat.ideas.reduce((m, idea) => m + idea.yesVoters.length + idea.noVoters.length, 0), 0);
  const totalAuditLogs = (state.auditLog || []).length;

  let html = `
    <div class="dash-summary">
      <div class="dash-stat"><span class="num">${state.events.length}</span><span class="lbl">Headings</span></div>
      <div class="dash-stat"><span class="num">${totalActivities}</span><span class="lbl">Activities</span></div>
      <div class="dash-stat"><span class="num">${totalVotes}</span><span class="lbl">Yes/No votes</span></div>
      <div class="dash-stat"><span class="num">${totalSuggVotes + totalDressVotes + totalDecorVotes}</span><span class="lbl">Other votes</span></div>
      <div class="dash-stat" style="${totalAuditLogs ? 'background:#fee2e2;' : ''}"><span class="num" style="${totalAuditLogs ? 'color:#b91c1c;' : ''}">${totalAuditLogs}</span><span class="lbl">Audit Alerts</span></div>
    </div>
  `;

  html += `
    <div style="display:flex; justify-content:space-between; align-items:center; margin:14px 0 8px;">
      <div class="dash-section-title" style="margin:0; color:#b91c1c;">🚨 Security & Audit Log (${totalAuditLogs})</div>
      ${totalAuditLogs ? `<button class="btn small danger" onclick="clearAuditLog()">Clear log</button>` : ""}
    </div>
  `;

  if (!totalAuditLogs) {
    html += `<div class="empty" style="margin-bottom:14px;">No security or wrong name attempts recorded yet.</div>`;
  } else {
    html += `<div class="dash-audit-list">`;
    state.auditLog.forEach((log) => {
      const isUnauthAdmin = log.type === "admin_attempt";
      const isWrongPass = log.type === "wrong_password";
      const badgeCls = (isUnauthAdmin || isWrongPass) ? "audit-badge-admin" : "audit-badge-name";
      const icon = isUnauthAdmin ? "🚫" : isWrongPass ? "🔒" : "⚠️";
      const tagText = isUnauthAdmin ? "Unauthorized Admin Attempt" : isWrongPass ? "Wrong Admin Password" : "Wrong Name Attempt";
      const label = (isUnauthAdmin || isWrongPass) ? "User" : "Entered Name";

      html += `
        <div class="dash-audit-card ${(isUnauthAdmin || isWrongPass) ? 'border-admin' : 'border-name'}">
          <div class="dash-audit-header">
            <span class="audit-badge ${badgeCls}">${icon} ${tagText}</span>
            <span class="audit-time">${escapeHtml(log.timestamp || "")}</span>
          </div>
          <div class="dash-audit-body">
            <span class="audit-label">${label}:</span> <strong class="audit-name">${escapeHtml(log.user || "(Unknown)")}</strong>
            ${log.details ? `<div class="audit-details">${escapeHtml(log.details)}</div>` : ""}
          </div>
        </div>
      `;
    });
    html += `</div>`;
  }

  html += `<div class="dash-section-title">Activities</div>`;
  if (!totalActivities) {
    html += `<div class="empty">No activities yet.</div>`;
  } else {
    state.events.forEach((ev) => {
      if (!ev.activities.length) return;
      html += `<div class="dash-event-title">${escapeHtml(ev.heading)}</div>`;
      sortByScore(ev.activities, activityScore).forEach((act) => {
        html += `
          <div class="dash-activity">
            <div class="dash-activity-name">${escapeHtml(act.name)} <span class="event-meta">added by ${escapeHtml(act.addedBy)}</span></div>
            <div class="dash-votes">
              ${voteLine("dash-yes", "Yes", act.yesVoters)}
              ${voteLine("dash-no", "No", act.noVoters)}
            </div>
            ${act.suggestions.length ? `
              <div class="dash-suggestions">
                ${sortByScore(act.suggestions, suggestionScore).map((sg) => `
                  <div class="dash-sugg"><b>${escapeHtml(sg.text)}</b> — ▲${sg.upVoters.length} / ▼${sg.downVoters.length} <span class="event-meta">(added by ${escapeHtml(sg.addedBy)})</span></div>
                `).join("")}
              </div>` : ""}
          </div>
        `;
      });
    });
  }

  html += `<div class="dash-section-title">Dress code</div>`;
  if (!state.dressCode.options.length) {
    html += `<div class="empty">No dressing options yet.</div>`;
  } else {
    sortByScore(state.dressCode.options, dressScore).forEach((opt) => {
      html += `
        <div class="dash-activity">
          <div class="dash-activity-name">${escapeHtml(opt.name)} <span class="event-meta">added by ${escapeHtml(opt.addedBy)}</span></div>
          <div class="dash-votes">${voteLine("dash-yes", "Votes", opt.voters)}</div>
        </div>
      `;
    });
  }

  html += `<div class="dash-section-title">Decorations</div>`;
  if (!state.decorations.length) {
    html += `<div class="empty">No decoration categories yet.</div>`;
  } else {
    state.decorations.forEach((cat) => {
      if (!cat.ideas.length) return;
      html += `<div class="dash-event-title">${escapeHtml(cat.name)}</div>`;
      sortByScore(cat.ideas, decorIdeaScore).forEach((idea) => {
        html += `
          <div class="dash-activity">
            <div class="dash-activity-name">${escapeHtml(idea.name)} <span class="event-meta">added by ${escapeHtml(idea.addedBy)}</span></div>
            <div class="dash-votes">
              ${voteLine("dash-yes", "Yes", idea.yesVoters)}
              ${voteLine("dash-no", "No", idea.noVoters)}
            </div>
            ${idea.suggestions && idea.suggestions.length ? `
              <div class="dash-suggestions">
                ${sortByScore(idea.suggestions, suggestionScore).map((sg) => `
                  <div class="dash-sugg"><b>${escapeHtml(sg.text)}</b> — ▲${sg.upVoters.length} / ▼${sg.downVoters.length} <span class="event-meta">(added by ${escapeHtml(sg.addedBy)})</span></div>
                `).join("")}
              </div>` : ""}
          </div>
        `;
      });
    });
  }

  html += `<div class="dash-section-title">Items Needed</div>`;
  if (!state.itemsNeeded.length) {
    html += `<div class="empty">No items yet.</div>`;
  } else {
    const totalItems = state.itemsNeeded.reduce((n, cat) => n + cat.items.length, 0);
    const checkedItems = state.itemsNeeded.reduce((n, cat) => n + cat.items.filter(i => i.checked).length, 0);
    html += `<div style="font-size:13px; color:var(--ink-soft); margin-bottom:8px;">${checkedItems} of ${totalItems} items checked</div>`;
    state.itemsNeeded.forEach((cat) => {
      if (!cat.items.length) return;
      html += `<div class="dash-event-title">${escapeHtml(cat.name)}</div>`;
      cat.items.forEach((item) => {
        html += `
          <div class="dash-activity">
            <div class="dash-activity-name">${item.checked ? "✓" : "○"} ${escapeHtml(item.name)} ${item.qty ? `(×${escapeHtml(item.qty)})` : ""} <span class="event-meta">added by ${escapeHtml(item.addedBy)}</span></div>
          </div>
        `;
      });
    });
  }

  content.innerHTML = html;
}

// ============================================================
// Pre-made activities — auto-loaded on first visit
// ============================================================
const PREMADE_MARKER = "Ice-Breaker Activities";

function getPremadeEvents() {
  return [
    {
      heading: "Ice-Breaker Activities",
      activities: [
        { name: "Buddy Seating — 2–3 seniors sit beside juniors so they can interact and get comfortable more easily" },
        { name: "Two Truths and a Lie — each person says two truths and one lie about themselves, everyone guesses the lie" },
        { name: "Finding the Imposter — a few seniors pretend to be juniors and mix in, juniors have to figure out who the imposters are" }
      ]
    },
    {
      heading: "Performance Activities",
      activities: [
        { name: "Senior Talent Showcase — seniors perform first (instrument, singing, dancing, or any talent) so juniors feel encouraged to participate" },
        { name: "Fake Teacher Skit — a senior acts as a fake teacher and creates a funny classroom-style scene with the juniors" }
      ]
    },
    {
      heading: "Comedy Skit Activities",
      activities: [
        { name: "Security Guard Scene — one senior wears a bike helmet and another wears black sunglasses, acting like security guards" },
        { name: "High Heels Salute — a senior wears high heels and asks the boys to salute him" },
        { name: "Butterfly Wings Skit — using butterfly wings that small children wear in school skits and creating something funny around them" },
        { name: "Fake Fight — a short, funny, clearly staged fake fight between seniors as part of a skit" }
      ]
    },
    {
      heading: "Interactive Game Activities",
      activities: [
        { name: "Blindfolded Box Challenge — 4 juniors stand inside a marked box on the floor, blindfolded, and try to stay inside while moving" },
        { name: "Football Dare Game — football goes around while music plays, when music stops whoever has it performs a fun dare" }
      ]
    }
  ];
}

function premadeAlreadyLoaded(s) {
  return s.events.some((ev) => ev.heading === PREMADE_MARKER);
}

function injectPremadeActivities(s) {
  const premade = getPremadeEvents();
  premade.forEach((ev) => {
    s.events.push({
      id: uid(),
      heading: ev.heading,
      addedBy: "System",
      activities: ev.activities.map((a) => ({
        id: uid(),
        name: a.name,
        addedBy: "System",
        yesVoters: [],
        noVoters: [],
        suggestions: []
      }))
    });
  });
}

const PREMADE_DECOR_MARKER = "Theme";

function premadeDecorLoaded(s) {
  return s.decorations.some((cat) => cat.name === PREMADE_DECOR_MARKER);
}

function injectPremadeDecorations(s) {
  const cats = [
    {
      name: "Theme",
      ideas: [
        "Hogwarts Theme"
      ]
    },
    {
      name: "Photo Booth",
      ideas: [
        "Print fictional characters on A4 sheets, cut them out and stick them around, build a nice booth setup"
      ]
    },
    {
      name: "Feedback Box",
      ideas: [
        "Do something like our seniors did — they gave us sticky notes, told us to write anything, and then stick it on a chart"
      ]
    },
    {
      name: "Juniors Accessories",
      ideas: [
        "Get black glasses with 2K26 written on them, make the juniors wear them and take their pictures"
      ]
    },
    {
      name: "Empty Spaces",
      ideas: [
        "Fill the empty spaces with different quotes written on them"
      ]
    },
    {
      name: "Whiteboard",
      ideas: [
        "Set up a whiteboard with fun CS memes, quotes, and doodles for everyone to enjoy"
      ]
    }
  ];
  cats.forEach((cat) => {
    s.decorations.push({
      id: uid(),
      name: cat.name,
      addedBy: "System",
      ideas: cat.ideas.map((name) => ({
        id: uid(),
        name,
        addedBy: "System",
        yesVoters: [],
        noVoters: [],
        suggestions: []
      }))
    });
  });
}

// ============================================================
// Pre-made dress code — auto-loaded on first visit
// ============================================================
const PREMADE_DRESS_MARKER = "Black pants with red shirt";

function premadeDressLoaded(s) {
  return s.dressCode.options.some((opt) => opt.name === PREMADE_DRESS_MARKER);
}

function injectPremadeDressCode(s) {
  const options = [
    "Black pants with red shirt",
    "Black pants with green shirt",
    "Black pants with black shirt",
    "Black pants with white shirt"
  ];
  options.forEach((name) => {
    s.dressCode.options.push({
      id: uid(),
      name,
      addedBy: "System",
      voters: []
    });
  });
}

// ============================================================
// Init
// ============================================================
el("refreshBtn").onclick = () => refresh(false);

async function init() {
  await refresh(false);
  let changed = false;
  if (!premadeAlreadyLoaded(state)) {
    injectPremadeActivities(state);
    changed = true;
  }
  if (!premadeDecorLoaded(state)) {
    injectPremadeDecorations(state);
    changed = true;
  }
  if (!premadeDressLoaded(state)) {
    injectPremadeDressCode(state);
    changed = true;
  }
  // Migration: add Whiteboard category if missing (for users who already had premade decor loaded)
  if (!state.decorations.some((c) => c.name === "Whiteboard")) {
    state.decorations.push({
      id: uid(),
      name: "Whiteboard",
      addedBy: "System",
      ideas: [{
        id: uid(),
        name: "Set up a whiteboard with fun CS memes, quotes, and doodles for everyone to enjoy",
        addedBy: "System",
        yesVoters: [],
        noVoters: [],
        suggestions: []
      }]
    });
    changed = true;
  }
  if (changed) {
    await saveState(state);
    render();
  }
}

updateWhoDisplay();
init();

// Always prompt for name on page load
ensureName(() => {});

pollTimer = setInterval(() => {
  const anyModalOpen = !document.getElementById("promptOverlay").classList.contains("hidden")
    || !document.getElementById("nameOverlay").classList.contains("hidden")
    || !document.getElementById("adminOverlay").classList.contains("hidden")
    || !document.getElementById("notAdminOverlay").classList.contains("hidden");
  if (!saving && !anyModalOpen) refresh(true);
}, CONFIG.POLL_INTERVAL || 6000);

// ============================================================
// Section navbar — active state & smooth scroll
// ============================================================
const sectionNav = document.getElementById("sectionNav");
const navLinks = sectionNav ? sectionNav.querySelectorAll("a[href^='#']") : [];
const sectionIds = ["activities", "dresscode", "decorations", "items"];

function updateActiveNav() {
  let current = sectionIds[0];
  for (const id of sectionIds) {
    const sec = document.getElementById(id);
    if (sec && sec.getBoundingClientRect().top <= 140) current = id;
  }
  navLinks.forEach((link) => {
    link.classList.toggle("active", link.getAttribute("href") === "#" + current);
  });
}

window.addEventListener("scroll", updateActiveNav, { passive: true });
updateActiveNav();

navLinks.forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    const target = document.querySelector(link.getAttribute("href"));
    if (target) {
      const offset = sectionNav.offsetHeight + 10;
      const top = target.getBoundingClientRect().top + window.pageYOffset - offset;
      window.scrollTo({ top, behavior: "smooth" });
    }
  });
});

// Navbar admin button
const navAdminBtn = document.getElementById("navAdminBtn");
if (navAdminBtn) {
  navAdminBtn.onclick = () => adminBtn.click();
}

// ============================================================
// Sticky navbar — calculate header height dynamically
// ============================================================
function updateNavbarPosition() {
  const header = document.querySelector("header.top");
  const navbar = document.querySelector("nav.sections");
  if (header && navbar) {
    const headerHeight = header.offsetHeight;
    navbar.style.top = headerHeight + "px";
  }
}

window.addEventListener("resize", updateNavbarPosition);
updateNavbarPosition();

// Also update after content loads
setTimeout(updateNavbarPosition, 100);
setTimeout(updateNavbarPosition, 500);

// ============================================================
// Lightbox — for Photo Booth gallery
// ============================================================
function openLightbox(src) {
  // Remove any existing lightbox first
  closeLightbox();
  const overlay = document.createElement("div");
  overlay.className = "lightbox-overlay";
  overlay.id = "lightboxOverlay";
  overlay.onclick = closeLightbox;

  const img = document.createElement("img");
  img.src = src;
  img.alt = "Photo Booth Reference";
  img.onclick = (e) => e.stopPropagation(); // don't close when clicking the image itself

  const closeBtn = document.createElement("button");
  closeBtn.className = "lightbox-close";
  closeBtn.innerHTML = "✕";
  closeBtn.title = "Close";
  closeBtn.onclick = closeLightbox;

  overlay.appendChild(img);
  overlay.appendChild(closeBtn);
  document.body.appendChild(overlay);

  // Close on Escape key
  document.addEventListener("keydown", _lbKeyHandler);
}

function _lbKeyHandler(e) {
  if (e.key === "Escape") closeLightbox();
}

function closeLightbox() {
  const existing = document.getElementById("lightboxOverlay");
  if (existing) existing.remove();
  document.removeEventListener("keydown", _lbKeyHandler);
}
