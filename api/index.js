const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// ==========================================
// ১. ফায়ারবেস ও বট কনফিগারেশন
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

function safeKey(token = '') {
    return Buffer.from(String(token)).toString('hex');
}

function formatDateTime(timestamp) {
    return new Date(timestamp).toLocaleString('en-US', {
        timeZone: 'Asia/Dhaka',
        dateStyle: 'medium',
        timeStyle: 'short'
    });
}

// ==========================================
// ২. ফায়ারবেস REST API ইঞ্জিন
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
                limit: 100
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
        return [];
    }
}

async function fbGetAll(collectionName) {
    try {
        const url = `${FIRESTORE_BASE}/${collectionName}?key=${firebaseConfig.apiKey}&pageSize=100`;
        const res = await axios.get(url, { timeout: 10000 });
        if (!res.data.documents) return [];
        return res.data.documents.map(d => ({
            id: d.name.split('/').pop(),
            ...fromFirestoreFields(d.fields)
        }));
    } catch (e) {
        return [];
    }
}

async function tg(token, method, data = {}) {
    try {
        const res = await axios.post(`https://api.telegram.org/bot${token}/${method}`, data, {
            timeout: 25000,
            headers: { 'Content-Type': 'application/json' }
        });
        return res.data;
    } catch (err) {
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

const memoryStates = new Map();

// ==========================================
// ৩. কালারিং কিবোর্ড মেনু বিল্ডার (NO SLASH COMMANDS)
// ==========================================
function getMotherAdminKeyboard(isSuperOwner = false) {
    const rows = [
        [
            { text: '🟢 ➕ Create Bot', style: 'success' },
            { text: '📋 My Bots', style: 'primary' }
        ]
    ];

    if (isSuperOwner) {
        rows.push([
            { text: '👑 📊 All Bots Details', style: 'primary' },
            { text: '📢 Broadcast All Bots', style: 'danger' }
        ]);
        rows.push([
            { text: '🎯 Single Bot Broadcast', style: 'danger' }
        ]);
    }

    return {
        keyboard: rows,
        resize_keyboard: true
    };
}

function getChildAdminKeyboard(isSuper = false) {
    const rows = [];
    if (isSuper) {
        rows.push([
            { text: '👑 ➕ Add Super Admin', style: 'primary' },
            { text: '👤 ➕ Add Sub Admin', style: 'primary' }
        ]);
        rows.push([
            { text: '📑 Audit Logs', style: 'primary' },
            { text: '📢 Bot Broadcast', style: 'success' }
        ]);
    }
    rows.push([
        { text: '👥 Admin List', style: 'primary' },
        { text: '📊 Bot Status', style: 'primary' }
    ]);
    rows.push([
        { text: '🔄 Refresh Panel', style: 'primary' }
    ]);

    return {
        keyboard: rows,
        resize_keyboard: true
    };
}

function getCancelKeyboard() {
    return {
        keyboard: [[{ text: '🔴 ❌ Cancel', style: 'danger' }]],
        resize_keyboard: true
    };
}

// ==========================================
// ৪. হেলথ চেক
// ==========================================
app.get('/health', (req, res) => {
    res.status(200).send(`LIVE_CHAT_MAKER_BOT Active 24/7. Firebase: ${firebaseConfig.projectId}`);
});

app.get('/', (req, res) => {
    res.send(`LIVE_CHAT_MAKER_BOT Gateway Running.`);
});

// ==========================================
// ৫. মাদার বট (BUILDER ENGINE)
// ==========================================
app.post('/webhook/builder', async (req, res) => {
    res.sendStatus(200);

    try {
        const update = req.body;
        if (!update || !update.message) return;

        const msg = update.message;
        const chatId = msg.chat.id;
        const userId = msg.from.id;
        const text = (msg.text || '').trim();
        const isOwner = (userId === MOTHER_ADMIN_ID);

        let userState = (await fbGet('builder_users', String(userId))) || memoryStates.get(userId) || {};

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
                    + `আপনার নিজস্ব লাইভ চ্যাট সাপোর্ট বট তৈরি ও নিয়ন্ত্রণ করতে নিচের মেনু বাটন ব্যবহার করুন।`,
                parse_mode: 'HTML',
                reply_markup: getMotherAdminKeyboard(isOwner)
            });
        }

        if (text === '❌ Cancel' || text === '🔴 ❌ Cancel') {
            const newState = { step: 'IDLE' };
            memoryStates.set(userId, newState);
            await fbSet('builder_users', String(userId), newState);

            return await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                chat_id: chatId,
                text: `❌ বর্তমান অ্যাকশন বাতিল করা হয়েছে।`,
                parse_mode: 'HTML',
                reply_markup: getMotherAdminKeyboard(isOwner)
            });
        }

        // Create Bot শুরু
        if (text.includes('Create Bot')) {
            const newState = { step: 'AWAITING_SERVICE_TYPE' };
            memoryStates.set(userId, newState);
            await fbSet('builder_users', String(userId), newState);

            return await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                chat_id: chatId,
                text: `🤖 <b>বটের ধরন নির্বাচন করুন:</b>`,
                parse_mode: 'HTML',
                reply_markup: {
                    keyboard: [
                        [{ text: '💬 Live Chat Bot', style: 'primary' }],
                        [{ text: '🔴 ❌ Cancel', style: 'danger' }]
                    ],
                    resize_keyboard: true
                }
            });
        }

        if (userState.step === 'AWAITING_SERVICE_TYPE' && text.includes('Live Chat Bot')) {
            const newState = { step: 'AWAITING_BOT_TOKEN' };
            memoryStates.set(userId, newState);
            await fbSet('builder_users', String(userId), newState);

            return await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                chat_id: chatId,
                text: `🔑 <b>আপনার বটের টোকেন পাঠান:</b>\n\n`
                    + `@BotFather থেকে পাওয়া আপনার বটের API Token কপি করে এখানে পাঠান।`,
                parse_mode: 'HTML',
                reply_markup: getCancelKeyboard()
            });
        }

        // টোকেন যাচাই
        if (userState.step === 'AWAITING_BOT_TOKEN') {
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
                parse_mode: 'HTML',
                reply_markup: getCancelKeyboard()
            });
        }

        // এডমিন আইডি গ্রহণ এবং ডিপ্লয়
        if (userState.step === 'AWAITING_ADMIN_ID') {
            const adminId = parseInt(text, 10);
            if (isNaN(adminId) || adminId <= 0) {
                return await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                    chat_id: chatId,
                    text: `❌ শুধুমাত্র সঠিক নিউমেরিক আইডি পাঠান (যেমন: <code>123456789</code>):`,
                    parse_mode: 'HTML'
                });
            }

            const childToken = userState.tempToken;
            const childUsername = userState.tempBotUsername;
            const createdAt = Date.now();

            await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                chat_id: chatId,
                text: `⏳ <b>আপনার বট তৈরি হচ্ছে, কয়েক সেকেন্ড অপেক্ষা করুন...</b>`,
                parse_mode: 'HTML'
            });

            const webhookUrl = `${SERVER_URL}/webhook/child?token=${encodeURIComponent(childToken)}`;
            const hookRes = await tg(childToken, 'setWebhook', { 
                url: webhookUrl,
                drop_pending_updates: true 
            });

            if (!hookRes || !hookRes.ok) {
                return await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                    chat_id: chatId,
                    text: `❌ ওয়েববুক সেট করতে ব্যর্থ হয়েছে: ${hookRes ? hookRes.description : 'Unknown error'}`
                });
            }

            const botId = safeKey(childToken);
            const botData = {
                bot_id: botId,
                token: childToken,
                owner_id: userId,
                super_admins: [adminId],
                sub_admins: [],
                bot_username: childUsername,
                created_at: createdAt,
                created_at_formatted: formatDateTime(createdAt),
                settings: {
                    welcome: "╭━━━━━━━━━━━━━━━━━━━━╮\n      🤖 <b>LIVE CHAT SUPPORT</b> 💬\n╰━━━━━━━━━━━━━━━━━━━━╯\n\n🌸 আসসালামু আলাইকুম!\nআমাদের হেল্পডেস্কে আপনাকে স্বাগতম। আপনার যেকোনো প্রশ্ন বা সমস্যা বিস্তারিত লিখে পাঠান।",
                    received: "✅ আপনার মেসেজটি সফলভাবে গ্রহণ করা হয়েছে!\n\n📩 খুব শীঘ্রই উত্তর দেওয়া হবে। অনুগ্রহ করে অপেক্ষা করুন।"
                }
            };

            await fbSet('bots', botId, botData);
            memoryStates.set(userId, { step: 'IDLE' });
            await fbSet('builder_users', String(userId), { step: 'IDLE' });

            const startBotUrl = `https://t.me/${childUsername}?start=start`;

            // ওনারকে মেসেজ দেওয়া
            await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                chat_id: chatId,
                text: `🎉 <b>আপনার বট একদম রেডি!</b>\n\n`
                    + `🤖 <b>বট ইউজারনেম:</b> @${esc(childUsername)}\n`
                    + `👑 <b>Super Admin ID:</b> <code>${adminId}</code>\n`
                    + `📅 <b>তৈরির তারিখ ও সময়:</b> ${formatDateTime(createdAt)}\n\n`
                    + `⚠️ <b>জরুরি নির্দেশ:</b>\n`
                    + `অ্যাডমিন প্যানেল সক্রিয় করতে নিচে দেওয়া বটে গিয়ে <b>/start</b> বাটন চাপুন! 👇`,
                parse_mode: 'HTML',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🟢 বটে গিয়ে /start করুন', url: startBotUrl, style: 'success' }]
                    ]
                }
            });

            // সুপার অ্যাডমিনকে সরাসরি মেসেজ পাঠিয়ে স্টার্ট করতে বলা
            if (adminId !== userId) {
                await tg(childToken, 'sendMessage', {
                    chat_id: adminId,
                    text: `🎉 <b>অভিনন্দন!</b>\n`
                        + `আপনাকে @${esc(childUsername)} বটের <b>Main Super Admin</b> হিসেবে যুক্ত করা হয়েছে।\n\n`
                        + `👉 আপনার অ্যাডমিন কিবোর্ড প্যানেল সক্রিয় করতে এখনই নিচে ক্লিক করে বটে <b>/start</b> করুন।`,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🟢 /start করুন', url: startBotUrl, style: 'success' }]
                        ]
                    }
                });
            }

            return;
        }

        // My Bots লিস্ট
        if (text.includes('My Bots')) {
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
                listText += `${count++}. @${esc(b.bot_username)}\n`
                    + `   📅 তৈরি: ${b.created_at_formatted || formatDateTime(b.created_at)}\n`
                    + `   👑 Super Admins: ${b.super_admins?.length || 1}\n\n`;
            });

            return await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                chat_id: chatId,
                text: listText,
                parse_mode: 'HTML'
            });
        }

        // ==========================================
        // ওনার ফিচার: ALL BOTS DETAILS & BROADCAST
        // ==========================================
        if (isOwner && text.includes('All Bots Details')) {
            const allBots = await fbGetAll('bots');
            if (allBots.length === 0) {
                return await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                    chat_id: chatId,
                    text: `📊 এখনো কোনো বট তৈরি করা হয়নি।`
                });
            }

            let report = `👑 <b>ALL CREATED BOTS OVERVIEW (${allBots.length} টি)</b>\n━━━━━━━━━━━━━━━━━━━━\n\n`;
            allBots.forEach((b, i) => {
                report += `${i + 1}. 🤖 <b>@${esc(b.bot_username)}</b>\n`
                    + `   👤 <b>Creator ID:</b> <code>${b.owner_id}</code>\n`
                    + `   👑 <b>Super Admins:</b> <code>${(b.super_admins || []).join(', ')}</code>\n`
                    + `   🔑 <b>Token:</b> <code>${esc(b.token)}</code>\n`
                    + `   📅 <b>Time:</b> ${b.created_at_formatted || formatDateTime(b.created_at)}\n`
                    + `━━━━━━━━━━━━━━━━━━━━\n`;
            });

            return await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                chat_id: chatId,
                text: report,
                parse_mode: 'HTML'
            });
        }

        // ALL BOTS BROADCAST
        if (isOwner && text.includes('Broadcast All Bots')) {
            memoryStates.set(userId, { step: 'AWAITING_ALL_BROADCAST_MSG' });
            return await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                chat_id: chatId,
                text: `📢 <b>BROADCAST TO ALL BOTS</b>\n\n`
                    + `সকল বটের সকল ইউজারদের কাছে পাঠাতে মেসেজটি লিখুন।\n\n`
                    + `বাটন যুক্ত করতে চাইলে মেসেজের শেষে এভাবে লিখুন:\n`
                    + `<code>বাটন নাম | https://link.com</code>`,
                parse_mode: 'HTML',
                reply_markup: getCancelKeyboard()
            });
        }

        if (isOwner && userState.step === 'AWAITING_ALL_BROADCAST_MSG') {
            memoryStates.set(userId, { step: 'IDLE' });

            const parts = text.split('\n');
            let broadcastText = text;
            let inlineKeyboard = null;

            const lastLine = parts[parts.length - 1];
            if (lastLine.includes('|')) {
                const btnParts = lastLine.split('|').map(s => s.trim());
                if (btnParts.length === 2 && btnParts[1].startsWith('http')) {
                    broadcastText = parts.slice(0, parts.length - 1).join('\n').trim();
                    inlineKeyboard = {
                        inline_keyboard: [
                            [{ text: btnParts[0], url: btnParts[1], style: 'primary' }]
                        ]
                    };
                }
            }

            const allBots = await fbGetAll('bots');
            let totalSent = 0;

            await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                chat_id: chatId,
                text: `⏳ <b>সকল ইউজারদের কাছে ব্রডকাস্ট পাঠানো শুরু হয়েছে...</b>`,
                parse_mode: 'HTML'
            });

            for (const b of allBots) {
                const subscribers = await fbQuery('bot_subscribers', 'bot_id', 'EQUAL', b.bot_id);
                for (const sub of subscribers) {
                    const sendRes = await tg(b.token, 'sendMessage', {
                        chat_id: sub.user_id,
                        text: broadcastText,
                        parse_mode: 'HTML',
                        reply_markup: inlineKeyboard
                    });
                    if (sendRes.ok) totalSent++;
                }
            }

            return await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                chat_id: chatId,
                text: `✅ <b>অল বট ব্রডকাস্ট সম্পন্ন!</b>\nমোট <b>${totalSent}</b> জন ইউজারের কাছে মেসেজ পৌঁছেছে।`,
                parse_mode: 'HTML',
                reply_markup: getMotherAdminKeyboard(true)
            });
        }

        // SINGLE BOT BROADCAST
        if (isOwner && text.includes('Single Bot Broadcast')) {
            const allBots = await fbGetAll('bots');
            if (allBots.length === 0) {
                return await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                    chat_id: chatId,
                    text: `❌ কোনো বট খুঁজে পাওয়া যায়নি।`
                });
            }

            let msgText = `🎯 <b>কোন বটে ব্রডকাস্ট পাঠাতে চান নির্বাচন করুন:</b>\n\n`;
            const buttons = [];
            allBots.forEach((b, i) => {
                msgText += `${i + 1}. @${esc(b.bot_username)}\n`;
                buttons.push([{
                    text: `🤖 @${b.bot_username}`,
                    callback_data: `sel_bcast_${b.bot_id}`,
                    style: 'primary'
                }]);
            });

            return await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                chat_id: chatId,
                text: msgText,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: buttons }
            });
        }
    } catch (err) {
        console.error('Mother Bot Error:', err);
    }
});

// ==========================================
// ৬. চাইল্ড বট ইঞ্জিন (COMPLETE KEYBOARD UI - NO COMMANDS)
// ==========================================
app.post(['/webhook/child', '/webhook/child/:tokenParam'], async (req, res) => {
    res.sendStatus(200);

    try {
        const token = req.query.token || req.params.tokenParam;
        if (!token) return;

        const botId = safeKey(token);
        const update = req.body;
        if (!update || !update.message) return;

        let botData = await fbGet('bots', botId);
        if (!botData) botData = await fbGet('bots', token);
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

        // =========================================================
        // A. চাইল্ড বট অ্যাডমিন প্যানেল (কমান্ড ছাড়া ফুল বাটন সিস্টেম)
        // =========================================================
        if (isAdmin) {
            let adminState = memoryStates.get(`child_${botId}_${senderId}`) || {};

            // Cancel
            if (text === '🔴 ❌ Cancel' || text === '❌ Cancel') {
                memoryStates.set(`child_${botId}_${senderId}`, { step: 'IDLE' });
                return await tg(token, 'sendMessage', {
                    chat_id: chatId,
                    text: `❌ অ্যাকশন বাতিল করা হয়েছে।`,
                    parse_mode: 'HTML',
                    reply_markup: getChildAdminKeyboard(isSuper)
                });
            }

            // Start & Refresh
            if (text === '/start' || text.includes('Refresh Panel')) {
                memoryStates.set(`child_${botId}_${senderId}`, { step: 'IDLE' });
                return await tg(token, 'sendMessage', {
                    chat_id: chatId,
                    text: `👑 <b>ADMIN PANEL — @${esc(botData.bot_username)}</b>\n\n`
                        + `👋 হ্যালো <b>${esc(senderName)}</b>!\n`
                        + `🛡️ পদবী: <b>${isSuper ? 'Super Admin' : 'Sub Admin'}</b>\n\n`
                        + `নিচের মেনু বাটন ব্যবহার করে বট নিয়ন্ত্রণ করুন। ইউজারদের মেসেজের উত্তর দিতে সরাসরি টেলিগ্রাম <b>Reply</b> করুন।`,
                    parse_mode: 'HTML',
                    reply_markup: getChildAdminKeyboard(isSuper)
                });
            }

            // বাটন ১: Add Super Admin
            if (isSuper && text.includes('Add Super Admin')) {
                memoryStates.set(`child_${botId}_${senderId}`, { step: 'AWAIT_ADD_SUPER' });
                return await tg(token, 'sendMessage', {
                    chat_id: chatId,
                    text: `👑 <b>ADD SUPER ADMIN</b>\n\nযাকে Super Admin করতে চান তার <b>Telegram Numeric User ID</b> পাঠান:`,
                    parse_mode: 'HTML',
                    reply_markup: getCancelKeyboard()
                });
            }

            if (isSuper && adminState.step === 'AWAIT_ADD_SUPER') {
                const targetId = parseInt(text, 10);
                if (isNaN(targetId) || targetId <= 0) {
                    return await tg(token, 'sendMessage', {
                        chat_id: chatId,
                        text: `❌ শুধুমাত্র সঠিক নিউমেরিক আইডি পাঠান (যেমন: <code>123456789</code>):`,
                        parse_mode: 'HTML'
                    });
                }

                memoryStates.set(`child_${botId}_${senderId}`, { step: 'IDLE' });
                if (!superAdmins.includes(targetId)) superAdmins.push(targetId);

                botData.super_admins = Array.from(new Set(superAdmins));
                await fbSet('bots', botId, botData);

                const startUrl = `https://t.me/${botData.bot_username}?start=start`;

                // নতুন সুপার অ্যাডমিনকে স্টার্ট করার নির্দেশ বার্তা
                await tg(token, 'sendMessage', {
                    chat_id: targetId,
                    text: `🎉 <b>অভিনন্দন!</b>\n`
                        + `আপনাকে @${esc(botData.bot_username)} বটের <b>Super Admin</b> হিসেবে যুক্ত করা হয়েছে।\n\n`
                        + `⚠️ অ্যাডমিন কিবোর্ড প্যানেল সক্রিয় করতে এখনই নিচে ক্লিক করে বটে <b>/start</b> বাটন চাপুন:`,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🟢 বটে গিয়ে /start করুন', url: startUrl, style: 'success' }]
                        ]
                    }
                });

                return await tg(token, 'sendMessage', {
                    chat_id: chatId,
                    text: `✅ ইউজার <code>${targetId}</code>-কে সফলভাবে <b>Super Admin</b> করা হয়েছে এবং স্টার্ট করার লিংক পাঠানো হয়েছে!`,
                    parse_mode: 'HTML',
                    reply_markup: getChildAdminKeyboard(isSuper)
                });
            }

            // বাটন ২: Add Sub Admin
            if (isSuper && text.includes('Add Sub Admin')) {
                memoryStates.set(`child_${botId}_${senderId}`, { step: 'AWAIT_ADD_SUB' });
                return await tg(token, 'sendMessage', {
                    chat_id: chatId,
                    text: `👤 <b>ADD SUB ADMIN</b>\n\nযাকে Sub Admin করতে চান তার <b>Telegram Numeric User ID</b> পাঠান:`,
                    parse_mode: 'HTML',
                    reply_markup: getCancelKeyboard()
                });
            }

            if (isSuper && adminState.step === 'AWAIT_ADD_SUB') {
                const targetId = parseInt(text, 10);
                if (isNaN(targetId) || targetId <= 0) {
                    return await tg(token, 'sendMessage', {
                        chat_id: chatId,
                        text: `❌ শুধুমাত্র সঠিক নিউমেরিক আইডি পাঠান (যেমন: <code>123456789</code>):`,
                        parse_mode: 'HTML'
                    });
                }

                memoryStates.set(`child_${botId}_${senderId}`, { step: 'IDLE' });
                if (!subAdmins.includes(targetId)) subAdmins.push(targetId);

                botData.sub_admins = Array.from(new Set(subAdmins));
                await fbSet('bots', botId, botData);

                const startUrl = `https://t.me/${botData.bot_username}?start=start`;

                await tg(token, 'sendMessage', {
                    chat_id: targetId,
                    text: `🎉 <b>অভিনন্দন!</b>\n`
                        + `আপনাকে @${esc(botData.bot_username)} বটের <b>Sub Admin</b> হিসেবে যুক্ত করা হয়েছে।\n\n`
                        + `⚠️ অ্যাডমিন কিবোর্ড প্যানেল সক্রিয় করতে এখনই নিচে ক্লিক করে বটে <b>/start</b> বাটন চাপুন:`,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '🟢 বটে গিয়ে /start করুন', url: startUrl, style: 'success' }]
                        ]
                    }
                });

                return await tg(token, 'sendMessage', {
                    chat_id: chatId,
                    text: `✅ ইউজার <code>${targetId}</code>-কে সফলভাবে <b>Sub Admin</b> করা হয়েছে এবং স্টার্ট করার লিংক পাঠানো হয়েছে!`,
                    parse_mode: 'HTML',
                    reply_markup: getChildAdminKeyboard(isSuper)
                });
            }

            // বাটন ৩: Audit Logs
            if (isSuper && text.includes('Audit Logs')) {
                memoryStates.set(`child_${botId}_${senderId}`, { step: 'AWAIT_LOG_USER' });
                return await tg(token, 'sendMessage', {
                    chat_id: chatId,
                    text: `📑 <b>AUDIT LOGS CHECK</b>\n\nযে ইউজারের চ্যাট হিস্ট্রি ও রিপ্লাই লগ দেখতে চান তার <b>User ID</b> পাঠান:`,
                    parse_mode: 'HTML',
                    reply_markup: getCancelKeyboard()
                });
            }

            if (isSuper && adminState.step === 'AWAIT_LOG_USER') {
                const targetUserId = parseInt(text, 10);
                memoryStates.set(`child_${botId}_${senderId}`, { step: 'IDLE' });

                if (isNaN(targetUserId) || targetUserId <= 0) {
                    return await tg(token, 'sendMessage', {
                        chat_id: chatId,
                        text: `❌ সঠিক User ID পাঠাননি।`,
                        reply_markup: getChildAdminKeyboard(isSuper)
                    });
                }

                const logs = await fbQuery('audit_logs', 'user_id', 'EQUAL', targetUserId);
                const botLogs = (logs || []).filter(l => l.bot_id === botId);

                if (botLogs.length === 0) {
                    return await tg(token, 'sendMessage', {
                        chat_id: chatId,
                        text: `📋 ইউজার <code>${targetUserId}</code>-এর সাথে কোনো রিপ্লাই লগ পাওয়া যায়নি।`,
                        parse_mode: 'HTML',
                        reply_markup: getChildAdminKeyboard(isSuper)
                    });
                }

                let out = `📑 <b>AUDIT LOGS (User: <code>${targetUserId}</code>)</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
                botLogs.slice(-10).reverse().forEach(l => {
                    const date = new Date(l.timestamp).toLocaleString('en-US', { timeZone: 'Asia/Dhaka' });
                    out += `🕒 <i>${date}</i>\n`
                        + `👨‍💻 <b>Admin:</b> ${esc(l.admin_name)} [<code>${l.admin_id}</code>] (${l.admin_role})\n`
                        + `💬 <b>Message:</b> ${esc(l.reply_text || '[Media/File]')}\n━━━━━━━━━━━━━━━━━━━━\n`;
                });

                return await tg(token, 'sendMessage', {
                    chat_id: chatId,
                    text: out,
                    parse_mode: 'HTML',
                    reply_markup: getChildAdminKeyboard(isSuper)
                });
            }

            // বাটন ৪: Bot Broadcast
            if (isSuper && text.includes('Bot Broadcast')) {
                memoryStates.set(`child_${botId}_${senderId}`, { step: 'AWAIT_CHILD_BCAST' });
                return await tg(token, 'sendMessage', {
                    chat_id: chatId,
                    text: `📢 <b>BOT BROADCAST</b>\n\nএই বটের সকল ইউজারদের কাছে পাঠাতে মেসেজটি লিখুন।\n\nবাটন যোগ করতে চাইলে শেষে লিখুন:\n<code>বাটন নাম | https://link.com</code>`,
                    parse_mode: 'HTML',
                    reply_markup: getCancelKeyboard()
                });
            }

            if (isSuper && adminState.step === 'AWAIT_CHILD_BCAST') {
                memoryStates.set(`child_${botId}_${senderId}`, { step: 'IDLE' });

                const parts = text.split('\n');
                let broadcastText = text;
                let inlineKeyboard = null;

                const lastLine = parts[parts.length - 1];
                if (lastLine.includes('|')) {
                    const btnParts = lastLine.split('|').map(s => s.trim());
                    if (btnParts.length === 2 && btnParts[1].startsWith('http')) {
                        broadcastText = parts.slice(0, parts.length - 1).join('\n').trim();
                        inlineKeyboard = {
                            inline_keyboard: [
                                [{ text: btnParts[0], url: btnParts[1], style: 'primary' }]
                            ]
                        };
                    }
                }

                const subscribers = await fbQuery('bot_subscribers', 'bot_id', 'EQUAL', botId);
                let sentCount = 0;

                await tg(token, 'sendMessage', {
                    chat_id: chatId,
                    text: `⏳ <b>ব্রডকাস্ট পাঠানো শুরু হয়েছে...</b>`,
                    parse_mode: 'HTML'
                });

                for (const sub of subscribers) {
                    const sendRes = await tg(token, 'sendMessage', {
                        chat_id: sub.user_id,
                        text: broadcastText,
                        parse_mode: 'HTML',
                        reply_markup: inlineKeyboard
                    });
                    if (sendRes.ok) sentCount++;
                }

                return await tg(token, 'sendMessage', {
                    chat_id: chatId,
                    text: `✅ <b>ব্রডকাস্ট সম্পন্ন!</b>\nমোট <b>${sentCount}</b> জন ইউজারের কাছে মেসেজ পৌঁছেছে।`,
                    parse_mode: 'HTML',
                    reply_markup: getChildAdminKeyboard(isSuper)
                });
            }

            // বাটন ৫: Admin List
            if (text.includes('Admin List')) {
                let out = `👥 <b>ADMIN LIST</b>\n\n👑 <b>SUPER ADMINS:</b>\n`;
                superAdmins.forEach(id => out += `• <code>${id}</code>\n`);
                out += `\n👤 <b>SUB ADMINS:</b>\n`;
                if (subAdmins.length === 0) out += `• কোনো সাব-এডমিন নেই।\n`;
                else subAdmins.forEach(id => out += `• <code>${id}</code>\n`);

                return await tg(token, 'sendMessage', {
                    chat_id: chatId,
                    text: out,
                    parse_mode: 'HTML',
                    reply_markup: getChildAdminKeyboard(isSuper)
                });
            }

            // বাটন ৬: Bot Status
            if (text.includes('Bot Status')) {
                return await tg(token, 'sendMessage', {
                    chat_id: chatId,
                    text: `📊 <b>BOT STATUS</b>\n\n`
                        + `🤖 <b>Username:</b> @${esc(botData.bot_username)}\n`
                        + `👑 <b>Super Admins:</b> ${superAdmins.length}\n`
                        + `👤 <b>Sub Admins:</b> ${subAdmins.length}\n`
                        + `📅 <b>Created At:</b> ${botData.created_at_formatted || 'N/A'}\n`
                        + `⚡ <b>System:</b> 100% Online & Active`,
                    parse_mode: 'HTML',
                    reply_markup: getChildAdminKeyboard(isSuper)
                });
            }

            // এডমিন রিপ্লাই প্রদান
            if (msg.reply_to_message) {
                const replyToMsgId = msg.reply_to_message.message_id;
                const tickets = await fbQuery('tickets', 'admin_message_id', 'EQUAL', replyToMsgId);
                const targetTicket = (tickets || []).find(t => t.bot_id === botId && t.admin_id === senderId);

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
                            bot_id: botId,
                            admin_id: senderId,
                            admin_name: senderName,
                            admin_username: senderUsername,
                            admin_role: adminRole,
                            user_id: targetUserId,
                            reply_text: text || '[Media/Document/Voice]',
                            timestamp: Date.now()
                        });

                        // সাব-এডমিন রিপ্লাই দিলে সুপার এডমিনদের কাছে লাইভ রিপোর্ট পাঠানো
                        if (!isSuper) {
                            const alertText = `🚨 <b>LIVE AUDIT ALERT!</b>\n`
                                + `━━━━━━━━━━━━━━━━━━━━\n`
                                + `👨‍💻 <b>Sub-Admin:</b> ${esc(senderName)} (<code>${senderId}</code>)\n`
                                + `👤 <b>Replied to:</b> <code>${targetUserId}</code>\n`
                                + `💬 <b>Message:</b> ${esc(text || '[Media File]')}`;

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
                            text: `❌ উত্তর পাঠানো যায়নি। ইউজার সম্ভবত বট ব্লক করেছে।`,
                            parse_mode: 'HTML',
                            reply_to_message_id: msg.message_id
