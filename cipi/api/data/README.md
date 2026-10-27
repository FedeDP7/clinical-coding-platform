# Private local data directory

This directory is reserved for separately held local data. Official workbooks and generated JSON files are not distributed with the repository and remain ignored by Git.

The maintainer is not seeking additional redistribution permissions. This exclusion is the publication policy, not an approval step waiting to be completed. See the [full policy and source references](../../../docs/DATA_SOURCES.md).

## Optional technical integration

Users who independently hold data they may lawfully use can place the following files here:

- `CIPI.xlsx` -> `cipi.json` via `scripts/convert_cipi.php`.

Run converter commands from the component directory (`icd10-im/` or `cipi/`), or use the explicit paths shown in the root README. These instructions supply no files and grant no third-party data rights. No automatic download or hosted classification-data API is provided.

Do not force-add local data to Git. Without imported data the API returns HTTP 503 with `DATA_NOT_READY`. Synthetic regression tests at `tests/regression.php` work without any official workbook.
