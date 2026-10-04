# ismusicnow · 音樂主義

獨立的音樂獲取工具：SvelteKit 網頁、Telegram bot、Node.js 佇列與 Python 下載適配器。貼上連結或搜尋，選擇歌曲，再保存原始音源。

網頁：[music.ism.tw](https://music.ism.tw) · Bot：[@ismusicnow_bot](https://t.me/ismusicnow_bot) · [憑證取得與設定](CREDENTIALS.md) · [部署紀錄](DEPLOYMENT.md)

## 來源

| 適配器 | 元資料 | 音訊 |
| --- | --- | --- |
| 網易雲 | 搜尋、單曲、專輯、歌單、歌詞 | 平台授權回傳的音源；原始／MP3／原生 FLAC，依帳號與曲目權限 |
| Spotify | 官方 API 搜尋、專輯、歌單；單曲可使用公開 oEmbed | Votify 直接取得 Spotify 音源，不以其他平台匹配，不轉碼 |
| YouTube Music | music.youtube.com 單曲／歌單連結 | 獨立 yt-dlp 適配器，保存 bestaudio 原始容器 |

Spotify「原始音源」代表來源確實為 Spotify，並保留取得的編碼。原始不等於無損：預設 `vorbis-high`，高品質及 FLAC 所需訂閱、裝置驗證與設定依 [Votify](https://github.com/glomatico/votify) 支援。介面顯示實際檔案編碼、位元率與無損狀態；不把其他音源或轉碼檔標成 Spotify 原始音質。

沒有可用憑證時，適配器會呈現待設定／明確錯誤。專輯與歌單最多解析 100 首，每次獲取最多 20 首；檔案最多 256 MB，保存 24 小時。服務重啟後中斷的任務會標成失敗，使用者可以重試。

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

網頁預設只綁定 `127.0.0.1:28500`。在 1Panel／OpenResty 建立獨立反向代理網站，指向 `http://127.0.0.1:28500`，並將 `.env` 的 `ORIGIN` 設為實際公開網址。啟用 HTTPS 後，瀏覽器貼上按鈕可讀取剪貼簿。若設定 `HTTP_AUTH_USER` 和 `HTTP_AUTH_PASSWORD`，網頁/API 會要求 Basic Auth。

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
pnpm check
pnpm test
pnpm build
pnpm start
# 另外一個終端：
pnpm bot
```

需要開發環境時自行執行 `pnpm dev`，預設 localhost。網頁與 bot 各自使用不同下載 namespace，網頁任務由 HttpOnly session cookie 隔離。歌曲來源與 ID 均由服務端重新解析；工具使用參數陣列啟動，不拼接 shell 指令。

## Telegram

Bot：[\@ismusicnow_bot](https://t.me/ismusicnow_bot)。直接貼音樂連結即可；支援 `/search`、`/spotify`、`/netease`、`/download`、`/lyric`、`/about`。`/start` 會說明使用方式。

`/settings`（或 `/setting`）設定 Album 顯示語言。首次獲取直接提供 **Original（保留原文）／轉為繁體中文／转为简体中文** 三個選項。選完自動繼續剛才的歌曲，後續獲取沿用每位用戶的偏好。繁簡轉換使用本機 OpenCC，無須另外申請翻譯 API。

偏好作用於 Telegram 音樂卡片的歌名、歌手、專輯與顯示檔名，不改動原始音訊或檔案內標籤。設定持久保存在 bot 的 `DATA_DIR/bot-users/`（Docker 主機為 `data/bot/bot-users/`），服務重啟後仍保留；群組按鈕只能由對應用戶修改自己的偏好。

音訊優先以 `sendAudio` 發送，包含專輯、封面縮圖、實測時長、編碼、大小、位元率、來源連結及回覆原訊息。FLAC 也嘗試原版的音樂卡片方式；若 Telegram 明確拒絕格式，保留相同原始檔以文件發送，不轉碼。Telegram 官方文件只保證 MP3／M4A 的音樂播放器支援，因此其他格式的卡片呈現仍取決於 Telegram。[Bot API](https://core.telegram.org/bots/api#sendaudio)

## 獨立與授權

這個版本重新建立前後端與部署結構，不依賴原專案執行期下載程式，不沿用原作者的服務地址或自動更新流程。保留原專案 [XiaoMengXinX/Music163bot-Go](https://github.com/XiaoMengXinX/Music163bot-Go) 的 GPL-3.0 授權，完整條文見 [LICENSE](LICENSE)。依賴工具保留各自授權。本專案不附帶擔保。僅獲取你有權使用的內容。

`main` 保存重寫版本，`v2` 保留原版歷史。2026-10-04 已離開原 GitHub fork 網路，成為獨立倉庫。
