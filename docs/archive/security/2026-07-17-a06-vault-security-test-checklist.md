# A-06 Password Vault Security Test Checklist

Date: 2026-07-17
Task: A-06
Status: Complete
Depends on: A-03 crypto core, A-04 vault session flow, A-05 legacy migration

## 1. Automated coverage

| Scenario | Test coverage |
|---|---|
| Empty credential password | `tests/vaultService.test.mjs` rejects create with `INVALID_INPUT` |
| Wrong master password | `tests/vaultService.test.mjs` rejects unlock and rate limits repeated failures |
| Ciphertext tampering | `tests/vaultCrypto.test.ts` and `tests/vaultService.test.mjs` reject modified payloads |
| Migration failure rollback | `tests/vaultService.test.mjs` forces a SQLite update failure and verifies rollback |
| Clipboard auto-clear | `tests/toolboxVaultUtils.test.ts` verifies the secret is followed by a blank write |
| Lock recovery | `tests/vaultService.test.mjs` rejects sensitive operations while locked, then reveal works after unlock |
| Metadata-only lists | `tests/vaultService.test.mjs` verifies list output does not include password or note plaintext |
| Generic vault SQL blocked | `tests/vaultService.test.mjs` covers the direct database access policy |
| Localization keys | `tests/vaultLocales.test.ts` covers Chinese and English vault safety copy |

## 2. Database plaintext spot checks

The service tests inspect current database rows after new encrypted writes and legacy migration. They verify:

- `secret_ciphertext` is not the plaintext password.
- Current row JSON does not include password or note plaintext after encryption.
- Legacy fields are cleared after successful migration.
- The sensitive pre-migration backup intentionally retains legacy plaintext for recovery.

## 3. Manual smoke check

Before commit, launch Electron from the built output and confirm the main process starts without vault IPC/preload errors.

## 4. Acceptance check

- [x] Empty password is rejected.
- [x] Wrong password and unlock rate limiting are covered.
- [x] Tampered encrypted data is rejected.
- [x] Migration failure rolls back.
- [x] Clipboard auto-clear behavior is covered.
- [x] Lock and unlock recovery behavior is covered.
- [x] Database spot checks find no plaintext in current encrypted rows.
- [x] Full regression, build, lint, diff check, and desktop smoke pass before commit.
