const params = new URLSearchParams(location.search);
const sessionId = params.get('session');

const HELP_URL =
  'https://github.com/izum00/multi-chrome-pip/tree/main#how-to-use';

const video = document.getElementById('video');
const stage = document.getElementById('stage');
const message = document.getElementById('message');

const siteNameElement = document.getElementById('siteName');
const connectionDot = document.getElementById('connectionDot');

const playPause = document.getElementById('playPause');
const centerPlayPause = document.getElementById('centerPlayPause');

const centerSeekBack = document.getElementById('centerSeekBack');
const centerSeekForward = document.getElementById('centerSeekForward');

const mute = document.getElementById('mute');
const fullscreen = document.getElementById('fullscreen');
const helpButton = document.getElementById('helpButton');

const speedButton = document.getElementById('speedButton');
const speedRange = document.getElementById('speedRange');

const volumeRange = document.getElementById('volumeRange');

const progress = document.getElementById('progress');
const currentTimeElement = document.getElementById('currentTime');
const durationElement = document.getElementById('duration');

let peer = null;
let pendingCandidates = [];
let remoteDescriptionSet = false;

let sourcePaused = true;
let sourceMuted = false;

let sourceCurrentTime = 0;
let sourceDuration = NaN;

let currentSpeed = 1;
let currentVolume = 1;

let isDraggingProgress = false;

/*
 * Hide UI if no interaction for 3 seconds
 */
const UI_HIDE_DELAY = 3000;
let hideTimer = null;

/*
 * Short press / long press detection for K key
 */
const KEY_HOLD_DELAY = 300;

let kKeyDown = false;
let kHoldTimer = null;
let kSeekInterval = null;

/*
 * Long press for j / ← / →
 */
const LONG_SEEK_INTERVAL = 250;

let activeSeekTimer = null;


/* =========================
   UI Display Control
========================= */

function showControls() {
  stage.classList.remove('controls-hidden');

  clearTimeout(hideTimer);

  hideTimer = setTimeout(() => {
    hideControls();
  }, UI_HIDE_DELAY);
}

function hideControls() {
  stage.classList.add('controls-hidden');

  clearTimeout(hideTimer);
  hideTimer = null;
}

function handlePointerActivity() {
  showControls();
}

/*
 * Reset the 3-second timer on any movement within the window
 */
stage.addEventListener('mousemove', handlePointerActivity);
stage.addEventListener('pointermove', handlePointerActivity);
stage.addEventListener('mousedown', handlePointerActivity);
stage.addEventListener('wheel', handlePointerActivity);

/*
 * Hide immediately when mouse leaves the window
 */
stage.addEventListener('mouseleave', () => {
  hideControls();
});

/*
 * When entering the tab
 */
stage.addEventListener('mouseenter', () => {
  showControls();
});

/*
 * Hide UI immediately after page load
 */
hideControls();


/* =========================
   Site Name
========================= */

function setSiteName(name) {
  if (!name) return;

  siteNameElement.textContent = name;
  document.title = `${name} - Pseudo PiP`;
}

/*
 * Helper for when passed to the viewer side
 */
setSiteName(
  params.get('siteTitle') ||
  params.get('site') ||
  'Video Site'
);


/* =========================
   Connection Status
========================= */

function setConnectionState(state) {
  connectionDot.className = 'connection-dot';

  switch (state) {
    case 'connected':
    case 'completed':
      connectionDot.classList.add('connected');
      break;

    case 'failed':
      connectionDot.classList.add('failed');
      break;

    case 'disconnected':
    case 'closed':
      connectionDot.classList.add('disconnected');
      break;

    default:
      connectionDot.classList.add('connecting');
      break;
  }
}


/* =========================
   Message Reception
========================= */

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.sessionId !== sessionId) return;

  if (msg.type === 'source-offer') {
    /*
     * Prefer the source page's title
     */
    if (msg.pageTitle) {
      setSiteName(msg.pageTitle);
    } else if (msg.siteTitle) {
      setSiteName(msg.siteTitle);
    }

    setupPeer(msg.offer).catch(showError);
    applyState(msg.state);

  } else if (msg.type === 'source-ice') {
    addIce(msg.candidate).catch(showError);

  } else if (msg.type === 'source-state') {
    applyState(msg.state);

  } else if (msg.type === 'source-error') {
    showError(msg.message);
  }
});


/* =========================
   WebRTC
========================= */

async function setupPeer(offer) {
  if (peer) {
    peer.close();
  }

  pendingCandidates = [];
  remoteDescriptionSet = false;

  setConnectionState('connecting');

  peer = new RTCPeerConnection({
    iceServers: [
      {
        urls: [
          'stun:stun.l.google.com:19302'
        ]
      }
    ]
  });

  peer.ontrack = (event) => {
    if (event.streams?.[0]) {
      video.srcObject = event.streams[0];

      video.play().catch((error) => {
        console.warn(error);
      });
    }
  };

  peer.onicecandidate = (event) => {
    if (!event.candidate) return;

    chrome.runtime.sendMessage({
      type: 'viewer-ice',
      sessionId,
      candidate: event.candidate.toJSON()
    }).catch(() => undefined);
  };

  peer.onconnectionstatechange = () => {
    const state = peer?.connectionState;

    setConnectionState(state);

    if (state === 'failed') {
      showError('WebRTC connection failed.');
    }

    if (state === 'closed') {
      showError('WebRTC connection was closed.');
    }
  };

  await peer.setRemoteDescription(offer);

  remoteDescriptionSet = true;

  for (const candidate of pendingCandidates.splice(0)) {
    await peer.addIceCandidate(candidate);
  }

  const answer = await peer.createAnswer();

  await peer.setLocalDescription(answer);

  chrome.runtime.sendMessage({
    type: 'viewer-answer',
    sessionId,
    answer: peer.localDescription?.toJSON()
  }).catch(showError);

  setConnectionState('connected');
}

async function addIce(candidateData) {
  const candidate = new RTCIceCandidate(candidateData);

  if (!remoteDescriptionSet || !peer) {
    pendingCandidates.push(candidate);
    return;
  }

  await peer.addIceCandidate(candidate);
}


/* =========================
   Commands
========================= */

function sendCommand(command, extra = {}) {
  chrome.runtime.sendMessage({
    type: 'viewer-command',
    sessionId,
    command,
    ...extra
  }).catch(showError);
}


/* =========================
   State
========================= */

function applyState(state) {
  if (!state) return;

  if (typeof state.paused === 'boolean') {
    sourcePaused = state.paused;
    updatePlayPauseButton();
  }

  if (typeof state.muted === 'boolean') {
    sourceMuted = state.muted;
    updateMuteButton();
  }

  /*
   * Important:
   * MediaStream's video.currentTime is NOT the same as
   * the source page's video.currentTime, so only use
   * the value received from the source page.
   */
  if (Number.isFinite(state.currentTime)) {
    sourceCurrentTime = Math.max(
      0,
      state.currentTime
    );
  }

  if (
    Number.isFinite(state.duration) &&
    state.duration > 0
  ) {
    sourceDuration = state.duration;
  }

  if (Number.isFinite(state.playbackRate)) {
    currentSpeed = state.playbackRate;
    speedRange.value = String(currentSpeed);
    speedButton.textContent = `${formatRate(currentSpeed)}x`;
  }

  if (Number.isFinite(state.volume)) {
    currentVolume = Math.max(
      0,
      Math.min(1, state.volume)
    );

    volumeRange.value = String(currentVolume);
  }

  updateProgress();
}


/* =========================
   Play / Pause
========================= */

function updatePlayPauseButton() {
  const icon = sourcePaused ? '▶' : 'Ⅱ';

  playPause.textContent = icon;
  centerPlayPause.textContent = icon;
}

function togglePlayPause() {
  if (sourcePaused) {
    sendCommand('play');
  } else {
    sendCommand('pause');
  }
}

playPause.addEventListener('click', togglePlayPause);
centerPlayPause.addEventListener('click', togglePlayPause);


/* =========================
   Seek
========================= */

function seekBy(delta) {
  /*
   * Do NOT touch viewer-side video.currentTime.
   * Always send to the source page.
   */
  sendCommand('seek', {
    delta
  });
}

centerSeekBack.addEventListener('click', () => {
  seekBy(-5);
});

centerSeekForward.addEventListener('click', () => {
  seekBy(5);
});


/* =========================
   Mute
========================= */

function updateMuteButton() {
  mute.textContent = sourceMuted ? '🔇' : '🔊';
}

mute.addEventListener('click', () => {
  sendCommand('toggle-mute');
});


/* =========================
   Playback Speed
========================= */

function formatRate(value) {
  return Number(value)
    .toFixed(2)
    .replace(/\.?0+$/, '');
}

function setPlaybackRate(value) {
  const rate = Math.max(
    0.25,
    Math.min(2, Number(value))
  );

  if (!Number.isFinite(rate)) return;

  currentSpeed = rate;

  speedRange.value = String(rate);
  speedButton.textContent = `${formatRate(rate)}x`;

  sendCommand('set-speed', {
    speed: rate
  });
}

speedRange.addEventListener('input', () => {
  setPlaybackRate(speedRange.value);
});

document
  .querySelectorAll('[data-speed]')
  .forEach((button) => {
    button.addEventListener('click', () => {
      setPlaybackRate(button.dataset.speed);
    });
  });

function changePlaybackRate(delta) {
  setPlaybackRate(
    Math.round((currentSpeed + delta) * 20) / 20
  );
}


/* =========================
   Volume
========================= */

function setVolume(value) {
  const volume = Math.max(
    0,
    Math.min(1, Number(value))
  );

  if (!Number.isFinite(volume)) return;

  currentVolume = volume;

  volumeRange.value = String(volume);

  if (volume === 0) {
    mute.textContent = '🔇';
  } else {
    mute.textContent = '🔊';
  }

  sendCommand('set-volume', {
    volume
  });
}

volumeRange.addEventListener('input', () => {
  setVolume(volumeRange.value);
});

document
  .querySelectorAll('[data-volume]')
  .forEach((button) => {
    button.addEventListener('click', () => {
      setVolume(button.dataset.volume);
    });
  });

function changeVolume(delta) {
  setVolume(
    Math.round(
      (currentVolume + delta) * 100
    ) / 100
  );
}


/* =========================
   Fullscreen
========================= */

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await stage.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (error) {
    console.warn('Fullscreen error:', error);
  }
}

fullscreen.addEventListener('click', toggleFullscreen);

document.addEventListener('fullscreenchange', () => {
  fullscreen.textContent =
    document.fullscreenElement
      ? '×'
      : '⛶';
});


/* =========================
   Help
========================= */

helpButton.addEventListener('click', () => {
  chrome.tabs.create({
    url: HELP_URL
  }).catch(() => {
    window.open(
      HELP_URL,
      '_blank',
      'noopener,noreferrer'
    );
  });
});


/* =========================
   Progress Bar
========================= */

function formatTime(seconds) {
  if (
    !Number.isFinite(seconds) ||
    seconds < 0
  ) {
    return '0:00';
  }

  const totalSeconds = Math.floor(seconds);

  const hours =
    Math.floor(totalSeconds / 3600);

  const minutes =
    Math.floor(
      (totalSeconds % 3600) / 60
    );

  const secs =
    totalSeconds % 60;

  if (hours > 0) {
    return (
      `${hours}:` +
      `${String(minutes).padStart(2, '0')}:` +
      `${String(secs).padStart(2, '0')}`
    );
  }

  return (
    `${minutes}:` +
    `${String(secs).padStart(2, '0')}`
  );
}

function updateProgress() {
  if (isDraggingProgress) return;

  const current =
    Math.max(0, sourceCurrentTime);

  const duration =
    sourceDuration;

  currentTimeElement.textContent =
    formatTime(current);

  durationElement.textContent =
    formatTime(duration);

  if (
    Number.isFinite(duration) &&
    duration > 0
  ) {
    const value = Math.max(
      0,
      Math.min(
        100,
        (current / duration) * 100
      )
    );

    progress.value = String(value);
  } else {
    progress.value = '0';
  }
}

progress.addEventListener(
  'pointerdown',
  () => {
    isDraggingProgress = true;
    showControls();
  }
);

progress.addEventListener(
  'pointerup',
  () => {
    isDraggingProgress = false;
    updateProgress();
    showControls();
  }
);

progress.addEventListener(
  'input',
  () => {
    const duration =
      sourceDuration;

    if (
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      return;
    }

    const targetTime =
      (Number(progress.value) / 100) *
      duration;

    currentTimeElement.textContent =
      formatTime(targetTime);
  }
);

progress.addEventListener(
  'change',
  () => {
    const duration =
      sourceDuration;

    if (
      !Number.isFinite(duration) ||
      duration <= 0
    ) {
      isDraggingProgress = false;
      return;
    }

    const targetTime =
      (Number(progress.value) / 100) *
      duration;

    const delta =
      targetTime -
      sourceCurrentTime;

    if (Math.abs(delta) > 0.01) {
      sendCommand('seek', {
        delta
      });
    }

    isDraggingProgress = false;
  }
);


/* =========================
   Keyboard
========================= */

function isTypingTarget(target) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}


/*
 * Repeatable seek (long press)
 */
function startSeekRepeat(delta) {
  if (activeSeekTimer) {
    clearInterval(activeSeekTimer);
  }

  seekBy(delta);

  activeSeekTimer =
    setInterval(() => {
      seekBy(delta);
    }, LONG_SEEK_INTERVAL);
}

function stopSeekRepeat() {
  if (!activeSeekTimer) return;

  clearInterval(activeSeekTimer);
  activeSeekTimer = null;
}


/*
 * K key
 *
 * Short press:
 *   Play/Pause
 *
 * Long press:
 *   Repeat 5-second forward
 */
function startKKey() {
  if (kKeyDown) return;

  kKeyDown = true;

  kHoldTimer = setTimeout(() => {
    kHoldTimer = null;

    startSeekRepeat(5);

    if (navigator.vibrate) {
      navigator.vibrate(20);
    }
  }, KEY_HOLD_DELAY);
}

function endKKey() {
  if (!kKeyDown) return;

  kKeyDown = false;

  if (kHoldTimer) {
    clearTimeout(kHoldTimer);
    kHoldTimer = null;

    /*
     * Not a long press, so toggle play/pause
     */
    togglePlayPause();
  }

  stopSeekRepeat();
}


document.addEventListener(
  'keydown',
  (event) => {
    if (isTypingTarget(event.target)) {
      return;
    }

    showControls();

    /*
     * Suppress browser key repeat when held down
     */
    if (
      event.code === 'KeyK' &&
      !event.repeat
    ) {
      event.preventDefault();
      startKKey();
      return;
    }

    /*
     * For K long-press repeat events, rely on our own timer
     */
    if (event.code === 'KeyK') {
      event.preventDefault();
      return;
    }

    /*
     * Space
     */
    if (
      event.code === 'Space'
    ) {
      event.preventDefault();

      if (!event.repeat) {
        togglePlayPause();
      }

      return;
    }

    /*
     * ← / J
     *
     * Long press supported
     */
    if (
      event.code === 'ArrowLeft' ||
      event.code === 'KeyJ'
    ) {
      event.preventDefault();

      if (!event.repeat) {
        startSeekRepeat(-5);
      }

      return;
    }

    /*
     * →
     *
     * 5-second forward
     */
    if (
      event.code === 'ArrowRight'
    ) {
      event.preventDefault();

      if (!event.repeat) {
        startSeekRepeat(5);
      }

      return;
    }

    /*
     * 0-9
     *
     * 0 = 0%
     * 1 = 10%
     * ...
     * 9 = 90%
     */
    if (
      event.code >= 'Digit0' &&
      event.code <= 'Digit9'
    ) {
      event.preventDefault();

      if (
        !Number.isFinite(sourceDuration) ||
        sourceDuration <= 0
      ) {
        return;
      }

      const digit =
        Number(event.code.slice(5));

      const ratio =
        digit / 10;

      const targetTime =
        sourceDuration * ratio;

      const delta =
        targetTime -
        sourceCurrentTime;

      sendCommand('seek', {
        delta
      });

      return;
    }

    /*
     * F
     */
    if (
      event.code === 'KeyF'
    ) {
      event.preventDefault();

      if (!event.repeat) {
        toggleFullscreen();
      }

      return;
    }

    /*
     * ↑
     * Volume up 10%
     */
    if (
      event.code === 'ArrowUp'
    ) {
      event.preventDefault();

      if (!event.repeat) {
        changeVolume(0.10);
      }

      return;
    }

    /*
     * ↓
     * Volume down 10%
     */
    if (
      event.code === 'ArrowDown'
    ) {
      event.preventDefault();

      if (!event.repeat) {
        changeVolume(-0.10);
      }

      return;
    }

    /*
     * M
     */
    if (
      event.code === 'KeyM'
    ) {
      event.preventDefault();

      if (!event.repeat) {
        sendCommand('toggle-mute');
      }

      return;
    }

    /*
     * , / <
     *
     * Slow down 5%
     */
    if (
      event.code === 'Comma'
    ) {
      event.preventDefault();

      if (!event.repeat) {
        changePlaybackRate(-0.05);
      }

      return;
    }

    /*
     * . / >
     *
     * Speed up 5%
     */
    if (
      event.code === 'Period'
    ) {
      event.preventDefault();

      if (!event.repeat) {
        changePlaybackRate(0.05);
      }

      return;
    }
  }
);

document.addEventListener(
  'keyup',
  (event) => {
    if (
      event.code === 'KeyK'
    ) {
      endKKey();
      return;
    }

    if (
      event.code === 'ArrowLeft' ||
      event.code === 'KeyJ' ||
      event.code === 'ArrowRight'
    ) {
      stopSeekRepeat();
    }
  }
);


/* =========================
   Video Events
========================= */

/*
 * Do NOT assign video.currentTime to sourceCurrentTime here.
 * MediaStream time does NOT match the source video time.
 */
video.addEventListener('play', () => {
  /*
   * Actual state is received via source-state
   */
});

video.addEventListener('pause', () => {
  /*
   * Actual state is received via source-state
   */
});

video.addEventListener('error', () => {
  showError(
    'Could not play video stream. ' +
    'DRM-protected content from the source page is not supported.'
  );
});


/* =========================
   Error
========================= */

function showError(error) {
  const text =
    error instanceof Error
      ? error.message
      : String(error);

  message.textContent = text;
  message.classList.remove('hidden');

  setConnectionState('failed');
}


/* =========================
   Initialization
========================= */

if (!sessionId) {
  showError(
    'No session information found.'
  );
} else {
  setConnectionState('connecting');

  chrome.runtime.sendMessage({
    type: 'viewer-ready',
    sessionId
  }).catch(showError);
}


/* =========================
   Cleanup
========================= */

window.addEventListener(
  'beforeunload',
  () => {
    stopSeekRepeat();

    if (kHoldTimer) {
      clearTimeout(kHoldTimer);
      kHoldTimer = null;
    }

    peer?.close();
  }
);