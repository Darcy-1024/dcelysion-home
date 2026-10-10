import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';

export default defineConfig({ site: 'https://dcelysion.cn', integrations: [svelte()], devToolbar: { enabled: false } });
