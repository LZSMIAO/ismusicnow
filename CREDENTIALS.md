# API 與帳號設定

此 VPS 的項目目錄是 `/opt/ismusicnow`。環境變數填到 `/opt/ismusicnow/.env`；登入檔案上傳到 `/opt/ismusicnow/secrets/`。透過 1Panel「主機 → 文件」開啟這個目錄，使用文件編輯器修改 `.env`。保留現有的 `BOT_TOKEN`、`ORIGIN` 和工具路徑，不要用範例檔覆蓋現有設定。

| 用途 | 取得內容 | 填寫位置 |
| --- | --- | --- |
| Telegram bot | BotFather 的 bot token（已配置） | `.env` 的 `BOT_TOKEN` |
| Spotify 搜尋、專輯、歌單資料 | Developer Dashboard 的 Client ID / Client Secret | `.env` 的 `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` |
| Spotify 原始音源 | 自己登入帳號的 Netscape cookies.txt | `secrets/spotify-cookies.txt` |
| 網易雲帳號音源 | 自己帳號的 MUSIC_U 或完整 cookie | `.env` 的 `MUSIC_U` 或 `NETEASE_COOKIE` |
| YTM 公開連結 | 不需要 API key | 預設可不填 cookies |
| YTM 需登入內容 | 自己登入帳號的 Netscape cookies.txt | `secrets/ytm-cookies.txt`，另填 `YTM_COOKIES_PATH` |

## Spotify API

1. 開啟 [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)，用自己的 Spotify 帳號登入。
2. 點「Create app」，名稱填 `ismusicnow`，描述填音樂收藏工具，選擇 Web API。若表單要求 Redirect URI，可填 `http://127.0.0.1:3000`；目前程式的 Client Credentials 流程不使用回呼。這個值不代表網站已有 OAuth 回呼功能。
3. 建立後開啟 App → Settings，取得 Client ID 與 View client secret 中的 Client Secret。
4. 在 VPS `.env` 填：

```dotenv
SPOTIFY_CLIENT_ID=你的ClientID
SPOTIFY_CLIENT_SECRET=你的ClientSecret
SPOTIFY_ACCESS_TOKEN=
```

程式會自行申請及更新 Client Credentials access token，通常不用手填 `SPOTIFY_ACCESS_TOKEN`。需要讀取個人歌單時，使用官方 [Authorization Code 流程](https://developer.spotify.com/documentation/web-api/tutorials/code-flow) 取得具有相應歌單讀取 scope 的使用者 token，再填 `SPOTIFY_ACCESS_TOKEN`。這一版尚未提供 OAuth 登入與使用者 token 自動刷新；手填 token 過期後需更新。

目前新建開發模式 App 的擁有者需要 Premium；最多支援 5 個已加入 allowlist 的已授權 Spotify 使用者，並受開發模式端點及配額限制。請以 [官方配額文件](https://developer.spotify.com/documentation/web-api/concepts/quota-modes) 與你的 Dashboard 顯示為準。建立 App 只提供元資料 API 存取，沒有可直接填入本項目的官方歌曲下載 API key。[官方入門文件](https://developer.spotify.com/documentation/web-api/tutorials/getting-started)

## Spotify 原始音源 cookies

登入自己的 Spotify 網頁帳號，依 [Votify 設定說明](https://github.com/glomatico/votify#-prerequisites) 將 Spotify 網站 cookies 匯出為 Netscape cookies.txt，再使用 1Panel 上傳到 `/opt/ismusicnow/secrets/spotify-cookies.txt`。只匯出 Spotify 網站的 cookies。

`.env` 使用容器內路徑：

```dotenv
SPOTIFY_COOKIES_PATH=/app/secrets/spotify-cookies.txt
SPOTIFY_AUDIO_QUALITY=vorbis-high
VOTIFY_CONFIG_PATH=
```

Docker 已安裝 Votify 的 librespot 適配。先使用 `vorbis-high` 做下載驗證。不同帳號、訂閱、地區與平台限制會影響結果；設定存在不代表已成功下載。AAC / FLAC 另有工具與裝置設定，依 Votify 文件配置後再使用 `VOTIFY_CONFIG_PATH=/app/secrets/votify-config.ini`。不要把改副檔名或轉碼當成原始無損；頁面依實際檔案顯示編碼與音質。

## 網易雲

內置 SDK 已處理 API 請求，無須申請 Client ID 或購買第三方 API。登入 [網易雲網頁](https://music.163.com)，在瀏覽器開發者工具的 Application／Storage → Cookies → `https://music.163.com` 中找到自己的 `MUSIC_U`。複製 Value，直接填到 VPS `.env`：

```dotenv
MUSIC_U=你的MUSIC_U值
NETEASE_COOKIE=
NETEASE_API_URL=
```

也可將自己登入請求中的完整 Cookie 字串填入 `NETEASE_COOKIE`，例如 `NETEASE_COOKIE='MUSIC_U=實際值; __csrf=實際值'`；與 `MUSIC_U` 擇一即可。完整 cookie 不含 `Cookie:` 前綴。帳號需要具備對應歌曲及音質權限，VPS 所在地區亦需有可用音源。API 回傳無授權音源時，系統會顯示失敗原因，不替換來源。

`NETEASE_API_URL` 是給已有自建相容 API 服務的使用者；目前使用內置 SDK，保持空白即可。

修改 `.env` 後必須在 `/opt/ismusicnow` 執行 `docker compose up -d --force-recreate`。容器啟動時才載入環境變數，單純保存文件或 `docker compose restart` 不會更新容器的環境值。若能正常登入但某首歌回傳無音源，請測試另一首帳號可播放的歌；這是曲目可用性與權限問題，無須再填 Spotify API 或第三方網易雲 API。

## YouTube Music

獨立 YTM 適配器使用 yt-dlp，只接受 `music.youtube.com` 的單曲／歌單連結，無須 Google Cloud API key。若曲目需要帳號登入，依 [yt-dlp cookies 說明](https://github.com/yt-dlp/yt-dlp/wiki/FAQ#how-do-i-pass-cookies-to-yt-dlp) 匯出自己的該網站 Netscape cookies.txt，上傳到 `/opt/ismusicnow/secrets/ytm-cookies.txt`，再填：

```dotenv
YTM_COOKIES_PATH=/app/secrets/ytm-cookies.txt
```

公開連結可先保持空白。此適配器保存取得的原始音訊容器，不作 Spotify 音源替代。

目前 VPS 的測試連結受到 YouTube「登入以確認不是機器人」驗證，需提供 YTM cookies 後再驗證，單純安裝 yt-dlp 不代表所有公開連結都能直接下載。

## Telegram

`@ismusicnow_bot` 的 `BOT_TOKEN` 已配置。之後若需要取得或更新 token，在官方 [@BotFather](https://t.me/BotFather) 選擇自己的 bot，依其 API Token 選單操作，再自行更新 `.env` 的 `BOT_TOKEN`。[官方說明](https://core.telegram.org/bots/tutorial#obtain-your-bot-token)

可選 `BOT_ALLOWED_USERS=你的TelegramUserID`，多個 ID 用逗號分隔；留空則 bot 公開可用。

## 權限與套用

cookies 檔上傳後，在 1Panel 終端執行（沒有上傳的檔名不要包含在命令中）：

```sh
cd /opt/ismusicnow
chmod 600 .env
chown root:1000 secrets
chmod 750 secrets
chown root:1000 secrets/spotify-cookies.txt
chmod 640 secrets/spotify-cookies.txt
docker compose up -d --force-recreate
docker compose ps
```

若另有 YTM cookies 或 Votify 設定檔，也將那些檔案設為 `root:1000` 和 `640`，讓容器 UID/GID 1000 能唯讀存取。`secrets/` 不在 Git 與 Docker build context 中。

套用後，打開 [music.ism.tw](https://music.ism.tw) 查看來源設定狀態，再用自己有權取得的單曲進行驗證。Client ID / Secret、cookies 和 bot token 都留在 VPS，不貼到聊天、不放到公開原始碼。
