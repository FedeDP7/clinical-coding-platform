# API and hierarchy corrections

The directory layout, JavaScript libraries, endpoint paths and response envelopes are preserved.

## Query parameters

Both APIs reject array parameters such as `q[]=test` or `route[]=test` with HTTP 400 and the existing JSON `INVALID_PARAM` error envelope. Pagination accepts representable integers, retains the existing minimum/maximum page-size limits and avoids offset overflow. Inputs outside the integer range fail with HTTP 400.

## Subtree search

`chapter` now includes the chosen node and all its descendants. The traversal uses the parent index and a visited set. Unknown nodes return no results. ICD-10-IM also accepts the original chapter interval, such as `A00-B99`, as an alias for its chapter code (`I`). Existing terminal-only, text, class and pagination filters continue to apply.

## ICD-10-IM source hierarchy

The source workbook stores chapter intervals in the parent column and refers to two range blocks that have no source row. Normalization is shared between the converter and API so older generated JSON remains usable without an immediate reimport.

- Chapters become roots (`parent: null`); their original interval is preserved as additive `chapterRange` metadata.
- Missing `M05-M14` and `T20-T25` blocks are technical containers. Their titles are the range codes, not invented clinical descriptions. They are marked `synthetic: true` and `isTerminal: false`.
- A missing range can be attached only to the narrowest explicit source block that contains it. For the supplied workbook, these are `M00-M25` and `T20-T32`. Non-range or unresolvable parents are left untouched rather than guessed.
- All 14,773 source records retain their clinical fields and identifiers. The normalized dataset has 14,775 entities, including two containers. Codable totals do not change. `release.totalEntities` includes the containers; `release.syntheticEntities` identifies their count.
- Entity positions for source records are preserved, and indexes are rebuilt for the normalized parent links. Normalization is idempotent.

This is a navigation correction, not a change to the official classification or its licensing. Workbooks and generated datasets remain local and ignored by Git.

## Regression checks

From the repository root, with PHP CLI available:

```sh
php tests/regression.php
```

The tests use small synthetic fixtures in temporary directories and do not need classification datasets. They check malformed parameters, pagination bounds, nested descendants, chapter interval aliases, unchanged source fields, technical range flags, ancestor paths, release validation and normalization idempotence.
