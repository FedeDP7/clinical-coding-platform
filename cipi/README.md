# CIPI terminology platform

Academic project providing PHP REST APIs and an embeddable JavaScript coding tool for CIPI. The browser components expose `ICT` and `CODIT` aliases. Documentation and examples retain Italian classification terms.

## Requirements and local setup

PHP with ZipArchive and SimpleXML. No Composer installation is required. Node.js is optional for the alternative CIPI converter in the standalone CIPI project.

The original datasets are available only in this prepared local copy. They are ignored by Git. A fresh clone needs authorized source workbooks placed in `api/data/`; see [dataset instructions](api/data/README.md).

From this repository directory, generate the datasets if necessary:

```sh
php scripts/convert_cipi.php api/data/CIPI.xlsx api/data/cipi.json
php -S localhost:8000
```

Open `http://localhost:8000/Web/cipi.html`. Run the two repositories separately, or use different ports and update the CIPI examples' `apiBaseUrl` accordingly (their default is port 8000).

## Structure

- `api/`: PHP REST API and local data directory.
- `scripts/`: workbook-to-JSON converters.
- `Samples/`: browser, callback, coding tool, popup and SDO integration examples.
- `Web/`: additional CIPI browser and SDO pages.
- Root JavaScript and CSS files: embeddable libraries and styles.
- [Italian technical documentation](docs/README.it.md): API routes and integration details. Paths in that document are relative to the repository root.

## Publication status

This is a preparation for publication. No software license has been selected; confirm ownership and choose a license before describing the code as open source. Dataset licensing is separate: local metadata includes license labels, but these have not been independently verified. The XLSX sources and generated JSON files are excluded from Git until redistribution terms are established.

The original source archive was not modified. Local assistant configuration and internal working notes were omitted from this copy. See [publication notes](docs/PUBLICATION.md).
