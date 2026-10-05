# MUISM 繁簡字形與播放器名稱修正

VPS 讀取到使用者名稱偏好與介面偏好均為 `zh-Hant`，設定沒有被重置。舊實作僅在網易雲套用中文名稱字形；其他平台的獲取流程強制使用 Original。上一張《金银》快取驗證卡也沒有套用字形偏好。

## 修正

- 已選的中文名稱字形套用至所有平台的曲名、歌手名與專輯名；Original 保留來源原文。保留已知日語／韓語 metadata 和原生字體保護，不改來源 ID、連結或下載比對資料。
- 非網易來源使用既有名稱偏好；未設定者保持 Original，不新增打斷選曲的首次詢問。介面語言與名稱偏好仍各自保存，沒有重設使用者設定。
- Telegram 重用音檔 file_id 時忽略歌名／歌手覆寫，sendAudio 與 editMessageMedia 均以 VPS 實測確認。因此新增獨立的名稱顯示快取，從 Telegram 原音檔複製串流、修改標籤，再取得新 file_id；沒有音訊編碼或音質轉換。Original 音檔及其快取不改動。
- 顯示快取鍵包含來源 file_id 和實際顯示名稱，隔離音質、繁簡、來源原文及不同錄音。並行請求共用一次準備；失效引用只清掉對應顯示快取；準備完成／失敗均清理暫存。
- Inline CachedAudio 沒有 title／performer 欄位；未有正確名稱快取時走原訊息準備流程，已有時直接使用該快取播放器。[Telegram CachedAudio](https://core.telegram.org/bots/api#inlinequeryresultcachedaudio)
- Local Bot API 僅把此 bot 的 music 子目錄只讀掛載到 bot，使用既有媒體檔案群組讀取；不掛載 API 資料庫、不改檔案權限、不開公網埠。程式限制 getFile 路徑只能對應此 bot 的音樂目錄，檢查真實路徑與檔案大小。
- 部署前執行 `python3 scripts/prepare-telegram-music.py`，建立僅指向此 bot music 子目錄的本機別名。Compose 的來源路徑因此不包含 token 的冒號，避免 Docker 將它誤解析為短格式 volume；不擴大掛載範圍。首輪部署遇到此解析問題已自動回復舊容器，修正後重新發佈。

## 驗證

- 《金银》／卦者灵风（Spotify）實際播放器顯示「金銀」「卦者靈風」，200 秒、MPEG 1 Layer 3、縮圖保留。
- 原檔與名稱副本的壓縮音訊串流 SHA-256 相同；Original 模式仍能顯示「金银」「卦者灵风」。
- MUISM Cache 82、84 為本任務既有精確曲目驗證訊息，已修正播放器與正文。沒有更改其他聊天歷史。
- 自動檢查覆蓋所有已支援平台的繁簡、Original、日韓文字保護、重啟後偏好、快取隔離、並行、實際名稱覆寫遭忽略時拒絕缓存、只讀檔案路徑及 Inline 流程。
- 正式發佈版本、測試與部署紀錄另見任務輸出審計。

歷史使用者訊息不會因部署自動改名；新發送及快取重發會套用最新偏好。Original file 操作保留來源原始檔。
