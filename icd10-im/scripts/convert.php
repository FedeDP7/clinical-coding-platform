<?php

/**
 * scripts/convert.php — Converte ICD-10-IM .xlsx --> icd10im.json
 *
 * convert.php [percorso.xlsx] [output.json]
 * Default: legge da api/data/icd10im.xlsx, scrive api/data/icd10im.json
 */

$xlsxFile   = $argv[1] ?? __DIR__ . '/../api/data/icd10im.xlsx';

$outputFile = $argv[2] ?? __DIR__ . '/../api/data/icd10im.json';

// file non esiste
if (!file_exists($xlsxFile)) {
    die("Errore: file non trovato: $xlsxFile\n");
}

//Apre lo ZIP   (.xlsx è uno ZIP con XML dentro)
$zip = new ZipArchive();
if ($zip->open($xlsxFile) !== true) {
    die("Errore: impossibile aprire il file .xlsx (non è un archivio ZIP valido)\n");
}

//Legge la tabella delle stringhe condivise
// In .xlsx quasi tutte le stringhe sono in sharedStrings.xml per risparmio spazio
$sharedStrings = [];
$ssXml = $zip->getFromName('xl/sharedStrings.xml');
if ($ssXml) {
    $ss = simplexml_load_string($ssXml);
    foreach ($ss->si as $si) {
        // Ogni <si> può avere <t> (testo semplice) o <r><t> (testo con formattazione)
        if (isset($si->t)) {
            $sharedStrings[] = (string)$si->t;
        } else {
            // Concatena tutti i run <r><t>
            $text = '';
            foreach ($si->r as $r) {
                $text .= (string)$r->t;
            }
            $sharedStrings[] = $text;
        }
    }
}
echo "Stringhe condivise caricate: " . count($sharedStrings) . "\n";    // (59231)

//Legge il foglio dati
$sheetXml = $zip->getFromName('xl/worksheets/sheet1.xml'); // Prova sheet1
if (!$sheetXml) {
    // Prova sheet con nome diverso fallback su sheet2
    $sheetXml = $zip->getFromName('xl/worksheets/sheet2.xml');
}
if (!$sheetXml) {
    die("Errore: foglio dati non trovato nell'archivio\n");
}

$zip->close();

// accesso a righe e celle
$sheet = simplexml_load_string($sheetXml);

//Funzioni di supporto

// Converte riferimento colonna Excel (A=0, B=1, ..., AA=26, ...) — sistema base-26
function colToIndex(string $col): int
{
    $col = strtoupper(trim($col));
    if (empty($col)) return 0;
    
    $index = 0;
    $len = strlen($col);
    
    // Vero sistema base-26 Excel-style
    for ($i = 0; $i < $len; $i++) {
        $char = ord($col[$i]) - ord('A') + 1;  // A=1, B=2, ..., Z=26
        if ($char < 1 || $char > 26) {
            throw new Exception("Colonna invalida: '$col'");
        }
        $index = $index * 26 + $char;
    }
    return $index - 1;  // Converte a 0-based
}

// Estrae la parte letterale (colonna) da un riferimento cella tipo "A4", "AB12"
function cellCol(string $ref): string // function cellCol(B4) -> B
{
    preg_match('/^([A-Z]+)/', strtoupper($ref), $m);
    return $m[1] ?? 'A';
}

// Mappa dagger int -> stringa
function daggerLabel(int $v): string
{
    return match ($v) {
        1 => 'explicit', // dagger
        2 => 'possible', // dagger opzionale
        default => 'none'
    };
}

// Normalizza periodo validità "16/02/2026 - 31/12/2026" --> ["2026-02-16", "2026-12-31"]
function parseValidity(string $v): array
{
    if (preg_match('#(\d{2})/(\d{2})/(\d{4})\s*-\s*(\d{2})/(\d{2})/(\d{4})#', $v, $m)) {
        return ["$m[3]-$m[2]-$m[1]", "$m[6]-$m[5]-$m[4]"];
    }
    return [null, null];
}

// Mappa tipo Excel --> classKind API
function classKind(string $type, string $code): string
{
    if ($type === 'chapter') {
        return 'chapter';
    }
    if ($type === 'block') {
        return 'block';
    }

    // se il codice contiene un punto, è sottocategoria
    // es: J11 --> categoria
    // es: J11.0 --> sottocategoria
    if (strpos($code, '.') !== false) {
        return 'sottocategoria cat 4';
    }

    return 'categoria cat 3';
}

// Scansiona le righe
// Colonne rilevanti (indici: A=0, B=1, ...)
$COL = [
    'id'       => 0,   // A – identificativo interno
    'code'     => 1,   // B – codice ICD-10-IM
    'title'    => 2,   // C – titolo
    'type'     => 3,   // D – tipo (chapter/block/cat 3/cat 4)
    'parent'   => 4,   // E – codice padre
    'detail'   => 5,   // F – dettagli IM
    'terminal' => 6,   // G – codice terminale (0/1)
    'dagger'   => 7,   // H – daga (0/1/2)
    'asterisk' => 8,   // I – asterisco (0/1)
    'defn'     => 9,   // J – definizioni
    'incl'     => 10,  // K – inclusioni
    'excl'     => 11,  // L – esclusioni
    'assoc'    => 12,  // M – codici associati
    'notes'    => 13,  // N – note generali
    'suggest'  => 14,  // O – suggerimenti
    'modif'    => 15,  // P – modificatori
    'icd9'     => 16,  // Q – transcodifica ICD-9-CM
    'validity' => 17,  // R – periodo di validità
];

$entities    = [];
$rowCount    = 0;
$skipped     = 0;
$DATA_START  = 4;      // le prime 3 righe sono intestazione/note

foreach ($sheet->sheetData->row as $row) { // loop sulle righe
    $rowNum = (int)$row['r'];
    if ($rowNum < $DATA_START) continue;

    // Costruisci array indicizzato per colonna dalla riga corrente
    $cells = [];
    foreach ($row->c as $cell) {
        $ref   = (string)$cell['r'];          // es. "B4"
        $idx   = colToIndex(cellCol($ref));   // indice numerico colonna
        $type  = (string)$cell['t'];          // 's'=sharedString, ''=numero, 'str'=formula string

        if ($type === 's') {
            // Indice nella tabella stringhe condivise
            $cells[$idx] = $sharedStrings[(int)(string)$cell->v] ?? '';
        } elseif ($type === 'inlineStr') {
            $cells[$idx] = (string)$cell->is->t;
        } else {
            $cells[$idx] = isset($cell->v) ? (string)$cell->v : '';
        }
    }

    // Leggi i campi rilevanti con fallback a stringa vuota
    $get = fn(string $key) => trim($cells[$COL[$key]] ?? '');

    $id   = $get('id');
    $code = $get('code');
    if (empty($id) || empty($code)) { // salta le righe non valide
        $skipped++;
        continue;
    }

    // Codici associati --> array (separati da ";")
    $assocRaw = $get('assoc');                                     // diventa array
    $assoc = $assocRaw ? array_values(array_filter(array_map('trim', explode(';', $assocRaw)))) : [];

    // Validità
    [$validFrom, $validTo] = parseValidity($get('validity'));

    // ICD-9-CM (può essere "ND" = non disponibile)
    $icd9 = $get('icd9');
    $icd9 = ($icd9 === 'ND' || $icd9 === '') ? null : $icd9;

    // crea entità
    $entities[] = [
        'id'             => $id,
        'code'           => $code,
        'title'          => $get('title'),
        'classKind'      => classKind($get('type'), $code),
        'typeRaw'        => $get('type'),
        'parent'         => $get('parent') ?: null,
        'detailIM'       => $get('detail')  ?: null,
        'isTerminal'     => (int)$get('terminal') === 1,
        'hasDagger'      => daggerLabel((int)$get('dagger')),
        'hasAsterisk'    => (int)$get('asterisk') === 1,
        'definition'     => $get('defn')    ?: null,
        'inclusions'     => $get('incl')    ?: null,
        'exclusions'     => $get('excl')    ?: null,
        'associatedCodes' => $assoc,
        'generalNotes'   => $get('notes')   ?: null,
        'suggestions'    => $get('suggest') ?: null,
        'modifiers'      => $get('modif')   ?: null,
        'icd9cmCode'     => $icd9,
        'validFrom'      => $validFrom,
        'validTo'        => $validTo,
    ];

    $rowCount++;
    if ($rowCount % 2000 === 0) echo "  Lette $rowCount entità...\n"; // es. 2000, 4000, 6000, 8000
}

echo "Entità lette: $rowCount (saltate: $skipped)\n"; // 14773 (saltate: 0)

// Costruzione indici
echo "Costruzione indici...\n";

$byCode    = [];   // code --> indice in $entities
$byParent  = [];   // parentCode --> [indici figli]
$byIcd9    = [];   // icd9code --> [indici]
$chapters  = [];   // indici dei soli capitoli lista

foreach ($entities as $i => $e) {
    $byCode[$e['code']] = $i;

    if ($e['parent']) {
        $byParent[$e['parent']][] = $i;
    }

    if ($e['icd9cmCode']) {
        $byIcd9[$e['icd9cmCode']][] = $i;
    }

    if ($e['classKind'] === 'chapter') {
        $chapters[] = $i;
    }
}

// Scrivi JSON
echo "Scrittura JSON...\n";

$output = [
    'release' => [
        'id'          => '20260216',
        'description' => 'ICD-10-IM versione Gamma 2.1 (Dicembre 2025)',
        'validFrom'   => '2026-02-16',
        'validTo'     => '2026-12-31',
        'source'      => 'Ministero della Salute / Regione Autonoma Friuli Venezia Giulia',
        'license'     => 'CC BY-NC-ND 4.0',
        'totalEntities' => $rowCount,
        'totalCodable'  => count(array_filter($entities, fn($e) => $e['isTerminal'])),
    ],
    'entities'  => $entities,
    'byCode'    => $byCode,
    'byParent'  => $byParent,
    'byIcd9'    => $byIcd9,
    'chapters'  => $chapters,
];

require_once __DIR__ . '/../api/hierarchy.php';
$output = normalizeIcd10imHierarchy($output);

if (!is_dir(dirname($outputFile))) {
    mkdir(dirname($outputFile), 0755, true);
}

file_put_contents(
    $outputFile,
    json_encode($output, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) // scrive json
);

$size = round(filesize($outputFile) / 1024 / 1024, 1);
echo "Fatto! --> $outputFile ({$size} MB)\n"; 
echo "Entità totali:    " . $output['release']['totalEntities'] . "\n";
echo "Codici terminali: " . $output['release']['totalCodable'] . "\n"; 
