(function () {
  const CFG = window.CONFIG || {};
  const NEGOZI = {
    sogno:  { nome: "Sogno del bambino", logo: "assets/art/logo-sogno.webp" },
    amazon: { nome: "Amazon",            logo: "assets/art/logo-amazon.webp" }
  };
  const SI = ["si", "x", "true", "vero", "1", "yes", "regalato", "ok"];
  // "sì", "Sì", "SI", " si " ecc. valgono tutti come regalato
  const isGifted = v => SI.includes((v || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase());

  // Lettore CSV minimo (gestisce virgolette e virgole dentro i campi)
  function parseCSV(text) {
    const rows = []; let row = [], cur = "", q = false;
    text = text.replace(/^\uFEFF/, "");
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") { row.push(cur); cur = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cur); cur = "";
        if (row.some(v => v.trim() !== "")) rows.push(row);
        row = [];
      } else cur += c;
    }
    row.push(cur);
    if (row.some(v => v.trim() !== "")) rows.push(row);
    const head = rows.shift().map(h => h.trim().toLowerCase());
    return rows.map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
  }

  async function load() {
    const urls = [];
    if (CFG.sheetCsvUrl) urls.push(CFG.sheetCsvUrl + (CFG.sheetCsvUrl.includes("?") ? "&" : "?") + "t=" + Date.now());
    urls.push("prodotti.csv");
    for (const u of urls) {
      try {
        const r = await fetch(u, { cache: "no-store" });
        if (!r.ok) continue;
        const items = parseCSV(await r.text()).filter(p => p.nome);
        if (items.length) return items;
      } catch (e) { /* provo la fonte successiva */ }
    }
    return [];
  }

  const slug = s => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function card(p) {
    const gifted = isGifted(p.regalato);
    // Link: quello del singolo prodotto (colonna "link"); per Amazon, in mancanza, la lista desideri
    const href = gifted ? "" : (p.link || (p.negozio === "amazon" ? CFG.amazonWishlist : "") || "");
    const c = el(href ? "a" : "article", "card" + (gifted ? " gifted" : "") + (href ? " linkable" : ""));
    if (href) { c.href = href; c.target = "_blank"; c.rel = "noopener"; }
    const wrap = el("div", "card-img");
    const img = el("img"); img.src = p.immagine; img.alt = p.nome; img.loading = "lazy";
    wrap.appendChild(img);
    if (gifted) wrap.appendChild(el("span", "badge", "Già regalato"));
    c.appendChild(wrap);
    c.appendChild(el("h4", "card-name", p.nome));
    if (p.prezzo) c.appendChild(el("p", "card-price", p.prezzo + " €"));
    if (href) c.appendChild(el("p", "card-cta", p.link ? "Vedi il prodotto →" : (p.negozio === "amazon" ? "Vedi su Amazon →" : "")));
    return c;
  }

  function render(items) {
    const hide = CFG.regalati === "nascondi";
    const root = document.getElementById("lista");
    root.textContent = "";
    if (!items.length) {
      root.appendChild(el("p", "empty", "Non riesco a caricare la lista in questo momento. Riprova tra poco!"));
      return;
    }
    // Negozi e categorie nell'ordine in cui compaiono nel foglio
    const shops = new Map();
    const amazonItems = items.filter(p => p.negozio === "amazon");
    for (const p of items) {
      if (p.negozio === "amazon") continue;
      if (hide && isGifted(p.regalato)) continue;
      if (!shops.has(p.negozio)) shops.set(p.negozio, new Map());
      const cats = shops.get(p.negozio);
      if (!cats.has(p.categoria)) cats.set(p.categoria, []);
      cats.get(p.categoria).push(p);
    }
    for (const [key, cats] of shops) {
      const info = NEGOZI[key] || { nome: key, logo: "" };
      const sec = el("section", "shop"); sec.id = "negozio-" + slug(key);

      // Indice del negozio (cicogna + pillole)
      const idx = el("div", "panel index");
      const stork = el("img", "stork"); stork.src = "assets/art/cicogna.webp"; stork.alt = "";
      const idxText = el("div", "index-text");
      idxText.appendChild(el("h2", "big", "Indice:"));
      idx.append(stork, idxText);
      const nav = el("nav", "pills");
      if (info.logo) { const l = el("img", "shop-logo"); l.src = info.logo; l.alt = info.nome; nav.appendChild(l); }
      nav.appendChild(el("p", "shop-name", info.nome));
      for (const cat of cats.keys()) {
        const a = el("a", "pill", cat); a.href = "#" + slug(key + "-" + cat);
        nav.appendChild(a);
      }
      idx.appendChild(nav);
      sec.appendChild(idx);

      for (const [cat, list] of cats) {
        const panel = el("div", "panel cat"); panel.id = slug(key + "-" + cat);
        panel.appendChild(el("h3", "pill label", cat));
        const grid = el("div", "grid");
        list.forEach(p => grid.appendChild(card(p)));
        panel.appendChild(grid);
        sec.appendChild(panel);
      }
      root.appendChild(sec);
    }
    if (amazonItems.length) root.appendChild(amazonSection(amazonItems));
  }

  // Sezione Amazon: testo, pulsante e carosello di idee (solo immagini, non cliccabili)
  function amazonSection(list) {
    const panel = el("section", "panel amazon"); panel.id = "amazon";
    const logo = el("img", "shop-logo"); logo.src = NEGOZI.amazon.logo; logo.alt = "Amazon";
    panel.appendChild(logo);
    panel.appendChild(el("h2", "big small", "Altri regali su Amazon"));
    panel.appendChild(el("p", "amazon-text",
      "Abbiamo anche una lista nascita su Amazon. Ecco qualche idea: tutta la lista, sempre aggiornata, la trovi qui."));
    if (CFG.amazonWishlist) {
      const a = el("a", "btn", "Apri la lista su Amazon");
      a.href = CFG.amazonWishlist; a.target = "_blank"; a.rel = "noopener";
      panel.appendChild(a);
    }
    const car = el("div", "carousel");
    const prev = el("button", "nav prev", "‹"); prev.type = "button"; prev.setAttribute("aria-label", "Precedenti");
    const next = el("button", "nav next", "›"); next.type = "button"; next.setAttribute("aria-label", "Successivi");
    const track = el("div", "track");
    list.forEach(p => {
      const f = el("figure", "slide");
      const img = el("img"); img.src = p.immagine; img.alt = p.nome; img.loading = "lazy";
      f.append(img, el("figcaption", "", p.nome));
      track.appendChild(f);
    });
    const step = dir => track.scrollBy({ left: dir * track.clientWidth * 0.8, behavior: "smooth" });
    prev.addEventListener("click", () => step(-1));
    next.addEventListener("click", () => step(1));
    car.append(prev, track, next);
    panel.appendChild(car);
    return panel;
  }

  const copyBtn = document.getElementById("copy-iban");
  if (copyBtn) copyBtn.addEventListener("click", async () => {
    const t = document.getElementById("iban").textContent.trim();
    try { await navigator.clipboard.writeText(t); copyBtn.textContent = "Copiato!"; }
    catch (e) {
      const r = document.createRange(); r.selectNodeContents(document.getElementById("iban"));
      const s = getSelection(); s.removeAllRanges(); s.addRange(r); copyBtn.textContent = "Selezionato";
    }
    setTimeout(() => (copyBtn.textContent = "Copia"), 2000);
  });

  load().then(render);
})();
