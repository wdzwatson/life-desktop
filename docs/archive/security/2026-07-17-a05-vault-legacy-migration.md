# A-05 Password Vault Legacy Migration

Date: 2026-07-17
Task: A-05
Status: Complete
Depends on: A-01 data audit, A-03 crypto core, A-04 vault session flow

## 1. Decision

Legacy vault rows are not silently trusted. When `vault_meta` is missing and existing rows are present, the vault reports `migration_required`.

The user must explicitly provide and confirm a new vault master password. The main process then creates a sensitive local backup and migrates legacy plaintext rows inside one SQLite transaction.

## 2. Legacy row detection

A row is eligible for migration when:

- `secret_ciphertext IS NULL`
- `password_encrypted` is nonblank

This matches the legacy renderer write path where `password_encrypted` stored the plaintext password and `iv` / `tag` were UI placeholders, not cryptographic values.

## 3. Backup behavior

Before rewriting rows, `VaultService.migrateLegacy()`:

1. Runs `wal_checkpoint(FULL)` on the active vault database.
2. Creates a SQLite online backup with `db.backup()`.
3. Stores the backup under `vault-sensitive-backups/` beside `vault.db` in production.
4. Names the file `vault-legacy-plaintext-<timestamp>.db`.

The backup is intentionally labelled plaintext-sensitive. It exists for rollback and user recovery, not for normal long-term rotation.

## 4. Transaction behavior

Inside one transaction the service:

1. Derives the vault key from the new master password.
2. Inserts `vault_meta` with schema, cipher, KDF, salt, verifier, and `ready` state.
3. Encrypts each legacy password and note into `secret_ciphertext`, `secret_iv`, `secret_tag`, and `secret_version`.
4. Immediately decrypts each generated payload to verify it matches the legacy source.
5. Clears legacy plaintext fields: `password_encrypted`, `notes_encrypted`, `iv`, and `tag`.

If any write, verification, or SQLite operation fails, the transaction rolls back. The database remains in `migration_required` state and the original legacy rows remain available for a retry.

## 5. Idempotency

After migration succeeds, calling `migrateLegacy()` again returns a no-op result with the current ready status and does not create another backup.

## 6. User flow

The Toolbox vault view now shows a migration form when legacy data is detected. The renderer never loads legacy rows directly. It only sends the new master password to the dedicated `vault:migrateLegacy` IPC handler.

After success, the vault enters the unlocked state and lists metadata only. Password reveal remains on-demand.

## 7. Acceptance check

- [x] Legacy databases upgrade without crashing.
- [x] Migration creates a sensitive backup before rewriting.
- [x] Migration encrypts legacy passwords and notes with AES-256-GCM.
- [x] Legacy plaintext columns are cleared after successful verification.
- [x] Migration is idempotent after success.
- [x] Migration failure rolls back metadata and encrypted writes.
- [x] Renderer access stays behind dedicated vault IPC.
- [x] Chinese and English migration copy is present.
- [x] Automated tests cover success, backup, reveal, idempotency, and rollback.
