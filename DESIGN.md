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
