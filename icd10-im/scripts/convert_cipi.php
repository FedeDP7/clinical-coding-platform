<?php

/**
 * scripts/convert_cipi.php — Converte CIPI .xlsx --> cipi.json
 *
 * convert_cipi.php [percorso.xlsx] [output.json]
 * Default: legge api/data/CIPI.xlsx, scrive api/data/cipi.json
 *
 * Mappatura colonne (riga 7 header, dati da riga 8):
 *   A=id, B=sezione, C=tipo, D=descrizione, E=codice CIPI,
 *   F=ICD-9-CM, G=AHRQ, H=inclusioni, I=esclusioni, J=note, K=validità.
 *
 * Tipi gerarchici (column C):
 *   "2 Cifre, Rubrica"  --> chapter   (es. "00")
 *   "3 Cifre, Rubrica"  --> block     (es. "00.0")
 *   "4 Cifre, Rubrica"  --> sub-block (es. "00.00")
 *   "Codificante"       --> terminal  (es. "00.00.0A")
 */

$xlsxFile   = $argv[1] ?? __DIR__ . '/../api/data/CIPI.xlsx';
$outputFile = $argv[2] ?? __DIR__ . '/../api/data/cipi.json';

if (!file_exists($xlsxFile)) {
    die("Errore: file non trovato: $xlsxFile\n");
}

$zip = new ZipArchive();
if ($zip->open($xlsxFile) !== true) {
    die("Errore: impossibile aprire il file .xlsx\n");
}

// SharedStrings
$sharedStrings = [];
$ssXml = $zip->getFromName('xl/sharedStrings.xml');
if ($ssXml) {
    $ss = simplexml_load_string($ssXml);
    foreach ($ss->si as $si) {
        if (isset($si->t)) {
            $sharedStrings[] = (string)$si->t;
        } else {
            $text = '';
            foreach ($si->r as $r) {
                $text .= (string)$r->t;
            }
            $sharedStrings[] = $text;
        }
    }
}
echo "Stringhe condivise caricate: " . count($sharedStrings) . "\n";

// Worksheet
$sheetXml = $zip->getFromName('xl/worksheets/sheet1.xml');
if (!$sheetXml) {
    die("Errore: foglio dati non trovato\n");
}
$zip->close();

$sheet = simplexml_load_string($sheetXml);

// Helpers
function colToIndex(string $col): int
{
    $col = strtoupper(trim($col));
    if (empty($col)) return 0;
    $index = 0;
    for ($i = 0, $len = strlen($col); $i < $len; $i++) {
        $char = ord($col[$i]) - ord('A') + 1;
        if ($char < 1 || $char > 26) {
            throw new Exception("Colonna invalida: '$col'");
        }
        $index = $index * 26 + $char;
    }
    return $index - 1;
}

function cellCol(string $ref): string
{
    preg_match('/^([A-Z]+)/', strtoupper($ref), $m);
    return $m[1] ?? 'A';
}

// "15/12/2025-31/12/2026" --> ["2025-12-15", "2026-12-31"]
function parseValidity(string $v): array
{
    if (preg_match('#(\d{2})/(\d{2})/(\d{4})\s*-\s*(\d{2})/(\d{2})/(\d{4})#', $v, $m)) {
        return ["$m[3]-$m[2]-$m[1]", "$m[6]-$m[5]-$m[4]"];
    }
    return [null, null];
}

// classKind da tipo CIPI
function classKind(string $type): string
{
    $t = mb_strtolower($type);
    if (str_contains($t, '2 cifre')) return 'chapter';
    if (str_contains($t, '3 cifre')) return 'block';
    if (str_contains($t, '4 cifre')) return 'sottocategoria cat 4';
    if (str_contains($t, 'codificante')) return 'codificante';
    return 'altro';
}

// Derivazione parent dal codice + tipo (CIPI non ha colonna parent esplicita).
// Caller garantisce $code non vuoto e formato valido per il tipo.
function deriveParent(string $type, string $code): ?string
{
    $t = mb_strtolower($type);

    // 2 Cifre = top-level (es. "00"): nessun parent
    if (str_contains($t, '2 cifre')) return null;

    // 3 Cifre (es. "00.0"): parent = primi 2 char ("00")
    if (str_contains($t, '3 cifre')) return substr($code, 0, 2);

    // 4 Cifre (es. "00.00", "00.R0"): parent = strip ultimo carattere ("00.0", "00.R")
    if (str_contains($t, '4 cifre')) return substr($code, 0, -1);

    // Codificante (es. "00.00.0A"): parent = prefisso fino all'ultimo dot ("00.00")
    if (str_contains($t, 'codificante')) {
        $lastDot = strrpos($code, '.');
        return $lastDot !== false ? substr($code, 0, $lastDot) : null;
    }

    return null;
}

// Colonne CIPI (indici: A=0, B=1, ...)
$COL = [
    'id'       => 0,   // A – identificativo CIPI (es. CIPI251215C000000001)
    'section'  => 1,   // B – Sezione
    'type'     => 2,   // C – Tipo (2/3/4 Cifre Rubrica, Codificante)
    'title'    => 3,   // D – Descrizione
    'code'     => 4,   // E – CODICE CIPI 2025
    'icd9'     => 5,   // F – Trans-codifica ICD-9-CM
    'ahrq'     => 6,   // G – Equivalenza AHRQ
    'incl'     => 7,   // H – INCLUSIONI
    'excl'     => 8,   // I – ESCLUSIONI
    'notes'    => 9,   // J – Note
    'validity' => 10,  // K – Periodo di validità
];

$entities    = [];
$rowCount    = 0;
$skipped     = 0;
$DATA_START  = 8;  // riga 7 = header, dati da riga 8

foreach ($sheet->sheetData->row as $row) {
    $rowNum = (int)$row['r'];
    if ($rowNum < $DATA_START) continue;

    $cells = [];
    foreach ($row->c as $cell) {
        $ref  = (string)$cell['r'];
        $idx  = colToIndex(cellCol($ref));
        $type = (string)$cell['t'];

        if ($type === 's') {
            $cells[$idx] = $sharedStrings[(int)(string)$cell->v] ?? '';
        } elseif ($type === 'inlineStr') {
            $cells[$idx] = (string)$cell->is->t;
        } else {
            $cells[$idx] = isset($cell->v) ? (string)$cell->v : '';
        }
    }

    $get = fn(string $key) => trim($cells[$COL[$key]] ?? '');

    $id   = $get('id');
    $code = $get('code');
    $type = $get('type');

    if (empty($id) || empty($code)) {
        $skipped++;
        continue;
    }

    [$validFrom, $validTo] = parseValidity($get('validity'));

    // ICD-9-CM (può essere "nd"/"ND" = non disponibile)
    $icd9 = $get('icd9');
    $icd9 = ($icd9 === '' || strcasecmp($icd9, 'ND') === 0 || strcasecmp($icd9, 'nd') === 0)
            ? null : $icd9;

    // AHRQ può essere numerico o "ND"
    $ahrq = $get('ahrq');
    $ahrq = ($ahrq === '' || strcasecmp($ahrq, 'ND') === 0 || strcasecmp($ahrq, 'nd') === 0)
            ? null : $ahrq;

    $isTerminal = str_contains(mb_strtolower($type), 'codificante');

    $entities[] = [
        'id'           => $id,
        'code'         => $code,
        'title'        => $get('title'),
        'classKind'    => classKind($type),
        'typeRaw'      => $type,
        'section'      => $get('section') ?: null,
        'parent'       => deriveParent($type, $code),
        'isTerminal'   => $isTerminal,
        'inclusions'   => $get('incl')  ?: null,
        'exclusions'   => $get('excl')  ?: null,
        'generalNotes' => $get('notes') ?: null,
        'ahrqClass'    => $ahrq,
        'icd9cmCode'   => $icd9,
        'validFrom'    => $validFrom,
        'validTo'      => $validTo,
    ];

    $rowCount++;
    if ($rowCount % 2000 === 0) echo "  Lette $rowCount entità...\n";
}

echo "Entità lette: $rowCount (saltate: $skipped)\n";

// Sintesi parent mancanti — il dataset CIPI ha gap nella gerarchia (es. chapter
// "85" assente; alcuni nodi 4 Cifre mancanti). Senza sintesi il tree /chapter
// non navigherebbe quelle sezioni e i codificanti sarebbero orfani.
$existing = [];
foreach ($entities as $e) $existing[$e['code']] = true;

function syntheticKind(string $code): array
{
    if (strlen($code) === 2) return ['chapter', '2 Cifre, Rubrica (sintetico)'];
    if (strlen($code) === 4 && $code[2] === '.') return ['block', '3 Cifre, Rubrica (sintetico)'];
    if (strlen($code) === 5 && $code[2] === '.') return ['sottocategoria cat 4', '4 Cifre, Rubrica (sintetico)'];
    return ['altro', 'sintetico'];
}

function syntheticParentOf(string $code): ?string
{
    $len = strlen($code);
    if ($len <= 2) return null;
    if ($len === 4) return substr($code, 0, 2);
    if ($len === 5) return substr($code, 0, -1);
    return null;
}

$queue = [];
$queued = [];
foreach ($entities as $e) {
    if ($e['parent'] && !isset($existing[$e['parent']]) && !isset($queued[$e['parent']])) {
        $queue[]   = $e['parent'];
        $queued[$e['parent']] = true;
    }
}

$synthCount = 0;
while (!empty($queue)) {
    $code = array_shift($queue);
    if (isset($existing[$code])) continue;

    [$kind, $typeLabel] = syntheticKind($code);
    $parent = syntheticParentOf($code);

    $entities[] = [
        'id'           => 'SYNTH:' . $code,
        'code'         => $code,
        'title'        => '(struttura sintetica — entità non presente nel sorgente CIPI)',
        'classKind'    => $kind,
        'typeRaw'      => $typeLabel,
        'section'      => null,
        'parent'       => $parent,
        'isTerminal'   => false,
        'inclusions'   => null,
        'exclusions'   => null,
        'generalNotes' => null,
        'ahrqClass'    => null,
        'icd9cmCode'   => null,
        'validFrom'    => null,
        'validTo'      => null,
    ];
    $existing[$code] = true;
    $synthCount++;

    if ($parent && !isset($existing[$parent]) && !isset($queued[$parent])) {
        $queue[]   = $parent;
        $queued[$parent] = true;
    }
}
if ($synthCount > 0) {
    echo "Sintetizzate $synthCount entità mancanti nella gerarchia.\n";
}

// Indici
echo "Costruzione indici...\n";

$byCode    = [];
$byParent  = [];
$byIcd9    = [];
$chapters  = [];

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

// Verifica integrità parent (entità che dichiarano parent inesistente)
$orphanCount = 0;
foreach ($entities as $e) {
    if ($e['parent'] && !isset($byCode[$e['parent']])) {
        $orphanCount++;
    }
}
if ($orphanCount > 0) {
    echo "AVVISO: $orphanCount entità con parent non risolvibile (gerarchia incompleta).\n";
}

// Output
echo "Scrittura JSON...\n";

$output = [
    'release' => [
        'id'            => '20251215',
        'description'   => 'CIPI versione 2.0 (Dicembre 2025)',
        'validFrom'     => '2025-12-15',
        'validTo'       => '2026-12-31',
        'source'        => 'Ministero della Salute',
        'license'       => 'CC BY-NC-ND 4.0',
        'totalEntities'     => count($entities),
        'totalCodable'      => count(array_filter($entities, fn($e) => $e['isTerminal'])),
        'sourceRows'        => $rowCount,
        'syntheticEntities' => count($entities) - $rowCount,
    ],
    'entities' => $entities,
    'byCode'   => $byCode,
    'byParent' => $byParent,
    'byIcd9'   => $byIcd9,
    'chapters' => $chapters,
];

if (!is_dir(dirname($outputFile))) {
    mkdir(dirname($outputFile), 0755, true);
}

file_put_contents(
    $outputFile,
    json_encode($output, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
);

$size = round(filesize($outputFile) / 1024 / 1024, 1);
$total = count($entities);
echo "Fatto! --> $outputFile ({$size} MB)\n";
echo "Entità totali (incl. sintetiche): $total (sorgente: $rowCount)\n";
echo "Codici terminali: " . $output['release']['totalCodable'] . "\n";
echo "Capitoli:         " . count($chapters) . "\n";
