# Telegram Inline Mode

在任何 Telegram 聊天輸入 `@muismbot`，加上歌名或平台連結。Bot 不必加入該群組。

| 輸入 | 功能 |
| --- | --- |
| `@muismbot 床` | NetEase 與 Spotify 單曲搜尋，網易雲支援單字與繁簡搜尋詞 |
| `@muismbot album 瓦合` | 專輯搜尋 |
| `@muismbot artist 草東沒有派對` | 藝術家搜尋 |
| `@muismbot playlist 爵士` | 歌單搜尋 |
| `@muismbot spotify Radiohead` | Spotify 單曲搜尋 |
| `@muismbot spotify album OK Computer` | Spotify 專輯搜尋 |
| `@muismbot https://music.163.com/album?id=...` | 展開專輯曲目 |
| `@muismbot ytm https://music.youtube.com/watch?v=...` | 獨立 YTM 適配器解析 |

空查詢提供分類入口。搜尋結果末端也提供分類及來源切換；點選後在卡片上切換，再從 Inline 列表選取結果。專輯、歌單可查看曲目，藝術家可查看單曲／專輯；Spotify 藝術家以目前 API 支援的專輯展開。

已快取歌曲直接以 Telegram `file_id` 分享；新歌曲在選取後自動準備，原本那則 Inline 訊息直接變成可播放的音樂卡片，無需跳私聊或重新分享。輸入搜尋詞只搜尋資料，不啟動下載。

Telegram 的 Inline cached-audio 使用 MP3。Spotify／YTM 的非 MP3 原始音源另外生成 320 kbps MP3 播放版，清楚標示轉碼；原始 Vorbis／Opus／FLAC 檔保留原樣，透過卡片的「原始檔」另行獲取。網易雲普通下載仍發原始 FLAC，僅 Inline 播放需要 MP3 時生成獨立播放版。

「平台＋歌曲 ID＋原始音質」和「Telegram MP3 播放版」使用不同快取鍵，不混用原始檔與轉碼檔的 ID、大小和音質資料。同時請求同一歌曲只下載／上傳一次。首次上傳保存到私有快取頻道，完成後清除 VPS 音訊副本；後續重用 Telegram 檔案。卡片按發起人的 Bot 語言與網易雲字形偏好生成。首次網易雲字形選擇直接在原訊息進行，保存後沿用。

專輯、來源與音質資訊使用 `<blockquote expandable>` 富文本可展開區塊。Inline 回呼只編輯 `inline_message_id`。Telegram 回報的 `via_bot` 分享訊息會跳過普通文字搜尋及清理，不會刪除後再搜尋卡片內容。

## 啟用

BotFather `/setinline` → `@muismbot` → `搜尋歌曲、專輯、藝術家或貼上連結`。

BotFather `/setinlinefeedback` → `@muismbot` → **Enabled**。這是全部回報；`1/10`、`1/100`、`1/1000` 是抽樣，不能用來保證每次選取自動播放。服務接收 `inline_query`、`chosen_inline_result` 和 `callback_query`；尚未啟用 feedback 時，可用原卡片的「播放」按鈕重試。介面手動語言 > Telegram 語言 > English；只對網易雲中文名稱套用 TC／SC。每頁最多 10 個音樂結果，分頁僅涵蓋本次載入的結果。

建立私有 **MUISM Cache** 頻道，將 @muismbot 設為管理員並允許發佈訊息，在 VPS `.env` 填 `BOT_CACHE_CHAT_ID=-100...`，重新建立 Bot 容器。頻道只供 bot 上傳音訊，不需加入普通使用者。服務只保存檔案引用與元資料，不保存使用者卡片文字。

使用 `BOT_ALLOWED_USERS` 時，Inline 也遵守相同限制。回應為 `is_personal: true`、`cache_time: 0`，不共用使用者卡片設定；服務只共用兩分鐘內的平台原始搜尋資料；NetEase 縮圖縮至 160px，Inline 藝人補全最多等候 250ms。來源搜尋各有 4.5 秒上限，某來源失敗仍保留其他來源結果。整體查詢有 7 秒上限，較晚完成的舊查詢不覆蓋新查詢。

官方：[Inline Bots](https://core.telegram.org/bots/inline)、[InlineQueryResultCachedAudio](https://core.telegram.org/bots/api#inlinequeryresultcachedaudio)、[editMessageMedia](https://core.telegram.org/bots/api#editmessagemedia)。
