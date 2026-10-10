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
  const S = { months: [], classes: {}, rewards: [], spent: {}, rules: [], answers: [], current: null, month: null, tab: "all" };

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

    // изменение места: рейтинг по всем месяцам против рейтинга без последнего месяца
    if (S.months.length >= 2) {
      const last = S.months[S.months.length - 1];
      const prevYear = (k) => S.classes[k].year - (last.classes[k]?.total || 0);
      for (const k of ranked) {
        const p = prevYear(k);
        const prevRank = 1 + ranked.filter(x => prevYear(x) > p).length;
        S.classes[k].delta = prevRank - S.classes[k].rank;   // >0 — поднялся
        const par = ranked.filter(x => parallelOf(x) === parallelOf(k));
        S.classes[k].deltaPar = (1 + par.filter(x => prevYear(x) > p).length) - S.classes[k].rankPar;
      }
    }
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

  // ---------- правила (лист «Правила»: Категория | Как получить баллы | Максимум) ----------
  function parseRules(rows) {
    const h = rows.findIndex(r => r.some(c => /^категори/i.test(c)));
    if (h < 0) return [];
    const head = rows[h].map(c => c.toLowerCase());
    const cN = head.findIndex(c => /^категори/.test(c));
    const cD = head.findIndex((c, i) => i !== cN && /(как|описан|критери|услови)/.test(c));
    if (cD < 0) return [];
    let cM = head.findIndex(c => /макс/.test(c));
    if (cM < 0) cM = head.findIndex((c, i) => i !== cD && /^балл/.test(c));
    // строки без описания не показываем — их можно заполнить позже
    return rows.slice(h + 1).filter(r => r[cN] && r[cD]).map(r => ({ name: r[cN], desc: r[cD], max: cM >= 0 ? r[cM] : "" }));
  }

  // ---------- ответы (лист «Ответы»: Код | Статус | Ответ | Вопрос для FAQ | В FAQ) ----------
  const normCode = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^(.{3})(.{3})$/, "$1-$2");
  function parseAnswers(rows) {
    const h = rows.findIndex(r => r.some(c => /^код/i.test(c)) && r.some(c => /(ответ|статус)/i.test(c)));
    if (h < 0) return [];
    const head = rows[h].map(c => c.toLowerCase());
    const cC = head.findIndex(c => /^код/.test(c));
    const cS = head.findIndex(c => /статус/.test(c));
    const cQ = head.findIndex(c => /вопрос/.test(c));
    const cF = head.findIndex((c, i) => i !== cQ && /faq|публик/.test(c));
    const cA = head.findIndex((c, i) => i !== cQ && /ответ/.test(c));
    const cH = head.findIndex(c => /скры/.test(c));
    return rows.slice(h + 1).map(r => ({
      code: normCode(r[cC]),
      status: cS >= 0 ? r[cS] : "",
      answer: cA >= 0 ? r[cA] : "",
      question: cQ >= 0 ? r[cQ] : "",
      faq: cF >= 0 && /^(да|yes|1|true|✓|v)$/i.test(r[cF] || ""),
      hide: cH >= 0 && /^(да|yes|1|true|✓|v)$/i.test(r[cH] || ""),
    })).filter(a => a.code || (a.faq && a.question));
  }

  // ---------- объявления (лист «Объявления»: Текст | Показывать | Показывать до) ----------
  function parseDate(v) {
    let m = String(v || "").match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/);
    if (m) return new Date(+(m[3].length === 2 ? "20" + m[3] : m[3]), +m[2] - 1, +m[1], 23, 59, 59);
    m = String(v || "").match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    return m ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59) : null;
  }

  function parseAnnouncements(rows) {
    const h = rows.findIndex(r => r.some(c => /^(объявлени[ея]|текст)$/i.test(c)));
    if (h < 0) return [];                          // это не лист объявлений (например, листа ещё нет)
    const head = rows[h].map(c => c.toLowerCase());
    const cT = head.findIndex(c => /^(объявлени[ея]|текст)$/.test(c));
    const cUntil = head.findIndex(c => /(^|\s)до(\s|$)|срок/.test(c));
    const cShow = head.findIndex((c, i) => i !== cUntil && /показ/.test(c));
    const now = new Date();
    return rows.slice(h + 1).filter(r => {
      if (!r[cT]) return false;
      if (cShow >= 0 && /^(нет|no|0|false)$/i.test(r[cShow] || "")) return false;
      const until = cUntil >= 0 ? parseDate(r[cUntil]) : null;
      return !until || until >= now;
    }).map(r => r[cT]);
  }

  const linkify = (s) => esc(s).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)»]/g, u => `<a href="${u}" target="_blank" rel="noopener">${u}</a>`);

  function loadAnnouncements() {
    return fetchSheet(CFG.announcementsSheet || "Объявления")
      .then(t => parseAnnouncements(parseCSV(t)))
      .then(list => {
        if (!list.length) return;
        const box = document.createElement("section");
        box.id = "announcements"; box.className = "ann"; box.setAttribute("aria-label", "Объявления");
        box.innerHTML = list.map(t => `<div class="ann__item"><span class="ann__tag">Объявление</span><p>${linkify(t)}</p></div>`).join("");
        document.querySelector("main").prepend(box);
      })
      .catch(() => { /* объявления необязательны — сайт работает и без них */ });
  }

  async function loadAnswers() {
    try { S.answers = parseAnswers(parseCSV(await fetchSheet(CFG.answersSheet || "Ответы"))); }
    catch { S.answers = []; }
  }

  // ---------- обращения ----------
  const Contact = (() => {
    const C = CFG.contact || {};
    const F = C.fields || {};
    const enabled = !!(C.formId && F.code && F.type && F.name && F.cls && F.message);
    const ALPH = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const LOG = "contactLog", TICKETS = "myTickets";
    const readJSON = (k, d) => { try { return JSON.parse(store.get(k)) ?? d; } catch { return d; } };

    function newCode() {
      const a = new Uint8Array(6); crypto.getRandomValues(a);
      const s = [...a].map(x => ALPH[x % ALPH.length]).join("");
      return s.slice(0, 3) + "-" + s.slice(3);
    }

    function limitLeft() {
      const now = Date.now();
      const log = readJSON(LOG, []).filter(t => now - t < 864e5);
      const cd = (C.cooldownMin ?? 5) * 6e4;
      const last = log.length ? Math.max(...log) : 0;
      if (now - last < cd) return `Следующее обращение можно отправить через ${Math.ceil((cd - (now - last)) / 6e4)} мин.`;
      if (log.length >= (C.perDay ?? 5)) return "Сегодня отправлено максимальное число обращений. Попробуйте завтра.";
      return "";
    }

    function setType(type) {
      $("cf-type").value = type;
      $("cf-error-fields").hidden = type !== "Ошибка в баллах";
      if (type === "Ошибка в баллах") fillCats();
    }

    function fillClasses() {
      const sel = $("cf-cls");
      sel.innerHTML = `<option value="">—</option>` + Object.keys(S.classes)
        .sort((a, b) => a.localeCompare(b, "ru", { numeric: true }))
        .map(k => `<option value="${k}">${prettyClass(k)}</option>`).join("");
      if (S.current) sel.value = S.current;
      $("cf-month").innerHTML = S.months.map(m => `<option>${esc(m.name)}</option>`).join("");
      $("cf-month").value = S.month;
    }

    function fillCats() {
      const m = S.months.find(x => x.name === $("cf-month").value);
      const keep = $("cf-cat").value;
      $("cf-cat").innerHTML = `<option value="">— любая / несколько —</option>` + (m ? m.cats.map(c => `<option>${esc(c)}</option>`).join("") : "");
      $("cf-cat").value = keep;
    }


    function msg(text, kind) { const m = $("cf-msg"); m.textContent = text; m.className = "cform__msg " + (kind || ""); }

    function open(type, opts = {}) {
      setType(type);
      if (S.current) $("cf-cls").value = S.current;
      if (opts.month) { $("cf-month").value = opts.month; fillCats(); }
      document.getElementById("contact").scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(() => $(S.current ? "cf-name" : "cf-cls").focus({ preventScroll: true }), 400);
    }

    function context() {
      const t = $("cf-type").value;
      if (t === "Ошибка в баллах") return `Месяц: ${$("cf-month").value}` + ($("cf-cat").value ? `; категория: ${$("cf-cat").value}` : "");
      return "";
    }

    async function submit(e) {
      e.preventDefault();
      const form = $("contact-form");
      if (form.website.value) { msg("Отправлено.", "ok"); form.reset(); return; }   // ловушка для ботов
      if (!enabled) { msg("Форма ещё не подключена. Попробуйте позже.", "err"); return; }
      const name = $("cf-name").value.trim().replace(/\s+/g, " ");
      const cls = $("cf-cls").value;
      const text = $("cf-message").value.trim();
      const type = $("cf-type").value;
      if (!/^[А-ЯЁа-яёA-Za-z-]{2,}\s[А-ЯЁа-яёA-Za-z-]{2,}/.test(name)) { msg("Укажите фамилию и имя.", "err"); $("cf-name").focus(); return; }
      if (!cls) { msg("Выберите класс.", "err"); $("cf-cls").focus(); return; }
      if (text.length < 10) { msg("Опишите подробнее — хотя бы 10 символов.", "err"); $("cf-message").focus(); return; }
      const wait = limitLeft();
      if (wait) { msg(wait, "err"); return; }

      const code = newCode();
      const body = new URLSearchParams();
      body.append(F.code, code);
      body.append(F.type, type);
      body.append(F.name, name);
      body.append(F.cls, prettyClass(cls));
      if (F.context) body.append(F.context, context());
      body.append(F.message, text || "—");

      const btn = $("cf-submit"); btn.disabled = true; msg("Отправляем…");
      try {
        // Google Форма не отдаёт ответ сайту (no-cors), поэтому успехом считаем отсутствие сетевой ошибки
        await fetch(`https://docs.google.com/forms/d/e/${C.formId}/formResponse`, { method: "POST", mode: "no-cors", body });
      } catch {
        btn.disabled = false; msg("Не удалось отправить — проверьте интернет и попробуйте ещё раз.", "err"); return;
      }
      const log = readJSON(LOG, []); log.push(Date.now()); store.set(LOG, JSON.stringify(log.slice(-20)));
      const tickets = readJSON(TICKETS, []);
      tickets.unshift({ code, type, date: Date.now(), cls, preview: text.slice(0, 80) });
      store.set(TICKETS, JSON.stringify(tickets.slice(0, 20)));
      btn.disabled = false;
      $("cf-message").value = ""; $("cf-count").textContent = "0 / 1000";
      msg(`Отправлено! Код обращения: ${code}. Сохраните его — по нему можно узнать ответ.`, "ok");
      renderTickets();
    }

    function statusOf(code) {
      const a = S.answers.find(x => x.code === code);
      // строка с кодом появляется в «Ответах» сразу после отправки — пока нет статуса и ответа, обращение ждёт
      if (!a || (!a.status && !a.answer)) return { status: "Получено, ещё не рассмотрено", answer: "", kind: "wait" };
      const done = /(рассмотр|готов|выполн|одобр|закры|решен|ответ)/i.test(a.status) || (!a.status && a.answer);
      const no = /(отклон|отказ)/i.test(a.status);
      return { status: a.status || "Есть ответ", answer: a.answer, kind: no ? "no" : done ? "done" : "wait" };
    }

    // Убираем из списка на устройстве обращения, которые самоуправление скрыло (флажок «Скрыть у пользователя»)
    // или удалило из таблицы. Удалённые проверяем только у обращений старше часа: «Ответы» обновляются с задержкой.
    function prune() {
      if (!S.answers.some(a => a.code)) return;          // лист не загрузился — ничего не удаляем
      const tickets = readJSON(TICKETS, []);
      const left = tickets.filter(t => {
        const a = S.answers.find(x => x.code === t.code);
        if (a) return !a.hide;
        return !t.date || Date.now() - t.date < 36e5;
      });
      if (left.length !== tickets.length) store.set(TICKETS, JSON.stringify(left));
    }


    function renderTickets(extra) {
      prune();
      const tickets = readJSON(TICKETS, []);
      if (extra && S.answers.some(a => a.code === extra && a.hide)) extra = null;
      if (extra && !tickets.some(t => t.code === extra)) tickets.unshift({ code: extra, type: "Обращение", date: null, preview: "" });
      $("ticket-list").innerHTML = tickets.length ? tickets.map(t => {
        const st = statusOf(t.code);
        const known = S.answers.some(a => a.code === t.code);
        return `<li class="ticket ${st.kind}">
          <div class="ticket__top"><b>${t.code}</b><span class="badge ${st.kind}">${esc(known || t.date ? st.status : "Код не найден")}</span>
            <button type="button" class="ticket__x" data-remove="${t.code}" aria-label="Убрать ${t.code} из списка" title="Убрать из списка">×</button></div>
          <div class="ticket__meta">${esc(t.type)}${t.date ? " · " + new Date(t.date).toLocaleDateString("ru-RU") : ""}${t.preview ? " · " + esc(t.preview) : ""}</div>
          ${st.answer ? `<p class="ticket__answer">${linkify(st.answer)}</p>` : ""}
        </li>`;
      }).join("") + (tickets.length > 1 ? `<li class="ticket-clear"><button type="button" class="linkbtn" data-clear>Очистить список</button></li>` : "")
        : `<li class="muted">Здесь появятся ваши обращения с этого устройства.</li>`;
    }

    function onListClick(e) {
      const rm = e.target.closest("[data-remove]");
      if (rm) {
        store.set(TICKETS, JSON.stringify(readJSON(TICKETS, []).filter(t => t.code !== rm.dataset.remove)));
        renderTickets(); return;
      }
      if (e.target.closest("[data-clear]")) { store.set(TICKETS, "[]"); renderTickets(); }
    }

    function syncClass() {
      if (S.current && !$("cf-cls").value) $("cf-cls").value = S.current;
    }

    function init() {
      fillClasses();
      setType("Вопрос");
      if (!enabled) msg("Форма скоро заработает.", "");
      $("cf-type").addEventListener("change", e => setType(e.target.value));
      $("cf-month").addEventListener("change", fillCats);
      $("cf-message").addEventListener("input", e => { $("cf-count").textContent = `${e.target.value.length} / 1000`; });
      $("contact-form").addEventListener("submit", submit);
      $("ticket-form").addEventListener("submit", async e => {
        e.preventDefault();
        const code = normCode($("ticket-code").value);
        if (!/^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(code)) { $("ticket-code").focus(); return; }
        if (window.Quest?.ticket?.(code)) { $("ticket-code").value = ""; return; }
        await loadAnswers(); renderFaq();
        renderTickets(code);
        $("ticket-code").value = "";
      });
      $("ticket-list").addEventListener("click", onListClick);
      renderTickets();
    }

    // отправка в форму из других модулей (пасхалка); возвращает код обращения
    async function send({ type, name, cls, context, message }) {
      if (!enabled) throw new Error("Форма не подключена");
      const code = newCode();
      const body = new URLSearchParams();
      body.append(F.code, code); body.append(F.type, type); body.append(F.name, name);
      body.append(F.cls, prettyClass(cls)); if (F.context) body.append(F.context, context || ""); body.append(F.message, message || "—");
      await fetch(`https://docs.google.com/forms/d/e/${C.formId}/formResponse`, { method: "POST", mode: "no-cors", body });
      const tickets = readJSON(TICKETS, []);
      tickets.unshift({ code, type, date: Date.now(), cls, preview: (message || "").slice(0, 80) });
      store.set(TICKETS, JSON.stringify(tickets.slice(0, 20)));
      renderTickets();
      return code;
    }

    return { init, open, renderTickets, syncClass, newCode, send };
  })();

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
      box.innerHTML = `<p class="muted">Список наград скоро появится.</p>`; window.Quest?.decorateRewards?.(); return;
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
    window.Quest?.decorateRewards?.();
  }

  function renderRating() {
    let keys = Object.keys(S.classes);
    if (S.tab !== "all") keys = keys.filter(k => parallelOf(k) === +S.tab);
    keys.sort((a, b) => S.classes[b].year - S.classes[a].year || a.localeCompare(b, "ru", { numeric: true }));
    $("rating-body").innerHTML = keys.map(k => {
      const c = S.classes[k];
      const place = S.tab === "all" ? c.rank : c.rankPar;
      const medal = place <= 3 ? `<span class="medal">${place}</span>` : place;
      const d = S.tab === "all" ? c.delta : c.deltaPar;
      const delta = !d ? `<span class="delta">–</span>` : d > 0
        ? `<span class="delta up" title="Поднялся на ${d}">▲${d}</span>` : `<span class="delta down" title="Опустился на ${-d}">▼${-d}</span>`;
      return `<tr data-k="${k}" class="${k === S.current ? "me" : ""}"><td>${medal}</td><td>${prettyClass(k)}</td>
        <td class="hide-sm">${esc(c.teacher)}</td><td>${c.year}</td><td class="hide-sm">${S.months.length >= 2 ? delta : "–"}</td><td class="hide-sm">${c.spent}</td><td>${c.balance}</td></tr>`;
    }).join("");
    window.Quest?.decorateRating?.();
  }

  function renderLeaders() {
    const m = S.months.find(x => x.name === S.month);
    const sec = $("leaders-section");
    const list = m ? Object.entries(m.classes).filter(([, v]) => v.total > 0).sort((a, b) => b[1].total - a[1].total) : [];
    if (!list.length) { sec.hidden = true; return; }
    sec.hidden = false;
    $("leaders-month").textContent = S.month.toLowerCase();
    // топ-3 с учётом равных баллов
    const top = [];
    for (const [k, v] of list) {
      const place = 1 + list.filter(([, x]) => x.total > v.total).length;
      if (place > 3) break;
      top.push({ k, v, place });
    }
    $("podium").innerHTML = top.map(t => `<li class="p${t.place} ${t.k === S.current ? "me" : ""}" data-k="${t.k}">
      <span class="podium__place">${t.place}</span><span class="podium__cls">${prettyClass(t.k)}</span>
      <span class="podium__pts">${t.v.total} баллов</span></li>`).join("");
    const pars = {};
    for (const [k, v] of list) { const p = parallelOf(k); if (!pars[p] || pars[p][0].total === v.total) (pars[p] ||= []).push({ k, total: v.total }); }
    $("par-leaders").innerHTML = Object.keys(pars).sort((a, b) => a - b).map(p =>
      `<span class="chip"><b>${p} кл.</b> ${pars[p].map(x => prettyClass(x.k)).join(", ")} · ${pars[p][0].total}</span>`).join("");
  }

  function renderRules() {
    const sec = $("rules-section");
    sec.hidden = !S.rules.length;
    syncNav();
    if (!S.rules.length) return;
    $("rules").innerHTML = S.rules.map(r => `<div class="rule">
      <div class="rule__head"><h3>${esc(r.name)}</h3>${r.max ? `<span class="price">до ${esc(r.max)}</span>` : ""}</div>
      <p>${linkify(r.desc)}</p></div>`).join("");
  }

  function renderFaq() {
    const items = S.answers.filter(a => a.faq && a.question && a.answer);
    $("faq-section").hidden = !items.length;
    syncNav();
    $("faq").innerHTML = items.map(a => `<details><summary>${esc(a.question)}</summary><p>${linkify(a.answer)}</p></details>`).join("");
  }

  function syncNav() {
    document.querySelectorAll(".nav a[data-optional]").forEach(a => {
      const sec = document.querySelector(a.getAttribute("href"));
      a.hidden = !sec || sec.hidden;
    });
  }

  function renderAll() { renderClass(); renderLeaders(); renderRewards(); renderRating(); Contact.syncClass(); }

  function selectClass(k) {
    S.current = k && S.classes[k] ? k : null;
    $("class-select").value = S.current || "";
    if (S.current) { store.set("myClass", S.current); history.replaceState(null, "", "#" + encodeURIComponent(prettyClass(S.current))); }
    renderAll();
  }

  // доступ для пасхалки (quest.js)
  window.Rating = { S, CFG, fetchSheet, parseCSV, esc, prettyClass, normClass, store, renderAll, newCode: () => Contact.newCode(), send: (...a) => Contact.send(...a) };

  // ---------- init ----------
  syncNav();
  loadAnnouncements();
  load().then(() => {
    fillSelects();
    document.dispatchEvent(new Event("rating:ready"));
    $("status").textContent = "";
    $("class-select").addEventListener("change", e => selectClass(e.target.value));
    $("month-select").addEventListener("change", e => { S.month = e.target.value; renderClass(); renderLeaders(); });
    $("podium").addEventListener("click", e => {
      const li = e.target.closest("li[data-k]"); if (li) selectClass(li.dataset.k);
    });
    $("dispute-btn").addEventListener("click", () => Contact.open("Ошибка в баллах", { month: S.month }));
    Contact.init();
    fetchSheet(CFG.rulesSheet || "Правила").then(t => { S.rules = parseRules(parseCSV(t)); renderRules(); }).catch(() => renderRules());
    loadAnswers().then(() => { renderFaq(); Contact.renderTickets(); });
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
