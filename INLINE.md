# Telegram Inline Mode

在任何 Telegram 聊天輸入 `@muismbot`，加上歌名或平台連結。Bot 不必加入該群組。

| 輸入 | 功能 |
| --- | --- |
| `@muismbot 床` | 網易雲單曲搜尋，支援單字與繁簡搜尋詞 |
| `@muismbot album 瓦合` | 專輯搜尋 |
| `@muismbot artist 草東沒有派對` | 藝術家搜尋 |
| `@muismbot playlist 爵士` | 歌單搜尋 |
| `@muismbot spotify Radiohead` | Spotify 單曲搜尋 |
| `@muismbot spotify album OK Computer` | Spotify 專輯搜尋 |
| `@muismbot https://music.163.com/album?id=...` | 展開專輯曲目 |
| `@muismbot ytm https://music.youtube.com/watch?v=...` | 獨立 YTM 適配器解析 |

空查詢提供分類入口。搜尋結果末端也提供分類及來源切換；點選後在卡片上切換，再從 Inline 列表選取結果。專輯、歌單可查看曲目，藝術家可查看單曲／專輯；Spotify 藝術家以目前 API 支援的專輯展開。

已快取的 MP3 音訊與文件直接以 Telegram `file_id` 分享，按相同的「平台＋歌曲 ID＋音質」索引，無需重新下載或上傳。文件格式保持為文件，卡片文字使用發起人的 Bot 語言與網易雲中文字形偏好。Telegram 的原生 cached-audio 搜尋標題採用首次上傳的音訊標籤，卡片說明會重新生成。Telegram 的 cached-audio 僅支援 MP3；FLAC、其他音訊格式或未記錄編碼的舊快取會直接顯示音樂卡片，點「獲取歌曲」在私聊重用原始快取，不轉碼。這避免一筆不相容音訊使整頁搜尋被拒絕；既有卡片回呼也會提供私聊入口。對意外遭拒的 MP3 結果仍提供回退卡片。

未快取歌曲的「獲取歌曲」入口會開啟 Bot 私聊；首次網易雲獲取仍只選一次中文名稱字形。獲取完成後點「分享至聊天」，選擇目標聊天及歌曲即可分享。輸入搜尋字詞不會啟動下載。

專輯、來源與音質資訊使用 `<blockquote expandable>` 富文本可展開區塊。Inline 訊息沒有 `chat_id`；相關操作只編輯 `inline_message_id`，不套用群組訊息清理。

## 啟用

BotFather `/setinline` → `@muismbot` → `搜尋歌曲、專輯、藝術家或貼上連結`。

服務透過 `getMe.supports_inline_queries` 核對開關；不需要 `/setinlinefeedback`。輪詢接收 `inline_query` 和 `callback_query`。介面手動語言 > Telegram 語言 > English；只對網易雲中文名稱套用 TC／SC。每頁最多 10 個音樂結果，分頁僅涵蓋本次載入的結果。

使用 `BOT_ALLOWED_USERS` 時，Inline 也遵守相同限制。回應為 `is_personal: true`、`cache_time: 0`，不共用使用者卡片設定；服務只短暫共用平台原始搜尋資料。查詢有 7 秒上限，較晚完成的舊查詢不覆蓋新查詢。

官方：[Inline Bots](https://core.telegram.org/bots/inline)、[InlineQueryResultCachedAudio](https://core.telegram.org/bots/api#inlinequeryresultcachedaudio)、[editMessageMedia](https://core.telegram.org/bots/api#editmessagemedia)。
