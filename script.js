const STORAGE_KEYS = {
  queue: "mplayer.queue",
  settings: "mplayer.settings",
  accent: "mplayer.accent",
};

const DEFAULT_ACCENT = "#ff6b35";
const DEMO_TRACK = "https://soundcloud.com/forss/flickermood";
const REPEAT_MODES = ["off", "all", "one"];

const state = {
  queue: [],
  currentQueueIndex: -1,
  widget: null,
  widgetReady: false,
  isPlaying: false,
  shuffle: false,
  repeatMode: "off",
  volume: 80,
  muted: false,
  lastVolume: 80,
  duration: 0,
  position: 0,
  collectionLength: 1,
  currentSoundIndex: 0,
  currentSound: null,
  dragItemId: null,
  accent: DEFAULT_ACCENT,
  isSeeking: false,
};

const els = {
  accentInput: document.getElementById("accentInput"),
  addTrackForm: document.getElementById("addTrackForm"),
  artworkFallback: document.getElementById("artworkFallback"),
  artworkImage: document.getElementById("artworkImage"),
  clearInputButton: document.getElementById("clearInputButton"),
  clearQueueButton: document.getElementById("clearQueueButton"),
  collectionBadge: document.getElementById("collectionBadge"),
  copyTrackLinkButton: document.getElementById("copyTrackLinkButton"),
  currentTime: document.getElementById("currentTime"),
  emptyQueueState: document.getElementById("emptyQueueState"),
  emptyStateDemoButton: document.getElementById("emptyStateDemoButton"),
  exportQueueButton: document.getElementById("exportQueueButton"),
  importFileInput: document.getElementById("importFileInput"),
  importQueueButton: document.getElementById("importQueueButton"),
  loadDemoButton: document.getElementById("loadDemoButton"),
  mobileNextButton: document.getElementById("mobileNextButton"),
  mobileOpenPlayerButton: document.getElementById("mobileOpenPlayerButton"),
  mobilePlayButton: document.getElementById("mobilePlayButton"),
  mobilePlayButtonText: document.getElementById("mobilePlayButtonText"),
  mobilePrevButton: document.getElementById("mobilePrevButton"),
  mobileProgressFill: document.getElementById("mobileProgressFill"),
  mobileTrackArtist: document.getElementById("mobileTrackArtist"),
  mobileTrackTitle: document.getElementById("mobileTrackTitle"),
  muteButton: document.getElementById("muteButton"),
  nextButton: document.getElementById("nextButton"),
  openTrackLink: document.getElementById("openTrackLink"),
  playButton: document.getElementById("playButton"),
  playButtonText: document.getElementById("playButtonText"),
  prevButton: document.getElementById("prevButton"),
  progressInput: document.getElementById("progressInput"),
  queueList: document.getElementById("queueList"),
  queueSummary: document.getElementById("queueSummary"),
  repeatBadge: document.getElementById("repeatBadge"),
  repeatButton: document.getElementById("repeatButton"),
  shuffleButton: document.getElementById("shuffleButton"),
  soundcloudWidget: document.getElementById("soundcloudWidget"),
  statusLine: document.getElementById("statusLine"),
  statusPill: document.getElementById("statusPill"),
  trackArtist: document.getElementById("trackArtist"),
  trackTitle: document.getElementById("trackTitle"),
  trackUrlInput: document.getElementById("trackUrlInput"),
  volumeInput: document.getElementById("volumeInput"),
  volumeValue: document.getElementById("volumeValue"),
  remainingTime: document.getElementById("remainingTime"),
};

function init() {
  if (window.desktopAPI?.isDesktopApp) {
    document.body.classList.add("desktop-app");
  }
  hydrateState();
  bindUi();
  applyAccent(state.accent);
  initializeWidget();
  registerServiceWorker();
  render();
}

function hydrateState() {
  try {
    const savedQueue = JSON.parse(localStorage.getItem(STORAGE_KEYS.queue) || "[]");
    if (Array.isArray(savedQueue)) {
      state.queue = savedQueue.filter((item) => item && typeof item.url === "string");
    }
  } catch (error) {
    console.warn("Queue restore failed", error);
  }

  try {
    const savedSettings = JSON.parse(localStorage.getItem(STORAGE_KEYS.settings) || "{}");
    state.shuffle = Boolean(savedSettings.shuffle);
    state.repeatMode = REPEAT_MODES.includes(savedSettings.repeatMode) ? savedSettings.repeatMode : "off";
    state.volume = clampNumber(savedSettings.volume, 0, 100, 80);
    state.lastVolume = clampNumber(savedSettings.lastVolume, 0, 100, 80);
    state.muted = Boolean(savedSettings.muted);
    state.currentQueueIndex = clampNumber(savedSettings.currentQueueIndex, -1, Math.max(state.queue.length - 1, -1), -1);
  } catch (error) {
    console.warn("Settings restore failed", error);
  }

  const savedAccent = localStorage.getItem(STORAGE_KEYS.accent);
  if (savedAccent) {
    state.accent = savedAccent;
  }
}

function initializeWidget() {
  if (!window.SC || !window.SC.Widget) {
    setStatus("Widget API SoundCloud не загрузился.", true);
    els.statusPill.textContent = "Widget error";
    return;
  }

  state.widget = window.SC.Widget(els.soundcloudWidget);

  state.widget.bind(window.SC.Widget.Events.READY, async () => {
    state.widgetReady = true;
    await applyVolumeToWidget();

    if (state.queue.length && state.currentQueueIndex >= 0) {
      await loadQueueIndex(state.currentQueueIndex, false, { preservePlayState: true });
    } else {
      await syncWidgetState();
    }
  });

  state.widget.bind(window.SC.Widget.Events.PLAY, async () => {
    state.isPlaying = true;
    els.statusPill.textContent = "Playing";
    await syncWidgetState();
    renderControls();
  });

  state.widget.bind(window.SC.Widget.Events.PAUSE, () => {
    state.isPlaying = false;
    els.statusPill.textContent = state.queue.length ? "Paused" : "Idle";
    renderControls();
    updateMediaSession();
  });

  state.widget.bind(window.SC.Widget.Events.PLAY_PROGRESS, (data) => {
    if (!state.isSeeking) {
      state.position = data.currentPosition || 0;
      renderProgress();
    }
  });

  state.widget.bind(window.SC.Widget.Events.SEEK, (data) => {
    state.position = data.currentPosition || state.position;
    renderProgress();
  });

  state.widget.bind(window.SC.Widget.Events.FINISH, async () => {
    if (state.repeatMode === "one") {
      state.widget.seekTo(0);
      state.widget.play();
      return;
    }

    await syncCollectionState();
    if (state.collectionLength > 1 && state.currentSoundIndex < state.collectionLength - 1) {
      return;
    }

    await goToNext({ autoplay: true, fromFinish: true });
  });

  state.widget.bind(window.SC.Widget.Events.ERROR, () => {
    setStatus("SoundCloud вернул ошибку для текущего элемента. Проверь публичность ссылки.", true);
    els.statusPill.textContent = "Source error";
  });
}

function bindUi() {
  els.addTrackForm.addEventListener("submit", handleAddTracks);
  els.clearInputButton.addEventListener("click", () => {
    els.trackUrlInput.value = "";
    els.trackUrlInput.focus();
  });
  els.clearQueueButton.addEventListener("click", clearQueue);
  els.copyTrackLinkButton.addEventListener("click", copyCurrentTrackLink);
  els.emptyStateDemoButton.addEventListener("click", addDemoTrack);
  els.exportQueueButton.addEventListener("click", exportQueue);
  els.importQueueButton.addEventListener("click", () => els.importFileInput.click());
  els.importFileInput.addEventListener("change", importQueue);
  els.loadDemoButton.addEventListener("click", addDemoTrack);
  els.mobileOpenPlayerButton.addEventListener("click", () => {
    document.getElementById("playerPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  els.mobileNextButton.addEventListener("click", () => goToNext({ autoplay: true }));
  els.mobilePlayButton.addEventListener("click", togglePlayPause);
  els.mobilePrevButton.addEventListener("click", handlePrev);
  els.muteButton.addEventListener("click", toggleMute);
  els.nextButton.addEventListener("click", () => goToNext({ autoplay: true }));
  els.playButton.addEventListener("click", togglePlayPause);
  els.prevButton.addEventListener("click", handlePrev);
  els.repeatButton.addEventListener("click", cycleRepeatMode);
  els.shuffleButton.addEventListener("click", toggleShuffle);
  els.accentInput.addEventListener("input", (event) => applyAccent(event.target.value));
  els.accentInput.addEventListener("change", (event) => applyAccent(event.target.value, { syncWidget: true }));
  els.volumeInput.addEventListener("input", handleVolumeInput);
  els.progressInput.addEventListener("pointerdown", () => {
    state.isSeeking = true;
  });
  els.progressInput.addEventListener("input", handleProgressPreview);
  els.progressInput.addEventListener("change", handleSeekChange);

  document.addEventListener("keydown", handleKeydown);
}

function render() {
  renderQueue();
  renderProgress();
  renderControls();
  renderNowPlaying();
  renderQueueSummary();
  renderToggles();
  renderVolume();
  els.accentInput.value = state.accent;
  els.emptyQueueState.hidden = state.queue.length > 0;
}

function renderQueue() {
  els.queueList.innerHTML = "";

  state.queue.forEach((item, index) => {
    const li = document.createElement("li");
    li.className = "queue-item";
    li.draggable = true;
    li.dataset.itemId = item.id;
    if (index === state.currentQueueIndex) {
      li.classList.add("active");
    }

    li.addEventListener("dragstart", (event) => {
      state.dragItemId = item.id;
      li.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", item.id);
    });

    li.addEventListener("dragend", () => {
      state.dragItemId = null;
      li.classList.remove("dragging");
    });

    li.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    });

    li.addEventListener("drop", (event) => {
      event.preventDefault();
      moveQueueItem(state.dragItemId, item.id);
    });

    const kindLabel = inferKind(item.url);
    li.innerHTML = `
      <div class="queue-main">
        <div class="queue-grab" aria-hidden="true">⋮⋮</div>
        <div class="queue-text">
          <h3 class="queue-title">${escapeHtml(item.title || "Без названия")}</h3>
          <p class="queue-subtitle">${escapeHtml(item.author || "SoundCloud")} • ${kindLabel}</p>
          <p class="queue-url">${escapeHtml(item.url)}</p>
        </div>
      </div>
      <div class="queue-side">
        <button type="button" data-action="play" data-id="${item.id}">Play</button>
        <button type="button" data-action="up" data-id="${item.id}" ${index === 0 ? "disabled" : ""}>Up</button>
        <button type="button" data-action="down" data-id="${item.id}" ${index === state.queue.length - 1 ? "disabled" : ""}>Down</button>
        <button type="button" class="remove-button" data-action="remove" data-id="${item.id}">Remove</button>
      </div>
    `;

    els.queueList.appendChild(li);
  });

  els.queueList.querySelectorAll("button[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const itemId = button.dataset.id;
      const action = button.dataset.action;
      const index = state.queue.findIndex((item) => item.id === itemId);

      if (index === -1) {
        return;
      }

      if (action === "play") {
        loadQueueIndex(index, true);
      }

      if (action === "remove") {
        removeQueueItem(index);
      }

      if (action === "up") {
        moveQueueItemByIndex(index, index - 1);
      }

      if (action === "down") {
        moveQueueItemByIndex(index, index + 1);
      }
    });
  });
}

function renderNowPlaying() {
  const queueItem = state.queue[state.currentQueueIndex] || null;
  const currentSound = state.currentSound;
  const title = currentSound?.title || queueItem?.title || "Очередь пока пустая";
  const artist = currentSound?.user?.username || queueItem?.author || "Добавь ссылку на трек, плейлист или профиль SoundCloud.";
  const artwork = currentSound?.artwork_url || queueItem?.thumbnailUrl || "";
  const sourceUrl = currentSound?.permalink_url || queueItem?.url || "";

  els.trackTitle.textContent = title;
  els.trackArtist.textContent = artist;
  els.mobileTrackTitle.textContent = title;
  els.mobileTrackArtist.textContent = artist;
  els.openTrackLink.href = sourceUrl || "#";
  els.openTrackLink.classList.toggle("disabled-chip", !sourceUrl);

  if (artwork) {
    els.artworkImage.src = artwork.replace("-large", "-t500x500");
    els.artworkImage.hidden = false;
    els.artworkFallback.hidden = true;
  } else {
    els.artworkImage.hidden = true;
    els.artworkFallback.hidden = false;
  }

  if (queueItem) {
    if (state.collectionLength > 1) {
      els.collectionBadge.textContent = `${state.currentSoundIndex + 1}/${state.collectionLength}`;
    } else {
      els.collectionBadge.textContent = inferKind(queueItem.url);
    }
  } else {
    els.collectionBadge.textContent = "Single";
  }
}

function renderControls() {
  els.playButtonText.textContent = state.isPlaying ? "Pause" : "Play";
  els.mobilePlayButtonText.textContent = state.isPlaying ? "Pause" : "Play";
}

function renderToggles() {
  els.shuffleButton.textContent = state.shuffle ? "Shuffle on" : "Shuffle off";
  els.shuffleButton.classList.toggle("active", state.shuffle);

  const repeatText = {
    off: "Repeat off",
    all: "Repeat all",
    one: "Repeat one",
  }[state.repeatMode];

  els.repeatButton.textContent = repeatText;
  els.repeatBadge.textContent = repeatText;
  els.repeatButton.classList.toggle("active", state.repeatMode !== "off");

  els.muteButton.textContent = state.muted ? "Mute on" : "Mute off";
  els.muteButton.classList.toggle("active", state.muted);
}

function renderProgress(previewPosition = state.position) {
  const max = Math.max(state.duration, 1);
  const current = Math.min(Math.max(previewPosition, 0), max);
  const ratio = max <= 0 ? 0 : (current / max) * 100;
  els.progressInput.max = String(max);
  els.progressInput.value = String(current);
  updateRangeFill(els.progressInput, current, max);
  els.mobileProgressFill.style.width = `${ratio}%`;
  els.currentTime.textContent = formatTime(current);
  els.remainingTime.textContent = `-${formatTime(Math.max(state.duration - current, 0))}`;
}

function renderQueueSummary() {
  els.queueSummary.textContent = `${state.queue.length} ${pluralizeItems(state.queue.length)}`;
}

function renderVolume() {
  els.volumeInput.value = String(state.volume);
  updateRangeFill(els.volumeInput, state.volume, 100);
  els.volumeValue.textContent = state.muted ? "Без звука" : `${state.volume}%`;
}

async function handleAddTracks(event) {
  event.preventDefault();
  const rawValue = els.trackUrlInput.value.trim();
  if (!rawValue) {
    setStatus("Вставь хотя бы одну ссылку SoundCloud.");
    return;
  }

  const urls = extractSoundCloudInputs(rawValue);
  if (!urls.length) {
    setStatus("Не нашел ссылку SoundCloud в вставленном тексте.", true);
    return;
  }

  const wasEmpty = state.queue.length === 0;
  let addedCount = 0;

  for (const rawUrl of urls) {
    try {
      const normalizedUrl = normalizeSoundCloudUrl(rawUrl);
      const item = await createQueueItem(normalizedUrl);
      state.queue.push(item);
      addedCount += 1;
      setStatus(`Добавляю: ${item.title}`);
    } catch (error) {
      console.warn(error);
      setStatus(`Не удалось добавить "${rawUrl}". Нужна публичная SoundCloud ссылка.`, true);
    }
  }

  if (!addedCount) {
    return;
  }

  if (state.currentQueueIndex === -1) {
    state.currentQueueIndex = 0;
  }

  persistState();
  render();

  if (wasEmpty) {
    await loadQueueIndex(0, false);
  }

  els.trackUrlInput.value = "";
  setStatus(`Готово. Добавлено: ${addedCount}.`);
}

async function createQueueItem(url) {
  let meta = {
    title: fallbackTitle(url),
    author: "SoundCloud",
    thumbnailUrl: "",
  };

  try {
    const response = await fetch(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}&maxheight=166&show_comments=false`);
    if (!response.ok) {
      throw new Error(`oEmbed failed: ${response.status}`);
    }

    const data = await response.json();
    meta = {
      title: data.title || meta.title,
      author: data.author_name || meta.author,
      thumbnailUrl: data.thumbnail_url || "",
    };
  } catch (error) {
    console.warn("oEmbed metadata failed", error);
  }

  return {
    id: createId(),
    url,
    title: meta.title,
    author: meta.author,
    thumbnailUrl: meta.thumbnailUrl,
  };
}

async function loadQueueIndex(index, autoplay = true, options = {}) {
  if (!state.widget || !state.widgetReady) {
    setStatus("Widget еще загружается, попробуй через секунду.");
    return;
  }

  const item = state.queue[index];
  if (!item) {
    return;
  }

  const shouldAutoplay = Boolean(autoplay);
  state.currentQueueIndex = index;
  state.position = 0;
  state.duration = 0;
  state.currentSound = null;
  state.collectionLength = 1;
  state.currentSoundIndex = 0;
  state.isPlaying = shouldAutoplay;

  els.statusPill.textContent = shouldAutoplay ? "Loading" : "Ready";
  render();

  state.widget.load(item.url, {
    auto_play: shouldAutoplay,
    buying: false,
    sharing: false,
    download: false,
    show_artwork: true,
    show_playcount: false,
    show_user: true,
    single_active: false,
    start_track: Number.isInteger(options.startTrack) ? options.startTrack : 0,
    color: state.accent,
    callback: async () => {
      await applyVolumeToWidget();
      if (typeof options.seekPosition === "number" && options.seekPosition > 0) {
        state.widget.seekTo(options.seekPosition);
      }
      await syncWidgetState();
      persistState();
      render();

      if (!shouldAutoplay && !options.preservePlayState) {
        state.isPlaying = false;
        renderControls();
      }

      setStatus(`Загружено: ${item.title}`);
    },
  });
}

async function syncWidgetState() {
  await Promise.all([syncCollectionState(), syncCurrentSound(), syncDuration(), syncPlaybackState()]);
  renderNowPlaying();
  renderProgress();
  renderQueue();
  updateMediaSession();
}

async function syncCollectionState() {
  const sounds = await getWidgetValue("getSounds");
  const currentSoundIndex = await getWidgetValue("getCurrentSoundIndex");
  state.collectionLength = Array.isArray(sounds) && sounds.length ? sounds.length : 1;
  state.currentSoundIndex = Number.isInteger(currentSoundIndex) ? currentSoundIndex : 0;
}

async function syncCurrentSound() {
  const sound = await getWidgetValue("getCurrentSound");
  if (sound) {
    state.currentSound = sound;
  }
}

async function syncDuration() {
  const duration = await getWidgetValue("getDuration");
  if (typeof duration === "number" && duration >= 0) {
    state.duration = duration;
  }
}

async function syncPlaybackState() {
  const paused = await getWidgetValue("isPaused");
  if (typeof paused === "boolean") {
    state.isPlaying = !paused;
  }
}

async function togglePlayPause() {
  if (!state.queue.length) {
    await addDemoTrack();
    return;
  }

  if (!state.widget || !state.widgetReady) {
    setStatus("Widget еще не готов.");
    return;
  }

  if (state.currentQueueIndex === -1) {
    await loadQueueIndex(0, true);
    return;
  }

  if (state.isPlaying) {
    pausePlayback();
  } else {
    resumePlayback();
  }
}

function resumePlayback() {
  if (!state.widget || !state.widgetReady) {
    return;
  }
  state.widget.play();
}

function pausePlayback() {
  if (!state.widget || !state.widgetReady) {
    return;
  }
  state.widget.pause();
}

async function goToNext({ autoplay = true, fromFinish = false } = {}) {
  if (!state.queue.length) {
    return;
  }

  await syncCollectionState();
  if (!fromFinish && state.collectionLength > 1 && state.currentSoundIndex < state.collectionLength - 1) {
    state.widget.next();
    return;
  }

  if (state.shuffle && state.queue.length > 1) {
    let nextIndex = state.currentQueueIndex;
    while (nextIndex === state.currentQueueIndex) {
      nextIndex = Math.floor(Math.random() * state.queue.length);
    }
    await loadQueueIndex(nextIndex, autoplay);
    return;
  }

  const isLastItem = state.currentQueueIndex >= state.queue.length - 1;
  if (isLastItem) {
    if (state.repeatMode === "all") {
      await loadQueueIndex(0, autoplay);
    } else {
      state.isPlaying = false;
      els.statusPill.textContent = "Finished";
      renderControls();
    }
    return;
  }

  await loadQueueIndex(state.currentQueueIndex + 1, autoplay);
}

async function handlePrev() {
  if (!state.widget || !state.widgetReady || !state.queue.length) {
    return;
  }

  if (state.position > 5000) {
    state.widget.seekTo(0);
    return;
  }

  await syncCollectionState();
  if (state.collectionLength > 1 && state.currentSoundIndex > 0) {
    state.widget.prev();
    return;
  }

  if (state.currentQueueIndex > 0) {
    await loadQueueIndex(state.currentQueueIndex - 1, true);
  } else if (state.repeatMode === "all") {
    await loadQueueIndex(state.queue.length - 1, true);
  } else {
    state.widget.seekTo(0);
  }
}

function handleVolumeInput(event) {
  const nextVolume = clampNumber(Number(event.target.value), 0, 100, 80);
  state.volume = nextVolume;
  state.lastVolume = nextVolume || state.lastVolume || 80;
  state.muted = nextVolume === 0;
  applyVolumeToWidget();
  renderVolume();
  renderToggles();
  persistState();
}

function handleProgressPreview(event) {
  const previewValue = Number(event.target.value);
  renderProgress(previewValue);
}

function handleSeekChange(event) {
  const nextPosition = Number(event.target.value);
  state.position = nextPosition;
  renderProgress();

  if (state.widget && state.widgetReady) {
    state.widget.seekTo(nextPosition);
  }

  state.isSeeking = false;
}

async function applyVolumeToWidget() {
  if (!state.widget || !state.widgetReady) {
    return;
  }

  const effectiveVolume = state.muted ? 0 : state.volume;
  state.widget.setVolume(effectiveVolume);
}

function toggleMute() {
  if (!state.muted) {
    state.lastVolume = state.volume || state.lastVolume || 80;
  }
  state.muted = !state.muted;
  if (!state.muted && state.volume === 0) {
    state.volume = state.lastVolume || 80;
  }
  applyVolumeToWidget();
  renderVolume();
  renderToggles();
  persistState();
}

function toggleShuffle() {
  state.shuffle = !state.shuffle;
  renderToggles();
  persistState();
}

function cycleRepeatMode() {
  const currentIndex = REPEAT_MODES.indexOf(state.repeatMode);
  state.repeatMode = REPEAT_MODES[(currentIndex + 1) % REPEAT_MODES.length];
  renderToggles();
  persistState();
}

async function addDemoTrack() {
  const existingIndex = state.queue.findIndex((item) => item.url === DEMO_TRACK);
  if (existingIndex >= 0) {
    await loadQueueIndex(existingIndex, true);
    return;
  }

  const item = await createQueueItem(DEMO_TRACK);
  state.queue.push(item);
  state.currentQueueIndex = state.currentQueueIndex === -1 ? 0 : state.currentQueueIndex;
  persistState();
  render();
  await loadQueueIndex(state.queue.length - 1, true);
  setStatus("Демо-трек добавлен.");
}

function clearQueue() {
  if (!state.queue.length) {
    return;
  }

  const confirmed = window.confirm("Очистить всю очередь?");
  if (!confirmed) {
    return;
  }

  state.queue = [];
  state.currentQueueIndex = -1;
  state.currentSound = null;
  state.position = 0;
  state.duration = 0;
  state.isPlaying = false;
  if (state.widget && state.widgetReady) {
    state.widget.pause();
  }
  persistState();
  render();
  els.statusPill.textContent = "Idle";
  setStatus("Очередь очищена.");
}

function removeQueueItem(index) {
  const [removed] = state.queue.splice(index, 1);
  if (!removed) {
    return;
  }

  if (index < state.currentQueueIndex) {
    state.currentQueueIndex -= 1;
  } else if (index === state.currentQueueIndex) {
    if (state.queue.length === 0) {
      state.currentQueueIndex = -1;
      state.currentSound = null;
      state.isPlaying = false;
      state.position = 0;
      state.duration = 0;
    } else {
      state.currentQueueIndex = Math.min(index, state.queue.length - 1);
      loadQueueIndex(state.currentQueueIndex, false);
    }
  }

  persistState();
  render();
  setStatus(`Удалено: ${removed.title}`);
}

function moveQueueItem(sourceId, targetId) {
  if (!sourceId || !targetId || sourceId === targetId) {
    return;
  }

  const sourceIndex = state.queue.findIndex((item) => item.id === sourceId);
  const targetIndex = state.queue.findIndex((item) => item.id === targetId);
  if (sourceIndex === -1 || targetIndex === -1) {
    return;
  }

  const [moved] = state.queue.splice(sourceIndex, 1);
  state.queue.splice(targetIndex, 0, moved);

  if (state.currentQueueIndex === sourceIndex) {
    state.currentQueueIndex = targetIndex;
  } else if (sourceIndex < state.currentQueueIndex && targetIndex >= state.currentQueueIndex) {
    state.currentQueueIndex -= 1;
  } else if (sourceIndex > state.currentQueueIndex && targetIndex <= state.currentQueueIndex) {
    state.currentQueueIndex += 1;
  }

  persistState();
  renderQueue();
  renderQueueSummary();
  setStatus("Очередь обновлена.");
}

function moveQueueItemByIndex(sourceIndex, targetIndex) {
  if (
    sourceIndex < 0 ||
    sourceIndex >= state.queue.length ||
    targetIndex < 0 ||
    targetIndex >= state.queue.length ||
    sourceIndex === targetIndex
  ) {
    return;
  }

  const sourceId = state.queue[sourceIndex]?.id;
  const targetId = state.queue[targetIndex]?.id;
  moveQueueItem(sourceId, targetId);
}

async function exportQueue() {
  const payload = {
    exportedAt: new Date().toISOString(),
    queue: state.queue,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "mplayer-queue.json";
  link.click();
  URL.revokeObjectURL(url);
  setStatus("Очередь экспортирована.");
}

async function importQueue(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const importedItems = Array.isArray(parsed) ? parsed : parsed.queue;
    if (!Array.isArray(importedItems)) {
      throw new Error("Invalid queue format");
    }

    const sanitizedItems = importedItems
      .filter((item) => item && typeof item.url === "string")
      .map((item) => ({
        id: createId(),
        url: item.url,
        title: item.title || fallbackTitle(item.url),
        author: item.author || "SoundCloud",
        thumbnailUrl: item.thumbnailUrl || "",
      }));

    state.queue = sanitizedItems;
    state.currentQueueIndex = sanitizedItems.length ? 0 : -1;
    persistState();
    render();

    if (sanitizedItems.length) {
      await loadQueueIndex(0, false);
    }

    setStatus(`Импортировано: ${sanitizedItems.length}.`);
  } catch (error) {
    console.warn(error);
    setStatus("Не удалось импортировать JSON очередь.", true);
  } finally {
    event.target.value = "";
  }
}

async function copyCurrentTrackLink() {
  const url = state.currentSound?.permalink_url || state.queue[state.currentQueueIndex]?.url;
  if (!url) {
    setStatus("Сейчас нечего копировать.");
    return;
  }

  try {
    if (window.desktopAPI?.writeClipboardText) {
      await window.desktopAPI.writeClipboardText(url);
    } else {
      await navigator.clipboard.writeText(url);
    }
    setStatus("Ссылка скопирована.");
  } catch (error) {
    console.warn(error);
    setStatus("Браузер не дал скопировать ссылку.", true);
  }
}

async function applyAccent(color, options = {}) {
  const { syncWidget = false } = options;
  state.accent = color;
  document.documentElement.style.setProperty("--accent", color);
  document.documentElement.style.setProperty("--accent-soft", hexToRgba(color, 0.18));
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", color);
  els.accentInput.value = color;
  localStorage.setItem(STORAGE_KEYS.accent, color);

  if (!syncWidget || !state.widget || !state.widgetReady || state.currentQueueIndex < 0) {
    return;
  }

  const [seekPosition, startTrack] = await Promise.all([
    getWidgetValue("getPosition"),
    getWidgetValue("getCurrentSoundIndex"),
  ]);

  await loadQueueIndex(state.currentQueueIndex, state.isPlaying, {
    preservePlayState: true,
    seekPosition: typeof seekPosition === "number" ? seekPosition : 0,
    startTrack: Number.isInteger(startTrack) ? startTrack : 0,
  });
}

function handleKeydown(event) {
  const activeTag = document.activeElement?.tagName;
  if (activeTag === "TEXTAREA" || activeTag === "INPUT") {
    return;
  }

  if (event.code === "Space") {
    event.preventDefault();
    togglePlayPause();
  }

  if (event.code === "ArrowRight") {
    event.preventDefault();
    goToNext({ autoplay: true });
  }

  if (event.code === "ArrowLeft") {
    event.preventDefault();
    handlePrev();
  }

  if (event.key.toLowerCase() === "m") {
    toggleMute();
  }

  if (event.key.toLowerCase() === "s") {
    toggleShuffle();
  }

  if (event.key.toLowerCase() === "r") {
    cycleRepeatMode();
  }
}

function persistState() {
  localStorage.setItem(STORAGE_KEYS.queue, JSON.stringify(state.queue));
  localStorage.setItem(
    STORAGE_KEYS.settings,
    JSON.stringify({
      shuffle: state.shuffle,
      repeatMode: state.repeatMode,
      volume: state.volume,
      muted: state.muted,
      lastVolume: state.lastVolume,
      currentQueueIndex: state.currentQueueIndex,
    }),
  );
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  if (!window.location.protocol.startsWith("http")) {
    return;
  }

  navigator.serviceWorker.register("./sw.js").catch((error) => {
    console.warn("Service worker registration failed", error);
  });
}

function updateMediaSession() {
  if (!("mediaSession" in navigator)) {
    return;
  }

  const queueItem = state.queue[state.currentQueueIndex] || null;
  const currentSound = state.currentSound || null;
  const title = currentSound?.title || queueItem?.title;
  const artist = currentSound?.user?.username || queueItem?.author;
  const artwork = currentSound?.artwork_url || queueItem?.thumbnailUrl || "";

  navigator.mediaSession.playbackState = title ? (state.isPlaying ? "playing" : "paused") : "none";

  if ("MediaMetadata" in window && title) {
    navigator.mediaSession.metadata = new window.MediaMetadata({
      title,
      artist: artist || "SoundCloud",
      album: "Mplayer SoundCloud",
      artwork: artwork
        ? [
            {
              src: artwork.replace("-large", "-t500x500"),
              sizes: "500x500",
              type: "image/jpeg",
            },
          ]
        : [],
    });
  } else {
    navigator.mediaSession.metadata = null;
  }

  setMediaSessionAction("play", () => {
    if (!state.isPlaying) {
      resumePlayback();
    }
  });
  setMediaSessionAction("pause", () => {
    if (state.isPlaying) {
      pausePlayback();
    }
  });
  setMediaSessionAction("previoustrack", () => {
    handlePrev();
  });
  setMediaSessionAction("nexttrack", () => {
    goToNext({ autoplay: true });
  });
  setMediaSessionAction("stop", () => {
    pausePlayback();
  });
  setMediaSessionAction("seekbackward", (details) => {
    if (!state.widget || !state.widgetReady) {
      return;
    }

    const offset = details.seekOffset || 10000;
    state.widget.seekTo(Math.max(state.position - offset, 0));
  });
  setMediaSessionAction("seekforward", (details) => {
    if (!state.widget || !state.widgetReady) {
      return;
    }

    const offset = details.seekOffset || 10000;
    state.widget.seekTo(Math.min(state.position + offset, state.duration));
  });
}

function setMediaSessionAction(action, handler) {
  try {
    navigator.mediaSession.setActionHandler(action, handler);
  } catch (error) {
    console.warn(`Media Session action is not supported: ${action}`, error);
  }
}

function setStatus(message, isError = false) {
  els.statusLine.textContent = message;
  els.statusLine.style.color = isError ? "#ffd5db" : "var(--muted)";
}

function updateRangeFill(element, value, max) {
  const ratio = max <= 0 ? 0 : (value / max) * 100;
  element.style.setProperty("--range-fill", `${ratio}%`);
}

function extractSoundCloudInputs(rawText) {
  const lines = rawText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const extractedUrls = [];
  for (const line of lines) {
    const foundUrls = extractUrlsFromText(line);
    if (foundUrls.length) {
      extractedUrls.push(...foundUrls);
    } else {
      extractedUrls.push(line);
    }
  }

  return [...new Set(extractedUrls.map(cleanExtractedUrl).filter(Boolean))];
}

function extractUrlsFromText(text) {
  const matches = text.match(/https?:\/\/[^\s<>"'()]+/gi) || [];
  return matches.map(cleanExtractedUrl).filter(Boolean);
}

function cleanExtractedUrl(url) {
  return String(url)
    .trim()
    .replace(/^[<("'`\[]+/, "")
    .replace(/[>)"'`\],.!?]+$/, "");
}

function normalizeSoundCloudUrl(rawUrl) {
  const withProtocol = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  const url = new URL(withProtocol);
  const host = url.hostname.toLowerCase();
  const validHost =
    host === "soundcloud.com" ||
    host.endsWith(".soundcloud.com") ||
    host === "snd.sc" ||
    host === "on.soundcloud.com";

  if (!validHost) {
    throw new Error("Only SoundCloud URLs are supported");
  }

  return url.toString();
}

function inferKind(url) {
  if (url.includes("/sets/")) {
    return "Playlist";
  }
  const pathSegments = new URL(url).pathname.split("/").filter(Boolean);
  if (pathSegments.length === 1) {
    return "Profile";
  }
  return "Track";
}

function fallbackTitle(url) {
  try {
    const pathname = new URL(url).pathname.split("/").filter(Boolean).join(" / ");
    return pathname || "SoundCloud item";
  } catch (error) {
    return "SoundCloud item";
  }
}

function formatTime(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function createId() {
  return window.crypto?.randomUUID?.() || `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function pluralizeItems(count) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) {
    return "элемент";
  }
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return "элемента";
  }
  return "элементов";
}

function getWidgetValue(methodName) {
  return new Promise((resolve) => {
    if (!state.widget || !state.widgetReady || typeof state.widget[methodName] !== "function") {
      resolve(null);
      return;
    }

    try {
      state.widget[methodName]((value) => resolve(value));
    } catch (error) {
      console.warn(`Widget getter failed: ${methodName}`, error);
      resolve(null);
    }
  });
}

function hexToRgba(hex, alpha) {
  const normalized = hex.replace("#", "");
  const bigint = parseInt(normalized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

window.addEventListener("load", init);
