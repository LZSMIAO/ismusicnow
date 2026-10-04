<script lang="ts">import { ArrowUpRight } from '@lucide/svelte';</script>
<svelte:head><title>使用指南 · MUISM · 音樂主義</title></svelte:head>
<article class="page-content guide-page"><header class="page-intro"><h1>使用指南</h1><p>找到音樂、選好曲目，再把它保存到你的裝置。</p></header>
  <ol class="guide-steps"><li><h2>貼上連結，或搜尋一首歌。</h2><p>網易雲與 Spotify 支援歌曲、專輯和歌單完整連結，也可依選定來源搜尋關鍵字。「所有來源」合併網易雲與已配置的 Spotify 搜尋結果，並保留各曲目的來源。YTM 支援 YouTube Music 歌曲與歌單連結。連結會自動辨識平台。</p></li><li><h2>選擇曲目與音質。</h2><p>預設只勾選第一首，每次最多獲取 20 首，歌單每次載入最多 100 首。網易雲可選原始可用音質、MP3 或原生 FLAC；Spotify 和 YTM 保留來源編碼，不轉碼。</p></li><li><h2>加入佇列，完成後保存。</h2><p>下載依序執行。完成後會顯示實際編碼、碼率或位元深度，點選「保存音樂」下載到裝置。暫存檔保留 24 小時。</p></li></ol>
  <section><h2>播放</h2><p>點擊曲目旁的播放按鈕，或用專輯播放鍵依序播放。本站不限制播放時長，進度條使用音訊的實際長度，歌曲結束後才切換下一首。播放與下載勾選各自獨立；若來源只提供試聽片段，會明確標示。已完成的下載可直接播放完整檔案。</p></section>
  <section><h2>每個來源，各自獨立。</h2><dl class="source-guide"><div><dt>網易雲音樂</dt><dd>依曲目及帳號權限取得網易雲原生音源。無損可能需要服務端配置相應帳號；只提供試聽片段的曲目不作完整下載。</dd></div><div><dt>Spotify</dt><dd>透過獨立適配器取得 Spotify 原始音源。高碼率與無損取決於訂閱、曲目及下載環境；沒有相應權限時會顯示失敗原因，不會改用其他平台的音源。</dd></div><div><dt>YouTube Music</dt><dd>使用獨立 YTM 適配器，保存當前帳號可取得的原始音訊容器，實際編碼與碼率依音源而定。</dd></div></dl></section>
  <section><h2>也可以在 Telegram 獲取。</h2><p>打開 bot，直接貼上歌曲連結；使用 <code>/search 歌名</code> 搜尋網易雲，<code>/spotify 歌名</code> 搜尋 Spotify，<code>/netease 歌名／歌曲ID／連結</code> 獲取網易雲，關鍵字會下載首個搜尋結果；<code>/music</code> 與 <code>/musicid</code> 使用相同方式。<code>/lyric 歌名／ID／連結</code> 獲取 LRC 歌詞。bot 會回傳歌曲檔案。</p><a class="primary-button guide-telegram" href="https://t.me/muismbot" target="_blank" rel="noreferrer">打開 @muismbot <ArrowUpRight size={17} /></a></section>
  <section><h2>遇到問題</h2><p>「適配器待配置」表示服務端尚未完成下載工具或帳號設定。短連結請先在平台開啟，再複製完整網址。私密歌單、區域限制、過期登入或訂閱權限不足，可能導致無法獲取。</p><p>部署者可查看項目 README 的設定與部署說明。僅保存你有權保存的內容。</p></section>
  <footer class="guide-license">© 2026 MUISM 貢獻者。使用 <a href="/license.txt">GNU GPL v3</a> 授權；軟體不附帶擔保。項目已獨立重寫，來源與授權見 <a href="https://github.com/LZSMIAO/ismusicnow" target="_blank" rel="noreferrer">GitHub</a>。</footer>
</article>
