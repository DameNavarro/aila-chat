// --- START OF FILE preload.js (Changes highlighted) ---

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
  // --- Renderer to Main (Invoke/Handle) ---
  loadChats: () => ipcRenderer.invoke('load-chats'),
  loadChatHistory: (chatId) => ipcRenderer.invoke('load-chat-history', chatId),
  saveChat: (chatData) => ipcRenderer.invoke('save-chat', chatData),
  deleteChat: (chatId) => ipcRenderer.invoke('delete-chat', chatId),
  createNewChatId: () => ipcRenderer.invoke('create-new-chat-id'),
  sendMessage: (messageData) => ipcRenderer.invoke('send-message', messageData),

  // --- Formatting/Sanitization Functions ---  // *** ADDED SECTION ***
  parseMarkdown: async (markdownString) => { // Make it async as invoke returns a Promise
    console.log('[Preload] Invoking parse-markdown');
    // Call the main process handler via IPC
    return ipcRenderer.invoke('parse-markdown', markdownString);
},
sanitizeHtml: async (dirtyHtml) => { // Make it async
    console.log('[Preload] Invoking sanitize-html');
    // Call the main process handler via IPC
    return ipcRenderer.invoke('sanitize-html', dirtyHtml);
}
  // --- END ADDED SECTION ---

});

console.log('Preload script loaded.');
// --- END OF FILE preload.js ---