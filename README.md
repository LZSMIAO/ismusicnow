# MUISM · 音樂主義

獨立的音樂獲取工具：SvelteKit 網頁、Telegram bot、Node.js 佇列與 Python 下載適配器。貼上連結或搜尋，選擇歌曲，再保存原始音源。

網頁：[music.ism.tw](https://music.ism.tw) · Bot：[@muismbot](https://t.me/muismbot) · [憑證取得與設定](CREDENTIALS.md) · [部署紀錄](DEPLOYMENT.md)

## 來源

| 適配器 | 元資料 | 音訊 |
| --- | --- | --- |
| 網易雲 | 分類搜尋、單曲、專輯、藝術家、歌單、歌詞 | 平台授權回傳的音源；原始／MP3／原生 FLAC，依帳號與曲目權限 |
| Spotify | 官方 API 分類搜尋、專輯、藝術家、歌單；單曲可使用公開 oEmbed | Votify 直接取得 Spotify 音源，不以其他平台匹配，不轉碼 |
| YouTube Music | music.youtube.com 單曲／歌單連結 | 獨立 yt-dlp 適配器，保存 bestaudio 原始容器 |

Spotify「原始音源」代表來源確實為 Spotify，並保留取得的編碼。原始不等於無損：預設 `vorbis-high`，高品質及 FLAC 所需訂閱、裝置驗證與設定依 [Votify](https://github.com/glomatico/votify) 支援。介面顯示實際檔案編碼、位元率與無損狀態；不把其他音源或轉碼檔標成 Spotify 原始音質。

沒有可用憑證時，適配器會呈現待設定／明確錯誤。專輯與歌單最多解析 100 首，每次獲取最多 20 首；檔案最多 256 MB，保存 24 小時。服務重啟後中斷的任務會標成失敗，使用者可以重試。

## 網頁交互

黑色與冰銀的音樂工作區：統一搜尋框、平台來源選單、專輯曲目、歌曲預覽與底部播放器。預設只勾選第一首，試聽不改變下載選擇。搜尋結果中的專輯入口來自平台回傳的專輯 ID，不以名稱猜測。

「所有來源」合併網易雲與已配置的 Spotify 關鍵字結果；單一來源失敗不隱藏其他成功結果。YTM 保持連結獲取，尚未提供關鍵字搜尋。連結會自動辨識來源。

試聽使用平台回傳的音訊 URL，或同一使用者已完成的下載，不限制播放時長，完整音源播放至實際結束；平台只提供片段時明確標示；沒有可用片段時顯示原因及原平台入口。完整下載仍獨立檢查音訊長度與權限。佇列不遮暗主頁，來源選單支援方向鍵、Home／End、Escape 及焦點返回；動畫遵循減少動態效果偏好。

## Docker 部署

```sh
cp .env.example .env
chmod 600 .env
mkdir -p data/web data/bot secrets
sudo chown -R 1000:1000 data
chmod 700 data/web data/bot
sudo chown root:1000 secrets
sudo chmod 750 secrets
# 上傳 cookies 後：sudo chown root:1000 secrets/*.txt && sudo chmod 640 secrets/*.txt
# 編輯 .env：BOT_TOKEN、ORIGIN，以及需要的來源憑證。
docker compose up -d --build
docker compose ps
docker compose logs --tail=30 bot
```

網頁預設只綁定 `127.0.0.1:28500`。在 1Panel／OpenResty 建立獨立反向代理網站，指向 `http://127.0.0.1:28500`，並將 `.env` 的 `ORIGIN` 設為實際公開網址。搜尋框接受貼上完整音樂連結。若設定 `HTTP_AUTH_USER` 和 `HTTP_AUTH_PASSWORD`，網頁/API 會要求 Basic Auth。

Bot 使用 long polling，不需要開放 Telegram webhook 埠；如果已有 webhook，它會停止啟動並提示檢查，避免覆蓋現有部署。可用 `BOT_ALLOWED_USERS` 指定允許的 Telegram user ID；留空為公開 bot。Telegram 傳送上限採 49 MB，較大音訊請使用網頁端。

Spotify 登入 cookies 使用 Netscape cookies.txt 格式，放在 `secrets/spotify-cookies.txt`；Compose 以唯讀方式掛載。搜尋與集合元資料需要 `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET`，部分歌單需要有權限的 `SPOTIFY_ACCESS_TOKEN`。AAC／FLAC 的 Votify 配置可掛載在 `secrets/` 並使用容器內絕對路徑設定 `VOTIFY_CONFIG_PATH`。YTM 可選 `YTM_COOKIES_PATH=/app/secrets/ytm-cookies.txt`。

更新 `.env` 後執行 `docker compose up -d --force-recreate`；更新程式使用 `docker compose up -d --build`。`data/` 保存下載與 bot 游標，`secrets/` 保存來源登入。備份時一併保存，勿公開這些目錄。原始碼包、Git 及 Docker build context 均排除真實憑證。

## 本機

Node.js 22.17+、pnpm 10、Python 3、FFmpeg。

```sh
pnpm install --frozen-lockfile
cp .env.example .env
python3 -m venv .venv
.venv/bin/pip install 'votify[librespot]==1.9.9' yt-dlp
.venv/bin/pip install --no-deps --force-reinstall 'https://github.com/kokarare1212/librespot-python/archive/683d9e76f91ba7ae03919494dac8d899ca505651.zip'
source .venv/bin/activate
chmod +x scripts/votify-session.py
# 本機 .env 使用 VOTIFY_BIN=scripts/votify-session.py
pnpm check
pnpm test
pnpm build
pnpm start
# 另外一個終端：
pnpm bot
```

需要開發環境時自行執行 `pnpm dev`，預設 localhost。網頁與 bot 各自使用不同下載 namespace，網頁任務由 HttpOnly session cookie 隔離。歌曲來源與 ID 均由服務端重新解析；工具使用參數陣列啟動，不拼接 shell 指令。

## Telegram

Bot：[\@muismbot](https://t.me/muismbot)。私聊可直接發送歌名、歌手名或音樂連結；關鍵字預設合併 NetEase 與 Spotify 候選歌曲，各項標明來源，點選或發送序號獲取。群組普通聊天不觸發搜尋；使用指定 bot 的命令或回覆 bot。收到音樂連結或 `@muismbot 關鍵字` 時也會識別，但 Telegram 隱私模式會限制是否收到這些消息。支援 `/search`、`/spotify`、`/netease`、`/download`、`/lyric`、`/about`。`/start` 說明使用方式，只放一個「目前語言 ｜ 切換語言」按鈕，點開後才展開八種語言。Bot 預設跟隨 Telegram 回報的用戶語言，手動選擇優先；未匹配／首次未提供語言時使用 English。中文先看 Hant／Hans，再看 TW／HK／MO 或 CN／SG，只有 `zh` 時用簡中；非中文按主要語言匹配，地區變體沿用同一介面語言。沒有新語言碼時沿用上次 Telegram 回報的語言；手動設定始終優先。私聊命令選單和群組內每位成員的命令選單跟隨同一判定；群組使用 `chat_member` 範圍，改語言不會改全群的選單。私聊的播放器入口也按用戶語言設定，未識別的全域預設使用 English。

搜尋和專輯／歌單選曲每頁 5 個結果，顯示歌曲、歌手、專輯與時長，支援翻頁和全局序號。只有目前自己的列表接受短序號；沒有列表時提示重新搜尋，歌曲 ID 可明確使用 `/netease ID`。列表按用戶、聊天、話題和訊息綁定，30 分鐘後失效；重啟後重新搜尋。連結單曲直接獲取，專輯／歌單可逐首點選，搜尋列表在成功後清理。網易雲和 Spotify 的合集最多載入 100 首，YTM 最多 100 項；顯示實際載入數，不把單頁結果當完整合集。`/netease` 保留「關鍵字獲取首個結果」行為；`/search`、`/music` 相容別名和直接發送關鍵字提供跨來源候選選擇。

群組使用方式：

- `/search@muismbot 草東沒有派對`：搜尋候選歌曲。
- `/netease@muismbot 床`：保留原指令行為，獲取第一個匹配；ID 或音樂連結也可作參數。
- 點選自己的選曲按鈕，或**回覆自己的列表**輸入 `1`、`2` 等序號；群組直接發數字不觸發獲取。
- `/settings@muismbot`：設定自己的 Bot 語言和網易雲中文名稱字形。
- 普通群組、超級群組和論壇話題沿用同一流程；提示、設定、歌詞和音樂留在請求所在話題。首次字形選擇後，待處理歌曲會回原話題。

隱私模式開啟時，優先使用 `/命令@muismbot` 或回覆 bot；純連結／普通 @提及可能不會送達。Bot 是群組管理員或已關閉隱私模式時，可收到更多群組消息，但仍忽略普通聊天。匿名管理員／頻道身分無法對應個人偏好，目前不接受此類請求，請用個人身分。[Telegram 群組收訊規則](https://core.telegram.org/bots/faq#what-messages-will-my-bot-get)

搜尋面板每頁五項，用兩行呈現標題與藝術家／專輯／時長，下方只放序號按鈕；分類、翻頁、返回上一層與關閉直接更新同一面板。專輯和藝術家清單可繼續選歌。單獨的 `@bot` 開啟說明，不再把 `@` 送進歌曲搜尋。面板成功建立後立即清除已接收的用戶請求；選中單曲時立刻關閉一次性搜尋面板，設定直接原位更新，首次中文字形確認後立刻關閉提示並繼續獲取。音樂／歌詞卡片不引用即將刪除的訊息；群組使用收件人與話題定位。進度完成即刪；錯誤保留閱讀時間，閒置選曲／設定面板 30 分鐘後清理。暫時刪除失敗會寫入按 bot ID 隔離的清理佇列，再按退避重試；權限不足不影響音樂交付。

網易雲與 Spotify 支援「單曲／專輯／藝術家／歌單」分類搜尋；直接發送關鍵字預設單曲，面板上切換分類。`/album`、`/artist`、`/playlist` 合併 NetEase 與 Spotify 對應類型；參數前加 `netease` 或 `spotify` 可指定來源。專輯顯示藝術家、年份和曲數，歌單顯示建立者與曲數；網易雲藝術家可進入熱門單曲或專輯，再開啟專輯選歌；Spotify 藝術家直接進入專輯作品清單，遵循 [2026 年開發模式端點變更](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide)。NetEase／Spotify 藝術家完整連結及 Spotify URI 均可解析；網易雲熱門曲是平台提供的清單，不代表完整作品目錄。Spotify 關鍵字與合集需要 API 配置，原始音源下載另外需要登入 cookies；YTM 維持歌曲／歌單連結獲取。

`/settings`（或 `/setting`）提供兩項獨立設定：

- **Bot 介面語言**：繁中、簡中、English、日本語、한국어、Español、Français、Русский。用於 Bot 指令說明、按鈕、提示、卡片欄位標籤和錯誤訊息；私聊命令選單跟隨使用者選擇。歌曲、歌手、專輯與檔名保留各自來源／名稱字形偏好，不隨介面語言翻譯。
- **網易雲中文名稱字形**：Original（中文保留原樣）／中文統一繁體（TC）／中文统一简体（SC）。只有首次獲取網易雲歌曲才提示選擇，選完自動繼續剛才的歌曲；Spotify、YTM 直接獲取，名稱保留來源原文。只統一網易雲中文部分；英文、日文、韓文等名稱保留原文。繁簡轉換使用本機 OpenCC，無須另外申請翻譯 API。

網易雲名稱字形偏好作用於 Telegram 音樂卡片的中文歌名、中文歌手名與中文專輯名。共用快取的音訊檔名、原始音訊及檔案內標籤保留來源原文。兩項設定分別按用戶持久保存在 bot 的 `DATA_DIR/bot-users/`（Docker 主機為 `data/bot/bot-users/`），服務重啟後仍保留；群組按鈕只能由對應用戶修改自己的偏好。舊版已選的名稱字形偏好繼續沿用於網易雲。網易雲藝人語言線索與原生別名會用來保護日文漢字姓名；缺乏語言標記的純漢字名稱仍可能有歧義。

Bot 使用跨用戶 Telegram `file_id` 快取，按平台、歌曲 ID 和獲取音質區分；Spotify 自訂配置變更也會區分快取。第一次成功上傳後保存實際音訊／文件類型與音質資料，立即清除 VPS 音訊副本；命中直接重用 Telegram 檔案，不再下載或上傳。多人同時索取共用一次下載和首次上傳。卡片文字仍按每位收件人的介面語言及網易雲字形設定生成，卡片提供專輯／藝術家導航與來源連結；專輯、來源、音質和署名使用富文本可展開引用區塊，設定透過 `/settings` 進入。

索引保存在 `DATA_DIR/telegram-media/<bot-id>/`，跨重啟保留，不需要中轉 channel。Telegram 明確拒絕失效識別碼時重新獲取；網路、限流或收件人錯誤不觸發重複上傳。啟用前的檔案未保存 `file_id`，首次再獲取會建立快取。此快取僅用於 bot，網頁端仍使用原有下載流程。[Telegram 檔案重用](https://core.telegram.org/bots/api#sending-files)

音訊優先以 `sendAudio` 發送，包含專輯、封面縮圖、實測時長、編碼、大小、位元率、來源連結；群組卡片標明收件人並留在原話題。FLAC 也嘗試原版的音樂卡片方式；若 Telegram 明確拒絕格式，保留相同原始檔以文件發送，不轉碼。Telegram 官方文件只保證 MP3／M4A 的音樂播放器支援，因此其他格式的卡片呈現仍取決於 Telegram。[Bot API](https://core.telegram.org/bots/api#sendaudio)

## 獨立與授權

這個版本重新建立前後端與部署結構，不依賴原專案執行期下載程式，不沿用原作者的服務地址或自動更新流程。保留原專案 [XiaoMengXinX/Music163bot-Go](https://github.com/XiaoMengXinX/Music163bot-Go) 的 GPL-3.0 授權，完整條文見 [LICENSE](LICENSE)。依賴工具保留各自授權。本專案不附帶擔保。僅獲取你有權使用的內容。

`main` 保存重寫版本，`v2` 保留原版歷史。2026-10-04 已離開原 GitHub fork 網路，成為獨立倉庫。

## Inline 分享

任何聊天輸入 `@muismbot 關鍵字或連結`。預設跨來源搜尋，支援單曲、專輯、藝術家、歌單分類；平台前綴可指定來源。已快取 MP3 直接播放；首次選取在原訊息自動準備並轉為播放器。非 MP3 原始音源另做清楚標示的 MP3 播放版，原始檔另行獲取。需配置私有快取頻道並啟用全部 Inline feedback。詳見 [INLINE.md](INLINE.md)。
