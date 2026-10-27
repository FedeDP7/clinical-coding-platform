# Local classification datasets

This directory contains classification data used by the API. Workbooks and generated JSON files are deliberately ignored by Git; the local preparation retains copies for testing.

Required files:

- `icd10im.xlsx` -> `icd10im.json` via `php scripts/convert.php`.

- `CIPI.xlsx` -> `cipi.json` via `php scripts/convert_cipi.php`.

Run the commands from the repository root. Explicit input/output arguments are documented in the main README. Obtain authorized workbooks from the data owner; no download URL or redistribution permission has been verified in this preparation.

Do not assume that a software license applies to classification data. Original workbooks contain author and local-path metadata. Do not force-add them to Git. Review attribution, redistribution and conversion terms before publishing any dataset.

The ICD-10-IM converter and API share hierarchy normalization: chapter intervals are retained as metadata and missing ranges become explicitly marked, non-codable technical containers. Source clinical records and workbooks are preserved. See [correction details](../../../docs/FIXES.md).
