// Ostacoli al salvataggio delle foto.
// Nessuna pagina web può impedire del tutto uno screenshot (soprattutto dal
// telefono) o una foto allo schermo: queste misure rendono però più scomodo
// salvare o copiare le immagini.
(function () {
  const isPhotoTarget = t => t && t.closest && t.closest(".photo, .shield, .tile, .lightbox");

  // Niente menu "Salva immagine", trascinamento o selezione sulle foto
  document.addEventListener("contextmenu", e => { if (isPhotoTarget(e.target)) e.preventDefault(); });
  document.addEventListener("dragstart", e => { if (isPhotoTarget(e.target)) e.preventDefault(); });
  document.addEventListener("selectstart", e => { if (isPhotoTarget(e.target)) e.preventDefault(); });

  // Blocca Ctrl/Cmd + S (salva pagina) e Ctrl/Cmd + P (stampa)
  document.addEventListener("keydown", e => {
    const k = (e.key || "").toLowerCase();
    if ((e.ctrlKey || e.metaKey) && (k === "s" || k === "p")) e.preventDefault();
  });

  // Copre le foto quando la pagina non è in primo piano (cambio app, anteprima
  // delle app aperte, strumenti di cattura che prendono il focus) o dopo il tasto Stamp
  const body = document.body;
  let timer;
  const veil = on => body.classList.toggle("veiled", on);
  const veilFor = ms => { veil(true); clearTimeout(timer); timer = setTimeout(() => veil(document.hidden || !document.hasFocus()), ms); };

  document.addEventListener("visibilitychange", () => veil(document.hidden));
  window.addEventListener("blur", () => veil(true));
  window.addEventListener("focus", () => veil(false));
  window.addEventListener("pagehide", () => veil(true));

  document.addEventListener("keyup", e => {
    if (e.key === "PrintScreen") {
      veilFor(2000);
      if (navigator.clipboard) navigator.clipboard.writeText("").catch(() => {});
    }
  });
  // Scorciatoie di cattura su Mac (Cmd+Shift+3/4/5) e Windows (Win+Shift+S)
  document.addEventListener("keydown", e => {
    if (e.shiftKey && (e.metaKey || e.ctrlKey) && ["3", "4", "5", "s", "S"].includes(e.key)) veilFor(3000);
  });

  // Stampa: la pagina diventa bianca (vedi foto.css)
  window.addEventListener("beforeprint", () => veil(true));
  window.addEventListener("afterprint", () => veil(false));
})();
