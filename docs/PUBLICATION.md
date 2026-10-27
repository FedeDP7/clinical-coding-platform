# Publication preparation

Prepared on 2026-10-27 as a single repository with two component directories.

- Only the repository root contains `.git/`. Component directories are ordinary folders, not submodules.
- Root `.gitignore` excludes local credentials, assistant/editor settings, logs, dependencies, workbooks and both `api/data/` datasets. Dataset instruction files remain publishable.
- Original local assistant settings and internal notes were omitted.
- The performed file audit found no matching credentials, private keys or patient identifiers. Original workbook properties contain author names and local paths; those workbooks remain local and ignored.
- The main API was corrected to default absent CIPI dagger/asterisk fields to `none`/`false`, avoiding warnings in JSON responses.
- PHP/JavaScript syntax checks and API smoke tests passed during component preparation. Relative HTML asset links were checked. Browser interaction flows were not tested.
- PHP conversion of ICD-10-IM matched the supplied JSON. CIPI conversion completed with 15,958 entities, but text fields differed for 19 entities; the supplied JSON was retained. Review before regenerating a release.
- Confirm code ownership and select a license. Verify dataset distribution and attribution terms separately.
- Before committing, inspect `git status --short` and `git diff --cached`. Do not force-add ignored datasets or upload the entire local directory as an archive.

Detailed component notes: [main platform](../icd10-im/docs/PUBLICATION.md), [standalone CIPI](../cipi/docs/PUBLICATION.md).
