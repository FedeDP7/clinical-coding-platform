# ICD-10-IM and CIPI terminology platform

Academic project providing PHP REST APIs and an embeddable JavaScript coding tool for ICD-10-IM and CIPI. The browser components expose `ICT` and `CODIT` aliases. Documentation and examples retain Italian classification terms.

## Requirements and local setup

PHP with ZipArchive and SimpleXML. No Composer installation is required. Node.js is optional for the alternative CIPI converter in the standalone CIPI project.

Official workbooks and generated datasets are deliberately not distributed. No additional redistribution-permission process or hosted data API is planned. A fresh clone can run the synthetic tests described in the root README; the data-backed demos require separately held, lawfully usable local workbooks. See the [distribution policy](../docs/DATA_SOURCES.md) and [private integration instructions](api/data/README.md).

From this repository directory, generate the datasets if necessary:

```sh
php scripts/convert.php api/data/icd10im.xlsx api/data/icd10im.json
php scripts/convert_cipi.php api/data/CIPI.xlsx api/data/cipi.json
php -S localhost:8000
```

Open `http://localhost:8000/index.html`. Run the two repositories separately, or use different ports and update the CIPI examples' `apiBaseUrl` accordingly (their default is port 8000).

## Structure

- `api/`: PHP REST API and local data directory.
- `scripts/`: workbook-to-JSON converters.
- `Samples/`: browser, callback, coding tool, popup and SDO integration examples.
- `Samples_CIPI/`: CIPI examples using the shared API.
- Root JavaScript and CSS files: embeddable libraries and styles.
- [Italian technical documentation](docs/README.it.md): API routes and integration details. Paths in that document are relative to the repository root.

## Publication status

The source code and accompanying software documentation are licensed under the [MIT License](../LICENSE), copyright (c) 2026 FedeDP7. This license does not cover classification datasets or any thesis document. Official workbooks and generated JSON remain excluded by the project's distribution policy. This is not a pending authorization task. Local source notices are recorded in the [policy and references](../docs/DATA_SOURCES.md).

The original source archive was not modified. Local assistant configuration and internal working notes were omitted from this copy. See [publication notes](docs/PUBLICATION.md).
