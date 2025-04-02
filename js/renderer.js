// --- START OF FILE renderer.js (Corrected) ---

// --- DOM Elements ---
const newChatBtn = document.getElementById('new-chat-btn');
const chatList = document.getElementById('chat-list');
const messageList = document.getElementById('message-list');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const welcomeView = document.getElementById('welcome-view');
const chatView = document.getElementById('chat-view');

// --- State ---
let activeChatId = null;
let chatHistory = []; // Holds the history {role, parts:[{text}]} for the active chat

// --- Initialization ---
document.addEventListener('DOMContentLoaded', loadInitialData);

async function loadInitialData() {
    console.log('Renderer: Loading initial data');
    await loadAndDisplayChatList();
    showWelcomeView(); // Start with welcome view
    setupEventListeners();
    setupAutoResizeTextarea();
}

// --- Event Listeners Setup ---
function setupEventListeners() {
    newChatBtn.addEventListener('click', handleNewChat);
    sendButton.addEventListener('click', handleSendMessage);
    messageInput.addEventListener('keydown', handleInputKeyDown);

    // Use event delegation for chat list items and delete buttons
    chatList.addEventListener('click', (event) => {
        const chatItem = event.target.closest('li[data-chat-id]');
        const deleteButton = event.target.closest('.delete-chat-btn');

        if (deleteButton && chatItem) {
            event.stopPropagation(); // Prevent chat loading when deleting
            const chatIdToDelete = chatItem.dataset.chatId;
            handleDeleteChat(chatIdToDelete);
        } else if (chatItem) {
            const chatIdToLoad = chatItem.dataset.chatId;
            if (chatIdToLoad !== activeChatId) {
                handleLoadChat(chatIdToLoad);
            }
        }
    });
}

// --- Event Handlers ---
async function handleNewChat() {
    console.log('Renderer: New Chat clicked');
    try {
        const newId = await window.api.createNewChatId();
        activeChatId = newId;
        chatHistory = []; // Reset history for new chat
        clearMessageDisplay();
        setActiveChatItem(null); // Deselect any active item in the list
        showChatView(); // Ensure chat view is visible
        messageInput.value = ''; // Clear input value

        // --- SOLUTION APPLIED HERE ---
        // Defer the focus call using setTimeout to ensure it happens
        // after any pending DOM updates (e.g., from deleteChat's list refresh)
        // have likely completed and the input is fully ready.
        setTimeout(() => {
            console.log('Renderer: Attempting to focus message input after timeout.');
            messageInput.focus();
            setupAutoResizeTextarea(); // Also reset size in timeout if needed, though clearing value might suffice
        }, 0); // 0ms delay is usually sufficient
        // --- END SOLUTION ---

        // Note: The new chat won't appear in the list until the first message is sent & saved.
        // Or, we could add it optimistically and save it immediately. Let's save on first message.
    } catch (error) {
        console.error('Error creating new chat ID:', error);
        // TODO: Show error to user using displayMessage
        displayMessage('model', `Error starting new chat: ${error.message}`);
    }
}

async function handleSendMessage() {
    const messageText = messageInput.value.trim();
    if (!messageText || sendButton.disabled) return; // Check disabled state too

    if (!activeChatId) {
        console.error("Cannot send message: No active chat ID.");
        displayMessage('model', "Error: Please start a new chat first."); // Use displayMessage
        return;
    }

    displayMessage('user', messageText);
    const currentUserMessage = { role: 'user', parts: [{ text: messageText }] };
    const historyToSend = [...chatHistory]; // Send history *before* the current user message

    // --- Disable input ---
    messageInput.value = ''; // Clear input immediately
    messageInput.disabled = true;
    sendButton.disabled = true;
    // Trigger resize after clearing
    messageInput.style.height = 'auto';
    const initialHeight = messageInput.scrollHeight; // Get height for single line
     messageInput.style.height = `${initialHeight}px`;


    // --- Add Thinking Indicator ---
    const thinkingDivId = `thinking-${Date.now()}`;
    displayMessage('model', 'Aila is thinking...'); // Use displayMessage helper
    const thinkingDiv = messageList.lastElementChild;
    if(thinkingDiv) { // Check if element exists
        thinkingDiv.id = thinkingDivId;
        thinkingDiv.classList.add('thinking');
    }
    // --- End Thinking Indicator ---

    try {
        console.log(`Renderer: Sending message for chat ${activeChatId}`);
        const response = await window.api.sendMessage({
            chatId: activeChatId,
            message: messageText,
            history: historyToSend
        });

        // --- Remove Thinking Indicator ---
         const thinkingElement = document.getElementById(thinkingDivId);
         if (thinkingElement) {
             thinkingElement.remove();
         }
         // --- End Remove Thinking Indicator ---


        if (response && response.error) {
            console.error("Received error from main process:", response.error);
            displayMessage('model', `Sorry, an error occurred: ${response.error}`);
            // Do NOT update local history on error
        } else if (response && response.text) {
             console.log(`Renderer: Received response text: "${response.text.substring(0,50)}..."`)
            // Display AI response (thinking indicator is already removed)
            displayMessage('model', response.text);
            // Update local history with both user message and model response AFTER successful API call
            chatHistory.push(currentUserMessage);
            chatHistory.push({ role: 'model', parts: [{ text: response.text }] });
            // Check if this was the first message pair of the chat to update the sidebar
            const isFirstExchange = chatHistory.length === 2;
            if (isFirstExchange) {
                console.log("Renderer: First exchange, reloading chat list.")
                await loadAndDisplayChatList(); // Refresh list to show the new chat
                setActiveChatItem(activeChatId); // Ensure it's highlighted
            }
        } else {
            console.error("Received invalid or empty response from main process:", response);
            displayMessage('model', "Sorry, I couldn't get a valid response. Please try again.");
             // Do NOT update local history on invalid response
        }
    } catch (error) {
         // --- Remove Thinking Indicator on error too ---
         const thinkingElement = document.getElementById(thinkingDivId);
         if (thinkingElement) {
             thinkingElement.remove();
         }
         // --- End Remove Thinking Indicator ---

        // This catches errors in the IPC communication itself or renderer-side issues
        console.error('Renderer Error sending/processing message:', error);
        displayMessage('model', `Error: ${error.message || 'Could not communicate with the chatbot.'}`);
    } finally {
        // Re-enable input
        messageInput.disabled = false;
        sendButton.disabled = false; // Re-enable send button (state managed by input event now)
        // Focus only if the input area is still visible (might have switched chat/view)
        if (!chatView.classList.contains('hidden')) {
             // We don't need setTimeout here as sending doesn't involve complex background DOM changes typically
             messageInput.focus();
        }
        // Re-check button state based on input content (might be empty if send failed quick)
        sendButton.disabled = messageInput.value.trim().length === 0;
        scrollToBottom(); // Ensure scroll after potential error messages
    }
}


function handleInputKeyDown(event) {
    // Send message on Enter key (unless Shift+Enter is pressed)
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault(); // Prevent default newline insertion
        handleSendMessage();
    }
    // Optional: Trigger resize on keydown too for immediate feedback
    // setTimeout(setupAutoResizeTextarea, 0); // Defer slightly
}

async function handleLoadChat(chatId) {
    console.log(`Renderer: Loading chat ${chatId}`);
    if (activeChatId === chatId) return; // Already active

    // Add loading indicator
    clearMessageDisplay();
    displayMessage('model', 'Loading chat history...'); // Use displayMessage

    try {
        const loadedHistory = await window.api.loadChatHistory(chatId);
        clearMessageDisplay(); // Clear loading message

        if (loadedHistory !== null) {
            activeChatId = chatId;
            chatHistory = loadedHistory;
            if (chatHistory.length > 0) {
                 chatHistory.forEach(msg => {
                    if (msg && msg.role && msg.parts && msg.parts[0] && typeof msg.parts[0].text === 'string') {
                         displayMessage(msg.role, msg.parts[0].text)
                    } else {
                        console.warn("Skipping malformed message during load:", msg);
                    }
                 });
            } else {
                // Optionally display a "Chat started..." message if history is empty
                 displayMessage('model', 'Chat started. Ask me anything!');
            }
            setActiveChatItem(chatId);
            showChatView();
            messageInput.value = ''; // Clear input when loading old chat
            messageInput.disabled = false; // Ensure enabled
            sendButton.disabled = true; // Reset send button state
            // Definite focus needed here after loading/switching
            setTimeout(() => messageInput.focus(), 0);

        } else {
            console.error(`Could not load history for chat ${chatId}`);
            displayMessage('model', "Error: Could not load chat history."); // Use displayMessage
            showWelcomeView(); // Revert to welcome view on load failure
        }
    } catch (error) {
        clearMessageDisplay(); // Clear loading message
        console.error(`Error loading chat ${chatId}:`, error);
        displayMessage('model', `Error loading chat: ${error.message}`); // Use displayMessage
        showWelcomeView(); // Revert to welcome view on load failure
    }
}

async function handleDeleteChat(chatId) {
    console.log(`Renderer: Deleting chat ${chatId}`);
    if (!confirm(`Are you sure you want to delete this chat? This cannot be undone.`)) {
        return;
    }

    try {
        const result = await window.api.deleteChat(chatId);
        if (result.success) {
            console.log(`Chat ${chatId} deleted.`);
            const wasActive = (activeChatId === chatId);

            // Remove the list item visually immediately (optimistic UI)
             const itemToRemove = chatList.querySelector(`li[data-chat-id="${chatId}"]`);
             if (itemToRemove) {
                 itemToRemove.remove();
             }

            // If the deleted chat was the active one, reset the view
            if (wasActive) {
                activeChatId = null;
                chatHistory = [];
                clearMessageDisplay();
                showWelcomeView();
            }
            // Refresh the chat list from backend to ensure consistency (optional if optimistic is enough)
            // await loadAndDisplayChatList(); // Could potentially cause flicker, optimistic removal is often preferred.

        } else {
            console.error(`Failed to delete chat ${chatId}:`, result.error);
             displayMessage('model', `Error deleting chat: ${result.error || 'Unknown error'}`); // Use displayMessage
        }
    } catch (error) {
        console.error(`Error deleting chat ${chatId}:`, error);
        displayMessage('model', `Error deleting chat: ${error.message}`); // Use displayMessage
    }
}


// --- UI Update Functions ---

async function displayMessage(role, text) { // *** Make function async ***
    if (text === null || typeof text === 'undefined' || text === '') {
        console.warn(`Attempted to display message with empty text for role: ${role}`);
        return;
    }

    const messageDiv = document.createElement('div');
    messageDiv.classList.add('message', role);

    const contentDiv = document.createElement('div');
    contentDiv.classList.add('message-content');

    if (role === 'model') {
        try {
            // *** Await the results from the main process ***
            console.log("[Renderer] Parsing markdown...");
            const rawHtml = await window.api.parseMarkdown(text);
            console.log("[Renderer] Sanitizing HTML...");
            const cleanHtml = await window.api.sanitizeHtml(rawHtml);
            console.log("[Renderer] Setting innerHTML.");
            contentDiv.innerHTML = cleanHtml;
        } catch (error) {
            // This catches errors from the invoke calls themselves
            console.error("[Renderer] Error processing model message via IPC:", error);
            contentDiv.textContent = text; // Fallback to plain text on error
        }
    } else {
        contentDiv.textContent = text; // User messages remain plain text
    }

    messageDiv.appendChild(contentDiv);
    messageList.appendChild(messageDiv);

    scrollToBottom();
}

function clearMessageDisplay() {
    messageList.innerHTML = '';
}

// This function is no longer used as clearing happens before disabling in handleSendMessage
/*
function clearInputAndResize() {
    messageInput.value = '';
    // Trigger resize recalculation after clearing
    messageInput.style.height = 'auto'; // Reset height
    messageInput.style.height = `${messageInput.scrollHeight}px`; // Set to content height
    sendButton.disabled = true; // Disable send button when input is empty
}
*/


function scrollToBottom() {
    // Use setTimeout to allow the DOM to update before scrolling
    setTimeout(() => {
        messageList.scrollTop = messageList.scrollHeight;
    }, 0);
}


function showChatView() {
    welcomeView.classList.add('hidden');
    chatView.classList.remove('hidden');
}

function showWelcomeView() {
    welcomeView.classList.remove('hidden');
    chatView.classList.add('hidden');
}

async function loadAndDisplayChatList() {
    console.log("Renderer: Refreshing chat list from backend.");
    try {
        const chats = await window.api.loadChats();
        chatList.innerHTML = ''; // Clear existing list
        if (chats && chats.length > 0) {
            chats.forEach(chat => {
                const li = document.createElement('li');
                li.dataset.chatId = chat.id;

                const span = document.createElement('span');
                span.textContent = chat.name || `Chat ${chat.id.substring(0, 8)}...`;
                span.title = chat.name || `Chat ${chat.id}`;

                const deleteBtn = document.createElement('button');
                deleteBtn.classList.add('delete-chat-btn');
                deleteBtn.innerHTML = '✕';
                deleteBtn.title = "Delete chat";

                li.appendChild(span);
                li.appendChild(deleteBtn);
                chatList.appendChild(li);
            });
            // Ensure the currently active chat (if any) is highlighted after refresh
            if (activeChatId) {
                 setActiveChatItem(activeChatId);
            }
        } else {
            // No chats found message
             // chatList.innerHTML = '<li>No recent chats</li>';
             console.log("Renderer: No chats found in database.");
        }
    } catch (error) {
        console.error('Error loading chat list:', error);
        chatList.innerHTML = '<li>Error loading chats</li>';
    }
}

function setActiveChatItem(chatId) {
    chatList.querySelectorAll('li').forEach(item => {
        item.classList.remove('active');
    });
    if (chatId) {
        const itemToActivate = chatList.querySelector(`li[data-chat-id="${chatId}"]`);
        if (itemToActivate) {
            itemToActivate.classList.add('active');
            console.log(`Renderer: Set chat item ${chatId} as active.`);
        } else {
             console.log(`Renderer: Tried to activate chat item ${chatId}, but not found in list.`);
        }
    }
}

// --- Utility Functions ---

function setupAutoResizeTextarea() {
     const initialHeight = messageInput.scrollHeight > 46 ? messageInput.scrollHeight : 46; // Use 46 from CSS min-height
     messageInput.style.height = `${initialHeight}px`;

    messageInput.addEventListener('input', () => {
        // Temporarily reset height to calculate the actual scroll height
        messageInput.style.height = 'auto';
        // Get scrollHeight, apply max-height constraint if needed (from CSS)
        const maxHeight = parseInt(window.getComputedStyle(messageInput).maxHeight, 10) || 200; // Fallback if CSS var fails
        const scrollHeight = messageInput.scrollHeight;
        messageInput.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
        // Adjust overflow based on whether content exceeds max height
        messageInput.style.overflowY = scrollHeight > maxHeight ? 'scroll' : 'hidden';

        // Enable/disable send button based on content
        sendButton.disabled = messageInput.value.trim().length === 0;
    });
    // Initial check
    sendButton.disabled = messageInput.value.trim().length === 0;
    // Ensure textarea has correct initial overflow state
    const maxHeight = parseInt(window.getComputedStyle(messageInput).maxHeight, 10) || 200;
    messageInput.style.overflowY = messageInput.scrollHeight > maxHeight ? 'scroll' : 'hidden';
}


console.log('Renderer script loaded.');




// --- END OF FILE renderer.js ---