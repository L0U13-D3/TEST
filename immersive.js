/* ==========================================================
   SHARP immersive layer
   Loaded at the end of <body>, after the page router.

   Global (runs once):  loader, cursor ring + coordinates,
                        scroll progress, sticky-header state
   Per page (re-runs every time the router renders):
                        reveals, hero canvas, scrubbed words,
                        sticky chapters, counters, timeline,
                        parallax, tilt, magnetic buttons

   If the visitor prefers reduced motion, the <head> script never
   adds the "js" class and every effect below stays off.
   ========================================================== */
(() => {
  'use strict';

  const H = document.documentElement;
  window.__imm = true;                                   // tells the <head> failsafe we loaded

  const motion = H.classList.contains('js');             // motion allowed?
  const fine = matchMedia('(pointer:fine)').matches && matchMedia('(hover:hover)').matches;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const pad = (n, l = 4) => String(Math.round(n)).padStart(l, '0');

  let scrollFns = [];      // per-page scroll work
  let cleanups = [];       // per-page teardown
  let ready = false;       // loader finished?
  let ticking = false;


  /* ---------- scroll loop (one rAF-throttled listener) ---------- */

  const prog = $('#prog');
  const hdr = $('header');

  function globalScroll() {
    const max = H.scrollHeight - innerHeight;
    if (prog) prog.style.transform = 'scaleX(' + (max > 0 ? clamp(scrollY / max) : 0) + ')';
    if (hdr) hdr.classList.toggle('stuck', scrollY > 10);
  }

  function runScroll() {
    globalScroll();
    scrollFns.forEach(f => f());
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; runScroll(); });
  }

  addEventListener('scroll', onScroll, { passive: true });
  addEventListener('resize', onScroll);


  /* ---------- cursor ring + X/Y readout (mouse only) ---------- */

  if (motion && fine) {
    const cur = $('#cur'), hud = $('#hud');
    if (cur && hud) {
      let x = innerWidth / 2, y = innerHeight / 2, cx = x, cy = y;
      H.classList.add('has-cur');
      addEventListener('pointermove', e => {
        x = e.clientX; y = e.clientY;
        hud.textContent = 'X:' + pad(x) + 'PX  Y:' + pad(y) + 'PX';
        cur.classList.toggle('hot', !!(e.target.closest && e.target.closest('a,button,.pane,.tilt,input,select,textarea')));
      }, { passive: true });
      (function loop() {
        cx += (x - cx) * .18;
        cy += (y - cy) * .18;
        cur.style.transform = 'translate(' + cx + 'px,' + cy + 'px)';
        requestAnimationFrame(loop);
      })();
    }
  }


  /* ---------- loader (first visit of the session, home page only) ---------- */

  function startLoader(done) {
    const loader = $('#loader');
    if (!motion || !loader || !H.classList.contains('loading')) { done(); return; }

    const num = $('#ld-n'), bar = $('#ld-bar'), lines = $$('#ld-list li');
    const dur = 2100, t0 = performance.now();

    (function step(now) {
      const p = clamp((now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 2.2);
      const v = Math.round(e * 100);
      num.textContent = v + '%';
      bar.style.transform = 'scaleX(' + e + ')';
      lines.forEach((li, i) => li.classList.toggle('on', v >= (i + 1) * 10 - 4));
      if (p < 1) { requestAnimationFrame(step); return; }

      loader.classList.add('out');
      setTimeout(done, 450);                              // hero text starts as the curtain lifts
      setTimeout(() => H.classList.remove('loading'), 950);
      try { sessionStorage.setItem('sharp-seen', '1'); } catch (err) { /* private mode */ }
    })(t0);
  }

  // Adds .play to hero + page-title blocks so their headline lines slide up
  function playAll() {
    requestAnimationFrame(() => $$('.hero,.page-hd').forEach(el => el.classList.add('play')));
  }


  /* ---------- helpers for per-page work ---------- */

  function observe(cb, opts) {
    const io = new IntersectionObserver(cb, opts);
    cleanups.push(() => io.disconnect());
    return io;
  }


  /* ---------- reveal on scroll ---------- */

  function reveal() {
    if (!motion) return;

    // Academics page: tag elements so the markup stays simple
    $$('.page-hd .crumb,.page-hd .tabs,.layout .ph.big,.layout .ttl,.layout h3.s,.yrs .card,.fac .card,.side,.explore .wrap')
      .forEach(el => el.setAttribute('data-r', ''));

    const io = observe(entries => entries.forEach(e => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { threshold: .12, rootMargin: '0px 0px -6% 0px' });

    $$('[data-r]').forEach(el => {
      const sibs = Array.from(el.parentElement.children).filter(c => c.hasAttribute('data-r'));
      el.style.setProperty('--d', (Math.min(sibs.indexOf(el), 5) * .08) + 's');   // small stagger
      io.observe(el);
    });
  }


  /* ---------- hero canvas: dot grid + live heartbeat ---------- */

  function heroCanvas() {
    const cv = $('#heroCv');
    if (!cv) return;
    const box = cv.parentElement, ctx = cv.getContext('2d');

    let w = 0, h = 0, dpr = 1, gap = 30, grad = null;
    let mx = 0, my = 0, tx = 0, ty = 0, user = false;
    let ripples = [], run = false, raf = 0, inView = true, lastBeat = 0;
    const t0 = performance.now();

    const G = (x, m, s) => Math.exp(-((x - m) * (x - m)) / (2 * s * s));
    // One heartbeat: P wave, Q dip, R spike, S dip, T wave
    const beat = p => .12 * G(p, .18, .035) - .14 * G(p, .36, .008) + G(p, .40, .011) - .32 * G(p, .445, .011) + .26 * G(p, .66, .05);

    function size() {
      dpr = Math.min(devicePixelRatio || 1, 2);
      w = box.clientWidth; h = box.clientHeight;
      cv.width = w * dpr; cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      gap = w < 700 ? 24 : 30;
      grad = ctx.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, 'rgba(51,204,153,0)');
      grad.addColorStop(.25, 'rgba(51,204,153,.9)');
      grad.addColorStop(.8, 'rgba(120,255,210,1)');
      grad.addColorStop(1, 'rgba(51,204,153,0)');
      if (!user) { tx = mx = w * .7; ty = my = h * .4; }
    }

    function draw(now) {
      const t = (now - t0) / 1000;
      if (!user) { tx = w * (.62 + .2 * Math.sin(t * .45)); ty = h * (.45 + .2 * Math.cos(t * .33)); }
      mx += (tx - mx) * .1; my += (ty - my) * .1;
      if (now - lastBeat > 3800) { lastBeat = now; ripples.push({ x: w * .72, y: h * .5, r: 0, a: 1 }); }

      ctx.clearRect(0, 0, w, h);

      // dots: glow near the cursor and along expanding pulse rings
      const cols = Math.ceil(w / gap), rows = Math.ceil(h / gap);
      for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
          const x = i * gap + gap / 2, y = j * gap + gap / 2;
          let a = .12, r = 1.1;
          const dx = x - mx, dy = y - my, d2 = dx * dx + dy * dy;
          if (d2 < 48400) { const k = 1 - Math.sqrt(d2) / 220; a += k * .65; r += k * 1.7; }
          for (let q = 0; q < ripples.length; q++) {
            const rp = ripples[q];
            const dd = Math.abs(Math.hypot(x - rp.x, y - rp.y) - rp.r);
            if (dd < 46) { const k = (1 - dd / 46) * rp.a; a += k * .8; r += k * 2; }
          }
          ctx.fillStyle = 'rgba(51,204,153,' + Math.min(a, 1).toFixed(2) + ')';
          ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
        }
      }
      ripples.forEach(rp => { rp.r += 6; rp.a *= .988; });
      ripples = ripples.filter(rp => rp.a > .05 && rp.r < Math.max(w, h) * 1.3);

      // heartbeat line: scrolls left, spikes taller near the cursor
      const base = h * .64, A = Math.min(h * .2, 150), P = Math.max(360, w * .32);
      ctx.beginPath();
      for (let x = 0; x <= w; x += 3) {
        const p = (((x + t * 150) / P) % 1 + 1) % 1;
        const y = base - beat(p) * A * (1 + 1.1 * G(x, mx, 150));
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = grad; ctx.lineWidth = 2;
      ctx.shadowColor = 'rgba(51,204,153,.9)'; ctx.shadowBlur = 14;
      ctx.stroke(); ctx.shadowBlur = 0;
    }

    const loop = now => { if (!run) return; draw(now); raf = requestAnimationFrame(loop); };
    const update = () => {
      run = motion && inView && !document.hidden;
      cancelAnimationFrame(raf);
      if (run) raf = requestAnimationFrame(loop);
    };
    const resize = () => { size(); if (!motion) draw(t0); };

    // pointer interaction
    const move = e => {
      if (e.pointerType !== 'mouse') return;
      const b = cv.getBoundingClientRect();
      tx = e.clientX - b.left; ty = e.clientY - b.top;
      if (!user) { user = true; mx = tx; my = ty; }
    };
    const down = e => {
      const b = cv.getBoundingClientRect();
      ripples.push({ x: e.clientX - b.left, y: e.clientY - b.top, r: 0, a: 1 });
    };
    const leave = () => { user = false; };
    box.addEventListener('pointermove', move);
    box.addEventListener('pointerdown', down);
    box.addEventListener('pointerleave', leave);

    const io = new IntersectionObserver(([e]) => { inView = e.isIntersecting; update(); });
    io.observe(box);
    document.addEventListener('visibilitychange', update);
    addEventListener('resize', resize);

    size();
    if (motion) update(); else draw(t0);

    cleanups.push(() => {
      run = false; cancelAnimationFrame(raf); io.disconnect();
      document.removeEventListener('visibilitychange', update);
      removeEventListener('resize', resize);
    });
  }


  /* ---------- intro: words light up as you scroll ---------- */

  function scrub() {
    const sec = $('.intro');
    if (!sec || !motion) return;
    const words = $$('.w', sec);
    scrollFns.push(() => {
      const r = sec.getBoundingClientRect();
      const p = clamp(-r.top / Math.max(1, r.height - innerHeight));
      const n = Math.round(clamp(p * 1.12) * words.length);
      words.forEach((w, i) => w.classList.toggle('on', i < n));
    });
  }


  /* ---------- "Your path": sticky visual follows the active stage ---------- */

  function stages() {
    const sec = $('.stages');
    if (!sec) return;
    const items = $$('.stage', sec), ring = $('.ring-v', sec);
    const num = $('.sv-n', sec), ttl = $('.sv-t', sec), pills = $$('.sv-p i', sec);
    const C = 565.5;

    const set = i => {
      items.forEach((it, k) => it.classList.toggle('on', k === i));
      ring.style.strokeDashoffset = C * (1 - (i + 1) / items.length);
      num.textContent = '0' + (i + 1);
      ttl.textContent = items[i].dataset.t;
      pills.forEach((p, k) => p.classList.toggle('on', k <= i));
    };
    set(0);

    const io = observe(entries => entries.forEach(e => {
      if (e.isIntersecting) set(items.indexOf(e.target));
    }), { rootMargin: '-45% 0px -45% 0px' });
    items.forEach(it => io.observe(it));
  }


  /* ---------- numbers count up (only when they are real numbers) ---------- */

  function counters() {
    if (!motion) return;
    const io = observe(entries => entries.forEach(e => {
      if (!e.isIntersecting) return;
      io.unobserve(e.target);
      const el = e.target, m = el.dataset.c.match(/^(\d[\d,]*)(\D*)$/);
      const to = +m[1].replace(/,/g, ''), comma = m[1].includes(','), t0 = performance.now();
      (function step(now) {
        const p = clamp((now - t0) / 1500), v = Math.round(to * (1 - Math.pow(1 - p, 3)));
        el.textContent = (comma ? v.toLocaleString() : v) + m[2];
        if (p < 1) requestAnimationFrame(step);
      })(t0);
    }), { threshold: .6 });

    $$('.stats b').forEach(el => {
      const txt = el.textContent.trim();
      if (!/^\d[\d,]*\D*$/.test(txt)) return;             // placeholders like [00] stay as they are
      el.dataset.c = txt;
      el.textContent = '0' + txt.replace(/^[\d,]+/, '');
      io.observe(el);
    });
  }


  /* ---------- admissions timeline draws itself ---------- */

  function timeline() {
    const tl = $('.tl');
    if (!tl || !motion) return;
    const steps = $$('.step', tl);
    scrollFns.push(() => {
      const r = tl.getBoundingClientRect(), line = innerHeight * .62;
      tl.style.setProperty('--p', clamp((line - r.top) / r.height));
      steps.forEach(s => s.classList.toggle('lit', s.getBoundingClientRect().top < line));
    });
  }


  /* ---------- parallax ---------- */

  function parallax() {
    const els = $$('[data-par]');
    if (!els.length || !motion) return;
    scrollFns.push(() => els.forEach(el => {
      const r = el.parentElement.getBoundingClientRect();
      const off = r.top + r.height / 2 - innerHeight / 2;
      el.style.transform = 'translate3d(0,' + (-off * parseFloat(el.dataset.par)).toFixed(1) + 'px,0)';
    }));
  }


  /* ---------- pointer effects: tilt, magnetic buttons, school glow ---------- */

  function pointerFx() {
    if (!motion || !fine) return;

    $$('.tilt').forEach(c => {
      c.addEventListener('pointermove', e => {
        const r = c.getBoundingClientRect();
        c.style.setProperty('--ry', ((e.clientX - r.left) / r.width - .5) * 8 + 'deg');
        c.style.setProperty('--rx', -((e.clientY - r.top) / r.height - .5) * 8 + 'deg');
      });
      c.addEventListener('pointerleave', () => { c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg'); });
    });

    $$('.mag').forEach(b => {
      b.addEventListener('pointermove', e => {
        const r = b.getBoundingClientRect();
        b.style.transform = 'translate(' + (e.clientX - r.left - r.width / 2) * .25 + 'px,' + (e.clientY - r.top - r.height / 2) * .35 + 'px)';
      });
      b.addEventListener('pointerleave', () => { b.style.transform = ''; });
    });

    $$('.pane').forEach(p => p.addEventListener('pointermove', e => {
      const r = p.getBoundingClientRect();
      p.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      p.style.setProperty('--my', (e.clientY - r.top) + 'px');
    }));
  }


  /* ---------- run everything for the page that was just rendered ---------- */

  function initPage() {
    cleanups.forEach(f => f());
    cleanups = []; scrollFns = [];

    reveal();
    heroCanvas();
    scrub();
    stages();
    counters();
    timeline();
    parallax();
    pointerFx();

    if (ready) playAll();
    runScroll();
  }

  addEventListener('app:rendered', initPage);

  initPage();                                             // page is already rendered when this file loads
  startLoader(() => { ready = true; playAll(); });
})();
