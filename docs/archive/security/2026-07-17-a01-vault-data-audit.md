# A-01 Password Vault Data Audit

Date: 2026-07-17
Task: A-01
Status: Complete
Scope: Existing vault storage format, renderer/main-process call path, risks, and migration entry points

## 1. Current storage location

Each profile has an independent SQLite database at:

```text
~/LifeOS/users/<activeUserId>/database/vault.db
```

The path is derived in `electron/main.ts` by `getUserDb('vault')`. The schema is created by `initializeUserDatabase()` in `electron/db/schema.ts` whenever a user session is initialized.

SQLite uses WAL mode, so a live database can also have `vault.db-wal` and `vault.db-shm` files. Any migration or backup operation must account for these files or use a consistent SQLite transaction/backup mechanism.

## 2. Current schema

| Column | Type | Required | Current meaning | Sensitivity |
|---|---|---:|---|---|
| `id` | INTEGER | Yes | Local row identifier | Low |
| `website_name` | TEXT | Yes | Site or application display name | Medium |
| `url` | TEXT | No | Account URL | Medium |
| `username` | TEXT | No | Login name or email | High |
| `password_encrypted` | TEXT | Yes | Currently stores the plaintext password despite its name | Critical |
| `notes_encrypted` | TEXT | No | Currently stores plaintext notes despite its name | High / Critical |
| `iv` | TEXT | Yes | Random UI-generated placeholder, not a cryptographic IV | None in current form |
| `tag` | TEXT | Yes | Random UI-generated placeholder, not an authentication tag | None in current form |
| `created_at` | TEXT | No | SQLite creation timestamp | Low |

The schema contains no version marker, KDF metadata, salt, cipher identifier, migration state, or update timestamp.

## 3. Current write path

```text
Toolbox form
  -> handleCreateCredential()
  -> window.electronAPI.dbQuery('vault', INSERT ...)
  -> preload ipcRenderer.invoke('db:query', ...)
  -> main-process generic db:query handler
  -> vault.db
```

Observed behavior:

- `newPassword` is written directly into `password_encrypted`.
- `newNotes` is written directly into `notes_encrypted`.
- `iv` and `tag` are generated with `Math.random()` and do not protect or authenticate data.
- Encryption does not occur in either the renderer or main process.
- The generic database bridge accepts renderer-provided SQL and parameters.

## 4. Current read and disclosure path

```text
Toolbox unlocked state
  -> SELECT * FROM vault
  -> generic db:query IPC
  -> complete rows returned to renderer
  -> password_encrypted displayed or copied as plaintext
```

Observed behavior:

- Unlock succeeds when the input is `admin` or has at least four characters.
- Unlock is not tied to a stored verifier, profile password, keychain secret, or encryption key.
- A successful UI unlock causes all vault columns to be loaded into renderer memory.
- Reveal and copy actions use `item.password_encrypted` directly.
- Locking only changes React state; it does not destroy a cryptographic key because no key exists.
- Clipboard clearing is attempted after 30 seconds, but any later clipboard content could be overwritten by the timer.

## 5. Current delete path

The renderer sends `DELETE FROM vault WHERE id = ?` through the generic database bridge. Deletion has no undo, recovery, secure overwrite guarantee, or audit record. SQLite pages and WAL content may retain historical plaintext until SQLite reuses or vacuums them.

## 6. Confirmed risks

### P0 risks

1. Vault passwords and notes are stored as plaintext on disk.
2. Existing column names and UI copy falsely imply AES-GCM protection.
3. Any four-character input can unlock the UI and disclose every credential.
4. The renderer can query the vault through a generic SQL IPC bridge, bypassing any future vault-specific access policy unless that path is restricted.
5. Legacy plaintext may remain in SQLite pages, WAL files, backups, and copied databases after an in-place migration.

### P1 risks

1. No schema or cipher version exists, making future migration ambiguous.
2. `Math.random()` is also used for password generation and is not suitable for credential generation.
3. All decrypted credentials would remain in renderer state until replaced or the renderer exits.
4. The clipboard timer may erase content the user copied after the password.
5. Error handling does not distinguish locked, corrupt, unsupported, or migration-required states.

## 7. Migration entry points

The following boundaries are suitable for the next tasks:

1. **Schema initialization**: add versioned vault metadata and any new encrypted payload columns in `initializeUserDatabase()`.
2. **User session switch**: inspect vault format after databases are closed and before the profile becomes active.
3. **Dedicated main-process service**: move create/list/reveal/copy/delete operations behind vault-specific IPC handlers.
4. **Preload bridge**: expose only typed vault operations; the renderer must not send vault SQL.
5. **Toolbox UI**: replace the current boolean unlock check with explicit setup, unlock, locked, migration-required, and error states.
6. **Legacy migration**: identify rows where `iv` and `tag` use the current `iv_` / `tag_` placeholder pattern and treat them as plaintext legacy records.

## 8. Migration strategy constraints

- Do not silently label existing rows as encrypted.
- Do not migrate plaintext until the user has established or verified the new vault secret.
- Make migration transactional and idempotent.
- Create a consistent pre-migration backup before rewriting or replacing the database.
- Preserve non-sensitive metadata where possible, but allow users to discard legacy secrets.
- Remove renderer access to legacy plaintext after migration succeeds.
- Record schema version and cipher/KDF parameters required to decrypt each payload.
- Treat WAL and copied backup files as plaintext-sensitive until securely retired.

## 9. A-01 acceptance check

- [x] All vault schema fields are documented.
- [x] All current read, write, reveal/copy, and delete paths are documented.
- [x] Sensitive fields and false-encryption behavior are identified.
- [x] Migration entry points are identified.
- [x] Legacy data handling constraints are stated.

## 10. Inputs for subsequent tasks

- A-02 must choose the cipher, KDF, key lifecycle, storage boundary, and failure behavior.
- A-03 must implement encryption in the main process and prevent plaintext database writes.
- A-04 must replace the renderer-only unlock gate.
- A-05 must define a transactional migration for legacy plaintext rows and WAL-sensitive data.
- A-06 must verify that databases and IPC responses do not expose plaintext outside an unlocked operation.
