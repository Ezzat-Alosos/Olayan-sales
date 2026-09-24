/* ============================================================
   العليان لإدارة المبيعات - الواجهة الكاملة (SPA)
   كل تبويب في المتصفح = جلسة مستقلة تماماً
   ============================================================ */

// ============ المتغيرات العامة ============
let TOKEN = null;
let CURRENT_USER = null;
let CHART_INSTANCE = null;
let PRODUCTS_LIST = [];

// ============ أدوات مساعدة ============
function $(id) { return document.getElementById(id); }
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") e.className = v;
    else if (k === "style") e.style.cssText = v;
    else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  });
  children.forEach(c => {
    if (typeof c === "string") e.appendChild(document.createTextNode(c));
    else if (c) e.appendChild(c);
  });
  return e;
}
function fmt(n) { return Number(n || 0).toFixed(2); }

// ============ طلبات API ============
async function api(url, options = {}) {
  const sep = url.includes("?") ? "&" : "?";
  const fullUrl = TOKEN ? `${url}${sep}t=${TOKEN}` : url;

  const res = await fetch(fullUrl, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401) {
    logout(true);
    throw new Error("انتهت الجلسة");
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return res; // ملف للتحميل
  }
  return res.json();
}

// ============ الإشعارات ============
function showAlert(msg, type = "success") {
  const old = document.querySelector(".toast");
  if (old) old.remove();
  const t = el("div", { class: `toast alert alert-${type}` });
  t.style.cssText = `
    position:fixed;top:20px;left:50%;transform:translateX(-50%);
    z-index:9999;min-width:320px;max-width:90%;text-align:right;
    box-shadow:0 10px 30px rgba(0,0,0,0.15);
    white-space:pre-line;line-height:1.6;
  `;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

// ============ تسجيل الدخول / الخروج ============
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("loginError");
  err.classList.add("hidden");

  try {
    const data = await api("/api/login", {
      method: "POST",
      body: {
        username: $("loginUsername").value.trim(),
        password: $("loginPassword").value,
        role: $("loginRole").value,
      },
    });

    if (!data.ok) {
      err.textContent = data.error || "خطأ في الدخول";
      err.classList.remove("hidden");
      return;
    }

    // ✅ تخزين التوكن في sessionStorage (مستقل لكل تبويب!)
    sessionStorage.setItem("token", data.token);
    sessionStorage.setItem("user", JSON.stringify(data.user));
    TOKEN = data.token;
    CURRENT_USER = data.user;

    startApp();
  } catch (e) {
    err.textContent = e.message;
    err.classList.remove("hidden");
  }
});

async function logout(silent = false) {
  try { if (TOKEN) await api("/api/logout", { method: "POST" }); } catch (e) {}
  sessionStorage.removeItem("token");
  sessionStorage.removeItem("user");
  TOKEN = null;
  CURRENT_USER = null;
  if (CHART_INSTANCE) { CHART_INSTANCE.destroy(); CHART_INSTANCE = null; }
  $("app").classList.add("hidden");
  $("loginPage").classList.remove("hidden");
  $("loginForm").reset();
  if (!silent) showAlert("تم تسجيل الخروج", "success");
}

// ============ بدء التطبيق ============
function startApp() {
  $("loginPage").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("userLabel").innerHTML = `${CURRENT_USER.full_name || CURRENT_USER.username}
    <small>(${CURRENT_USER.role === "manager" ? "مدير" : "موظف"})</small>`;
  buildMenu();
  navigate("dashboard");
}

function buildMenu() {
  const menu = $("mainMenu");
  menu.innerHTML = "";
  const items = [];

  if (CURRENT_USER.role === "manager") {
    items.push(["dashboard", "🏠 الرئيسية"]);
    items.push(["sale", "🛒 مبيعات"]);
    items.push(["purchase", "📦 مشتريات"]);
    items.push(["expense", "💸 مصروفات"]);
    items.push(["reports", "📊 التقارير"]);
    items.push(["users", "👥 المستخدمون"]);
  } else {
    items.push(["sale", "🛒 مبيعات"]);
    items.push(["purchase", "📦 مشتريات"]);
    items.push(["expense", "💸 مصروفات"]);
  }

  items.forEach(([key, label]) => {
    const a = el("a", { "data-page": key, onclick: () => navigate(key) }, label);
    menu.appendChild(a);
  });
}

function markActive(key) {
  document.querySelectorAll(".menu a").forEach(a => {
    a.classList.toggle("active", a.dataset.page === key);
  });
}

// ============ التوجيه ============
async function navigate(page) {
  markActive(page);
  const c = $("mainContent");
  c.innerHTML = '<div class="panel" style="text-align:center">جاري التحميل...</div>';

  try {
    if (page === "dashboard") await renderDashboard(c);
    else if (page === "sale" || page === "purchase") await renderInvoice(c, page);
    else if (page === "expense") await renderExpense(c);
    else if (page === "reports") await renderReports(c);
    else if (page === "users") await renderUsers(c);
  } catch (e) {
    c.innerHTML = `<div class="alert alert-danger">خطأ: ${e.message}</div>`;
  }
}

// ============================================================
// 1. لوحة التحكم
// ============================================================
let dashPeriod = "month";
let dashUser = "";

async function renderDashboard(c) {
  const url = `/api/dashboard?period=${dashPeriod}${dashUser ? "&user_id=" + dashUser : ""}`;
  const data = await api(url);
  if (!data.ok) throw new Error(data.error);

  c.innerHTML = "";

  // رأس الصفحة مع الفلاتر
  const head = el("div", { class: "page-head" });
  head.appendChild(el("h2", {}, "📊 لوحة التحكم"));

  const filter = el("div", { class: "filter-bar" });
  const periodSel = el("select", { onchange: (e) => { dashPeriod = e.target.value; renderDashboard(c); } });
  [["day", "اليوم"], ["week", "هذا الأسبوع"], ["month", "هذا الشهر"],
   ["year", "هذه السنة"], ["all", "كل الفترات"]].forEach(([v, l]) => {
    const opt = el("option", { value: v }, l);
    if (dashPeriod === v) opt.selected = true;
    periodSel.appendChild(opt);
  });
  filter.appendChild(periodSel);

  const userSel = el("select", { onchange: (e) => { dashUser = e.target.value; renderDashboard(c); } });
  const allOpt = el("option", { value: "" }, "👥 كل المستخدمين");
  if (!dashUser) allOpt.selected = true;
  userSel.appendChild(allOpt);
  data.users.forEach(u => {
    const opt = el("option", { value: u.id }, `${u.full_name || u.username} (${u.role === "manager" ? "مدير" : "موظف"})`);
    if (String(dashUser) === String(u.id)) opt.selected = true;
    userSel.appendChild(opt);
  });
  filter.appendChild(userSel);
  filter.appendChild(el("span", { class: "range-hint" }, `${data.date_from} → ${data.date_to}`));

  head.appendChild(filter);
  c.appendChild(head);

  // البطاقات
  const cards = el("div", { class: "cards" });
  cards.appendChild(cardEl("🛒 المبيعات", fmt(data.totals.sales) + " ر.س", "card-sales"));
  cards.appendChild(cardEl("📦 المشتريات", fmt(data.totals.purchases) + " ر.س", "card-purchases"));
  cards.appendChild(cardEl("💸 المصروفات", fmt(data.totals.expenses) + " ر.س", "card-expenses"));

  const profitCard = el("div", { class: "card card-profit" + (data.totals.profit < 0 ? " negative" : "") });
  profitCard.appendChild(el("div", { class: "card-title" }, "💵 صافي الأرباح (دقيق)"));
  profitCard.appendChild(el("div", { class: "card-value" }, fmt(data.totals.profit) + " ر.س"));
  profitCard.appendChild(el("div", { style: "font-size:11px;color:#888;margin-top:6px" },
    `مبيعات ${fmt(data.totals.sales)} − تكلفة ${fmt(data.totals.cogs)} − مصروفات ${fmt(data.totals.expenses)}`));
  cards.appendChild(profitCard);

  c.appendChild(cards);

  // تنبيه لو منتجات بدون سعر شراء
  if (data.totals.missing_cost && data.totals.missing_cost.length) {
    const alert = el("div", { class: "alert alert-warning" });
    alert.innerHTML = `⚠️ منتجات بدون سعر شراء مسجّل (تم احتساب تكلفتها 0): <strong>${data.totals.missing_cost.join("، ")}</strong>`;
    c.appendChild(alert);
  }

  // الرسم البياني
  const chartPanel = el("div", { class: "panel" });
  chartPanel.appendChild(el("h3", {}, "📈 حركة آخر 30 يوماً"));
  const canvas = el("canvas", { id: "chartCanvas", height: "90" });
  chartPanel.appendChild(canvas);
  c.appendChild(chartPanel);

  // آخر العمليات
  const grid2 = el("div", { class: "grid-2" });
  grid2.appendChild(recentPanel("آخر فواتير المبيعات", data.recent_sales, "العميل"));
  grid2.appendChild(recentPanel("آخر فواتير المشتريات", data.recent_purchases, "المورد"));
  c.appendChild(grid2);

  // نشاط المستخدمين
  const actPanel = el("div", { class: "panel" });
  actPanel.appendChild(el("h3", {}, "👥 نشاط المستخدمين خلال الفترة"));
  const table = el("table", { class: "table" });
  table.innerHTML = `
    <thead><tr>
      <th>المستخدم</th><th>الدور</th>
      <th>🛒 مبيعات</th><th>📦 مشتريات</th><th>💸 مصروفات</th>
    </tr></thead>
    <tbody>
      ${data.activity.map(u => `
        <tr>
          <td>${u.full_name || u.username}</td>
          <td>${u.role === "manager" ? "مدير" : "موظف"}</td>
          <td>${fmt(u.sales_total)} ر.س</td>
          <td>${fmt(u.purchase_total)} ر.س</td>
          <td>${fmt(u.expense_total)} ر.س</td>
        </tr>
      `).join("")}
    </tbody>
  `;
  actPanel.appendChild(table);
  c.appendChild(actPanel);

  // إنشاء الرسم البياني
  if (CHART_INSTANCE) CHART_INSTANCE.destroy();
  const ctx = $("chartCanvas").getContext("2d");
  CHART_INSTANCE = new Chart(ctx, {
    type: "line",
    data: {
      labels: data.chart_labels,
      datasets: [
        { label: "مبيعات", data: data.chart_sales, borderColor: "#2ecc71",
          backgroundColor: "rgba(46,204,113,0.1)", tension: 0.3, fill: true },
        { label: "مشتريات", data: data.chart_purchases, borderColor: "#e74c3c",
          backgroundColor: "rgba(231,76,60,0.1)", tension: 0.3, fill: true }
      ]
    },
    options: { responsive: true, plugins: { legend: { labels: { font: { size: 14 } } } } }
  });
}

function cardEl(title, value, cls) {
  const d = el("div", { class: "card " + cls });
  d.appendChild(el("div", { class: "card-title" }, title));
  d.appendChild(el("div", { class: "card-value" }, value));
  return d;
}

function recentPanel(title, rows, partyLabel) {
  const p = el("div", { class: "panel" });
  p.appendChild(el("h3", {}, title));
  const t = el("table", { class: "table" });
  t.innerHTML = `
    <thead><tr><th>#</th><th>التاريخ</th><th>${partyLabel}</th><th>الإجمالي</th></tr></thead>
    <tbody>
      ${rows.length ? rows.map(r => `
        <tr><td>${r.id}</td><td>${r.date}</td>
          <td>${r.party || "-"}</td><td>${fmt(r.total)} ر.س</td></tr>
      `).join("") : '<tr><td colspan="4" style="text-align:center;color:#888">لا توجد بيانات</td></tr>'}
    </tbody>
  `;
  p.appendChild(t);
  return p;
}

// ============================================================
// 2. صفحة الفاتورة (مبيعات / مشتريات)
// ============================================================
async function renderInvoice(c, itype) {
  const isSale = itype === "sale";
  const title = isSale ? "فاتورة مبيعات" : "فاتورة مشتريات";
  const partyLabel = isSale ? "اسم العميل" : "اسم المورد";

  const data = await api(`/api/invoices/${itype}?limit=10`);

  c.innerHTML = "";
  c.appendChild(el("div", { class: "page-head" }, el("h2", {}, title)));

  // نموذج الفاتورة
  const formPanel = el("div", { class: "panel" });
  const form = el("form", { id: "invoiceForm" });

  const topGrid = el("div", { class: "grid-3" });
  topGrid.appendChild(el("div", {},
    el("label", {}, "رقم الفاتورة (اختياري)"),
    el("input", { type: "text", id: "invNo", placeholder: "مثال: INV-001" })
  ));
  topGrid.appendChild(el("div", {},
    el("label", {}, partyLabel),
    el("input", { type: "text", id: "invParty", placeholder: partyLabel })
  ));
  form.appendChild(topGrid);

  form.appendChild(el("h4", { class: "section-title" }, "المنتجات"));

  const table = el("table", { class: "table items-table" });
  table.innerHTML = `
    <thead><tr>
      <th style="width:45%">اسم المنتج</th>
      <th style="width:15%">الكمية</th>
      <th style="width:20%">السعر (ر.س)</th>
      <th style="width:15%">الإجمالي</th>
      <th style="width:5%"></th>
    </tr></thead>
    <tbody id="itemsBody"></tbody>
    <tfoot><tr>
      <td colspan="3" class="text-left"><strong>الإجمالي الكلي</strong></td>
      <td id="grandTotal"><strong>0.00 ر.س</strong></td>
      <td></td>
    </tr></tfoot>
  `;
  form.appendChild(table);

  const addBtn = el("button", { type: "button", class: "btn-secondary", onclick: addItemRow }, "➕ إضافة منتج");
  form.appendChild(addBtn);

  form.appendChild(el("div", { style: "margin-top:15px" },
    el("label", {}, "ملاحظات"),
    el("input", { type: "text", id: "invNotes", placeholder: "ملاحظات إضافية..." })
  ));

  const saveBtn = el("button", { type: "submit", class: "btn-primary", style: "margin-top:20px" }, "💾 حفظ");
  form.appendChild(saveBtn);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    await saveInvoice(itype);
  });

  formPanel.appendChild(form);
  c.appendChild(formPanel);

  // آخر العمليات
  const recentPanel = el("div", { class: "panel" });
  const headRow = el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:10px" });
  headRow.appendChild(el("h3", { style: "margin:0" }, "آخر العمليات"));
  const allBtn = el("a", {
    class: "btn-secondary",
    onclick: () => showAllInvoices(itype, partyLabel)
  }, "📋 عرض جميع الفواتير");
  headRow.appendChild(allBtn);
  recentPanel.appendChild(headRow);

  const rt = el("table", { class: "table" });
  rt.innerHTML = `
    <thead><tr>
      <th>#</th><th>التاريخ</th><th>${partyLabel}</th><th>الإجمالي</th><th>المستخدم</th>
    </tr></thead>
    <tbody>
      ${data.invoices.length ? data.invoices.map(inv => `
        <tr>
          <td>${inv.id}</td><td>${inv.date}</td>
          <td>${inv.party || "-"}</td>
          <td>${fmt(inv.total)} ر.س</td>
          <td>${inv.full_name || inv.username || "-"}</td>
        </tr>
      `).join("") : '<tr><td colspan="5" style="text-align:center;color:#888">لا توجد بيانات</td></tr>'}
    </tbody>
  `;
  recentPanel.appendChild(rt);
  c.appendChild(recentPanel);

  // إضافة صف أول
  addItemRow();

  // تحميل المنتجات للاقتراح
  loadProductsForAutocomplete();
}

function addItemRow() {
  const tbody = $("itemsBody");
  const tr = el("tr");
  tr.innerHTML = `
    <td><input list="productsList" name="product_name" class="product-input" required placeholder="اكتب حرفين..."></td>
    <td><input type="number" step="0.01" name="quantity" value="1" min="0.01" required></td>
    <td><input type="number" step="0.01" name="price" value="0" min="0" required></td>
    <td class="subtotal">0.00 ر.س</td>
    <td><button type="button" class="btn-remove">✕</button></td>
  `;
  tr.querySelector(".btn-remove").addEventListener("click", () => {
    tr.remove(); updateGrandTotal();
  });
  tr.querySelectorAll("input").forEach(inp => inp.addEventListener("input", updateGrandTotal));
  const prodInput = tr.querySelector(".product-input");
  prodInput.addEventListener("input", onProductInput);
  tbody.appendChild(tr);
  updateGrandTotal();
  prodInput.focus();
}

function updateGrandTotal() {
  let grand = 0;
  document.querySelectorAll("#itemsBody tr").forEach(tr => {
    const q = parseFloat(tr.querySelector('[name="quantity"]').value) || 0;
    const p = parseFloat(tr.querySelector('[name="price"]').value) || 0;
    const sub = q * p;
    tr.querySelector(".subtotal").textContent = sub.toFixed(2) + " ر.س";
    grand += sub;
  });
  $("grandTotal").innerHTML = `<strong>${grand.toFixed(2)} ر.س</strong>`;
}

async function onProductInput(e) {
  const q = e.target.value.trim();
  if (q.length < 1) return;
  const data = await api(`/api/products?q=${encodeURIComponent(q)}`);
  let datalist = $("productsList");
  if (!datalist) {
    datalist = el("datalist", { id: "productsList" });
    document.body.appendChild(datalist);
  }
  datalist.innerHTML = data.map(p => `<option value="${p.name}">${p.price}</option>`).join("");

  // تعبئة السعر تلقائياً
  const match = data.find(p => p.name === q);
  if (match) {
    const tr = e.target.closest("tr");
    const priceInput = tr.querySelector('[name="price"]');
    if (parseFloat(priceInput.value) === 0) {
      priceInput.value = match.price;
      updateGrandTotal();
    }
  }
}

async function loadProductsForAutocomplete() {
  if (!$("productsList")) {
    document.body.appendChild(el("datalist", { id: "productsList" }));
  }
}

async function saveInvoice(itype) {
  const items = [];
  document.querySelectorAll("#itemsBody tr").forEach(tr => {
    const n = tr.querySelector('[name="product_name"]').value.trim();
    const q = parseFloat(tr.querySelector('[name="quantity"]').value) || 0;
    const p = parseFloat(tr.querySelector('[name="price"]').value) || 0;
    if (n && q > 0) items.push({ product_name: n, quantity: q, price: p });
  });

  if (!items.length) {
    showAlert("أضف منتجاً واحداً على الأقل", "warning");
    return;
  }

  const data = await api(`/api/invoice/${itype}`, {
    method: "POST",
    body: {
      invoice_no: $("invNo").value.trim(),
      party: $("invParty").value.trim(),
      notes: $("invNotes").value.trim(),
      items
    }
  });

  if (data.ok) {
    showAlert(`✅ تم حفظ الفاتورة - الإجمالي: ${fmt(data.total)} ر.س`);
    navigate(itype);
  } else {
    showAlert(data.error || "خطأ", "danger");
  }
}

async function showAllInvoices(itype, partyLabel) {
  const data = await api(`/api/invoices/${itype}?limit=1000`);
  if (!data.ok) return;

  const c = $("mainContent");
  c.innerHTML = "";
  c.appendChild(el("div", { class: "page-head" },
    el("h2", {}, "📋 جميع الفواتير"),
    el("a", { class: "btn-secondary", onclick: () => navigate(itype) }, "↩ رجوع")
  ));

  const panel = el("div", { class: "panel" });
  if (!data.invoices.length) {
    panel.appendChild(el("p", { style: "text-align:center;padding:40px;color:#888" }, "لا توجد فواتير"));
  }

  data.invoices.forEach(inv => {
    const card = el("div", { style: "border:1px solid #e0e6ed;border-radius:10px;padding:15px;margin-bottom:20px;background:#fcfdff" });
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;padding-bottom:12px;border-bottom:2px solid #eef1f4;margin-bottom:12px">
        <div><strong style="color:#1F4E79;font-size:16px">فاتورة #${inv.id}</strong>
          ${inv.invoice_no ? `<span style="background:#e3f0ff;color:#1F4E79;padding:3px 8px;border-radius:6px;font-size:12px;margin-right:6px">${inv.invoice_no}</span>` : ""}
        </div>
        <div style="color:#666;font-size:13px">
          📅 ${inv.date} &nbsp;|&nbsp; 👤 ${inv.party || "غير محدد"} &nbsp;|&nbsp; ✍️ ${inv.full_name || inv.username || "مجهول"}
        </div>
        <div style="font-size:15px;color:#1F4E79">الإجمالي: <strong>${fmt(inv.total)} ر.س</strong></div>
      </div>
      <table class="table" style="font-size:13px">
        <thead><tr><th>#</th><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي الفرعي</th></tr></thead>
        <tbody>
          ${inv.items.map((it, i) => `
            <tr><td>${i + 1}</td><td>${it.product_name}</td><td>${it.quantity}</td>
              <td>${fmt(it.price)} ر.س</td><td>${fmt(it.subtotal)} ر.س</td></tr>
          `).join("")}
        </tbody>
      </table>
    `;
    panel.appendChild(card);
  });

  c.appendChild(panel);
}

// ============================================================
// 3. صفحة المصروفات
// ============================================================
async function renderExpense(c) {
  const data = await api("/api/expenses?limit=10");

  c.innerHTML = "";
  c.appendChild(el("div", { class: "page-head" }, el("h2", {}, "💸 المصروفات")));

  const formPanel = el("div", { class: "panel" });
  const form = el("form");
  form.innerHTML = `
    <div class="grid-3">
      <div><label>تصنيف المصروف</label>
        <input type="text" id="expCat" required placeholder="إيجار، كهرباء، رواتب..."></div>
      <div><label>المبلغ (ر.س)</label>
        <input type="number" step="0.01" id="expAmt" required min="0.01"></div>
    </div>
    <div style="margin-top:15px">
      <label>ملاحظات</label>
      <input type="text" id="expNotes" placeholder="ملاحظات إضافية...">
    </div>
    <button type="submit" class="btn-primary" style="margin-top:20px">💾 حفظ</button>
  `;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const res = await api("/api/expense", {
      method: "POST",
      body: {
        category: $("expCat").value.trim(),
        amount: parseFloat($("expAmt").value),
        notes: $("expNotes").value.trim(),
      }
    });
    if (res.ok) {
      showAlert("✅ تم إضافة المصروف");
      navigate("expense");
    } else {
      showAlert(res.error || "خطأ", "danger");
    }
  });
  formPanel.appendChild(form);
  c.appendChild(formPanel);

  // آخر العمليات
  const recentPanel = el("div", { class: "panel" });
  const headRow = el("div", { style: "display:flex;justify-content:space-between;align-items:center;margin-bottom:10px" });
  headRow.appendChild(el("h3", { style: "margin:0" }, "آخر العمليات"));
  headRow.appendChild(el("a", { class: "btn-secondary", onclick: showAllExpenses }, "📋 عرض جميع المصروفات"));
  recentPanel.appendChild(headRow);

  const t = el("table", { class: "table" });
  t.innerHTML = `
    <thead><tr><th>#</th><th>التصنيف</th><th>المبلغ</th><th>التاريخ</th><th>المستخدم</th></tr></thead>
    <tbody>
      ${data.expenses.length ? data.expenses.map(r => `
        <tr><td>${r.id}</td><td>${r.category}</td>
          <td>${fmt(r.amount)} ر.س</td><td>${r.date}</td>
          <td>${r.full_name || r.username || "-"}</td></tr>
      `).join("") : '<tr><td colspan="5" style="text-align:center;color:#888">لا توجد بيانات</td></tr>'}
    </tbody>
  `;
  recentPanel.appendChild(t);
  c.appendChild(recentPanel);
}

async function showAllExpenses() {
  const data = await api("/api/expenses?limit=1000");
  const c = $("mainContent");
  c.innerHTML = "";
  c.appendChild(el("div", { class: "page-head" },
    el("h2", {}, "💸 جميع المصروفات"),
    el("a", { class: "btn-secondary", onclick: () => navigate("expense") }, "↩ رجوع")
  ));

  const panel = el("div", { class: "panel" });
  const t = el("table", { class: "table" });
  t.innerHTML = `
    <thead><tr><th>#</th><th>التصنيف</th><th>المبلغ</th><th>التاريخ</th><th>المستخدم</th><th>ملاحظات</th></tr></thead>
    <tbody>
      ${data.expenses.length ? data.expenses.map(r => `
        <tr><td>${r.id}</td><td>${r.category}</td>
          <td>${fmt(r.amount)} ر.س</td><td>${r.date}</td>
          <td>${r.full_name || r.username || "-"}</td>
          <td>${r.notes || "-"}</td></tr>
      `).join("") : '<tr><td colspan="6" style="text-align:center;color:#888">لا توجد مصروفات</td></tr>'}
    </tbody>
  `;
  panel.appendChild(t);
  c.appendChild(panel);
}

// ============================================================
// 4. صفحة التقارير
// ============================================================
let repPeriod = "month";
let repUser = "";

async function renderReports(c) {
  const url = `/api/reports?period=${repPeriod}${repUser ? "&user_id=" + repUser : ""}`;
  const data = await api(url);
  if (!data.ok) throw new Error(data.error);

  // جلب قائمة المستخدمين
  const usersData = await api("/api/users");

  c.innerHTML = "";
  const head = el("div", { class: "page-head" });
  head.appendChild(el("h2", {}, "📊 التقارير"));

  const filter = el("div", { class: "filter-bar" });
  const pSel = el("select", { onchange: (e) => { repPeriod = e.target.value; renderReports(c); } });
  [["day", "اليوم"], ["week", "هذا الأسبوع"], ["month", "هذا الشهر"],
   ["year", "هذه السنة"], ["all", "كل الفترات"]].forEach(([v, l]) => {
    const o = el("option", { value: v }, l);
    if (repPeriod === v) o.selected = true;
    pSel.appendChild(o);
  });
  filter.appendChild(pSel);

  const uSel = el("select", { onchange: (e) => { repUser = e.target.value; renderReports(c); } });
  const allU = el("option", { value: "" }, "👥 كل المستخدمين");
  if (!repUser) allU.selected = true;
  uSel.appendChild(allU);
  usersData.users.forEach(u => {
    const o = el("option", { value: u.id }, `${u.full_name || u.username} (${u.role === "manager" ? "مدير" : "موظف"})`);
    if (String(repUser) === String(u.id)) o.selected = true;
    uSel.appendChild(o);
  });
  filter.appendChild(uSel);
  filter.appendChild(el("span", { class: "range-hint" }, `${data.date_from} → ${data.date_to}`));

  head.appendChild(filter);
  c.appendChild(head);

  // البطاقات
  const cards = el("div", { class: "cards" });
  cards.appendChild(cardEl("🛒 المبيعات", fmt(data.totals.sales) + " ر.س", "card-sales"));
  cards.appendChild(cardEl("📦 المشتريات", fmt(data.totals.purchases) + " ر.س", "card-purchases"));
  cards.appendChild(cardEl("💸 المصروفات", fmt(data.totals.expenses) + " ر.س", "card-expenses"));
  const pc = el("div", { class: "card card-profit" + (data.totals.profit < 0 ? " negative" : "") });
  pc.appendChild(el("div", { class: "card-title" }, "💵 صافي الأرباح"));
  pc.appendChild(el("div", { class: "card-value" }, fmt(data.totals.profit) + " ر.س"));
  cards.appendChild(pc);
  c.appendChild(cards);

  // شريط التصدير
  const expPanel = el("div", { class: "panel export-bar" });
  expPanel.appendChild(el("strong", {}, "📤 تصدير حسب الفلترة:"));
  ["sales", "purchases", "expenses"].forEach(kind => {
    const label = kind === "sales" ? "المبيعات" : kind === "purchases" ? "المشتريات" : "المصروفات";
    const xl = el("a", { class: "btn-export xlsx", onclick: () => exportExcel(kind) }, `Excel - ${label}`);
    const pdf = el("a", { class: "btn-export pdf", onclick: () => exportPDF(kind) }, `PDF - ${label}`);
    expPanel.appendChild(xl);
    expPanel.appendChild(pdf);
  });
  c.appendChild(expPanel);

  // أفضل المنتجات
  const topPanel = el("div", { class: "panel" });
  topPanel.appendChild(el("h3", {}, "🏆 أفضل 5 منتجات مبيعاً"));
  const tt = el("table", { class: "table" });
  tt.innerHTML = `
    <thead><tr><th>المنتج</th><th>الكمية</th><th>الإجمالي</th></tr></thead>
    <tbody>
      ${data.top_products.length ? data.top_products.map(p => `
        <tr><td>${p.product_name}</td><td>${p.qty}</td>
          <td>${fmt(p.total)} ر.س</td></tr>
      `).join("") : '<tr><td colspan="3" style="text-align:center;color:#888">لا توجد بيانات</td></tr>'}
    </tbody>
  `;
  topPanel.appendChild(tt);
  c.appendChild(topPanel);

  // جدولان
  const grid = el("div", { class: "grid-2" });
  grid.appendChild(simpleTable("🛒 المبيعات", data.sales, "العميل"));
  grid.appendChild(simpleTable("📦 المشتريات", data.purchases, "المورد"));
  c.appendChild(grid);

  // المصروفات
  const expList = el("div", { class: "panel" });
  expList.appendChild(el("h3", {}, `💸 المصروفات (${data.expenses.length})`));
  const et = el("table", { class: "table" });
  et.innerHTML = `
    <thead><tr><th>#</th><th>التصنيف</th><th>المبلغ</th><th>التاريخ</th><th>ملاحظات</th></tr></thead>
    <tbody>
      ${data.expenses.length ? data.expenses.map(r => `
        <tr><td>${r.id}</td><td>${r.category}</td>
          <td>${fmt(r.amount)} ر.س</td><td>${r.date}</td>
          <td>${r.notes || "-"}</td></tr>
      `).join("") : '<tr><td colspan="5" style="text-align:center;color:#888">لا توجد بيانات</td></tr>'}
    </tbody>
  `;
  expList.appendChild(et);
  c.appendChild(expList);
}

function simpleTable(title, rows, partyLabel) {
  const p = el("div", { class: "panel" });
  p.appendChild(el("h3", {}, `${title} (${rows.length})`));
  const t = el("table", { class: "table" });
  t.innerHTML = `
    <thead><tr><th>#</th><th>التاريخ</th><th>${partyLabel}</th><th>الإجمالي</th></tr></thead>
    <tbody>
      ${rows.length ? rows.map(r => `
        <tr><td>${r.id}</td><td>${r.date}</td>
          <td>${r.party || "-"}</td><td>${fmt(r.total)} ر.س</td></tr>
      `).join("") : '<tr><td colspan="4" style="text-align:center;color:#888">لا توجد بيانات</td></tr>'}
    </tbody>
  `;
  p.appendChild(t);
  return p;
}

function exportExcel(kind) {
  const params = `period=${repPeriod}${repUser ? "&user_id=" + repUser : ""}&t=${TOKEN}`;
  window.open(`/api/export/excel/${kind}?${params}`, "_blank");
}

async function exportPDF(kind) {
  const params = `period=${repPeriod}${repUser ? "&user_id=" + repUser : ""}`;
  const data = await api(`/api/print/${kind}?${params}`);
  if (!data.ok) {
    showAlert(data.error || "خطأ", "danger");
    return;
  }

  // فتح نافذة جديدة وبناء HTML للطباعة
  const w = window.open("", "_blank");
  let html = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<title>${data.title}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Tahoma, Arial, sans-serif; padding: 20px; background: #f0f4f8; color: #2c3e50; }
  .actions { display: flex; gap: 10px; justify-content: flex-end; margin-bottom: 20px; max-width: 950px; margin-inline: auto; }
  .btn { padding: 10px 22px; border: none; border-radius: 8px; cursor: pointer; font-size: 14px; font-family: inherit; font-weight: 500; color: white; background: #1F4E79; }
  .report { background: white; padding: 35px; border-radius: 12px; max-width: 950px; margin: 0 auto; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
  h1 { color: #1F4E79; font-size: 22px; text-align: center; margin-bottom: 8px; }
  .meta { text-align: center; color: #666; margin-bottom: 25px; font-size: 13px; }
  .invoice-block { border: 1px solid #dde4ec; border-radius: 10px; margin-bottom: 18px; overflow: hidden; page-break-inside: avoid; }
  .inv-head { background: #f0f4f8; padding: 12px 15px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px; align-items: center; }
  .inv-head .num { color: #1F4E79; font-weight: bold; font-size: 15px; }
  .inv-head .meta-line { color: #555; font-size: 12px; }
  .inv-head .tot { font-weight: bold; color: #16a085; font-size: 14px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 8px 10px; text-align: right; font-size: 12px; border-bottom: 1px solid #eef1f4; }
  th { background: #fafbfc; color: #1F4E79; font-weight: 600; }
  .grand { background: #1F4E79; color: white; text-align: center; padding: 12px; border-radius: 8px; margin-top: 20px; font-size: 16px; }
  .footer { text-align: center; margin-top: 25px; color: #888; font-size: 11px; }
  @media print { body { background: white; padding: 0; } .actions { display: none; } .report { box-shadow: none; padding: 0; } }
</style>
</head>
<body>
<div class="actions">
  <button class="btn" onclick="window.print()">🖨️ طباعة / حفظ PDF</button>
</div>
<div class="report">
  <h1>${data.title}</h1>
  <div class="meta">الفترة: من <strong>${data.date_from}</strong> إلى <strong>${data.date_to}</strong></div>
`;

  if (data.kind === "sales" || data.kind === "purchases") {
    if (data.invoices.length === 0) {
      html += '<p style="text-align:center;padding:30px;color:#888">لا توجد فواتير</p>';
    }
    data.invoices.forEach(inv => {
      html += `
        <div class="invoice-block">
          <div class="inv-head">
            <div><span class="num">فاتورة #${inv.id}</span>${inv.invoice_no ? " — " + inv.invoice_no : ""}</div>
            <div class="meta-line">📅 ${inv.date} &nbsp;|&nbsp;
              ${data.kind === "sales" ? "العميل" : "المورد"}: ${inv.party || "-"}
              &nbsp;|&nbsp; ✍️ ${inv.user}</div>
            <div class="tot">الإجمالي: ${fmt(inv.total)} ر.س</div>
          </div>
          <table>
            <thead><tr><th>#</th><th>المنتج</th><th>الكمية</th><th>السعر</th><th>الإجمالي الفرعي</th></tr></thead>
            <tbody>
              ${inv.items.map((it, i) => `
                <tr><td>${i + 1}</td><td>${it.product_name}</td><td>${it.quantity}</td>
                  <td>${fmt(it.price)} ر.س</td><td>${fmt(it.subtotal)} ر.س</td></tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      `;
    });
    if (data.invoices.length) {
      html += `<div class="grand">الإجمالي الكلي: ${fmt(data.total)} ر.س</div>`;
    }
  } else if (data.kind === "expenses") {
    html += `
      <table>
        <thead><tr><th>#</th><th>التصنيف</th><th>المبلغ</th><th>التاريخ</th><th>المستخدم</th><th>ملاحظات</th></tr></thead>
        <tbody>
          ${data.expenses.length ? data.expenses.map((r, i) => `
            <tr><td>${i + 1}</td><td>${r.category}</td>
              <td>${fmt(r.amount)} ر.س</td><td>${r.date}</td>
              <td>${r.full_name || r.username || "-"}</td>
              <td>${r.notes || "-"}</td></tr>
          `).join("") : '<tr><td colspan="6" style="text-align:center;color:#888">لا توجد مصروفات</td></tr>'}
        </tbody>
      </table>
    `;
    if (data.expenses.length) {
      html += `<div class="grand">الإجمالي الكلي: ${fmt(data.total)} ر.س</div>`;
    }
  }

  html += `
      <div class="footer">العليان لإدارة المبيعات - تم إنشاء التقرير بتاريخ ${data.date_from}</div>
    </div>
    <script>window.addEventListener('load', () => setTimeout(() => window.print(), 500));<\/script>
  </body>
</html>
  `;

  w.document.write(html);
  w.document.close();
}

// ============================================================
// 5. إدارة المستخدمين
// ============================================================
async function renderUsers(c) {
  const data = await api("/api/users");
  if (!data.ok) throw new Error(data.error);

  c.innerHTML = "";
  c.appendChild(el("div", { class: "page-head" }, el("h2", {}, "👥 إدارة المستخدمين")));

  // إضافة مستخدم
  const addPanel = el("div", { class: "panel" });
  addPanel.appendChild(el("h3", {}, "➕ إضافة مستخدم جديد"));
  const addForm = el("form", { class: "grid-4" });
  addForm.style.cssText = "display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px";
  addForm.innerHTML = `
    <div><label>الاسم الكامل</label><input type="text" id="newFullName" required></div>
    <div><label>اسم المستخدم</label><input type="text" id="newUsername" required></div>
    <div><label>كلمة المرور</label><input type="password" id="newPassword" required minlength="4"></div>
    <div><label>الدور</label>
      <select id="newRole" required>
        <option value="employee">موظف</option>
        <option value="manager">مدير</option>
      </select>
    </div>
    <div style="grid-column:1/-1"><button type="submit" class="btn-primary">إضافة</button></div>
  `;
  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const res = await api("/api/users", {
      method: "POST",
      body: {
        action: "add",
        full_name: $("newFullName").value.trim(),
        username: $("newUsername").value.trim(),
        password: $("newPassword").value,
        role: $("newRole").value,
      }
    });
    if (res.ok) { showAlert("✅ تم إضافة المستخدم"); renderUsers(c); }
    else showAlert(res.error || "خطأ", "danger");
  });
  addPanel.appendChild(addForm);
  c.appendChild(addPanel);

  // قائمة المستخدمين
  const listPanel = el("div", { class: "panel" });
  listPanel.appendChild(el("h3", {}, "قائمة المستخدمين"));
  const t = el("table", { class: "table" });
  t.innerHTML = `
    <thead><tr><th>#</th><th>الاسم</th><th>المستخدم</th><th>الدور</th><th>الحالة</th><th>إجراءات</th></tr></thead>
    <tbody>
      ${data.users.map(u => `
        <tr>
          <td>${u.id}</td>
          <td>${u.full_name || "-"}</td>
          <td>${u.username}</td>
          <td>${u.role === "manager" ? "مدير" : "موظف"}</td>
          <td>${u.active ? '<span class="badge green">نشط</span>' : '<span class="badge red">معطّل</span>'}</td>
          <td style="display:flex;gap:5px;flex-wrap:wrap">
            <button class="btn-small" onclick="toggleUser(${u.id})">${u.active ? "تعطيل" : "تفعيل"}</button>
            <button class="btn-small" style="background:#f39c12" onclick="resetPass(${u.id})">تغيير كلمة المرور</button>
            ${u.id !== CURRENT_USER.id ? `<button class="btn-small" style="background:#e74c3c" onclick="deleteUser(${u.id}, '${(u.full_name || u.username).replace(/'/g, "\\'")}')">🗑️ حذف</button>` : ''}
          </td>

        </tr>
      `).join("")}
    </tbody>
  `;
  listPanel.appendChild(t);
  c.appendChild(listPanel);



  // قسم منطقة الخطر
  const dangerPanel = el("div", { class: "panel" });
  dangerPanel.style.cssText = "border:2px solid #e74c3c;background:#fff5f5";
  dangerPanel.appendChild(el("h3", { style: "color:#c0392b" }, "⚠️ منطقة الخطر"));
  dangerPanel.appendChild(el("p", { style: "color:#666;margin-bottom:15px;font-size:14px" },
    "احذف جميع العمليات (مبيعات + مشتريات + مصروفات + منتجات). لا يمكن التراجع!"));

  const clearBtn = el("button", {
    class: "btn-small",
    style: "background:#e74c3c;padding:10px 20px;font-size:14px",
    onclick: clearAllData
  }, "🗑️ حذف جميع العمليات");
  dangerPanel.appendChild(clearBtn);
  c.appendChild(dangerPanel);




  // سجل النشاط
  const logPanel = el("div", { class: "panel" });
  logPanel.appendChild(el("h3", {}, "📋 آخر 20 عملية"));
  const lt = el("table", { class: "table" });
  lt.innerHTML = `
    <thead><tr><th>#</th><th>العملية</th><th>التفاصيل</th><th>التاريخ</th></tr></thead>
    <tbody>
      ${data.logs.map(l => `
        <tr><td>${l.id}</td><td>${l.action}</td>
          <td>${l.details || "-"}</td><td>${l.created_at}</td></tr>
      `).join("")}
    </tbody>
  `;
  logPanel.appendChild(lt);
  c.appendChild(logPanel);
}

async function toggleUser(uid) {
  const res = await api("/api/users", { method: "POST", body: { action: "toggle", user_id: uid } });
  if (res.ok) { showAlert("✅ تم التحديث"); navigate("users"); }
}

async function resetPass(uid) {
  const np = prompt("كلمة المرور الجديدة:");
  if (!np) return;
  const res = await api("/api/users", { method: "POST", body: { action: "reset", user_id: uid, new_password: np } });
  if (res.ok) showAlert("✅ تم تغيير كلمة المرور");
}


async function deleteUser(uid, name) {
  if (!confirm(`⚠️ هل أنت متأكد من حذف المستخدم:\n«${name}»\n\nهذا الإجراء لا يمكن التراجع عنه!`)) {
    return;
  }
  // تأكيد ثانٍ للحماية
  if (!confirm(`تأكيد أخير:\nسيتم حذف «${name}» نهائياً.\n\nاضغط OK للمتابعة.`)) {
    return;
  }
  const res = await api("/api/users", { method: "POST", body: { action: "delete", user_id: uid } });
  if (res.ok) {
    showAlert("✅ تم حذف المستخدم");
    navigate("users");
  } else {
    showAlert(res.error || "خطأ في الحذف", "danger");
  }
}




async function clearAllData() {
  if (!confirm("⚠️ تحذير!\n\nسيتم حذف:\n• جميع فواتير المبيعات\n• جميع فواتير المشتريات\n• جميع المصروفات\n• جميع المنتجات\n• سجل النشاط\n\nلا يمكن التراجع عن هذا الإجراء!")) {
    return;
  }
  const input = prompt('اكتب كلمة "DELETE_ALL" لتأكيد الحذف:');
  if (input !== "DELETE_ALL") {
    showAlert("تم إلغاء العملية", "warning");
    return;
  }
  const res = await api("/api/admin/clear-data", {
    method: "POST",
    body: { confirm: "DELETE_ALL" }
  });
  if (res.ok) {
    showAlert("✅ تم حذف جميع العمليات بنجاح");
    navigate("users");
  } else {
    showAlert(res.error || "خطأ", "danger");
  }
}




// ============================================================
// التشغيل الأولي
// ============================================================
(async function init() {
  const storedToken = sessionStorage.getItem("token");
  const storedUser = sessionStorage.getItem("user");

  if (storedToken && storedUser) {
    TOKEN = storedToken;
    CURRENT_USER = JSON.parse(storedUser);
    try {
      const check = await api("/api/me");
      if (check.ok) {
        startApp();
        return;
      }
    } catch (e) {}
    sessionStorage.clear();
  }
  // عرض شاشة الدخول
  $("loginPage").classList.remove("hidden");
})();