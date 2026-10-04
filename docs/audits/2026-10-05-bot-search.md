# MUISM Bot 搜尋與播放審計

日期：2026-10-05（Asia/Shanghai）  
發佈基底：`523f835f621f58e6f8f89fc272e7535148fc4e7d`。本文件隨 Bot 功能提交一同發佈；完整發佈 SHA 與部署證據附在交付版。

## 最終互動

- 新搜尋預設全部已接入來源，每頁 8 個錄音結果。歌曲／歌手、時長、來源放在原生 Telegram compact table。
- 點歌名直接獲取；來源格顯示目前優先來源，點平台直接指定該來源。其他來源以 `+N` 入口按需選擇，不強制展開。
- 歌曲、專輯、藝術家、歌單類別，以及來源篩選均在同一則訊息切換。平台面板依已實作的搜尋能力生成，沒有固定兩欄平台名單上限。
- 專輯／版本詳情使用原生 details，預設收起。移除數字按鈕、重複結果正文和醒目的載入引用框；舊數字輸入僅保留為相容功能。
- 相容格式保留直接歌曲與來源按鈕。明確不支援 Rich API 才切換相容格式；逾時或網路中斷不重送訊息。

## 合併與選源規則

僅在搜尋結果中合併跨平台、可高度確認為同一錄音的項目。比較完整歌名（保留 Live／Remix 等版本字樣）、全部歌手與有效時長（差異最多 1 秒）；雙方都有有效 ISRC 時必須一致，缺少其中一方的 ISRC 時還要求專輯名稱一致。同平台不同 ID、翻唱、版本差異、ISRC 衝突和不足的資料保留分開。群組內採逐對比較，避免時長差異鏈式合併。專輯與歌單原有順序保持。

同一錄音內以已知完整音源、實測音質、可重用快取排序。無損比較位深與取樣率；有損僅在相同 codec 下比較位元率。沒有固定平台優先級，未知音質不冒充高品質。顯示後的來源順序保持穩定，防止按鈕指向另一首。

自動選源只會在送給收件人之前、確認音源不可用或不完整時嘗試同組候選；明確指定平台只嘗試該平台。一般網路、Telegram 發送或不明下載錯誤不換源，避免重複交付。

## 修正的具體缺陷

| 問題 | 處理 |
| --- | --- |
| FLAC document 快取被當成播放器重用 | 原始檔案與可播放引用分開；NetEase 可播放的原始 FLAC 優先直接重用 |
| 私有快取頻道上傳帶有頻道不允許的 Inline 按鈕 | 快取上傳移除 reply markup，收件人卡片仍正常生成按鈕 |
| 選單換頁／換類別失敗後舊按鈕失效 | 成功更新才提交新 session；失敗恢復原有回呼關聯 |
| 連點、跨使用者、跨群組或跨話題操作 | 準備與更新鎖定；檢查擁有者、chat、message、forum topic 與有效期 |
| 長名稱切掉版本後綴 | 表格、相容按鈕與來源面板保留名稱頭尾；詳情列出各候選的歌手／專輯／時長 |
| 一個來源失敗看起來像完整搜尋 | Rich 與相容格式均提供簡短部分來源提示 |
| 未接入平台出現在設計示例裡被誤認為已支援 | 實際介面僅顯示 adapter 能力清單 |

## 驗證與證據

- 相關 Bot 與搜尋測試：**80 通過、0 失敗**。涵蓋真實 handler 路徑的來源合併、同訊息篩選、群組／話題權限、語言、Inline、快取、失敗重試和立即清理。
- Bot TypeScript 型別檢查通過；未啟動開發伺服器，未進行無關前端重建。
- 依 impeccable 規範，分別完成獨立版面審閱與機械檢查，已修正實質問題；範圍偵測器結果 `[]`、exit 0。這不等於原生客戶端視覺驗收。
- Unicode 極端資料探測：相容文字最多 3,411 個解析後 UTF-16 單位，小於 4,096；callback 最多 30 bytes，小於 64。Rich HTML 的跳脫前後長度不可直接當作 Rich 解析文字長度。
- 真實 Telegram API 在私有快取頻道接受 `sendRichMessage`：8 筆表格＋表頭，details 關閉，`editMessageText` 更新同一 message ID。探測訊息已清理。
- 〈爛泥〉（NetEase 411314656）已實際修復為原始 FLAC audio 快取；重新使用 Telegram 檔案引用可播放，沒有來源重下載，原始位元組 SHA-256 保持一致。再次發送驗證收到 audio，詳情為 6 行 expandable blockquote；只保留必要快取檔案訊息。

## 已知限制

- 原唱身分沒有跨平台可靠通用旗標。目前以錄音／歌手資料保守匹配，不以平台、標題或熱門程度斷言原唱。Spotify 有 ISRC；其他來源缺少時以更保守的專輯匹配處理。
- 尚未下載／驗證的來源，其完整性和音質未知；平台搜尋命中不代表目前帳戶能下載完整音源。
- 目前關鍵字搜尋接入 NetEase、Spotify；YTM 支援連結。新增平台仍需 adapter、型別、連結解析與快取 schema 接入，完成後介面可依能力清單自動生成。
- API 結構與同訊息更新已實測；不同 Telegram 客戶端的實際換行、字型、點擊區域尚未逐端目測。API 不能回報使用者客戶端 Rich 支援程度；管理員可設 `BOT_RICH_SEARCH=0` 使用相容模式。
- 舊歷史卡片不會因程式更新自動換排版；新發送的卡片按目前 UI／中文名稱設定生成。音樂快取不保存收件人的語言或 caption，不需要清空全部音樂快取。

## 部署與回滾

本次只更新 Bot 程式與映像；以 main 的指定提交製作 `muism:bot-<SHA前8碼>`，對比部署前後 web image ID，避免影響同時進行的網站工作。保留舊 Bot 映像 `muism:before-rich-search` 和僅服務端可讀的環境備份。

回滾時將 `.env` 的 `BOT_IMAGE` 設為 `muism:before-rich-search`，並只從 `.deploy-inline/env-before-rich-search` 恢復 `BOT_RICH_SEARCH` 原值（原先未設定就移除此鍵）；執行 `docker compose up -d --force-recreate --no-deps bot`。不要整份覆蓋 `.env`，以免撤銷其他服務的更新。快取修復保留有效原始 FLAC 引用，不需要反向清除。

## Telegram 依據

[Rich formatting／限制](https://core.telegram.org/bots/api#rich-message-formatting-options)、[sendRichMessage](https://core.telegram.org/bots/api#sendrichmessage)、[InputRichMessage](https://core.telegram.org/bots/api#inputrichmessage)、[原生 Details](https://core.telegram.org/bots/api#inputrichblockdetails)。
