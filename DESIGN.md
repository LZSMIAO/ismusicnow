# ismusicnow Design

## Direction

已確認的明亮收藏工具構圖：側欄、連結輸入、曲目列表、下載佇列。實際內容來自平台及工作狀態，構圖示意歌曲不寫入產品。

## Scene

午後自然光下，在桌前貼上喜歡的音樂連結，安靜整理自己的音樂收藏。

## Color

Restrained. Pure white canvas, indigo accent, readable neutral ink. Primary hue anchored at 279° from the impeccable palette seed.

```css
--canvas: oklch(1 0 0);
--surface: oklch(0.975 0 0);
--ink: oklch(0.22 0.012 279);
--muted: oklch(0.48 0.016 279);
--primary: oklch(0.445 0.206 279);
--primary-soft: oklch(0.96 0.018 279);
--line: oklch(0.9 0.006 279);
--success: oklch(0.4 0.11 155);
--error: oklch(0.48 0.17 25);
```

## Type

One system sans stack; Traditional Chinese fallback PingFang TC / Noto Sans TC. Fixed rem scale: .75, .875, 1, 1.125, 1.5, 2.25. Data uses tabular numbers. No external font dependency.

## Layout and Components

216px sidebar, main content max 1440px, acquisition content and 300px queue (320px on wide screens). Below 1100px queue moves under content. Below 760px sidebar becomes top navigation. Spacing scale: 4, 8, 12, 16, 24, 32, 48, 64, 96px. Border radii 6 / 8 / 12px; pill only for small badges. Thin dividers define lists. Icons from Lucide only. Semantic layer scale: content 0, navigation 10, action bar 20.

## State and Motion

Real empty, loading, unavailable-adapter, error and complete states. 180ms hover/focus transitions and indeterminate progress for active download; no invented percentages. Reduced-motion variant removes animation. Images do not animate on hover.

## Telegram interaction

直接關鍵字先顯示歌曲候選，包含歌手、專輯與時長，避免同名歌／不同版本被默認下載。音樂連結保留平台、類型和 ID 的明確語意：單曲直接獲取；合集展開後逐首選擇。序號只引用當前用戶在當前聊天、話題的選曲列表；群組以回覆列表的序號選曲，普通聊天數字不觸發獲取。

後續分類搜尋建議採用「歌曲／專輯／歌單／藝人」四類切換，預設歌曲。專輯顯示歌手、年份與曲數；歌單顯示建立者與曲數；藝人先顯示身份／原生名稱，再進入熱門曲或專輯。這些獨立分類搜尋與藝人作品導航尚未實作，不能由歌曲關鍵字結果冒充。

Bot 語言採手動設定、Telegram 語言、English 的優先順序。開始畫面只放「當前語言 ｜ 切換語言」，展開後列出八種語言的原生名稱；名稱字形設定另屬網易雲，不隨 Bot 介面語言翻譯。臨時提示延遲清理，成功交付後才刪請求，保留音樂卡片。

群組提示和音樂保留原訊息回覆及話題 ID。每位成員有自己的語言命令選單；設定按鈕僅限擁有者，語言選擇不影響同群其他成員。群組開始畫面使用群組指令／回覆列表的說明。
