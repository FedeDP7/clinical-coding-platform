<?php
declare(strict_types=1);

/**
 * api/index.php — ICD-10-IM REST API
 * gestisce tutte le richieste API
 * fornisce dati sulle malattie, codici e loro associazioni
 * Le chiamate sono gestite in base ai parametri richiesti e restituiranno i dati in formato JSON.
 */

// Headers per garantire che la risposta sia JSON
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *'); // Permette richieste da qualsiasi origine
header('Access-Control-Allow-Methods: GET, OPTIONS'); // Solo metodi GET e OPTIONS
header('Access-Control-Allow-Headers: Accept, X-Api-Key'); // Headers che il server permette

// Gestione di OPTIONS
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204); // non c'è una risposta da restituire
    exit;
}

// Se non è una richiesta GET ritorna errore 405
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    err(405, 'METHOD_NOT_ALLOWED', 'Solo GET');
}

// PHP parses bracket parameters (e.g. q[]=x) as arrays. Reject them
// before routing or string operations, preserving the JSON error contract.
foreach ($_GET as $name => $value) {
    if (!is_string($value)) {
        err(400, 'INVALID_PARAM', 'I parametri devono essere stringhe semplici');
    }
}
foreach (['page', 'pageSize'] as $parameter) {
    if (isset($_GET[$parameter]) && filter_var($_GET[$parameter], FILTER_VALIDATE_INT) === false) {
        err(400, 'INVALID_PARAM', 'I parametri di paginazione devono essere interi rappresentabili');
    }
}

// Risoluzione source (dataset attivo): prefix di path opzionale, default 'icd10im'.
// Mantiene retro-compatibilità con URL legacy (senza prefix) --> icd10im implicito.
const ALLOWED_SOURCES = ['icd10im', 'cipi'];
const DEFAULT_SOURCE  = 'icd10im';

// Routing analizza il percorso della richiesta e indirizza alla funzione corretta
$path = $_GET['route'] ?? parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$path = preg_replace('#^/api/v1#', '', $path); // Rimuove la parte /api/v1 dalla URL
$path = rtrim($path, '/') ?: '/'; // Rimuove gli slash

// Estrae il source da un prefix opzionale: /{source}/release/... --> /release/...
// Whitelist obbligatoria --> no path traversal su data/{source}.json
$source = DEFAULT_SOURCE;
if (preg_match('#^/([a-z0-9_-]+)(/release(?:/|$).*)$#', $path, $sm)) {
    if (in_array($sm[1], ALLOWED_SOURCES, true)) {
        $source = $sm[1];
        $path   = $sm[2]; // rimuove il prefix --> routes existing matchano invariati
    }
}

// Carica dati dal file JSON corrispondente al source attivo
$jsonFile = __DIR__ . "/data/{$source}.json";
if (!file_exists($jsonFile)) { // se il file non esiste da errore
    err(503, 'DATA_NOT_READY', "Eseguire prima lo script di conversione per il source '{$source}'");
}

// Carica i dati in memoria ogni volta che viene fatta una richesta
$DATA = json_decode(file_get_contents($jsonFile), true);
if ($source === 'icd10im') {
    require_once __DIR__ . '/hierarchy.php';
    $DATA = normalizeIcd10imHierarchy($DATA);
}
$ENTITIES  = &$DATA['entities']; // entità e dettagli
$BY_CODE   = &$DATA['byCode']; // codici
$BY_PARENT = &$DATA['byParent']; // genitore
$BY_ICD9   = &$DATA['byIcd9']; // codici transcodifica
$CHAPTERS  = &$DATA['chapters']; // capitoli
$RELEASE   = &$DATA['release']; // release corrente

// Header release: nome dinamico per source (es. X-ICD10IM-Release)
header('X-' . strtoupper($source) . '-Release: ' . $RELEASE['id']);
header('X-Source: ' . $source);

// Percorsi API e le funzioni che hanno
$routes = [
    '#^/release$#'                                      => 'handleRelease',
    '#^/release/([^/]+)$#'                              => 'handleReleaseInfo',
    '#^/release/([^/]+)/chapter$#'                      => 'handleChapters',
    '#^/release/([^/]+)/entity/([^/]+)$#'               => 'handleEntity',
    '#^/release/([^/]+)/entity/([^/]+)/children$#'      => 'handleChildren',
    '#^/release/([^/]+)/entity/([^/]+)/ancestors$#'     => 'handleAncestors',
    '#^/release/([^/]+)/entity/([^/]+)/associations$#'  => 'handleAssociations',
    '#^/release/([^/]+)/search$#'                       => 'handleSearch',
    '#^/release/([^/]+)/resolve/([^/]+)$#'              => 'handleResolve',
    '#^/release/([^/]+)/crosswalk/icd9/([^/]+)$#'       => 'handleCrosswalkIcd9',
    '#^/release/([^/]+)/crosswalk/icd10/([^/]+)$#'      => 'handleCrosswalkIcd10',
];
// Confronta il percorso con le espressioni regolari e chiama la funzione corrispondente
foreach ($routes as $pattern => $fn) {
    if (preg_match($pattern, $path, $m)) {
        $fn($m);
        exit;
    }
}
// Percorso non trovato
err(404, 'NOT_FOUND', "Endpoint non trovato: $path");


// Gestione operazioni Handlers:

// handleRelease
// Per gestire la richiesta e ottenere i dettagli della release
function handleRelease(array $m): void
{
    global $RELEASE;
    ok(['total' => 1, 'releases' => [$RELEASE]]);
}

// handleReleaseInfo
// Restituisce i dettagli della release nell'ID
function handleReleaseInfo(array $m): void
{
    global $RELEASE;
    assertRelease($m[1]);
    ok($RELEASE);
}

// handleChapters
// Capitoli con codice, titolo e range di codici associati
function handleChapters(array $m): void
{
    global $ENTITIES, $CHAPTERS, $BY_PARENT;
    assertRelease($m[1]);

    $result = [];
    foreach ($CHAPTERS as $i) {
        $e = $ENTITIES[$i];
        $children = $BY_PARENT[$e['code']] ?? [];

        $range = null;
        if (!empty($children)) {
            $codes = array_map(fn($i) => $ENTITIES[$i]['code'], $children);
            sort($codes, SORT_STRING);
            $range = $codes[0] . '-' . end($codes);
        }

        $result[] = [
            'code'          => $e['code'],
            'title'         => $e['title'],
            'blockRange'    => $range,
            'childrenCount' => count($BY_PARENT[$e['code']] ?? []),
            'validFrom'     => $e['validFrom'],
            'validTo'       => $e['validTo'],
        ];
    }
    ok(['releaseId' => $m[1], 'total' => count($result), 'chapters' => $result]);
}

// handleEntity
// Dettagli malattie per codice
function handleEntity(array $m): void
{
    global $ENTITIES, $BY_CODE;
    assertRelease($m[1]);
    $code = mb_strtoupper(urldecode($m[2]));
    $idx  = $BY_CODE[$code] ?? null; // Cerca l'indice dell'entità tramite il codice
    if ($idx === null) err(404, 'NOT_FOUND', "Codice '$code' non trovato"); // Codice non esiste
    ok($ENTITIES[$idx]);
}

// handleChildren
// Figli di un'entità associati a codice specifico
function handleChildren(array $m): void
{
    global $ENTITIES, $BY_CODE, $BY_PARENT;
    assertRelease($m[1]);
    $code = mb_strtoupper(urldecode($m[2]));
    if (!isset($BY_CODE[$code])) err(404, 'NOT_FOUND', "Codice '$code' non trovato");
    
    $terminalOnly = filter_var($_GET['terminalOnly'] ?? false, FILTER_VALIDATE_BOOLEAN);
    $childIdxs    = $BY_PARENT[$code] ?? [];
    $children     = [];

    foreach ($childIdxs as $i) {
        $e = $ENTITIES[$i]; // se terminalOnly è true filtra per restituire solo entità terminali
        if ($terminalOnly && !$e['isTerminal']) continue;
        $children[] = shortEntity($e);
    }

    ok(['parent' => $code, 'total' => count($children), 'children' => $children]);
}

// handleAncestors
// Antenati di un'entità
function handleAncestors(array $m): void
{
    global $ENTITIES, $BY_CODE;
    assertRelease($m[1]);
    $code = mb_strtoupper(urldecode($m[2])); // decodifica
    // controllo se esiste il codice
    if (!isset($BY_CODE[$code])) err(404, 'NOT_FOUND', "Codice '$code' non trovato");

    $ancestors = [];
    $current   = $ENTITIES[$BY_CODE[$code]]['parent'];
    $depth     = 0;
    // limite di ricerca 10 antenati
    while ($current && $depth < 10) {
        $idx = $BY_CODE[$current] ?? null; // cerca indice genitore
        if ($idx === null) break; // se non lo trova break
        $e = $ENTITIES[$idx];
        array_unshift($ancestors, [ // antenato in cima alla lista
            'code'      => $e['code'],
            'title'     => $e['title'],
            'classKind' => $e['classKind'],
        ]);
        $current = $e['parent']; // genitore successivo
        $depth++;
    }

    ok(['code' => $code, 'ancestors' => $ancestors]); // lista antenati
}

// handleAssociations
// Entità associate a codice ICD-10-IM.
function handleAssociations(array $m): void
{
    global $ENTITIES, $BY_CODE;
    assertRelease($m[1]); // release corrispondente

    $code = mb_strtoupper(urldecode($m[2])); // decodifica
    $idx  = $BY_CODE[$code] ?? null; // trova indice entità
    if ($idx === null) err(404, 'NOT_FOUND', "Codice '$code' non trovato");

    $entity = $ENTITIES[$idx];
    $assocCodes = $entity['associatedCodes'] ?? []; // codici associati
    $assocEntities = [];

    foreach ($assocCodes as $assocCode) {
        $assocIdx = $BY_CODE[$assocCode] ?? null; // indice dell'entità associata
        if ($assocIdx === null) {
            $assocEntities[] = [
                'code' => $assocCode, // Se non trovato segna come non trovato
                'found' => false,
            ];
            continue;
        }

        $assocEntities[] = [
            ...shortEntity($ENTITIES[$assocIdx]), // aggiunta entità associata
            'found' => true,
        ];
    }

    ok([
        'releaseId' => $m[1], // ID release
        'code' => $entity['code'],
        'title' => $entity['title'],
        'hasDagger' => ($entity['hasDagger'] ?? 'none'),
        'hasAsterisk' => ($entity['hasAsterisk'] ?? false),
        'associationCount' => count($assocEntities), // conta numero associazioni
        'associations' => $assocEntities,
    ]);
}

// handleSearch
// Ricerca per codice, titolo, inclusioni o definizioni
// Filtri terminalOnly e classKind
function handleSearch(array $m): void
{
    global $ENTITIES;
    assertRelease($m[1]);

    $q = trim($_GET['q'] ?? ''); // Prende la query di ricerca rimuovendo spazi
    // Numero caratteri per iniziare la ricerca
    if (mb_strlen($q) < 2) err(400, 'INVALID_PARAM', "Il parametro 'q' richiede almeno 2 caratteri");

    $terminalOnly = filter_var($_GET['terminalOnly'] ?? false, FILTER_VALIDATE_BOOLEAN); // filtra entità terminali
    $classKind    = $_GET['classKind'] ?? null;
    $chapter      = $_GET['chapter']   ?? null;
    $page         = max(1, (int)($_GET['page'] ?? 1)); // pagina corrente
    $pageSize     = min(100, max(1, (int)($_GET['pageSize'] ?? 15))); // max risultati per pagina (default 15)

    $subtree = $chapter ? searchSubtree($chapter) : null;

    $qLow    = mb_strtolower($q); // Rende la query minuscola per una ricerca case-insensitive
    $matches = [];
    // ciclo per i match
    foreach ($ENTITIES as $e) {
        if ($terminalOnly && !$e['isTerminal']) continue;
        if ($classKind && $e['classKind'] !== $classKind) continue;
        if ($subtree !== null && !isset($subtree[$e['code']])) continue;

        $score = 0; // inizializza punteggio
        $matchIn = null; // campo dove è avvenuto il match
        // Rende minuscole tutti i campi rilevanti per la ricerca
        $codeLow = mb_strtolower($e['code'] ?? '');
        $titleLow = mb_strtolower($e['title'] ?? '');
        $inclLow  = mb_strtolower($e['inclusions'] ?? '');
        $defLow   = mb_strtolower($e['definition'] ?? '');
        $exclLow  = mb_strtolower($e['exclusions'] ?? '');
        // match con punteggi differenti
        if ($codeLow === $qLow) {
            $score = 5.0;
            $matchIn = 'code_exact';
        }
        elseif (str_starts_with($codeLow, $qLow)) {
            $score = 4.0;
            $matchIn = 'code_prefix';
        }
        elseif (str_contains($titleLow, $qLow)) {
            $score = ($titleLow === $qLow) ? 3.0 : 2.0;
            $matchIn = 'title';
        }
        elseif (str_contains($inclLow, $qLow)) {
            $score = 1.0;
            $matchIn = 'inclusions';
        }
        elseif (str_contains($defLow, $qLow)) {
            $score = 0.8;
            $matchIn = 'definition';
        }
        elseif (str_contains($exclLow, $qLow)) {
            $score = 0.5;
            $matchIn = 'exclusions';
        }
        elseif (str_contains($codeLow, $qLow)) {
            $score = 1.5;
            $matchIn = 'code';
        }

        if ($score > 0) {
            $entry = shortEntity($e);
            unset($entry['associatedCodes']); // non necessario nei risultati di ricerca
            $entry['matchIn'] = $matchIn;
            $entry['_score']  = $score;
            $matches[] = $entry;
        }
    }
    // sort dei risultati dal punteggio piu alto al piu basso
    usort($matches, fn($a, $b) => $b['_score'] <=> $a['_score']);

    $total  = count($matches); // totale risultati
    $offset = $page > intdiv(PHP_INT_MAX, $pageSize) ? PHP_INT_MAX : ($page - 1) * $pageSize; // calcola l'offset
    $page_results = array_slice($matches, $offset, $pageSize); // estrae risultati
    // Rimuove score dai risultati
    $page_results = array_map(function ($r) {
        unset($r['_score']);
        return $r;
    }, $page_results);

    ok([ // Risultati in JSON
        'query'    => $q,
        'releaseId' => $m[1],
        'total'    => $total,
        'page'     => $page,
        'pageSize' => $pageSize,
        'results'  => $page_results,
    ]);
}

/**
 * handleResolve
 * informazioni relative a un codice specifico e entità associate
 */
function handleResolve(array $m): void
{
    global $ENTITIES, $BY_CODE;
    assertRelease($m[1]);

    $code = mb_strtoupper(urldecode($m[2]));
    $idx  = $BY_CODE[$code] ?? null;
    if ($idx === null) err(404, 'NOT_FOUND', "Codice '$code' non trovato");

    $entity = $ENTITIES[$idx];
    $assocCodes = $entity['associatedCodes'] ?? []; // codici associati
    $associated = [];
    // entità associate (se esistono)
    foreach ($assocCodes as $assocCode) {
        $assocIdx = $BY_CODE[$assocCode] ?? null;
        if ($assocIdx !== null) {
            $associated[] = shortEntity($ENTITIES[$assocIdx]);
        } else {
            $associated[] = [
                'code' => $assocCode,
                'title' => null,
                'classKind' => null,
                'isTerminal' => null,
                'hasDagger' => null,
                'hasAsterisk' => null,
                'icd9cmCode' => null,
            ];
        }
    }

    // Posizionamento daga/asterisco SDO
    $sdoPlacement = null;
    
    if (($entity['hasAsterisk'] ?? false)) {
        // asterisco campo 1
        $sdoPlacement = 'campo1_asterisco';
    } 
    elseif (($entity['hasDagger'] ?? 'none') === 'explicit') {
        // dagger esplicito campo 2
        $sdoPlacement = 'campo2_dagger';
    } 
    elseif (($entity['hasDagger'] ?? 'none') === 'possible') {
        // dagger possibile campo 2 se usato
        $sdoPlacement = 'campo2_dagger_opzionale';
    }
    // else: $sdoPlacement rimane null (codice singolo indipendente)
    
    $sdoRequiresPlacement = $sdoPlacement !== null; // se codice necessita pos

    // tipo di associazione
    $associationType = 'none';
    $requiresPair = false;
    $isComposite = false;

    if (($entity['hasAsterisk'] ?? false)) {
        $associationType = 'dagger-asterisk';
        $requiresPair = true;
        $isComposite = true;
    } elseif (($entity['hasDagger'] ?? 'none') === 'explicit') {
        $associationType = 'dagger-asterisk';
        $requiresPair = count($associated) > 0;
        $isComposite = count($associated) > 0;
    } elseif (($entity['hasDagger'] ?? 'none') === 'possible') {
        $associationType = 'possible-dagger';
        $requiresPair = false;
        $isComposite = count($associated) > 0;
    }

    $compositionType = match (true) {
        ($entity['hasAsterisk'] ?? false)              => 'asterisco',
        ($entity['hasDagger'] ?? 'none') === 'explicit' => 'daga',
        ($entity['hasDagger'] ?? 'none') === 'possible' => 'daga possibile',
        default                             => null,
    };

    ok([ // dati con informazioni e posizione SDO
        'releaseId' => $m[1],
        'selectedCode' => shortEntity($entity),
        'associatedEntities' => $associated,
        'isComposite' => $isComposite,
        'requiresPair' => $requiresPair,
        'associationType' => $associationType,
        'selectionMode' => $requiresPair ? 'paired' : 'single',
        'compositionType' => $compositionType,
        
        // CAMPI SDO
        'sdoPlacement' => $sdoPlacement,
        'sdoRequiresPlacement' => $sdoRequiresPlacement,
    ]);
}

// handleCrosswalkIcd9
// Ricerca codici ICD-10-IM associati a un codice ICD-9
function handleCrosswalkIcd9(array $m): void
{
    global $ENTITIES, $BY_ICD9;
    assertRelease($m[1]); // verifica release corrispondente
    $icd9 = mb_strtoupper(urldecode($m[2])); // decodifica cod ICD-9
    $idxs = $BY_ICD9[$icd9] ?? []; // cerca indici corrispondenti

    $result = [];
    foreach ($idxs as $i) {
        $e = $ENTITIES[$i]; // entità corrispondente
        $result[] = [
            'code'       => $e['code'], // cod ICD10
            'title'      => $e['title'],
            'classKind'  => $e['classKind'], // tipo
            'isTerminal' => $e['isTerminal'],
            'hasDagger'  => ($e['hasDagger'] ?? 'none'),
        ];
    }

    ok(['icd9code' => $icd9, 'releaseId' => $m[1], 'total' => count($result), 'icd10imCodes' => $result]);
}

// handleCrosswalkIcd10
// Ricerca codice ICD-9 corrispondente a un codice ICD-10-IM
function handleCrosswalkIcd10(array $m): void
{
    global $ENTITIES, $BY_CODE;
    assertRelease($m[1]);
    $code = mb_strtoupper(urldecode($m[2])); // decodifica codice ICD-10-IM
    $idx  = $BY_CODE[$code] ?? null; // cerca indici corrispondenti

    if ($idx === null) err(404, 'NOT_FOUND', "Codice '$code' non trovato");

    $e = $ENTITIES[$idx]; // entità corrispondente
    ok(['icd10imCode' => $e['code'], 'title' => $e['title'], 'icd9cmCode' => $e['icd9cmCode']]);
}

// Helpers
// Node plus every descendant; unknown roots yield an empty result set.
function searchSubtree(string $code): array
{
    global $ENTITIES, $BY_CODE, $BY_PARENT;
    if (!isset($BY_CODE[$code])) {
        // Workbook chapter ranges are aliases, not extra clinical entities.
        foreach ($ENTITIES as $entity) {
            if ($entity['classKind'] === 'chapter' && ($entity['chapterRange'] ?? null) === $code) {
                $code = $entity['code'];
                break;
            }
        }
    }
    if (!isset($BY_CODE[$code])) return [];
    $pending = [$code];
    $seen = [];
    while ($pending) {
        $current = array_pop($pending);
        if (isset($seen[$current])) continue;
        $seen[$current] = true;
        foreach ($BY_PARENT[$current] ?? [] as $i) {
            $pending[] = $ENTITIES[$i]['code'];
        }
    }
    return $seen;
}

// Estrae i campi rilevanti di un'entità.
function shortEntity(array $e): array
{
    return [
        'code'            => $e['code'],
        'title'           => $e['title'],
        'classKind'       => $e['classKind'],
        'isTerminal'      => $e['isTerminal'],
        'hasDagger'       => ($e['hasDagger'] ?? 'none'), // se ha il dagger
        'hasAsterisk'     => ($e['hasAsterisk'] ?? false), // se ha l'asterisco
        'parent'          => $e['parent'],
        'icd9cmCode'      => $e['icd9cmCode'],
        'associatedCodes' => $e['associatedCodes'] ?? [],
    ];
}

// assertRelease
// Verifica ID della release corrisponde a quello della release corrente
function assertRelease(string $id): void
{
    global $RELEASE;
    if ($id !== $RELEASE['id']) err(404, 'RELEASE_NOT_FOUND', "Release '$id' non trovata");
}
// ok
/* Risposta di successo formato JSON
 * JSON_UNESCAPED_UNICODE: evita l'escaping di caratteri Unicode (come le lettere accentate).
 * JSON_UNESCAPED_SLASHES`: evita l'escaping dei caratteri '/' nel JSON.
 * JSON_PRETTY_PRINT: rende il JSON più leggibile con spazi e ritorni a capo.
 */
function ok(array $data): never
{
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    exit; // termina
}

// err
// Gestione errori
function err(int $status, string $code, string $msg): never
{
    http_response_code($status);
    echo json_encode(
        ['error' => [
            'code' => $code,
            'message' => "Errore nel processamento della richiesta: $msg",
            'httpStatus' => $status
        ]],
        JSON_UNESCAPED_UNICODE
    );
    exit;
}
