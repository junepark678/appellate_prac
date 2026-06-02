# Repository Instructions

## Public Directory Policy

Do not add files to `public/` except app shell assets that must be served directly by the web runtime:

- `favicon.ico`
- `manifest.json`
- `robots.txt`
- logos and similar image assets used by the app shell

PDFs, court forms, generated documents, legal-source artifacts, imported records, datasets, fixtures, and other content assets must not be placed in `public/`. Store those assets through the application data/storage layer, such as Convex storage and source artifact records, or keep them in non-public test fixtures when they are only for tests.
