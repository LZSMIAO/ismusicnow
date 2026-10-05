<script lang="ts">
  let { paused = false, size = 24 }: { paused?: boolean; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
  {#if paused}
    <rect x="6.5" y="5" width="4" height="14" rx=".75" />
    <rect x="13.5" y="5" width="4" height="14" rx=".75" />
  {:else}
    <!-- Optical centering accounts for the triangle's heavier left edge. -->
    <path d="M8 5.5c0-.8.87-1.3 1.56-.9l11.2 6.5c.69.4.69 1.4 0 1.8l-11.2 6.5C8.87 19.8 8 19.3 8 18.5z" />
  {/if}
</svg>
