import { db, ref, set, get, update } from "./firebase-config.js";
import { setCurrentUser, showToast, logActivity } from "./auth-guard.js";

const loginForm = document.getElementById("login-form");
const emailInput = document.getElementById("login-email");
const passwordInput = document.getElementById("login-password");
const submitBtn = document.getElementById("login-submit-btn");

if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const email = emailInput.value.trim().toLowerCase();
        const password = passwordInput.value;

        if (!email || !password) {
            showToast("الرجاء تعبئة كافة الحقول!", "error");
            return;
        }

        // قفل الزر وتغيير حالته للتحميل
        submitBtn.disabled = true;
        submitBtn.textContent = "جاري التحقق...";

        try {
            const usersRef = ref(db, "users");
            const snapshot = await get(usersRef);
            let users = snapshot.val() || {};

            // 1. التحقق من وجود حساب المدير وإلا نقوم بتهيئته تلقائياً (Seeding)
            const adminEmail = "artiateech@gmail.com";
            const adminExists = Object.values(users).some(u => u.email === adminEmail);

            if (!adminExists) {
                const adminId = "admin_" + Date.now();
                const newAdmin = {
                    id: adminId,
                    name: "إدارة ارتياتك",
                    email: adminEmail,
                    password: "admin123", // كلمة المرور الافتراضية للمدير
                    role: "admin",
                    balance: 0.0,
                    status: "online"
                };
                
                // حفظ المدير في قاعدة البيانات
                await set(ref(db, `users/${adminId}`), newAdmin);
                
                // تحديث المتغير المحلي
                users[adminId] = newAdmin;
                
                // تهيئة الصناديق المالية الافتراضية بقيمة 0 إذا كانت فارغة
                const fundsSnapshot = await get(ref(db, "funds"));
                if (!fundsSnapshot.exists()) {
                    await set(ref(db, "funds"), {
                        operating_fund: 0.0,
                        solidarity_pool: 0.0
                    });
                }

                showToast("تم تهيئة حساب السوبر أدمن الافتراضي: admin123", "success");
            }

            // 2. مطابقة بيانات الدخول
            let loggedInUser = null;
            for (const id in users) {
                const u = users[id];
                if (u.email === email && u.password === password) {
                    loggedInUser = u;
                    break;
                }
            }

            if (loggedInUser) {
                // إعداد بيانات الجلسة (بدون كلمة المرور لأمان أفضل)
                const sessionData = {
                    id: loggedInUser.id,
                    name: loggedInUser.name,
                    email: loggedInUser.email,
                    role: loggedInUser.role,
                    status: "online",
                    balance: loggedInUser.balance || 0
                };

                // تحديث حالة العضو إلى متصل في قاعدة البيانات
                await update(ref(db, `users/${loggedInUser.id}`), { status: "online" });
                
                // حفظ الجلسة محلياً
                setCurrentUser(sessionData);

                showToast("تم تسجيل الدخول بنجاح! جاري الانتقال...", "success");
                
                // تسجيل لوق العملية
                logActivity(sessionData.name, "سجل دخوله للمنظومة");

                setTimeout(() => {
                    window.location.href = "dashboard.html";
                }, 1000);

            } else {
                showToast("البريد الإلكتروني أو كلمة المرور غير صحيحة!", "error");
                submitBtn.disabled = false;
                submitBtn.textContent = "دخول للمنظومة";
            }

        } catch (error) {
            console.error(error);
            showToast("حدث خطأ في الاتصال بالمنظومة!", "error");
            submitBtn.disabled = false;
            submitBtn.textContent = "دخول للمنظومة";
        }
    });
}
