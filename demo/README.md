# Demo Application for Task B Verification

This tiny Flask application exists strictly for the ForgeTrail Task B verification script (`npm run verify:b`).
It sets fake sensitive configuration keys (`SECRET_KEY`, `DB_PASSWORD`, `API_TOKEN`, `STRIPE_KEY`) and normal keys (`APP_NAME`, `REGION`) to verify that the newly implemented `flask config` CLI command accurately outputs JSON with sensitive values masked as `***`.
