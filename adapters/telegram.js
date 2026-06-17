const { writeFileSync, readFileSync, existsSync } = require('fs');
const path = require('path');

const TMP_DIR = path.join(__dirname, '..', '.bark-tmp');
const CHAT_ID_FILE = path.join(TMP_DIR, 'telegram-chat-id');

function createTelegramAdapter({ token, chatId }) {
    const BASE = `https://api.telegram.org/bot${token}`;
    // Load persisted chat ID if not provided via config
    let defaultChatId = chatId || null;
    if (!defaultChatId && existsSync(CHAT_ID_FILE)) {
        try {
            defaultChatId = readFileSync(CHAT_ID_FILE, 'utf8').trim();
            console.log(`Telegram loaded persisted chat ID: ${defaultChatId}`);
        } catch {}
    }
    let polling = false;
    let lastUpdateId = 0;
    let pollTimeout = null;
    let consecutivePollErrors = 0;

    async function api(method, body, retries = 3) {
        const res = await fetch(`${BASE}/${method}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!data.ok) {
            // Handle rate limiting with retry
            if (data.error_code === 429 && data.parameters?.retry_after) {
                if (retries > 0) {
                    const delay = (data.parameters.retry_after + 1) * 1000;
                    console.log(`  ⏳ Telegram rate limited, waiting ${data.parameters.retry_after}s...`);
                    await new Promise(r => setTimeout(r, delay));
                    return api(method, body, retries - 1);
                }
                // Exhausted retries — don't crash, just warn and return null
                console.log(`  ⚠️ Telegram rate limit persists for ${method}, skipping after ${3} retries`);
                return null;
            }
            throw new Error(`Telegram API ${method}: ${data.description || 'unknown error'}`);
        }
        return data.result;
    }

    async function pollLoop(onMessage) {
        while (polling) {
            try {
                const updates = await api('getUpdates', {
                    timeout: 30,
                    offset: lastUpdateId + 1,
                    allowed_updates: ['message', 'my_chat_member', 'callback_query'],
                });

                consecutivePollErrors = 0; // reset on success
                for (const update of updates) {
                    lastUpdateId = update.update_id;
                    // Handle callback queries (inline button taps)
                    if (update.callback_query && adapter.onCallbackQuery) {
                        await adapter.onCallbackQuery(update.callback_query);
                        continue;
                    }

                    const msg = update.message;
                    if (!msg) continue;

                    // Handle group → supergroup migration
                    if (msg.migrate_to_chat_id) {
                        const newChatId = String(msg.migrate_to_chat_id);
                        console.log(`Telegram group migrated: ${defaultChatId} → ${newChatId}`);
                        defaultChatId = newChatId;
                        try { writeFileSync(CHAT_ID_FILE, defaultChatId); } catch {}
                        // Re-detect forum mode on the new supergroup
                        api('getChat', { chat_id: defaultChatId }).then(chat => {
                            const wasForum = adapter.isForum;
                            adapter.isForum = !!chat.is_forum;
                            if (adapter.isForum && !wasForum) {
                                console.log('  🧵 Telegram group has topics enabled (forum mode)');
                            }
                        }).catch(() => {});
                        continue;
                    }

                    // Auto-detect chat ID from first message (any chat type)
                    if (!defaultChatId) {
                        defaultChatId = String(msg.chat.id);
                        try { writeFileSync(CHAT_ID_FILE, defaultChatId); } catch {}
                        console.log(`Telegram auto-detected chat ID: ${defaultChatId} (${msg.chat.type})`);
                        // Detect forum mode now that we have a chat ID
                        api('getChat', { chat_id: defaultChatId }).then(chat => {
                            if (chat.is_forum) {
                                adapter.isForum = true;
                                console.log('  🧵 Telegram group has topics enabled (forum mode)');
                            }
                        }).catch(() => {});
                    }

                    // Only process messages from the configured chat
                    if (String(msg.chat.id) !== String(defaultChatId)) continue;

                    // Live-detect forum mode changes (Telegram includes is_forum in chat object on messages)
                    const wasForum = adapter.isForum;
                    adapter.isForum = !!msg.chat.is_forum;
                    if (wasForum && !adapter.isForum) {
                        console.log('  🧵 Telegram topics disabled — switching to flat chat mode');
                        if (adapter.onForumDisabled) adapter.onForumDisabled();
                    } else if (!wasForum && adapter.isForum) {
                        console.log('  🧵 Telegram topics enabled — switching to forum mode');
                    }

                    // Skip messages with no sender (channel posts, anonymous)
                    if (!msg.from) continue;

                    // Skip messages from the bot itself
                    const botInfo = adapter._botInfo;
                    if (botInfo && msg.from.id === botInfo.id) continue;

                    const sender = msg.from
                        ? (msg.from.first_name || '') + (msg.from.last_name ? ' ' + msg.from.last_name : '')
                        : 'Unknown';
                    const text = msg.text || msg.caption || '';

                    let hasMedia = false;
                    let mediaType = null;
                    if (msg.photo && msg.photo.length > 0) {
                        hasMedia = true;
                        mediaType = 'image';
                    } else if (msg.voice || msg.audio) {
                        hasMedia = true;
                        mediaType = 'voice';
                    }

                    const normalized = {
                        id: 'tg:' + msg.message_id,
                        text: text.trim(),
                        sender,
                        senderId: String(msg.from.id),
                        hasMedia,
                        mediaType,
                        isQuotedReply: !!msg.reply_to_message,
                        threadId: msg.message_thread_id || null,
                        raw: msg,
                        adapter,
                    };

                    onMessage(normalized);
                }
            } catch (e) {
                if (polling) {
                    consecutivePollErrors++;
                    const delay = Math.min(5000 * Math.pow(2, consecutivePollErrors - 1), 60000);
                    console.log(`  ⚠️ Telegram poll error (attempt ${consecutivePollErrors}, retry in ${delay / 1000}s): ${e.message}`);
                    await new Promise(r => { pollTimeout = setTimeout(r, delay); });
                }
            }
        }
    }

    const adapter = {
        name: 'telegram',
        _botInfo: null,
        isForum: false,
        capabilities: { finalMessageBehavior: 'send' },

        async initialize(onMessage) {
            // Validate token
            const me = await api('getMe', {});
            adapter._botInfo = me;
            console.log(`Telegram bot: @${me.username} (${me.first_name})`);

            if (defaultChatId) {
                console.log(`Telegram listening on chat: ${defaultChatId}`);
                // Detect forum/topics mode
                try {
                    const chat = await api('getChat', { chat_id: defaultChatId });
                    if (chat.is_forum) {
                        adapter.isForum = true;
                        console.log('  🧵 Telegram group has topics enabled (forum mode)');
                    }
                } catch (e) {
                    console.log(`  ⚠️ Could not check Telegram forum status: ${e.message}`);
                }
                // Clean up stale pins from previous session
                try {
                    await api('unpinAllChatMessages', { chat_id: defaultChatId });
                    console.log('  🧹 Cleared old Telegram pins');
                } catch (e) {
                    // Bot may not have pin permissions — not fatal
                    console.log(`  ⚠️ Could not clear old Telegram pins: ${e.message}`);
                }
            } else {
                console.log('Telegram waiting for first group message to detect chat ID...');
            }

            // Start polling
            polling = true;
            pollLoop(onMessage).catch(e => {
                console.log(`  ❌ Telegram poll loop crashed: ${e.message}`);
            });
        },

        async destroy() {
            polling = false;
            if (pollTimeout) clearTimeout(pollTimeout);
        },

        isReady() {
            return polling && !!defaultChatId;
        },

        async createForumTopic(name) {
            if (!defaultChatId) throw new Error('No chat ID');
            const result = await api('createForumTopic', { chat_id: defaultChatId, name });
            return result.message_thread_id;
        },

        async deleteForumTopic(threadId) {
            if (!defaultChatId) return;
            try {
                await api('deleteForumTopic', { chat_id: defaultChatId, message_thread_id: threadId });
            } catch (e) {
                console.log(`  ⚠️ Could not delete Telegram topic ${threadId}: ${e.message}`);
            }
        },

        async closeForumTopic(threadId) {
            if (!defaultChatId) return;
            try {
                await api('closeForumTopic', { chat_id: defaultChatId, message_thread_id: threadId });
            } catch (e) {
                console.log(`  ⚠️ Could not close Telegram topic ${threadId}: ${e.message}`);
            }
        },

        async reopenForumTopic(threadId) {
            if (!defaultChatId) return;
            try {
                await api('reopenForumTopic', { chat_id: defaultChatId, message_thread_id: threadId });
            } catch (e) {
                console.log(`  ⚠️ Could not reopen Telegram topic ${threadId}: ${e.message}`);
            }
        },

        async send(text, replyToId, threadId, replyMarkup) {
            if (!defaultChatId) {
                console.log('  ⚠️ Telegram send skipped — chat ID not set yet');
                return null;
            }
            const body = {
                chat_id: defaultChatId,
                text: truncateTelegram(text),
                parse_mode: 'Markdown',
            };
            if (replyToId) body.reply_to_message_id = stripPrefix(replyToId);
            if (threadId) body.message_thread_id = threadId;
            if (replyMarkup) body.reply_markup = replyMarkup;
            try {
                const result = await api('sendMessage', body);
                return 'tg:' + result.message_id;
            } catch (e) {
                // Retry without Markdown if parse fails
                if (e.message.includes("can't parse")) {
                    console.log(`  ⚠️ Telegram Markdown parse failed in send(), retrying plain: ${e.message.substring(0, 120)}`);
                    delete body.parse_mode;
                    const result = await api('sendMessage', body);
                    return 'tg:' + result.message_id;
                }
                throw e;
            }
        },

        async sendFile(filePath, caption, replyToId, threadId) {
            if (!defaultChatId) {
                console.log('  ⚠️ Telegram sendFile skipped — chat ID not set yet');
                return null;
            }
            if (typeof globalThis.FormData === 'undefined' || typeof globalThis.Blob === 'undefined') {
                console.log('  ⚠️ Telegram sendFile requires Node 18+. FormData/Blob not available.');
                return null;
            }
            try {
                const ext = path.extname(filePath).toLowerCase();
                const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext);
                const method = isImage ? 'sendPhoto' : 'sendDocument';
                const fieldName = isImage ? 'photo' : 'document';

                const form = new FormData();
                form.append('chat_id', defaultChatId);
                form.append(fieldName, new Blob([readFileSync(filePath)]), path.basename(filePath));
                if (caption) form.append('caption', caption);
                if (replyToId) form.append('reply_to_message_id', stripPrefix(replyToId));
                if (threadId) form.append('message_thread_id', String(threadId));

                const res = await fetch(`${BASE}/${method}`, { method: 'POST', body: form });
                const data = await res.json();
                if (!data.ok) throw new Error(data.description || 'upload failed');
                return 'tg:' + data.result.message_id;
            } catch (e) {
                console.log(`  ⚠️ Telegram sendFile failed: ${e.message}`);
                return null;
            }
        },

        async edit(msgId, text) {
            if (!defaultChatId) return false;
            const body = {
                chat_id: defaultChatId,
                message_id: Number(stripPrefix(msgId)),
                text: truncateTelegram(text),
                parse_mode: 'Markdown',
            };
            try {
                await api('editMessageText', body);
                return true;
            } catch (e) {
                // Retry without Markdown if parse fails
                if (e.message.includes("can't parse")) {
                    console.log(`  ⚠️ Telegram Markdown parse failed in edit(), retrying plain: ${e.message.substring(0, 120)}`);
                    delete body.parse_mode;
                    try {
                        await api('editMessageText', body);
                        return true;
                    } catch { return false; }
                }
                // "message is not modified" is not a real error
                if (e.message.includes('not modified')) return true;
                return false;
            }
        },

        async pin(msgId) {
            if (!defaultChatId) return;
            try {
                await api('pinChatMessage', {
                    chat_id: defaultChatId,
                    message_id: Number(stripPrefix(msgId)),
                    disable_notification: true,
                });
            } catch (e) {
                console.log(`  ⚠️ Could not pin Telegram message: ${e.message}`);
            }
        },

        async unpin(msgId) {
            if (!defaultChatId) return;
            try {
                await api('unpinChatMessage', {
                    chat_id: defaultChatId,
                    message_id: Number(stripPrefix(msgId)),
                });
            } catch {}
        },

        async deleteMsg(msgId) {
            if (!defaultChatId) return;
            try {
                await api('deleteMessage', {
                    chat_id: defaultChatId,
                    message_id: Number(stripPrefix(msgId)),
                });
            } catch {}
        },

        async downloadMedia(rawMsg) {
            try {
                let fileId = null;
                let type = null;

                if (rawMsg.photo && rawMsg.photo.length > 0) {
                    // Pick largest photo
                    fileId = rawMsg.photo[rawMsg.photo.length - 1].file_id;
                    type = 'image';
                } else if (rawMsg.voice) {
                    fileId = rawMsg.voice.file_id;
                    type = 'voice';
                } else if (rawMsg.audio) {
                    fileId = rawMsg.audio.file_id;
                    type = 'voice';
                }

                if (!fileId) return null;

                const file = await api('getFile', { file_id: fileId });
                const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;
                const res = await fetch(url);
                if (!res.ok) return null;
                const buffer = Buffer.from(await res.arrayBuffer());

                if (type === 'image') {
                    const ext = file.file_path.endsWith('.png') ? 'png' : 'jpg';
                    const filePath = path.join(TMP_DIR, `img-${Date.now()}.${ext}`);
                    writeFileSync(filePath, buffer);
                    return { filePath, mimetype: `image/${ext === 'png' ? 'png' : 'jpeg'}` };
                }

                if (type === 'voice') {
                    const ext = path.extname(file.file_path) || '.ogg';
                    const filePath = path.join(TMP_DIR, `voice-${Date.now()}${ext}`);
                    writeFileSync(filePath, buffer);
                    const mimeMap = { '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.wav': 'audio/wav' };
                    return { filePath, mimetype: mimeMap[ext] || 'audio/ogg' };
                }

                return null;
            } catch (e) {
                console.log(`  ⚠️ Could not download Telegram media: ${e.message}`);
                return null;
            }
        },

        async getQuotedMessage(rawMsg) {
            if (!rawMsg.reply_to_message) return null;
            const reply = rawMsg.reply_to_message;
            return {
                id: 'tg:' + reply.message_id,
                body: reply.text || reply.caption || '',
            };
        },

        async answerCallbackQuery(callbackQueryId, text) {
            try {
                await api('answerCallbackQuery', { callback_query_id: callbackQueryId, text });
            } catch (e) {
                console.log(`  ⚠️ Could not answer callback query: ${e.message}`);
            }
        },

        async forwardMessage(msgId, toThreadId) {
            if (!defaultChatId) return;
            try {
                await api('forwardMessage', {
                    chat_id: defaultChatId,
                    from_chat_id: defaultChatId,
                    message_id: Number(stripPrefix(msgId)),
                    message_thread_id: toThreadId,
                });
            } catch (e) {
                console.log(`  ⚠️ Could not forward message ${msgId}: ${e.message}`);
            }
        },

        async removeReplyMarkup(msgId) {
            if (!defaultChatId) return;
            try {
                await api('editMessageReplyMarkup', {
                    chat_id: defaultChatId,
                    message_id: Number(stripPrefix(msgId)),
                    reply_markup: { inline_keyboard: [] },
                });
            } catch (e) {
                console.log(`  ⚠️ Could not remove reply markup: ${e.message}`);
            }
        },

        async sendGoodbye() {
            if (defaultChatId) {
                try {
                    await adapter.send('🐺 bark-pack is offline. byebye');
                } catch {}
            }
        },
    };

    return adapter;
}

function stripPrefix(msgId) {
    const s = String(msgId);
    if (s.startsWith('tg:')) return s.slice(3);
    return s;
}

function truncateTelegram(text) {
    // Telegram message limit is 4096 chars
    if (text.length > 4096) return text.substring(0, 4090) + '...';
    return text;
}

module.exports = { createTelegramAdapter };
