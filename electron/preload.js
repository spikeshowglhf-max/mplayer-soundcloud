const { contextBridge, clipboard, shell } = require("electron");

contextBridge.exposeInMainWorld("desktopAPI", {
  isDesktopApp: true,
  openExternal: (url) => shell.openExternal(url),
  writeClipboardText: async (text) => {
    clipboard.writeText(String(text));
  },
});
