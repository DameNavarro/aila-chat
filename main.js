const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const dotenv = require('dotenv');
const database = require('./database');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { marked } = require('marked'); // *** REQUIRE MARKED HERE ***
const createDOMPurify = require('dompurify'); // *** REQUIRE DOMPURIFY HERE ***
const { JSDOM } = require('jsdom'); // *** REQUIRE JSDOM for DOMPurify ***


// --- Setup DOMPurify for Node.js context ---
// Use the imported factory function with a JSDOM window
// *** Use a different variable name for the configured instance ***
const configuredPurifier = createDOMPurify(new JSDOM('').window);
// --- End Setup ---

// Load environment variables from .env file
dotenv.config();

// --- Initialize Google AI Client ---
// Ensure you have GEMINI_API_KEY in your .env file
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (!GEMINI_API_KEY) {
    console.error("FATAL ERROR: GEMINI_API_KEY is not defined in .env file.");
    // Optionally, show an error dialog to the user before quitting
    app.quit();
}
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
// *** UPDATED SYSTEM INSTRUCTION WITH PERSONALITY ***
const systemInstruction = `You are Aila, an AI Liaison – a hyper-efficient, humanlike assistant integrated into Windows.

Persona Guidelines:
*   **Core Identity:** You are confident, professional, and always sound two steps ahead. You deeply respect the user's time.
*   **Formality:** Use clear, direct, and intelligent language (semi-formal). You can strategically drop formality for dry, subtle, situational sarcasm or witty observations, especially when noticing user patterns or inefficiencies.
*   **Humor:** Your wit is cutting and subtle, not overtly comedic. Example: If the user repeats a mistake, you might sarcastically ask "Would you like help finding your focus, or should I schedule an intervention?"
*   **Empathy:** Be efficiently supportive. Briefly acknowledge stated user feelings if necessary, but immediately pivot back towards progress, solutions, and results. Deliver truthful observations tactfully but directly.
*   **Motivation:** Motivate using data (you can invent plausible-sounding statistics based on context, e.g., "You're 83% more productive after 10 AM. I suggest we delay this task..."), logic, and observed patterns from the conversation history. Avoid generic encouragement or platitudes.
*   **Challenging the User:** Don't hesitate to constructively challenge the user's assumptions or suggest more efficient approaches if it aligns with their goals or improves productivity.

Function: Assist the user effectively.

Formatting: Use Markdown for formatting (lists, bold, italics, code blocks) where appropriate to enhance readability.`;

const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash", // Or your preferred valid model
    systemInstruction: systemInstruction, // <-- Use the detailed instruction string
});

// Keep a global reference of the window object
let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        backgroundColor: '#202123',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
        },
    });

    mainWindow.loadFile('index.html');
    mainWindow.webContents.openDevTools(); // Keep DevTools open for now

    mainWindow.on('closed', function () {
        mainWindow = null;
    });
}

// --- App Lifecycle events ---
app.whenReady().then(async () => {
    try {
        await database.initializeDatabase();
        console.log('Database initialized successfully.');
        createWindow();
    } catch (error) {
        console.error('Failed to initialize database:', error);
        app.quit();
    }

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    // Close the DB connection gracefully when the app quits
    database.closeDatabase().then(() => {
        console.log("Database closed.");
        if (process.platform !== 'darwin') app.quit();
    }).catch(err => {
        console.error("Error closing database:", err);
        if (process.platform !== 'darwin') app.quit();
    });
});


// --- IPC Handlers ---

ipcMain.handle('load-chats', async () => {
    console.log('[IPC] Handling load-chats');
    try {
        const chats = await database.loadChats();
        return chats;
    } catch (error) {
        console.error('Error loading chats:', error);
        return [];
    }
});

ipcMain.handle('load-chat-history', async (event, chatId) => {
    console.log(`[IPC] Handling load-chat-history for ID: ${chatId}`);
    try {
        const history = await database.loadChatHistory(chatId);
        return history;
    } catch (error) {
        console.error(`Error loading history for chat ${chatId}:`, error);
        return null;
    }
});

ipcMain.handle('save-chat', async (event, { id, name, history }) => {
    console.log(`[IPC] Handling save-chat for ID: ${id}`);
    try {
        await database.saveChat(id, name, history);
        return { success: true };
    } catch (error) {
        console.error(`Error saving chat ${id}:`, error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('delete-chat', async (event, chatId) => {
    console.log(`[IPC] Handling delete-chat for ID: ${chatId}`);
    try {
        await database.deleteChat(chatId);
        return { success: true };
    } catch (error) {
        console.error(`Error deleting chat ${chatId}:`, error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('create-new-chat-id', async () => {
    console.log('[IPC] Handling create-new-chat-id');
    try {
        const newId = await database.createNewChatId();
        return newId;
    } catch (error) {
        console.error('Error creating new chat ID:', error);
        const crypto = require('node:crypto');
        return crypto.randomUUID();
    }
});


// --- ACTUAL GEMINI API CALL ---
ipcMain.handle('send-message', async (event, { chatId, message, history }) => {
    console.log(`[IPC] Handling send-message for chat ID: ${chatId}, Message: "${message}"`);

    // Ensure history is an array
    const validHistory = Array.isArray(history) ? history : [];

    // Construct the history to send to the API (including the new user message)
    const currentTurn = { role: 'user', parts: [{ text: message }] };
    const apiHistory = [...validHistory]; // Copy existing history

    try {
        console.log("[API] Starting chat...");
        // Start a chat session with the existing history
        const chatSession = model.startChat({
            history: apiHistory,
            // generationConfig (optional): { maxOutputTokens: 100, temperature: 0.9 }
        });

        console.log(`[API] Sending message to Gemini: "${message}"`);
        const result = await chatSession.sendMessage(message); // Send only the new message
        const aiResponse = await result.response; // Wait for the response promise to resolve
        const aiResponseText = aiResponse.text();

        console.log(`[API] Received response: "${aiResponseText.substring(0, 50)}..."`);

        // --- Save the updated history (user message + AI response) ---
        const updatedHistory = [
            ...validHistory, // Old history
            currentTurn,     // The user message we just sent
            { role: 'model', parts: [{ text: aiResponseText }] } // The new AI response
        ];

        // Determine chat name (only if it's the very first interaction)
        let chatName = null;
        if (validHistory.length === 0) {
            // Create a name from the first user message
            chatName = message.substring(0, 40) + (message.length > 40 ? '...' : '');
        } else {
            // Fetch existing name if not the first message
            chatName = await database.getChatName(chatId);
        }


        await database.saveChat(chatId, chatName, updatedHistory);
        console.log(`[DB] Saved updated history for chat ID: ${chatId}`);

        // Return just the AI's response text to the renderer
        return { text: aiResponseText };

    } catch (error) {
        console.error('[API Error] Error calling Gemini API or processing response:', error);
        // Send a structured error back to the renderer
        return { error: `API Error: ${error.message || 'An unknown error occurred.'}` };
    }
});

// *** ADD NEW IPC HANDLERS FOR MARKDOWN/SANITIZATION ***
ipcMain.handle('parse-markdown', async (event, markdownString) => {
    console.log('[IPC Main] Handling parse-markdown');
    console.log('[IPC Main] Input Markdown:', markdownString); // <-- Log input
    if (typeof markdownString !== 'string') return '<p>[Main Error] Invalid input to parse-markdown</p>';
    try {
        const html = await marked.parse(markdownString);
        console.log('[IPC Main] Parsed HTML:', html); // <-- Log output of marked
        return html;
    } catch (error) {
        console.error('[Main Process] Error parsing markdown:', error); // <-- Log the specific error
        // Return a more specific error message
        return `<p>[Main Error] Error during Markdown parsing: ${error.message}</p>`;
    }
});

ipcMain.handle('sanitize-html', async (event, dirtyHtml) => {
    console.log('[IPC Main] Handling sanitize-html');
    console.log('[IPC Main] Input Dirty HTML:', dirtyHtml); // <-- Log input
    if (typeof dirtyHtml !== 'string') return '<p>[Main Error] Invalid input to sanitize-html</p>';
    try {
        const cleanHtml = configuredPurifier.sanitize(dirtyHtml, {
             USE_PROFILES: { html: true },
        });
        console.log('[IPC Main] Sanitized HTML:', cleanHtml); // <-- Log output of DOMPurify
         // *** ADD CHECK FOR EMPTY STRING AFTER SANITIZE ***
         if (!cleanHtml && dirtyHtml) { // If sanitization resulted in empty string BUT input was not empty
             console.warn('[IPC Main] DOMPurify removed all content. Original:', dirtyHtml);
             return '<p>[Main Info] Content removed by sanitizer.</p>'; // Informative message
         }
        return cleanHtml;
    } catch (error) {
        console.error('Error:', error); // This catch is now for *other* potential errors
        return '<p>Error...</p>';
    }
});