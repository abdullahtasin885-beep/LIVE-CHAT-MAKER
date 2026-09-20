const express = require('express');
const axios = require('axios');
const { initializeApp } = require('firebase/app');
const { 
    getFirestore, 
    doc, 
    getDoc, 
    setDoc, 
    updateDoc, 
    collection, 
    addDoc, 
    query, 
    where, 
    orderBy, 
    limit, 
    getDocs 
} = require('firebase/firestore');

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

// Initialize Firebase & Firestore
const fbApp = initializeApp(firebaseConfig);
const db = getFirestore(fbApp);

// মাদার বট ইনফরমেশন
const MOTHER_BOT_TOKEN = process.env.MOTHER_BOT_TOKEN || '8518861239:AAGWPmLb_gQ-jVJ616BoIxAR8eKnXxpoMV0';
const MOTHER_ADMIN_ID = parseInt(process.env.MOTHER_ADMIN_ID || '8045367594', 10);
const SERVER_URL = process.env.SERVER_URL || 'https://live-chat-maker.onrender.com';

// Telegram API Helper
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

// ==========================================
// ২. সেন্ট্রাল হেলথ চেক (24/7 সচল রাখার জন্য)
// ==========================================
app.get('/health', (req, res) => {
    res.status(200).send('LIVE_CHAT_MAKER_BOT Engine is Running 24/7!');
});

app.get('/', (req, res) => {
    res.send('Live Chat Maker Server is Active!');
});

// ==========================================
// ৩. মাদার বট (BUILDER ENGINE)
// ==========================================
app.post('/webhook/builder', async (req, res) => {
    res.sendStatus(200);
    const update = req.body;
    if (!update.message) return;

    const msg = update.message;
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = (msg.text || '').trim();

    const userRef = doc(db, 'builder_users', String(userId));
    const userSnap = await getDoc(userRef);
    const userData = userSnap.exists() ? userSnap.data() : {};

    // Start কমান্ড
    if (text === '/start') {
        await setDoc(userRef, { step: 'IDLE' }, { merge: true });
        return tg(MOTHER_BOT_TOKEN, 'sendMessage', {
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

    if (text === '❌ Cancel') {
        await setDoc(userRef, { step: 'IDLE' }, { merge: true });
        return tg(MOTHER_BOT_TOKEN, 'sendMessage', {
            chat_id: chatId,
            text: `❌ বর্তমান অ্যাকশন বাতিল করা হয়েছে।`,
            parse_mode: 'HTML',
            reply_markup: {
                keyboard: [[{ text: '➕ Create Bot' }]],
                resize_keyboard: true
            }
        });
    }

    if (text === '➕ Create Bot') {
        await setDoc(userRef, { step: 'AWAITING_SERVICE_TYPE' }, { merge: true });
        return tg(MOTHER_BOT_TOKEN, 'sendMessage', {
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

    if (userData.step === 'AWAITING_SERVICE_TYPE' && text === '💬 Live Chat Bot') {
        await setDoc(userRef, { step: 'AWAITING_BOT_TOKEN' }, { merge: true });
        return tg(MOTHER_BOT_TOKEN, 'sendMessage', {
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

    // বট টোকেন যাচাই
    if (userData.step === 'AWAITING_BOT_TOKEN') {
        const botInfo = await tg(text, 'getMe');
        if (!botInfo.ok) {
            return tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                chat_id: chatId,
                text: `❌ <b>অকার্যকর বট টোকেন!</b>\nটোকেনটি সঠিক নয়। অনুগ্রহ করে @BotFather থেকে সঠিক টোকেন এনে পাঠান:`
            });
        }

        await setDoc(userRef, {
            step: 'AWAITING_ADMIN_ID',
            tempToken: text,
            tempBotUsername: botInfo.result.username
        }, { merge: true });

        return tg(MOTHER_BOT_TOKEN, 'sendMessage', {
            chat_id: chatId,
            text: `✅ টোকেন সঠিক হয়েছে! বটের ইউজারনেম: <b>@${esc(botInfo.result.username)}</b>\n\n`
                + `👑 এবার এই বটের মূল <b>Super Admin-এর Telegram Numeric User ID</b> দিন:\n`
                + `(যেমন আপনার আইডি: <code>${userId}</code>)`,
            parse_mode: 'HTML'
        });
    }

    // এডমিন আইডি গ্রহণ এবং ইনস্ট্যান্ট বট অ্যাক্টিভেশন
    if (userData.step === 'AWAITING_ADMIN_ID') {
        const adminId = parseInt(text, 10);
        if (isNaN(adminId) || adminId <= 0) {
            return tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                chat_id: chatId,
                text: `❌ শুধুমাত্র সঠিক নিউমেরিক আইডি পাঠান (যেমন: <code>123456789</code>):`,
                parse_mode: 'HTML'
            });
        }

        const childToken = userData.tempToken;
        const childUsername = userData.tempBotUsername;

        // হালকা লোডিং স্ট্যাটাস
        await tg(MOTHER_BOT_TOKEN, 'sendMessage', {
            chat_id: chatId,
            text: `⏳ <b>আপনার বট তৈরি হচ্ছে, কয়েক সেকেন্ড অপেক্ষা করুন...</b>`,
            parse_mode: 'HTML'
        });

        // ডাইনামিক ওয়েববুক সেট করা
        const webhookUrl = `${SERVER_URL}/webhook/child/${childToken}`;
        const hookRes = await tg(childToken, 'setWebhook', { url: webhookUrl });

        if (!hookRes.ok) {
            return tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                chat_id: chatId,
                text: `❌ ওয়েববুক সেট করতে ব্যর্থ হয়েছে: ${hookRes.description}`
            });
        }

        // ফায়ারবেসে তথ্য সংরক্ষণ
        await setDoc(doc(db, 'bots', childToken), {
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

        await setDoc(userRef, { step: 'IDLE', tempToken: null, tempBotUsername: null }, { merge: true });

        // এডমিনকে প্রারম্ভিক নোটিফিকেশন প্রদান
        await tg(childToken, 'sendMessage', {
            chat_id: adminId,
            text: `🎉 <b>অভিনন্দন!</b>\nআপনি এই বটের <b>Main Super Admin</b> হিসেবে সেট হয়েছেন। ইউজারদের সকল মেসেজ এখানে আসবে।`,
            parse_mode: 'HTML'
        });

        return tg(MOTHER_BOT_TOKEN, 'sendMessage', {
            chat_id: chatId,
            text: `🎉 <b>আপনার বট একদম রেডি!</b>\n\n`
                + `🤖 <b>বট:</b> @${esc(childUsername)}\n`
                + `👑 <b>Super Admin:</b> <code>${adminId}</code>\n`
                + `⚡ <b>স্ট্যাটাস:</b> ১০০% একটিভ এবং লাইভ!\n\n`
                + `এখন যে কেউ @${childUsername}-এ মেসেজ দিলে সরাসরি এডমিন ইনবক্সে যাবে এবং এডমিন রিপ্লাই দিতে পারবে।`,
            parse_mode: 'HTML',
            reply_markup: {
                keyboard: [[{ text: '➕ Create Bot' }], [{ text: '📋 My Bots' }]],
                resize_keyboard: true
            }
        });
    }

    if (text === '📋 My Bots') {
        const q = query(collection(db, 'bots'), where('owner_id', '==', userId));
        const snap = await getDocs(q);
        if (snap.empty) {
            return tg(MOTHER_BOT_TOKEN, 'sendMessage', {
                chat_id: chatId,
                text: `📋 আপনার এখনো কোনো বট তৈরি করা নেই। নতুন বট বানাতে ➕ Create Bot চাপুন।`
            });
        }

        let listText = `📋 <b>আপনার তৈরি করা বটসমূহ:</b>\n\n`;
        let count = 1;
        snap.forEach(docSnap => {
            const b = docSnap.data();
            listText += `${count++}. @${esc(b.bot_username)} (Super Admins: ${b.super_admins?.length || 1}, Sub Admins: ${b.sub_admins?.length || 0})\n`;
        });

        return tg(MOTHER_BOT_TOKEN, 'sendMessage', {
            chat_id: chatId,
            text: listText,
            parse_mode: 'HTML'
        });
    }
});

// ==========================================
// ৪. চাইল্ড বট ইঞ্জিন (AUDIT LOG & CHAT)
// ==========================================
app.post('/webhook/child/:token', async (req, res) => {
    res.sendStatus(200);
    const token = req.params.token;
    const update = req.body;
    if (!update.message) return;

    // ফায়ারবেস থেকে বটের ডেটা লোড
    const botRef = doc(db, 'bots', token);
    const botSnap = await getDoc(botRef);
    if (!botSnap.exists()) return;
    const botData = botSnap.data();

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

    // ---------------------------------------------------------------------
    // A. এডমিন যুক্তকরণ ও সাথে সাথে নোটিফিকেশন প্রদান (NOTIFICATION FIX)
    // ---------------------------------------------------------------------
    if (isSuper && (text.startsWith('/addsuper') || text.startsWith('/addsub'))) {
        const parts = text.split(' ');
        const targetId = parseInt(parts[1], 10);
        const isSuperCmd = text.startsWith('/addsuper');

        if (!targetId || isNaN(targetId)) {
            return tg(token, 'sendMessage', {
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

        await updateDoc(botRef, {
            super_admins: Array.from(new Set(superAdmins)),
            sub_admins: Array.from(new Set(subAdmins))
        });

        // যাকে এডমিন করা হলো তাকে সাথে সাথে মেসেজ পাঠানো (১০০% সল্যুশন)
        const notifyRes = await tg(token, 'sendMessage', {
            chat_id: targetId,
            text: `🎉 <b>অভিনন্দন!</b>\n`
                + `আপনাকে @${esc(botData.bot_username)} বটের <b>${roleName}</b> হিসেবে যুক্ত করা হয়েছে।\n\n`
                + `📩 এখন থেকে ইউজারদের সকল মেসেজ আপনি পাবেন এবং মেসেজে সরাসরি Reply দিয়ে উত্তর দিতে পারবেন।`,
            parse_mode: 'HTML'
        });

        let note = '\n\n📩 নতুন এডমিনকে মেসেজ পাঠিয়ে দেওয়া হয়েছে।';
        if (!notifyRes.ok) {
            note = '\n\n⚠️ <i>সতর্কতা: এই এডমিন যদি পূর্বে বটে কখনো /start না দিয়ে থাকে, তবে টেলিগ্রাম তাকে মেসেজ পাঠাতে দেবে না। তাকে আগে বটে একবার /start দিতে বলুন।</i>';
        }

        return tg(token, 'sendMessage', {
            chat_id: chatId,
            text: `✅ ইউজার <code>${targetId}</code>-কে সফলভাবে <b>${roleName}</b> করা হয়েছে!${note}`,
            parse_mode: 'HTML'
        });
    }

    // ---------------------------------------------------------------------
    // B. অডিট লগ চেক কমান্ড (AUDIT LOG AUDITING)
    // ---------------------------------------------------------------------
    // ১. নির্দিষ্ট ইউজারের হিস্ট্রি: /logs <USER_ID>
    if (isSuper && text.startsWith('/logs')) {
        const parts = text.split(' ');
        const queryUserId = parseInt(parts[1], 10);

        if (!queryUserId || isNaN(queryUserId)) {
            return tg(token, 'sendMessage', {
                chat_id: chatId,
                text: `❌ ব্যবহারের নিয়ম: <code>/logs USER_ID</code>`,
                parse_mode: 'HTML'
            });
        }

        const q = query(
            collection(db, 'audit_logs'),
            where('bot_token', '==', token),
            where('user_id', '==', queryUserId),
            orderBy('timestamp', 'desc'),
            limit(10)
        );
        const logsSnap = await getDocs(q);

        if (logsSnap.empty) {
            return tg(token, 'sendMessage', {
                chat_id: chatId,
                text: `📋 ইউজার <code>${queryUserId}</code>-এর সাথে কোনো হিস্ট্রি পাওয়া যায়নি।`,
                parse_mode: 'HTML'
            });
        }

        let out = `📑 <b>AUDIT LOGS (User: <code>${queryUserId}</code>)</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
        logsSnap.forEach(docSnap => {
            const l = docSnap.data();
            const date = new Date(l.timestamp).toLocaleString('en-US', { timeZone: 'Asia/Dhaka' });
            out += `🕒 <i>${date}</i>\n`
                + `👨‍💻 <b>Admin:</b> ${esc(l.admin_name)} [<code>${l.admin_id}</code>] (${l.admin_role})\n`
                + `💬 <b>Message:</b> ${esc(l.reply_text || '[Media/File]')}\n━━━━━━━━━━━━━━━━━━━━\n`;
        });

        return tg(token, 'sendMessage', { chat_id: chatId, text: out, parse_mode: 'HTML' });
    }

    // ২. নির্দিষ্ট এডমিনের হিস্ট্রি: /adminlogs <ADMIN_ID>
    if (isSuper && text.startsWith('/adminlogs')) {
        const parts = text.split(' ');
        const queryAdminId = parseInt(parts[1], 10);

        if (!queryAdminId || isNaN(queryAdminId)) {
            return tg(token, 'sendMessage', {
                chat_id: chatId,
                text: `❌ ব্যবহারের নিয়ম: <code>/adminlogs ADMIN_ID</code>`,
                parse_mode: 'HTML'
            });
        }

        const q = query(
            collection(db, 'audit_logs'),
            where('bot_token', '==', token),
            where('admin_id', '==', queryAdminId),
            orderBy('timestamp', 'desc'),
            limit(10)
        );
        const logsSnap = await getDocs(q);

        if (logsSnap.empty) {
            return tg(token, 'sendMessage', {
                chat_id: chatId,
                text: `📋 এডমিন <code>${queryAdminId}</code>-এর কোনো কার্যক্রম পাওয়া যায়নি।`,
                parse_mode: 'HTML'
            });
        }

        let out = `📑 <b>ADMIN ACTIVITY LOG (Admin: <code>${queryAdminId}</code>)</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
        logsSnap.forEach(docSnap => {
            const l = docSnap.data();
            const date = new Date(l.timestamp).toLocaleString('en-US', { timeZone: 'Asia/Dhaka' });
            out += `🕒 <i>${date}</i>\n`
                + `👤 <b>To User:</b> <code>${l.user_id}</code>\n`
                + `💬 <b>Reply:</b> ${esc(l.reply_text || '[Media/File]')}\n━━━━━━━━━━━━━━━━━━━━\n`;
        });

        return tg(token, 'sendMessage', { chat_id: chatId, text: out, parse_mode: 'HTML' });
    }

    // ---------------------------------------------------------------------
    // C. এডমিন রিপ্লাই প্রদান ও অডিট ট্র্যাকিং
    // ---------------------------------------------------------------------
    if (isAdmin && msg.reply_to_message) {
        const replyToMsgId = msg.reply_to_message.message_id;

        const q = query(
            collection(db, 'tickets'),
            where('bot_token', '==', token),
            where('admin_message_id', '==', replyToMsgId),
            where('admin_id', '==', senderId),
            limit(1)
        );
        const ticketSnap = await getDocs(q);

        if (!ticketSnap.empty) {
            const ticket = ticketSnap.docs[0].data();
            const targetUserId = ticket.user_id;

            // ইউজারের কাছে উত্তর পাঠানো
            const copyRes = await tg(token, 'copyMessage', {
                chat_id: targetUserId,
                from_chat_id: chatId,
                message_id: msg.message_id
            });

            if (copyRes.ok) {
                const adminRole = isSuper ? 'Super Admin' : 'Sub Admin';

                // ১. অডিট লগে সেভ করা
                await addDoc(collection(db, 'audit_logs'), {
                    bot_token: token,
                    admin_id: senderId,
                    admin_name: senderName,
                    admin_username: senderUsername,
                    admin_role: adminRole,
                    user_id: targetUserId,
                    reply_text: text || '[Media/Document/Voice]',
                    timestamp: Date.now()
                });

                // ২. লাইভ অ্যালার্ট: সাব-এডমিন রিপ্লাই দিলে সুপার এডমিনদের কাছে লাইভ রিপোর্ট পাঠানো
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

                return tg(token, 'sendMessage', {
                    chat_id: chatId,
                    text: `✅ <b>ইউজারের কাছে উত্তর পৌঁছে গেছে!</b> (Log Saved)`,
                    parse_mode: 'HTML',
                    reply_to_message_id: msg.message_id
                });
            } else {
                return tg(token, 'sendMessage', {
                    chat_id: chatId,
                    text: `❌ উত্তর পাঠানো যায়নি। সম্ভবত ইউজার বট ব্লক করেছে।`,
                    parse_mode: 'HTML',
                    reply_to_message_id: msg.message_id
                });
            }
        }
    }

    // ---------------------------------------------------------------------
    // D. সাধারণ ইউজার মেসেজ হ্যান্ডলিং (FORWARD TO ALL ADMINS)
    // ---------------------------------------------------------------------
    if (!isAdmin) {
        if (text === '/start') {
            const welcomeMsg = botData.settings?.welcome || "👋 স্বাগতম! আপনার সমস্যা বিস্তারিত লিখে পাঠান।";
            return tg(token, 'sendMessage', {
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

        // সকল সুপার ও সাব এডমিনদের কাছে পাঠানো
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

            if (resNotice.ok) {
                await addDoc(collection(db, 'tickets'), {
                    bot_token: token,
                    user_id: senderId,
                    admin_id: adminId,
                    admin_message_id: resNotice.result.message_id,
                    created_at: Date.now()
                });
            }
        }

        // ১ ঘণ্টার কুলডাউন লজিক
        const userLogRef = doc(db, 'user_cooldowns', `${token}_${senderId}`);
        const userLogSnap = await getDoc(userLogRef);
        const now = Date.now();
        let shouldSendAck = false;

        if (!userLogSnap.exists()) {
            shouldSendAck = true;
        } else {
            const lastTime = userLogSnap.data().last_ack_time || 0;
            if (now - lastTime >= 3600000) {
                shouldSendAck = true;
            }
        }

        if (shouldSendAck) {
            const ackMsg = botData.settings?.received || "✅ আপনার মেসেজটি সফলভাবে গ্রহণ করা হয়েছে!\n\n📩 খুব শীঘ্রই উত্তর দেওয়া হবে। অনুগ্রহ করে অপেক্ষা করুন।";
            await tg(token, 'sendMessage', {
                chat_id: chatId,
                text: ackMsg,
                parse_mode: 'HTML',
                reply_to_message_id: msg.message_id
            });

            await setDoc(userLogRef, { last_ack_time: now });
        }
    }
});

// ==========================================
// ৫. সার্ভার লিসেন
// ==========================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`LIVE_CHAT_MAKER_BOT Server listening on port ${PORT}`);
});
