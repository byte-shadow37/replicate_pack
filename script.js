// script.js — theme toggle + CSV preview tables (no frameworks)
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const DEFAULT_THEME = "dark";
const THEME_KEY = "repro_site_theme";

function setTheme(theme){
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
}

function initTheme(){
  const saved = localStorage.getItem(THEME_KEY);
  if(saved){
    setTheme(saved);
    return;
  }
  // default based on prefers-color-scheme
  const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  setTheme(prefersLight ? "light" : DEFAULT_THEME);
}

function toggleTheme(){
  const cur = document.documentElement.dataset.theme || DEFAULT_THEME;
  setTheme(cur === "light" ? "dark" : "light");
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
  })[c]);
}

function parseCsv(text){
  // Simple CSV parser that supports quoted fields with commas/newlines.
  const rows = [];
  let i=0, field="", row=[], inQuotes=false;
  while(i < text.length){
    const c = text[i];
    const next = text[i+1];

    if(inQuotes){
      if(c === '"' && next === '"'){ field += '"'; i += 2; continue; }
      if(c === '"'){ inQuotes=false; i++; continue; }
      field += c; i++; continue;
    }else{
      if(c === '"'){ inQuotes=true; i++; continue; }
      if(c === ','){ row.push(field); field=""; i++; continue; }
      if(c === '\n'){
        row.push(field); rows.push(row);
        row=[]; field=""; i++; continue;
      }
      if(c === '\r'){ i++; continue; }
      field += c; i++; continue;
    }
  }
  row.push(field);
  rows.push(row);
  return rows;
}

function normalizeBool(v){
  const s = String(v).trim().toLowerCase();
  if(["1","true","yes","y","ok","passed","pass","success"].includes(s)) return true;
  if(["0","false","no","n","fail","failed"].includes(s)) return false;
  return null;
}

function badge(value){
  const b = normalizeBool(value);
  if(b === true) return '<span class="badge badge--ok">yes</span>';
  if(b === false) return '<span class="badge badge--no">no</span>';
  return `<span class="badge">${escapeHtml(value)}</span>`;
}

function compare(a,b){
  if(a == null && b == null) return 0;
  if(a == null) return -1;
  if(b == null) return 1;

  // numeric if both look numeric
  const na = Number(a), nb = Number(b);
  const isNum = !Number.isNaN(na) && !Number.isNaN(nb) && String(a).trim() !== "" && String(b).trim() !== "";
  if(isNum) return na - nb;

  return String(a).localeCompare(String(b));
}

function normKey(s){
  return String(s ?? "")
    .toLowerCase()
    .replace(/[_\s]+/g, "")
    .trim();
}

function uniqueValuesFrom(rows, key){
  const s = new Set(rows.map(r => String(r[key] ?? "").trim()).filter(Boolean));
  return Array.from(s).sort((a,b)=>a.localeCompare(b));
}

function fillSelect(selectEl, values){
  if(!selectEl) return;
  const cur = selectEl.value;
  selectEl.innerHTML = '<option value="">All</option>' + values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  if(values.includes(cur)) selectEl.value = cur;
}

// =========================
// Main Results table (MultiAgent / SingleLLM / ablations)
// =========================

let rawRows = [];
let viewRows = [];
let sortKey = null;
let sortAsc = true;

const COLUMNS = ["Model","File","Clone Method","Clone Type","Detect","Use Fallback","Success Iteration Number","Compile","Test","Usefulness"];

// Scenario → CSV file mapping
const SCENARIO_FILES = {
  "MultiAgent": "./downloads/results_multiagent.csv",
  "SingleLLM": "./downloads/results_singlellm.csv"
};

let headerMap = null; // canonical column -> index in CSV

function rowToObj(row){
  const obj = {};
  for(const c of COLUMNS){
    const idx = headerMap ? headerMap[c] : -1;
    obj[c] = (idx != null && idx >= 0) ? (row[idx] ?? "") : "";
  }
  return obj;
}

function applyFilters(){
  const q = ($("#searchInput")?.value || "").trim().toLowerCase();
  const model = ($("#modelFilter")?.value || "").trim();
  const scenario = ($("#scenarioFilter")?.value || "").trim();
  const cloneType = ($("#settingFilter")?.value || "").trim();

  viewRows = rawRows.filter(r => {
    if(scenario && String(r["__scenario"] ?? "") !== scenario) return false;
    if(model && String(r["Model"] ?? "").trim() !== model) return false;
    if(cloneType && String(r["Clone Type"] ?? "").trim() !== cloneType) return false;

    if(!q) return true;
    const hay = COLUMNS.map(c => String(r[c] ?? "")).join(" ").toLowerCase();
    return hay.includes(q);
  });

  renderTable();
}

function sortBy(key){
  if(sortKey === key){
    sortAsc = !sortAsc;
  }else{
    sortKey = key;
    sortAsc = true;
  }
  viewRows.sort((r1,r2) => {
    const c = compare(r1[key], r2[key]);
    return sortAsc ? c : -c;
  });
  renderTable();
}

function adjustHeaderForScenario(scenario){
  const thFallback = document.querySelector('#resultsTable thead th[data-sort="Use Fallback"]');
  const thIter = document.querySelector('#resultsTable thead th[data-sort="Success Iteration Number"]');

  // reset defaults
  if(thFallback) thFallback.style.display = "";
  if(thIter) thIter.textContent = "Success Iter";

  // reset all fallback cells
  document.querySelectorAll('#resultsTable tbody td.fallback-cell').forEach(td => {
    td.style.display = "";
  });

  if(scenario === "SingleLLM"){
    if(thFallback) thFallback.style.display = "none";
    if(thIter) thIter.textContent = "Iterations";

    document.querySelectorAll('#resultsTable tbody td.fallback-cell').forEach(td => {
      td.style.display = "none";
    });
  }
}

function renderTable(){
  const tbody = $("#resultsTable tbody");
  if(!tbody) return;

  tbody.innerHTML = viewRows.map(r => {
    const detect = badge(r["Detect"]);
    const fallback = badge(r["Use Fallback"]);
    const compile = badge(r["Compile"]);
    const test = badge(r["Test"]);
    const useful = badge(r["Usefulness"]);

    return `
      <tr>
        <td>${escapeHtml(r["Model"])}</td>
        <td>${escapeHtml(r["File"])}</td>
        <td>${escapeHtml(r["Clone Method"])}</td>
        <td>${escapeHtml(r["Clone Type"])}</td>
        <td>${detect}</td>
        <td class="fallback-cell">${fallback}</td>
        <td>${escapeHtml(r["Success Iteration Number"])}</td>
        <td>${compile}</td>
        <td>${test}</td>
        <td>${useful}</td>
      </tr>
    `;
  }).join("");

  // Fill dropdowns based on CURRENT view
  fillSelect($("#modelFilter"), uniqueValuesFrom(viewRows, "Model"));
  fillSelect($("#settingFilter"), uniqueValuesFrom(viewRows, "Clone Type"));

  const currentScenario = ($("#scenarioFilter")?.value || "").trim();
  adjustHeaderForScenario(currentScenario);
}

async function loadResultsCsv(selectedScenario){
  async function loadOne(url, scenarioLabel){
    const res = await fetch(url, {cache:"no-store"});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    const rows = parseCsv(text).filter(r => r.some(x => String(x).trim() !== ""));
    if(rows.length < 2) return [];

    const rawHeaders = rows[0].map(h => String(h ?? "").trim());

    const headerIndexByNorm = new Map();
    rawHeaders.forEach((h, i) => {
      const k = normKey(h);
      if(k) headerIndexByNorm.set(k, i);
    });

    headerMap = {};
    for(const c of COLUMNS){
      const idx = headerIndexByNorm.get(normKey(c));
      headerMap[c] = (idx == null ? -1 : idx);
    }

    // ---- Special handling for SingleLLM CSV format ----
    // If the CSV has "Iterations"/"Iteration" but not "Success Iteration Number",
    // map Iterations → Success Iteration Number
    if(scenarioLabel === "SingleLLM" && headerMap["Success Iteration Number"] === -1){
      const iterIdx = headerIndexByNorm.get("iterations") ?? headerIndexByNorm.get("iteration");
      if(iterIdx != null){
        headerMap["Success Iteration Number"] = iterIdx;
      }
    }

    return rows.slice(1)
      .filter(r => r.some(x => String(x).trim() !== ""))
      .map(rowToObj)
      .map(obj => ({...obj, __scenario: scenarioLabel}));
  }

  try{
    if(selectedScenario && SCENARIO_FILES[selectedScenario]){
      rawRows = await loadOne(SCENARIO_FILES[selectedScenario], selectedScenario);
    }else{
      const all = [];
      for(const [sc, url] of Object.entries(SCENARIO_FILES)){
        try{
          const rows = await loadOne(url, sc);
          all.push(...rows);
        }catch(e){
          console.warn("Could not load", url);
        }
      }
      rawRows = all;
    }
  }catch(err){
    console.error("Failed to load scenario CSV", err);
    rawRows = [];
  }

  viewRows = [...rawRows];
  applyFilters();
}

function initSorting(){
  $$("#resultsTable thead th").forEach(th => {
    const key = th.dataset.sort;
    if(!key) return;
    th.addEventListener("click", () => sortBy(key));
  });
}

function initControls(){
  // Main table controls
  $("#searchInput")?.addEventListener("input", applyFilters);
  $("#modelFilter")?.addEventListener("change", applyFilters);
  $("#settingFilter")?.addEventListener("change", applyFilters);
  $("#scenarioFilter")?.addEventListener("change", async (e) => {
    const sc = e.target.value;
    await loadResultsCsv(sc);
    applyFilters();
  });

  const dlBtn = $("#downloadCsvBtn");
  if(dlBtn){
    dlBtn.addEventListener("click", () => {
      const a = document.createElement("a");
      a.href = "./downloads/results.zip";
      a.download = "results.zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
    });
  }


  const copyBtn = $("#copyBibtexBtn");
  if(copyBtn){
    copyBtn.addEventListener("click", async () => {
      const bib = $("#bibtex");
      if(!bib) return;
      const text = bib.innerText;
      try{
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = "Copied!";
        setTimeout(()=> copyBtn.textContent = "Copy BibTeX", 900);
      }catch{
        const ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
        copyBtn.textContent = "Copied!";
        setTimeout(()=> copyBtn.textContent = "Copy BibTeX", 900);
      }
    });
  }

  const themeBtn = $("#themeToggle");
  if(themeBtn){
    themeBtn.addEventListener("click", toggleTheme);
  }
}

function initFooter(){
  const y = $("#year");
  if(y) y.textContent = String(new Date().getFullYear());
}

initTheme();
document.addEventListener("DOMContentLoaded", async () => {
  initControls();
  initSorting();
  initFooter();
  await loadResultsCsv();
});
