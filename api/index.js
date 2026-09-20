const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// ==========================================
// ১. আপনার দেওয়া কনফিগারেশন
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyBorrCat_ZFbAlgT50GYA6Ac2S8YPupyug",
  authDomain: "live-chat-maker.firebaseapp.com",
  projectId: "live-chat-maker",
  storageBucket: "live-chat-maker.firebasestorage.app",
  messagingSenderId: "739340806790",
  appId: "1:739340806790:web:934347613cf6eb673aff07",
  measurementId: "G-GCE7BB50GV"
};

const MOTHER_BOT_TOKEN = process.env.MOTHER_BOT_TOKEN || '8518861239:AAGWPmLb_gQ-jVJ616BoIxAR8eKnXxpoMV0';
const MOTHER_ADMIN_ID = parseInt(process.env.MOTHER_ADMIN_ID || '8045367594', 10);
const SERVER_URL = process.env.SERVER_URL || 'https://live-chat-maker.onrender.com';

const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;

// ==========================================
// ২. ফায়ারবেস REST API হেল্পার (১০০% ক্র্যাশ-প্রুফ)
// ==========================================
function toFirestoreFields(obj) {
    const fields = {};
    for (const [key, value] of Object.entries(obj)) {
        if (value === null || value === undefined) {
            fields[key] = { nullValue: null };
        } else if (typeof value === 'string') {
            fields[key] = { stringValue: value };
        } else if (typeof value === 'number') {
            fields[key] = Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
        } else if (typeof value === 'boolean') {
            fields[key] = { booleanValue: value };
        } else if (Array.isArray(value)) {
            fields[key] = {
                arrayValue: {
                    values: value.map(v => {
                        if (typeof v === 'number') return { integerValue: String(v) };
                        return { stringValue: String(v) };
                    })
                }
            };
        } else if (typeof value === 'object') {
            fields[key] = { mapValue: { fields: toFirestoreFields(value) } };
        }
    }
    return fields;
}

function fromFirestoreFields(fields) {
    if (!fields) return {};
    const obj = {};
    for (const [key, valueObj] of Object.entries(fields)) {
        if ('stringValue' in valueObj) obj[key] = valueObj.stringValue;
        else if ('integerValue' in valueObj) obj[key] = parseInt(valueObj.integerValue, 10);
        else if ('doubleValue' in valueObj) obj[key] = parseFloat(valueObj.doubleValue);
        else if ('booleanValue' in valueObj) obj[key] = valueObj.booleanValue;
        else if ('nullValue' in valueObj) obj[key] = null;
        else if ('arrayValue' in valueObj) {
            obj[key] = (valueObj.arrayValue.values || []).map(v => {
                if ('integerValue' in v) return parseInt(v.integerValue, 10);
                if ('stringValue' in v) return v.stringValue;
                return v;
            });
        } else if ('mapValue' in valueObj) {
            obj[key] = fromFirestoreFields(valueObj.mapValue.fields);
        }
    }
    return obj;
}

async function fbSet(collection, docId, data) {
    try {
        const url = `${FIRESTORE_BASE}/${collection}/${encodeURIComponent(docId)}?key=${firebaseConfig.apiKey}`;
        await axios.patch(url, { fields: toFirestoreFields(data) }, { timeout: 8000 });
        return true;
    } catch (e) {
        console.error(`Firebase Set Error [${collection}/${docId}]:`, e.response ? e.response.data : e.message);
        return false;
    }
}

async function fbGet(collection, docId) {
    try {
        const url = `${FIRESTORE_BASE}/${collection}/${encodeURIComponent(docId)}?key=${firebaseConfig.apiKey}`;
        const res = await axios.get(url, { timeout: 8000 });
        return fromFirestoreFields(res.data.fields);
    } catch (e) {
        return null;
    }
}

async function fbAdd(collection, data) {
    try {
        const url = `${FIRESTORE_BASE}/${collection}?key=${firebaseConfig.apiKey}`;
        const res = await axios.post(url, { fields: toFirestoreFields(data) }, { timeout: 8000 });
        return res.data;
    } catch (e) {
        console.error(`Firebase Add Error [${collection}]:`, e.response ? e.response.data : e.message);
        return null;
    }
}

async function fbQuery(collectionName, fieldName, op, fieldValue) {
    try {
        const url = `${FIRESTORE_BASE}:runQuery?key=${firebaseConfig.apiKey}`;
        let valueKey = 'stringValue';
        if (typeof fieldValue === 'number') valueKey = 'integerValue';

        const body = {
            structuredQuery: {
                from: [{ collectionId: collectionName }],
                where: {
                    fieldFilter: {
                        field: { fieldPath: fieldName },
                        op: op,
                        value: { [valueKey]: fieldValue }
                    }
                },
                limit: 20
            }
        };

        const res = await axios.post(url, body, { timeout: 8000 });
        const results = [];
        for (const item of res.data) {
            if (item.document && item.document.fields) {
                results.push({
                    id: item.document.name.split('/').pop(),
                    ...fromFirestoreFields(item.document.fields)
                });
            }
        }
        return results;
    } catch (e) {
        console.error('Firebase Query Error:', e.response ? e.response.data : e.message);
        return [];
    }
}

// Telegram API Helper
async function tg(token, method, data = {}) {
    try {
        const res = await axios.post(`https://api.telegram.org/bot${token}/${method}`, data, {
            timeout: 20000,
            headers: { 'Content-Type': 'application/json' }
        });
        return res.data;
    } catch (err) {
        console.error(`Telegram ${method} Error:`, err.response ? err.response.data : err.message);
        return err.response ? err.response.data : { ok: false, description: err.message };
    }
}

function esc(str = '') {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// In-Memory Fallback State (যদি ফায়ারবেস সাময়িক স্লো থাকে তাহলেও স্টেট হারাবে না)
const memoryStates = new Map();

// ==========================================
// ৩. হেলথ চেক রাউট (Uptime ও টেস্টের জন্য)
// ==========================================
app.get('/health', (req, res) => {
    res.status(200).send(`LIVE_CHAT_MAKER_BOT is Active 24/7! Project: ${firebaseConfig.projectId}`);
});

app.get('/', (req, res) => {
    res.send(`LIVE_CHAT_MAKER_BOT Webhook Gateway Running.`);
});

// ==========================================
// ৪. মাদার বট (BUILDER BOT WEBHOOK)
// ==========================================
app.post('/webhook/builder', async (req, res) => {
    // টেলিগ্রামকে সাথে সাথে ২০০ ওকে জানিয়ে দেওয়া (যাতে রিকোয়েস্ট টাইমআউট না হয়)
    res.sendStatus(200);

    try {
        const update = req.body;
        if (!update || !update.message) return;

        const msg = update.message;
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = (msg.text || '').trim();

        // স্টেট রিড
        let userData = (await fbGet('builder_users', String(userId))) || memoryStates.get(userId) || {};

        // /start কমান্ড
        if (text === '/start') {
            const newState = { step: 'IDLE' };
            memoryStates.set(userId, newState);
            await fbSet('builder_users', String(userId), newState);

            return await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                chat_id: chatId,
                text: `╭━━━━━━━━━━━━━━━━━━━━╮\n`
                    + `  🤖 <b>LIVE CHAT BOT BUILDER</b> 💬\n`
                    + `╰━━━━━━━━━━━━━━━━━━━━╯\n\n`
                    + `🌸 আসসালামু আলাইকুম! স্বাগতম <b>LIVE_CHAT_MAKER_BOT</b>-এ।\n\n`
                    + `আপনার নিজস্ব লাইভ চ্যাট সাপোর্ট বট তৈরি করতে নিচের <b>➕ Create Bot</b> বাটনে ক্লিক করুন।`,
                parse_mode: 'HTML',
                reply_markup: {
                    keyboard: [
                        [{ text: '➕ Create Bot' }],
                        [{ text: '📋 My Bots' }, { text: '❌ Cancel' }]
                    ],
                    resize_keyboard: true
                }
            });
        }

        // Cancel অ্যাকশন
        if (text === '❌ Cancel') {
            const newState = { step: 'IDLE' };
            memoryStates.set(userId, newState);
            await fbSet('builder_users', String(userId), newState);

            return await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                chat_id: chatId,
                text: `❌ বর্তমান অ্যাকশন বাতিল করা হয়েছে।`,
                parse_mode: 'HTML',
                reply_markup: {
                    keyboard: [[{ text: '➕ Create Bot' }]],
                    resize_keyboard: true
                }
            });
        }

        // Create Bot ক্লিক
        if (text === '➕ Create Bot') {
            const newState = { step: 'AWAITING_SERVICE_TYPE' };
            memoryStates.set(userId, newState);
            await fbSet('builder_users', String(userId), newState);

            return await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                chat_id: chatId,
                text: `🤖 <b>যে ধরণের বট তৈরি করতে চান নির্বাচন করুন:</b>`,
                parse_mode: 'HTML',
                reply_markup: {
                    keyboard: [
                        [{ text: '💬 Live Chat Bot' }],
                        [{ text: '❌ Cancel' }]
                    ],
                    resize_keyboard: true
                }
            });
        }

        // Live Chat Bot সিলেক্ট
        if (userData.step === 'AWAITING_SERVICE_TYPE' && text === '💬 Live Chat Bot') {
            const newState = { step: 'AWAITING_BOT_TOKEN' };
            memoryStates.set(userId, newState);
            await fbSet('builder_users', String(userId), newState);

            return await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                chat_id: chatId,
                text: `🔑 <b>আপনার বটের টোকেন দিন:</b>\n\n`
                    + `@BotFather থেকে পাওয়া আপনার বটের API Token কপি করে এখানে পাঠান।`,
                parse_mode: 'HTML',
                reply_markup: {
                    keyboard: [[{ text: '❌ Cancel' }]],
                    resize_keyboard: true
                }
            });
        }

        // বট টোকেন যাচাই ও রিসিভ
        if (userData.step === 'AWAITING_BOT_TOKEN') {
            const botInfo = await tg(text, 'getMe');
            if (!botInfo || !botInfo.ok) {
                return await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                    chat_id: chatId,
                    text: `❌ <b>অকার্যকর বট টোকেন!</b>\nটোকেনটি সঠিক নয়। অনুগ্রহ করে @BotFather থেকে সঠিক টোকেন এনে পাঠান:`
                });
            }

            const newState = {
                step: 'AWAITING_ADMIN_ID',
                tempToken: text,
                tempBotUsername: botInfo.result.username
            };
            memoryStates.set(userId, newState);
            await fbSet('builder_users', String(userId), newState);

            return await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                chat_id: chatId,
                text: `✅ টোকেন সঠিক হয়েছে! বটের ইউজারনেম: <b>@${esc(botInfo.result.username)}</b>\n\n`
                    + `👑 এবার এই বটের মূল <b>Super Admin-এর Telegram Numeric User ID</b> দিন:\n`
                    + `(যেমন আপনার আইডি: <code>${userId}</code>)`,
                parse_mode: 'HTML'
            });
        }

        // এডমিন আইডি গ্রহণ এবং ডিপ্লয়
        if (userData.step === 'AWAITING_ADMIN_ID') {
            const adminId = parseInt(text, 10);
            if (isNaN(adminId) || adminId <= 0) {
                return await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                    chat_id: chatId,
                    text: `❌ শুধুমাত্র সঠিক নিউমেরিক আইডি পাঠান (যেমন: <code>123456789</code>):`,
                    parse_mode: 'HTML'
                });
            }

            const childToken = userData.tempToken;
            const childUsername = userData.tempBotUsername;

            await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                chat_id: chatId,
                text: `⏳ <b>আপনার বট তৈরি হচ্ছে, কয়েক সেকেন্ড অপেক্ষা করুন...</b>`,
                parse_mode: 'HTML'
            });

            // চাইল্ড বটের ওয়েববুক সেট করা
            const webhookUrl = `${SERVER_URL}/webhook/child/${childToken}`;
            const hookRes = await tg(childToken, 'setWebhook', { url: webhookUrl });

            if (!hookRes || !hookRes.ok) {
                return await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                    chat_id: chatId,
                    text: `❌ ওয়েববুক সেট করতে ব্যর্থ হয়েছে: ${hookRes ? hookRes.description : 'Error'}`
                });
            }

            // ফায়ারবেসে তথ্য সেভ
            await fbSet('bots', childToken, {
                owner_id: userId,
                super_admins: [adminId],
                sub_admins: [],
                bot_username: childUsername,
                created_at: Date.now(),
                settings: {
                    welcome: "╭━━━━━━━━━━━━━━━━━━━━╮\n      🤖 <b>LIVE CHAT SUPPORT</b> 💬\n╰━━━━━━━━━━━━━━━━━━━━╯\n\n🌸 আসসালামু আলাইকুম!\nআমাদের হেল্পডেস্কে আপনাকে স্বাগতম। আপনার যেকোনো প্রশ্ন বা সমস্যা বিস্তারিত লিখে পাঠান।",
                    received: "✅ আপনার মেসেজটি সফলভাবে গ্রহণ করা হয়েছে!\n\n📩 খুব শীঘ্রই উত্তর দেওয়া হবে। অনুগ্রহ করে অপেক্ষা করুন।"
                }
            });

            memoryStates.set(userId, { step: 'IDLE' });
            await fbSet('builder_users', String(userId), { step: 'IDLE' });

            // এডমিনকে প্রারম্ভিক নোটিফিকেশন দেওয়া
            await tg(childToken, 'sendMessage', {
                chat_id: adminId,
                text: `🎉 <b>অভিনন্দন!</b>\nআপনি এই বটের <b>Main Super Admin</b> হিসেবে সেট হয়েছেন। ইউজারদের সকল মেসেজ এখানে আসবে।`,
                parse_mode: 'HTML'
            });

            return await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                chat_id: chatId,
                text: `🎉 <b>আপনার বট একদম রেডি!</b>\n\n`
                    + `🤖 <b>বট:</b> @${esc(childUsername)}\n`
                    + `👑 <b>Super Admin:</b> <code>${adminId}</code>\n`
                    + `⚡ <b>স্ট্যাটাস:</b> ১০০% একটিভ এবং লাইভ!\n\n`
                    + `এখন যে কেউ @${childUsername}-এ মেসেজ দিলে সরাসরি এডমিন ইনবক্সে যাবে এবং এডমিন রিপ্লাই করতে পারবে।`,
                parse_mode: 'HTML',
                reply_markup: {
                    keyboard: [[{ text: '➕ Create Bot' }], [{ text: '📋 My Bots' }]],
                    resize_keyboard: true
                }
            });
        }

        // My Bots লিস্ট
        if (text === '📋 My Bots') {
            const userBots = await fbQuery('bots', 'owner_id', 'EQUAL', userId);
            if (!userBots || userBots.length === 0) {
                return await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                    chat_id: chatId,
                    text: `📋 আপনার এখনো কোনো বট তৈরি করা নেই। নতুন বট বানাতে ➕ Create Bot চাপুন।`
                });
            }

            let listText = `📋 <b>আপনার তৈরি করা বটসমূহ:</b>\n\n`;
            let count = 1;
            userBots.forEach(b => {
                listText += `${count++}. @${esc(b.bot_username)} (Super Admins: ${b.super_admins?.length || 1}, Sub Admins: ${b.sub_admins?.length || 0})\n`;
            });

            return await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                chat_id: chatId,
                text: listText,
                parse_mode: 'HTML'
            });
        }
    } catch (err) {
        console.error('Builder Webhook Error:', err);
    }
});

// ==========================================
// ৫. চাইল্ড বট ইঞ্জিন (AUDIT LOG & LIVE CHAT)
// ==========================================
app.post('/webhook/child/:token', async (req, res) => {
    res.sendStatus(200);

    try {
        const token = req.params.token;
        const update = req.body;
        if (!update || !update.message) return;

        const botData = await fbGet('bots', token);
        if (!botData) return;

        const superAdmins = (botData.super_admins || []).map(Number);
        const subAdmins = (botData.sub_admins || []).map(Number);
        const allAdmins = Array.from(new Set([...superAdmins, ...subAdmins]));

        const msg = update.message;
        const chatId = msg.chat.id;
        const senderId = msg.from.id;
        const senderName = msg.from.first_name || 'User';
        const senderUsername = msg.from.username || '';
        const text = (msg.text || '').trim();

        const isSuper = superAdmins.includes(senderId);
        const isAdmin = allAdmins.includes(senderId);

        // A. এডমিন যুক্তকরণ ও তাৎক্ষণিক নোটিফিকেশন
        if (isSuper && (text.startsWith('/addsuper') || text.startsWith('/addsub'))) {
            const parts = text.split(' ');
            const targetId = parseInt(parts[1], 10);
            const isSuperCmd = text.startsWith('/addsuper');

            if (!targetId || isNaN(targetId)) {
                return await tg(token, 'sendMessage', {
                    chat_id: chatId,
                    text: `❌ ব্যবহারের নিয়ম:\n<code>${isSuperCmd ? '/addsuper' : '/addsub'} 123456789</code>`,
                    parse_mode: 'HTML'
                });
            }

            const roleName = isSuperCmd ? 'Super Admin' : 'Sub Admin';

            if (isSuperCmd) {
                if (!superAdmins.includes(targetId)) superAdmins.push(targetId);
            } else {
                if (!subAdmins.includes(targetId)) subAdmins.push(targetId);
            }

            botData.super_admins = Array.from(new Set(superAdmins));
            botData.sub_admins = Array.from(new Set(subAdmins));
            await fbSet('bots', token, botData);

            const notifyRes = await tg(token, 'sendMessage', {
                chat_id: targetId,
                text: `🎉 <b>অভিনন্দন!</b>\n`
                    + `আপনাকে @${esc(botData.bot_username)} বটের <b>${roleName}</b> হিসেবে যুক্ত করা হয়েছে।\n\n`
                    + `📩 এখন থেকে ইউজারদের সকল মেসেজ আপনি পাবেন এবং মেসেজে সরাসরি Reply দিয়ে উত্তর দিতে পারবেন।`,
                parse_mode: 'HTML'
            });

            let note = '\n\n📩 নতুন এডমিনকে মেসেজ পাঠিয়ে দেওয়া হয়েছে।';
            if (!notifyRes || !notifyRes.ok) {
                note = '\n\n⚠️ <i>সতর্কতা: এই এডমিন যদি পূর্বে বটে কখনো /start না দিয়ে থাকে, তবে টেলিগ্রাম তাকে মেসেজ পাঠাতে দেবে না। তাকে আগে বটে একবার /start দিতে বলুন।</i>';
            }

            return await tg(token, 'sendMessage', {
                chat_id: chatId,
                text: `✅ ইউজার <code>${targetId}</code>-কে সফলভাবে <b>${roleName}</b> করা হয়েছে!${note}`,
                parse_mode: 'HTML'
            });
        }

        // B. অডিট লগ চেক কমান্ড (/logs USER_ID)
        if (isSuper && text.startsWith('/logs')) {
            const parts = text.split(' ');
            const queryUserId = parseInt(parts[1], 10);

            if (!queryUserId || isNaN(queryUserId)) {
                return await tg(token, 'sendMessage', {
                    chat_id: chatId,
                    text: `❌ ব্যবহারের নিয়ম: <code>/logs USER_ID</code>`,
                    parse_mode: 'HTML'
                });
            }

            const logs = await fbQuery('audit_logs', 'user_id', 'EQUAL', queryUserId);

            if (!logs || logs.length === 0) {
                return await tg(token, 'sendMessage', {
                    chat_id: chatId,
                    text: `📋 ইউজার <code>${queryUserId}</code>-এর সাথে কোনো হিস্ট্রি পাওয়া যায়নি।`,
                    parse_mode: 'HTML'
                });
            }

            let out = `📑 <b>AUDIT LOGS (User: <code>${queryUserId}</code>)</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
            logs.forEach(l => {
                const date = new Date(l.timestamp).toLocaleString('en-US', { timeZone: 'Asia/Dhaka' });
                out += `🕒 <i>${date}</i>\n`
                    + `👨‍💻 <b>Admin:</b> ${esc(l.admin_name)} [<code>${l.admin_id}</code>] (${l.admin_role})\n`
                    + `💬 <b>Message:</b> ${esc(l.reply_text || '[Media/File]')}\n━━━━━━━━━━━━━━━━━━━━\n`;
            });

            return await tg(token, 'sendMessage', { chat_id: chatId, text: out, parse_mode: 'HTML' });
        }

        // C. এডমিন রিপ্লাই প্রদান ও অডিট ট্র্যাকিং
        if (isAdmin && msg.reply_to_message) {
            const replyToMsgId = msg.reply_to_message.message_id;
            const tickets = await fbQuery('tickets', 'admin_message_id', 'EQUAL', replyToMsgId);
            const targetTicket = (tickets || []).find(t => t.admin_id === senderId);

            if (targetTicket) {
                const targetUserId = targetTicket.user_id;

                const copyRes = await tg(token, 'copyMessage', {
                    chat_id: targetUserId,
                    from_chat_id: chatId,
                    message_id: msg.message_id
                });

                if (copyRes && copyRes.ok) {
                    const adminRole = isSuper ? 'Super Admin' : 'Sub Admin';

                    await fbAdd('audit_logs', {
                        bot_token: token,
                        admin_id: senderId,
                        admin_name: senderName,
                        admin_username: senderUsername,
                        admin_role: adminRole,
                        user_id: targetUserId,
                        reply_text: text || '[Media/Document/Voice]',
                        timestamp: Date.now()
                    });

                    // সাব-এডমিন রিপ্লাই দিলে সুপার এডমিনদের কাছে লাইভ অ্যালার্ট
                    if (!isSuper) {
                        const alertText = `🚨 <b>LIVE AUDIT ALERT!</b>\n`
                            + `━━━━━━━━━━━━━━━━━━━━\n`
                            + `👨‍💻 <b>Sub-Admin:</b> ${esc(senderName)} (<code>${senderId}</code>)\n`
                            + `👤 <b>Replied to User:</b> <code>${targetUserId}</code>\n`
                            + `💬 <b>Message:</b>\n${esc(text || '[Media File]')}\n`
                            + `━━━━━━━━━━━━━━━━━━━━\n`
                            + `<i>হিস্ট্রি দেখতে: <code>/logs ${targetUserId}</code></i>`;

                        for (const saId of superAdmins) {
                            if (saId !== senderId) {
                                await tg(token, 'sendMessage', {
                                    chat_id: saId,
                                    text: alertText,
                                    parse_mode: 'HTML'
                                });
                            }
                        }
                    }

                    return await tg(token, 'sendMessage', {
                        chat_id: chatId,
                        text: `✅ <b>ইউজারের কাছে উত্তর পৌঁছে গেছে!</b>`,
                        parse_mode: 'HTML',
                        reply_to_message_id: msg.message_id
                    });
                } else {
                    return await tg(token, 'sendMessage', {
                        chat_id: chatId,
                        text: `❌ উত্তর পাঠানো যায়নি। সম্ভবত ইউজার বট ব্লক করেছে।`,
                        parse_mode: 'HTML',
                        reply_to_message_id: msg.message_id
                    });
                }
            }
        }

        // D. সাধারণ ইউজার মেসেজ হ্যান্ডলিং (Forward to all admins)
        if (!isAdmin) {
            if (text === '/start') {
                const welcomeMsg = botData.settings?.welcome || "👋 স্বাগতম! আপনার সমস্যা বিস্তারিত লিখে পাঠান।";
                return await tg(token, 'sendMessage', {
                    chat_id: chatId,
                    text: welcomeMsg,
                    parse_mode: 'HTML'
                });
            }

            let msgType = '💬 Text Message';
            if (msg.photo) msgType = '📷 Photo';
            else if (msg.video) msgType = '🎥 Video';
            else if (msg.document) msgType = '📄 Document';
            else if (msg.voice) msgType = '🎤 Voice';
            else if (msg.audio) msgType = '🎵 Audio';
            else if (msg.sticker) msgType = '🙂 Sticker';

            const forwardNotice = `📩 <b>NEW SUPPORT INQUIRY</b>\n`
                + `━━━━━━━━━━━━━━━━━━━━\n`
                + `👤 <b>Name:</b> ${esc(senderName)}\n`
                + `🔹 <b>Username:</b> ${senderUsername ? '@' + esc(senderUsername) : 'None'}\n`
                + `🆔 <b>User ID:</b> <code>${senderId}</code>\n`
                + `💬 <b>Type:</b> ${msgType}\n`
                + `━━━━━━━━━━━━━━━━━━━━\n`
                + (text ? `📝 <b>Message:</b>\n${esc(text)}\n━━━━━━━━━━━━━━━━━━━━\n` : '')
                + `<i>⚠️ এই মেসেজে সরাসরি Reply দিলে ইউজারের কাছে উত্তর চলে যাবে।</i>`;

            for (const adminId of allAdmins) {
                const resNotice = await tg(token, 'sendMessage', {
                    chat_id: adminId,
                    text: forwardNotice,
                    parse_mode: 'HTML'
                });

                if (!text) {
                    await tg(token, 'copyMessage', {
                        chat_id: adminId,
                        from_chat_id: chatId,
                        message_id: msg.message_id
                    });
                }

                if (resNotice && resNotice.ok) {
                    await fbAdd('tickets', {
                        bot_token: token,
                        user_id: senderId,
                        admin_id: adminId,
                        admin_message_id: resNotice.result.message_id,
                        created_at: Date.now()
                    });
                }
            }

            // ১ ঘণ্টার কুলডাউন লজিক
            const userLog = (await fbGet('user_cooldowns', `${token}_${senderId}`)) || {};
            const now = Date.now();
            let shouldSendAck = false;

            if (!userLog.last_ack_time || (now - userLog.last_ack_time >= 3600000)) {
                shouldSendAck = true;
            }

            if (shouldSendAck) {
                const ackMsg = botData.settings?.received || "✅ আপনার মেসেজটি সফলভাবে গ্রহণ করা হয়েছে!\n\n📩 খুব শীঘ্রই উত্তর দেওয়া হবে। অনুগ্রহ করে অপেক্ষা করুন।";
                await tg(token, 'sendMessage', {
                    chat_id: chatId,
                    text: ackMsg,
                    parse_mode: 'HTML',
                    reply_to_message_id: msg.message_id
                });

                await fbSet('user_cooldowns', `${token}_${senderId}`, { last_ack_time: now });
            }
        }
    } catch (err) {
        console.error('Child Webhook Error:', err);
    }
});

// ==========================================
// ৬. সার্ভার পোর্ট লিসেন
// ==========================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`LIVE_CHAT_MAKER_BOT Gateway running on port ${PORT}`);
});
