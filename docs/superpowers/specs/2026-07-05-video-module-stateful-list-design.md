# Video Module Stateful List Redesign

Date: 2026-07-05

## Goal

Redesign the video module around one stateful video list. The list becomes the single place for browsing videos, seeing download state, starting downloads, retrying failed downloads, tracking progress, playing downloaded videos, and opening details.

The separate download queue drawer will be removed. Download state belongs to each video item and is persisted in the video database record.

## Non-Goals

- Do not add a separate favorite system in this redesign.
- Do not keep a second download queue UI after video rows support progress and retry.
- Do not implement durable paused/resumable downloads in this phase.
- Do not allow editing the source URL. Source URLs are read-only and may be opened in the external browser.

## Terms

- Add to video list: Save parsed videos into the library without downloading them immediately.
- Download video: Save parsed videos and immediately create a download batch for the selected videos.
- Download batch: One user-triggered download operation. A batch may contain one video or many videos from a playlist or multipart source.
- Invalid video: A video whose source is confirmed unavailable or inaccessible because it was deleted, made private, removed, or otherwise invalidated. Ordinary network, cookie, tool, or transient download failures are not invalid videos.

## Video Status Model

Videos will use five statuses:

- `not_downloaded`: Saved in the video list but no local media file exists.
- `downloading`: A download is currently active for the video.
- `downloaded`: A local media file exists and can be played in the app.
- `download_failed`: The last download attempt failed and the user may retry.
- `invalid`: The source video is no longer available or should no longer support download/play actions.

Status behavior:

| Status | Row appearance | Row action | Right-side download icon | Details editing |
| --- | --- | --- | --- | --- |
| `not_downloaded` | Normal | Open details | Visible and enabled | Editable |
| `downloading` | Active/progress row | Open details | Hidden | Read-only |
| `downloaded` | Translucent light green | Open details and play local video | Hidden | Editable |
| `download_failed` | Red failure mark | Open details | Visible and enabled for retry | Editable |
| `invalid` | Darker gray/disabled | Open details or delete only | Hidden | Read-only |

On app startup, any persisted `downloading` records from a previous interrupted run will be converted to `download_failed` with a diagnostic message such as `Download was interrupted. Retry is available.` This is a deliberate simplification for the first version of the redesign.

## Data Model

Extend `videos` with stateful download fields:

- `status`: one of `not_downloaded`, `downloading`, `downloaded`, `download_failed`, `invalid`.
- `source_url`: original external video URL. Read-only in details.
- `local_path`: local downloaded media path, only valid for downloaded videos.
- `duration`: display duration label.
- `duration_seconds`: numeric duration where available.
- `download_progress`: number from 0 to 100, nullable.
- `download_error`: last download failure message, nullable.
- `invalid_reason`: reason the video is invalid, nullable.
- `download_batch_id`: latest download batch used for this video, nullable.
- `download_batch_order`: order inside the latest batch, nullable.
- `downloaded_at`: timestamp when the local file was successfully saved, nullable.
- `created_at` and `updated_at`: used for sorting and migration compatibility.

Add `video_download_batches`:

- `id`
- `batch_key`: stable readable batch identifier, for example `20260705-001`.
- `source_url`: URL that initiated the batch, nullable for single-row retry if unavailable.
- `source`: `bilibili`, `youtube`, `local`, or `other`.
- `title`: batch title derived from parse result or selected video.
- `item_count`: number of videos in the batch.
- `status`: aggregate batch state such as `downloading`, `completed`, `partial_failed`, `failed`.
- `created_at`
- `updated_at`

Batch rules:

- Clicking `Download video` after parsing creates one batch for all selected videos.
- Clicking a row download icon for one video creates a single-video batch.
- Retrying a failed video creates a new batch and updates the video to reference the latest batch.
- The current redesign stores only the latest batch reference on each video. Historical attempts are out of scope unless a future `video_download_attempts` table is added.

## Video List Layout

The center panel title becomes `Video List` / `视频列表`.

Each row shows:

- Play button or disabled play affordance, depending on status.
- Title.
- Source, duration, group path, and status badge.
- Tags.
- Download progress and progress bar when status is `downloading`.
- Failure message summary when status is `download_failed`.
- Invalid reason summary when status is `invalid`.
- Right-side download/retry icon only for `not_downloaded` and `download_failed`.
- Delete action for all statuses.

Row click always opens the details drawer. Row actions must stop propagation so play, download, external-open, and delete do not also open details unless intended.

Downloaded rows use a translucent light green background. Invalid rows use a darker gray disabled treatment. Failed rows use a restrained red marker rather than making the whole row aggressively red.

## Download Progress And Notifications

Download progress events update the corresponding video record:

- `status = downloading`
- `download_progress = current percent`
- optionally `download_error = NULL`

Download success updates:

- `status = downloaded`
- `download_progress = 100`
- `local_path`
- `downloaded_at`
- `download_error = NULL`

Download failure updates:

- `status = download_failed`
- `download_error`
- `download_progress` remains at last known percent or becomes `NULL` if no meaningful progress exists.

Invalid-source failures update:

- `status = invalid`
- `invalid_reason`
- `download_error` may also store the raw diagnostic.

User notifications:

- Success: show a toast naming the video and confirming download completion.
- Failure: show a toast naming the video and including the failure reason.
- Invalid: show a toast explaining the video is invalid/unavailable.

## Details Drawer

The details drawer remains, but the download queue tab is removed.

Details content:

- Status.
- Title.
- Source URL, read-only, with an external-browser open action.
- Duration.
- Group selector.
- Tag editor.
- Local file path for downloaded videos.
- Download error for failed videos.
- Invalid reason for invalid videos.
- Diagnostic message where useful.

Editing rules:

- `not_downloaded`, `downloaded`, and `download_failed`: title, group, and tags are editable.
- `downloading`: details are read-only.
- `invalid`: details are read-only.
- Source URL is always read-only.

After a successful details save, the drawer closes and shows a success toast. Failed saves keep the drawer open and show the failure reason.

## Parse Result Flow

After URL parsing, selected parsed items support three actions:

- Cancel: discard the parse result and save nothing.
- Add to video list: save selected items as `not_downloaded` and close the parse result.
- Download video: create a download batch, save selected items as `downloading`, start downloads, and close the parse result.

Multipart and playlist parse results keep bulk selection controls. Batch order is derived from the parsed item order or explicit part index.

## Sorting

The video list supports a sorting menu with these options:

- Default sort.
- Recently added.
- Recently downloaded.
- Download batch.
- Title.
- Duration.
- Status.
- Group.

Default sort is fixed and prioritizes active work:

1. `downloading`
2. `download_failed`
3. `not_downloaded`
4. `downloaded`
5. `invalid`

Within the same status:

1. Newer download batch first.
2. Batch order ascending within the same batch.
3. Newer created video first when there is no batch.

Sort direction applies to user-selected sortable fields such as title, duration, recently added, recently downloaded, download batch, status, and group. Default sort does not need a direction toggle in the first implementation.

## Error Classification

Failures should be classified before updating status:

- Network failures, missing tools, missing cookies, expired cookies, permission problems, ffmpeg failures, and generic yt-dlp errors become `download_failed`.
- Deleted/private/unavailable/invalid source responses become `invalid` only when the parser or downloader can identify them confidently.
- Ambiguous errors should prefer `download_failed` so the user can retry.

This avoids incorrectly marking videos invalid when the actual issue is environment or authentication.

## Migration

Migration must preserve existing user data.

Suggested mapping:

- Existing `downloaded` remains `downloaded`.
- Existing `downloading` becomes `download_failed` on startup or migration with an interrupted-download diagnostic.
- Existing `unclassified` becomes `not_downloaded`.
- Existing local `path` should be treated as `local_path` compatibility data.

The schema migration should be additive where possible. Existing groups, tags, source URLs, local paths, duration, and diagnostic messages must survive.

## Testing

Unit tests:

- Status-to-row-action mapping.
- Status-to-details-editability mapping.
- Default sort status ordering and batch ordering.
- Parse result actions: cancel, add to video list, download video.
- Download progress state updates.
- Failure classification into `download_failed` versus `invalid`.
- Startup conversion from stale `downloading` to `download_failed`.

Integration or smoke tests:

- Download success updates video status, path, progress, and toast event.
- Download failure updates video status, error message, and toast event.
- Retry failed video creates a new batch and re-enters `downloading`.
- Details save closes the drawer only after successful persistence.

Manual verification:

- Parse a Bilibili single video and add it to the video list without downloading.
- Parse a Bilibili multipart video and download selected parts as one batch.
- Parse a YouTube video and verify download progress appears inside the row.
- Force a download failure and confirm retry works from the row.
- Confirm invalid videos cannot play, download, or edit details, but can be opened for details and deleted.

## Implementation Notes

- Keep download execution in the Electron main process.
- Treat the database video record as the source of truth for list state.
- Use renderer memory state only as a temporary display accelerator while events are arriving.
- Avoid duplicate state sources between a queue drawer and list rows.
- Keep details drawer focused on details only.
- Keep URL opening in a safe main-process or preload-mediated API; do not navigate the Electron app frame directly to external video sites.

