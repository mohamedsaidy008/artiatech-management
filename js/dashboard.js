import { db, ref, set, get, update, onValue, push } from "./firebase-config.js";
import { getCurrentUser, setCurrentUser, showToast, logActivity } from "./auth-guard.js";

document.addEventListener("DOMContentLoaded", () => {
    const user = getCurrentUser();
    if (!user) return;

    // تهيئة العناصر
    const myBalanceStat = document.getElementById("stat-my-balance");
    const opexFundStat = document.getElementById("stat-opex-fund");
    const solidarityPoolStat = document.getElementById("stat-solidarity-pool");
    const activeProjectsStat = document.getElementById("stat-active-projects");
    const adminSection = document.getElementById("admin-user-card");
    const activityLogsContainer = document.getElementById("activity-logs-container");

    // 1. التحقق من رتبة المدير لإظهار أدوات الإدارة
    if (user.role === "admin") {
        adminSection.style.display = "block";
        initAdminFeatures();
    }

    // 2. مستمع الإحصائيات الفورية (رصيد الصناديق)
    const fundsRef = ref(db, "funds");
    onValue(fundsRef, (snapshot) => {
        const funds = snapshot.val();
        if (funds) {
            opexFundStat.textContent = `${(funds.operating_fund || 0).toFixed(2)} د.إ`;
            solidarityPoolStat.textContent = `${(funds.solidarity_pool || 0).toFixed(2)} د.إ`;
        }
    });

    // 3. مستمع لرصيد العضو الحالي للتحديث المباشر
    const myUserRef = ref(db, `users/${user.id}`);
    onValue(myUserRef, (snapshot) => {
        const userData = snapshot.val();
        if (userData) {
            myBalanceStat.textContent = `${(userData.balance || 0).toFixed(2)} د.إ`;
            // تحديث رصيد الجلسة المحلية في حال حصل على أموال
            user.balance = userData.balance || 0;
            setCurrentUser(user);
        }
    });

    // 4. مستمع لعدد المشاريع النشطة (الموجودة في المخططات وقيد العمل)
    const tasksRef = ref(db, "tasks");
    onValue(tasksRef, (snapshot) => {
        const tasks = snapshot.val();
        if (tasks) {
            const activeCount = Object.values(tasks).filter(t => t.status === "in_progress" || t.status === "backlog").length;
            activeProjectsStat.textContent = activeCount;
        } else {
            activeProjectsStat.textContent = 0;
        }
    });

    // 5. مستمع سجل العمليات العام (Real-time Activity Logs)
    const logsRef = ref(db, "activity_logs");
    onValue(logsRef, (snapshot) => {
        const logs = snapshot.val();
        if (!logs) {
            activityLogsContainer.innerHTML = `<div class="noti-empty">لا توجد عمليات مسجلة حالياً</div>`;
            return;
        }

        const sortedLogs = Object.keys(logs).map(key => ({
            id: key,
            ...logs[key]
        })).sort((a,b) => b.timestamp - a.timestamp).slice(0, 20); // عرض آخر 20 عملية فقط

        activityLogsContainer.innerHTML = "";
        sortedLogs.forEach(log => {
            const logItem = document.createElement("div");
            logItem.className = "log-item";
            logItem.innerHTML = `
                <div>
                    <span class="log-actor">${log.actor}</span>
                    <span class="log-action">${log.action}</span>
                </div>
                <div class="log-time">${new Date(log.timestamp).toLocaleTimeString("ar-EG")} - ${new Date(log.timestamp).toLocaleDateString("ar-EG")}</div>
            `;
            activityLogsContainer.appendChild(logItem);
        });
    });
});

// تهيئة ميزات المدير وسرد الأعضاء
function initAdminFeatures() {
    const createUserForm = document.getElementById("create-user-form");
    const nameInput = document.getElementById("new-user-name");
    const emailInput = document.getElementById("new-user-email");
    const passwordInput = document.getElementById("new-user-password");
    const roleInput = document.getElementById("new-user-role");
    const usersTableBody = document.getElementById("registered-users-body");

    // 1. مستمع لسرد الأعضاء المسجلين في جدول
    const usersRef = ref(db, "users");
    onValue(usersRef, (snapshot) => {
        const users = snapshot.val();
        if (!users) {
            usersTableBody.innerHTML = `<tr><td colspan="3" style="text-align:center;">لا يوجد مستخدمون</td></tr>`;
            return;
        }

        usersTableBody.innerHTML = "";
        Object.keys(users).forEach(id => {
            const u = users[id];
            const tr = document.createElement("tr");
            
            let statusText = "🔴 غير متصل";
            if (u.status === "online") statusText = "🟢 متصل";
            else if (u.status === "busy") statusText = "🟡 مشغول";

            tr.innerHTML = `
                <td style="font-weight:700;">${u.name}</td>
                <td>${u.role === 'admin' ? '👑 مدير' : '🎨 عضو'}</td>
                <td>${statusText}</td>
            `;
            usersTableBody.appendChild(tr);
        });
    });

    // 2. معالجة إضافة مستخدم جديد
    if (createUserForm) {
        createUserForm.addEventListener("submit", async (e) => {
            e.preventDefault();

            const name = nameInput.value.trim();
            const email = emailInput.value.trim().toLowerCase();
            const password = passwordInput.value.trim();
            const role = roleInput.value;

            if (!name || !email || !password) {
                showToast("يرجى تعبئة كافة الحقول المطلوبة!", "error");
                return;
            }

            try {
                // التحقق هل البريد مسجل مسبقاً
                const usersSnapshot = await get(ref(db, "users"));
                const users = usersSnapshot.val() || {};
                const emailExists = Object.values(users).some(u => u.email === email);

                if (emailExists) {
                    showToast("هذا البريد الإلكتروني مسجل بالفعل لعضو آخر!", "error");
                    return;
                }

                const newUserId = "user_" + Date.now();
                const newUser = {
                    id: newUserId,
                    name: name,
                    email: email,
                    password: password,
                    role: role,
                    balance: 0.0,
                    status: "away" // افتراضي غير متصل
                };

                await set(ref(db, `users/${newUserId}`), newUser);

                showToast(`تم تسجيل العضو [${name}] بنجاح!`, "success");
                
                // تسجيل لوق العملية
                const admin = getCurrentUser();
                logActivity(admin.name, `قام بإنشاء حساب جديد للعضو [${name}] ودوره [${role === 'admin' ? 'مدير' : 'عضو'}]`);

                // تصفير النموذج
                createUserForm.reset();

            } catch (error) {
                console.error(error);
                showToast("حدث خطأ أثناء حفظ الحساب الجديد!", "error");
            }
        });
    }
}
