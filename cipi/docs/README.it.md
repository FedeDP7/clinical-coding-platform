# CIPI API — Setup

Embedded Coding Tool (CODIT) e REST API per il dataset CIPI v2.0 (Dicembre 2025).

## Obiettivo

Il progetto è composto da tre parti:

- **conversione dati** da Excel CIPI a JSON (`scripts/convert_cipi.php`)
- **REST API** per interrogazione di codici, gerarchia, ricerca e crosswalk
- **libreria JavaScript** (CODIT) per integrare un campo di ricerca/browsing nei sistemi esterni

L'obiettivo è fornire un componente riusabile che permetta di cercare, selezionare e gestire codici CIPI.

---

## Struttura del progetto

```text
Progetto_Sviluppo_CIPI/
├── scripts/
│   ├── convert_cipi.php   ← step 1: converte CIPI.xlsx --> cipi.json
│   └── convert_cipi.mjs   ← port Node del converter (alternativa)
├── api/
│   ├── index.php          ← REST API
│   └── data/
│       ├── CIPI.xlsx      ← sorgente
│       └── cipi.json      ← generato da convert_cipi.php
├── cipi-codit.js          ← libreria JS (CODIT)
├── cipi-codit.css         ← stili libreria
├── Web/cipi.html              ← demo browser
├── Web/sdo.html               ← demo SDO
├── Web/style.css, Web/style_sdo.css
└── Samples/               ← pattern di integrazione
    ├── Browser/
    ├── Callback/
    ├── CodingTool/
    ├── Popup/
    └── SDO/
```

## Setup

### 1. Conversione Excel (xlsx) --> JSON

```bash
php scripts/convert_cipi.php api/data/CIPI.xlsx api/data/cipi.json
```

Richiede solo PHP built-in: `ZipArchive` + `SimpleXML`. Sintetizza automaticamente i nodi gerarchici mancanti (chapter `85`, `G1`, `G2`, `G3`, `G9`, `M0`, `M1` + ~787 nodi a 4 cifre).

Alternativa Node (stessa logica): `node scripts/convert_cipi.mjs`.

### 2. Server web

```bash
php -S localhost:8000
```

### 3. Test API

```
GET /api/index.php?route=/release
GET /api/index.php?route=/release/20251215/chapter
GET /api/index.php?route=/release/20251215/entity/00.00.0A
GET /api/index.php?route=/release/20251215/search?q=approccio
GET /api/index.php?route=/release/20251215/crosswalk/icd9/54.21
```

## Endpoint

| Metodo | URL                                        | Descrizione                            |
| ------ | ------------------------------------------ | -------------------------------------- |
| GET    | `/release`                                 | Lista rilasci                          |
| GET    | `/release/{id}`                            | Info rilascio                          |
| GET    | `/release/{id}/chapter`                    | Elenco capitoli                        |
| GET    | `/release/{id}/entity/{code}`              | Entità per codice                      |
| GET    | `/release/{id}/entity/{code}/children`     | Figli diretti                          |
| GET    | `/release/{id}/entity/{code}/ancestors`    | Percorso radice-->entità                 |
| GET    | `/release/{id}/search?q=...`               | Ricerca per codice/titolo/incl/excl    |
| GET    | `/release/{id}/resolve/{code}`             | Risoluzione codice (shortEntity)       |
| GET    | `/release/{id}/crosswalk/icd9/{code}`      | ICD-9-CM --> CIPI                        |
| GET    | `/release/{id}/crosswalk/icd10/{code}`     | CIPI --> ICD-9-CM                        |

### Parametri ricerca

| Parametro      | Tipo   | Descrizione                                              |
| -------------- | ------ | -------------------------------------------------------- |
| `q`            | string | Testo (min 2 chars)                                      |
| `terminalOnly` | bool   | Solo codici terminali (Codificanti)                      |
| `classKind`    | string | `chapter` / `block` / `sottocategoria cat 4` / `codificante` |
| `chapter`      | string | Filtra per capitolo                                      |
| `page`         | int    | Pagina (default 1)                                       |
| `pageSize`     | int    | Risultati per pagina (max 100, default 20)               |

## Libreria CODIT — uso minimo

HTML:
```html
<input type="text" class="ict-input" data-ict-ino="1" placeholder="Cerca procedura...">
<div class="ict-window" data-ict-ino="1"></div>
```

JS (settings + callbacks separati):
```html
<script src="cipi-codit.js"></script>
<script>
CODIT.Handler.configure({
  apiBaseUrl: 'http://localhost:8000/api/index.php',
  releaseId: '20251215',
}, {
  onSelect: (data) => {
    console.log(data.code, data.title);
    console.log('classKind:', data.classKind, 'terminal:', data.isTerminal);
  },
  onClear: (ino) => {
    console.log('cleared', ino);
  }
});
</script>
```

`window.CODIT` è alias di `window.ICT` — entrambi funzionano. La libreria espone anche un Browser ad albero (`data-icb-ino="N"`) e modali (Popup/Detail/Hierarchy). Vedi `Samples/` per i pattern di integrazione.

## Flusso selezione

```
utente seleziona codice
--> libreria chiama /resolve/{code}     (shortEntity)
--> libreria chiama /entity/{code}      (inclusioni, esclusioni, note)
--> aggiorna UI (dettagli inline o popover)
--> invoca onSelect(data) con SelectionData
```

Alcuni campi sono inclusi direttamente nella `/search` per ridurre il numero di chiamate HTTP. I dati completi restano disponibili via `/entity` e `/resolve`.

## Note sul dataset CIPI

Il dataset CIPI v2.0 ha lacune nella gerarchia (chapter `17`, `85`, `G1`, `G2`, `G3`, `G9`, `M0`, `M1` + ~787 nodi intermedi a 4 cifre). Il converter sintetizza automaticamente entità placeholder per mantenere navigabile il tree (`id` prefix `SYNTH:`, `title` = "(struttura sintetica…)").

### Schema entità

Campi presenti nel JSON di output:

| Campo          | Tipo            | Descrizione                                                            |
| -------------- | --------------- | ---------------------------------------------------------------------- |
| `id`           | string          | Identificatore CIPI (es. `CIPI251215C000000001`)                       |
| `code`         | string          | Codice CIPI 2025 (es. `00.00.0A`)                                      |
| `title`        | string          | Descrizione                                                            |
| `classKind`    | string          | `chapter` / `block` / `sottocategoria cat 4` / `codificante`           |
| `typeRaw`      | string          | Tipo originale dell'xlsx (es. `4 Cifre, Rubrica`)                      |
| `section`      | string \| null  | Sezione di appartenenza                                                |
| `parent`       | string \| null  | Codice padre nella gerarchia                                           |
| `isTerminal`   | bool            | True per `codificante`                                                 |
| `inclusions`   | string \| null  | Testo "INCLUSIONI" (sorgente)                                          |
| `exclusions`   | string \| null  | Testo "ESCLUSIONI" (sorgente)                                          |
| `generalNotes` | string \| null  | Note                                                                   |
| `ahrqClass`    | string \| null  | Equivalenza AHRQ (presente solo sui codificanti)                       |
| `icd9cmCode`   | string \| null  | Trans-codifica ICD-9-CM                                                |
| `validFrom`    | string \| null  | `YYYY-MM-DD`                                                           |
| `validTo`      | string \| null  | `YYYY-MM-DD`                                                           |

### Statistiche release

| Chiave              | Valore                          |
| ------------------- | ------------------------------- |
| `id`                | `20251215`                      |
| `description`       | `CIPI versione 2.0 (Dicembre 2025)` |
| `validFrom`         | `2025-12-15`                    |
| `validTo`           | `2026-12-31`                    |
| `source`            | `Ministero della Salute`        |
| `license`           | `CC BY-NC-ND 4.0`               |
| `totalEntities`     | `15958` (incl. sintetiche)      |
| `totalCodable`      | `10671` (codificanti terminali) |
| `sourceRows`        | `15164` (righe xlsx)            |
| `syntheticEntities` | `794` (placeholder gerarchia)   |
