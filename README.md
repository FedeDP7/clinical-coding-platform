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

Run conversion commands from the relevant component directory. CIPI PHP conversion differs from the supplied JSON in textual fields of 19 entities; the supplied local JSON has been preserved. See the publication notes before regenerating a release.

## Publication and licensing

No code license has been selected. Confirm ownership and choose a software license before describing the project as open source. Dataset rights and attribution must be assessed separately; workbooks and generated JSON are excluded from publication by default.

Read the [publication checklist](docs/PUBLICATION.md) before the first commit. The source archive was not modified.
