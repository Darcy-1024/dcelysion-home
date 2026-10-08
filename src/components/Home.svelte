<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { fade } from 'svelte/transition';
  import Icon from './Icon.svelte';
  import type { HomeData, IconData, Social } from '../lib/home';
  import { CACHE_TTL, fetchWeather, readWeatherCache, writeWeatherCache, readSelectedCity, saveSelectedCity, weatherSymbol, type Weather } from '../lib/weather';
  import { getMusicPlayer, type MusicPlayer, type MusicState } from '../lib/music';
  import { GreetingClock, type Greeting } from '../lib/greeting';

  let { data, icons }: { data: HomeData; icons: Record<string, IconData> } = $props();
  let activePanel = $state<'weather' | 'music' | null>(null);
  let panelElement: HTMLElement;
  let returnFocus: HTMLElement | null = null;
  let reducedMotion = $state(false);
  let typedBio = $state(data.profile.bio);
  let currentWallpaper = $state(data.defaultWallpaper.desktop.poster);
  let defaultWallpaperActive = $state(true);
  let mobileWallpaper = $state(false);
  let mounted = $state(false);
  let videoFailed = $state(false);
  const defaultWallpaper = $derived(mobileWallpaper ? data.defaultWallpaper.mobile : data.defaultWallpaper.desktop);
  let previousWallpaper = $state('');
  let wallpaperBusy = $state(false);
  let wallpaperNotice = $state('');
  let wallpaperList = data.wallpapers.desktop;
  let alive = false;
  let wallpaperVersion = 0;
  let weather = $state<Weather | null>(null);
  let weatherBusy = $state(false);
  let weatherError = $state('');
  let selectedCity = $state('');
  let cityInput = $state('');
  let weatherController: AbortController | undefined;
  let weatherVersion = 0;
  let greeting = $state<Greeting>({ text: '你好', time: '', source: 'device' });
  let player: MusicPlayer | undefined;
  let music = $state<MusicState | null>(null);
  let showPlaylist = $state(false);
  const track = $derived(music?.track ?? data.tracks[0]);
  const modeLabel = $derived(music?.mode === 'one' ? '单曲循环' : music?.mode === 'random' ? '随机播放' : '列表循环');

  function formatTime(seconds: number) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
  }

  async function openPanel(kind: 'weather' | 'music', event: MouseEvent) {
    returnFocus = event.currentTarget as HTMLElement;
    activePanel = kind;
    await tick();
    panelElement?.querySelector<HTMLButtonElement>('button')?.focus();
  }

  function closePanel() {
    activePanel = null;
    void tick().then(() => returnFocus?.focus());
  }

  function handleKeydown(event: KeyboardEvent) {
    if (!activePanel) return;
    if (event.key === 'Escape') { event.preventDefault(); closePanel(); }
    if (event.key === 'Tab' && panelElement) {
      const focusable = Array.from(panelElement.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]'));
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (!panelElement.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }

  async function changeWallpaper() {
    if (wallpaperBusy || !wallpaperList.length) return;
    const candidates = wallpaperList.filter((src) => src !== currentWallpaper);
    if (!candidates.length && currentWallpaper) return;
    const next = candidates[Math.floor(Math.random() * candidates.length)] ?? wallpaperList[0];
    const version = ++wallpaperVersion;
    wallpaperBusy = true;
    wallpaperNotice = '';
    try {
      await new Promise<void>((resolve, reject) => {
        const img = new Image();
        const finish = (error?: Error) => { clearTimeout(timeout); img.onload = null; img.onerror = null; error ? reject(error) : resolve(); };
        const timeout = setTimeout(() => finish(new Error('timeout')), 10000);
        img.onload = () => { void img.decode().then(() => finish(), () => finish(new Error('decode'))); };
        img.onerror = () => finish(new Error('load'));
        img.src = next;
      });
      if (!alive || version !== wallpaperVersion) return;
      previousWallpaper = currentWallpaper;
      currentWallpaper = next;
      defaultWallpaperActive = false;
    } catch {
      if (alive && version === wallpaperVersion) wallpaperNotice = '这张壁纸暂时加载不了，再试一次吧';
    } finally {
      if (alive && version === wallpaperVersion) wallpaperBusy = false;
    }
  }

  async function loadWeather(city: string, force = false) {
    const version = ++weatherVersion;
    weatherController?.abort();
    weatherController = new AbortController();
    selectedCity = city;
    cityInput = city;
    saveSelectedCity(city);
    weatherError = '';
    const cached = readWeatherCache(city || undefined);
    weather = cached?.data ?? null;
    if (!force && cached && Date.now() - cached.savedAt < CACHE_TTL) { weatherBusy = false; return; }
    weatherBusy = true;
    try {
      const result = await fetchWeather(city || undefined, weatherController.signal);
      if (!alive || version !== weatherVersion) return;
      weather = result;
      writeWeatherCache(city || undefined, result);
    } catch (error) {
      if (!alive || version !== weatherVersion) return;
      weatherError = `${error instanceof Error ? error.message : '天气暂时不可用'}${weather ? ' · 当前显示上次数据' : ''}`;
    } finally {
      if (alive && version === weatherVersion) weatherBusy = false;
    }
  }

  function emailClick(event: MouseEvent, social: Social) {
    if (!social.encodedEmail) return;
    event.preventDefault();
    window.location.href = `mailto:${atob(social.encodedEmail)}`;
  }

  onMount(() => {
    alive = true;
    mounted = true;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const mobile = window.matchMedia('(max-width: 640px)');
    reducedMotion = motion.matches;
    let typeTimer: ReturnType<typeof setInterval> | undefined;
    if (!reducedMotion) {
      const letters = Array.from(data.profile.bio);
      let index = 0;
      typedBio = '';
      typeTimer = setInterval(() => {
        typedBio = letters.slice(0, ++index).join('');
        if (index >= letters.length) clearInterval(typeTimer);
      }, 100);
    }
    const onMotion = () => { reducedMotion = motion.matches; if (reducedMotion) { clearInterval(typeTimer); typedBio = data.profile.bio; } };
    const setWallpapers = () => {
      mobileWallpaper = mobile.matches;
      wallpaperList = mobile.matches ? data.wallpapers.mobile : data.wallpapers.desktop;
      wallpaperVersion++;
      wallpaperBusy = false;
      if (defaultWallpaperActive) {
        currentWallpaper = mobile.matches ? data.defaultWallpaper.mobile.poster : data.defaultWallpaper.desktop.poster;
        previousWallpaper = '';
        videoFailed = false;
      } else void changeWallpaper();
    };
    motion.addEventListener('change', onMotion);
    mobile.addEventListener('change', setWallpapers);
    setWallpapers();
    void loadWeather(readSelectedCity());
    const greetingClock = new GreetingClock((value) => { greeting = value; });
    greetingClock.start();
    player = getMusicPlayer(data.tracks);
    const unsubscribe = player.subscribe((state) => { music = state; });
    const onVisible = () => {
      if (document.visibilityState === 'visible') { void loadWeather(selectedCity); greetingClock.resume(); }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      wallpaperVersion++;
      weatherVersion++;
      weatherController?.abort();
      greetingClock.stop();
      clearInterval(typeTimer);
      unsubscribe();
      motion.removeEventListener('change', onMotion);
      mobile.removeEventListener('change', setWallpapers);
      document.removeEventListener('visibilitychange', onVisible);
    };
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="home" style={`--accent-hue: ${data.accentHue}`}>
  <div class="wallpaper" aria-hidden="true">
    {#if previousWallpaper}<img class="wallpaper-image" src={previousWallpaper} alt="" />{/if}
    {#key currentWallpaper}
      {#if currentWallpaper}<img class="wallpaper-image" src={currentWallpaper} alt="" in:fade={{ duration: reducedMotion ? 0 : 650 }} />{/if}
    {/key}
    {#if mounted && defaultWallpaperActive && !reducedMotion && !videoFailed}
      {#key defaultWallpaper.video}
        <video class="wallpaper-image wallpaper-video" class:mobile-video={mobileWallpaper} src={defaultWallpaper.video} poster={defaultWallpaper.poster} autoplay muted loop playsinline preload="auto" onerror={() => { videoFailed = true; }}></video>
      {/key}
    {/if}
    <div class="wallpaper-shade"></div>
  </div>

  <div class="home-surface" inert={activePanel !== null}>
    <header class="topbar">
      <a class="wordmark" href={data.blogUrl} target="_blank" rel="noopener noreferrer" aria-label="DcElysion 博客（新标签页）">
        <img src={data.logo} alt="DcElysion" fetchpriority="high" />
      </a>
      <button class="weather-trigger glass" onclick={(event) => openPanel('weather', event)} aria-haspopup="dialog" aria-expanded={activePanel === 'weather'} aria-controls="home-panel">
        <span class="weather-trigger-icon" aria-hidden="true">{weather ? weatherSymbol(weather.description) : '☁'}</span>
        <span class="weather-trigger-copy"><span class="weather-greeting">{greeting.text}</span><span class="weather-trigger-summary">{weather ? `${weather.city} · ${weather.temperature}°` : weatherBusy ? '正在获取天气' : '查看天气'}</span></span>
        <Icon name="chevron" size={14} />
      </button>
    </header>

    <main class="identity">
      <div class="avatar-orbit" tabindex="0" role="img" aria-label={`${data.profile.name} 的头像`}>
        <span class="avatar-wave" aria-hidden="true"></span><span class="avatar-wave" aria-hidden="true"></span><span class="avatar-wave" aria-hidden="true"></span>
        <div class="avatar-ring"><img class="avatar" src={data.profile.avatar} alt="" width="150" height="150" fetchpriority="high" /></div><span class="orbit-dot"></span>
      </div>
      <p class="eyebrow">Welcome to Dcelysion</p>
      <h1>{data.profile.name}</h1>
      <p class="bio"><span class="sr-only">{data.profile.bio}</span><span aria-hidden="true" class="bio-stage"><span class="bio-placeholder">{data.profile.bio}</span><span class="bio-text">{typedBio}<span class:typing={typedBio !== data.profile.bio} class="typing-caret"></span></span></span></p>
      <div class="identity-divider" aria-hidden="true"><span></span><i></i><span></span></div>
      <nav class="socials" aria-label="社交链接">
        {#each data.socials as social}
          <a class="social-link glass" href={social.url ?? '#email'} onclick={(event) => emailClick(event, social)} target={social.encodedEmail ? undefined : '_blank'} rel={social.encodedEmail ? undefined : 'noopener noreferrer'} aria-label={social.name === 'Email' ? '发送邮件' : social.name === 'Bilibili' ? '哔哩哔哩（新标签页）' : 'QQ（新标签页）'} title={social.name === 'Email' ? '邮箱' : social.name === 'Bilibili' ? 'B站' : 'QQ'}>
            {#if icons[social.icon]}<svg aria-hidden="true" width="21" height="21" viewBox={`0 0 ${icons[social.icon].width} ${icons[social.icon].height}`} fill="currentColor">{@html icons[social.icon].body}</svg>{/if}
          </a>
        {/each}
      </nav>
      <a class="blog-link glass" href={data.blogUrl} target="_blank" rel="noopener noreferrer"><span>进入博客</span><Icon name="arrow" size={19} /></a>
    </main>

    <footer class="bottom-bar">
      <div class="wallpaper-control">
        <button class="wallpaper-trigger glass" onclick={changeWallpaper} disabled={wallpaperBusy} aria-label="换一张壁纸">
          <span class:spinning={wallpaperBusy}><Icon name="shuffle" size={19} /></span><span>{wallpaperBusy ? '加载壁纸' : '换一张壁纸'}</span>
        </button>
        <p class="wallpaper-notice" role="status">{wallpaperNotice}</p>
      </div>
      <button class="music-trigger glass" onclick={(event) => openPanel('music', event)} aria-haspopup="dialog" aria-expanded={activePanel === 'music'} aria-controls="home-panel">
        <span class="music-trigger-symbol" class:is-playing={music?.playing} aria-hidden="true">{#if music?.playing}<i></i><i></i><i></i><i></i>{:else}<Icon name="music" size={20} />{/if}</span>
        <span class="music-trigger-copy"><span>{music?.playing ? track?.name : '听一首歌'}</span><small>{music?.playing ? track?.artist : '让旋律陪你片刻'}</small></span><Icon name="chevron" size={15} />
      </button>
    </footer>
  </div>

  {#if activePanel}
    <button class="panel-backdrop" onclick={closePanel} tabindex="-1" aria-label="关闭面板"></button>
    <section class="panel glass" class:weather-panel={activePanel === 'weather'} class:music-panel={activePanel === 'music'} id="home-panel" role="dialog" aria-modal="true" aria-labelledby="panel-title" tabindex="-1" bind:this={panelElement} in:fade={{ duration: reducedMotion ? 0 : 150 }}>
      <div class="panel-heading"><div><p class="panel-eyebrow">{activePanel === 'weather' ? 'A LITTLE FORECAST' : 'SOUNDTRACK OF THE MOMENT'}</p><h2 id="panel-title">{activePanel === 'weather' ? '此刻的天气' : '音乐时光'}</h2></div><button class="icon-button close-button" onclick={closePanel} aria-label="关闭面板"><Icon name="close" /></button></div>

      {#if activePanel === 'weather'}
        <div class="greeting-overview"><strong>{greeting.text}</strong>{#if greeting.time}<span>{greeting.time}<small>设备时间</small></span>{/if}</div>
        <div class="weather-overview" aria-live="polite">
          {#if weather}
            <div class="weather-location"><Icon name="pin" size={15} /><span>{weather.city}</span>{#if selectedCity}<small>手动选择</small>{/if}</div>
            <div class="temperature-row"><span class="temperature">{weather.temperature}<sup>°</sup></span><span class="weather-large-icon" aria-hidden="true">{weatherSymbol(weather.description)}</span></div>
            <p class="weather-description">{weather.description}</p>
            <div class="weather-details"><div><Icon name="drop" size={17} /><span>湿度</span><strong>{weather.humidity}%</strong></div><div><Icon name="wind" size={17} /><span>{weather.windDirection}</span><strong>{weather.windPower}</strong></div></div>
            <p class="updated-at">更新于 {weather.updatedAt}</p>
          {:else}<div class="weather-empty"><Icon name="sun" size={44} /><p>{weatherBusy ? '正在看看窗外的天气…' : '暂时没有天气数据'}</p></div>{/if}
        </div>
        {#if weatherError}<div class="notice" role="status">{weatherError}<button onclick={() => loadWeather(selectedCity, true)} disabled={weatherBusy}>重试</button></div>{/if}
        <form class="city-form" onsubmit={(event) => { event.preventDefault(); if (cityInput.trim()) void loadWeather(cityInput.trim()); }}>
          <label for="weather-city">切换城市</label><div class="city-input-row"><input id="weather-city" bind:value={cityInput} placeholder="输入城市，如：广州" maxlength="60" autocomplete="off" required /><button class="city-submit" type="submit" disabled={weatherBusy}>查询</button></div>
        </form>
        <div class="weather-panel-footer"><button class="text-button" onclick={() => loadWeather('', true)} disabled={weatherBusy}><Icon name="pin" size={14} />恢复自动定位</button><a href="https://uapis.cn" target="_blank" rel="noopener noreferrer">天气数据 · UAPI</a></div>
        <p class="location-note">按网络出口估算城市，可能与实际位置不同。</p>
      {:else}
        <div class="now-playing"><img class="album-cover" src={track?.cover} alt={track ? `${track.name} 封面` : '专辑封面'} width="104" height="104" /><div class="track-meta"><span class="track-status"><i class:active={music?.playing}></i>{music?.loading ? '加载中' : music?.playing ? '正在播放' : '等待播放'}</span><h3>{track?.name ?? '暂无歌曲'}</h3><p>{track?.artist}</p></div></div>
        {#if music?.error}<div class="notice" role="status">{music.error}<button onclick={() => player?.retry()}>重试</button></div>{/if}
        <div class="progress-control"><label class="sr-only" for="music-progress">播放进度</label><input id="music-progress" type="range" min="0" max={music?.duration || 1} step="0.1" value={music?.currentTime ?? 0} disabled={!music?.duration} oninput={(event) => player?.seek(Number(event.currentTarget.value))} /><div class="time-labels"><span>{formatTime(music?.currentTime ?? 0)}</span><span>{formatTime(music?.duration ?? 0)}</span></div></div>
        <div class="playback-controls"><button class="icon-button mode-button" onclick={() => player?.cycleMode()} aria-label={`播放模式：${modeLabel}，点击切换`} title={modeLabel}><Icon name={music?.mode === 'random' ? 'shuffle' : 'repeat'} size={19} />{#if music?.mode === 'one'}<span class="single-badge">1</span>{/if}</button><button class="icon-button" onclick={() => player?.previous()} aria-label="上一首"><Icon name="previous" size={22} /></button><button class="play-button" onclick={() => player?.toggle()} aria-label={music?.playing ? '暂停' : '播放'}><Icon name={music?.playing ? 'pause' : 'play'} size={27} /></button><button class="icon-button" onclick={() => player?.next()} aria-label="下一首"><Icon name="next" size={22} /></button><button class="icon-button" class:active-control={showPlaylist} onclick={() => { showPlaylist = !showPlaylist; }} aria-label="歌单" aria-expanded={showPlaylist} aria-controls="playlist"><Icon name="list" size={20} /></button></div>
        <div class="volume-control"><Icon name="volume" size={16} /><label class="sr-only" for="music-volume">音量</label><input id="music-volume" type="range" min="0" max="1" step="0.01" value={music?.volume ?? 0.7} oninput={(event) => player?.setVolume(Number(event.currentTarget.value))} /><span>{Math.round((music?.volume ?? 0.7) * 100)}%</span></div>
        {#if showPlaylist}<div class="playlist" id="playlist"><div class="playlist-heading"><span>我的歌单</span><span>{data.tracks.length} 首</span></div>{#each data.tracks as item, index}<button class="playlist-track" class:selected={music?.index === index} onclick={() => player?.select(index)} aria-label={`播放 ${item.name}`} aria-current={music?.index === index ? 'true' : undefined}><span class="track-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{item.name}</strong><small>{item.artist}</small></span>{#if music?.index === index}<Icon name="music" size={15} />{/if}</button>{/each}</div>{/if}
        <p class="music-note">{modeLabel} · {data.tracks.length} 首收藏 · 点下播放，听见好心情</p>
      {/if}
    </section>
  {/if}
</div>
