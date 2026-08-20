const MENU_ID = 'pseudo-pip';
const sessions = new Map();
const latestTargets = new Map();

function key(tabId, frameId) {
  return `${tabId}:${frameId}`;
}

function sendToTab(session, message) {
  return chrome.tabs.sendMessage(session.sourceTabId, message, { frameId: session.sourceFrameId })
    .catch(() => undefined);
}

function sendToViewer(session, message) {
  if (!session.viewerReady || !session.viewerTabId) {
    session.pendingViewerMessages.push(message);
    return;
  }
  chrome.tabs.sendMessage(session.viewerTabId, message).catch(() => undefined);
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Open in Pseudo PiP',
    contexts: ['all']
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;

  const frameId = Number.isInteger(info.frameId) ? info.frameId : 0;
  const target = latestTargets.get(key(tab.id, frameId));
  if (!target) {
    await notifyTab(tab.id, frameId, {
      type: 'pip-error',
      message: 'Could not identify the right-clicked element. Please right-click again and try.'
    });
    return;
  }

  const sessionId = crypto.randomUUID();
  const session = {
    id: sessionId,
    sourceTabId: tab.id,
    sourceFrameId: frameId,
    targetToken: target.token,
    viewerTabId: null,
    viewerWindowId: null,
    viewerReady: false,
    pendingViewerMessages: []
  };
  sessions.set(sessionId, session);

  try {
    const viewerUrl = chrome.runtime.getURL(`viewer.html?session=${encodeURIComponent(sessionId)}`);
    const win = await chrome.windows.create({
      url: viewerUrl,
      type: 'popup',
      width: 560,
      height: 360,
      focused: true
    });

    session.viewerWindowId = win.id;
    session.viewerTabId = win.tabs?.[0]?.id ?? null;
    await sendToTab(session, { type: 'pip-start', sessionId, targetToken: target.token });
  } catch (error) {
    sessions.delete(sessionId);
    await notifyTab(tab.id, frameId, {
      type: 'pip-error',
      message: `Could not open Pseudo PiP window: ${error?.message ?? error}`
    });
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message?.type) return;

  if (message.type === 'context-target') {
    if (!sender.tab?.id) return;
    const frameId = Number.isInteger(sender.frameId) ? sender.frameId : 0;
    latestTargets.set(key(sender.tab.id, frameId), {
      token: message.token,
      hasVideo: !!message.hasVideo
    });
    return;
  }

  if (message.type === 'viewer-ready') {
    const sessionId = message.sessionId;
    const session = sessions.get(sessionId);
    if (!session || sender.tab?.id !== session.viewerTabId) return;
    session.viewerReady = true;
    for (const pending of session.pendingViewerMessages.splice(0)) {
      chrome.tabs.sendMessage(session.viewerTabId, pending).catch(() => undefined);
    }
    sendToTab(session, { type: 'pip-viewer-ready', sessionId });
    return;
  }

  const session = sessions.get(message.sessionId);
  if (!session) return;

  if (message.type === 'source-offer' || message.type === 'source-ice' || message.type === 'source-state' || message.type === 'source-error') {
    sendToViewer(session, message);
    return;
  }

  if (message.type === 'viewer-answer' || message.type === 'viewer-ice' || message.type === 'viewer-command') {
    sendToTab(session, message);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [sessionId, session] of sessions) {
    if (session.sourceTabId === tabId || session.viewerTabId === tabId) {
      sessions.delete(sessionId);
    }
  }
  for (const k of latestTargets.keys()) {
    if (k.startsWith(`${tabId}:`)) latestTargets.delete(k);
  }
});

chrome.windows.onRemoved.addListener((windowId) => {
  for (const [sessionId, session] of sessions) {
    if (session.viewerWindowId === windowId) {
      sendToTab(session, { type: 'pip-closed', sessionId });
      sessions.delete(sessionId);
    }
  }
});

async function notifyTab(tabId, frameId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message, { frameId });
  } catch {
    // Protected pages or frames without a content script are ignored.
  }
}