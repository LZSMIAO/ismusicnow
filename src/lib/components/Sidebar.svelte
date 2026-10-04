<script lang="ts">
  import { page } from '$app/state';
  import { Music2, Download, BookOpen, ArrowUpRight, Code2 } from '@lucide/svelte';
  import Logo from './Logo.svelte';
  const links = [{ href: '/', label: '獲取音樂', icon: Music2 }, { href: '/downloads', label: '下載記錄', icon: Download }, { href: '/guide', label: '使用指南', icon: BookOpen }];
</script>

<aside class="sidebar">
  <Logo />
  <nav aria-label="主要導覽">
    {#each links as link}
      <a class:active={page.url.pathname === link.href} href={link.href} aria-current={page.url.pathname === link.href ? 'page' : undefined}>
        <link.icon size={19} strokeWidth={1.7} /><span>{link.label}</span>
      </a>
    {/each}
  </nav>
  <div class="sidebar-bottom">
    <div class="source-note"><span class="small-label">三個來源，一份收藏。</span><p>每個平台的音樂，<br />保留它原本的聲音。</p></div>
    <a class="external-link" href="https://t.me/ismusicnow_bot" target="_blank" rel="noreferrer">在 Telegram 獲取 <ArrowUpRight size={16} /></a>
    <a class="external-link github" href="https://github.com/LZSMIAO/ismusicnow" target="_blank" rel="noreferrer"><Code2 size={16} /> 開源於 GitHub <ArrowUpRight size={14} /></a>
  </div>
</aside>
