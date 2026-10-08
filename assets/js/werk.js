/* Detailseite eines Werks: werk.html?w=<file> */
(() => {
  const { SITE, GALLERY, CATEGORY_LABELS, REWEN } = window;
  const { $, esc } = REWEN;

  const id = new URLSearchParams(location.search).get("w");
  const idx = GALLERY.findIndex((g) => g.file === id);
  if (idx < 0) { location.replace("index.html#werke"); return; }

  const item = GALLERY[idx];
  const prev = GALLERY[(idx - 1 + GALLERY.length) % GALLERY.length];
  const next = GALLERY[(idx + 1) % GALLERY.length];
  const shop = item.shop || SITE.shopUrl;
  const full = `assets/img/${item.file}.webp`;

  document.title = `${item.title} – REWEN Fineart`;
  $('meta[name="description"]').content =
    `${[item.title, item.place].filter(Boolean).join(" – ")}. Fine-Art-Fotografie von REWEN.`;

  const facts = [
    item.place && ["Ort", item.place],
    item.year && ["Jahr", item.year],
    item.category && ["Serie", CATEGORY_LABELS[item.category] || item.category],
    ...(item.details || []).map((d, i) => [i ? "" : "Details", d]),
  ].filter(Boolean);

  const story = (item.story || "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

  if ((item.w || 2) / (item.h || 3) > 1.6) $("#werk").classList.add("werk--wide");
  $("#werk").innerHTML = `
    <figure class="werk__figure">
      <button class="werk__zoom" aria-label="${esc(item.title)} im Vollbild ansehen">
        <img src="${full}" alt="${esc([item.title, item.place].filter(Boolean).join(" – "))}" width="${item.w || 800}" height="${item.h || 1200}" draggable="false">
      </button>
    </figure>

    <div class="werk__info">
      <p class="eyebrow reveal">Werk ${String(idx + 1).padStart(2, "0")} / ${String(GALLERY.length).padStart(2, "0")}</p>
      <h1 class="reveal">${esc(item.title)}</h1>
      <div class="rule left reveal"><span></span></div>

      <dl class="werk__facts reveal">
        ${facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}
      </dl>

      ${story
        ? `<div class="werk__story reveal"><p class="eyebrow">Die Geschichte dahinter</p>${story}</div>`
        : ""}

      ${shop ? `<a class="btn reveal" href="${esc(shop)}" target="_blank" rel="noopener">Als Print bei pictrs
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M4 12h15M13 6l6 6-6 6"/></svg></a>` : ""}
    </div>`;

  $("#werk-pager").innerHTML = `
    <a href="werk.html?w=${encodeURIComponent(prev.file)}" class="pager__link" rel="prev">
      <img src="assets/img/${esc(prev.file)}-thumb.webp" alt="" loading="lazy">
      <span><small>← Vorheriges</small>${esc(prev.title)}</span>
    </a>
    <a href="index.html#werke" class="pager__all">Alle Werke</a>
    <a href="werk.html?w=${encodeURIComponent(next.file)}" class="pager__link next" rel="next">
      <span><small>Nächstes →</small>${esc(next.title)}</span>
      <img src="assets/img/${esc(next.file)}-thumb.webp" alt="" loading="lazy">
    </a>`;

  document.querySelectorAll("#werk .reveal").forEach((el) => REWEN.observe(el));

  /* ---------- Vollbild ---------- */
  const lb = $(".lightbox");
  $(".lightbox__stage img", lb).src = full;
  $(".lightbox__stage img", lb).alt = item.title;
  const open = () => {
    lb.classList.add("open");
    lb.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    $(".lb-close", lb).focus();
  };
  const close = () => {
    lb.classList.remove("open");
    lb.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    $(".werk__zoom").focus();
  };
  $(".werk__zoom").addEventListener("click", open);
  lb.addEventListener("click", close);
  addEventListener("keydown", (e) => {
    if (lb.classList.contains("open")) { if (e.key === "Escape") close(); return; }
    if (e.key === "ArrowLeft") location.href = `werk.html?w=${encodeURIComponent(prev.file)}`;
    if (e.key === "ArrowRight") location.href = `werk.html?w=${encodeURIComponent(next.file)}`;
  });
})();
