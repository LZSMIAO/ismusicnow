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

- TypeScript / Svelte 檢查：0 errors、0 warnings；7 個測試通過；production build 通過。
- VPS web / bot 容器啟動；Telegram 身份驗證成功，啟動 long polling。
- 公網 HTTPS 可載入網頁，網易雲搜尋與單曲元資料可正常解析。
- 網易雲歌曲下載在未配置帳號的現有 VPS 測試中未取得授權音源；需要帳號／地區權限驗證。
- Spotify 尚需 API 憑證與 cookies，原始音源下載尚未完成實際驗證。
- YTM 工具已安裝，實際曲目下載尚未驗證。

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

`main` 是重寫版本，`v2` 保留原版。依維護者選擇保留 GitHub fork 關係；不推送 codex 分支。
