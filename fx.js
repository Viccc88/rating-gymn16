// ======================================================================
//  Анимации и графика сайта: лавровые венки, счётчики, конфетти, перестановка строк.
//  Если у посетителя включено «уменьшение движения», всё показывается сразу.
// ======================================================================
(() => {
  "use strict";
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  const still = () => reduce.matches;

  // ---------- лавровый венок (SVG) ----------
  // Две ветви по дуге, листья парами. У каждого листа --i — порядковый номер для задержки анимации.
  function laurel({ size = 120, leaves = 9, r = 40, stroke = 2.2, cls = "" } = {}) {
    const c = 50, out = [], stems = [];
    let i = 0;
    const branch = (dir) => {
      // dir = -1 левая ветвь, 1 правая. Угол 0° — низ венка, растём вверх.
      const from = 18, to = 158;
      const pts = [];
      for (let k = 0; k <= 24; k++) {
        const a = (from + (to - from) * k / 24) * Math.PI / 180;
        pts.push([c + dir * Math.sin(a) * r, c + Math.cos(a) * r]);
      }
      stems.push(`<path class="stem" pathLength="1" d="M${pts.map(p => p.map(v => v.toFixed(2)).join(" ")).join(" L")}"/>`);
      for (let k = 0; k < leaves; k++) {
        const t = (k + 0.6) / (leaves + 0.2);
        const a = (from + (to - from) * t) * Math.PI / 180;
        const x = c + dir * Math.sin(a) * r, y = c + Math.cos(a) * r;
        // касательная к дуге (направление роста ветви)
        const tx = dir * Math.cos(a), ty = -Math.sin(a);
        const base = Math.atan2(ty, tx) * 180 / Math.PI;
        const len = 11 - k * 0.45;
        for (const side of [-1, 1]) {
          const rot = base + side * 36;
          out.push(`<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${rot.toFixed(1)})"><path class="lf" style="--i:${i}" d="M0 0 Q${(len * .45).toFixed(1)} ${(-len * .32).toFixed(1)} ${len.toFixed(1)} 0 Q${(len * .45).toFixed(1)} ${(len * .32).toFixed(1)} 0 0Z"/></g>`);
        }
        i++;
      }
    };
    branch(-1); branch(1);
    return `<svg class="laurel ${cls}" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true" style="--sw:${stroke}">
      <g class="stems">${stems.join("")}</g><g class="leaves">${out.join("")}</g></svg>`;
  }

  // ---------- счётчик ----------
  function countUp(el, to, { dur = 900, delay = 0 } = {}) {
    if (!el) return;
    to = Math.round(+to || 0);
    if (still() || to === 0) { el.textContent = to; return; }
    const from = 0, tok = (el._tok = (el._tok || 0) + 1);
    cancelAnimationFrame(el._raf);
    el.textContent = from;
    // пока виден экран загрузки, счётчик ждёт — иначе он «отыграет» невидимым
    const ready = window.Loader ? window.Loader.whenDone() : Promise.resolve();
    ready.then(() => {
      if (tok !== el._tok) return;
      const t0 = performance.now() + delay;
      const step = (now) => {
        const p = Math.min(1, Math.max(0, (now - t0) / dur));
        const e = 1 - Math.pow(1 - p, 4);
        el.textContent = Math.round(from + (to - from) * e);
        if (p < 1) el._raf = requestAnimationFrame(step);
      };
      el._raf = requestAnimationFrame(step);
    });
  }

  // ---------- конфетти ----------
  function confetti(target, { count = 90, colors = ["#d8b25a", "#f4e3ad", "#ffffff", "#b9bec6", "#9c7a33"] } = {}) {
    if (still() || !target) return;
    const box = target.getBoundingClientRect();
    const cv = document.createElement("canvas");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.className = "confetti";
    cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
    document.body.appendChild(cv);
    const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr);
    const ox = box.left + box.width / 2, oy = box.top + box.height * 0.35;
    const ps = Array.from({ length: count }, () => {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, v = 6 + Math.random() * 9;
      return { x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, w: 5 + Math.random() * 6, h: 3 + Math.random() * 4,
        r: Math.random() * 6, vr: (Math.random() - .5) * .4, c: colors[(Math.random() * colors.length) | 0] };
    });
    const t0 = performance.now();
    const frame = (now) => {
      const t = now - t0;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of ps) {
        p.vy += 0.32; p.vx *= 0.985; p.vy *= 0.985; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.globalAlpha = Math.max(0, 1 - t / 2200);
        ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 2)));
        ctx.restore();
      }
      if (t < 2200) requestAnimationFrame(frame); else cv.remove();
    };
    requestAnimationFrame(frame);
  }

  // ---------- перестановка строк (FLIP) ----------
  function snapshot(container, attr = "k") {
    const map = new Map();
    container.querySelectorAll(`[data-${attr}]`).forEach(el => map.set(el.dataset[attr], el.getBoundingClientRect().top));
    return map;
  }
  function flip(container, before, attr = "k") {
    if (still() || !before.size) return;
    container.querySelectorAll(`[data-${attr}]`).forEach((el, i) => {
      const old = before.get(el.dataset[attr]);
      if (old === undefined) {
        el.animate([{ opacity: 0, transform: "translateX(-12px)" }, { opacity: 1, transform: "none" }],
          { duration: 380, delay: Math.min(i, 12) * 18, easing: "cubic-bezier(.2,.7,.2,1)", fill: "backwards" });
        return;
      }
      const dy = old - el.getBoundingClientRect().top;
      if (Math.abs(dy) < 1) return;
      el.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }],
        { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)" });
    });
  }

  // ---------- появление при прокрутке (один раз) ----------
  function onFirstView(el, cb, threshold = 0.15) {
    if (!el) return;
    if (still() || !("IntersectionObserver" in window)) { cb(); return; }
    const io = new IntersectionObserver((ents) => {
      if (ents.some(e => e.isIntersecting)) { io.disconnect(); cb(); }
    }, { threshold });
    io.observe(el);
  }

  // ---------- параллакс венка в шапке ----------
  function parallax() {
    const bg = document.querySelector(".top__bg");
    if (!bg || still()) return;
    let queued = false;
    const apply = () => {
      queued = false;
      const y = Math.min(scrollY, 1200);           // ниже шапки двигать незачем
      bg.style.transform = `translate3d(0, ${y * 0.25}px, 0) rotate(${y * 0.03}deg)`;
    };
    addEventListener("scroll", () => { if (!queued) { queued = true; requestAnimationFrame(apply); } }, { passive: true });
  }

  window.FX = { laurel, countUp, confetti, snapshot, flip, onFirstView, still };
  // класс fx включает «стартовые» состояния анимаций только когда этот скрипт реально работает
  if (!still()) document.documentElement.classList.add("fx");
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".block").forEach(sec => onFirstView(sec, () => sec.classList.add("in"), 0.08));
    // венки в печати и на фоне шапки
    const seal = document.querySelector(".top .seal__wreath");
    if (seal) seal.innerHTML = laurel({ size: 56, leaves: 7, r: 41, cls: "laurel--seal" });
    const bg = document.querySelector(".top__bg");
    if (bg) bg.innerHTML = laurel({ size: 900, leaves: 11, r: 42, cls: "laurel--bg" });
    parallax();
  });
})();
