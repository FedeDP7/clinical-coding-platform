# Data distribution policy and source references

## Publication decision

This repository is distributed as software and documentation, with synthetic regression fixtures and synthetic presentation previews. It does not distribute official classification workbooks, derived JSON datasets or a hosted service exposing those datasets.

The maintainer has chosen **not to pursue additional dataset redistribution authorizations or contact rights holders as part of this project**. This is the chosen scope of publication, not an unfinished approval step or a task required for releasing the code.

Official workbooks and generated data are excluded by `.gitignore`. Local copies already held by the author remain private; this policy does not delete them. The importers and APIs remain available as software. Technical integration instructions do not provide data, download them automatically or grant rights to use or redistribute third-party material.

## Synthetic demonstrations

Current README previews show invented `DEMO` identifiers and fictional descriptions explicitly labelled as non-clinical. They were generated in temporary directories without loading the official workbooks or their derived datasets. They are examples of the interface, not classification content or clinical coding advice.

Regression tests use their own small synthetic fixtures and work without official data. No public data API is offered by this repository.

Earlier commits contained previews with classification excerpts. Those previews have been replaced in the current revision; earlier Git history has not been rewritten. No official workbook or generated JSON dataset has been added to the repository history.

## Source references retained for context

The following records describe the notices observed in the author's local workbooks on 2026-10-27. They do not indicate that files are supplied, that the references identify the latest release or that additional redistribution rights have been obtained.

### ICD-10-IM

The local gamma 2.1 workbook (December 2025, ICD-9-CM crosswalk, excluding chapter XX) names Ministero della Salute and Regione Autonoma Friuli Venezia Giulia and specifies CC BY-NC-ND 4.0. Its requested citation is:

> Ministero della Salute e Regione Autonoma Friuli Venezia Giulia, Elenco sistematico ICD-10-IM, versione gamma, 2.1 - Dicembre 2025, con transcodifica in ICD-9-CM (senza capitolo XX). Licenza: CC BY-NC-ND 4.0

Reference: [Ministry ICD-10-IM page](https://www.salute.gov.it/new/it/tema/assistenza-ospedaliera-sdo/la-classificazione-delle-diagnosi-icd-10-im/).

### CIPI

The local gamma 2.0 workbook (December 2025) names Ministero della Salute as its owner and specifies CC BY-NC-ND 4.0.

Reference: [Ministry CIPI page](https://www.salute.gov.it/new/it/tema/assistenza-ospedaliera-sdo/la-classificazione-delle-procedure-cipi/).

Source documentation reference: [NSIS-CLASS technical documentation](https://www.salute.gov.it/new/it/tema/assistenza-ospedaliera-sdo/documentazione-tecnica/). License reference: [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/).

## Software license and scope

The project's own software, software documentation, synthetic fixtures and current synthetic previews use the [MIT License](../LICENSE). Third-party source notices, classification materials and any thesis document are outside that grant. Publishing import code does not license the data it could process.

This is an independent academic project. No endorsement by the Ministry, Regione Autonoma Friuli Venezia Giulia or WHO is claimed. The source files described above identify experimental versions; they are not bundled or represented as a current official coding service.
