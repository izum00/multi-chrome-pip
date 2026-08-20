(() => {
  const TOKEN_ATTR = 'data-pseudo-pip-token';
  let lastContextTarget = null;
  let sourceSession = null;
  let sourcePeer = null;
  let sourceStream = null;
  let candidateQueue = [];

  function ensureToken(element) {
    if (!(element instanceof Element)) return null;
    let token = element.getAttribute(TOKEN_ATTR);
    if (!token) {
      token = crypto.randomUUID();
      element.setAttribute(TOKEN_ATTR, token);
    }
    return token;
  }

  function findVideo(target) {
    if (!(target instanceof Element)) return null;

    if (target instanceof HTMLVideoElement) {
      return target;
    }

    const nested = target.querySelector('video');
    if (nested) {
      return nested;
    }

    const videos = document.querySelectorAll('video');

    console.log(
      '[PseudoPiP] all videos:',
      [...videos].map((v) => ({
        className: v.className,
        currentSrc: v.currentSrc,
        readyState: v.readyState,
        videoWidth: v.videoWidth,
        videoHeight: v.videoHeight,
        paused: v.paused
      }))
    );

    return null;
  }

  function describeTarget(target) {
    const video = findVideo(target);
    return { token: ensureToken(target), hasVideo: !!video };
  }

  document.addEventListener('contextmenu', (event) => {
    const element = event.target instanceof Element ? event.target : null;
    if (!element) return;
    lastContextTarget = element;
    const data = describeTarget(element);
    chrome.runtime.sendMessage({ type: 'context-target', ...data })
      .catch((error) => {
        // Ignore "Extension context invalidated" errors
        if (error?.message?.includes('Extension context invalidated')) {
          // Do nothing (extension was updated)
          return;
        }
        // Log other errors (optional)
        console.warn('Failed to send context-target:', error);
      });
  }, true);

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'pip-start') {
      startSource(message).catch((error) => {
        chrome.runtime.sendMessage({
          type: 'source-error',
          sessionId: message.sessionId,
          message: formatError(error)
        }).catch(() => undefined);
      });
    } else if (message.type === 'viewer-answer') {
      handleViewerAnswer(message).catch((error) => sendSourceError(message.sessionId, formatError(error)));
    } else if (message.type === 'viewer-ice') {
      handleViewerIce(message).catch(() => undefined);
    } else if (message.type === 'viewer-command') {
      handleViewerCommand(message).catch(() => undefined);
    } else if (message.type === 'pip-closed') {
      stopSource(message.sessionId);
    }
  });

  async function startSource(message) {
    stopSource();
    const target = findByToken(message.targetToken) || lastContextTarget;
    const video = findVideo(target);
    if (!video) {
      throw new Error('No <video> found in the right-clicked element or its contents.');
    }

    if (typeof video.captureStream !== 'function') {
      throw new Error('video.captureStream() is not available in this Chrome environment.');
    }

    sourceSession = { id: message.sessionId, video };
    candidateQueue = [];

    const pushState = () => {
      if (!sourceSession || sourceSession.video !== video) return;
      chrome.runtime.sendMessage({
        type: 'source-state',
        sessionId: message.sessionId,
        state: readVideoState(video)
      }).catch(() => undefined);
    };
    video.addEventListener('play', pushState);
    video.addEventListener('pause', pushState);
    video.addEventListener('volumechange', pushState);
    sourceSession.pushState = pushState;

    try {
      const emeUsed = !!video.mediaKeys;

      alert(
        emeUsed
          ? 'EME is in use. This video cannot be captured due to browser security restrictions. This is a known issue and we are looking for a fix.'
          : 'EME is not in use.'
      );

      console.log(
        '[PseudoPiP] EME:',
        emeUsed,
        'mediaKeys:',
        video.mediaKeys
      );

      sourceStream = video.captureStream();

      if (!sourceStream) {
        throw new Error(
          'captureStream() did not return a MediaStream.'
        );
      }

      console.log(
        '[PseudoPiP] captureStream:',
        sourceStream,
        'videoWidth:',
        video.videoWidth,
        'videoHeight:',
        video.videoHeight,
        'readyState:',
        video.readyState,
        'paused:',
        video.paused,
        'currentSrc:',
        video.currentSrc
      );

      console.log(
        '[PseudoPiP] tracks:',
        sourceStream.getTracks().map((track) => ({
          kind: track.kind,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState
        }))
      );
    } catch (error) {
      console.error(
        '[PseudoPiP] captureStream failed:',
        error
      );

      throw new Error(
        `captureStream() failed: ${error?.name || 'UnknownError'} ${error?.message || ''}`
      );
    }
    sourcePeer = new RTCPeerConnection({
      iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }]
    });

    for (const track of sourceStream.getTracks()) {
      sourcePeer.addTrack(track, sourceStream);
    }

    sourcePeer.onicecandidate = (event) => {
      if (!event.candidate) return;
      chrome.runtime.sendMessage({
        type: 'source-ice',
        sessionId: message.sessionId,
        candidate: event.candidate.toJSON()
      }).catch(() => undefined);
    };

    sourcePeer.onconnectionstatechange = () => {
      const state = sourcePeer?.connectionState;
      if (state === 'failed' || state === 'closed') {
        sendSourceError(message.sessionId, `WebRTC connection became ${state}.`);
      }
    };

    const offer = await sourcePeer.createOffer();
    await sourcePeer.setLocalDescription(offer);

    chrome.runtime.sendMessage({
      type: 'source-offer',
      sessionId: message.sessionId,
      offer: sourcePeer.localDescription?.toJSON(),
      state: readVideoState(video)
    }).catch(() => undefined);
  }

  async function handleViewerAnswer(message) {
    if (!sourcePeer || !sourceSession || sourceSession.id !== message.sessionId) return;
    await sourcePeer.setRemoteDescription(message.answer);
    for (const candidate of candidateQueue.splice(0)) {
      await sourcePeer.addIceCandidate(candidate);
    }
  }

  async function handleViewerIce(message) {
    if (!sourcePeer || !sourceSession || sourceSession.id !== message.sessionId) return;
    const candidate = new RTCIceCandidate(message.candidate);
    if (sourcePeer.remoteDescription) {
      await sourcePeer.addIceCandidate(candidate);
    } else {
      candidateQueue.push(candidate);
    }
  }

  async function handleViewerCommand(message) {
    if (!sourceSession || sourceSession.id !== message.sessionId) return;
    const video = sourceSession.video;
    switch (message.command) {
      case 'play':
        await video.play();
        break;
      case 'pause':
        video.pause();
        break;
      case 'toggle-mute':
        video.muted = !video.muted;
        break;
      case 'seek': {
        const duration = Number.isFinite(video.duration) ? video.duration : Infinity;
        video.currentTime = Math.max(0, Math.min(video.currentTime + Number(message.delta || 0), duration));
        break;
      }
      case 'close':
        stopSource(message.sessionId);
        break;
    }
    chrome.runtime.sendMessage({
      type: 'source-state',
      sessionId: message.sessionId,
      state: readVideoState(video)
    }).catch(() => undefined);
  }

  function readVideoState(video) {
    return {
      paused: video.paused,
      muted: video.muted,
      currentTime: video.currentTime,
      duration: Number.isFinite(video.duration) ? video.duration : null,
      title: document.title,
      src: video.currentSrc || video.src || ''
    };
  }

  function findByToken(token) {
    if (!token) return null;
    return document.querySelector(`[${TOKEN_ATTR}="${CSS.escape(token)}"]`);
  }

  function stopSource(sessionId) {
    if (sessionId && sourceSession?.id !== sessionId) return;
    if (sourceSession?.video && sourceSession.pushState) {
      const { video, pushState } = sourceSession;
      video.removeEventListener('play', pushState);
      video.removeEventListener('pause', pushState);
      video.removeEventListener('volumechange', pushState);
    }
    try { sourcePeer?.close(); } catch { }
    sourcePeer = null;
    sourceStream?.getTracks().forEach((track) => track.stop());
    sourceStream = null;
    sourceSession = null;
    candidateQueue = [];
  }

  function sendSourceError(sessionId, message) {
    chrome.runtime.sendMessage({ type: 'source-error', sessionId, message }).catch(() => undefined);
  }

  function formatError(error) {
    return error instanceof Error ? error.message : String(error);
  }
})();