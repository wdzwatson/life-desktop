# Douyin Favorites Integration Plan

**Status:** Approved for sequential implementation

**Goal:** Let a LifeOS user sign in to Douyin through the official web experience, synchronize their favorite folders and favorite videos into a local-first read-only mirror, and browse that mirror inside the Videos workspace. Video downloading and remote mutation are deliberately deferred.

## Scope and guardrails

- The first release supports one Douyin account per LifeOS user profile.
- The app opens only Douyin's official login and uses its persisted Electron session. It never collects a password, exports cookies to the renderer, or writes cookie values to logs or SQLite.
- Synchronization is user-triggered. It is paginated, rate-limited, idempotent, and preserves the last successful local mirror when a request fails.
- A challenge, CAPTCHA, unsupported endpoint, or expired session produces a clear state. The implementation must not attempt to bypass access controls.
- This release does not download videos, create or edit folders, move favorites, or unfavorite videos.

## Architecture

The existing Bilibili integration shows the correct application boundary: the Electron main process owns login sessions and network access, the preload exposes narrow IPC methods, and React renders only non-sensitive data. Douyin remains separate from Bilibili cookie settings and from yt-dlp.

```text
Official Douyin login window
  -> persisted per-user Douyin session
  -> main-process favorites adapter
  -> videos.db local mirror
  -> narrow preload IPC
  -> Settings account panel and Videos favorites browser
```

The adapter is intentionally isolated so the endpoint transport can be revised if Douyin changes its authenticated web responses. It consumes only data already available to the user's official logged-in web session.

## Data model

The `videos.db` schema will gain these source-specific tables:

- `douyin_accounts`: account identity, session partition name, auth state, diagnostics, and sync timestamps.
- `douyin_favorite_folders`: remote folder identifiers, title, remote item count, synchronization state, and cursor.
- `douyin_favorite_items`: stable video metadata keyed by Douyin remote video ID.
- `douyin_folder_items`: many-to-many membership and folder order, allowing one favorite video to appear in more than one folder without duplication.

Future import to the existing video library maps an item to `source = 'douyin'`, `source_id`, `source_url`, and its folder as playlist metadata. That mapping is an extension point only and is not executed in this release.

## Atomic tasks

### Task 1 - Archive the plan

**Output:** This document.

**Acceptance:** The plan documents scope, session safety, schema ownership, task boundaries, and stop conditions.

**Verification:** `git diff --check`.

### Task 2 - Session and account-state foundation

**Files:** New pure Douyin session helpers and tests; `electron/main.ts`; `electron/preload.ts`.

**Output:** A per-user persisted Douyin session partition, official-login window entry point, logout, and non-sensitive auth status. No cookies are returned over IPC.

**Acceptance:** Partition naming is deterministic and user-isolated; cookie detection and status mapping are pure-testable; the preload exposes only the approved methods.

**Verification:** focused Node tests, `npm run lint`, and `npm run build`.

### Task 3 - Local mirror schema and favorites synchronization service

**Files:** `electron/db/schema.ts`, new Douyin types/normalizer/favorites service, fixtures, and tests.

**Output:** Idempotent tables and an adapter contract that normalizes folders/items, upserts pages transactionally, protects existing rows on failed sync, and reports safe diagnostics.

**Acceptance:** Fresh and existing databases migrate cleanly; duplicate pages do not duplicate data; a failed page cannot partially overwrite a prior successful mirror; expired/rate-limited/challenge states are distinguishable.

**Verification:** schema and service fixture tests, `npm run lint`, and `npm run build`.

### Task 4 - IPC-backed account settings and favorites browser

**Files:** `src/views/Settings.tsx`, `src/views/Videos.tsx`, focused view helpers/tests, and locale resources.

**Output:** Independent Douyin account controls, folder list, local favorite item browser, manual synchronization, and explicit empty/loading/error states.

**Acceptance:** No renderer-side authenticated fetch or SQL mutation is required for the feature; the UI never offers a download or remote-edit action; all strings are localized.

**Verification:** focused UI/helper tests, `npm run lint`, `npm run build`, and the full test suite.

### Task 5 - Final integration validation and handoff

**Output:** Full regression validation, review of staged changes, and a final implementation commit.

**Acceptance:** Existing video-download behavior remains unchanged; all automated checks pass; the final commit includes only files owned by this feature.

**Verification:** `npm test`, `npm run lint`, `npm run build`, and `git diff --check`.

## Stop conditions

Implementation stops at the integration boundary and reports the result if the official logged-in web session does not expose usable favorites data, if the data requires an interactive challenge that cannot be completed normally by the user, or if endpoint behavior cannot be made reliable without bypassing platform controls. In that case, local browsing and external-page opening remain possible, while automatic sync is left disabled.

## Commit policy

Each completed atomic task is committed only after its stated checks pass. Existing user changes are neither staged nor modified. This plan deliberately uses one commit per completed implementation task so failures can be isolated and reviewed.
