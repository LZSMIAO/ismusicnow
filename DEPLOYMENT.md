# 部署紀錄

MUISM 品牌與 Telegram 視窗修正：網頁標題、頁首、播放器與指南統一 MUISM · 音樂主義，bot 選單改「開啟播放器」。Mini App 使用固定 WebView 殼層，搜尋框與播放器固定，曲目及指南內部捲動；空白頁不再因最低內容高度撐出整頁捲動條。

Telegram Mini App：bot 選單「ismusicnow」和 `/app` 直接開啟 https://music.ism.tw，支援安全區、動態視窗與原生返回鍵。API 驗證 Telegram initData 的 HMAC 與 24 小時時效，帳號下載佇列持久隔離；已下載音訊與原生保存使用限定用途的短效簽名連結（保存 10 分鐘、播放 1 小時），不依賴第三方 Cookie。Telegram 8.0+ 使用原生下載，較舊版本開啟同一短效連結。`BOT_WEB_APP_URL` 可改 HTTPS 入口，預設正式網址；主 Mini App 的 profile Open App 若需要可另外由 BotFather 開啟。

2026-10-04：網頁播放器移除本站固定 30 秒上限，使用音訊實際時長，真正播放結束才自動換曲；完整網易雲音源及同一 session 已下載檔案均可完整播放。Spotify 官方片段與網易雲試聽權限明確標示，無直接播放來源時提供完整音訊下載入口。線上 FLAC 驗證時長 4:05，播放至 1:36；55 項測試通過。

2026-10-04：正式網址維持 https://music.ism.tw。Cloudflare 新增已代理 CNAME mu → music.ism.tw；啟用「Music alias: mu → music」301 規則，只匹配 mu.ism.tw，目標 concat("https://music.ism.tw", http.request.uri.path)，保留查詢字串。已實際驗證 https://mu.ism.tw/guide?from=mu → https://music.ism.tw/guide?from=mu。

Bot 搜尋更新：網易雲／Spotify 的單曲、專輯、藝術家與歌單分類，網易雲藝術家熱門曲／專輯與 Spotify 藝術家專輯導航、返回上一層、五項緊湊列表與集中序號。設定原位更新，選中即關閉一次性面板，完成即清理進度；永久音樂卡片不引用將刪的請求，使用原生 Spoiler 隱藏附加資訊。群組維持收件人與話題；音訊、快取和其他用戶面板不受清理操作影響。

2026-10-04：Telegram 服務切換至 `@muismbot`。指令選單、群組命令範例、網頁入口及音樂卡片署名同步更新；程式以 `getMe` 的身分生成群組說明和卡片。輪詢進度、訊息清理與音訊快取依 bot ID 隔離。保留使用者語言和網易雲字形偏好；舊 bot 的待處理訊息不沿用。Telegram 檔案 ID 不能跨 bot 共用，新 bot 首次獲取後建立自己的快取。

2026-10-04 部署至既有 VPS，項目目錄 `/opt/ismusicnow`。

本次 bot 更新：加入跨用戶 Telegram `file_id` 音訊快取，按平台、歌曲 ID 與獲取音質分開；成功上傳後清除 VPS 音訊副本，多人同時索取共用一次下載。快取索引隨 `data/bot/telegram-media/` 備份，依 bot ID 隔離，重啟仍保留。卡片文字按各用戶偏好生成，音訊檔名及嵌入標籤保留來源原文。不需要中轉 channel；明確失效的 Telegram 識別碼會重新取得，網路、限流與收件人錯誤不重複上傳。

Bot 介面預設跟隨 Telegram 語言，手動選擇優先；無法匹配時使用 English；只有 `zh` 時使用簡中。`/start` 只放一個「目前語言 ｜ 切換語言」按鈕，點開才展開八種語言。網易雲名稱字形只需首次選一次，之後透過 `/settings` 修改；新音樂卡片移除設定按鈕。33 項測試及 TypeScript 檢查通過，涵蓋共用快取、重啟、音質及 bot 隔離、失效索引更新、原始音訊／文件類型、用戶語言及卡片字形。Spotify cookies 匯出步驟見 [CREDENTIALS.md](CREDENTIALS.md)。

| 入口／服務 | 配置 |
| --- | --- |
| 網頁 | https://music.ism.tw |
| Telegram | https://t.me/muismbot |
| 原 profile 頁 | https://gitmusicpage.ism.tw |
| Web 反向代理 | 1Panel / OpenResty → `http://127.0.0.1:28500` |
| Web 與 bot | Docker Compose，bot 使用 long polling |
| HTTPS | Let's Encrypt，HTTP 驗證及自動續期已啟用 |
| 執行期檔案 | `data/web`、`data/bot`、`secrets/`、`.env` |

## 已驗證與待設定

- TypeScript / Svelte 檢查、下載佇列、來源隔離與 bot 命令回歸測試、production build 通過。
- VPS web / bot 容器啟動；Telegram 身份驗證成功，啟動 long polling。
- 公網 HTTPS 可載入網頁，網易雲搜尋與單曲元資料可正常解析。
- 網易雲 `MUSIC_U` 已載入容器且登入成功；`Minecraft`（4010201）完成原生 FLAC 下載，11.8 MB、16 bit／44.1 kHz。原 `晴天` 範例（186016）仍回傳無音源（404），已換掉範例。
- bot 恢復 `/netease 歌名／ID／連結`，關鍵詞直接獲取首個搜尋結果；`/music`、`/musicid` 使用相同流程，`/search` 保留選曲列表。`/lyric` 接受歌名、ID、連結；`/start ID` 恢復單曲獲取。
- `/settings` 已分成兩項獨立偏好：Bot 介面語言（繁中、簡中、English、日本語、한국어、Español、Français、Русский）及網易雲中文名稱字形（Original／TC／SC）。只有首次網易雲獲取才選字形，Spotify／YTM 保留來源原名並直接獲取。提示、按鈕、指令、卡片欄位及錯誤按用戶語言顯示；私聊命令選單隨選擇更新。設定持久保存並兼容舊偏好；群組按鈕校驗用戶身分，介面語言切換不消耗等待中的歌曲。OpenCC 本機轉換，不需要翻譯 API，原始音訊及嵌入標籤保持不變。
- 音訊改為優先 `sendAudio`，包含封面、實測時長、專輯、原訊息回覆及來源按鈕。FLAC 不再直接按副檔名發送為文件；Telegram 明確拒絕格式時才用相同原檔回退。26 項測試與 TypeScript 檢查通過；測試覆蓋重啟後續傳、用戶隔離、繁簡轉換、非網易雲略過字形設定、八語介面與上傳資料。Docker 部署另執行 production build。VPS 實測「床」完成卡片資料處理：232 秒、20,364 bytes JPEG 封面，繁體歌手名「草東沒有派對」、專輯「瓦合」；正式命令選單包含 settings。用戶截圖已顯示 FLAC 音樂卡片、封面、時長、專輯及回覆。
- VPS 使用正式 bot 的命令解析函數實測：「床」找到草東沒有派對（2035279723），完成原生 FLAC 下載，27,486,620 bytes、16 bit／48 kHz；「人是猫」找到張卡斯／洛天依（3395708493）。Telegram `getMyCommands` 已確認正式選單包含關鍵詞、歌曲 ID、連結的說明。此驗證涵蓋命令解析及下載，沒有主動發送測試訊息。
- Spotify 尚需 API 憑證與 cookies，原始音源下載尚未完成實際驗證。
- YTM 工具已安裝；VPS 測試遭遇「登入以確認不是機器人」，仍需 YTM cookies 後驗證實際下載。

依 [CREDENTIALS.md](CREDENTIALS.md) 設定帳號後，再完成實際下載驗證。服務可用及元資料解析成功不代表歌曲下載已全部驗證。

## 維護

```sh
cd /opt/ismusicnow
docker compose ps
docker compose logs --tail=30 web bot
# 修改環境設定後
docker compose up -d --force-recreate
# 更新程式後
docker compose up -d --build
```

備份 `.env`、`secrets/` 和 `data/` 至私人位置。原始碼更新不要覆蓋這些內容。

`main` 是重寫版本，`v2` 保留原版。2026-10-04 已解除 GitHub fork 關係，成為獨立倉庫；完整 Git 歷史已先備份。不推送 codex 分支。
