# Publication preparation

Prepared on 2026-10-27 as a single repository with two component directories.

- Only the repository root contains `.git/`. Component directories are ordinary folders, not submodules.
- Root `.gitignore` excludes local credentials, assistant/editor settings, logs, dependencies, workbooks and both `api/data/` datasets. Dataset instruction files remain publishable.
- Original local assistant settings and internal notes were omitted.
- The performed file audit found no matching credentials, private keys or patient identifiers. Original workbook properties contain author names and local paths; those workbooks remain local and ignored.
- The main API was corrected to default absent CIPI dagger/asterisk fields to `none`/`false`, avoiding warnings in JSON responses.
- PHP/JavaScript syntax checks and API smoke tests passed during component preparation. Relative HTML asset links were checked. Browser search/selection and CIPI SDO interactions were subsequently tested during the [API/hierarchy corrections](FIXES.md).
- ICD-10-IM normalization now preserves source clinical fields and repairs navigation using chapter metadata and two non-codable technical ranges. CIPI conversion differences for 19 entities were confirmed to be CRLF/LF line endings only; Node output matches the supplied JSON.
- Run `php tests/regression.php` from the repository root for self-contained API and hierarchy regression checks.
- The author confirmed code ownership. Source code and accompanying software documentation use the [MIT License](../LICENSE), copyright (c) 2026 FedeDP7. Classification datasets and any thesis document are excluded from its scope. Dataset redistribution is outside the chosen publication scope; no permission-request process is planned.
- Before committing, inspect `git status --short` and `git diff --cached`. Do not force-add ignored datasets or upload the entire local directory as an archive.

Detailed component notes: [main platform](../icd10-im/docs/PUBLICATION.md), [standalone CIPI](../cipi/docs/PUBLICATION.md).

## Chosen publication policy

Publish code, documentation, synthetic regression tests and illustrative interface screenshots with source attribution. Official workbooks and generated datasets remain private and ignored by Git. No additional dataset redistribution-permission process or hosted classification-data API is planned. Screenshots contain selected classification entries and no patient records; their classification content remains outside the MIT grant. See [sources and data policy](DATA_SOURCES.md).
