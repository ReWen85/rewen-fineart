(() => {
  const { SITE, GALLERY, CATEGORY_LABELS } = window;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s = "") => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  window.REWEN = { $, $$, esc };

  /* ---------- Navigation ---------- */
  const nav = $(".nav");
  const onScroll = () => nav.classList.toggle("scrolled", scrollY > 40 || nav.dataset.solid !== undefined);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const toggle = $(".nav__toggle");
  toggle?.addEventListener("click", () => {
    const open = nav.classList.toggle("open");
    toggle.setAttribute("aria-expanded", open);
    document.body.style.overflow = open ? "hidden" : "";
  });
  $$(".nav__links a").forEach((a) =>
    a.addEventListener("click", () => {
      nav.classList.remove("open");
      document.body.style.overflow = "";
    })
  );

  /* ---------- Links aus der Konfiguration ---------- */
  $$("[data-shop]").forEach((el) => (SITE.shopUrl ? (el.href = SITE.shopUrl) : el.remove()));
  $$("[data-instagram]").forEach((el) => (SITE.instagramUrl ? (el.href = SITE.instagramUrl) : el.remove()));
  if (!SITE.shopUrl) $$("[data-needs-shop]").forEach((el) => el.remove());
  if (!SITE.instagramUrl) $$("[data-needs-instagram]").forEach((el) => el.remove());
  $$(".year").forEach((el) => (el.textContent = new Date().getFullYear()));

  /* ---------- Galerie (nur Startseite) ---------- */
  const grid = $("#gallery-grid");
  if (grid) {
    GALLERY.forEach((item) => {
      const a = document.createElement("a");
      a.className = "tile reveal";
      a.href = `werk.html?w=${encodeURIComponent(item.file)}`;
      a.dataset.category = item.category;
      a.dataset.ratio = (item.w || 2) / (item.h || 3);
      const alt = [item.title, item.place].filter(Boolean).join(" – ");
      a.innerHTML = `
        <img src="assets/img/${esc(item.file)}-thumb.webp" alt="${esc(alt)}"
             loading="lazy" decoding="async" width="${item.w || 800}" height="${item.h || 1200}" draggable="false">
        <figcaption><strong>${esc(item.title)}</strong>${item.place ? `<em>${esc(item.place)}</em>` : ""}
          <span class="tile__more">${item.story ? "Zur Geschichte" : "Ansehen"} →</span></figcaption>`;
      grid.appendChild(a);
    });

    /* Blocksatz-Layout: Bilder einer Reihe sind gleich hoch und füllen die Breite exakt.
       Nichts wird beschnitten – die Kacheln haben immer das Seitenverhältnis des Bildes. */
    const layout = () => {
      const W = grid.clientWidth;
      if (!W) return;
      const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
      // Zielhöhe: Desktop ~3 Hochformate pro Reihe, Tablet ~2, Handy 1
      const target = W >= 900 ? W * 0.45 : W >= 560 ? W * 0.7 : W * 1.6;
      const tiles = $$(".tile:not(.hidden)", grid);
      const rows = [];
      let row = [];
      let sum = 0;
      const heightOf = (r, s) => (W - gap * (r.length - 1)) / s;
      tiles.forEach((t) => {
        const ratio = +t.dataset.ratio;
        if (ratio > 2.5) {                       // Panorama: immer eigene Reihe
          if (row.length) rows.push([row, false]);
          rows.push([[t], true]);
          row = []; sum = 0;
          return;
        }
        if (row.length) {
          const now = Math.abs(heightOf(row, sum) - target);
          const next = Math.abs(heightOf([...row, t], sum + ratio) - target);
          if (next > now) { rows.push([row, true]); row = []; sum = 0; }
        }
        row.push(t); sum += ratio;
      });
      if (row.length) rows.push([row, false]);

      rows.forEach(([r, full]) => {
        const s = r.reduce((acc, t) => acc + +t.dataset.ratio, 0);
        let h = heightOf(r, s);
        if (!full && h > target * 1.15) h = target;   // unvollständige letzte Reihe nicht aufblasen
        r.forEach((t) => {
          t.style.width = `${Math.floor(+t.dataset.ratio * h * 100) / 100}px`;
          t.style.height = `${Math.floor(h * 100) / 100}px`;
        });
      });
    };
    new ResizeObserver(layout).observe(grid);
    layout();

    // Filter nur zeigen, wenn es mehr als eine Kategorie gibt
    const cats = [...new Set(GALLERY.map((g) => g.category))];
    const filters = $(".filters");
    if (cats.length > 1) {
      ["alle", ...cats].forEach((c) => {
        const b = document.createElement("button");
        b.textContent = c === "alle" ? "Alle" : CATEGORY_LABELS[c] || c;
        b.setAttribute("aria-pressed", c === "alle");
        b.addEventListener("click", () => {
          $$("button", filters).forEach((x) => x.setAttribute("aria-pressed", x === b));
          $$(".tile", grid).forEach((t) => t.classList.toggle("hidden", c !== "alle" && t.dataset.category !== c));
          layout();
        });
        filters.appendChild(b);
      });
    } else filters?.remove();
  }

  // Kleiner Schutz gegen "Bild speichern unter" – kein echter Kopierschutz
  document.addEventListener("contextmenu", (e) => {
    if (e.target.tagName === "IMG") e.preventDefault();
  });

  /* ---------- Scroll-Reveal ---------- */
  const io = new IntersectionObserver(
    (entries) => entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    }),
    { rootMargin: "0px 0px -8% 0px" }
  );
  window.REWEN.observe = (el) => io.observe(el);
  $$(".reveal").forEach((el) => io.observe(el));

  /* ---------- Parallax-Band ---------- */
  const band = $(".band__bg");
  if (band && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const par = () => {
      const r = band.parentElement.getBoundingClientRect();
      if (r.bottom < 0 || r.top > innerHeight) return;
      band.style.transform = `translateY(${(r.top + r.height / 2 - innerHeight / 2) * -0.15}px)`;
    };
    addEventListener("scroll", par, { passive: true });
    par();
  }
})();
