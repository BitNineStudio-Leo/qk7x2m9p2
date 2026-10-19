(function () {
  const CFG = window.CONFIG || {};
  const NEGOZI = {
    sogno:  { nome: "Sogno del bambino", logo: "assets/art/logo-sogno.webp" },
    amazon: { nome: "Amazon",            logo: "assets/art/logo-amazon.webp" }
  };
  const SI = ["si", "sì", "x", "true", "vero", "1", "yes", "regalato"];

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
    const gifted = SI.includes((p.regalato || "").toLowerCase());
    const c = el("article", "card" + (gifted ? " gifted" : ""));
    const wrap = el("div", "card-img");
    const img = el("img"); img.src = p.immagine; img.alt = p.nome; img.loading = "lazy";
    wrap.appendChild(img);
    if (gifted) wrap.appendChild(el("span", "badge", "Già regalato"));
    c.appendChild(wrap);
    c.appendChild(el("h4", "card-name", p.nome));
    if (p.prezzo) c.appendChild(el("p", "card-price", p.prezzo + " €"));
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
    for (const p of items) {
      if (hide && SI.includes((p.regalato || "").toLowerCase())) continue;
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
    // Link Amazon
    const az = document.getElementById("amazon-link");
    if (az && CFG.amazonWishlist) az.href = CFG.amazonWishlist;
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
