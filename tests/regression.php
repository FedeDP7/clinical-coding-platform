<?php
declare(strict_types=1);

// Self-contained synthetic fixtures: no classification workbook or dependency needed.
// Run from any directory: php tests/regression.php
$root = dirname(__DIR__);
require_once $root . '/icd10-im/api/hierarchy.php';
$checks = 0;
function check(bool $condition, string $message): void
{
    global $checks;
    $checks++;
    if (!$condition) throw new RuntimeException($message);
}
function entity(string $code, ?string $parent, string $kind, bool $terminal = false): array
{
    return [
        'id' => 'fixture:' . $code, 'code' => $code, 'title' => 'Fixture ' . $code,
        'classKind' => $kind, 'typeRaw' => $kind, 'parent' => $parent,
        'isTerminal' => $terminal, 'hasDagger' => 'none', 'hasAsterisk' => false,
        'associatedCodes' => [], 'icd9cmCode' => null, 'validFrom' => '2026-01-01',
        'validTo' => '2026-12-31', 'inclusions' => null, 'exclusions' => null,
    ];
}
function dataset(array $entities, string $release): array
{
    $data = ['release' => ['id' => $release, 'totalEntities' => count($entities),
        'totalCodable' => count(array_filter($entities, fn($e) => $e['isTerminal']))],
        'entities' => $entities, 'byCode' => [], 'byParent' => [], 'byIcd9' => [], 'chapters' => []];
    foreach ($entities as $i => $e) {
        $data['byCode'][$e['code']] = $i;
        if ($e['parent']) $data['byParent'][$e['parent']][] = $i;
        if ($e['classKind'] === 'chapter') $data['chapters'][] = $i;
    }
    return $data;
}
function callApi(string $file, string $query): array
{
    $runner = <<<'PHP'
$_SERVER['REQUEST_METHOD']='GET'; $_SERVER['REQUEST_URI']='/api/index.php';
parse_str($argv[1], $_GET);
register_shutdown_function(function(){fwrite(STDERR, (string)(http_response_code() ?: 200));});
include $argv[2];
PHP;
    $process = proc_open([PHP_BINARY, '-d', 'display_errors=1', '-d', 'error_reporting=32767',
        '-r', $runner, $query, $file], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
    if (!is_resource($process)) throw new RuntimeException('Cannot start PHP');
    $body = stream_get_contents($pipes[1]); $status = stream_get_contents($pipes[2]);
    fclose($pipes[1]); fclose($pipes[2]); $exit = proc_close($process);
    check($exit === 0, 'API process failed: ' . $status);
    $data = json_decode($body, true);
    check(is_array($data), 'API returned invalid JSON: ' . substr($body, 0, 200));
    check(ctype_digit($status), 'API emitted warnings: ' . $status);
    return [(int)$status, $data];
}
function removeFixture(string $path): void
{
    foreach (new FilesystemIterator($path) as $p) {
        if ($p->isDir()) removeFixture($p->getPathname());
        else unlink($p->getPathname());
    }
    rmdir($path);
}

$original = dataset([
    entity('I', 'A00-B99', 'chapter'), entity('A00-A09', 'I', 'block'),
    entity('A00', 'A00-A09', 'category'), entity('A00.0', 'A00', 'category', true),
    entity('XIII', 'M00-M99', 'chapter'), entity('M00-M25', 'XIII', 'block'),
    entity('M05', 'M05-M14', 'category'), entity('M05.0', 'M05', 'category', true),
    entity('XIX', 'S00-T98', 'chapter'), entity('T20-T32', 'XIX', 'block'),
    entity('T21', 'T20-T25', 'category'), entity('T21.0', 'T21', 'category', true),
], '20260216');
$normalized = normalizeIcd10imHierarchy($original);
check(count($normalized['entities']) === count($original['entities']) + 2, 'Expected two technical ranges');
check(normalizeIcd10imHierarchy($normalized) === $normalized, 'Normalization must be idempotent');
foreach ($original['entities'] as $i => $e) {
    $expected = $e;
    if ($e['classKind'] === 'chapter') { $expected['chapterRange'] = $e['parent']; $expected['parent'] = null; }
    check($normalized['entities'][$i] === $expected, 'Clinical/source fields changed: ' . $e['code']);
}
foreach (['M05-M14' => 'M00-M25', 'T20-T25' => 'T20-T32'] as $code => $parent) {
    $e = $normalized['entities'][$normalized['byCode'][$code]];
    check($e['parent'] === $parent && $e['synthetic'] && !$e['isTerminal'], 'Invalid technical range');
    check($e['title'] === $code, 'Do not invent clinical descriptions');
}
foreach ($normalized['entities'] as $e) {
    check(!$e['parent'] || isset($normalized['byCode'][$e['parent']]), 'Unresolved parent');
}
$unknown = dataset([entity('Z99', 'unknown', 'category')], '20260216');
check(normalizeIcd10imHierarchy($unknown)['entities'] === $unknown['entities'], 'Unknown parents must not be guessed');

$cipi = dataset([entity('00', null, 'chapter'), entity('00.0', '00', 'block'),
    entity('00.00', '00.0', 'category'), entity('00.00.0A', '00.00', 'category', true)], '20251215');
$temp = sys_get_temp_dir() . '/clinical-coding-tests-' . bin2hex(random_bytes(6));
mkdir($temp);
try {
    foreach (['icd10-im', 'cipi'] as $component) {
        mkdir($temp . '/' . $component . '/data', 0700, true);
        copy($root . '/' . $component . '/api/index.php', $temp . '/' . $component . '/index.php');
        if ($component === 'icd10-im') copy($root . '/icd10-im/api/hierarchy.php', $temp . '/' . $component . '/hierarchy.php');
        file_put_contents($temp . '/' . $component . '/data/cipi.json', json_encode($cipi));
        file_put_contents($temp . '/' . $component . '/data/icd10im.json', json_encode($original));
        $api = $temp . '/' . $component . '/index.php';
        $sources = $component === 'icd10-im' ? [['', '20260216', 'I', 'A00.0'], ['cipi/', '20251215', '00', '00.00.0A']] : [['', '20251215', '00', '00.00.0A']];
        foreach ($sources as [$prefix, $release, $chapter, $leaf]) {
            $search = 'route=/' . $prefix . 'release/' . $release . '/search';
            foreach (['q', 'chapter', 'classKind', 'terminalOnly', 'page', 'pageSize', 'route'] as $parameter) {
                [$status, $body] = callApi($api, $search . '&q=Fixture&' . $parameter . '[]=test');
                check($status === 400 && $body['error']['code'] === 'INVALID_PARAM', 'Array parameter must return 400: ' . $parameter);
            }
            [$status, $all] = callApi($api, $search . '&q=Fixture');
            check($status === 200 && $all['total'] > 0, 'Unfiltered search failed');
            [$status, $body] = callApi($api, $search . '&q=' . $leaf . '&chapter=' . $chapter);
            check($status === 200 && $body['total'] === 1 && $body['results'][0]['code'] === $leaf, 'Nested descendant missing');
            [$status, $body] = callApi($api, $search . '&q=Fixture&chapter=missing');
            check($status === 200 && $body['total'] === 0, 'Unknown chapter should have no results');
            [$status, $body] = callApi($api, $search . '&q=Fixture&terminalOnly=true&pageSize=1');
            check($status === 200 && count($body['results']) === 1 && $body['results'][0]['isTerminal'], 'Terminal filter/pagination changed');
            [$status, $body] = callApi($api, $search . '&q=Fixture&page=9999999999999999999999999');
            check($status === 400, 'Unrepresentable page must fail cleanly');
            [$status, $body] = callApi($api, $search . '&q=Fixture&page=' . PHP_INT_MAX);
            check($status === 200 && $body['results'] === [], 'Large page overflows');
            [$status] = callApi($api, $search . '&q=x'); check($status === 400, 'Short query must fail');
            [$status] = callApi($api, 'route=/' . $prefix . 'release/wrong/chapter'); check($status === 404, 'Release validation changed');
        }
        if ($component === 'icd10-im') {
            [$status, $body] = callApi($api, 'route=/release/20260216/search&q=A00.0&chapter=A00-B99');
            check($status === 200 && $body['total'] === 1, 'Chapter range alias failed');
            foreach (['M05' => ['XIII', 'M00-M25', 'M05-M14'], 'T21' => ['XIX', 'T20-T32', 'T20-T25']] as $code => $ancestors) {
                [$status, $body] = callApi($api, 'route=/release/20260216/entity/' . $code . '/ancestors');
                check($status === 200 && array_column($body['ancestors'], 'code') === $ancestors, 'Broken ancestor chain');
            }
        }
    }
    echo "PASS: $checks regression assertions\n";
} finally { removeFixture($temp); }
