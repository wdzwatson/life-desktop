# A-07 User Data and Backup Boundary

Date: 2026-07-17
Task: A-07
Status: Complete
Scope: Local data ownership, backup inclusion, restore expectations, and deletion boundary

## 1. Root layout

LifeOS stores local application data under:

```text
~/LifeOS
```

Current top-level responsibilities:

| Path | Owner | Purpose | Backup boundary |
|---|---|---|---|
| `config/settings.json` | Global app | Theme, language, active user, user profiles, video tool settings, custom video directory | Include, with password hashes treated as sensitive |
| `users/<userId>/database/` | Per user | SQLite databases for user content and metadata | Include all `*.db`; include WAL/SHM only through a consistent SQLite backup or after closing/checkpointing |
| `users/<userId>/files/notes/` | Per user | Note attachments and exported/imported note files | Include |
| `users/<userId>/files/books/` | Per user | Imported book files | Include |
| `users/<userId>/files/videos/` | Per user by default | Downloaded video files when no custom video directory is configured | Include by default; may be excluded by user choice for size |
| `tools/video/` | Global app cache/tooling | Managed yt-dlp / ffmpeg tools | Exclude by default; rebuildable |
| `users/<userId>/database/vault-sensitive-backups/` | Vault migration recovery | Plaintext-sensitive legacy vault backups created before migration | Exclude from normal backup unless user explicitly opts in |

## 2. User databases

Each user has independent SQLite files in `users/<userId>/database/`.

| Database | Main tables | Sensitivity | Backup decision |
|---|---|---|---|
| `tasks.db` | `tasks`, `recurring_rules`, `translations` | Medium | Include |
| `notes.db` | `notebooks`, `notes`, `backlinks`, `translations` | High | Include |
| `books.db` | `books`, `highlights`, `categories`, `translations` | Medium / High for annotations | Include |
| `videos.db` | `videos`, `video_groups`, `video_tags`, `video_tag_links`, `video_download_batches` | Medium | Include |
| `vault.db` | `vault`, `vault_meta` | Critical | Include encrypted database only; never expose plaintext through backup tooling |

SQLite databases use WAL mode while open. Backup and restore flows must either close database handles first or use SQLite online backup/checkpoint behavior to avoid missing recent writes.

## 3. File assets

| Asset class | Default path | Backup decision | Restore expectation |
|---|---|---|---|
| Notes attachments / exports | `users/<userId>/files/notes/` | Include | Restored files should match note references |
| Imported books | `users/<userId>/files/books/` | Include | Book database paths should resolve after restore |
| Downloaded videos | `users/<userId>/files/videos/` | Include by default, optional exclusion for size | Video records without files remain metadata-only and may need re-download |
| Custom video directory | `settings.videoDownloadDir` | Prompt user | If outside `~/LifeOS`, backup must either include it explicitly or record it as an external dependency |

## 4. Configuration and account data

`config/settings.json` must be included in a full backup because it contains:

- Registered user profile metadata.
- Password hashes and salts for profile login.
- Session flags and last active user.
- Theme, language, update, and video settings.
- Custom video download directory.

Restore must treat settings as sensitive. A future restore flow should preview the target profiles and confirm before replacing current settings.

## 5. Sensitive exclusions

The following data should not be included in normal backup packages by default:

| Path / data | Reason | Handling |
|---|---|---|
| `tools/video/` | Rebuildable managed tools | Reinstall or re-detect |
| temporary build/cache folders | Rebuildable and environment-specific | Exclude |
| `vault-sensitive-backups/` | May contain legacy plaintext passwords | Exclude unless user explicitly includes sensitive recovery backups |
| logs containing stack traces or local paths | May leak private data | Include only in diagnostics export with confirmation |

## 6. Delete boundary

The existing clear-data flow removes `~/LifeOS/users/` and resets `settings.userProfiles`, while keeping global configuration such as theme and language.

Expected user-facing meaning:

- User databases are deleted.
- Imported note/book/video files under `users/` are deleted.
- Vault encrypted databases and migration backups under `users/` are deleted.
- Global app preferences may remain.
- Files in external custom video directories are not deleted unless a future flow explicitly asks for that authority.

## 7. Inputs for A-08 backup

A minimal backup package should include:

1. Manifest with app version, created time, source platform, and selected user ids.
2. `config/settings.json`.
3. Selected `users/<userId>/database/*.db` captured consistently.
4. Selected `users/<userId>/files/notes/` and `books/`.
5. `videos/` only when the user opts into large media backup.
6. External video directory references when excluded.
7. SHA-256 checksums for included files.

The backup UI must clearly separate:

- Required metadata backup.
- Optional large media backup.
- Explicitly sensitive legacy vault recovery backups.

## 8. Acceptance check

- [x] Database, book, video, config, cache/tooling, and sensitive backup boundaries are documented.
- [x] Backup inclusion and exclusion decisions are explicit.
- [x] Restore expectations are clear enough for A-08/A-09 implementation.
- [x] Delete behavior and external-file authority are documented.
