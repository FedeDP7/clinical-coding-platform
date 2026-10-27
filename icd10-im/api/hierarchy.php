<?php
declare(strict_types=1);

/** Normalize workbook hierarchy metadata without changing clinical records.
 * Missing range nodes are technical containers, never codable entities.
 * Used on import and on read so existing generated datasets remain supported.
 */
function normalizeIcd10imHierarchy(array $data): array
{
    $entities = $data['entities'];
    $byCode = [];
    foreach ($entities as $i => $entity) {
        $byCode[$entity['code']] = $i;
    }

    foreach ($entities as &$entity) {
        if ($entity['classKind'] === 'chapter' && !empty($entity['parent'])
            && !isset($byCode[$entity['parent']])) {
            $entity['chapterRange'] = $entity['parent'];
            $entity['parent'] = null;
        }
    }
    unset($entity);

    $missing = [];
    foreach ($entities as $entity) {
        if (!empty($entity['parent']) && !isset($byCode[$entity['parent']])) {
            $missing[$entity['parent']] = true;
        }
    }
    foreach (array_keys($missing) as $code) {
        $range = icd10imRangeBounds($code);
        if ($range === null) continue;
        $parent = null;
        $smallest = PHP_INT_MAX;
        // Use only explicit source blocks that strictly contain this range.
        foreach ($entities as $candidate) {
            if ($candidate['classKind'] !== 'block') continue;
            $bounds = icd10imRangeBounds($candidate['code']);
            if ($bounds === null || $bounds[0] > $range[0] || $bounds[1] < $range[1]) continue;
            $width = $bounds[1] - $bounds[0];
            if ($width < $smallest && $candidate['code'] !== $code) {
                $parent = $candidate['code'];
                $smallest = $width;
            }
        }
        // Do not guess when no explicit containing block is available.
        if ($parent === null) continue;
        $byCode[$code] = count($entities);
        $entities[] = [
            'id' => 'synthetic:' . $code,
            'code' => $code,
            'title' => $code,
            'classKind' => 'block',
            'typeRaw' => 'synthetic block',
            'parent' => $parent,
            'isTerminal' => false,
            'hasDagger' => 'none',
            'hasAsterisk' => false,
            'associatedCodes' => [],
            'icd9cmCode' => null,
            'validFrom' => $data['release']['validFrom'] ?? null,
            'validTo' => $data['release']['validTo'] ?? null,
            'synthetic' => true,
        ];
    }

    $byParent = [];
    foreach ($entities as $i => $entity) {
        if (!empty($entity['parent'])) $byParent[$entity['parent']][] = $i;
    }
    $data['entities'] = $entities;
    $data['byCode'] = $byCode;
    $data['byParent'] = $byParent;
    $data['release']['totalEntities'] = count($entities);
    $data['release']['syntheticEntities'] = count(array_filter($entities, fn($e) => !empty($e['synthetic'])));
    return $data;
}

function icd10imRangeBounds(string $code): ?array
{
    if (!preg_match('/^([A-Z])(\d{2})-([A-Z])(\d{2})$/', $code, $m)) return null;
    $start = ord($m[1]) * 100 + (int)$m[2];
    $end = ord($m[3]) * 100 + (int)$m[4];
    return $start <= $end ? [$start, $end] : null;
}
