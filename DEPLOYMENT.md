# 部署紀錄

2026-10-04 部署至既有 VPS，項目目錄 `/opt/ismusicnow`。

| 入口／服務 | 配置 |
| --- | --- |
| 網頁 | https://music.ism.tw |
| Telegram | https://t.me/ismusicnow_bot |
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
