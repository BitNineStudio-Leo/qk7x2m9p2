# Lista nascita

Sito statico (HTML + CSS + JS). I regali stanno in `prodotti.csv`, che puoi
importare in Google Sheets: da lì segni cosa è stato regalato.

## 1. Google Sheet
1. Sheets → File → Importa → carica `prodotti.csv` (separatore: virgola).
2. Colonna `regalato`: scrivi `sì` per un regalo già fatto, lascia vuoto altrimenti.
3. File → Condividi → **Pubblica sul web** → scegli il foglio → formato **CSV** → Pubblica.
4. Copia il link e incollalo in `config.js` al posto di `sheetCsvUrl: ""`.

Le modifiche compaiono sul sito entro pochi minuti (Google mette in cache il CSV).

## 2. GitHub Pages
1. Crea un repository pubblico e carica tutti i file di questa cartella.
2. Settings → Pages → Source: *Deploy from a branch* → `main` / root.
3. Il sito sarà su `https://TUO-UTENTE.github.io/NOME-REPO/`.

## Modificare la lista
- Nuovo regalo: aggiungi una riga nel foglio e metti la foto della scheda in `assets/cards/`
  (quadrata, ~640 px, .webp/.png), poi scrivi il percorso nella colonna `immagine`.
- Regalati: in `config.js` metti `regalati: "nascondi"` per farli sparire invece di ingrigirli.
