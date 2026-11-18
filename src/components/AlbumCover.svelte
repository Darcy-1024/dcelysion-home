<script lang="ts">
  import Icon from './Icon.svelte';

  let { src, alt }: { src?: string; alt: string } = $props();
  let failed = $state(false);
</script>

<!-- §8.4: preserve the cover footprint when its image is unavailable. -->
{#if !src || failed}
  <div class="album-cover cover-fallback" role="img" aria-label={`${alt}（暂无封面）`}>
    <Icon name="music" size={28} />
    <span>暂无封面</span>
  </div>
{:else}
  <img class="album-cover" {src} {alt} width="104" height="104" onerror={() => { failed = true; }} />
{/if}
