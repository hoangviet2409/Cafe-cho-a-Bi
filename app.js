/* ============================================================
   CAFE POS – App.js
   Toàn bộ logic: Cart, Admin CRUD, Google Sheets, Checkout
   ============================================================ */

// ============================================================
// 1. CONFIG & STATE
// ============================================================
const APP = {
    scriptUrl: '',        // Google Apps Script URL
    apiKey: '',           // Optional API key shared with Apps Script
    adminPin: '',         // Kept only in memory for privileged actions
    demoMode: false,
    menuItems: [],        // Array<{id, name, price, status}>
    cartItems: [],        // Array<{id, name, price, quantity}>
    history: {
        orders: [],
        items: []
    },
    historyFilterDays: 1, // Default: 1 (Hôm nay), 7 (7 ngày), 0 (Tất cả)
    deleteTargetId: null,
    orderRowIndex: null,  // for GSheets row tracking
    resetCartOnReceiptClose: false,
    pendingCancelOrderId: null, // đơn đang chờ hủy sau khi xác thực PIN
};

const STORAGE_KEYS = {
    scriptUrl: 'cafe_pos_gsheet_url',
    apiKey: 'cafe_pos_api_key',
    menuCache: 'cafe_pos_menu_cache',
    menuCacheTs: 'cafe_pos_menu_ts',
    menuCacheUrl: 'cafe_pos_menu_url',
};

const WRITE_VERIFY_ATTEMPTS = 6;
const WRITE_VERIFY_DELAY_MS = 700;

// Demo menu data (khi không có Google Sheets)
const DEMO_MENU = [
    { id: 'M001', name: 'Cà Phê Đen', price: 25000, status: 'Active', emoji: '☕' },
    { id: 'M002', name: 'Cà Phê Sữa Đá', price: 35000, status: 'Active', emoji: '🧋' },
    { id: 'M003', name: 'Bạc Xỉu', price: 30000, status: 'Active', emoji: '🥛' },
    { id: 'M004', name: 'Trà Đào Cam Sả', price: 45000, status: 'Active', emoji: '🍑' },
    { id: 'M005', name: 'Nước Ép Cam', price: 40000, status: 'Active', emoji: '🍊' },
    { id: 'M006', name: 'Sinh Tố Bơ', price: 55000, status: 'Active', emoji: '🥑' },
    { id: 'M007', name: 'Trà Sữa Trân Châu', price: 50000, status: 'Active', emoji: '🧋' },
    { id: 'M008', name: 'Matcha Latte', price: 60000, status: 'Active', emoji: '🍵' },
    { id: 'M009', name: 'Lemon Soda', price: 35000, status: 'Active', emoji: '🍋' },
    { id: 'M010', name: 'Cà Phê Muối', price: 45000, status: 'Inactive', emoji: '🧂' },
];

// Emoji auto-assign
const EMOJIS = ['☕', '🧋', '🍑', '🍊', '🥑', '🍵', '🍋', '🍹', '🥤', '🫖', '🍫', '🧃'];
function getEmoji(name) {
    const n = name.toLowerCase();
    if (n.includes('cà phê') || n.includes('coffee')) return '☕';
    if (n.includes('trà sữa') || n.includes('bubble')) return '🧋';
    if (n.includes('trà đào') || n.includes('peach')) return '🍑';
    if (n.includes('cam') || n.includes('orange')) return '🍊';
    if (n.includes('bơ') || n.includes('avo')) return '🥑';
    if (n.includes('matcha') || n.includes('trà xanh')) return '🍵';
    if (n.includes('chanh') || n.includes('lemon')) return '🍋';
    if (n.includes('dâu') || n.includes('strawberry')) return '🍓';
    if (n.includes('xoài') || n.includes('mango')) return '🥭';
    if (n.includes('dừa') || n.includes('coco')) return '🥥';
    if (n.includes('nước ép') || n.includes('juice')) return '🍹';
    if (n.includes('sữa') || n.includes('milk')) return '🥛';
    return EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
}

// ============================================================
// 2. PAGE NAVIGATION
// ============================================================
let isAuthenticatedAdmin = false;
// LƯU Ý: PIN admin KHÔNG được hardcode ở đây nữa. Trước đây có 1 hằng số
// ADMIN_PIN = '1234' cố định trong file này — nếu bạn đổi ADMIN_PIN trong
// apps-script.js (theo hướng dẫn bảo mật) mà quên sửa luôn giá trị hardcode
// ở đây, mọi thao tác Admin (sửa/xóa món, hủy đơn) sẽ bị server từ chối dù
// bạn "đăng nhập" Admin thành công trên giao diện. Đây là lỗi rất hay gặp.
//
// Cách mới: PIN nhập ở đây chỉ là "cổng mềm" để mở giao diện Admin (tránh
// nhân viên bấm nhầm), còn PIN thật sự được server (apps-script.js) xác minh
// mỗi khi có thao tác ghi dữ liệu. Nhờ vậy chỉ có DUY NHẤT MỘT nơi lưu PIN
// thật — trong apps-script.js — không còn nguy cơ lệch nhau.
function openPinModal() {
    document.getElementById('pinInput').value = '';
    document.getElementById('pinModal').classList.add('active');
    setTimeout(() => document.getElementById('pinInput').focus(), 100);
}
function closePinModal() {
    document.getElementById('pinModal').classList.remove('active');
}
function verifyPin() {
    const val = document.getElementById('pinInput').value.trim();
    if (val.length < 4) {
        showToast('PIN phải có ít nhất 4 ký tự', 'error');
        document.getElementById('pinInput').value = '';
        document.getElementById('pinInput').focus();
        return;
    }
    APP.adminPin = val;
    isAuthenticatedAdmin = true;
    closePinModal();

    // Nếu người dùng bấm "Hủy" ở trang Lịch sử khi chưa xác thực, tiếp tục
    // hành động đó luôn sau khi nhập PIN, thay vì chuyển sang trang Admin.
    if (APP.pendingCancelOrderId) {
        const orderId = APP.pendingCancelOrderId;
        APP.pendingCancelOrderId = null;
        performCancelOrder(orderId);
        return;
    }

    showPage('admin', true);
    if (APP.demoMode) {
        showToast('Truy cập Admin thành công (Demo)', 'success');
    } else {
        showToast('Đã vào trang Admin — PIN sẽ được máy chủ kiểm tra khi bạn lưu thay đổi', 'info');
    }
}

function showPage(page, forceAdmin = false) {
    if (page === 'admin' && !isAuthenticatedAdmin && !forceAdmin) {
        openPinModal();
        return;
    }

    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

    if (page === 'pos') {
        document.getElementById('pagePOS').classList.add('active');
        document.getElementById('btnPOS').classList.add('active');
        const searchEl = document.getElementById('searchMenu');
        if (searchEl) searchEl.value = ''; // Force clear autofill
        renderMenuGrid(APP.menuItems);
    } else if (page === 'history') {
        document.getElementById('pageHistory').classList.add('active');
        document.getElementById('btnHistory').classList.add('active');
        loadHistoryFromSheets(); // Auto load when navigating
    } else {
        document.getElementById('pageAdmin').classList.add('active');
        document.getElementById('btnAdmin').classList.add('active');
        renderMenuTable();
    }
}

// ============================================================
// 3. SETUP & CONNECTION
// ============================================================
function startDemoMode() {
    APP.demoMode = true;
    APP.menuItems = DEMO_MENU.map(m => ({ ...m }));
    closeSetupModal();
    setStatusBadge('demo', '🎮 Demo');
    showToast('Đang chạy chế độ Demo với dữ liệu mẫu', 'info');
    renderMenuGrid(APP.menuItems);
    renderMenuTable();
}

function connectGSheets() {
    const url = document.getElementById('inputScriptUrl').value.trim();
    const apiKey = document.getElementById('inputApiKey')?.value.trim() || '';
    if (!url) { showToast('Vui lòng nhập Script URL', 'error'); return; }

    // Save URL to localStorage
    localStorage.setItem(STORAGE_KEYS.scriptUrl, url);
    localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);

    APP.scriptUrl = url;
    APP.apiKey = apiKey;
    APP.demoMode = false;
    closeSetupModal();
    setStatusBadge('online', '● Online');
    loadMenuFromSheets(true);
}

function openSetupModal() {
    document.getElementById('setupModal').classList.add('active');
}

function closeSetupModal() {
    document.getElementById('setupModal').classList.remove('active');
}

function setStatusBadge(type, text) {
    const el = document.getElementById('gsheetStatus');
    el.className = `status-badge status-${type}`;
    el.textContent = text;
}

// ============================================================
// 4. GOOGLE SHEETS API (via Apps Script Web App)
// ============================================================

/**
 * GsFetch:
 * - GET  → dùng cho đọc dữ liệu (getMenu) – không bị CORS preflight
 * - POST no-cors → dùng cho ghi dữ liệu – response opaque nhưng OK
 */
async function gsFetch(action, payload = {}) {
    if (APP.demoMode) return { success: true };
    try {
        if (action === 'getMenu' || action === 'getHistory' || action === 'getOrder') {
            // GET request: Apps Script trả về JSON qua doGet, không bị CORS
            const url = new URL(APP.scriptUrl);
            url.searchParams.set('action', action);
            if (APP.apiKey) url.searchParams.set('key', APP.apiKey);
            // Truyền days param cho getHistory
            if (action === 'getHistory' && payload.days !== undefined) {
                url.searchParams.set('days', payload.days);
            }
            if (action === 'getOrder' && payload.order_id) {
                url.searchParams.set('order_id', payload.order_id);
            }
            const res = await fetch(url.toString(), { method: 'GET' });
            const data = await res.json();
            if (data && data.success === false) {
                throw new Error(data.error || 'Google Sheets request failed');
            }
            return data;
        } else {
            const body = APP.apiKey
                ? { action, key: APP.apiKey, ...payload }
                : { action, ...payload };
            if (['appendMenuItem', 'updateMenuItem', 'deleteMenuItem', 'cancelOrder'].includes(action)) body.admin_pin = APP.adminPin;

            // POST no-cors: Apps Script nhận dữ liệu, sau đó app xác minh bằng GET.
            await fetch(APP.scriptUrl, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify(body),
            });
            return { success: true, pendingVerification: true };
        }
    } catch (e) {
        console.error('GSheets error:', e);
        throw e;
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Dịch lỗi kỹ thuật (từ fetch/Apps Script) thành thông báo có thể hành động được,
 * thay vì các toast chung chung như "Không thể kết nối" không nói rõ lý do.
 */
function friendlyErrorMessage(e) {
    const msg = (e && e.message) ? e.message : String(e || '');
    if (/Unauthorized admin action/i.test(msg)) {
        return 'Sai PIN Admin (không khớp ADMIN_PIN trong apps-script.js), hoặc ADMIN_PIN trên server chưa được cấu hình.';
    }
    if (/Unauthorized request/i.test(msg)) {
        return 'API Key không khớp với API_KEY trong apps-script.js. Kiểm tra lại ô "API Key" khi kết nối.';
    }
    if (/API_KEY has not been configured/i.test(msg)) {
        return 'Server chưa cấu hình API_KEY (vẫn còn giá trị REPLACE_...). Vào Apps Script sửa API_KEY rồi Deploy lại (New version).';
    }
    if (/Failed to fetch|NetworkError|TypeError: Load failed/i.test(msg)) {
        return 'Không gọi được URL Apps Script. Kiểm tra: URL đúng dạng .../exec, đã Deploy dạng Web App (Anyone có quyền truy cập), và có kết nối mạng.';
    }
    if (/Unexpected token|is not valid JSON/i.test(msg)) {
        return 'Apps Script trả về nội dung không phải JSON — thường do URL sai (không phải link /exec) hoặc quyền truy cập Deploy chưa đặt "Anyone".';
    }
    return msg || 'Lỗi không xác định';
}

function invalidateMenuCache() {
    localStorage.removeItem(STORAGE_KEYS.menuCache);
    localStorage.removeItem(STORAGE_KEYS.menuCacheTs);
    localStorage.removeItem(STORAGE_KEYS.menuCacheUrl);
}

function normalizeMenuRows(rows) {
    return rows.map(r => ({
        id: String(r[0]),
        name: String(r[1]),
        price: Number(r[2]),
        status: String(r[3]),
        emoji: getEmoji(String(r[1])),
    }));
}

function saveMenuCache() {
    localStorage.setItem(STORAGE_KEYS.menuCache, JSON.stringify(APP.menuItems));
    localStorage.setItem(STORAGE_KEYS.menuCacheTs, Date.now().toString());
    localStorage.setItem(STORAGE_KEYS.menuCacheUrl, APP.scriptUrl);
}

async function verifyMenuMutation(predicate, errorMessage) {
    for (let attempt = 0; attempt < WRITE_VERIFY_ATTEMPTS; attempt++) {
        const data = await gsFetch('getMenu');
        if (data && data.rows) {
            const nextItems = normalizeMenuRows(data.rows);
            if (predicate(nextItems)) {
                APP.menuItems = nextItems;
                saveMenuCache();
                renderMenuTable();
                renderMenuGrid(APP.menuItems);
                return true;
            }
        }
        await sleep(WRITE_VERIFY_DELAY_MS);
    }
    throw new Error(errorMessage);
}

async function verifyOrderWritten(orderId, expectedItems) {
    for (let attempt = 0; attempt < WRITE_VERIFY_ATTEMPTS; attempt++) {
        const data = await gsFetch('getOrder', { order_id: orderId });
        if (data && data.order && Array.isArray(data.items) && data.items.length === expectedItems.length
            && data.items.every((item, index) => Number(item[2]) === expectedItems[index].quantity
                && Number(item[3]) === expectedItems[index].unit_price && String(item[5]) === 'ACTIVE')) return data;
        await sleep(WRITE_VERIFY_DELAY_MS);
    }
    throw new Error('Không thể xác minh đơn đã ghi vào Google Sheets');
}

async function verifyOrderCancelled(orderId) {
    for (let attempt = 0; attempt < WRITE_VERIFY_ATTEMPTS; attempt++) {
        const data = await gsFetch('getOrder', { order_id: orderId });
        if (data && data.order && String(data.order[6]) === 'CANCELLED') return data;
        await sleep(WRITE_VERIFY_DELAY_MS);
    }
    throw new Error('Không thể xác minh đơn đã hủy trong Google Sheets');
}

async function loadMenuFromSheets(forceRefresh = false) {
    // Check localStorage cache (valid for 15 minutes)
    const CACHE_TTL = 15 * 60 * 1000; // 15 minutes

    if (!forceRefresh) {
        const cached = localStorage.getItem(STORAGE_KEYS.menuCache);
        const cachedUrl = localStorage.getItem(STORAGE_KEYS.menuCacheUrl);
        const ts = parseInt(localStorage.getItem(STORAGE_KEYS.menuCacheTs) || '0');
        if (cached && cachedUrl === APP.scriptUrl && (Date.now() - ts) < CACHE_TTL) {
            try {
                APP.menuItems = JSON.parse(cached);
                renderMenuGrid(APP.menuItems);
                renderMenuTable();
                showToast(`Thực đơn sẵn sàng (${APP.menuItems.length} món) ⚡`, 'success');
                return true;
            } catch {
                invalidateMenuCache();
            }
        }
    }

    try {
        showToast('Đang tải thực đơn...', 'info');
        const data = await gsFetch('getMenu');
        if (data && data.rows) {
            APP.menuItems = normalizeMenuRows(data.rows);
            // Save to cache
            saveMenuCache();
        }
        renderMenuGrid(APP.menuItems);
        renderMenuTable();
        showToast(`Đã tải ${APP.menuItems.length} món ✓`, 'success');
        if (APP.menuItems.length === 0) {
            showToast('Kết nối OK nhưng tab "Menu" đang trống — kiểm tra Google Sheet hoặc chạy setupDemoData()', 'info', 5000);
        }
        return true;
    } catch (e) {
        console.error('loadMenuFromSheets error:', e);
        showToast(`Không thể tải thực đơn: ${friendlyErrorMessage(e)}`, 'error', 6000);
        setStatusBadge('offline', '● Offline');
        return false;
    }
}

// ============================================================
// 5. MENU GRID (POS Page)
// ============================================================
function renderMenuGrid(items, filterText = '') {
    const grid = document.getElementById('menuGrid');
    const active = items.filter(i =>
        i.status === 'Active' &&
        (!filterText || i.name.toLowerCase().includes(filterText.toLowerCase()))
    );

    if (active.length === 0) {
        grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;color:var(--text-muted);padding:40px 0">
      <div style="font-size:2.5rem;opacity:.4">🔍</div>
      <p style="margin-top:10px">Không tìm thấy món nào</p>
    </div>`;
        return;
    }

    grid.innerHTML = active.map(item => `
    <div class="menu-card" data-menu-id="${escHtml(item.id)}" role="button" tabindex="0">
      <div class="menu-card-emoji">${item.emoji || getEmoji(item.name)}</div>
      <div class="menu-card-name">${escHtml(item.name)}</div>
      <div class="menu-card-price">${formatCurrency(item.price)}</div>
      <button class="menu-card-add" data-add-to-cart="${escHtml(item.id)}">
        + Thêm vào Bill
      </button>
    </div>
  `).join('');
}

function filterMenu(val) {
    renderMenuGrid(APP.menuItems, val);
}

function addToCartById(id) {
    const item = APP.menuItems.find(i => i.id === id);
    if (!item) return;
    addToCart(item.id, item.name, item.price);
}

// ============================================================
// 6. CART LOGIC  (core snippets as required by spec)
// ============================================================

/**
 * Thêm món vào giỏ hàng.
 * - Nếu đã tồn tại → tăng quantity +1
 * - Nếu chưa có → thêm Object mới với quantity = 1
 */
function addToCart(id, name, price) {
    const existing = APP.cartItems.find(i => i.id === id);
    if (existing) {
        existing.quantity += 1;
    } else {
        APP.cartItems.push({ id, name, price, quantity: 1 });
    }
    renderCart();
    updateCalc();
    // Micro-feedback: pulse card
    pulseCartBadge();
}

/**
 * Tăng số lượng món trong giỏ
 */
function increaseQty(id) {
    const item = APP.cartItems.find(i => i.id === id);
    if (item) item.quantity += 1;
    renderCart();
    updateCalc();
}

/**
 * Giảm số lượng món – nếu qty = 1 thì xóa khỏi giỏ
 */
function decreaseQty(id) {
    const idx = APP.cartItems.findIndex(i => i.id === id);
    if (idx === -1) return;
    if (APP.cartItems[idx].quantity > 1) {
        APP.cartItems[idx].quantity -= 1;
    } else {
        APP.cartItems.splice(idx, 1);
    }
    renderCart();
    updateCalc();
}

/**
 * Xóa hẳn một món khỏi giỏ
 */
function removeFromCart(id) {
    APP.cartItems = APP.cartItems.filter(i => i.id !== id);
    renderCart();
    updateCalc();
}

function renderCart() {
    const cartList = document.getElementById('cartList');
    const cartCount = document.getElementById('cartCount');
    const totalItems = APP.cartItems.reduce((s, i) => s + i.quantity, 0);
    cartCount.textContent = `${totalItems} món`;

    if (APP.cartItems.length === 0) {
        cartList.innerHTML = `
      <div class="cart-empty">
        <span>🛒</span>
        <p>Giỏ hàng trống<br/><small>Nhấn vào món để thêm</small></p>
      </div>`;
        document.getElementById('btnCheckout').disabled = true;
        return;
    }

    cartList.innerHTML = APP.cartItems.map(item => `
    <div class="cart-item" id="cart-${escHtml(item.id)}">
      <span class="cart-item-name" title="${escHtml(item.name)}">${escHtml(item.name)}</span>
      <div class="cart-item-controls">
        <button class="qty-btn minus" data-cart-action="decrease" data-cart-id="${escHtml(item.id)}" title="Giảm">−</button>
        <span class="qty-num">${item.quantity}</span>
        <button class="qty-btn" data-cart-action="increase" data-cart-id="${escHtml(item.id)}" title="Tăng">+</button>
      </div>
      <span class="cart-item-price">${formatCurrency(item.price * item.quantity)}</span>
    </div>
  `).join('');

    document.getElementById('btnCheckout').disabled = false;
}

function pulseCartBadge() {
    const badge = document.getElementById('cartCount');
    badge.style.transform = 'scale(1.25)';
    setTimeout(() => badge.style.transform = '', 200);
}

// ============================================================
// 7. CALCULATION FORMULAS
// ============================================================

/**
 * Tạm tính (Subtotal) = Σ (quantity × price) với mỗi item trong cart_items
 */
function calcSubtotal() {
    return APP.cartItems.reduce((sum, item) => sum + item.quantity * item.price, 0);
}

/**
 * Tiền thuế (Tax Amount) = Subtotal × (VAT% / 100)
 */
function calcTax(subtotal, vatPercent) {
    return subtotal * (vatPercent / 100);
}

/**
 * Tổng cộng (Grand Total) = Subtotal + Tax Amount
 */
function calcGrandTotal(subtotal, tax) {
    return subtotal + tax;
}

function updateCalc() {
    const vatPercent = Number(document.getElementById('vatSelect').value);
    const subtotal = calcSubtotal();
    const tax = calcTax(subtotal, vatPercent);
    const grand = calcGrandTotal(subtotal, tax);

    document.getElementById('subtotalDisplay').textContent = formatCurrency(subtotal);
    document.getElementById('taxDisplay').textContent = formatCurrency(tax);
    document.getElementById('grandTotalDisplay').textContent = formatCurrency(grand);
}

// ============================================================
// 8. CHECKOUT ACTION FLOW  (ghi tuần tự vào 2 tab Google Sheets)
// ============================================================
async function checkout() {
    if (APP.cartItems.length === 0) { showToast('Giỏ hàng đang trống!', 'error'); return; }

    const btn = document.getElementById('btnCheckout');
    btn.disabled = true;
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin 0.8s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Đang xử lý...`;

    try {
        // BƯỚC 1: Khởi tạo order_id
        const orderId = generateOrderId();
        const now = new Date().toISOString();

        const vatPercent = Number(document.getElementById('vatSelect').value);
        const subtotal = calcSubtotal();
        const taxAmount = calcTax(subtotal, vatPercent);
        const grandTotal = calcGrandTotal(subtotal, taxAmount);

        // BƯỚC 2: Bulk Insert Order & Items
        if (!APP.demoMode) {
            const orderRow = {
                order_id: orderId,
                timestamp: now,
                sub_total: subtotal,
                tax_percent: vatPercent,
                tax_amount: taxAmount,
                grand_total: grandTotal,
            };

            const itemRows = APP.cartItems.map(item => ({
                order_id: orderId,
                menu_id: item.id,
                item_name: item.name,
                quantity: item.quantity,
                unit_price: item.price,
                line_total: item.quantity * item.price,
            }));

            const r2 = await gsFetch('checkoutOrder', {
                orderRow: orderRow,
                itemRows: itemRows
            });

            if (!r2.success) throw new Error(r2.error || 'Lỗi ghi dữ liệu thanh toán');
            await verifyOrderWritten(orderId, itemRows);
        }

        // BƯỚC 4: Preview Hóa Đơn & Print
        buildReceipt(orderId, now, subtotal, vatPercent, taxAmount, grandTotal);
        APP.resetCartOnReceiptClose = true;
        document.getElementById('receiptModal').classList.add('active');

        // Reset btn trạng thái (việc reset giỏ hàng sẽ làm khi đóng hóa đơn)
        btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> XUẤT HÓA ĐƠN`;
        btn.disabled = true;

    } catch (err) {
        console.error('Checkout error:', err);
        showToast(`❌ Lỗi: ${friendlyErrorMessage(err)}`, 'error', 6000);
        btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> XUẤT HÓA ĐƠN`;
        btn.disabled = false;
    }
}

// ============================================================
// 9. ADMIN – MENU CRUD
// ============================================================
function renderMenuTable() {
    const tbody = document.getElementById('menuTableBody');
    const items = APP.menuItems;

    // Update summary cards
    document.getElementById('totalItems').textContent = items.length;
    document.getElementById('activeItems').textContent = items.filter(i => i.status === 'Active').length;
    document.getElementById('inactiveItems').textContent = items.filter(i => i.status === 'Inactive').length;

    if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:32px">
      Chưa có món nào. Nhấn "Thêm món mới" để bắt đầu.
    </td></tr>`;
        return;
    }

    tbody.innerHTML = items.map(item => `
    <tr>
      <td style="color:var(--text-muted);font-size:0.78rem;font-family:monospace">${escHtml(item.id)}</td>
      <td style="font-weight:600">${item.emoji || getEmoji(item.name)} ${escHtml(item.name)}</td>
      <td style="color:var(--accent);font-weight:700">${formatCurrency(item.price)}</td>
      <td>
        <span class="badge badge-${item.status === 'Active' ? 'active' : 'inactive'}">
          ${item.status === 'Active' ? '✅ Active' : '⏸️ Inactive'}
        </span>
      </td>
      <td>
        <div class="table-actions">
          <button class="action-btn action-btn-edit" data-menu-action="edit" data-menu-id="${escHtml(item.id)}">✏️ Sửa</button>
          <button class="action-btn action-btn-del" data-menu-action="delete" data-menu-id="${escHtml(item.id)}">🗑️ Xóa</button>
        </div>
      </td>
    </tr>
  `).join('');
}

// ---- Add New Item ----
function openAddModal() {
    document.getElementById('itemModalTitle').textContent = '➕ Thêm món mới';
    document.getElementById('editItemId').value = '';
    document.getElementById('inputItemName').value = '';
    document.getElementById('inputItemPrice').value = '';
    document.getElementById('inputItemStatus').value = 'Active';
    document.getElementById('itemModal').classList.add('active');
}

// ---- Edit Item ----
function openEditModal(id) {
    const item = APP.menuItems.find(i => i.id === id);
    if (!item) return;
    document.getElementById('itemModalTitle').textContent = '✏️ Chỉnh sửa món';
    document.getElementById('editItemId').value = id;
    document.getElementById('inputItemName').value = item.name;
    document.getElementById('inputItemPrice').value = item.price;
    document.getElementById('inputItemStatus').value = item.status;
    document.getElementById('itemModal').classList.add('active');
}

function closeItemModal() {
    document.getElementById('itemModal').classList.remove('active');
}

async function saveItem() {
    const name = document.getElementById('inputItemName').value.trim();
    const price = Number(document.getElementById('inputItemPrice').value);
    const status = document.getElementById('inputItemStatus').value;
    const editId = document.getElementById('editItemId').value;

    if (!name) { showToast('Vui lòng nhập tên món', 'error'); return; }
    if (!price || price <= 0) { showToast('Giá tiền không hợp lệ', 'error'); return; }

    if (editId) {
        // UPDATE
        const item = APP.menuItems.find(i => i.id === editId);
        if (!item) return;
        if (!APP.demoMode) {
            try {
                await gsFetch('updateMenuItem', { id: editId, name, price, status });
                await verifyMenuMutation(
                    items => items.some(i => i.id === editId && i.name === name && i.price === price && i.status === status),
                    'Không thể xác minh món đã được cập nhật'
                );
            } catch (err) { showToast(`Lưu thất bại: ${friendlyErrorMessage(err)}`, 'error', 6000); return; }
        } else {
            item.name = name; item.price = price; item.status = status; item.emoji = getEmoji(name);
        }
        showToast('Đã cập nhật món ✓', 'success');
    } else {
        // CREATE
        const newId = 'M' + Date.now();
        const newItem = { id: newId, name, price, status, emoji: getEmoji(name) };
        if (!APP.demoMode) {
            try {
                await gsFetch('appendMenuItem', { row: { id: newId, name, price, status } });
                await verifyMenuMutation(
                    items => items.some(i => i.id === newId && i.name === name && i.price === price && i.status === status),
                    'Không thể xác minh món mới trong Google Sheets'
                );
            } catch (err) { showToast(`Thêm món thất bại: ${friendlyErrorMessage(err)}`, 'error', 6000); return; }
        } else {
            APP.menuItems.push(newItem);
        }
        showToast('Đã thêm món mới ✓', 'success');
    }

    closeItemModal();
    if (APP.demoMode) {
        renderMenuTable();
        renderMenuGrid(APP.menuItems);
    }
}

// ---- Delete ----
function openDeleteModal(id, name) {
    const itemName = name || APP.menuItems.find(i => i.id === id)?.name || '';
    APP.deleteTargetId = id;
    document.getElementById('deleteModalMsg').textContent =
        `Bạn có chắc muốn xóa món "${itemName}"? Hành động này không thể hoàn tác.`;
    document.getElementById('deleteModal').classList.add('active');
}

function closeDeleteModal() {
    document.getElementById('deleteModal').classList.remove('active');
    APP.deleteTargetId = null;
}

async function confirmDelete() {
    const id = APP.deleteTargetId;
    if (!id) return;
    const item = APP.menuItems.find(i => i.id === id);

    if (!APP.demoMode) {
        try {
            await gsFetch('updateMenuItem', { id, name: item.name, price: item.price, status: 'Inactive' });
            await verifyMenuMutation(
                items => items.some(i => i.id === id && i.status === 'Inactive'),
                'Không thể xác minh món đã được xóa'
            );
        } catch (err) { showToast(`Xóa thất bại: ${friendlyErrorMessage(err)}`, 'error', 6000); return; }
    } else {
        APP.menuItems = APP.menuItems.filter(i => i.id !== id);
    }
    showToast(`Đã xóa "${item?.name || ''}" ✓`, 'success');
    closeDeleteModal();
    if (APP.demoMode) {
        renderMenuTable();
        renderMenuGrid(APP.menuItems);
    }
}

// ============================================================
// 10. UTILITY FUNCTIONS
// ============================================================

/** Tạo order_id dạng: ORD-20250803-A3F9 */
function generateOrderId() {
    const d = new Date();
    const date = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
    const rand = Math.random().toString(36).toUpperCase().slice(2, 6);
    return `ORD-${date}-${rand}`;
}

/** Format số thành chuỗi tiền VNĐ */
function formatCurrency(amount) {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

/** Escape HTML để tránh XSS */
function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Toast notification */
let _toastTimer;
function showToast(msg, type = 'info', duration = 2800) {
    const toast = document.getElementById('toast');
    clearTimeout(_toastTimer);
    toast.textContent = msg;
    toast.className = `toast ${type} show`;
    _toastTimer = setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}

function handleDynamicClick(e) {
    const addButton = e.target.closest('[data-add-to-cart]');
    if (addButton) {
        e.stopPropagation();
        addToCartById(addButton.dataset.addToCart);
        return;
    }

    const menuCard = e.target.closest('.menu-card[data-menu-id]');
    if (menuCard) {
        addToCartById(menuCard.dataset.menuId);
        return;
    }

    const cartButton = e.target.closest('[data-cart-action]');
    if (cartButton) {
        const id = cartButton.dataset.cartId;
        if (cartButton.dataset.cartAction === 'increase') increaseQty(id);
        if (cartButton.dataset.cartAction === 'decrease') decreaseQty(id);
        return;
    }

    const menuButton = e.target.closest('[data-menu-action]');
    if (menuButton) {
        const id = menuButton.dataset.menuId;
        if (menuButton.dataset.menuAction === 'edit') openEditModal(id);
        if (menuButton.dataset.menuAction === 'delete') openDeleteModal(id);
        return;
    }

    const historyButton = e.target.closest('[data-history-action]');
    if (historyButton) {
        const orderId = historyButton.dataset.orderId;
        if (historyButton.dataset.historyAction === 'reprint') reprintOrder(orderId);
        if (historyButton.dataset.historyAction === 'cancel') cancelOrderUI(orderId);
    }
}

function handleDynamicKeydown(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const menuCard = e.target.closest('.menu-card[data-menu-id]');
    if (!menuCard) return;
    e.preventDefault();
    addToCartById(menuCard.dataset.menuId);
}

// ============================================================
// 11. INIT (entrypoint)
// ============================================================
document.addEventListener('DOMContentLoaded', () => {
    // Show setup modal on load
    document.getElementById('setupModal').classList.add('active');

    // Allow closing modals by clicking backdrop
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        overlay.addEventListener('click', e => {
            if (e.target === overlay && overlay.id !== 'setupModal') {
                overlay.classList.remove('active');
            }
        });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            document.getElementById('itemModal').classList.remove('active');
            document.getElementById('deleteModal').classList.remove('active');
        }
    });
    document.addEventListener('click', handleDynamicClick);
    document.addEventListener('keydown', handleDynamicKeydown);

    // Add CSS spin animation for loading state
    const spinStyle = document.createElement('style');
    spinStyle.textContent = `@keyframes spin { to { transform: rotate(360deg); } }`;
    document.head.appendChild(spinStyle);
});

// Dang ky Service Worker cho PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').catch(err => {
            console.log('SW registration failed: ', err);
        });
    });
}

// Lắng nghe phím Enter trong Pin Modal
document.getElementById('pinInput')?.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') verifyPin();
});

// Kiểm tra Local Storage xem có Script URL nào đã lưu chưa
window.addEventListener('DOMContentLoaded', () => {
    const savedUrl = localStorage.getItem(STORAGE_KEYS.scriptUrl);
    const savedApiKey = localStorage.getItem(STORAGE_KEYS.apiKey) || '';
    const apiKeyInput = document.getElementById('inputApiKey');
    if (apiKeyInput) apiKeyInput.value = savedApiKey;
    if (savedUrl) {
        document.getElementById('inputScriptUrl').value = savedUrl;
        connectGSheets(); // Tự động kết nối nếu đã lưu
    }
});

// ============================================================
// 12. RECEIPT LOGIC
// ============================================================

function buildReceipt(orderId, timestamp, subtotal, vatPercent, taxAmount, grandTotal) {
    document.getElementById('rOrderId').textContent = orderId;
    const dateObj = new Date(timestamp);
    const dateStr = dateObj.toLocaleDateString('vi-VN') + ' ' + dateObj.toLocaleTimeString('vi-VN');
    document.getElementById('rTime').textContent = dateStr;

    document.getElementById('rSubtotal').textContent = formatCurrency(subtotal);

    const vatRow = document.getElementById('rVatRow');
    if (vatPercent > 0) {
        document.getElementById('rVatLabel').textContent = `VAT (${vatPercent}%)`;
        document.getElementById('rTax').textContent = formatCurrency(taxAmount);
        vatRow.style.display = 'flex';
    } else {
        vatRow.style.display = 'none';
    }

    document.getElementById('rGrand').textContent = formatCurrency(grandTotal);

    // Build items
    const rItems = document.getElementById('rItems');
    rItems.innerHTML = APP.cartItems.map(item => `
        <div class="receipt-item-row">
            <div class="receipt-item-name">
                <div>${escHtml(item.name)}</div>
                <div style="font-size: 0.75rem">${item.quantity} x ${formatCurrency(item.price)}</div>
            </div>
            <div class="receipt-item-price">${formatCurrency(item.quantity * item.price)}</div>
        </div>
    `).join('');
}

function closeReceipt() {
    document.getElementById('receiptModal').classList.remove('active');
    if (APP.resetCartOnReceiptClose) {
        APP.cartItems = [];
        document.getElementById('vatSelect').value = '0';
        renderCart();
        updateCalc();
        showToast('Đã đóng hóa đơn & sẵn sàng đơn mới', 'info');
    }
    APP.resetCartOnReceiptClose = false;
}

function printReceipt() {
    window.print();
}

// ============================================================
// 13. HISTORY PAGE LOGIC
// ============================================================
function changeHistoryFilter(days) {
    if (APP.historyFilterDays === days) return;
    APP.historyFilterDays = days;

    // Update active button state
    document.getElementById('btnFilter1').classList.remove('active');
    document.getElementById('btnFilter7').classList.remove('active');
    document.getElementById('btnFilter0').classList.remove('active');
    document.getElementById(`btnFilter${days}`).classList.add('active');

    loadHistoryFromSheets();
}

async function loadHistoryFromSheets() {
    if (APP.demoMode) {
        showToast('Chế độ Demo: Không có dữ liệu lịch sử.', 'info');
        renderHistoryTable();
        return;
    }

    let btn;
    let oldHtml;
    try {
        btn = document.querySelector('#pageHistory .btn-primary');
        oldHtml = btn.innerHTML;
        btn.innerHTML = 'Đang tải...';
        btn.disabled = true;

        const data = await gsFetch('getHistory', { days: APP.historyFilterDays });
        if (data && data.success) {
            APP.history.orders = data.orders.map(o => ({
                order_id: String(o[0]), timestamp: String(o[1]), sub_total: Number(o[2]),
                tax_percent: Number(o[3]), tax_amount: Number(o[4]), grand_total: Number(o[5]),
                status: o[6] ? String(o[6]) : 'ACTIVE' // cột status mới
            }));
            APP.history.items = data.items.map(i => ({
                order_id: String(i[0]), item_name: String(i[1]), quantity: Number(i[2]),
                unit_price: Number(i[3]), line_total: Number(i[4])
            }));
            showToast('Đã tải lịch sử ✓', 'success');
        }

        renderHistoryTable();
    } catch (e) {
        showToast('Không thể tải lịch sử', 'error');
    } finally {
        if (btn) {
            btn.innerHTML = oldHtml;
            btn.disabled = false;
        }
    }
}

function renderHistoryTable() {
    const tbody = document.getElementById('historyTableBody');
    const orders = APP.history.orders;

    // Sort by timestamp descending
    orders.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Summary follows the selected history range and excludes cancelled orders.
    let totalRevenue = 0;
    let totalOrdersCount = 0;

    orders.forEach(o => {
        if (o.status !== 'CANCELLED') {
            totalRevenue += o.grand_total;
            totalOrdersCount++;
        }
    });

    document.getElementById('historyTotalRevenue').textContent = formatCurrency(totalRevenue);
    document.getElementById('historyTotalOrders').textContent = totalOrdersCount;

    if (orders.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:32px">
            Chưa có hóa đơn nào được lưu.
        </td></tr>`;
        return;
    }

    tbody.innerHTML = orders.map(o => {
        const d = new Date(o.timestamp);
        const dateStr = d.toLocaleDateString('vi-VN') + ' ' + d.toLocaleTimeString('vi-VN');
        const isCancelled = o.status === 'CANCELLED';
        const rowStyle = isCancelled ? 'opacity:0.5;' : '';
        const priceStyle = isCancelled
            ? 'text-decoration:line-through;color:var(--red);'
            : 'color:var(--accent);font-weight:700;';
        const actionBtns = isCancelled
            ? `<span style="color:var(--red);font-size:0.78rem;font-weight:600;">✕ Đã hủy</span>`
            : `<button class="action-btn" data-history-action="reprint" data-order-id="${escHtml(o.order_id)}">🖨️ In lại</button>
               <button class="action-btn" style="margin-left:6px;color:var(--red);border-color:rgba(239,68,68,0.4);" data-history-action="cancel" data-order-id="${escHtml(o.order_id)}">✕ Hủy</button>`;
        return `
            <tr style="${rowStyle}">
              <td style="color:var(--text-muted);font-size:0.78rem;font-family:monospace;font-weight:bold">${escHtml(o.order_id)}</td>
              <td style="font-size:0.85rem">${dateStr}</td>
              <td style="${priceStyle}">${formatCurrency(o.grand_total)}</td>
              <td>${actionBtns}</td>
            </tr>
        `;
    }).join('');
}

async function cancelOrderUI(orderId) {
    // Trước đây nút này gửi thẳng admin_pin rỗng lên server nếu bạn chưa từng
    // vào trang Admin nhập PIN trong phiên làm việc — server từ chối âm thầm,
    // và người dùng chỉ thấy lỗi "Không thể xác minh..." sau ~4 giây chờ, không
    // rõ lý do thật là do chưa nhập PIN. Giờ bắt nhập PIN ngay tại đây trước.
    if (!APP.demoMode && !isAuthenticatedAdmin) {
        APP.pendingCancelOrderId = orderId;
        openPinModal();
        return;
    }
    await performCancelOrder(orderId);
}

async function performCancelOrder(orderId) {
    if (!confirm(`Bạn có chắc muốn HỦY đơn ${orderId}?\nĐơn hàng sẽ bị ghi chú là CANCELLED trong Google Sheets và không tính vào doanh thu.`)) return;

    try {
        if (!APP.demoMode) {
            await gsFetch('cancelOrder', { order_id: orderId });
            await verifyOrderCancelled(orderId);
        }
        // Update local state
        const order = APP.history.orders.find(o => o.order_id === orderId);
        if (order) order.status = 'CANCELLED';
        renderHistoryTable();
        showToast(`Đã hủy đơn ${orderId}`, 'info');
    } catch (e) {
        showToast(`Không thể hủy đơn: ${friendlyErrorMessage(e)}`, 'error', 6000);
    }
}

function reprintOrder(orderId) {
    const order = APP.history.orders.find(o => o.order_id === orderId);
    if (!order) return showToast('Không tìm thấy hóa đơn', 'error');

    const items = APP.history.items.filter(i => i.order_id === orderId);

    // Tạm thời thay thế APP.cartItems để dùng chung hàm buildReceipt
    const originalCart = [...APP.cartItems];
    APP.cartItems = items.map(i => ({
        name: i.item_name,
        quantity: i.quantity,
        price: i.unit_price
    }));

    buildReceipt(orderId, order.timestamp, order.sub_total, order.tax_percent, order.tax_amount, order.grand_total);

    // Phục hồi giỏ hàng hiện tại
    APP.cartItems = originalCart;
    APP.resetCartOnReceiptClose = false;
    document.getElementById('btnConfirmCheckout').hidden = true;
    document.getElementById('btnPrintReceipt').hidden = false;
    document.getElementById('receiptModal').classList.add('active');
}
function previewCheckout(){if(!APP.cartItems.length)return showToast('Cart is empty','error');const v=Number(document.getElementById('vatSelect').value),s=calcSubtotal(),t=calcTax(s,v);APP.pendingCheckout={orderId:generateOrderId(),timestamp:new Date().toISOString(),vatPercent:v,subtotal:s,taxAmount:t,grandTotal:calcGrandTotal(s,t)};buildReceipt(APP.pendingCheckout.orderId,APP.pendingCheckout.timestamp,s,v,t,APP.pendingCheckout.grandTotal);document.getElementById('btnConfirmCheckout').hidden=false;document.getElementById('btnPrintReceipt').hidden=true;document.getElementById('receiptModal').classList.add('active')}

async function confirmCheckout(){const p=APP.pendingCheckout;if(!p)return;const b=document.getElementById('btnConfirmCheckout');b.disabled=true;b.textContent='Đang lưu...';APP.pendingCheckout=null;await checkout();if(APP.resetCartOnReceiptClose){b.hidden=true;document.getElementById('btnPrintReceipt').hidden=false}else{APP.pendingCheckout=p;b.disabled=false;b.textContent='Xác nhận thanh toán';showToast('Lưu đơn thất bại','error')}}