// ======================================================================
//  ПАСХАЛКА-КВЕСТ. Включается/выключается на листе «Квест» таблицы баллов.
//  Шаги 2–5 зашифрованы ответами предыдущих шагов — подсмотреть их в коде нельзя.
// ======================================================================
(() => {
  "use strict";
  const DATA = {"first":{"text":"Пасхалка найдена. Пять шагов. Первый, кто дойдёт до конца, принесёт своему классу 7 баллов.\n\nШаг 1. Сайт уже не тот, что минуту назад.","fx":{"type":"letters","letters":[["#site-title","В"],["label[for=class-select]","М"],["#rewards-section h2","Е"],["#rating-section h2","С"],["#contact h2","Т"],[".foot","Е"]]}},"locked":["lkXQ7UtJYZG8MYm8GDLadaDseHOuWsM43lmcWHBXeUQ2iFoA11VGXI1M0xdOiIzux54UPCcX42OCszc2glnGAFfCPzueYH900qIGmQSXy+/CDuUjqd+XgfcVI6fl6cF5R87lMytBc8RNFdoBPS3f1WomifVoOQgDwbPcqjnkG/fcen1S3SSsLWiPGiDjbuKFGCWE7+Y04WkThcJ5Jg==","P+YQozCM/HTjSbA+Z71t+QjnH4hd/AveVlAxj0fhAQzMS5qpqLFUz8t9yt/LbjrQx/wemMiMU20L6T+wcVQo198DADqzgkGLbUiD3iNzvXWP64Ug6WxPuvF3APiwvEwo90FVeZPndvHLD0QPrBBcsWk0nNvqmbK7ug2dE6lEtwBOX6qHRxDAwWXCRIfDqy5zeC91eNRxgicMJLX9g2EkFWp6OsMIewbv3Jsu4VhU8vmS9cILnTbCgkdtC61YtxXT6GIVkWrvviSh1RYZ+o9+36EuMGWXlw==","UMnbxFy1TpyEvRsneRkuVfJ7uDG0v3vfFxBC3E+5aKkbyIBHR8Z8A6hwGjmpyRCgUw8P1NKzF3bbcgcB5wYdC7etpxM5/qDWjP8L4nCr5r4X0/WPiKsg4o9q5/gfeDnkgObdJ8vPImErqsNtRsLlJ+CUa4q2JZXsp1h9STDDRoJ3CO0=","MlwLsCUcfEYB13Oslg6k8fu/t3A48tpJ+//Feq+a9XKPYkla+anCUHGikflhxCNc1+NbkGnvgKOImumjpMAsEvUMPcCf4xGWBgab8AbpIUsewr+kz6hPBun7bLXK9HrwoqmWIgeS36p3llvwCM84cbH+qpYSN/dtnqIEl3GgLHwo9Oa2Ze9dUclzkauBrLH/fS3g681+pX2KE4S6Mj1Cr4uN3D6VSs1yQ7Szk8l1LskwUIfRv9LG7fRUyItPpNKK4oc=","UM3eXkNWOC3p4hLh0iqc/9qJQUiazRvZK7Ig4EyfTgeZP21MS5J5BYe+B27Ro+r8xab5STxUKYraINyIgqXWaR9tvBNqB0/owrRlCEmiWrISCxtzsTsLdeciWa7+YyTrT3zaUNGENvGxPDp/s3ZpIGc9N9tQ/p0pDNSINF4csnEN3c7Tthq3jXnFOEVKOOVoyfoQ9ATk60dYj1YAlK1YNfaFZJRY38h+HvKRxGnMmkHFaQM+TWMR5nVii59x+pEd29rav+uHwqQK5CKKM63+2TS4DWC4gAPHpFQWrR6WEXBxB3WqrQ=="]};
  const LS = "quest16-2";
  const TOTAL = 5;
  const norm = (s) => String(s || "").toUpperCase().replace(/Ё/g, "Е").replace(/[^A-ZА-Я0-9]/g, "");
  const enc = new TextEncoder();
  let R = null, enabled = false, winner = "", answers = [], payloads = [DATA.first], started = false, done = null;

  const read = () => { try { return JSON.parse(R.store.get(LS)) || {}; } catch { return {}; } };
  const save = () => R.store.set(LS, JSON.stringify({ started, answers, done }));

  async function keyFor(ans) {
    const h = await crypto.subtle.digest("SHA-256", enc.encode("gym16-quest|" + ans.map(norm).join("|")));
    return crypto.subtle.importKey("raw", h, "AES-GCM", false, ["decrypt"]);
  }
  async function unlock(ans) {
    const raw = Uint8Array.from(atob(DATA.locked[ans.length - 1]), c => c.charCodeAt(0));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.slice(0, 12) }, await keyFor(ans), raw.slice(12));
    return JSON.parse(new TextDecoder().decode(pt));
  }

  const active = () => enabled && !winner && !done && started;
  const fx = (type) => payloads.find(p => p.fx && p.fx.type === type)?.fx;
  const current = () => payloads[payloads.length - 1];

  // ---------- эффекты на странице ----------
  function applyFx() {
    document.querySelectorAll(".q-fx").forEach(e => e.remove());
    document.body.classList.toggle("quest-on", active());
    if (!active()) return;
    const l = fx("letters");
    if (l) for (const [sel, ch] of l.letters) {
      const el = document.querySelector(sel);
      if (el) el.insertAdjacentHTML("beforeend", ` <span class="qletter q-fx" aria-hidden="true">${ch}</span>`);
    }
    decorateRating(); decorateRewards();
  }
  function decorateRating() {
    document.querySelectorAll("#rating-body .q-fx").forEach(e => e.remove());
    const f = active() && fx("fakeRow"); if (!f) return;
    // «чужой» класс прячется в середине таблицы и выглядит как обычная строка
    const body = document.getElementById("rating-body");
    const rows = [...body.children];
    const ref = rows[Math.floor(rows.length / 2)] || null;
    const pts = ref ? ref.children[3].textContent : "0";
    const place = ref ? ref.children[0].textContent : "1";
    const tr = document.createElement("tr");
    tr.className = "q-fx";
    tr.innerHTML = `<td>${R.esc(place)}</td><td>${R.esc(f.cls)}</td><td class="hide-sm">${R.esc(f.teacher)}</td><td>${R.esc(pts)}</td><td class="hide-sm"><span class="delta">–</span></td><td class="hide-sm">0</td><td>${R.esc(pts)}</td>`;
    body.insertBefore(tr, ref);
  }
  function decorateRewards() {
    document.querySelectorAll("#rewards .q-fx").forEach(e => e.remove());
    const f = active() && fx("secretReward"); if (!f) return;
    const box = document.getElementById("rewards");
    box.querySelector(":scope > p.muted")?.remove();
    box.insertAdjacentHTML("beforeend",
      `<div class="reward q-fx"><span class="price">${R.esc(f.price)} баллов</span><h3>${R.esc(f.name)}</h3><p>${R.esc(f.desc)}</p></div>`);
  }
  function ticket(code) {
    const f = active() && fx("ticket");
    if (!f || code !== f.code) return false;
    const list = document.getElementById("ticket-list");
    list.querySelector(".qticket")?.remove();
    list.insertAdjacentHTML("afterbegin", `<li class="ticket done qticket q-fx"><div class="ticket__top"><b>${f.code}</b><span class="badge done">${R.esc(f.status)}</span></div>
      <div class="ticket__meta">Обращение</div><p class="ticket__answer">${R.esc(f.answer)}</p></li>`);
    return true;
  }

  // ---------- окно квеста ----------
  let dlg;
  function ensureDialog() {
    if (dlg) return dlg;
    dlg = document.createElement("dialog");
    dlg.className = "quest"; dlg.setAttribute("aria-label", "Квест");
    document.body.appendChild(dlg);
    dlg.addEventListener("click", e => { if (e.target === dlg || e.target.closest("[data-close]")) dlg.close(); });
    return dlg;
  }
  const head = (title) => `<button class="quest__x" data-close aria-label="Закрыть">×</button><div class="quest__star">✦</div><h2>${title}</h2>`;

  function render(msg = "", kind = "") {
    const d = ensureDialog();
    const note = msg ? `<p class="quest__msg ${kind}">${R.esc(msg)}</p>` : "";
    if (winner) { d.innerHTML = head("Квест уже пройден") + `<p>Первым квест прошёл класс <b>${R.esc(winner)}</b> и получил 7 баллов. Следите за новыми пасхалками!</p>`; return; }
    if (done) { d.innerHTML = head("Квест пройден!") + `<p>Ты уже прошёл квест. Код обращения: <b class="mono">${R.esc(done.code)}</b>.</p><p class="muted">Самоуправление проверит, был ли ты первым, и ответит в блоке «Мои обращения».</p>`; return; }
    const cur = current();
    if (cur.final) {
      const opts = Object.keys(R.S.classes).sort((a, b) => a.localeCompare(b, "ru", { numeric: true }))
        .map(k => `<option value="${k}" ${k === R.S.current ? "selected" : ""}>${R.prettyClass(k)}</option>`).join("");
      d.innerHTML = head("Финал") + `<p>${R.esc(cur.text)}</p>
        <form class="quest__form" id="q-final">
          <input id="q-name" placeholder="Фамилия Имя" maxlength="60" autocomplete="name">
          <select id="q-cls"><option value="">Класс</option>${opts}</select>
          <button class="btn" type="submit">Отправить</button>
        </form>${note}`;
      d.querySelector("#q-final").addEventListener("submit", finish);
      return;
    }
    d.innerHTML = head(`Шаг ${answers.length + 1} из ${TOTAL}`) +
      `<div class="quest__bar"><span style="width:${answers.length / TOTAL * 100}%"></span></div>
       <p class="quest__text">${R.esc(cur.text)}</p>
       <form class="quest__form" id="q-step"><input id="q-answer" placeholder="Ответ" autocomplete="off"><button class="btn" type="submit">Проверить</button></form>
       ${note}<p class="muted quest__hint">Окно можно закрыть: прогресс сохранится на этом устройстве. Снова открыть — пять нажатий на звезду.</p>`;
    d.querySelector("#q-step").addEventListener("submit", check);
  }

  let busy = false;
  async function check(e) {
    e.preventDefault();
    if (busy) return;
    const val = document.getElementById("q-answer").value;
    if (!norm(val)) return;
    busy = true;
    try {
      const next = await unlock([...answers, val]);
      answers.push(val); payloads.push(next); save();
      R.renderAll(); applyFx(); render("Верно!", "ok");
    } catch {
      await new Promise(r => setTimeout(r, 1200));   // притормаживаем перебор
      render("Неверно. Попробуй ещё раз.", "err");
    } finally { busy = false; }
    document.getElementById("q-answer")?.focus();
  }

  async function finish(e) {
    e.preventDefault();
    if (busy) return;
    const name = document.getElementById("q-name").value.trim().replace(/\s+/g, " ");
    const cls = document.getElementById("q-cls").value;
    if (!/^[А-ЯЁа-яёA-Za-z-]{2,}\s[А-ЯЁа-яёA-Za-z-]{2,}/.test(name)) { render("Укажи фамилию и имя.", "err"); return; }
    if (!cls) { render("Выбери класс.", "err"); return; }
    busy = true;
    try {
      const code = await R.send({ type: "Квест", name, cls, context: current().token, message: "Квест пройден" });
      done = { code, date: Date.now() }; save(); applyFx(); render();
    } catch { render("Не удалось отправить — проверь интернет и попробуй ещё раз.", "err"); }
    finally { busy = false; }
  }

  async function open() {
    if (!enabled) return;
    if (!started && !winner && !done) { started = true; save(); applyFx(); }
    render();
    if (!dlg.open) dlg.showModal();
    dlg.querySelector("input")?.focus();
  }

  // ---------- загрузка ----------
  async function init() {
    R = window.Rating;
    const st = read();
    started = !!st.started; done = st.done || null;
    for (const a of st.answers || []) {
      try { payloads.push(await unlock([...answers, a])); answers.push(a); } catch { break; }
    }
    try {
      const rows = R.parseCSV(await R.fetchSheet(R.CFG.questSheet || "Квест"));
      for (const r of rows) {
        if (/^\s*(квест\s+)?включ/i.test(r[0] || "")) enabled = /^\s*(да|вкл|yes|1|true|✓)/i.test(r[1] || "");
        if (/^\s*победит/i.test(r[0] || "")) winner = /^#|^\s*(нет|—|-)?\s*$/i.test(r[1] || "") ? "" : r[1].trim();
      }
    } catch { enabled = false; }
    applyFx();
    let clicks = 0, timer;
    document.querySelector(".seal")?.addEventListener("click", () => {
      clearTimeout(timer); timer = setTimeout(() => (clicks = 0), 1500);
      if (++clicks >= 5) { clicks = 0; open(); }
    });
  }

  window.Quest = { decorateRating, decorateRewards, ticket };
  if (window.Rating?.S?.months?.length) init(); else document.addEventListener("rating:ready", init, { once: true });
})();
