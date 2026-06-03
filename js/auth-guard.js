import { db, ref, set, get, update, onValue, push } from "./firebase-config.js";

// التحقق من الجلسة والتوجيه تلقائياً
document.addEventListener("DOMContentLoaded", () => {
    // 1. إدارة السمات (Light / Dark Theme)
    initTheme();

    // 2. التحقق من تسجيل الدخول
    const currentUser = getCurrentUser();
    const isLoginPage = window.location.pathname.endsWith("index.html") || window.location.pathname === "/";

    if (!currentUser) {
        if (!isLoginPage) {
            // إعادة توجيه لصفحة الدخول إذا لم يكن مسجلاً
            window.location.href = "index.html";
            return;
        }
    } else {
        if (isLoginPage) {
            // إعادة توجيه للرئيسية إذا كان مسجلاً بالفعل ويحاول فتح صفحة الدخول
            window.location.href = "dashboard.html";
            return;
        }

        // 3. بناء وحقن واجهة شريط التنقل العلوي والجانبي تلقائياً في الصفحات
        injectSharedLayout(currentUser);

        // 4. تشغيل مستمع الإشعارات الحية
        initNotificationListener(currentUser.id);

        // 5. تحديث حالة الاتصال الافتراضية
        updateStatusIndicator(currentUser.status || "online");
    }
});

// استرجاع بيانات المستخدم الحالي
export function getCurrentUser() {
    const userStr = localStorage.getItem("currentUser");
    return userStr ? JSON.parse(userStr) : null;
}

// حفظ بيانات المستخدم الحالي
export function setCurrentUser(userData) {
    localStorage.setItem("currentUser", JSON.stringify(userData));
}

// تسجيل الخروج
export function logout() {
    const user = getCurrentUser();
    if (user) {
        // تحديث حالة الاتصال إلى أوفلاين في قاعدة البيانات عند الخروج
        update(ref(db, `users/${user.id}`), { status: "away" }).then(() => {
            localStorage.removeItem("currentUser");
            window.location.href = "index.html";
        });
    } else {
        localStorage.removeItem("currentUser");
        window.location.href = "index.html";
    }
}

// تهيئة وإدارة المظهر (Theme)
function initTheme() {
    const savedTheme = localStorage.getItem("theme") || "dark";
    document.documentElement.setAttribute("data-theme", savedTheme);

    // تحديث زر التبديل إذا كان موجوداً في الصفحة
    setTimeout(() => {
        const toggleBtn = document.getElementById("theme-toggle-btn");
        if (toggleBtn) {
            toggleBtn.innerHTML = savedTheme === "dark" ? "🌞" : "🌙";
            toggleBtn.addEventListener("click", () => {
                const currentTheme = document.documentElement.getAttribute("data-theme");
                const newTheme = currentTheme === "dark" ? "light" : "dark";
                document.documentElement.setAttribute("data-theme", newTheme);
                localStorage.setItem("theme", newTheme);
                toggleBtn.innerHTML = newTheme === "dark" ? "🌞" : "🌙";
            });
        }
    }, 100);
}

// حقن الهيكل المشترك (Sidebar + Header)
function injectSharedLayout(user) {
    const container = document.querySelector(".app-container");
    if (!container) return;

    const activePage = getActivePageName();

    // 1. شريط القائمة الجانبية (Sidebar) - لنسخة الكمبيوتر
    const sidebarHTML = `
        <aside class="sidebar" id="app-sidebar">
            <div class="logo-container">
                <div class="logo-icon">A</div>
                <div class="logo-text">ارتياتك</div>
            </div>
            <ul class="nav-links">
                <li class="nav-item ${activePage === 'dashboard' ? 'active' : ''}"><a href="dashboard.html">📊 الرئيسية</a></li>
                <li class="nav-item ${activePage === 'economy' ? 'active' : ''}"><a href="economy.html">💰 الاقتصاد</a></li>
                <li class="nav-item ${activePage === 'planners' ? 'active' : ''}"><a href="planners.html">📋 المخططات</a></li>
                <li class="nav-item ${activePage === 'discussions' ? 'active' : ''}"><a href="discussions.html">💬 النقاشات</a></li>
                <li class="nav-item ${activePage === 'guidelines' ? 'active' : ''}"><a href="guidelines.html">📖 التعليمات</a></li>
            </ul>
        </aside>
    `;

    // 2. شريط رأس الصفحة (Header)
    const headerHTML = `
        <header class="header">
            <div class="header-right">
                <h1 class="page-title" id="injected-page-title">${getPageTitleArabic(activePage)}</h1>
            </div>
            <div class="header-left">
                <!-- اختيار حالة التوفر -->
                <div class="availability-selector" id="avail-selector">
                    <span class="status-dot online" id="current-status-dot"></span>
                    <span id="current-status-text">متاح</span>
                </div>
                <div class="status-menu" id="avail-menu">
                    <div class="status-option" data-status="online"><span class="status-dot online"></span> متاح</div>
                    <div class="status-option" data-status="busy"><span class="status-dot busy"></span> مشغول</div>
                    <div class="status-option" data-status="away"><span class="status-dot away"></span> غير متوفر</div>
                </div>

                <!-- تبديل المظهر -->
                <button class="theme-toggle-btn" id="theme-toggle-btn">🌞</button>

                <!-- جرس الإشعارات -->
                <div class="notification-bell-container" id="bell-container">
                    <button class="bell-btn">🔔</button>
                    <span class="bell-badge" id="noti-badge" style="display:none;">0</span>
                    
                    <div class="notifications-dropdown" id="noti-dropdown">
                        <div class="noti-header">
                            <span>الإشعارات الفورية</span>
                            <button class="noti-clear-btn" id="clear-noti-btn">مسح الكل</button>
                        </div>
                        <div id="noti-list">
                            <div class="noti-empty">لا توجد إشعارات حالياً</div>
                        </div>
                    </div>
                </div>

                <!-- ملف العضو البسيط -->
                <div class="user-profile-menu">
                    <div class="user-avatar">${user.name.charAt(0)}</div>
                    <div class="user-info">
                        <span class="user-name">${user.name}</span>
                        <span class="user-role">${user.role === 'admin' ? 'مدير' : 'عضو استوديو'}</span>
                    </div>
                    <button class="logout-btn" id="logout-button">خروج</button>
                </div>
            </div>
        </header>
    `;

    // 3. شريط التنقل السفلي (Bottom Nav) - للهواتف
    const bottomNavHTML = `
        <nav class="bottom-nav">
            <a href="dashboard.html" class="bottom-nav-item ${activePage === 'dashboard' ? 'active' : ''}">
                <div class="nav-icon-circle">🏠</div>
                <span>الرئيسية</span>
            </a>
            <a href="economy.html" class="bottom-nav-item ${activePage === 'economy' ? 'active' : ''}">
                <div class="nav-icon-circle">💰</div>
                <span>الاقتصاد</span>
            </a>
            <a href="planners.html" class="bottom-nav-item ${activePage === 'planners' ? 'active' : ''}">
                <div class="nav-icon-circle">📋</div>
                <span>المخططات</span>
            </a>
            <a href="discussions.html" class="bottom-nav-item ${activePage === 'discussions' ? 'active' : ''}">
                <div class="nav-icon-circle">💬</div>
                <span>النقاشات</span>
            </a>
        </nav>
    `;

    // حقن العناصر في بداية الـ Container
    container.insertAdjacentHTML("afterbegin", sidebarHTML + headerHTML + bottomNavHTML);

    // تفعيل أحداث الواجهة المحقونة
    setupHeaderEvents(user);
}

// الحصول على اسم الصفحة الحالية
function getActivePageName() {
    const path = window.location.pathname;
    if (path.endsWith("dashboard.html")) return "dashboard";
    if (path.endsWith("economy.html")) return "economy";
    if (path.endsWith("planners.html")) return "planners";
    if (path.endsWith("discussions.html")) return "discussions";
    if (path.endsWith("guidelines.html")) return "guidelines";
    return "dashboard"; // الافتراضي
}

// ترجمة اسم الصفحة للعنوان العربي
function getPageTitleArabic(page) {
    const titles = {
        dashboard: "لوحة التحكم العامة",
        economy: "منظومة الاقتصاد والمالية",
        planners: "لوحة المخططات والمهام",
        discussions: "غرف نقاش المشاريع",
        guidelines: "دليل تعليمات وقواعد الاستوديو"
    };
    return titles[page] || "استوديو ارتياتك";
}

// تفعيل أحداث شريط الرأس (Header Events)
function setupHeaderEvents(user) {
    // 1. تسجيل الخروج
    const logoutBtn = document.getElementById("logout-button");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", logout);
    }

    // 2. قائمة حالة التوفر
    const availSelector = document.getElementById("avail-selector");
    const availMenu = document.getElementById("avail-menu");
    if (availSelector && availMenu) {
        availSelector.addEventListener("click", (e) => {
            e.stopPropagation();
            availMenu.classList.toggle("active");
        });

        document.addEventListener("click", () => {
            availMenu.classList.remove("active");
        });

        availMenu.querySelectorAll(".status-option").forEach(opt => {
            opt.addEventListener("click", () => {
                const newStatus = opt.getAttribute("data-status");
                updateStatusIndicator(newStatus);
                // تحديث الحالة في قاعدة البيانات
                update(ref(db, `users/${user.id}`), { status: newStatus });
                // تحديث الجلسة المحلية
                user.status = newStatus;
                setCurrentUser(user);

                // تسجيل لوق العمليات
                logActivity(user.name, `غير حالته إلى [${newStatus === 'online' ? 'متاح' : newStatus === 'busy' ? 'مشغول' : 'غير متوفر'}]`);
            });
        });
    }

    // 3. دروب داون الإشعارات
    const bellContainer = document.getElementById("bell-container");
    const notiDropdown = document.getElementById("noti-dropdown");
    if (bellContainer && notiDropdown) {
        bellContainer.addEventListener("click", (e) => {
            e.stopPropagation();
            notiDropdown.classList.toggle("active");
        });

        document.addEventListener("click", () => {
            notiDropdown.classList.remove("active");
        });

        notiDropdown.addEventListener("click", (e) => {
            e.stopPropagation(); // منع الإغلاق عند النقر بداخل القائمة
        });
    }

    // طلب إذن الإشعارات للمتصفح
    if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
    }
}

// تحديث مؤشر الحالة في الواجهة
function updateStatusIndicator(status) {
    const dot = document.getElementById("current-status-dot");
    const text = document.getElementById("current-status-text");
    if (!dot || !text) return;

    dot.className = "status-dot " + (status === "online" ? "online" : status === "busy" ? "busy" : "away");
    text.textContent = status === "online" ? "متاح" : status === "busy" ? "مشغول" : "غير متوفر";
}

// تهيئة مستمع الإشعارات الحية في Firebase
function initNotificationListener(userId) {
    const notiRef = ref(db, `notifications/${userId}`);
    const badge = document.getElementById("noti-badge");
    const notiList = document.getElementById("noti-list");
    const clearBtn = document.getElementById("clear-noti-btn");

    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            set(ref(db, `notifications/${userId}`), null);
        });
    }

    onValue(notiRef, (snapshot) => {
        const notis = snapshot.val();
        if (!notis) {
            if (badge) badge.style.display = "none";
            if (notiList) notiList.innerHTML = `<div class="noti-empty">لا توجد إشعارات حالياً</div>`;
            return;
        }

        const notiArray = Object.keys(notis).map(key => ({
            id: key,
            ...notis[key]
        })).sort((a, b) => b.timestamp - a.timestamp);

        const unreadCount = notiArray.filter(n => !n.read).length;
        if (badge) {
            if (unreadCount > 0) {
                badge.style.display = "flex";
                badge.textContent = unreadCount;
            } else {
                badge.style.display = "none";
            }
        }

        if (notiList) {
            notiList.innerHTML = "";
            notiArray.forEach(noti => {
                const notiItem = document.createElement("div");
                notiItem.className = `noti-item ${noti.read ? '' : 'unread'}`;
                notiItem.innerHTML = `
                    <div class="noti-text">${noti.message}</div>
                    <div class="noti-time">${new Date(noti.timestamp).toLocaleTimeString("ar-EG")} - ${new Date(noti.timestamp).toLocaleDateString("ar-EG")}</div>
                `;

                // النقر يعلم الإشعار كمقروء
                notiItem.addEventListener("click", () => {
                    update(ref(db, `notifications/${userId}/${noti.id}`), { read: true });
                });

                notiList.appendChild(notiItem);
            });
        }
    });
}

// عرض رسالة طائرة تلقائية (Toast Notification)
export function showToast(message, type = "info") {
    let container = document.querySelector(".toast-container");
    if (!container) {
        container = document.createElement("div");
        container.className = "toast-container";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <span>${type === 'success' ? '🟢' : type === 'error' ? '🔴' : '🔵'}</span>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    // إزالة التوست تلقائياً بعد 4 ثوانٍ
    setTimeout(() => {
        toast.style.animation = "slideOut 0.3s forwards";
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 4000);
}

// إرسال إشعار لعضو معين
export function sendNotification(userId, message) {
    const userNotiRef = ref(db, `notifications/${userId}`);
    const newNotiRef = push(userNotiRef);
    set(newNotiRef, {
        message: message,
        timestamp: Date.now(),
        read: false
    });

    // محاولة إرسال إشعار نظام متصفح
    if ("Notification" in window && Notification.permission === "granted") {
        new Notification("استوديو ارتياتك", {
            body: message,
            icon: "./logo.png" // أو أي أيقونة مناسبة
        });
    }
}

// تسجيل الأنشطة في سجل العمليات العام (Activity Log)
export function logActivity(actorName, actionText) {
    const logsRef = ref(db, "activity_logs");
    const newLogRef = push(logsRef);
    set(newLogRef, {
        actor: actorName,
        action: actionText,
        timestamp: Date.now()
    });
}
