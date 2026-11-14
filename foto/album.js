(function () {
  const CFG = window.FOTO_CONFIG || {};
  const C = window.FotoCrypto;
  const STORE = "album-elia-key";
  const $ = id => document.getElementById(id);

  let albumKey = null;
  let photos = [];          // in ordine di visualizzazione
  const thumbs = new Map(); // id -> canvas della miniatura (già decifrata)

  // ---------- Utilità ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const bust = () => "?t=" + Date.now();
  async function fetchBin(name) {
    const r = await fetch("data/" + name + bust(), { cache: "no-store" });
    if (!r.ok) throw Object.assign(new Error("HTTP " + r.status), { status: r.status });
    return r.arrayBuffer();
  }
  const fmtDay = d => {
    const dt = new Date(d + "T12:00:00");
    return isNaN(dt) ? d : dt.toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  };
  const storage = {
    get() { try { return sessionStorage.getItem(STORE) || localStorage.getItem(STORE); } catch (e) { return null; } },
    set(v, remember) {
      try { sessionStorage.setItem(STORE, v); if (remember) localStorage.setItem(STORE, v); } catch (e) {}
    },
    clear() { try { sessionStorage.removeItem(STORE); localStorage.removeItem(STORE); } catch (e) {} }
  };

  async function decodeTo(canvas, buf, label, watermark) {
    const plain = await C.decrypt(albumKey, buf, label);
    const bmp = await createImageBitmap(new Blob([plain], { type: "image/jpeg" }));
    canvas.width = bmp.width; canvas.height = bmp.height;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bmp, 0, 0);
    if (bmp.close) bmp.close();
    if (watermark && CFG.filigrana) drawWatermark(ctx, canvas.width, canvas.height);
  }
  function drawWatermark(ctx, w, h) {
    const size = Math.max(14, Math.round(Math.min(w, h) * 0.028));
    ctx.save();
    ctx.font = "600 " + size + "px Fredoka, system-ui, sans-serif";
    ctx.textAlign = "right"; ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(255,255,255,.55)";
    ctx.shadowColor = "rgba(0,0,0,.35)"; ctx.shadowBlur = size / 4;
    ctx.fillText(CFG.filigrana, w - size, h - size * 0.8);
    ctx.restore();
  }

  // ---------- Accesso ----------
  function showLogin(msg) {
    $("album").hidden = true; $("album-bar").hidden = true; $("login").hidden = false;
    $("login-msg").textContent = msg || "";
    setTimeout(() => $("password").focus(), 50);
  }

  async function loadIndex() {
    try {
      const buf = await fetchBin("index.bin");
      const idx = await C.decryptJSON(albumKey, buf, C.L.index);
      return idx.photos || [];
    } catch (e) {
      if (e.status === 404) return [];
      throw e;
    }
  }

  async function open() {
    photos = (await loadIndex()).slice().sort((a, b) =>
      (b.date || "").localeCompare(a.date || "") || (b.added || 0) - (a.added || 0));
    $("login").hidden = true; $("album").hidden = false; $("album-bar").hidden = false;
    render();
  }

  $("login-form").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = $("login-btn"), msg = $("login-msg");
    btn.disabled = true; msg.textContent = "Sto aprendo l'album…";
    try {
      let keyfile;
      try {
        const r = await fetch("data/keys.json" + bust(), { cache: "no-store" });
        if (!r.ok) throw new Error();
        keyfile = await r.json();
      } catch (_) {
        msg.textContent = "L'album non è ancora pronto. Riprova più tardi!";
        return;
      }
      try { albumKey = await C.unwrap(keyfile, $("password").value); }
      catch (_) { msg.textContent = "Password non corretta, riprova."; $("password").select(); return; }
      storage.set(await C.exportAlbumKey(albumKey), $("remember").checked);
      $("password").value = "";
      msg.textContent = "";
      await open();
    } catch (err) {
      msg.textContent = "Qualcosa non ha funzionato. Riprova tra poco.";
      console.error(err);
    } finally { btn.disabled = false; }
  });

  $("logout").addEventListener("click", () => {
    storage.clear(); albumKey = null; photos = []; thumbs.clear();
    $("album").textContent = "";
    showLogin("Sei uscito dall'album.");
  });

  // ---------- Album ----------
  const queue = []; let active = 0;
  function enqueue(job) { queue.push(job); pump(); }
  function pump() {
    while (active < 4 && queue.length) {
      const job = queue.shift(); active++;
      job().catch(err => console.error(err)).finally(() => { active--; pump(); });
    }
  }

  const io = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
    for (const en of entries) if (en.isIntersecting) { io.unobserve(en.target); en.target._load(); }
  }, { rootMargin: "400px 0px" }) : null;

  function tile(p, i) {
    const b = el("button", "tile loading"); b.type = "button";
    b.setAttribute("aria-label", p.caption ? "Apri foto: " + p.caption : "Apri foto");
    const cv = el("canvas", "photo");
    cv.width = p.tw || 4; cv.height = p.th || 3;
    b.append(cv, el("span", "shield"));
    b._load = () => enqueue(async () => {
      await decodeTo(cv, await fetchBin(p.id + ".t.bin"), C.L.thumb(p.id), false);
      thumbs.set(p.id, cv); b.classList.remove("loading");
    });
    b.addEventListener("click", () => openLightbox(i));
    if (io) io.observe(b); else b._load();
    return b;
  }

  function render() {
    const root = $("album"); root.textContent = "";
    if (!photos.length) {
      const panel = el("section", "panel empty-album");
      panel.appendChild(el("h2", "big small", "Presto qui"));
      panel.appendChild(el("p", "", "Non ci sono ancora foto. Torna a trovarci tra un po'!"));
      root.appendChild(panel); return;
    }
    const days = new Map();
    photos.forEach((p, i) => {
      const d = p.date || "";
      if (!days.has(d)) days.set(d, []);
      days.get(d).push([p, i]);
    });
    for (const [d, list] of days) {
      const panel = el("section", "panel day");
      panel.appendChild(el("h3", "pill label", d ? fmtDay(d) : "Altre foto"));
      const grid = el("div", "photo-grid");
      list.forEach(([p, i]) => grid.appendChild(tile(p, i)));
      panel.appendChild(grid);
      root.appendChild(panel);
    }
  }

  // ---------- Foto ingrandita ----------
  let cur = -1, loadToken = 0;
  const lb = $("lightbox"), lbc = $("lb-canvas");

  async function show(i) {
    cur = (i + photos.length) % photos.length;
    const p = photos[cur], token = ++loadToken;
    $("lb-text").textContent = p.caption || "";
    $("lb-date").textContent = p.date ? fmtDay(p.date) : "";
    // Intanto mostro la miniatura ingrandita, poi la foto grande
    const t = thumbs.get(p.id);
    lbc.width = p.w || (t && t.width) || 4; lbc.height = p.h || (t && t.height) || 3;
    const ctx = lbc.getContext("2d");
    ctx.clearRect(0, 0, lbc.width, lbc.height);
    if (t) ctx.drawImage(t, 0, 0, lbc.width, lbc.height);
    lb.classList.add("loading");
    try {
      const buf = await fetchBin(p.id + ".bin");
      if (token !== loadToken) return;
      const tmp = document.createElement("canvas");
      await decodeTo(tmp, buf, C.L.full(p.id), true);
      if (token !== loadToken) return;
      lbc.width = tmp.width; lbc.height = tmp.height;
      lbc.getContext("2d").drawImage(tmp, 0, 0);
      tmp.width = tmp.height = 0;
    } catch (e) { console.error(e); }
    finally { if (token === loadToken) lb.classList.remove("loading"); }
  }
  function openLightbox(i) {
    lb.hidden = false; document.body.classList.add("lb-open");
    show(i); $("lb-close").focus();
  }
  function closeLightbox() {
    lb.hidden = true; document.body.classList.remove("lb-open"); loadToken++;
    lbc.width = lbc.height = 0;
  }
  $("lb-close").addEventListener("click", closeLightbox);
  $("lb-prev").addEventListener("click", () => show(cur - 1));
  $("lb-next").addEventListener("click", () => show(cur + 1));
  lb.addEventListener("click", e => { if (e.target === lb) closeLightbox(); });
  document.addEventListener("keydown", e => {
    if (lb.hidden) return;
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowLeft") show(cur - 1);
    else if (e.key === "ArrowRight") show(cur + 1);
  });
  let sx = null, sy = 0;
  lb.addEventListener("touchstart", e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  lb.addEventListener("touchend", e => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) show(cur + (dx < 0 ? 1 : -1));
    else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) closeLightbox();
  });

  // ---------- Avvio ----------
  (async () => {
    const saved = storage.get();
    if (!saved) return showLogin();
    try {
      albumKey = await C.restoreAlbumKey(saved);
      await open();
    } catch (e) {
      storage.clear(); albumKey = null;
      showLogin("La password è cambiata: inseriscila di nuovo.");
    }
  })();
})();
