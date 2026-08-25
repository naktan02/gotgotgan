# Local development

Install from the repository root with `npm install`, then run `npm run check:contracts`,
`npm run check:web`, and `npm run check:backend`. Browser tests require a test-owned explicit address:

```powershell
$env:PLACE_WEB_E2E_BASE_URL='http://localhost:4177'
npm run test:e2e
```

The example is local-only test configuration, not a deployment address. Stage 1 needs no sibling
repository, database, provider account, map key, Identity client, or Gateway route.
