(() => {
  "use strict";
  const CFG = window.SITE_CONFIG;
  const $ = (id) => document.getElementById(id);
  const MONTHS_RU = ["январь","февраль","март","апрель","май","июнь","июль","август","сентябрь","октябрь","ноябрь","декабрь"];

  // ---------- helpers ----------
  const csvUrl = (sheet) =>
    `https://docs.google.com/spreadsheets/d/${CFG.sheetId}/gviz/tq?tqx=out:csv&headers=1&sheet=${encodeURIComponent(sheet)}&_=${Date.now()}`;

  function parseCSV(text) {
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.map(r => r.map(v => v.trim()));
  }

  const normClass = (s) => (s || "").replace(/\s+/g, "").toUpperCase().replace("Ё", "Е");
  const prettyClass = (k) => k.replace(/^(\d+)/, "$1 ");
  const parallelOf = (k) => parseInt(k, 10);
  const num = (v) => { const n = parseFloat(String(v).replace(",", ".").replace(/\s/g, "")); return isFinite(n) ? n : 0; };
  const isClass = (s) => /^\d{1,2}\s*[А-ЯЁа-яё]$/.test((s || "").trim());
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
  };

  async function fetchSheet(name) {
    const res = await fetch(csvUrl(name));
    if (!res.ok) throw new Error(`Лист «${name}»: ошибка ${res.status}`);
    const text = await res.text();
    if (/^\s*</.test(text)) throw new Error(`Лист «${name}»: нет доступа (таблица не открыта по ссылке)`);
    return text;
  }

  // Месяц начинается в будущем? — такие листы не загружаем
  function monthStart(name) {
    const m = name.toLowerCase().match(/([а-яё]+)\s+(\d{4})/);
    if (!m) return null;
    const idx = MONTHS_RU.findIndex(x => m[1].startsWith(x.slice(0, 3)));
    return idx < 0 ? null : new Date(+m[2], idx, 1);
  }

  // ---------- parse a month sheet ----------
  function parseMonth(rows) {
    const h = rows.findIndex(r => r.some(c => c.toLowerCase() === "класс"));
    if (h < 0) return null;
    const head = rows[h];
    const find = (re) => head.findIndex(c => re.test(c.toLowerCase()));
    const cClass = find(/^класс$/), cTeach = find(/руковод/), cCab = find(/кабинет/), cTotal = find(/итог/);
    const cats = [];
    head.forEach((name, i) => {
      if (!name || [cClass, cTeach, cCab, cTotal].includes(i)) return;
      cats.push({ name, i });
    });
    const classes = {};
    for (const r of rows.slice(h + 1)) {
      if (!isClass(r[cClass])) continue;
      const k = normClass(r[cClass]);
      const scores = cats.map(c => ({ name: c.name, v: num(r[c.i]) }));
      const sum = scores.reduce((a, b) => a + b.v, 0);
      classes[k] = {
        teacher: cTeach >= 0 ? r[cTeach] : "",
        scores,
        total: cTotal >= 0 && r[cTotal] !== "" ? num(r[cTotal]) : sum,
      };
    }
    return { cats: cats.map(c => c.name), classes };
  }

  // ---------- state ----------
  const S = { months: [], classes: {}, rewards: [], spent: {}, current: null, month: null, tab: "all" };

  async function load() {
    $("site-title").textContent = CFG.title;
    $("site-subtitle").textContent = CFG.subtitle;
    const now = new Date();
    const wanted = CFG.months.filter(m => { const d = monthStart(m); return !d || d <= now; });

    const monthTexts = await Promise.all(wanted.map(m => fetchSheet(m).then(t => [m, t]).catch(e => [m, null, e])));
    const seen = new Set();
    const errors = [];
    for (const [name, text, err] of monthTexts) {
      if (!text) { errors.push(err); continue; }
      if (seen.has(text)) continue;               // несуществующий лист Google отдаёт как первый — пропускаем дубли
      seen.add(text);
      const parsed = parseMonth(parseCSV(text));
      if (parsed && Object.keys(parsed.classes).length) S.months.push({ name, ...parsed });
    }
    if (!S.months.length) throw errors[0] || new Error("Не удалось прочитать ни одного месяца");

    // список классов (порядок — как в таблице)
    for (const m of S.months) for (const [k, v] of Object.entries(m.classes)) {
      if (!S.classes[k]) S.classes[k] = { teacher: v.teacher };
      if (v.teacher) S.classes[k].teacher = v.teacher;
    }

    // награды и покупки — необязательные листы
    const [rw, pr] = await Promise.all([
      fetchSheet(CFG.rewardsSheet).catch(() => null),
      fetchSheet(CFG.purchasesSheet).catch(() => null),
    ]);
    const monthSet = new Set(monthTexts.map(x => x[1]).filter(Boolean));
    if (rw && !monthSet.has(rw)) S.rewards = parseRewards(parseCSV(rw));
    if (pr && !monthSet.has(pr) && pr !== rw) S.spent = parsePurchases(parseCSV(pr));

    // текущий месяц: календарный, если он есть, иначе последний
    const curName = `${MONTHS_RU[now.getMonth()]} ${now.getFullYear()}`;
    S.month = (S.months.find(m => m.name.toLowerCase() === curName) || S.months[S.months.length - 1]).name;

    // посчитать годовые итоги
    for (const k of Object.keys(S.classes)) {
      const c = S.classes[k];
      c.year = S.months.reduce((a, m) => a + (m.classes[k]?.total || 0), 0);
      c.spent = S.spent[k] || 0;
      c.balance = c.year - c.spent;
    }
    const ranked = Object.keys(S.classes).sort((a, b) => S.classes[b].year - S.classes[a].year);
    ranked.forEach(k => {
      const c = S.classes[k];
      c.rank = 1 + ranked.filter(x => S.classes[x].year > c.year).length;
      const par = ranked.filter(x => parallelOf(x) === parallelOf(k));
      c.rankPar = 1 + par.filter(x => S.classes[x].year > c.year).length;
      c.parSize = par.length;
    });
  }

  function parseRewards(rows) {
    const h = rows.findIndex(r => r.some(c => /наград/i.test(c)));
    if (h < 0) return [];
    const head = rows[h].map(c => c.toLowerCase());
    const ci = (re) => head.findIndex(c => re.test(c));
    const cN = ci(/наград|название/), cP = ci(/цен|балл/), cD = ci(/описан/), cShow = ci(/показ/);
    return rows.slice(h + 1)
      .filter(r => r[cN] && (cShow < 0 || !/^(нет|no|0|false)$/i.test(r[cShow] || "")))
      .map(r => ({ name: r[cN], price: num(r[cP]), desc: cD >= 0 ? r[cD] : "" }))
      .sort((a, b) => a.price - b.price);
  }

  function parsePurchases(rows) {
    const h = rows.findIndex(r => r.some(c => c.toLowerCase() === "класс"));
    if (h < 0) return {};
    const head = rows[h].map(c => c.toLowerCase());
    const cC = head.indexOf("класс"), cP = head.findIndex(c => /балл|цен|сумм/.test(c));
    const out = {};
    for (const r of rows.slice(h + 1)) {
      if (!isClass(r[cC])) continue;
      const k = normClass(r[cC]);
      out[k] = (out[k] || 0) + num(r[cP]);
    }
    return out;
  }

  // ---------- render ----------
  function fillSelects() {
    const sel = $("class-select");
    const groups = {};
    Object.keys(S.classes).forEach(k => (groups[parallelOf(k)] ||= []).push(k));
    sel.innerHTML = `<option value="">— выберите класс —</option>` + Object.keys(groups).sort((a, b) => a - b).map(p =>
      `<optgroup label="${p} классы">${groups[p].map(k => `<option value="${k}">${prettyClass(k)}</option>`).join("")}</optgroup>`
    ).join("");
    sel.disabled = false;

    const ms = $("month-select");
    ms.innerHTML = S.months.map(m => `<option>${esc(m.name)}</option>`).join("");
    ms.value = S.month; ms.disabled = false;

    const tabs = ["all", ...Object.keys(groups).sort((a, b) => a - b)];
    $("rating-tabs").innerHTML = tabs.map(t =>
      `<button role="tab" data-tab="${t}" aria-selected="${t === S.tab}">${t === "all" ? "Все" : t + " кл."}</button>`).join("");
  }

  function renderClass() {
    const k = S.current, view = $("class-view");
    if (!k || !S.classes[k]) { view.hidden = true; return; }
    view.hidden = false;
    const c = S.classes[k];
    $("st-balance").textContent = c.balance;
    $("st-year").textContent = c.year;
    $("st-spent").textContent = c.spent;
    $("st-rank").textContent = `${c.rank} из ${Object.keys(S.classes).length}`;
    $("st-rank-par").textContent = `${c.rankPar} из ${c.parSize} в параллели`;
    $("teacher").textContent = c.teacher ? `Кл. руководитель: ${c.teacher}` : "";

    const m = S.months.find(x => x.name === S.month);
    const row = m?.classes[k];
    $("month-name").textContent = S.month.toLowerCase();
    const max = Math.max(5, ...(row ? row.scores.map(s => s.v) : [0]));
    $("cats").innerHTML = row ? row.scores.map(s =>
      `<li class="${s.v ? "" : "zero"}"><span>${esc(s.name)}</span><span class="num">${s.v}</span>
       <span class="bar"><span style="width:${(s.v / max) * 100}%"></span></span></li>`).join("")
      : `<li class="zero">Класса нет на этом листе</li>`;
    $("month-total").textContent = row ? row.total : 0;

    const mmax = Math.max(1, ...S.months.map(x => x.classes[k]?.total || 0));
    $("months").innerHTML = S.months.map(x => {
      const v = x.classes[k]?.total || 0;
      return `<li class="${x.name === S.month ? "current" : ""}"><span>${esc(x.name)}</span><span class="num">${v}</span>
        <span class="bar"><span style="width:${(v / mmax) * 100}%"></span></span></li>`;
    }).join("");
  }

  function renderRewards() {
    const box = $("rewards");
    if (!S.rewards.length) {
      box.innerHTML = `<p class="muted">Список наград скоро появится.</p>`; return;
    }
    const bal = S.current ? S.classes[S.current].balance : null;
    box.innerHTML = S.rewards.map(r => {
      const can = bal !== null && bal >= r.price;
      const need = bal === null ? "" : can ? "Хватает баллов ✓" : `Не хватает ${r.price - bal}`;
      return `<div class="reward ${can ? "can" : ""}">
        <span class="price">${r.price} баллов</span>
        <h3>${esc(r.name)}</h3>
        ${r.desc ? `<p>${esc(r.desc)}</p>` : "<p></p>"}
        ${need ? `<span class="need">${need}</span>` : ""}
      </div>`;
    }).join("");
  }

  function renderRating() {
    let keys = Object.keys(S.classes);
    if (S.tab !== "all") keys = keys.filter(k => parallelOf(k) === +S.tab);
    keys.sort((a, b) => S.classes[b].year - S.classes[a].year || a.localeCompare(b, "ru", { numeric: true }));
    $("rating-body").innerHTML = keys.map(k => {
      const c = S.classes[k];
      const place = S.tab === "all" ? c.rank : c.rankPar;
      const medal = place <= 3 ? `<span class="medal">${place}</span>` : place;
      return `<tr data-k="${k}" class="${k === S.current ? "me" : ""}"><td>${medal}</td><td>${prettyClass(k)}</td>
        <td class="hide-sm">${esc(c.teacher)}</td><td>${c.year}</td><td class="hide-sm">${c.spent}</td><td>${c.balance}</td></tr>`;
    }).join("");
  }

  function renderAll() { renderClass(); renderRewards(); renderRating(); }

  function selectClass(k) {
    S.current = k && S.classes[k] ? k : null;
    $("class-select").value = S.current || "";
    if (S.current) { store.set("myClass", S.current); history.replaceState(null, "", "#" + encodeURIComponent(prettyClass(S.current))); }
    renderAll();
  }

  // ---------- init ----------
  load().then(() => {
    fillSelects();
    $("status").textContent = "";
    $("class-select").addEventListener("change", e => selectClass(e.target.value));
    $("month-select").addEventListener("change", e => { S.month = e.target.value; renderClass(); });
    $("rating-tabs").addEventListener("click", e => {
      const b = e.target.closest("button"); if (!b) return;
      S.tab = b.dataset.tab;
      [...$("rating-tabs").children].forEach(x => x.setAttribute("aria-selected", x === b));
      renderRating();
    });
    $("rating-body").addEventListener("click", e => {
      const tr = e.target.closest("tr"); if (!tr) return;
      selectClass(tr.dataset.k); window.scrollTo({ top: 0, behavior: "smooth" });
    });
    const fromHash = normClass(decodeURIComponent(location.hash.slice(1)));
    selectClass(S.classes[fromHash] ? fromHash : store.get("myClass"));
    $("updated").textContent = `Обновлено: ${new Date().toLocaleString("ru-RU", { dateStyle: "long", timeStyle: "short" })}`;
  }).catch(err => {
    console.error(err);
    const st = $("status");
    st.classList.add("error");
    st.textContent = `Не удалось загрузить баллы: ${err.message}. Проверьте, что таблица открыта для просмотра по ссылке.`;
    $("rewards").innerHTML = "";
  });
})();
