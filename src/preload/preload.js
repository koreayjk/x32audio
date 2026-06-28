'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * 렌더러에 노출되는 안전한 API.
 * 렌더러는 Node 에 직접 접근하지 않고 이 다리(bridge)를 통해서만 통신한다.
 */
contextBridge.exposeInMainWorld('x32api', {
  // 요청/응답 (Promise)
  connect: (host, port) => ipcRenderer.invoke('x32:connect', { host, port }),
  disconnect: () => ipcRenderer.invoke('x32:disconnect'),
  readChannels: (count) => ipcRenderer.invoke('x32:read-channels', { count }),
  readEq: (ch) => ipcRenderer.invoke('x32:read-eq', { ch }),
  getScenes: () => ipcRenderer.invoke('x32:scenes'),
  applyScene: (sceneId) => ipcRenderer.invoke('x32:apply-scene', { sceneId }),
  startFeedback: (options) => ipcRenderer.invoke('x32:start-feedback', options),
  stopFeedback: () => ipcRenderer.invoke('x32:stop-feedback'),
  getStatus: () => ipcRenderer.invoke('x32:status'),

  // 이벤트 구독 (main → renderer)
  on: (event, callback) => {
    const channel = `x32:${event}`;
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
