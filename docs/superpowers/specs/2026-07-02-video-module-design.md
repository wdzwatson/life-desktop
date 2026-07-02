# Video Module Design

Date: 2026-07-02

## Goal

Improve the video module from a mock downloader into a local video library that supports grouping, tagging, reliable URL parsing, authenticated Bilibili downloads, and real playback of downloaded files.

The module will use a library-first layout: groups and tags on the left, the video library in the center, and selected-video details, metadata editing, download queue, and diagnostics on the right.

## Current State

- `src/views/Videos.tsx` renders a video library UI, parse dialog, queue panel, and fullscreen player shell.
- `electron/main.ts` currently mocks `video:parseUrl` and `video:download`.
- `electron/db/schema.ts` has a single `videos` table with basic fields only.
- Playback is a placeholder canvas-like area and does not load a local video file into a real `<video>` element.

## Verified Parser Findings

Temporary validation used `yt-dlp 2025.10.14` against user-provided URLs.

- YouTube URL parsed successfully as `Youtube`, with title `Adele - Someone Like You (Official Music Video)`, duration `4:45`, and Mix playlist `RDhLQl3WQQoQ0`; the first 10 playlist items were returned.
- Bilibili multipart URL parsed successfully in flat-playlist mode, returning `BV15j2LBDEyv` entries for `p=1` through `p=10`.
- Bilibili full metadata requests for the provided single video and multipart single-part URL returned `HTTP Error 412: Precondition Failed`. This must be treated as a normal diagnostic path, usually requiring cookies, browser impersonation support, version updates, or other site-specific mitigation.

These findings support using `yt-dlp` as the primary engine, but only with a reliability and diagnostics layer instead of direct UI-to-raw-JSON coupling.

## Layout

The video screen will use a three-column library layout.

Left navigation:

- Built-in filters: All, Uncategorized, Downloaded, Downloading.
- User groups: create, rename, delete, and filter by group.
- Tags: filter by one or more tags, with counts.

Center library:

- URL parser input at the top.
- Search and source/status filters.
- Video cards or dense rows showing title, source, duration, group, tags, download status, and play/download actions.
- Parsed playlists and multipart videos open a multi-select result dialog before import or download.

Right details panel:

- Selected video metadata and thumbnail.
- Group selector.
- Tag editor.
- Download quality selector and action.
- Queue progress.
- Last parse/download diagnostic message.

Playback:

- A downloaded video opens in a fullscreen or large overlay player using a real `<video>` element.
- The player loads only local file URLs exposed through a safe main-process IPC.
- Undownloaded videos show download actions rather than a fake player.
- Playback speed is applied to the video element.

## Parsing And Downloading

Main-process IPC will replace the mock handlers with real services:

- `video:checkTools`: detect `yt-dlp`, `ffmpeg`, versions, and configured paths.
- `video:parseUrl`: run `yt-dlp` metadata extraction and return a normalized parse result.
- `video:download`: run `yt-dlp` download with progress events and save the resulting local file path.
- `video:getPlaybackUrl`: return a safe local playback URL for a downloaded file.

`yt-dlp` metadata behavior:

- Use full JSON extraction for normal single videos and playlists.
- Use flat playlist extraction as a fallback for Bilibili multipart and playlist preview when full metadata is blocked.
- Normalize raw entries into stable app data before the renderer sees them.

Download behavior:

- Use the user's quality preference.
- Prefer formats that produce Electron-playable media.
- Use `ffmpeg` when needed to merge separate audio and video streams.
- Store downloads under the app video directory.
- Update database records with local path, status, selected quality, and diagnostic messages.

## Bilibili Authentication

The app will support authenticated Bilibili parsing and downloading without storing account passwords.

Supported credential modes:

- Browser cookies via `yt-dlp --cookies-from-browser`, with browser choices such as Chrome, Safari, Firefox, Edge, Brave, and Chromium where supported by the installed `yt-dlp`.
- Imported Netscape-format `cookies.txt` via `yt-dlp --cookies`.

The app will not collect or store Bilibili username/password. Login, CAPTCHA, QR-code, and two-factor flows remain in the user's browser.

Diagnostics:

- Show whether cookies are configured.
- Test authentication by parsing a user-provided or recent Bilibili URL.
- Display whether the highest available quality appears gated by login or membership.
- Surface errors such as HTTP 412, login required, cookies expired, missing ffmpeg, outdated yt-dlp, or unsupported format.

Authorization boundary:

- The app may use the user's logged-in Bilibili session to access content and quality levels already authorized for that account.
- The app will not attempt to bypass authorization, membership checks, DRM, or other access controls.

## Data Model

Extend `videos`:

- `group_id`
- `source_id`
- `source_url`
- `playlist_id`
- `playlist_title`
- `part_index`
- `thumbnail_url`
- `local_path`
- `selected_quality`
- `parse_status`
- `diagnostic_message`

Add `video_groups`:

- `id`
- `name`
- `sort_order`
- `created_at`
- `updated_at`

Add `video_tags`:

- `id`
- `name`
- `color`
- `created_at`
- `updated_at`

Add `video_tag_links`:

- `video_id`
- `tag_id`
- Unique pair constraint.

Settings additions:

- `ytDlpPath`
- `ffmpegPath`
- `cookieMode`
- `cookieBrowser`
- `cookiesPath`
- `qualityPreference`

Migration rules:

- Existing videos remain valid and are assigned to Uncategorized when `group_id` is empty.
- Existing `path` can be migrated or treated as `local_path` compatibility data.
- Schema changes must be additive and preserve user data.

## Normalized Parse Result

Renderer-facing parse results will use a stable app shape:

- `kind`: `single` or `playlist`
- `source`: `bilibili`, `youtube`, or `other`
- `title`
- `sourceUrl`
- `sourceId`
- `playlistId`
- `playlistTitle`
- `items`
- `diagnostics`

Each item includes:

- `id`
- `title`
- `sourceUrl`
- `sourceId`
- `durationSeconds`
- `durationLabel`
- `thumbnailUrl`
- `partIndex`
- `playlistId`
- `extractor`
- `requiresAuth`

## Error Handling

Common errors will map to user-facing diagnostics:

- Tool missing: prompt for `yt-dlp` or `ffmpeg` path.
- Bilibili HTTP 412: suggest cookies or updated tooling, and attempt flat playlist fallback where useful.
- Login required: prompt for browser cookies or cookies file.
- Cookies expired: prompt re-login in browser or refresh cookies file.
- Unsupported/private/deleted video: show the site message when available.
- Download finished but file missing: mark as failed and keep diagnostic logs.
- Playback file unavailable: offer reveal/download again rather than opening a blank player.

## Testing

Unit tests:

- Normalize YouTube single and playlist JSON samples.
- Normalize Bilibili single, multipart, and flat playlist JSON samples.
- Map Bilibili HTTP 412 and login-required failures to actionable diagnostics.
- Build `yt-dlp` argument lists for anonymous, browser-cookie, and cookies-file modes.
- Build quality/format arguments with and without `ffmpeg`.

Manual verification:

- Use the provided Bilibili single-video URL to verify HTTP 412 handling and authenticated retry.
- Use the provided Bilibili multipart URL to verify playlist preview and selected-part import.
- Use the provided YouTube URL to verify current-video and playlist parsing.
- Download a short accessible video, confirm the database local path, open it in the player, and verify playback speed control.

## Implementation Notes

- Keep `yt-dlp` execution in Electron main process only.
- Do not expose shell execution to the renderer.
- Use structured IPC payloads rather than passing arbitrary command strings.
- Store raw `yt-dlp` logs only as diagnostics and avoid displaying excessive raw output.
- Keep UI states explicit: unparsed, parsed, queued, downloading, downloaded, failed.
- Keep the current app visual language, but move from the existing two-column mock layout to the approved three-column library layout.

## Out Of Scope

- In-app Bilibili username/password login.
- DRM or authorization bypass.
- Cloud sync for video metadata or downloaded files.
- Subtitle extraction/search beyond preserving the existing placeholder behavior unless the downloaded metadata includes subtitle files naturally.
