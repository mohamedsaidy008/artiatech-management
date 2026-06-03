import { db, ref, set, get, update, onValue, push, remove } from "./firebase-config.js";
import { getCurrentUser, showToast, logActivity, sendNotification } from "./auth-guard.js";

document.addEventListener("DOMContentLoaded", () => {
    const user = getCurrentUser();
    if (!user) return;

    // تهيئة العناصر
    const openCreateModalBtn = document.getElementById("open-create-task-modal-btn");
    const createTaskModal = document.getElementById("create-task-modal");
    const closeCreateBtn = document.getElementById("close-create-task-btn");
    const cancelCreateBtn = document.getElementById("cancel-create-task-btn");
    const createTaskForm = document.getElementById("create-task-form");

    const taskTitleInput = document.getElementById("task-title-input");
    const taskDescInput = document.getElementById("task-desc-input");
    const taskDeadlineInput = document.getElementById("task-deadline-input");
    const assigneesContainer = document.getElementById("assignees-checkboxes-container");

    const taskDetailsModal = document.getElementById("task-details-modal");
    const closeDetailsBtn = document.getElementById("close-details-btn");
    const closeDetailsFooterBtn = document.getElementById("close-details-footer-btn");

    const detailsTitle = document.getElementById("details-task-title");
    const detailsDesc = document.getElementById("details-task-desc");
    const detailsDeadline = document.getElementById("details-task-deadline");
    const detailsExecutors = document.getElementById("details-task-executors");

    const subtasksContainer = document.getElementById("subtasks-container");
    const subtasksProgress = document.getElementById("subtasks-progress");
    const addSubtaskBox = document.getElementById("add-subtask-action-box");
    const newSubtaskTitleInput = document.getElementById("new-subtask-title");
    const saveSubtaskBtn = document.getElementById("save-subtask-btn");

    const taskChatBox = document.getElementById("task-chat-box");
    const chatInput = document.getElementById("chat-input");
    const sendChatBtn = document.getElementById("send-chat-btn");

    const payoutModal = document.getElementById("payout-modal");
    const closePayoutBtn = document.getElementById("close-payout-modal-btn");
    const cancelPayoutBtn = document.getElementById("cancel-payout-btn");
    const payoutForm = document.getElementById("payout-form");
    const payoutRevenueInput = document.getElementById("payout-revenue-input");

    const deleteTaskBtn = document.getElementById("delete-task-btn");

    // الكانتينرز للأعمدة
    const containers = {
        backlog: document.getElementById("container-backlog"),
        in_progress: document.getElementById("container-in_progress"),
        review: document.getElementById("container-review"),
        completed_paid: document.getElementById("container-completed_paid")
    };

    const badges = {
        backlog: document.getElementById("badge-backlog"),
        in_progress: document.getElementById("badge-in_progress"),
        review: document.getElementById("badge-review"),
        completed_paid: document.getElementById("badge-completed_paid")
    };

    let allUsers = {};
    let activeTaskId = null; // لمتابعة المهمة المفتوحة حالياً للتفاصيل
    let pendingPayoutTaskId = null; // لمتابعة المهمة التي يتم إغلاقها مالياً حالياً
    let activeChatListener = null;
    let activeSubtaskListener = null;

    // 1. إظهار زر الإضافة للأدمن
    if (user.role === "admin") {
        openCreateModalBtn.style.display = "block";
    }

    // 2. تحميل قائمة الأعضاء لنموذج الإضافة
    const loadUsersForAssignment = async () => {
        try {
            const snap = await get(ref(db, "users"));
            allUsers = snap.val() || {};

            if (assigneesContainer) {
                assigneesContainer.innerHTML = "";
                Object.keys(allUsers).forEach(id => {
                    const u = allUsers[id];
                    const div = document.createElement("div");
                    div.style.display = "flex";
                    div.style.alignItems = "center";
                    div.style.gap = "8px";
                    div.style.marginBottom = "6px";
                    div.innerHTML = `
                        <input type="checkbox" class="assign-checkbox" id="assign-${u.id}" value="${u.id}">
                        <label for="assign-${u.id}" style="font-size:13px; font-weight:600; cursor:pointer;">${u.name} (${u.role === 'admin' ? 'مدير' : 'عضو'})</label>
                    `;
                    assigneesContainer.appendChild(div);
                });
            }
        } catch (err) {
            console.error(err);
        }
    };
    loadUsersForAssignment();

    // فتح وإغلاق مودال الإضافة
    openCreateModalBtn.addEventListener("click", () => {
        createTaskModal.classList.add("active");
    });

    const closeCreateModal = () => {
        createTaskModal.classList.remove("active");
        createTaskForm.reset();
    };
    closeCreateBtn.addEventListener("click", closeCreateModal);
    cancelCreateBtn.addEventListener("click", closeCreateModal);

    // 3. إضافة وحفظ المهمة الجديدة (للأدمن)
    createTaskForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const title = taskTitleInput.value.trim();
        const desc = taskDescInput.value.trim();
        const deadline = taskDeadlineInput.value;

        const checkedAssignees = Array.from(assigneesContainer.querySelectorAll(".assign-checkbox:checked")).map(cb => cb.value);

        if (!title || !desc || !deadline) {
            showToast("يرجى ملء جميع الحقول المطلوبة!", "error");
            return;
        }

        if (checkedAssignees.length === 0) {
            showToast("يرجى تعيين منفذ واحد على الأقل للمشروع!", "error");
            return;
        }

        try {
            const taskId = "task_" + Date.now();
            const newTask = {
                id: taskId,
                title: title,
                description: desc,
                dueDate: deadline,
                executors: checkedAssignees,
                status: "backlog",
                timestamp: Date.now()
            };

            await set(ref(db, `tasks/${taskId}`), newTask);

            showToast(`تم إدراج فكرة [${title}] بنجاح!`, "success");
            logActivity(user.name, `أضاف مشروعاً جديداً للمخططات: [${title}]`);

            // إشعار المنفذين
            checkedAssignees.forEach(uid => {
                if (uid !== user.id) {
                    sendNotification(uid, `تم تعيينك كمنفذ للمشروع الجديد [${title}].`);
                }
            });

            closeCreateModal();
        } catch (err) {
            console.error(err);
            showToast("حدث خطأ أثناء حفظ المهمة!", "error");
        }
    });

    // 4. تحميل وعرض لوحة الكانبان في الوقت الفعلي
    onValue(ref(db, "tasks"), (snapshot) => {
        const tasks = snapshot.val();

        // تصفير جميع الكانتينرز أولاً
        Object.keys(containers).forEach(status => {
            containers[status].innerHTML = "";
            badges[status].textContent = 0;
        });

        if (!tasks) return;

        Object.keys(tasks).forEach(id => {
            const task = tasks[id];
            const status = task.status || "backlog";

            if (containers[status]) {
                const card = document.createElement("div");
                card.className = "task-card";
                card.id = task.id;

                // تفعيل خاصية السحب للأدمن فقط
                if (user.role === "admin") {
                    card.setAttribute("draggable", "true");
                    card.addEventListener("dragstart", (e) => {
                        e.dataTransfer.setData("text/plain", task.id);
                    });
                }

                // التحقق من تاريخ التسليم وقرب انتهاء المهلة (أقل من 48 ساعة ولم يتم تسليمها بعد)
                const now = Date.now();
                const deadlineTime = new Date(task.dueDate).getTime();
                const timeDiff = deadlineTime - now;
                const isUrgent = timeDiff <= 172800000 && status !== "completed_paid"; // 48 ساعة بالملي ثانية
                if (isUrgent) {
                    card.classList.add("deadline-urgent");
                }

                // رسم المنفذين الصغار
                let avatarsHTML = "";
                if (task.executors) {
                    task.executors.forEach(uid => {
                        if (allUsers[uid]) {
                            avatarsHTML += `<div class="member-avatar-mini" title="${allUsers[uid].name}">${allUsers[uid].name.charAt(0)}</div>`;
                        }
                    });
                }

                card.innerHTML = `
                    <h3 class="task-title">${task.title}</h3>
                    <p class="task-desc">${task.description}</p>
                    <div class="task-meta">
                        <span>📅 ${new Date(task.dueDate).toLocaleDateString("ar-EG")}</span>
                        <div class="task-members">
                            ${avatarsHTML}
                        </div>
                    </div>
                `;

                // النقر على الكرت يفتح صندوق التفاصيل
                card.addEventListener("click", () => openTaskDetails(task.id));

                containers[status].appendChild(card);
                badges[status].textContent = parseInt(badges[status].textContent) + 1;
            }
        });
    });

    // 5. إعداد مستمعات السحب والإفلات للأعمدة (للأدمن فقط)
    if (user.role === "admin") {
        Object.keys(containers).forEach(status => {
            const col = containers[status].parentElement;

            col.addEventListener("dragover", (e) => {
                e.preventDefault(); // السماح بالإفلات
            });

            col.addEventListener("drop", async (e) => {
                e.preventDefault();
                const taskId = e.dataTransfer.getData("text/plain");
                if (!taskId) return;

                // التحقق من أننا لا ننقلها لنفس العمود
                const taskRef = ref(db, `tasks/${taskId}`);
                const taskSnap = await get(taskRef);
                const taskData = taskSnap.val();
                if (!taskData || taskData.status === status) return;

                // إذا كان الهدف هو مكتمل ومستلم مالياً، نفتح مودال الدفعة المالية
                if (status === "completed_paid") {
                    pendingPayoutTaskId = taskId;
                    payoutRevenueInput.value = "";
                    payoutModal.classList.add("active");
                } else {
                    // الانتقال العادي بين باقي الأعمدة
                    await update(taskRef, { status: status });
                    logActivity(user.name, `نقل المشروع [${taskData.title}] إلى عمود [${getColumnNameArabic(status)}]`);

                    // إشعار المنفذين بالانتقال
                    if (taskData.executors) {
                        taskData.executors.forEach(uid => {
                            if (uid !== user.id) {
                                sendNotification(uid, `تم نقل مشروعك [${taskData.title}] إلى [${getColumnNameArabic(status)}].`);
                            }
                        });
                    }
                }
            });
        });
    }

    // إغلاق مودال الدفعة المالية
    const closePayoutModal = () => {
        payoutModal.classList.remove("active");
        pendingPayoutTaskId = null;
    };
    closePayoutBtn.addEventListener("click", closePayoutModal);
    cancelPayoutBtn.addEventListener("click", closePayoutModal);

    // 6. تأكيد الدفعة المالية وتقسيم الأرباح (أدمن فقط)
    payoutForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const revenue = parseFloat(payoutRevenueInput.value);

        if (isNaN(revenue) || revenue <= 0 || !pendingPayoutTaskId) {
            showToast("يرجى إدخال ميزانية صحيحة!", "error");
            return;
        }

        try {
            const taskRef = ref(db, `tasks/${pendingPayoutTaskId}`);
            const taskSnap = await get(taskRef);
            const taskData = taskSnap.val();

            if (!taskData) {
                showToast("حدث خطأ: المهمة غير موجودة!", "error");
                closePayoutModal();
                return;
            }

            const executors = taskData.executors || [];
            if (executors.length === 0) {
                showToast("خطأ: لا يمكن إتمام الإغلاق المالي لعدم وجود منفذين معينين على المشروع!", "error");
                return;
            }

            // الحسابات المالية للنسب (50 / 30 / 20)
            const share50 = revenue * 0.50;
            const share30 = revenue * 0.30;
            const share20 = revenue * 0.20;

            const executorShare = share50 / executors.length;

            // أ) إضافة الأرصدة للمنفذين وتوثيق المعاملة
            for (const uid of executors) {
                const userRef = ref(db, `users/${uid}`);
                const userSnap = await get(userRef);
                const userData = userSnap.val() || {};
                const currentBal = userData.balance || 0;

                await update(userRef, { balance: currentBal + executorShare });

                // سجل معاملة مالية لكل منفذ
                const transRef = push(ref(db, "transactions"));
                await set(transRef, {
                    timestamp: Date.now(),
                    actor: userData.name,
                    type: "deposit",
                    amount: executorShare,
                    desc: `استلام 50% من إيراد مشروع [${taskData.title}]`
                });

                sendNotification(uid, `🎉 تهانينا! تم تسليم مشروعك [${taskData.title}] وإيداع حصتك البالغة [${executorShare.toFixed(2)} د.إ] في حسابك.`);
            }

            // ب) تغذية الصناديق المالية (التشغيلي والتكافلي)
            const fundsRef = ref(db, "funds");
            const fundsSnap = await get(fundsRef);
            const funds = fundsSnap.val() || { operating_fund: 0, solidarity_pool: 0 };

            const newOp = (funds.operating_fund || 0) + share30;
            const newSolidarity = (funds.solidarity_pool || 0) + share20;

            await update(fundsRef, {
                operating_fund: newOp,
                solidarity_pool: newSolidarity
            });

            // تسجيل معاملة الصندوق التشغيلي
            const transRefOp = push(ref(db, "transactions"));
            await set(transRefOp, {
                timestamp: Date.now(),
                actor: "الصندوق التشغيلي",
                type: "deposit",
                amount: share30,
                desc: `إيداع 30% إيراد تشغيلي - مشروع [${taskData.title}]`
            });

            // تسجيل معاملة التكافل
            const transRefSol = push(ref(db, "transactions"));
            await set(transRefSol, {
                timestamp: Date.now(),
                actor: "محفظة التكافل",
                type: "deposit",
                amount: share20,
                desc: `إيداع 20% تكافل - مشروع [${taskData.title}]`
            });

            // ج) تحديث حالة المهمة
            const today = new Date();
            const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

            await update(taskRef, {
                status: "completed_paid",
                revenue: revenue,
                solidarity_share: share20,
                solidarity_distributed: false,
                completed_month: currentMonthStr
            });

            showToast("تم الإغلاق المالي وتوزيع الأرباح بنجاح!", "success");
            logActivity(user.name, `أغلق المشروع [${taskData.title}] مالياً بقيمة إجمالية [${revenue} د.إ] ووزّع العوائد.`);

            closePayoutModal();
        } catch (err) {
            console.error(err);
            showToast("حدث خطأ غير متوقع أثناء توزيع المبالغ!", "error");
        }
    });

    // 7. فتح تفاصيل المهمة (Subtasks + Chat)
    const openTaskDetails = async (taskId) => {
        activeTaskId = taskId;
        taskDetailsModal.classList.add("active");

        try {
            const taskSnap = await get(ref(db, `tasks/${taskId}`));
            const task = taskSnap.val();
            if (!task) return;

            detailsTitle.textContent = task.title;
            detailsDesc.textContent = task.description;
            detailsDeadline.textContent = new Date(task.dueDate).toLocaleDateString("ar-EG");

            // جلب أسماء المنفذين
            let executorNames = [];
            const executors = task.executors || [];
            executors.forEach(uid => {
                if (allUsers[uid]) {
                    executorNames.push(allUsers[uid].name);
                }
            });
            detailsExecutors.textContent = executorNames.join(" ، ");

            // إظهار مربع إضافة المهمة الفرعية للمنفذين المعنيين فقط
            const isExecutor = executors.includes(user.id);
            if (isExecutor && task.status !== "completed_paid") {
                addSubtaskBox.style.display = "flex";
            } else {
                addSubtaskBox.style.display = "none";
            }

            // إظهار زر الحذف للأدمن فقط داخل التفاصيل
            if (user.role === "admin") {
                deleteTaskBtn.style.display = "block";
            } else {
                deleteTaskBtn.style.display = "none";
            }

            // مستمع للمهام الفرعية
            initSubtaskListener(taskId, isExecutor, task.status);

            // مستمع للدردشة الخاصة بالمهمة
            initChatListener(taskId);

        } catch (err) {
            console.error(err);
        }
    };

    // إغلاق تفاصيل المهمة
    const closeDetailsModal = () => {
        taskDetailsModal.classList.remove("active");
        activeTaskId = null;

        // إزالة المستمعات لمنع التداخل عند فتح كرت آخر
        if (activeChatListener) {
            activeChatListener();
            activeChatListener = null;
        }
        if (activeSubtaskListener) {
            activeSubtaskListener();
            activeSubtaskListener = null;
        }
    };
    closeDetailsBtn.addEventListener("click", closeDetailsModal);
    closeDetailsFooterBtn.addEventListener("click", closeDetailsModal);

    // 8. مستمع وإدارة المهام الفرعية (Subtasks Engine)
    const initSubtaskListener = (taskId, isExecutor, taskStatus) => {
        const subRef = ref(db, `tasks/${taskId}/subtasks`);

        activeSubtaskListener = onValue(subRef, async (snapshot) => {
            const subtasks = snapshot.val();

            if (!subtasks) {
                subtasksContainer.innerHTML = `<div style="font-size:12px; color:var(--text-secondary); text-align:center; padding:10px;">لا توجد مهام فرعية بعد.</div>`;
                subtasksProgress.textContent = "0%";
                return;
            }

            const subList = Object.keys(subtasks).map(key => ({
                id: key,
                ...subtasks[key]
            }));

            const completedCount = subList.filter(s => s.completed).length;
            const totalCount = subList.length;
            const progressPercent = Math.round((completedCount / totalCount) * 100);
            subtasksProgress.textContent = `${progressPercent}%`;

            subtasksContainer.innerHTML = "";
            subList.forEach(sub => {
                const div = document.createElement("div");
                div.className = "subtask-item";

                // تشيك بوكس معطل إذا لم يكن منفذاً أو المهمة مكتملة مالياً
                const disabledAttr = (!isExecutor || taskStatus === "completed_paid") ? "disabled" : "";

                div.innerHTML = `
                    <input type="checkbox" class="subtask-checkbox" id="sub-${sub.id}" ${sub.completed ? 'checked' : ''} ${disabledAttr}>
                    <span class="subtask-text ${sub.completed ? 'completed' : ''}" id="sub-text-${sub.id}">${sub.title}</span>
                `;

                // حدث تعديل حالة التشيك بوكس
                if (isExecutor && taskStatus !== "completed_paid") {
                    const checkbox = div.querySelector(".subtask-checkbox");
                    checkbox.addEventListener("change", async () => {
                        const isChecked = checkbox.checked;
                        await update(ref(db, `tasks/${taskId}/subtasks/${sub.id}`), { completed: isChecked });

                        // تحديث النص محلياً
                        const text = document.getElementById(`sub-text-${sub.id}`);
                        if (isChecked) text.classList.add("completed");
                        else text.classList.remove("completed");

                        // فحص الانتقال التلقائي لعمود المراجعة (Review)
                        checkAutoMoveToReview(taskId);
                    });
                }

                subtasksContainer.appendChild(div);
            });
        });
    };

    // إضافة مهمة فرعية جديدة
    if (saveSubtaskBtn) {
        saveSubtaskBtn.addEventListener("click", async () => {
            const title = newSubtaskTitleInput.value.trim();
            if (!title || !activeTaskId) return;

            try {
                const subRef = ref(db, `tasks/${activeTaskId}/subtasks`);
                const newSubRef = push(subRef);
                await set(newSubRef, {
                    id: newSubRef.key,
                    title: title,
                    completed: false
                });

                newSubtaskTitleInput.value = "";
                showToast("تمت إضافة المهمة الفرعية.", "success");

                // تنبيه لإعادة فحص الحالة التلقائية (منعاً لبقاء المهمة في المراجعة إذا أضيفت مهام فرعية جديدة)
                const taskRef = ref(db, `tasks/${activeTaskId}`);
                const taskSnap = await get(taskRef);
                if (taskSnap.val().status === "review") {
                    await update(taskRef, { status: "in_progress" });
                }

            } catch (err) {
                console.error(err);
            }
        });
    }

    // الانتقال التلقائي للمراجعة (Review) عند اكتمال المهام الفرعية
    const checkAutoMoveToReview = async (taskId) => {
        try {
            const taskRef = ref(db, `tasks/${taskId}`);
            const taskSnap = await get(taskRef);
            const task = taskSnap.val();
            if (!task || task.status !== "in_progress") return;

            const subtasksSnap = await get(ref(db, `tasks/${taskId}/subtasks`));
            const subtasks = subtasksSnap.val();
            if (!subtasks) return;

            const subList = Object.values(subtasks);
            const allCompleted = subList.every(s => s.completed);

            if (allCompleted && subList.length > 0) {
                await update(taskRef, { status: "review" });
                showToast(`🎉 رائـع! اكتملت كافة المهام الفرعية وتم نقل [${task.title}] تلقائياً إلى عمود المراجعة لإشعار الإدارة.`, "success");
                logActivity("النظام التلقائي", `نقل المشروع [${task.title}] إلى عمود [المراجعة] لاكتمال المهام الفرعية`);

                // إشعار الإدارة (الأدمنز)
                const usersSnap = await get(ref(db, "users"));
                const users = usersSnap.val() || {};
                Object.values(users).forEach(u => {
                    if (u.role === "admin") {
                        sendNotification(u.id, `المشروع [${task.title}] جاهز للمراجعة والاستلام المالي.`);
                    }
                });

                closeDetailsModal();
            }
        } catch (err) {
            console.error(err);
        }
    };

    // 9. مستمع النقاش المخصص للمشروع (Task-Specific Chats)
    const initChatListener = (taskId) => {
        const chatRef = ref(db, `discussions/${taskId}`);

        activeChatListener = onValue(chatRef, (snapshot) => {
            const messages = snapshot.val();

            if (!messages) {
                taskChatBox.innerHTML = `<div class="noti-empty">لا توجد رسائل بعد، ابدأ النقاش!</div>`;
                return;
            }

            const msgList = Object.keys(messages).map(key => ({
                id: key,
                ...messages[key]
            })).sort((a, b) => a.timestamp - b.timestamp);

            taskChatBox.innerHTML = "";
            msgList.forEach(msg => {
                const isMyMsg = msg.senderId === user.id;
                const bubble = document.createElement("div");
                bubble.className = `msg-bubble ${isMyMsg ? 'my-msg' : ''}`;

                // زر الحذف لكاتب الرسالة أو للأدمن
                const canDelete = isMyMsg || user.role === "admin";
                const deleteHTML = canDelete ? `<button class="delete-msg-btn" data-id="${msg.id}">حذف 🗑️</button>` : "";

                bubble.innerHTML = `
                    <div class="msg-sender">${msg.senderName}</div>
                    <div class="msg-text">${msg.message}</div>
                    <div class="msg-meta-row">
                        <span>${new Date(msg.timestamp).toLocaleTimeString("ar-EG", { hour: '2-digit', minute: '2-digit' })}</span>
                        ${deleteHTML}
                    </div>
                `;

                // حدث حذف الرسالة
                if (canDelete) {
                    bubble.querySelector(".delete-msg-btn").addEventListener("click", async () => {
                        await remove(ref(db, `discussions/${taskId}/${msg.id}`));
                        showToast("تم حذف الرسالة.", "info");
                    });
                }

                taskChatBox.appendChild(bubble);
            });

            // سكرول تلقائي لأسفل صندوق الشات
            taskChatBox.scrollTop = taskChatBox.scrollHeight;
        });
    };

    // إرسال رسالة في شات المهمة
    const sendChatMessage = async () => {
        const msgText = chatInput.value.trim();
        if (!msgText || !activeTaskId) return;

        try {
            const chatRef = ref(db, `discussions/${activeTaskId}`);
            const newMsgRef = push(chatRef);
            await set(newMsgRef, {
                id: newMsgRef.key,
                senderId: user.id,
                senderName: user.name,
                message: msgText,
                timestamp: Date.now()
            });

            chatInput.value = "";

            // إرسال إشعارات لباقي المنفذين المعنيين بالمهمة
            const taskSnap = await get(ref(db, `tasks/${activeTaskId}`));
            const taskData = taskSnap.val() || {};
            const executors = taskData.executors || [];
            executors.forEach(uid => {
                if (uid !== user.id) {
                    sendNotification(uid, `رسالة جديدة من [${user.name}] في مشروع [${taskData.title}]`);
                }
            });

        } catch (err) {
            console.error(err);
        }
    };

    if (sendChatBtn) sendChatBtn.addEventListener("click", sendChatMessage);
    if (chatInput) {
        chatInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                sendChatMessage();
            }
        });
    }

    // دوال مساعدة لترجمة حالات كانبان
    function getColumnNameArabic(status) {
        const names = {
            backlog: "الأفكار والمسودات",
            in_progress: "قيد التنفيذ والعمل",
            review: "المراجعة والتدقيق",
            completed_paid: "مكتمل ومستلم مالياً"
        };
        return names[status] || status;
    }

    // 10. حذف المهمة نهائياً (للأدمن فقط)
    if (deleteTaskBtn) {
        deleteTaskBtn.addEventListener("click", async () => {
            if (!activeTaskId) return;

            const confirmDelete = confirm("⚠️ هل أنت متأكد من حذف هذا المشروع نهائياً؟ سيتم مسح كافة البيانات والمهام الفرعية والنقاشات المرتبطة به ولا يمكن التراجع.");
            if (!confirmDelete) return;

            try {
                const taskRef = ref(db, `tasks/${activeTaskId}`);
                const taskSnap = await get(taskRef);
                const taskData = taskSnap.val();

                // 1. حذف المهمة نفسها
                await remove(taskRef);

                // 2. حذف غرف النقاش المرتبطة بها
                await remove(ref(db, `discussions/${activeTaskId}`));

                showToast(`تم حذف المشروع [${taskData ? taskData.title : ''}] وكل محتوياته بنجاح.`, "info");
                logActivity(user.name, `حذف مشروعاً من المخططات: [${taskData ? taskData.title : activeTaskId}]`);

                closeDetailsModal();
            } catch (err) {
                console.error(err);
                showToast("فشل حذف المشروع!", "error");
            }
        });
    }
});
