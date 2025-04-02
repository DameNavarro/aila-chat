const sqlite3 = require('sqlite3').verbose();
const path = require('node:path');
const { app } = require('electron'); // Required to get userData path
const crypto = require('node:crypto');

const dbPath = path.join(app.getPath('userData'), 'chatbot-data.sqlite');
let db = null; // Keep a reference to the DB connection

console.log(`Database path: ${dbPath}`);

// Connect and initialize tables
function initializeDatabase() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('Error connecting to database:', err.message);
                return reject(err);
            }
            console.log('Connected to the SQLite database.');
            db.serialize(() => {
                db.run(`CREATE TABLE IF NOT EXISTS chats (
          id TEXT PRIMARY KEY,
          name TEXT,
          history TEXT,
          created_at INTEGER,
          updated_at INTEGER
        )`, (err) => {
                    if (err) {
                        console.error('Error creating chats table:', err.message);
                        return reject(err);
                    }
                    console.log("Table 'chats' checked/created successfully.");
                    resolve();
                });
            });
        });
    });
}

// Generate a new UUID for chats
function createNewChatId() {
    return Promise.resolve(crypto.randomUUID());
}

// Save or Replace Chat
function saveChat(id, name, historyArray) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error("Database not initialized or connection closed.")); // Safety check

        const historyJson = JSON.stringify(historyArray);
        const now = Date.now();

        db.get('SELECT created_at FROM chats WHERE id = ?', [id], (err, row) => {
            if (err) {
                console.error('Error checking chat existence:', err.message);
                return reject(err);
            }
            const createdAt = row ? row.created_at : now;
            const sql = `INSERT OR REPLACE INTO chats (id, name, history, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?)`;
            db.run(sql, [id, name, historyJson, createdAt, now], function (err) {
                if (err) {
                    console.error('Error saving chat:', err.message);
                    return reject(err);
                }
                console.log(`Chat saved/updated successfully. ID: ${id}, Rows affected: ${this.changes}`);
                resolve({ success: true, id: id });
            });
        });
    });
}

// Load all chat metadata
function loadChats() {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error("Database not initialized or connection closed."));
        const sql = `SELECT id, name, updated_at FROM chats ORDER BY updated_at DESC`;
        db.all(sql, [], (err, rows) => {
            if (err) {
                console.error('Error loading chats:', err.message);
                return reject(err);
            }
            resolve(rows || []);
        });
    });
}

// Load full history for a specific chat
function loadChatHistory(chatId) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error("Database not initialized or connection closed."));
        const sql = `SELECT history FROM chats WHERE id = ?`;
        db.get(sql, [chatId], (err, row) => {
            if (err) {
                console.error('Error loading chat history:', err.message);
                return reject(err);
            }
            if (row && row.history) {
                try {
                    resolve(JSON.parse(row.history));
                } catch (parseError) {
                    console.error('Error parsing chat history JSON:', parseError);
                    reject(parseError);
                }
            } else {
                resolve([]);
            }
        });
    });
}

// Delete a chat
function deleteChat(chatId) {
    return new Promise((resolve, reject) => {
        if (!db) return reject(new Error("Database not initialized or connection closed."));
        const sql = `DELETE FROM chats WHERE id = ?`;
        db.run(sql, [chatId], function (err) {
            if (err) {
                console.error('Error deleting chat:', err.message);
                return reject(err);
            }
            if (this.changes === 0) {
                console.warn(`Attempted to delete non-existent chat ID: ${chatId}`);
            } else {
                console.log(`Chat deleted successfully. ID: ${chatId}`);
            }
            resolve({ success: true, deletedCount: this.changes });
        });
    });
}

// *** ADDED getChatName Function HERE ***
function getChatName(chatId) {
    return new Promise((resolve, reject) => {
        // Use the persistent connection 'db' if available
        if (!db) {
            // Fallback to temporary connection if main DB isn't open (less ideal)
            console.warn("getChatName: Main DB connection not found, using temporary.");
            const tempDb = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, err => {
                if (err) return reject(err);
                tempDb.get('SELECT name FROM chats WHERE id = ?', [chatId], (err, row) => {
                    tempDb.close(); // Close temp connection
                    if (err) return reject(err);
                    resolve(row ? row.name : null);
                });
            });
        } else {
            // Use the main connection
            db.get('SELECT name FROM chats WHERE id = ?', [chatId], (err, row) => {
                if (err) return reject(err);
                resolve(row ? row.name : null);
            });
        }
    });
}


// Close the database connection
function closeDatabase() {
    return new Promise((resolve, reject) => {
        if (db) {
            db.close((err) => {
                if (err) {
                    console.error('Error closing database:', err.message);
                    return reject(err);
                }
                console.log('Database connection closed.');
                db = null;
                resolve();
            });
        } else {
            resolve();
        }
    });
}

// Export ALL functions, including the new one
module.exports = {
    initializeDatabase,
    createNewChatId,
    saveChat,
    loadChats,
    loadChatHistory,
    deleteChat,
    getChatName, // <-- Export getChatName
    closeDatabase,
    dbPath
};