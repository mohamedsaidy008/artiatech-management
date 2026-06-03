import { db, ref, set, get, update, onValue, push } from "./firebase-config.js";
import { getCurrentUser, setCurrentUser, showToast, logActivity, sendNotification } from "./auth-guard.js";

document.addEventListener("DOMContentLoaded", () => {
    const user = getCurrentUser();
    if (!user) return;

    // تهيئة عناصر واجهة الاقتصاد
    const myWalletBal = document.getElementById("my-wallet-balance");
    const opexFundBal = document.getElementById("opex-fund-balance");
    const solidarityPoolBal = document.getElementById("solidarity-pool-balance");
    
    const adminOnlyBlocks = document.querySelectorAll(".admin-only-block");
    const unpaidMonthsList = document.getElementById("unpaid-months-list");
    const allocationMonthInput = document.getElementById("allocation-month");
    const membersAllocContainer = document.getElementById("members-allocation-container");
    
    const triggerDistBtn = document.getElementById("trigger-distribution-btn");
    const saveAllocationsBtn = document.getElementById("save-allocations-btn");
    const saveExpenseBtn = document.getElementById("save-expense-btn");
    
    const opexExpenseForm = document.getElementById("opex-expense-form");
    const expenseAmountInput = document.getElementById("expense-amount");
    const expenseDescInput = document.getElementById("expense-desc");
    
    const withdrawForm = document.getElementById("withdrawal-request-form");
    const withdrawAmountInput = document.getElementById("withdraw-amount");
    const pendingWithdrawalsList = document.getElementById("pending-withdrawals-list");
    
    const ledgerTableBody = document.getElementById("financial-ledger-body");
    const exportLedgerBtn = document.getElementById("export-ledger-btn");

    let allUsers = {};
    let unpaidMonths = [];

    // 1. إظهار لوحات التحكم الخاصة بالأدمن فقط
    if (user.role === "admin") {
        adminOnlyBlocks.forEach(block => block.style.display = "block");
    }

    // 2. تعيين الشهر الافتراضي في حقل الإدخال
    const today = new Date();
    const currentMonthStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    if (allocationMonthInput) {
        allocationMonthInput.value = currentMonthStr;
    }

    // 3. مستمع للأرصدة الكبرى
    onValue(ref(db, "funds"), (snapshot) => {
        const funds = snapshot.val() || { operating_fund: 0, solidarity_pool: 0 };
        opexFundBal.textContent = `${(funds.operating_fund || 0).toFixed(2)} د.إ`;
        solidarityPoolBal.textContent = `${(funds.solidarity_pool || 0).toFixed(2)} د.إ`;
    });

    onValue(ref(db, `users/${user.id}`), (snapshot) => {
        const userData = snapshot.val();
        if (userData) {
            myWalletBal.textContent = `${(userData.balance || 0).toFixed(2)} د.إ`;
            user.balance = userData.balance || 0;
            setCurrentUser(user);
        }
    });

    // 4. تحميل قائمة الأعضاء والنسب
    const loadMembersAndAllocations = async () => {
        try {
            const usersSnapshot = await get(ref(db, "users"));
            allUsers = usersSnapshot.val() || {};
            
            const month = allocationMonthInput.value;
            const allocSnapshot = await get(ref(db, `monthly_allocations/${month}`));
            const savedAlloc = allocSnapshot.val() || {};

            if (membersAllocContainer) {
                membersAllocContainer.innerHTML = "";
                Object.keys(allUsers).forEach(id => {
                    const u = allUsers[id];
                    const shareVal = savedAlloc[id] ? (savedAlloc[id].share * 100) : 0;
                    const reasonVal = savedAlloc[id] ? savedAlloc[id].reason : "";

                    const row = document.createElement("div");
                    row.className = "allocation-row";
                    row.innerHTML = `
                        <span class="member-name" data-id="${u.id}">${u.name}</span>
                        <input type="number" class="form-control alloc-share" min="0" max="100" placeholder="النسبة %" value="${shareVal}" required>
                        <input type="text" class="form-control alloc-reason" placeholder="سبب وتفاصيل النسبة هذا الشهر" value="${reasonVal}">
                    `;
                    membersAllocContainer.appendChild(row);
                });
            }
        } catch (err) {
            console.error(err);
            showToast("فشل جلب قائمة الأعضاء والنسب!", "error");
        }
    };

    if (allocationMonthInput) {
        allocationMonthInput.addEventListener("change", loadMembersAndAllocations);
    }
    loadMembersAndAllocations();

    // 5. حفظ نسب المساهمة للشهر
    if (saveAllocationsBtn) {
        saveAllocationsBtn.addEventListener("click", async () => {
            const month = allocationMonthInput.value;
            if (!month) return;

            const rows = membersAllocContainer.querySelectorAll(".allocation-row");
            let allocations = {};
            let sum = 0;

            rows.forEach(row => {
                const id = row.querySelector(".member-name").getAttribute("data-id");
                const share = parseFloat(row.querySelector(".alloc-share").value) || 0;
                const reason = row.querySelector(".alloc-reason").value.trim();

                allocations[id] = {
                    share: share / 100, // حفظ ككسر عشري
                    reason: reason
                };
                sum += share;
            });

            // التحقق من أن المجموع يساوي 100% (أو 0 إذا لم يتم إدخال شيء بعد)
            if (sum !== 100 && sum !== 0) {
                showToast("خطأ: يجب أن يكون مجموع نسب الأعضاء مساوياً لـ 100%!", "error");
                return;
            }

            try {
                await set(ref(db, `monthly_allocations/${month}`), allocations);
                
                // إضافة الشهر إلى قائمة الأشهر غير المدفوعة إذا لم يكن موجوداً
                const unpaidSnapshot = await get(ref(db, "unpaid_months"));
                let unpaidList = unpaidSnapshot.val() || [];
                if (!unpaidList.includes(month)) {
                    unpaidList.push(month);
                    await set(ref(db, "unpaid_months"), unpaidList);
                }

                showToast(`تم حفظ نسب شهر [${month}] بنجاح!`, "success");
                logActivity(user.name, `حدّد نسب المساهمة لشهر [${month}] ومجموعها [${sum}%]`);
                loadUnpaidMonths();
            } catch (err) {
                console.error(err);
                showToast("حدث خطأ أثناء حفظ نسب المساهمة!", "error");
            }
        });
    }

    // 6. تحميل الأشهر التراكمية غير المدفوعة
    const loadUnpaidMonths = () => {
        onValue(ref(db, "unpaid_months"), (snapshot) => {
            unpaidMonths = snapshot.val() || [];
            if (unpaidMonthsList) {
                unpaidMonthsList.textContent = unpaidMonths.length > 0 ? unpaidMonths.join(" ، ") : "لا توجد أشهر متراكمة";
            }
        });
    };
    loadUnpaidMonths();

    // 7. تسجيل مصروف من الصندوق التشغيلي (OpEx Expense)
    if (opexExpenseForm) {
        opexExpenseForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const amount = parseFloat(expenseAmountInput.value);
            const desc = expenseDescInput.value.trim();

            if (isNaN(amount) || amount <= 0 || !desc) {
                showToast("يرجى إدخال قيم صحيحة!", "error");
                return;
            }

            try {
                const fundsSnapshot = await get(ref(db, "funds"));
                const funds = fundsSnapshot.val() || { operating_fund: 0, solidarity_pool: 0 };
                const currentOp = funds.operating_fund || 0;

                if (amount > currentOp) {
                    showToast("رصيد الصندوق التشغيلي غير كافٍ لإتمام العملية!", "error");
                    return;
                }

                const newOp = currentOp - amount;
                await update(ref(db, "funds"), { operating_fund: newOp });

                // إضافة معاملة مالية
                const transactionRef = push(ref(db, "transactions"));
                await set(transactionRef, {
                    timestamp: Date.now(),
                    actor: "الصندوق التشغيلي",
                    type: "expense",
                    amount: amount,
                    desc: desc
                });

                showToast("تم تسجيل وخصم المصروف بنجاح!", "success");
                logActivity(user.name, `سجّل مصروفاً بقيمة [${amount} د.إ] من الصندوق التشغيلي ببيان: [${desc}]`);
                opexExpenseForm.reset();
            } catch (err) {
                console.error(err);
                showToast("فشل خصم المصاريف!", "error");
            }
        });
    }

    // 8. تقديم طلب سحب مالي (Withdrawal Request)
    if (withdrawForm) {
        withdrawForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            const amount = parseFloat(withdrawAmountInput.value);

            if (isNaN(amount) || amount <= 0) {
                showToast("الرجاء إدخال مبلغ صحيح!", "error");
                return;
            }

            try {
                const userSnapshot = await get(ref(db, `users/${user.id}`));
                const dbUser = userSnapshot.val() || {};
                const myBal = dbUser.balance || 0;

                if (amount > myBal) {
                    showToast("المبلغ المطلوب أكبر من رصيدك المتاح!", "error");
                    return;
                }

                const reqRef = push(ref(db, "withdrawal_requests"));
                await set(reqRef, {
                    id: reqRef.key,
                    userId: user.id,
                    userName: user.name,
                    amount: amount,
                    status: "pending",
                    timestamp: Date.now()
                });

                showToast("تم تقديم طلب السحب بنجاح، بانتظار موافقة الإدارة!", "success");
                logActivity(user.name, `قدّم طلب سحب مالي بقيمة [${amount} د.إ]`);
                withdrawForm.reset();
            } catch (err) {
                console.error(err);
                showToast("حدث خطأ أثناء إرسال طلب السحب!", "error");
            }
        });
    }

    // 9. مستمع طلبات السحب المعلقة
    onValue(ref(db, "withdrawal_requests"), (snapshot) => {
        const reqs = snapshot.val();
        if (!pendingWithdrawalsList) return;

        if (!reqs) {
            pendingWithdrawalsList.innerHTML = `<div class="noti-empty">لا توجد طلبات سحب معلقة حالياً</div>`;
            return;
        }

        const reqArray = Object.keys(reqs).map(key => reqs[key]).filter(r => r.status === "pending");

        if (reqArray.length === 0) {
            pendingWithdrawalsList.innerHTML = `<div class="noti-empty">لا توجد طلبات سحب معلقة حالياً</div>`;
            return;
        }

        pendingWithdrawalsList.innerHTML = "";
        reqArray.forEach(req => {
            // إظهار طلبات السحب الخاصة بالعضو فقط، أو جميع الطلبات إذا كان أدمن
            if (user.role !== "admin" && req.userId !== user.id) return;

            const div = document.createElement("div");
            div.className = "request-item";
            
            let actionHTML = "";
            if (user.role === "admin") {
                actionHTML = `
                    <div class="request-actions">
                        <button class="btn btn-primary approve-withdraw-btn" data-id="${req.id}" style="padding:4px 10px; font-size:11px;">موافقة وصرف</button>
                        <button class="btn btn-danger reject-withdraw-btn" data-id="${req.id}" style="padding:4px 10px; font-size:11px;">رفض</button>
                    </div>
                `;
            } else {
                actionHTML = `<span style="font-size:12px; color:var(--text-secondary);">⏳ قيد الانتظار</span>`;
            }

            div.innerHTML = `
                <div class="request-meta">
                    <span style="font-weight:700;">${req.userName}</span>
                    <span style="font-size:12px; color:var(--accent-gold); font-weight:800;">المبلغ: ${req.amount.toFixed(2)} د.إ</span>
                </div>
                ${actionHTML}
            `;
            pendingWithdrawalsList.appendChild(div);
        });

        // تفعيل أزرار الموافقة والرفض للأدمن
        if (user.role === "admin") {
            pendingWithdrawalsList.querySelectorAll(".approve-withdraw-btn").forEach(btn => {
                btn.addEventListener("click", async () => {
                    const id = btn.getAttribute("data-id");
                    const targetReq = reqs[id];
                    
                    try {
                        const targetUserSnap = await get(ref(db, `users/${targetReq.userId}`));
                        const targetUserData = targetUserSnap.val() || {};
                        const currentBal = targetUserData.balance || 0;

                        if (targetReq.amount > currentBal) {
                            showToast("فشل الموافقة: رصيد العضو غير كافٍ حالياً!", "error");
                            return;
                        }

                        // خصم الرصيد
                        await update(ref(db, `users/${targetReq.userId}`), { balance: currentBal - targetReq.amount });
                        // تحديث حالة الطلب
                        await update(ref(db, `withdrawal_requests/${id}`), { status: "approved" });
                        
                        // تسجيل معاملة السحب
                        const transRef = push(ref(db, "transactions"));
                        await set(transRef, {
                            timestamp: Date.now(),
                            actor: targetReq.userName,
                            type: "withdraw",
                            amount: targetReq.amount,
                            desc: "سحب نقدي معتمد ومصروف من الإدارة"
                        });

                        showToast("تم اعتماد وصرف طلب السحب المالي بنجاح!", "success");
                        logActivity(user.name, `وافق على صرف طلب سحب مالي بقيمة [${targetReq.amount} د.إ] للعضو [${targetReq.userName}]`);
                        sendNotification(targetReq.userId, `تمت الموافقة على طلب سحب بقيمة [${targetReq.amount} د.إ] وصرفها يدوياً.`);
                    } catch (err) {
                        console.error(err);
                        showToast("حدث خطأ في معالجة الطلب!", "error");
                    }
                });
            });

            pendingWithdrawalsList.querySelectorAll(".reject-withdraw-btn").forEach(btn => {
                btn.addEventListener("click", async () => {
                    const id = btn.getAttribute("data-id");
                    const targetReq = reqs[id];
                    
                    try {
                        await update(ref(db, `withdrawal_requests/${id}`), { status: "rejected" });
                        showToast("تم رفض طلب السحب المالي وإلغاؤه.", "info");
                        logActivity(user.name, `رفض طلب سحب مالي بقيمة [${targetReq.amount} د.إ] للعضو [${targetReq.userName}]`);
                        sendNotification(targetReq.userId, `تم رفض طلب السحب الخاص بك بقيمة [${targetReq.amount} د.إ].`);
                    } catch (err) {
                        console.error(err);
                        showToast("حدث خطأ في رفض الطلب!", "error");
                    }
                });
            });
        }
    });

    // 10. مستمع وعرض سجل المعاملات المالية العام (Financial Ledger)
    onValue(ref(db, "transactions"), (snapshot) => {
        const trans = snapshot.val();
        if (!ledgerTableBody) return;

        if (!trans) {
            ledgerTableBody.innerHTML = `<tr><td colspan="5" style="text-align:center;">لا توجد معاملات مالية مسجلة بعد</td></tr>`;
            return;
        }

        const transArray = Object.keys(trans).map(key => trans[key]).sort((a,b) => b.timestamp - a.timestamp);

        ledgerTableBody.innerHTML = "";
        transArray.forEach(t => {
            const tr = document.createElement("tr");
            
            let badgeClass = "badge-deposit";
            let typeText = "إيداع أرباح";
            if (t.type === "withdraw") { badgeClass = "badge-withdraw"; typeText = "سحب نقدي"; }
            else if (t.type === "expense") { badgeClass = "badge-expense"; typeText = "مصروف تشغيلي"; }
            else if (t.type === "solidarity") { badgeClass = "badge-solidarity"; typeText = "صرف تكافلي"; }

            tr.innerHTML = `
                <td style="color:var(--text-secondary); font-size:12px;">${new Date(t.timestamp).toLocaleDateString("ar-EG")}</td>
                <td style="font-weight:700;">${t.actor}</td>
                <td><span class="badge ${badgeClass}">${typeText}</span></td>
                <td style="font-weight:800; color:${t.type === 'withdraw' || t.type === 'expense' ? '#ef4444' : '#10b981'};">
                    ${t.type === 'withdraw' || t.type === 'expense' ? '-' : '+'}${t.amount.toFixed(2)} د.إ
                </td>
                <td style="font-size:13px; max-width:200px; overflow:hidden; text-overflow:ellipsis;">${t.desc}</td>
            `;
            ledgerTableBody.appendChild(tr);
        });
    });

    // 11. توزيع مبالغ محفظة التكافل وصرفها (Trigger Solidarity Distribution)
    if (triggerDistBtn) {
        triggerDistBtn.addEventListener("click", async () => {
            if (unpaidMonths.length === 0) {
                showToast("لا توجد أشهر متراكمة غير مدفوعة لتوزيعها!", "error");
                return;
            }

            try {
                // قفل الزر لمنع الضغط المتكرر
                triggerDistBtn.disabled = true;
                triggerDistBtn.textContent = "جاري الحساب والتوزيع...";

                const fundsSnap = await get(ref(db, "funds"));
                const currentPool = fundsSnap.val().solidarity_pool || 0;

                if (currentPool <= 0) {
                    showToast("محفظة التكافل فارغة حالياً (0 دينار)، لا يوجد شيء لتوزيعه!", "error");
                    triggerDistBtn.disabled = false;
                    triggerDistBtn.textContent = "توزيع مبالغ محفظة التكافل الآن";
                    return;
                }

                // 1. جلب بيانات المهام والمشاريع المسلمة غير الموزعة للتكافل
                const tasksSnapshot = await get(ref(db, "tasks"));
                const tasks = tasksSnapshot.val() || {};
                
                // جلب المشاريع المكتملة المدفوعة التي لم تُوزع حصتها من البنك
                const unpaidTasks = Object.values(tasks).filter(t => t.status === "completed_paid" && t.solidarity_share > 0 && t.solidarity_distributed !== true);

                if (unpaidTasks.length === 0) {
                    showToast("تنبيه: محفظة التكافل بها رصيد ولكن لا توجد مشاريع مسجلة غير موزعة لحساب الاستبعاد. سيتم التوزيع بنسب المساهمة العامة مباشرة.", "info");
                }

                // 2. جلب نسب الشهور غير المدفوعة
                const allocationsSnap = await get(ref(db, "monthly_allocations"));
                const monthlyAllocations = allocationsSnap.val() || {};

                // 3. جلب جميع مستخدمي النظام لتحديث الأرصدة
                const usersSnap = await get(ref(db, "users"));
                let users = usersSnap.val() || {};

                // 4. دمج وحساب النسب لكل عضو عبر الشهور غير المدفوعة (الترحيل)
                let baseShares = {};
                Object.keys(users).forEach(uid => {
                    let totalShare = 0;
                    let monthsCount = 0;
                    
                    unpaidMonths.forEach(m => {
                        if (monthlyAllocations[m] && monthlyAllocations[m][uid]) {
                            totalShare += monthlyAllocations[m][uid].share;
                            monthsCount++;
                        }
                    });

                    // النسبة المتوسطة المدمجة
                    baseShares[uid] = monthsCount > 0 ? (totalShare / monthsCount) : 0;
                });

                // 5. معالجة وتوزيع كل مشروع على حدة لتطبيق الاستبعاد الفوري لمنفذيه
                let totalDistributed = 0;
                
                if (unpaidTasks.length > 0) {
                    for (const task of unpaidTasks) {
                        const B_i = task.solidarity_share || 0; // الـ 20% الخاصة بالمشروع
                        const executors = task.executors || [];
                        
                        // المستحقون للـ 20% (بقية الأعضاء غير المنفذين)
                        const eligibleMembers = Object.keys(users).filter(uid => !executors.includes(uid));

                        if (eligibleMembers.length === 0) {
                            // إذا لم يكن هناك بقية أعضاء، تعود الـ 20% للصندوق التشغيلي كحالة طارئة
                            const currentOpSnap = await get(ref(db, "funds/operating_fund"));
                            const currentOp = currentOpSnap.val() || 0;
                            await update(ref(db, "funds"), { operating_fund: currentOp + B_i });
                            // تعليم المهمة كموزعة
                            const taskKey = Object.keys(tasks).find(k => tasks[k].title === task.title);
                            if (taskKey) await update(ref(db, `tasks/${taskKey}`), { solidarity_distributed: true });
                            continue;
                        }

                        // مجموع نسب التكافل المدمجة للأعضاء المؤهلين
                        const sumEligibleShares = eligibleMembers.reduce((sum, uid) => sum + (baseShares[uid] || 0), 0);

                        if (sumEligibleShares > 0) {
                            for (const uid of eligibleMembers) {
                                // النسبة النسبية المنمطة للعضو
                                const relativeShare = baseShares[uid] / sumEligibleShares;
                                const payout = B_i * relativeShare;

                                // إضافة للرصيد
                                users[uid].balance = (users[uid].balance || 0) + payout;
                                totalDistributed += payout;

                                // تسجيل معاملة مالية مخصصة
                                const transRef = push(ref(db, "transactions"));
                                await set(transRef, {
                                    timestamp: Date.now(),
                                    actor: users[uid].name,
                                    type: "solidarity",
                                    amount: payout,
                                    desc: `توزيع تكافلي مدمج - مشروع [${task.title}]`
                                });

                                sendNotification(uid, `تم إيداع عوائد تكافلية بقيمة [${payout.toFixed(2)} د.إ] من مشروع [${task.title}].`);
                            }
                        }

                        // علم المهمة كموزعة
                        const taskKey = Object.keys(tasks).find(k => tasks[k].title === task.title);
                        if (taskKey) {
                            await update(ref(db, `tasks/${taskKey}`), { solidarity_distributed: true });
                        }
                    }
                } else {
                    // إذا لم توجد مشاريع مخصصة غير موزعة، وزع رصيد المحفظة الإجمالي مباشرة بناءً على النسب المدمجة
                    const sumAllShares = Object.keys(users).reduce((sum, uid) => sum + (baseShares[uid] || 0), 0);

                    if (sumAllShares > 0) {
                        for (const uid of Object.keys(users)) {
                            const relativeShare = baseShares[uid] / sumAllShares;
                            const payout = currentPool * relativeShare;

                            users[uid].balance = (users[uid].balance || 0) + payout;
                            totalDistributed += payout;

                            const transRef = push(ref(db, "transactions"));
                            await set(transRef, {
                                timestamp: Date.now(),
                                actor: users[uid].name,
                                type: "solidarity",
                                amount: payout,
                                desc: "توزيع محفظة التكافل والمساهمة الدورية (تراكمي)"
                            });

                            sendNotification(uid, `تم إيداع عوائد محفظة التكافل الدورية بقيمة [${payout.toFixed(2)} د.إ].`);
                        }
                    }
                }

                // 6. تحديث أرصدة الأعضاء دفعة واحدة في قاعدة البيانات
                for (const uid of Object.keys(users)) {
                    await update(ref(db, `users/${uid}`), { balance: users[uid].balance || 0 });
                }

                // 7. تصفير رصيد التكافل في الفايربيس
                await update(ref(db, "funds"), { solidarity_pool: 0.0 });

                // 8. تصفير الأشهر التراكمية
                await set(ref(db, "unpaid_months"), null);

                showToast(`تم توزيع التكافل بنجاح بقيمة إجمالية [${totalDistributed.toFixed(2)} د.إ] وتصفير الشهور التراكمية!`, "success");
                logActivity(user.name, `وزّع عوائد محفظة التكافل بقيمة [${totalDistributed.toFixed(2)} د.إ] على الأعضاء وصفر الأشهر التراكمية.`);
                
                // إعادة تحميل الواجهة
                unpaidMonths = [];
                if (unpaidMonthsList) unpaidMonthsList.textContent = "لا توجد أشهر متراكمة";

            } catch (err) {
                console.error(err);
                showToast("فشل توزيع أموال التكافل!", "error");
            } finally {
                triggerDistBtn.disabled = false;
                triggerDistBtn.textContent = "توزيع مبالغ محفظة التكافل الآن";
            }
        });
    }

    // 12. تصدير سجل العمليات المالية إلى CSV
    if (exportLedgerBtn) {
        exportLedgerBtn.addEventListener("click", async () => {
            try {
                const transSnapshot = await get(ref(db, "transactions"));
                const trans = transSnapshot.val();

                if (!trans) {
                    showToast("السجل المالي فارغ، لا توجد بيانات للتصدير!", "error");
                    return;
                }

                const transArray = Object.keys(trans).map(key => trans[key]).sort((a,b) => b.timestamp - a.timestamp);

                // إعداد محتوى CSV
                let csvContent = "\ufeff"; // BOM لدعم اللغة العربية في Excel
                csvContent += "التاريخ,الطرف المستفيد,نوع المعاملة,القيمة,البيان والتفاصيل\n";

                transArray.forEach(t => {
                    let typeText = "إيداع أرباح";
                    if (t.type === "withdraw") typeText = "سحب نقدي";
                    else if (t.type === "expense") typeText = "مصروف تشغيلي";
                    else if (t.type === "solidarity") typeText = "صرف تكافلي";

                    const date = new Date(t.timestamp).toLocaleDateString("ar-EG");
                    const actor = t.actor.replace(/,/g, " "); // لمنع تشتت الفواصل في CSV
                    const desc = t.desc.replace(/,/g, " ");
                    const amount = `${t.type === 'withdraw' || t.type === 'expense' ? '-' : '+'}${t.amount}`;

                    csvContent += `${date},${actor},${typeText},${amount},${desc}\n`;
                });

                // تحميل الملف في المتصفح تلقائياً
                const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
                const link = document.createElement("a");
                const url = URL.createObjectURL(blob);
                link.setAttribute("href", url);
                link.setAttribute("download", `سجل_معاملات_استوديو_ارتياتك_${Date.now()}.csv`);
                link.style.visibility = "hidden";
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                showToast("تم تصدير وتحميل السجل المالي كملف CSV بنجاح!", "success");
            } catch (err) {
                console.error(err);
                showToast("حدث خطأ أثناء تصدير البيانات!", "error");
            }
        });
    }
});
