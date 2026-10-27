# Classification sources, attribution and reuse

Checked on 2026-10-27 against the copyright notices embedded in the two local source workbooks supplied by the author. This identifies the terms on those copies; it does not establish that they are the latest releases or independently authenticate their download history.

## ICD-10-IM

**Rights holders:** Ministero della Salute and Regione Autonoma Friuli Venezia Giulia.

**Source version:** gamma 2.1, December 2025, with ICD-9-CM crosswalk, excluding chapter XX.

The source workbook requests the following citation:

> Ministero della Salute e Regione Autonoma Friuli Venezia Giulia, Elenco sistematico ICD-10-IM, versione gamma, 2.1 - Dicembre 2025, con transcodifica in ICD-9-CM (senza capitolo XX). Licenza: CC BY-NC-ND 4.0

Official references: [ICD-10-IM classification](https://www.salute.gov.it/new/it/tema/assistenza-ospedaliera-sdo/la-classificazione-delle-diagnosi-icd-10-im/) and [NSIS-CLASS technical documentation](https://www.salute.gov.it/new/it/tema/assistenza-ospedaliera-sdo/documentazione-tecnica/).

## CIPI

**Rights holder:** Ministero della Salute.

**Source version:** gamma 2.0, December 2025.

Attribution: Ministero della Salute, Classificazione Italiana delle Procedure e Interventi (CIPI), versione gamma 2.0, Dicembre 2025. The supplied workbook expressly identifies the Ministry as the exclusive owner and states **CC BY-NC-ND 4.0**.

Official references: [CIPI classification](https://www.salute.gov.it/new/it/tema/assistenza-ospedaliera-sdo/la-classificazione-delle-procedure-cipi/) and [NSIS-CLASS technical documentation](https://www.salute.gov.it/new/it/tema/assistenza-ospedaliera-sdo/documentazione-tecnica/).

## Separate rights and permitted uses

The workbooks specify [CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/deed.en): noncommercial sharing of unadapted material with attribution and retained notices. The project's MIT license does not replace these terms or cover classification content displayed in screenshots. It applies to the project's own software and software documentation.

The [legal code, sections 2–4](https://creativecommons.org/licenses/by-nc-nd/4.0/legalcode.en), permits necessary technical format changes and noncommercial private adaptations, but does not grant permission to share adapted material. A faithful format conversion is not automatically an adaptation. Hierarchy changes, generated nodes and database restructuring require a separate assessment before redistribution, including through an API.

This repository distributes neither source workbooks nor generated classification datasets. It contains import software and synthetic regression fixtures. The ICD-10-IM import normalizes roots and adds two technical ranges; CIPI converters also generate hierarchy nodes. These are project processing steps, not official revisions or modifications endorsed by the source owners. Redistribution permission for the resulting normalized datasets has not been established.

## Screenshots

The two README screenshots illustrate the author's software using selected classification entries. Classification codes and descriptions shown retain their source terms and attribution above; they are not relicensed under MIT. The screenshots contain no patient records. Source labels are displayed through the application's interface; classification titles are not translated or rewritten for the screenshots.

Creative Commons explains that [unaltered excerpts used to illustrate a larger work generally do not create an adaptation](https://creativecommons.org/faq/#can-i-reuse-an-excerpt-of-a-larger-work-that-is-licensed-with-the-noderivs-restriction). This is contextual guidance, not blanket authorization for every screenshot, presentation or dataset transformation.

## Publication boundaries

- Download authorized source files from the official technical documentation page; retain their full source notices.
- Keep workbooks and generated data local as configured by `.gitignore`.
- Confirm permission with the relevant rights holders before distributing normalized datasets, running a public data API or using the data commercially where the existing license does not cover that use. The source-code MIT license grants no such data rights.
- [GitHub's terms, section D](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#d-user-generated-content), require sufficient rights in third-party uploads; a public download alone is not proof of all required platform permissions.

The supplied versions are marked as experimental prototypes. The Ministry's classification pages describe their experimentation status; this independent academic project is not an official Ministry, regional or WHO service and no endorsement is claimed.
