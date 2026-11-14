(function () {
  const CFG = window.FOTO_CONFIG;
  const C = window.FotoCrypto;
  const $ = id => document.getElementById(id);
  const TOKEN_STORE = "album-elia-admin-token";
  const API = "https://api.github.com/repos/" + CFG.owner + "/" + CFG.repo;
  const te = new TextEncoder(), td = new TextDecoder();

  let token = "", albumKey = null;
  let manifest = { v: 1, photos: [] };
  let pending = [];            // foto scelte e non ancora caricate
  const edits = new Map();     // id -> { caption, date, removed }

  // ---------- Utilità ----------
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const pad = n => String(n).padStart(2, "0");
  const localDay = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  function setMsg(id, text) { $(id).textContent = text || ""; }
  async function pool(items, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) { const k = i++; await fn(items[k], k); }
    }));
  }

  // ---------- GitHub ----------
  async function api(path, opts = {}) {
    const headers = { Authorization: "Bearer " + token, Accept: opts.raw ? "application/vnd.github.raw" : "application/vnd.github+json" };
    if (opts.body) headers["Content-Type"] = "application/json";
    let r;
    for (let attempt = 0; ; attempt++) {
      try {
        r = await fetch(API + path, { method: opts.method || "GET", headers, cache: "no-store",
          body: opts.body ? JSON.stringify(opts.body) : undefined });
        if (r.status >= 500 && attempt < 3) { await sleep(800 * 2 ** attempt); continue; }
        break;
      } catch (e) {
        if (attempt >= 3) throw e;
        await sleep(800 * 2 ** attempt);
      }
    }
    if (!r.ok) {
      const err = new Error("GitHub " + r.status + " " + (await r.text()).slice(0, 200));
      err.status = r.status; throw err;
    }
    return opts.raw ? r.arrayBuffer() : r.status === 204 ? null : r.json();
  }
  const dataPath = name => CFG.dataPath + "/" + name;
  async function readFile(name) {
    try { return await api("/contents/" + dataPath(name) + "?ref=" + encodeURIComponent(CFG.branch), { raw: true }); }
    catch (e) { if (e.status === 404) return null; throw e; }
  }
  async function createBlob(bytes) {
    const res = await api("/git/blobs", { method: "POST", body: { content: C.toB64(bytes), encoding: "base64" } });
    return res.sha;
  }
  async function readManifest(key) {
    const buf = await readFile("index.bin");
    return buf ? C.decryptJSON(key || albumKey, buf, C.L.index) : { v: 1, photos: [] };
  }

  // Un unico commit con tutti i file. `files`: [{ name, sha }] (sha null = elimina).
  // `build(latest)` riceve l'indice più recente e restituisce il nuovo indice.
  async function commit(files, build, message, key) {
    key = key || albumKey;
    for (let attempt = 0; attempt < 4; attempt++) {
      const ref = await api("/git/ref/heads/" + CFG.branch);
      const head = ref.object.sha;
      const base = await api("/git/commits/" + head);
      const tree = files.map(f => ({ path: dataPath(f.name), mode: "100644", type: "blob", sha: f.sha }));
      let next = null;
      if (build) {
        next = build(await readManifest(key));
        const sha = await createBlob(await C.encryptJSON(key, next, C.L.index));
        tree.push({ path: dataPath("index.bin"), mode: "100644", type: "blob", sha });
      }
      const t = await api("/git/trees", { method: "POST", body: { base_tree: base.tree.sha, tree } });
      const c = await api("/git/commits", { method: "POST", body: { message, tree: t.sha, parents: [head] } });
      try {
        await api("/git/refs/heads/" + CFG.branch, { method: "PATCH", body: { sha: c.sha, force: false } });
        return next;
      } catch (e) {
        if (e.status !== 422 || attempt === 3) throw e; // qualcun altro ha fatto un commit: riprovo
        await sleep(600);
      }
    }
  }

  // ---------- Immagini ----------
  async function loadImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url;
      await img.decode();
      return img;
    } finally { URL.revokeObjectURL(url); }
  }
  function drawScaled(src, sw, sh, max) {
    const s = Math.min(1, max / Math.max(sw, sh));
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(sw * s)); cv.height = Math.max(1, Math.round(sh * s));
    const ctx = cv.getContext("2d");
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(src, 0, 0, cv.width, cv.height);
    return cv;
  }
  const jpeg = (cv, q) => new Promise((res, rej) =>
    cv.toBlob(b => b ? b.arrayBuffer().then(res, rej) : rej(new Error("toBlob")), "image/jpeg", q));

  // Data di scatto dai metadati EXIF (solo lettura: i metadati NON vengono caricati)
  async function exifDate(file) {
    try {
      const b = new DataView(await file.slice(0, 196608).arrayBuffer());
      if (b.getUint16(0) !== 0xFFD8) return null;
      let o = 2;
      while (o + 10 < b.byteLength) {
        const m = b.getUint16(o), len = b.getUint16(o + 2);
        if ((m & 0xFF00) !== 0xFF00) return null;
        if (m === 0xFFE1 && b.getUint32(o + 4) === 0x45786966) {
          const t = o + 10, le = b.getUint16(t) === 0x4949;
          const u16 = p => b.getUint16(p, le), u32 = p => b.getUint32(p, le);
          const find = (off, tag) => {
            const n = u16(t + off);
            for (let i = 0; i < n; i++) { const e = t + off + 2 + i * 12; if (u16(e) === tag) return e; }
            return null;
          };
          const ifd0 = u32(t + 4);
          let e = null; const ptr = find(ifd0, 0x8769);
          if (ptr) { const ex = u32(ptr + 8); e = find(ex, 0x9003) || find(ex, 0x9004); }
          if (!e) e = find(ifd0, 0x0132);
          if (!e) return null;
          const off = u32(e + 8); let s = "";
          for (let k = 0; k < 10; k++) s += String.fromCharCode(b.getUint8(t + off + k));
          const mm = s.match(/^(\d{4}):(\d{2}):(\d{2})/);
          return mm && mm[1] !== "0000" ? mm[1] + "-" + mm[2] + "-" + mm[3] : null;
        }
        if (m === 0xFFDA) return null;
        o += 2 + len;
      }
    } catch (e) {}
    return null;
  }

  // ---------- Accesso ----------
  try { const t = localStorage.getItem(TOKEN_STORE) || sessionStorage.getItem(TOKEN_STORE); if (t) { $("a-token").value = t; $("a-remember").checked = !!localStorage.getItem(TOKEN_STORE); } } catch (e) {}

  $("connect-form").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = $("connect-btn"); btn.disabled = true;
    token = $("a-token").value.trim();
    try {
      setMsg("connect-msg", "Controllo il token…");
      let repo;
      try { repo = await api(""); }
      catch (err) {
        setMsg("connect-msg", err.status === 401 ? "Token non valido o scaduto." :
          err.status === 404 ? "Il token non ha accesso al repository " + CFG.owner + "/" + CFG.repo + "." : "Errore di collegamento con GitHub.");
        return;
      }
      if (repo.permissions && !repo.permissions.push) { setMsg("connect-msg", "Il token può solo leggere: serve il permesso “Contents: Read and write”."); return; }
      try {
        sessionStorage.setItem(TOKEN_STORE, token);
        if ($("a-remember").checked) localStorage.setItem(TOKEN_STORE, token); else localStorage.removeItem(TOKEN_STORE);
      } catch (_) {}

      setMsg("connect-msg", "Apro l'album…");
      const kf = await readFile("keys.json");
      if (!kf) {
        $("connect").hidden = true; $("setup").hidden = false; setMsg("connect-msg", "");
        return;
      }
      try { albumKey = await C.unwrap(JSON.parse(td.decode(kf)), $("a-password").value); }
      catch (_) { setMsg("connect-msg", "Password dell'album non corretta."); return; }
      $("a-password").value = "";
      manifest = await readManifest();
      setMsg("connect-msg", "");
      showManage();
    } catch (err) {
      console.error(err); setMsg("connect-msg", "Errore: " + err.message);
    } finally { btn.disabled = false; }
  });

  $("setup-form").addEventListener("submit", async e => {
    e.preventDefault();
    const p1 = $("s-pass1").value, p2 = $("s-pass2").value;
    if (p1 !== p2) return setMsg("setup-msg", "Le due password non coincidono.");
    const btn = $("setup-btn"); btn.disabled = true;
    try {
      setMsg("setup-msg", "Creo l'album…");
      albumKey = await C.newAlbumKey();
      const keyfile = await C.wrap(albumKey, p1);
      const kSha = await createBlob(te.encode(JSON.stringify(keyfile, null, 2)));
      manifest = await commit([{ name: "keys.json", sha: kSha }], () => ({ v: 1, photos: [] }), "Crea album foto");
      $("s-pass1").value = $("s-pass2").value = "";
      setMsg("setup-msg", "");
      $("setup").hidden = true;
      showManage();
    } catch (err) {
      console.error(err); setMsg("setup-msg", "Errore: " + err.message);
    } finally { btn.disabled = false; }
  });

  $("disconnect").addEventListener("click", () => {
    try { sessionStorage.removeItem(TOKEN_STORE); localStorage.removeItem(TOKEN_STORE); } catch (e) {}
    location.reload();
  });

  function showManage() {
    $("connect").hidden = true; $("manage").hidden = false;
    renderExisting();
  }

  // ---------- Nuove foto ----------
  const drop = $("drop");
  $("files").addEventListener("change", e => { addFiles(e.target.files); e.target.value = ""; });
  ["dragenter", "dragover"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e => addFiles(e.dataTransfer.files));

  async function addFiles(list) {
    for (const file of Array.from(list)) {
      if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) continue;
      const p = { file, url: URL.createObjectURL(file), caption: "",
                  date: (await exifDate(file)) || localDay(new Date(file.lastModified || Date.now())) };
      pending.push(p);
    }
    renderPending();
  }

  function renderPending() {
    const box = $("pending"); box.textContent = "";
    pending.forEach((p, i) => {
      const it = el("div", "item");
      const img = el("img", "thumb"); img.src = p.url; img.alt = "";
      img.onerror = () => { p.status = "Formato non leggibile da questo browser (HEIC?)"; st.textContent = p.status; };
      const date = el("input"); date.type = "date"; date.value = p.date; date.oninput = () => (p.date = date.value);
      const cap = el("input"); cap.placeholder = "Didascalia (facoltativa)"; cap.value = p.caption; cap.maxLength = 200;
      cap.oninput = () => (p.caption = cap.value);
      const rm = el("button", "x", "Togli"); rm.type = "button";
      rm.onclick = () => { URL.revokeObjectURL(p.url); pending.splice(i, 1); renderPending(); };
      const st = el("span", "status", p.status || "");
      p.statusEl = st;
      const row = el("div", "row"); row.append(date, rm);
      it.append(img, row, cap, st);
      box.appendChild(it);
    });
    $("upload-actions").hidden = !pending.length;
    $("upload-btn").textContent = pending.length === 1 ? "Carica 1 foto" : "Carica " + pending.length + " foto";
  }

  $("clear-btn").addEventListener("click", () => { pending.forEach(p => URL.revokeObjectURL(p.url)); pending = []; renderPending(); setMsg("upload-msg", ""); });

  $("upload-btn").addEventListener("click", async () => {
    if (!pending.length) return;
    const btns = [$("upload-btn"), $("clear-btn")]; btns.forEach(b => (b.disabled = true));
    const files = [], entries = [];
    let done = 0, failed = 0;
    const total = pending.length;
    try {
      // Una alla volta per non esaurire la memoria del telefono
      for (const p of pending) {
        const status = t => { if (p.statusEl) p.statusEl.textContent = t; };
        try {
          status("Preparo…");
          const img = await loadImage(p.file);
          const full = drawScaled(img, img.naturalWidth, img.naturalHeight, CFG.latoFoto);
          const thumb = drawScaled(full, full.width, full.height, CFG.latoMiniatura);
          const id = C.randomId();
          status("Cifro e carico…");
          const fSha = await createBlob(await C.encrypt(albumKey, await jpeg(full, 0.86), C.L.full(id)));
          const tSha = await createBlob(await C.encrypt(albumKey, await jpeg(thumb, 0.8), C.L.thumb(id)));
          files.push({ name: id + ".bin", sha: fSha }, { name: id + ".t.bin", sha: tSha });
          entries.push({ id, date: p.date || localDay(new Date()), caption: p.caption.trim(),
                         w: full.width, h: full.height, tw: thumb.width, th: thumb.height, added: Date.now() });
          full.width = full.height = thumb.width = thumb.height = 0;
          p.ok = true; status("Pronta ✓");
        } catch (err) {
          console.error(err); failed++;
          status("Non riuscita: " + (err.status ? "errore GitHub " + err.status : "formato non supportato"));
        }
        done++;
        setMsg("upload-msg", "Foto " + done + " di " + total + "…");
      }
      if (entries.length) {
        setMsg("upload-msg", "Pubblico…");
        manifest = await commit(files, latest => ({ v: 1, photos: latest.photos.concat(entries) }),
          entries.length === 1 ? "Aggiunge una foto" : "Aggiunge " + entries.length + " foto");
      }
      pending.filter(p => p.ok).forEach(p => URL.revokeObjectURL(p.url));
      pending = pending.filter(p => !p.ok);
      renderPending(); renderExisting();
      setMsg("upload-msg", (entries.length ? "Fatto! " + entries.length + " foto pubblicate: saranno visibili nell'album entro un paio di minuti." : "") +
        (failed ? " " + failed + " foto non sono riuscite: puoi riprovare." : ""));
    } catch (err) {
      console.error(err); setMsg("upload-msg", "Errore durante la pubblicazione: " + err.message);
    } finally { btns.forEach(b => (b.disabled = false)); }
  });

  // ---------- Foto pubblicate ----------
  const thumbUrls = new Map();
  function renderExisting() {
    const box = $("existing"); box.textContent = "";
    edits.clear(); updateSaveBar();
    const list = manifest.photos.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.added - a.added);
    $("count").textContent = "(" + list.length + ")";
    if (!list.length) { box.appendChild(el("p", "", "Ancora nessuna foto.")); return; }
    const jobs = [];
    for (const p of list) {
      const it = el("div", "item");
      const img = el("img", "thumb"); img.alt = "";
      if (thumbUrls.has(p.id)) img.src = thumbUrls.get(p.id);
      else jobs.push([p, img]);
      const edit = () => { if (!edits.has(p.id)) edits.set(p.id, { caption: p.caption || "", date: p.date || "", removed: false }); return edits.get(p.id); };
      const mark = () => {
        const e = edits.get(p.id);
        const changed = e && (e.removed || e.caption !== (p.caption || "") || e.date !== (p.date || ""));
        if (!changed) edits.delete(p.id);
        it.classList.toggle("changed", !!changed); it.classList.toggle("removed", !!(e && e.removed));
        rm.textContent = e && e.removed ? "Ripristina" : "Elimina";
        updateSaveBar();
      };
      const date = el("input"); date.type = "date"; date.value = p.date || "";
      date.oninput = () => { edit().date = date.value; mark(); };
      const cap = el("input"); cap.placeholder = "Didascalia"; cap.value = p.caption || ""; cap.maxLength = 200;
      cap.oninput = () => { edit().caption = cap.value; mark(); };
      const rm = el("button", "x", "Elimina"); rm.type = "button";
      rm.onclick = () => { const e = edit(); e.removed = !e.removed; mark(); };
      const row = el("div", "row"); row.append(date, rm);
      it.append(img, row, cap);
      box.appendChild(it);
    }
    pool(jobs, 4, async ([p, img]) => {
      try {
        const buf = await readFile(p.id + ".t.bin");
        if (!buf) return;
        const plain = await C.decrypt(albumKey, buf, C.L.thumb(p.id));
        const url = URL.createObjectURL(new Blob([plain], { type: "image/jpeg" }));
        thumbUrls.set(p.id, url); img.src = url;
      } catch (e) { console.error(e); }
    });
  }
  function updateSaveBar() {
    $("save-actions").hidden = !edits.size;
    const del = [...edits.values()].filter(e => e.removed).length;
    $("save-btn").textContent = del ? "Salva (" + del + " da eliminare)" : "Salva le modifiche";
  }
  $("reset-btn").addEventListener("click", () => { renderExisting(); setMsg("save-msg", ""); });

  $("save-btn").addEventListener("click", async () => {
    if (!edits.size) return;
    const del = [...edits].filter(([, e]) => e.removed).map(([id]) => id);
    if (del.length && !confirm("Eliminare " + del.length + " foto dall'album?")) return;
    const btn = $("save-btn"); btn.disabled = true;
    try {
      setMsg("save-msg", "Salvo…");
      const snapshot = new Map(edits);
      const existing = new Set(manifest.photos.map(p => p.id));
      const files = del.filter(id => existing.has(id)).flatMap(id => [{ name: id + ".bin", sha: null }, { name: id + ".t.bin", sha: null }]);
      manifest = await commit(files, latest => ({
        v: 1,
        photos: latest.photos.filter(p => !(snapshot.get(p.id) || {}).removed).map(p => {
          const e = snapshot.get(p.id);
          return e ? Object.assign({}, p, { caption: e.caption.trim(), date: e.date || p.date }) : p;
        })
      }), del.length ? "Aggiorna album (" + del.length + " foto rimosse)" : "Aggiorna didascalie");
      renderExisting();
      setMsg("save-msg", "Salvato! L'album si aggiorna entro un paio di minuti.");
    } catch (err) {
      console.error(err); setMsg("save-msg", "Errore: " + err.message);
    } finally { btn.disabled = false; }
  });

  // ---------- Cambio password (con nuova chiave) ----------
  $("pw-form").addEventListener("submit", async e => {
    e.preventDefault();
    const p1 = $("pw1").value, p2 = $("pw2").value;
    if (p1 !== p2) return setMsg("pw-msg", "Le due password non coincidono.");
    if (!confirm("Cambiare la password? Dovrai dare quella nuova a tutti i parenti.")) return;
    const btn = $("pw-btn"); btn.disabled = true;
    try {
      const current = await readManifest();
      const newKey = await C.newAlbumKey();
      const files = [];
      const names = current.photos.flatMap(p => [[p.id + ".bin", C.L.full(p.id)], [p.id + ".t.bin", C.L.thumb(p.id)]]);
      let n = 0;
      await pool(names, 3, async ([name, label]) => {
        const buf = await readFile(name);
        if (!buf) return;
        const plain = await C.decrypt(albumKey, buf, label);
        files.push({ name, sha: await createBlob(await C.encrypt(newKey, plain, label)) });
        setMsg("pw-msg", "Cifro di nuovo le foto: " + (++n) + " di " + names.length + "…");
      });
      const kSha = await createBlob(te.encode(JSON.stringify(await C.wrap(newKey, p1), null, 2)));
      files.push({ name: "keys.json", sha: kSha });
      setMsg("pw-msg", "Pubblico…");
      // L'indice viene riscritto con la nuova chiave, partendo da quello appena letto
      const idxSha = await createBlob(await C.encryptJSON(newKey, current, C.L.index));
      files.push({ name: "index.bin", sha: idxSha });
      await commit(files, null, "Aggiorna chiavi album");
      albumKey = newKey; manifest = current;
      $("pw1").value = $("pw2").value = "";
      setMsg("pw-msg", "Password cambiata. Ricordati di comunicarla ai parenti!");
    } catch (err) {
      console.error(err); setMsg("pw-msg", "Errore: " + err.message + " (nessuna modifica è stata pubblicata)");
    } finally { btn.disabled = false; }
  });
})();
