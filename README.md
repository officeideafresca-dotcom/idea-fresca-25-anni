# Idea Fresca — 25 Anni · Digital Vision Mosaic & Numbers Quest

Web-app per l'attività di gruppo del retreat: 80 persone, 10 tavoli, 4 lingue, 30 minuti.
Nessuna installazione: i partecipanti scansionano un QR Code e usano il browser del telefono.

## Come funziona

- **Partecipanti** (`/`): scelgono il tavolo (1–10). **Solo la prima persona che si dichiara
  "Team Leader" per quel tavolo** può inserire/modificare i 3 numeri chiave della visione
  2027–2028 (bloccato anche lato server, non solo nell'interfaccia) — tutti gli altri al tavolo
  vedono i numeri in sola lettura, ma possono comunque caricare foto e icone. Ogni foto richiede
  un **Power Message** obbligatorio: una frase che viene disegnata direttamente sui pixel della
  foto (non solo salvata a parte), quindi appare sempre insieme allo scatto ovunque venga
  mostrato — pop-up, mosaico, immagine finale. Interfaccia automatica in IT/DE/FR/ES (rilevata
  dalla lingua del telefono, cambiabile a mano).
- **Schermo grande** (`/screen`): mostra il QR e il countdown, poi il flusso live dei numeri e
  delle foto, l'assemblaggio del mosaico e il reveal finale con le 10 Vision Card e i totali
  aggregati. È una vista **di sola visualizzazione**, senza alcun controllo — pensata per essere
  proiettata davanti a tutti senza mostrare pulsanti o PIN.
- **Pannello di regia** (`/admin`): pagina separata, protetta da PIN, da aprire sul **tuo
  telefono o laptop personale** (non sul maxischermo). Da qui avvii/metti in pausa il timer,
  cambi fase manualmente, resetti i dati e scarichi l'immagine finale.

Tutto è **in tempo reale** (Socket.IO): quando un tavolo invia i numeri o una foto, lo schermo
grande e i telefoni di tutti gli altri si aggiornano istantaneamente.

## Due modi per farla girare

- **In locale (LAN)**: il server gira su un PC in sala e tutti i telefoni devono essere sulla
  stessa rete Wi-Fi di quel PC. Semplice ma dipende dal Wi-Fi della sala (vedi sotto).
- **Online (consigliato)**: pubblichi l'app su un servizio come [Render](https://render.com)
  (gratuito) e ottieni un indirizzo pubblico tipo `https://idea-fresca-25-anni.onrender.com`.
  A quel punto ogni partecipante può collegarsi con i **dati mobili** o qualsiasi Wi-Fi
  disponibile — non serve più che tutti siano sulla stessa rete. Vedi la sezione
  **"Pubblicare online su Render"** più sotto.

## Avvio rapido (in locale)

```bash
npm install
npm start
```

Il terminale stampa due indirizzi, ad es.:

```
Partecipanti (QR): http://192.168.1.42:3000/
Schermo grande:    http://192.168.1.42:3000/screen
PIN Admin: 2525
```

1. Apri l'indirizzo **"Schermo grande"** sul PC collegato al videoproiettore/maxischermo.
2. Il QR Code mostrato a schermo punta già all'indirizzo giusto per i telefoni: basta proiettarlo.
3. Il PC che ospita il server e tutti gli smartphone devono essere sulla **stessa rete Wi-Fi**
   (es. il Wi-Fi della sala). Non serve alcuna connessione a internet esterna.

Per cambiare porta o PIN admin:

```bash
# PowerShell
$env:PORT=3000; $env:ADMIN_PIN=1234; npm start
```

## Uso durante l'evento

1. Prima dell'evento: lancia il server sul PC regia, apri `/screen` sul maxischermo, e apri
   `/admin` sul tuo telefono/laptop personale (inserisci il PIN admin per sbloccare i comandi).
2. Proietta il QR (fase "Lancio"): gli 80 partecipanti scansionano ed entrano su `/`.
3. Dal pannello `/admin` premi **Avvia** per far partire il countdown (durata configurabile) e
   passare alla fase "Sfida Numerica" — nulla di questo è visibile sul maxischermo.
4. I tavoli inseriscono i numeri e caricano le foto dai propri telefoni: tutto appare live sul
   maxischermo (contatori che salgono, foto che appaiono e si aggiungono al mosaico).
5. Usa i pulsanti di fase nel pannello `/admin` per passare a "Assemblaggio" e infine
   "Vision Reveal" (attiva lo zoom a spirale sulle 10 card e il banner finale). Il countdown a
   30 minuti si ferma da solo a 00:00 ma **non cambia fase automaticamente**: sei sempre tu a
   decidere quando far avanzare l'evento.
6. Dal pannello `/admin` premi **Salva e invia a tutti i telefoni**: scarica un PNG in alta
   qualità sul tuo dispositivo (mosaico + numeri totali) e, allo stesso tempo, mostra
   l'immagine finale direttamente sul telefono di tutti i partecipanti ancora collegati, con un
   pulsante per salvarla — non serve raccogliere email o numeri di nessuno.
7. **Reset completo dei dati** (sempre da `/admin`) cancella tutto per una nuova sessione
   (es. prova generale prima dell'evento vero).

## Pubblicare online su Render (nessuna installazione di Git richiesta)

Con l'app pubblicata online, il giorno dell'evento nessuno dipende dal Wi-Fi della sala: ogni
telefono può usare i propri dati mobili, e il PC regia può essere collegato a qualunque
connessione internet.

**1. Carica il codice su GitHub (dal browser, senza installare Git)**

1. Vai su [github.com](https://github.com) e crea un account gratuito se non ne hai già uno.
2. Clicca **New repository**, dai un nome (es. `idea-fresca-25-anni`), lascialo **Public** o
   **Private** (va bene entrambi), NON aggiungere README/licenza, poi **Create repository**.
3. Nella pagina del repo appena creato, clicca il link **"uploading an existing file"**.
4. Apri Esplora File sul PC, entra nella cartella `idea-fresca-25-anni` e **trascina tutto il
   contenuto della cartella** (i file `server.js`, `package.json`, `README.md`, e le sottocartelle
   `public`) nell'area di upload del browser. GitHub mantiene automaticamente le sottocartelle.
5. In basso scrivi un messaggio (es. "Prima versione") e clicca **Commit changes**.

**2. Collega il repository a Render**

1. Vai su [render.com](https://render.com) e registrati (puoi accedere direttamente con
   l'account GitHub appena creato).
2. Clicca **New +** → **Blueprint** (rileva automaticamente il file `render.yaml` già incluso
   nel progetto) — in alternativa **New +** → **Web Service** e collega manualmente il repo.
3. Autorizza Render ad accedere al tuo account GitHub e seleziona il repository
   `idea-fresca-25-anni`.
4. Render rileva già i comandi corretti dal file `render.yaml` (`npm install` / `npm start`).
   Ti verrà chiesto di impostare la variabile `ADMIN_PIN`: scegli un codice numerico a piacere.
5. Clicca **Deploy**. Dopo 1-2 minuti Render ti darà un indirizzo pubblico tipo
   `https://idea-fresca-25-anni.onrender.com`.

**3. Il giorno dell'evento**

- Apri `https://<il-tuo-indirizzo>.onrender.com/screen` sul PC collegato al proiettore.
- Apri `https://<il-tuo-indirizzo>.onrender.com/admin` sul tuo telefono/laptop personale per i
  comandi (PIN richiesto) — questa pagina non va mai proiettata.
- Il QR mostrato su `/screen` punterà già automaticamente all'indirizzo pubblico corretto.
- Qualunque partecipante può scansionarlo e partecipare da qualsiasi rete (dati mobili inclusi).

**⚠️ Importante — piano gratuito Render**: il piano free "si addormenta" dopo ~15 minuti di
inattività e il primo caricamento successivo può richiedere 30-60 secondi. Per un evento dal
vivo, **10-15 minuti prima dell'inizio** apri tu stesso la pagina `/screen` per "svegliare" il
servizio, oppure — più sicuro — passa temporaneamente al piano a pagamento più economico di
Render (qualche dollaro) solo per il giorno dell'evento, così il servizio resta sempre attivo.

## Personalizzazione

- **Numero di tavoli**: `TABLE_COUNT` in [server.js](server.js).
- **Colori dei tavoli**: array `TABLE_COLORS` in [server.js](server.js).
- **Testi e lingue**: [public/js/i18n.js](public/js/i18n.js) — aggiungere una lingua è questione
  di aggiungere una nuova chiave a `window.I18N` e all'array `LANGS`/`ROTATE_LANGS`.
- **Icone simboliche**: array `ICONS`/`ICON_EMOJI` in [server.js](server.js),
  [public/js/participant.js](public/js/participant.js) e [public/js/screen.js](public/js/screen.js).

## Note tecniche

- Stato in memoria sul server (nessun database): pensato per una sessione live di 30 minuti.
  Riavviare il server azzera tutto — usa il pulsante **Reset** per una nuova sessione mantenendo
  il server attivo.
- Le foto vengono compresse lato telefono (max 640px, JPEG) prima dell'invio per restare veloci
  anche su reti Wi-Fi affollate con 80 persone connesse.
- Consigliato: fare una prova con 2–3 telefoni collegati alla stessa rete prima dell'evento vero,
  e verificare che il PC regia non vada in stand-by/sospensione durante l'attività.
