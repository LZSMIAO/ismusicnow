# MUISM Bot recovery, client compatibility and large files

## Changes

- Rich search keeps a regular inline-keyboard fallback: “Can't tap? Use buttons”. Switching replaces the same message, keeps its page/filter/grouped results, and saves a per-user preference. The reverse switch remains available. Category changes, albums, artists and playlists inherit the preference. All eight interface languages are covered. Bot API User/Update has no client name or version, so automatic app-version detection is unavailable; a successful server rich-message request is not evidence of client support.
- Close is bound to the actor, chat and forum topic with a signed callback (under 64 bytes). It no longer requires the expiring in-memory search record. Existing bot-authored private menus and owner-mentioned legacy group menus are supported. Other users cannot close a menu. Closing while category/source resolution is pending cancels its replacement and prevents reopening.
- Remove the hard-coded 49 MB gate. Cloud transport accepts 50 MiB; local transport accepts 2000 MiB. Error messages interpolate the configured endpoint's limit in all eight languages. Cached Telegram file IDs bypass upload size checks.
- Multipart audio/document uploads use file-backed Node blobs instead of loading and copying entire files into the Bot's 1 GB container. Local uploads receive a 30-minute timeout. Bot download capacity follows the endpoint; the website's 256 MiB default stays intact.
- Optional Local Bot API is built from pinned official tdlib/telegram-bot-api commit `e3e9dd8e5b3d7ab8537cd5a10dc31d5ffa8f82d1`, with its pinned TDLib submodule. Compose publishes no API port. The application's credentials remain in ignored `.telegram-api.env` (600). Cloud logout must happen only after the server/image is ready; after cloud logout, returning to cloud has Telegram's 10-minute cooldown.

- NetEase private/deep-link/Inline acquisition now shares the original native audio reference. Legacy documents that were forced by the old Inline path are refreshed once, instead of serving their old MP3 derivative forever. A genuine native-audio rejection is recorded so retries reuse its independent playback copy. CachedAudio inline results remain MP3-only per Telegram; selecting a FLAC placeholder instead edits that same Inline message to original audio. Only a definitive Inline format rejection requests a playback derivative; network failures do not.
- Inline Album and artist buttons are bot browse deep links rather than inline share/search actions. Both routes load the matching collection; private-chat music cards keep their ordinary callback browsing.
- The expandable caption places a blank third preview line before Format/size/bitrate, keeping technical metadata below the collapsed quote preview.

## Validation before publication

- Bot/search/download tests: 94 tests; the existing pagination assertion was updated to locate the navigation callback because the accessibility switch adds a footer row. The recovery tests cover actor/chat/topic/bot signature boundaries, byte-size limits, streaming blobs, saved layout preference, real-handler switching, expired Close and Close during a category lookup.
- Bot TypeScript compilation passed using ES2022/ESNext and bundler resolution.
- Actual production Spring Rain / Spylent acquisition passed both download and private-cache upload: NetEase `2663919685`, native FLAC/audio, 23,321,364 bytes; Spotify `1l0otnoYnAYWBRVBpUsG41`, playable MP3/audio, 7,425,160 bytes. These were retested before this release, rather than inferred from a populated index.
- Cache channel configured correctly; bot is administrator and can post. Successful uploads populate the cache; a previously empty cache does not cause an upstream download failure.

## Deployment and review boundaries

Publish to main without a codex branch. Update Bot image only and preserve the concurrently deployed website image. Deployment checks and final local-server migration evidence are retained in the user-facing MUISM recovery audit and verification JSON. Do not claim a 2 GB upload was tested merely because the configured ceiling is 2000 MiB: verification uses an actual >50 MiB native audio upload, and boundary tests cover 2000 MiB.

## Primary sources

- [Bot API User](https://core.telegram.org/bots/api#user)
- [Cloud sendAudio](https://core.telegram.org/bots/api#sendaudio)
- [Local Bot API](https://core.telegram.org/bots/api#using-a-local-bot-api-server)
- [Official server build and migration](https://github.com/tdlib/telegram-bot-api)
- [Cloud logout cooldown](https://core.telegram.org/bots/api#logout)
