# Publication preparation

Prepared on 2026-10-27 from the supplied project archive.

- Source layout and application code preserved to avoid breaking relative links.
- Local `.claude` settings and internal `ADD.txt` / `README.txt` notes omitted.
- XLSX workbooks and generated JSON datasets retained locally but excluded from Git.
- No matching credentials or patient identifier records found by the performed pattern and structure checks. This is a bounded file audit, not a guarantee or a full application security assessment.
- Spreadsheet internal XML and properties inspected. Author names and local workbook paths exist in the original workbooks; these files are excluded from publication.
- APIs permit cross-origin GET requests and mention `X-Api-Key` in allowed headers; this header does not implement authentication. Development servers should only be used locally.
- Code ownership was confirmed by the author. Source code and accompanying software documentation are licensed under MIT in the root `LICENSE` file. Classification datasets and any thesis document are outside its scope. Establish dataset redistribution terms separately; inspect `git status --short` and `git diff --cached` before committing.
- This component belongs to the single `clinical-coding-platform` repository. Git metadata lives only at the repository root. The publication uses the root repository only.

The standalone CIPI project and the combined project contain differing JavaScript and API implementations. Both are retained; no unverified merge or deduplication was performed.

## Validation results

PHP and JavaScript syntax checks passed. Local API smoke tests passed for release, chapters, entity, search and resolve; unknown routes returned 404. Relative HTML asset and page links resolved. Browser search/selection and the CIPI SDO popup were subsequently verified during the API/hierarchy corrections.

Both PHP converters completed successfully. ICD-10-IM output matched the supplied JSON. CIPI conversion produced the same 15,958 entities but differed from the supplied JSON in text fields (`inclusions`, `exclusions`, `generalNotes`) for 19 entities. The differences were subsequently confirmed to be CRLF/LF line endings only; the alternative Node converter exactly reproduces the supplied JSON. See [corrections](../../docs/FIXES.md) and run `php tests/regression.php` from the repository root.
