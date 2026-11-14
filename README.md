# Lista nascita per Elia

## Album foto privato (`/foto/`)

Un album di foto per i parenti, protetto da password e **cifrato**: le foto vengono
cifrate nel browser (AES-256-GCM) prima di essere caricate, quindi nel repository e
sul sito ci sono solo file illeggibili. Senza la password nessuno (né GitHub, né
chi trova il link, né chi addestra IA) può vedere le immagini.

- Album per i parenti: `https://<tuo-sito>/foto/`
- Gestione (solo per te): `https://<tuo-sito>/foto/admin.html`

L'album non è collegato dalla lista nascita ed è escluso dai motori di ricerca.

### Configurazione (una volta sola)

1. **Crea un token GitHub** su <https://github.com/settings/personal-access-tokens/new>
   (*Fine-grained token*):
   - *Repository access* → **Only select repositories** → questo repository;
   - *Permissions* → *Repository permissions* → **Contents: Read and write**;
   - scadenza a piacere (es. 1 anno). Copia il token (`github_pat_…`).
2. Controlla in `foto/config.js` che `branch` sia quello pubblicato da GitHub Pages (di solito `main`).
3. Apri `foto/admin.html`, incolla il token (la password per ora è indifferente) e premi **Entra**:
   la prima volta ti chiede di scegliere la **password per la famiglia**.
   Usa una frase lunga (es. `elia-dorme-sul-divano-della-nonna`): è l'unica cosa
   che protegge le foto, quindi più è lunga meglio è.

### Caricare le foto

Da `foto/admin.html` (funziona anche dal telefono): scegli le foto, aggiungi se vuoi
una didascalia e correggi la data, premi **Carica**. Le foto vengono ridimensionate
(max 2048 px), private dei metadati (posizione GPS, modello del telefono…) e cifrate
sul tuo dispositivo. Dopo 1–2 minuti (il tempo che GitHub Pages aggiorni il sito)
compaiono nell'album, raggruppate per giorno. Dalla stessa pagina puoi cambiare
didascalie e date, eliminare foto e cambiare la password.

### Cosa protegge e cosa no

- ✅ Senza password le foto non si possono vedere né scaricare: i file sono cifrati.
- ✅ Cambiando password tutte le foto vengono ri-cifrate con una chiave nuova: anche
  i dispositivi "ricordati" dovranno inserire la password nuova.
- ⚠️ Salvataggio e screenshot sono **ostacolati** (niente tasto destro / "Salva immagine",
  foto disegnate su canvas, sfocatura quando l'app passa in secondo piano o si preme
  Stamp, stampa disattivata, filigrana sulle foto grandi), ma **nessun sito web può
  impedirli del tutto**: dal telefono uno screenshot si può sempre fare. Condividi
  la password solo con chi ti fidi.
- ⚠️ Le vecchie versioni dei file restano nella cronologia git: sono comunque cifrate
  (con la vecchia password). Eliminare una foto la toglie dall'album, non dalla cronologia.
- ℹ️ Il token GitHub dà accesso in scrittura al repository: non condividerlo e spunta
  "Ricorda il token" solo sui tuoi dispositivi.
