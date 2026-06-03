import { db, ref, set, get, update, onValue, push, remove } from "./firebase-config.js";
import { getCurrentUser, showToast, sendNotification } from "./auth-guard.js";

document.addEventListener("DOMContentLoaded", () => {
    const user = getCurrentUser();
    if (!user) return;

    // تهيئة العناصر
    const projectChatsList = document.getElementById("project-chats-list");
    const chatEmptyView = document.getElementById("chat-empty-view");
    const chatActiveView = document.getElementById("chat-active-view");
    const chatProjectTitle = document.getElementById("chat-project-title-label");
    const chatProjectStatus = document.getElementById("chat-project-status-label");
    const mainChatBody = document.getElementById("main-chat-body");
    const mainChatInput = document.getElementById("main-chat-input");
    const mainChatSendBtn = document.getElementById("main-chat-send-btn");

    let allTasks = {};
    let selectedTaskId = null;
    let activeChatListener = null;

    // 1. جلب المشاريع من قاعدة البيانات وسردها
    onValue(ref(db, "tasks"), (snapshot) => {
        const tasks = snapshot.val();
        allTasks = tasks || {};

        if (!tasks) {
            projectChatsList.innerHTML = `<div class="noti-empty" style="font-size:12px;">لا توجد مشاريع مسجلة حالياً</div>`;
            return;
        }

        projectChatsList.innerHTML = "";
        
        // فرز المشاريع: النشطة أولاً ثم المكتملة
        const sortedTaskIds = Object.keys(tasks).sort((a,b) => {
            const taskA = tasks[a];
            const taskB = tasks[b];
            
            const aCompleted = taskA.status === "completed_paid";
            const bCompleted = taskB.status === "completed_paid";
            
            if (aCompleted && !bCompleted) return 1;
            if (!aCompleted && bCompleted) return -1;
            return taskB.timestamp - taskA.timestamp;
        });

        sortedTaskIds.forEach(id => {
            const task = tasks[id];
            const isExecutor = task.executors && task.executors.includes(user.id);
            const isCompleted = task.status === "completed_paid";

            const div = document.createElement("div");
            div.className = `project-chat-item ${selectedTaskId === task.id ? 'active' : ''}`;
            div.setAttribute("data-id", task.id);

            let statusBadge = "backlog";
            let statusText = "💡 فكرة";
            if (task.status === "in_progress") { statusText = "⚙️ قيد العمل"; }
            else if (task.status === "review") { statusText = "🔍 مراجعة"; }
            else if (isCompleted) { statusText = "✅ مكتمل"; }

            div.innerHTML = `
                <div class="proj-chat-name">${task.title} ${isExecutor ? '<span style="color:var(--accent-cyan); font-size:11px;">(منفذ)</span>' : ''}</div>
                <div class="proj-chat-status">${statusText}</div>
            `;

            // حدث اختيار المشروع
            div.addEventListener("click", () => {
                selectProjectChat(task.id);
            });

            projectChatsList.appendChild(div);
        });

        // تحديث حالة المحادثة المفتوحة حالياً في حال تغيرت حالتها
        if (selectedTaskId && tasks[selectedTaskId]) {
            updateChatHeader(tasks[selectedTaskId]);
        }
    });

    // 2. معالجة اختيار محادثة مشروع
    const selectProjectChat = (taskId) => {
        // إزالة الكلاس الفعال من العنصر السابق وتفعيله للجديد
        projectChatsList.querySelectorAll(".project-chat-item").forEach(item => {
            item.classList.remove("active");
            if (item.getAttribute("data-id") === taskId) {
                item.classList.add("active");
            }
        });

        selectedTaskId = taskId;
        const task = allTasks[taskId];
        if (!task) return;

        // إخفاء شاشة البدء وإظهار الشات
        chatEmptyView.style.display = "none";
        chatActiveView.style.display = "flex";

        updateChatHeader(task);

        // ربط مستمع الرسائل الحية للمشروع الجديد
        if (activeChatListener) {
            activeChatListener(); // تدمير المستمع السابق
        }

        initChatWindowListener(taskId);
    };

    // تحديث هيدر الدردشة
    const updateChatHeader = (task) => {
        chatProjectTitle.textContent = task.title;
        
        let statusText = "💡 مسودة";
        if (task.status === "in_progress") statusText = "⚙️ قيد التنفيذ";
        else if (task.status === "review") statusText = "🔍 قيد المراجعة";
        else if (task.status === "completed_paid") statusText = "✅ مكتمل ومستلم مالياً";

        chatProjectStatus.textContent = statusText;
        chatProjectStatus.className = `badge ${task.status === 'completed_paid' ? 'badge-deposit' : task.status === 'review' ? 'badge-expense' : 'badge-solidarity'}`;
    };

    // 3. ربط مستمع الرسائل الحية (Chat Window Listener)
    const initChatWindowListener = (taskId) => {
        const chatRef = ref(db, `discussions/${taskId}`);
        
        activeChatListener = onValue(chatRef, (snapshot) => {
            const messages = snapshot.val();
            
            if (!messages) {
                mainChatBody.innerHTML = `
                    <div class="chat-empty-state">
                        <div class="chat-empty-icon">💬</div>
                        <h4 style="font-weight:700;">لا توجد رسائل بعد</h4>
                        <p style="font-size:12px; max-width:260px;">ابدأ النقاش والتنسيق في هذه الغرفة المخصصة للمشروع.</p>
                    </div>
                `;
                return;
            }

            const msgList = Object.keys(messages).map(key => ({
                id: key,
                ...messages[key]
            })).sort((a,b) => a.timestamp - b.timestamp);

            mainChatBody.innerHTML = "";
            msgList.forEach(msg => {
                const isMyMsg = msg.senderId === user.id;
                
                const bubbleRow = document.createElement("div");
                bubbleRow.className = `bubble-row ${isMyMsg ? 'my-bubble' : 'other-bubble'}`;
                
                const canDelete = isMyMsg || user.role === "admin";
                const deleteHTML = canDelete ? `<button class="delete-msg-btn" data-id="${msg.id}" style="font-size:9px; padding:0 5px;">حذف 🗑️</button>` : "";

                bubbleRow.innerHTML = `
                    <div class="chat-bubble">
                        ${!isMyMsg ? `<div class="chat-bubble-sender">${msg.senderName}</div>` : ''}
                        <div class="chat-bubble-text">${msg.message}</div>
                        <div class="chat-bubble-meta">
                            <span>${new Date(msg.timestamp).toLocaleTimeString("ar-EG", { hour: '2-digit', minute: '2-digit' })}</span>
                            ${deleteHTML}
                        </div>
                    </div>
                `;

                // حدث حذف الرسالة
                if (canDelete) {
                    bubbleRow.querySelector(".delete-msg-btn").addEventListener("click", async () => {
                        await remove(ref(db, `discussions/${taskId}/${msg.id}`));
                        showToast("تم حذف الرسالة بنجاح.", "info");
                    });
                }

                mainChatBody.appendChild(bubbleRow);
            });

            // سكرول تلقائي لأسفل الشات
            mainChatBody.scrollTop = mainChatBody.scrollHeight;
        });
    };

    // 4. إرسال رسالة شات
    const sendChatMessage = async () => {
        const text = mainChatInput.value.trim();
        if (!text || !selectedTaskId) return;

        try {
            const chatRef = ref(db, `discussions/${selectedTaskId}`);
            const newMsgRef = push(chatRef);
            await set(newMsgRef, {
                id: newMsgRef.key,
                senderId: user.id,
                senderName: user.name,
                message: text,
                timestamp: Date.now()
            });

            mainChatInput.value = "";

            // إرسال إشعار للمنفذين
            const currentTask = allTasks[selectedTaskId];
            if (currentTask && currentTask.executors) {
                currentTask.executors.forEach(uid => {
                    if (uid !== user.id) {
                        sendNotification(uid, `رسالة جديدة من [${user.name}] في مشروع [${currentTask.title}].`);
                    }
                });
            }

        } catch (err) {
            console.error(err);
            showToast("فشل إرسال الرسالة!", "error");
        }
    };

    if (mainChatSendBtn) mainChatSendBtn.addEventListener("click", sendChatMessage);
    if (mainChatInput) {
        mainChatInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                sendChatMessage();
            }
        });
    }
});
