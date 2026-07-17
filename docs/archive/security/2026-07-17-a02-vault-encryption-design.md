# A-02 Password Vault Encryption Design

Date: 2026-07-17
Task: A-02
Status: Complete
Depends on: A-01 password vault data audit

## 1. Decision

LifeOS will use a user-supplied vault master password, Node.js `crypto.scrypt` for key derivation, and AES-256-GCM for authenticated encryption.

Electron `safeStorage` is not the primary key source. It may later wrap an opt-in convenience token, but the vault must remain recoverable from a backup on another supported machine when the user knows the master password.

## 2. Why this design

### AES-256-GCM with a password-derived key

- Protects both confidentiality and integrity.
- Is available in the Node.js runtime without a native dependency.
- Supports a portable backup and restore model.
- Makes incorrect passwords and modified ciphertext fail authentication.
- Allows explicit cipher and KDF versioning.

### Why `safeStorage` is not sufficient by itself

- It is tied to the operating-system credential store and generally to the current machine/account.
- A copied LifeOS backup could become undecryptable on another machine.
- Behavior and security properties differ across macOS, Windows, and Linux environments.
- It does not replace an application-level unlock secret when the product explicitly presents a master-password workflow.

### Why encryption stays in the main process

- The renderer must not derive or retain the vault key.
- The current generic SQL bridge is too broad for sensitive operations.
- Main-process ownership permits explicit unlock, timeout, lock, and migration boundaries.
- Plaintext can be returned only for a specific reveal/copy operation instead of loading every password into React state.

## 3. Cryptographic profile

| Property | Value |
|---|---|
| Cipher | AES-256-GCM |
| Key size | 32 bytes |
| IV / nonce | 12 cryptographically random bytes per encrypted payload |
| Authentication tag | 16 bytes |
| KDF | scrypt |
| Salt | 16 cryptographically random bytes per vault |
| Initial scrypt cost | `N=32768`, `r=8`, `p=1`, `maxmem=64 MiB` |
| Encoding | Base64 for binary database fields |
| Random source | `crypto.randomBytes()` |
| String encoding | UTF-8 |

The KDF parameters are initial values, not permanent constants. They must be stored with the vault metadata so a future version can raise the cost while retaining decryptability.

## 4. Key hierarchy and lifecycle

```text
master password (renderer input)
  -> one IPC request over contextBridge
  -> main process
  -> scrypt(password, vault salt, stored KDF parameters)
  -> 32-byte vault key held only in main-process memory
  -> AES-256-GCM encrypt/decrypt operations
```

Rules:

1. The master password is never written to disk, settings, logs, SQLite, or renderer storage.
2. The derived key is never sent to the renderer.
3. One in-memory key exists per active user session at most.
4. Switching users, signing out, locking the vault, clearing app data, or quitting destroys the in-memory key reference and overwrites its Buffer before release.
5. The default inactivity timeout is 15 minutes and is reset only by a successful vault operation, not by arbitrary application activity.
6. Suspend, screen lock, and renderer destruction lock the vault when Electron provides the corresponding lifecycle event.
7. A failed unlock never replaces an existing valid key.

JavaScript cannot guarantee physical memory erasure because of runtime copies and garbage collection. Buffer overwrite is therefore defense in depth, not a formal secure-memory guarantee; the design minimizes plaintext/key lifetime and avoids long-lived renderer copies.

## 5. Vault metadata

A new singleton `vault_meta` table will describe the cryptographic state:

| Column | Purpose |
|---|---|
| `id` | Singleton row, fixed to `1` |
| `schema_version` | Vault database schema version |
| `cipher_version` | Payload envelope version |
| `kdf_name` | `scrypt` |
| `kdf_salt` | Base64 vault salt |
| `kdf_n` / `kdf_r` / `kdf_p` | Stored scrypt parameters |
| `verifier_ciphertext` | Encrypted fixed verifier payload |
| `verifier_iv` | Verifier nonce |
| `verifier_tag` | Verifier authentication tag |
| `migration_state` | `legacy`, `ready`, or `failed` |
| `updated_at` | Last metadata update time |

The encrypted verifier confirms that a derived key is correct without storing a password hash that could be confused with the encryption key. The fixed plaintext contains a versioned random vault identifier, not user data.

## 6. Credential payload format

Sensitive fields will be encrypted as one versioned JSON payload so one authentication tag covers the password and notes together:

```json
{
  "version": 1,
  "password": "user secret",
  "notes": "optional private notes"
}
```

Non-sensitive lookup fields remain separate:

- `id`
- `website_name`
- `url`
- `username`
- `created_at`
- `updated_at`

The encrypted row stores:

- `secret_ciphertext`
- `secret_iv`
- `secret_tag`
- `secret_version`

AES-GCM additional authenticated data (AAD) binds the payload to a stable context containing the cipher version and credential row ID. Moving ciphertext between rows must therefore fail authentication.

## 7. Main-process service boundary

A dedicated vault service will own all sensitive operations:

- `getStatus(userId)`
- `setup(masterPassword)`
- `unlock(masterPassword)`
- `lock()`
- `listCredentials()` returning metadata only
- `createCredential(input)`
- `revealCredential(id)` returning one decrypted payload
- `deleteCredential(id)`
- `getMigrationStatus()`
- `migrateLegacy(masterPassword, decision)`

The preload bridge will expose typed operations only. The generic `dbQuery('vault', ...)` and `dbTransaction('vault', ...)` paths must be rejected in the main process after the dedicated service is wired.

## 8. Renderer data policy

- Credential lists contain metadata only; they do not include ciphertext, password, notes, IV, or authentication tag.
- Reveal returns one credential secret on demand.
- The renderer clears the revealed value when hidden, when the vault locks, when the active user changes, and after a short timeout.
- Copy should be performed by a main-process vault operation where practical, so plaintext does not need to persist in React state.
- Generated passwords use `crypto.randomBytes()` through a dedicated operation or Web Crypto `getRandomValues()`, never `Math.random()`.

## 9. Setup and unlock behavior

### New vault

1. UI requests initial setup and password confirmation.
2. Main process creates the salt and derives the key.
3. Main process encrypts the verifier.
4. Metadata is committed transactionally.
5. Vault enters `ready` and unlocked state.

### Existing encrypted vault

1. Main process derives a candidate key using stored KDF parameters.
2. It attempts to decrypt and validate the verifier.
3. Success installs the key in memory.
4. Authentication failure returns `INVALID_PASSWORD` without revealing whether any credential exists.

### Legacy plaintext vault

1. Status is `MIGRATION_REQUIRED`.
2. Existing secrets are not loaded into the renderer list.
3. User chooses migration after establishing a master password, or explicitly discards legacy secrets.
4. A-05 defines the exact transaction and backup behavior.

## 10. Failure behavior

All vault operations return stable error codes; raw crypto, SQLite, filesystem paths, and stack traces are logged only in sanitized development diagnostics and are never shown directly to users.

| Code | Meaning | User-visible behavior |
|---|---|---|
| `VAULT_LOCKED` | No active key | Return to unlock screen |
| `VAULT_NOT_CONFIGURED` | No metadata for a new vault | Show setup flow |
| `MIGRATION_REQUIRED` | Legacy plaintext rows detected | Show migration decision flow |
| `INVALID_PASSWORD` | Verifier authentication failed | Generic incorrect-password message |
| `CORRUPT_DATA` | Payload authentication failed | Do not reveal partial data; offer restore guidance |
| `UNSUPPORTED_VERSION` | Newer cipher/schema version | Stop writes and request application update |
| `RATE_LIMITED` | Too many unlock failures | Disable unlock until retry time |
| `STORAGE_ERROR` | Transaction or filesystem failure | Preserve prior state and show retry guidance |

Unlock throttling starts after five consecutive failures. The initial delay is 30 seconds and increases for continued failures within the running session. This is not a substitute for a strong master password because an attacker with the database can attempt offline guesses.

## 11. Migration and rollback constraints

- A pre-migration backup is mandatory.
- Migration is idempotent and transactionally marks each database state.
- The new encrypted payload is written and authenticated before legacy fields are cleared.
- Application code must not claim completion until every row verifies with the new key.
- On failure, rollback preserves the original legacy database and reports `migration_state=failed` in a separate recovery record or log.
- SQLite WAL/checkpoint handling must be explicit before copying or replacing a database.
- Legacy plaintext backups are clearly labelled sensitive and are never included in normal long-term backup rotation without user acknowledgement.

## 12. Compatibility and performance checks

Before freezing KDF parameters, A-03/A-06 must measure scrypt derivation on representative supported hardware. The target interactive unlock time is approximately 150-500 ms; parameters may be adjusted only before encrypted production data exists or through a versioned rewrap migration.

The implementation must be tested on:

- macOS primary development architecture
- Windows supported architecture
- Ubuntu supported architecture, including environments where `safeStorage` has reduced guarantees

## 13. A-02 acceptance check

- [x] Cipher and KDF are selected with concrete parameters.
- [x] Key storage and lifecycle are defined.
- [x] The master password is never persisted.
- [x] Cross-machine backup recovery is preserved.
- [x] Main-process and renderer trust boundaries are defined.
- [x] Setup, unlock, legacy migration, corruption, and unsupported-version behavior are defined.
- [x] Schema metadata and payload versioning are defined.
- [x] `safeStorage` tradeoffs are documented.

## 14. Implementation sequence for A-03 and A-04

1. Add a pure crypto module with versioned encrypt/decrypt helpers and tests.
2. Add vault metadata/schema helpers without changing the current UI path.
3. Add a main-process vault service and typed IPC handlers.
4. Reject generic vault database access after the dedicated path is operational.
5. Replace the renderer unlock/list/create/reveal/delete flow.
6. Add migration behavior in A-05.
7. Run security, integration, full regression, build, and lint checks before each task commit.
