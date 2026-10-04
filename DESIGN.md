# ismusicnow Design

## Direction

已批准的 v8：Spotify 類型的音樂工作區，黑 × 冰銀。全域搜尋、收藏導覽、連續曲目列表、右側預覽和底部播放器。圖片只參考情緒，不沿用暖色或製作背景插畫；移除標語與解釋顯而易見操作的文案。

## Color and Type

Restrained dark surfaces. Canvas `oklch(.115 0 0)`，panel `.185 .003 260`，raised `.235 .005 260`，正文 `.96 .005 260`，次要文字 `.76 .009 260`，冰銀控制 `.89 .016 260`。不以 Spotify 綠色作為本項目品牌色。

系統無襯線字體，繁中 fallback PingFang TC / Noto Sans TC。專輯名使用大字重，正文和操作沿用 .75 / .875 / 1rem，時間與尺寸採 tabular numbers。沒有外部字型依賴。

## Layout

全寬工作區：232px 收藏欄、彈性主區、280px 預覽；1600px 以上兩側為 280 / 336px。1250px 以下收起右側預覽，960px 以下收藏欄變為圖示，700px 以下使用單欄與固定底部播放器。手機頂欄保留指南和佇列入口。

搜尋結果中的專輯入口直接使用平台專輯 ID；不冒充獨立專輯分類搜尋。所有來源共用一個搜尋入口，每首歌始終保留平台身分。下載選擇和試聽互不干擾，新結果不預選歌曲。

## Interaction and Motion

- 搜尋框專注輸入，不放獨立來源選單。獲得焦點時向下展開同寬 native popover，來源用緊湊膠囊選項整合在面板內，下方顯示帶封面、標題和副標題的真實最近搜尋；選擇後保持編輯，送出、Escape 或點擊外部收起。200ms 展開／150ms 收起，Reduced motion 即時切換；方向鍵切換來源，焦點可回到輸入框。
- 音質沿用 native popover，深色選單、勾選狀態、方向鍵、Home / End / Escape、焦點返回。
- 下載佇列使用 native modal dialog 覆蓋層，Web Animations API 240ms 從屏幕右邊滑入、180ms 滑出，關閉動畫結束後才移除 dialog。背景區塊使用靜態 3px filter 模糊與淡黑遮罩，不使用全屏 backdrop-filter 動畫，也不改網格、寬度或 padding；列表独立滚动。標題、清除和關閉按鈕同一列，圖示置中於 44px 按鈕內。支援 Escape、點擊遮罩、焦點返回及 Reduced motion；Telegram 使用實際 WebView 高度和安全區。
- 搜尋取消舊請求，以最後一次請求為準；骨架只在真實請求期間出現。內容淡入 180ms。
- 曲目播放與下載勾選獨立。播放不設時間上限，由 Audio 真實時長及 ended 事件驅動，支援暫停、進度、音量與專輯連續播放。來源缺少試聽時顯示原因；已完成下載可以使用同一 session 的檔案預覽。
- Hover 以表面亮度回饋，按下位移 1px；封面不縮放或漂浮。Reduced motion 關閉動畫和過渡。
- 返回鍵恢復上一份結果、來源、音質與勾選；最近開啟只保存最少元資料和來源連結。

## Telegram interaction

直接關鍵字先顯示歌曲候選，包含歌手、專輯與時長，避免同名歌／不同版本被默認下載。音樂連結保留平台、類型和 ID 的明確語意：單曲直接獲取；合集展開後逐首選擇。序號只引用當前用戶在當前聊天、話題的選曲列表；群組以回覆列表的序號選曲，普通聊天數字不觸發獲取。

網易雲與 Spotify 分類搜尋採用「單曲／專輯／藝術家／歌單」切換，預設單曲。每頁五個結果，標題加粗，第二行呈現藝術家、專輯或年份／曲數；序號按鈕集中一排，避免重複標題。網易雲藝術家提供熱門單曲與專輯；Spotify 藝術家直接提供專輯作品清單。專輯展開選歌，返回恢復上一層的結果與頁碼。分類或作品內容改變時輪換 session ID，拒絕舊按鈕，維持用戶／聊天／話題所有權。單獨 @提及開啟簡短說明。

Bot 語言採手動設定、Telegram 語言、English 的優先順序。開始畫面只放「當前語言 ｜ 切換語言」，展開後列出八種語言的原生名稱；名稱字形設定另屬網易雲，不隨 Bot 介面語言翻譯。設定直接原位更新，首次字形選擇確認後立即關閉；已處理請求與完成進度立即清理，錯誤留閱讀時間。音樂卡片的專輯／來源／編碼／大小／署名用 Telegram 原生 Spoiler 隱藏，點擊可見。卡片附專輯、主藝術家與來源入口。

可持續使用的面板、音樂和歌詞不回覆將被刪除的請求，避免 Deleted message。群組透過收件人 mention 和話題 ID 定位，短暫錯誤仍可引用現存請求。每位成員有自己的語言命令選單；設定按鈕僅限擁有者，語言選擇不影響同群其他成員。群組開始畫面使用群組指令／回覆列表的說明。

Desktop search is centred within three balanced header columns. External links use compact icon-and-text controls without a pill border. Search results load real provider artist entities independently from songs; artist portraits are circular, source labels stay visible, and selecting one opens provider tracks/albums.

No tracks are selected by default. Double-click a track row or press Enter on it to play that exact track. Row hover is transient; only the current track title/play icon carries playback state, and checkboxes carry download selection. Individual download buttons appear on desktop hover/focus and remain visible on touch devices.

Lyrics sit directly above the player as a compact current-line strip. Expand in place to a bounded 180px desktop / 144px mobile list, highlight by audio elapsed time, click a timed line to seek. NetEase uses original song ID lyrics; Spotify/YTM use LRCLIB exact metadata/duration lookup with visible source attribution. Missing lyrics and unsynchronised text have explicit states. Lyrics language is left as provided.
