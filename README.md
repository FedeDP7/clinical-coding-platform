# Clinical Coding Platform

Academic project providing PHP REST APIs and embeddable JavaScript coding tools for Italian clinical classifications: ICD-10-IM and CIPI.

## Components

| Directory | Purpose | Documentation |
| --- | --- | --- |
| `icd10-im/` | Main platform with a shared API supporting ICD-10-IM and CIPI, plus integration examples. | [Setup](icd10-im/README.md) · [Italian technical documentation](icd10-im/docs/README.it.md) |
| `cipi/` | Separate CIPI implementation with its own API, library and examples. | [Setup](cipi/README.md) · [Italian technical documentation](cipi/docs/README.it.md) |

Both components are kept in one repository because they belong to the same academic project. The main platform already supports CIPI; the standalone CIPI implementation is retained as a distinct implementation. Their code has not been merged. Paths within each component are preserved.

## Requirements

PHP with ZipArchive and SimpleXML. Node.js is optional for the standalone CIPI alternative converter. No Composer installation is required.

## Run locally

Start one component at a time from the repository root:

```sh
# Main platform: ICD-10-IM and CIPI
php -S localhost:8000 -t icd10-im
```

Open `http://localhost:8000/index.html`.

Alternatively, stop that server and start the standalone CIPI component:

```sh
php -S localhost:8000 -t cipi
```

Open `http://localhost:8000/Web/cipi.html`. CIPI examples default to port 8000. To run both components simultaneously, use different ports and adjust the relevant `apiBaseUrl` settings.

## Classification data

The prepared local copy contains the original workbooks and generated JSON files. These are ignored by Git and will not be included in a fresh clone. Obtain authorized workbooks and follow the instructions in [ICD-10-IM data setup](icd10-im/api/data/README.md) and [CIPI data setup](cipi/api/data/README.md).

Run conversion commands from the relevant component directory. ICD-10-IM import normalizes chapter roots and adds two non-codable technical range containers while preserving source clinical records. CIPI PHP output differs from the supplied JSON only in CRLF/LF line endings for 19 entities. See [API and hierarchy corrections](docs/FIXES.md).

## Regression checks

```sh
php tests/regression.php
```

The suite uses synthetic fixtures, needs no classification dataset, and covers parameter validation, pagination, subtree filters and hierarchy normalization.

## Publication and licensing

The source code and accompanying software documentation in both components are licensed under the [MIT License](LICENSE). Copyright (c) 2026 FedeDP7.

This license does not cover classification datasets or any thesis document. Dataset rights and attribution are separate; workbooks and generated JSON remain excluded from Git.

Read the [publication checklist](docs/PUBLICATION.md) before the first commit. The source archive was not modified.
