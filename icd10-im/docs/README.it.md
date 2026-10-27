# ICD-10-IM Coding Tool — Setup

> **Politica di pubblicazione:** questa repository distribuisce codice, documentazione e test sintetici. I dataset ufficiali e i JSON generati restano esclusi; non è previsto avviare richieste di autorizzazione alla redistribuzione né offrire un servizio pubblico dei dati. Le istruzioni seguenti descrivono soltanto l’integrazione locale di materiale già legittimamente disponibile. [Politica completa](../../docs/DATA_SOURCES.md).

Embedded Coding Tool e REST API per **ICD-10-IM**, progettati per offrire un'integrazione semplice lato sviluppatore e una struttura compatibile, a livello concettuale, con l'uso futuro di ICD-11. Il parametro `source` è predisposto per ospitare futuri dataset (es. `mms` / `icf` / `foundation` allineati al WHO ECT v1.8), ma attualmente la whitelist autorizza `icd10im` e `cipi`.

## Obiettivo

Il progetto è composto da quattro parti fondamentali:

*   **Conversione dati**: Trasformazione del file Excel (`ICD-10-IM`) in formato `JSON` ottimizzato.
*   **REST API**: Interfaccia unica per interrogazione di codici, gerarchie, ricerche e crosswalk.
*   **Libreria JavaScript (`icd10im-codit.js`)**: Componente condiviso per integrare campi di ricerca e browsing in sistemi esterni.
*   **Samples**: Esempi di riferimento per i vari pattern di integrazione (Browser, Callback, CodingTool, MultiInstance, Popup, SDO), con landing page.

L'obiettivo è fornire un componente riusabile, ispirato all'**Embedded Coding Tool ICD-11**, che permetta di gestire la classificazione ICD-10-IM con logiche estendibili (daga/asterisco, SDO, blocchi/categorie, ecc.).

---

## Struttura del Progetto

```text
Progetto_Sviluppo/
├── icd10im-codit.js        <-- Libreria JS unica (alias: window.ICT / CODIT)
├── icd10im-codit.css       <-- Stili prefissati .ict-* (zero collisioni con host)
├── api/
│   ├── index.php           <-- REST API ICD-10-IM
│   └── data/
│       ├── icd10im.json    <-- Generato da scripts/convert.php
│       └── icd10im.xlsx
├── scripts/
│   └── convert.php         <-- .xlsx ICD-10-IM --> JSON
├── Samples/                <-- Esempi minimi + landing (index.html): Browser, Callback,
│                               CodingTool, MultiInstance, Popup, SDO
└── README.md
```

---

## Setup

### 1. Conversione del file Excel (XLSX) → JSON

```bash
php scripts/convert.php api/data/icd10im.xlsx api/data/icd10im.json
```

> [!NOTE]
> Richiede PHP built-in con estensioni `ZipArchive` e `SimpleXML`.

### 2. Avvio Server Web
Per lo sviluppo locale, è possibile utilizzare il server integrato di PHP:
```bash
php -S localhost:8000
```

### 3. Demo Disponibili

Landing page con tutti i sample: `http://localhost:8000/index.html`

| URL                                                       | Pattern                                  |
| :-------------------------------------------------------- | :--------------------------------------- |
| `http://localhost:8000/Samples/Browser/browser.html`     | Input + albero gerarchico, click-to-sync |
| `http://localhost:8000/Samples/Callback/callback.html`   | WHO CODIT v1.8, target esterno           |
| `http://localhost:8000/Samples/CodingTool/CodingTool.html`| Zero-config, ricerca inline              |
| `http://localhost:8000/Samples/MultiInstance/MultiInstance.html` | Più istanze indipendenti          |
| `http://localhost:8000/Samples/Popup/popup.html`         | Window popover floating                  |
| `http://localhost:8000/Samples/SDO/sdo.html`             | Scheda di Dimissione Ospedaliera         |

### 4. Test API

```bash
# Esempi di chiamate ICD-10-IM
GET /api/index.php?route=/release
GET /api/index.php?route=/release/20260216/chapter
GET /api/index.php?route=/release/20260216/entity/A00.0
GET /api/index.php?route=/release/20260216/search?q=colera
GET /api/index.php?route=/release/20260216/crosswalk/icd9/001.0
```

---

## Endpoint API

Sorgenti autorizzate: `icd10im` (default) e `cipi`; il prefisso è opzionale per ICD-10-IM.

| Metodo | Endpoint                                             | Descrizione                            |
| :----- | :--------------------------------------------------- | :------------------------------------- |
| GET    | `/release`                                           | Lista rilasci                          |
| GET    | `/release/{id}`                                      | Informazioni rilascio                  |
| GET    | `/release/{id}/chapter`                              | Elenco capitoli                        |
| GET    | `/release/{id}/entity/{code}`                        | Dettagli entità per codice             |
| GET    | `/release/{id}/entity/{code}/children`               | Figli diretti della gerarchia          |
| GET    | `/release/{id}/entity/{code}/ancestors`              | Percorso radice --> entità             |
| GET    | `/release/{id}/entity/{code}/associations`           | Codici correlati/associati             |
| GET    | `/release/{id}/search?q=...`                         | Ricerca per codice o testo             |
| GET    | `/release/{id}/resolve/{code}`                       | Risoluzione selezione singola/composta |
| GET    | `/release/{id}/crosswalk/icd9/{code}`                | ICD-9-CM --> ICD-10-IM                 |
| GET    | `/release/{id}/crosswalk/icd10/{code}`               | ICD-10-IM --> ICD-9-CM                 |

### Parametri di Ricerca (`/search`)

| Parametro      | Tipo   | Descrizione                                                  |
| :------------- | :----- | :----------------------------------------------------------- |
| `q`            | string | Testo della ricerca (minimo 2 caratteri)                     |
| `terminalOnly` | bool   | Se true, restituisce solo codici terminali (SDO)             |
| `classKind`    | string | Filtra per tipo: `chapter`, `block` o `category`             |
| `chapter`      | string | Filtra per capitolo o sottoalbero (mappato `subtreesFilter`) |
| `page`         | int    | Numero pagina (default: 1)                                   |
| `pageSize`     | int    | Risultati per pagina (max 100, default: 15)                  |

---

## Libreria CODIT — Utilizzo Minimo

### Markup HTML
```html
<!-- Input di ricerca -->
<input type="text" class="ict-input" data-ict-ino="1" placeholder="Cerca diagnosi…">

<!-- Container dei risultati (window) -->
<div class="ict-window" data-ict-ino="1"></div>
```

### Configurazione JS
Alias globali disponibili: `window.ICT` e `window.CODIT` (identici).
Il pattern segue lo standard WHO ECT separando configurazioni e callback: `CODIT.Handler.configure(settings, callbacks);` (le callback sono accettate anche dentro `settings` come fallback).

```html
<link rel="stylesheet" href="icd10im-codit.css">
<script src="icd10im-codit.js"></script>

<script>
  CODIT.Handler.configure({
    apiBaseUrl: '../../api/index.php', // relativo alla pagina; oppure URL assoluto dell'API
    releaseId:  '20260216',
    onSelect: (entity, ino, resolved) => {
      console.log("Selezionato:", entity.code, entity.title);
      console.log("Dettagli risolti:", resolved);
    },
    onClear: (ino) => console.log('Campo pulito', ino),
  });
</script>
```

### Opzioni di Configurazione

| Parametro                 | Default      | Descrizione                                                                              |
| :------------------------ | :----------- | :--------------------------------------------------------------------------------------- |
| `apiBaseUrl`              | `http://...` | Endpoint REST principale dell'API.                                                       |
| `releaseId`               | `20260216`   | Identificativo della release attiva.                                                     |
| `source`                  | `icd10im`    | Dataset attivo. Se uguale al default, URL senza prefisso (retro-compatibilità).          |
| `subtreesFilter`          | `null`       | Codice (es. `A00-B99`) per restringere la ricerca a un sottoalbero (param `chapter`).    |
| `chaptersAvailable`       | `true`       | Se `false`, nasconde l'albero dei capitoli nel Browser (modalità solo ricerca).          |
| `popupMode`               | `false`      | Se `true`, ogni input apre un popup modale invece di renderizzare inline.                |
| `terminalOnly`            | `false`      | Se `true`, limita i risultati ai soli codici terminali SDO.                              |
| `debounceMs`              | `150`        | Ritardo (ms) prima di eseguire la ricerca durante la digitazione.                        |
| `pageSize`                | `15`         | Numero di risultati restituiti per pagina.                                               |
| `keepWindowOnSelect`      | `false`      | Se `true`, la finestra dei risultati resta visibile dopo la selezione.                   |
| `showInlineDetails`       | `true`       | Se `false`, non renderizza il pannello dettagli inline post-select (modalità non popup). |
| `showWordList`            | `true`       | Se `false`, nasconde la colonna "Elenco Termini" nei risultati (layout 1-col).           |
| `clearInputOnSelect`      | `false`      | Se `true`, dopo la selezione pulisce l'input host invece di mostrare "code — title".     |
| `revealInTreeOnSearch`    | `true`       | Se `false`, la digitazione non auto-rivela il primo risultato nell'albero.               |
| `inlineResults`           | `false`      | Se `true`, la finestra dei risultati scorre inline (no dropdown absolute, no overlay).   |
| `isDisabled`              | `null`       | Callback `(code, ino) => bool`: se `true`, il risultato appare disabilitato.             |

### Callback Disponibili

| Callback                 | Firma                                  | Descrizione                                                                |
| :----------------------- | :------------------------------------- | :------------------------------------------------------------------------- |
| `onSelect`               | `(entity, ino, resolved) => void`      | Invocato dopo la selezione di un'entità.                                   |
| `onClear`                | `(ino) => void`                        | Invocato al reset di un'istanza.                                           |
| `onSearchStart`          | `(query, ino) => void`                 | Invocato all'inizio di una ricerca.                                        |
| `onSearchEnd`            | `(query, results, ino) => void`        | Invocato al termine di una ricerca.                                        |
| `selectedEntityFunction` | `(data) => void`                       | Alias WHO ECT v1.8 di `onSelect`. Se entrambi presenti, invocato per primo.|

### Modulo SDO

Il componente completo della Scheda di Dimissione Ospedaliera (diagnosi principale + secondarie, flusso daga/asterisco, dettagli, modali) è integrato nella libreria. L'host fornisce solo un container vuoto:

```html
<div id="sdo"></div>
<script>
  CODIT.SDO.init({
    container: "#sdo",
    settings: { apiBaseUrl: "../../api/index.php", releaseId: "20260216" },
  });
</script>
```

Opzioni: `maxSecondary` (default 10), `placeholder`. Ritorna `{ reset, getState }`. Tutti gli stili usano classi prefissate `.ict-sdo-*` (nessun CSS host richiesto).

---

## Flusso di Lavoro

```text
Selezione di un codice
  --> La libreria esegue una chiamata a /resolve/...
  --> L'API legge associatedCodes, hasDagger, hasAsterisk (se presenti nel dataset)
  --> Viene costruita una risposta semantica strutturata
  --> La libreria memorizza e processa la risposta
  --> La UI (demo o host) mostra lo stato reale della selezione
```

Alcuni campi critici sono inclusi direttamente nei risultati della ricerca per massimizzare la reattività dell'interfaccia utente. I dettagli completi sono recuperati asincronamente tramite gli endpoint `/entity` e `/resolve`.

### Campi della Risposta `/resolve`

| Campo                  | Descrizione                                                                              |
| :--------------------- | :--------------------------------------------------------------------------------------- |
| `selectedCode`         | Entità selezionata (formato `shortEntity`).                                              |
| `associatedEntities`   | Lista entità collegate via `associatedCodes`.                                            |
| `isComposite`          | `true` se la selezione richiede o ammette una coppia daga/asterisco.                     |
| `requiresPair`         | `true` se la selezione DEVE essere accoppiata (asterisco o daga esplicita con associati).|
| `associationType`      | `dagger-asterisk` \| `possible-dagger` \| `none`.                                        |
| `selectionMode`        | `paired` o `single` in base a `requiresPair`.                                            |
| `compositionType`      | `asterisco` \| `daga` \| `daga possibile` \| `null`.                                     |
| `sdoPlacement`         | Posizione SDO: `campo1_asterisco` \| `campo2_dagger` \| `campo2_dagger_opzionale` \| `null`. |
| `sdoRequiresPlacement` | `true` se il codice richiede un posizionamento SDO esplicito.                            |

---

## Note Architetturali

*   **Schema Unificato**: Lo schema dati (`entities`, `byCode`, `byParent`, `chapters`) è progettato per essere riusato da classificazioni multiple, permettendo un unico set di handler API.
*   **Data-Driven Logic**: Campi specifici (come daga/asterisco in ICD-10-IM) sono rilevati automaticamente. Se assenti, la libreria disabilita le relative componenti UI in modo trasparente.
*   **Sicurezza**: La whitelist `ALLOWED_SOURCES` nell'API impedisce attacchi di tipo *path traversal* sui file JSON locali.
*   **Estensibilità**: Per aggiungere una nuova classificazione (es. ICD-11), è sufficiente generare il file JSON corrispondente, aggiungerlo alla whitelist e configurare il client con il nuovo valore di `source`.
