// Cifratura dell'album: tutto avviene nel browser con WebCrypto.
//
// - Una "chiave dell'album" casuale (AES-GCM 256 bit) cifra ogni foto e l'indice.
// - La chiave dell'album è salvata in data/keys.json, cifrata con una chiave
//   ricavata dalla password (PBKDF2-SHA256, 600.000 iterazioni, salt casuale).
// - Ogni file cifrato è: [12 byte IV][testo cifrato + tag GCM]. Il nome del file
//   è legato al contenuto come "dato aggiuntivo" (AAD), così i file non si
//   possono scambiare tra loro.
window.FotoCrypto = (() => {
  const te = new TextEncoder(), td = new TextDecoder();
  const ITER = 600000;

  function toB64(bytes) {
    bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(s) {
    const bin = atob(s), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const rand = n => crypto.getRandomValues(new Uint8Array(n));
  const randomId = () => Array.from(rand(10), b => b.toString(16).padStart(2, "0")).join("");

  async function passwordKey(password, salt, iterations) {
    const base = await crypto.subtle.importKey("raw", te.encode(password.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations },
      base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }

  async function encrypt(key, data, label) {
    const iv = rand(12);
    const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: te.encode(label) }, key, data);
    const out = new Uint8Array(12 + ct.byteLength);
    out.set(iv); out.set(new Uint8Array(ct), 12);
    return out;
  }
  async function decrypt(key, buf, label) {
    const u = new Uint8Array(buf);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: u.subarray(0, 12), additionalData: te.encode(label) }, key, u.subarray(12));
  }

  const importAlbumKey = raw => crypto.subtle.importKey("raw", raw, "AES-GCM", true, ["encrypt", "decrypt"]);

  async function newAlbumKey() {
    return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  }

  // Crea il contenuto di keys.json per una chiave dell'album e una password
  async function wrap(albumKey, password) {
    const salt = rand(16);
    const pk = await passwordKey(password, salt, ITER);
    const raw = await crypto.subtle.exportKey("raw", albumKey);
    const wrapped = await encrypt(pk, raw, "album-key");
    return { v: 1, kdf: "PBKDF2-SHA256", iterations: ITER, salt: toB64(salt), key: toB64(wrapped) };
  }

  // Apre keys.json con la password. Lancia un errore se la password è sbagliata.
  async function unwrap(keyfile, password) {
    const pk = await passwordKey(password, fromB64(keyfile.salt), keyfile.iterations);
    const raw = await decrypt(pk, fromB64(keyfile.key), "album-key");
    return importAlbumKey(raw);
  }

  const exportAlbumKey = async k => toB64(await crypto.subtle.exportKey("raw", k));
  const restoreAlbumKey = s => importAlbumKey(fromB64(s));

  // Etichette (AAD) dei vari file
  const L = {
    index: "index",
    full: id => "full:" + id,
    thumb: id => "thumb:" + id
  };

  async function encryptJSON(key, obj, label) { return encrypt(key, te.encode(JSON.stringify(obj)), label); }
  async function decryptJSON(key, buf, label) { return JSON.parse(td.decode(await decrypt(key, buf, label))); }

  return { toB64, fromB64, randomId, encrypt, decrypt, encryptJSON, decryptJSON, newAlbumKey,
           wrap, unwrap, exportAlbumKey, restoreAlbumKey, L };
})();
