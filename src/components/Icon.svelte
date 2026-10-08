<script lang="ts">
  let { name, size = 20 }: { name: string; size?: number } = $props();
  const paths: Record<string, string> = {
    arrow: 'M7 17 17 7M7 7h10v10',
    chevron: 'm9 5 7 7-7 7',
    close: 'm6 6 12 12M6 18 18 6',
    shuffle: 'm16 3 4 4-4 4M4 7h3c4 0 6 10 10 10h3m-4-4 4 4-4 4M4 17h3c1.3 0 2.5-1 3.6-2.5M13.4 9.5C14.5 8 15.7 7 17 7h3',
    music: 'M9 18V5l11-2v13M9 8l11-2M9 18c0 1.7-1.8 3-4 3s-3-1.3-3-3 1.8-3 4-3c1.2 0 2.3.4 3 1M20 16c0 1.7-1.8 3-4 3s-3-1.3-3-3 1.8-3 4-3c1.2 0 2.3.4 3 1',
    play: 'm9 5 11 7-11 7Z',
    pause: 'M8 5v14M16 5v14',
    next: 'm5 5 10 7-10 7ZM19 5v14',
    previous: 'm19 5-10 7 10 7ZM5 5v14',
    volume: 'm11 5-6 4H2v6h3l6 4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14',
    repeat: 'm17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3',
    pin: 'M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0ZM15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    refresh: 'M20 7v5h-5M4 17v-5h5M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9',
    sun: 'M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
    drop: 'M12 3S5 11 5 15a7 7 0 0 0 14 0c0-4-7-12-7-12Z',
    wind: 'M3 8h12a3 3 0 1 0-3-3M2 12h17a3 3 0 1 1-3 3M4 16h4a3 3 0 1 1-3 3',
    list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  };
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={paths[name] || paths.music} /></svg>
