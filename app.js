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
        items: [],
        meta: [],
        cancellations: {}
    },
    historyFilterDays: 1, // Default: 1 (Hôm nay), 7 (7 ngày), 0 (Tất cả)
    historySearchQuery: '',
    selectedHistoryOrderIds: new Set(),
    historyDetailOrderId: '',
    pendingCancellationOrderIds: [],
    menuCategory: 'all',
    adminFilterStatus: 'all',
    deleteTargetId: null,
    orderRowIndex: null,  // for GSheets row tracking
    resetCartOnReceiptClose: false,
    pendingCancelOrderId: null, // đơn đang chờ hủy sau khi xác thực PIN
    pendingCheckout: null,
    operational: {
        tables: [],
        drafts: [],
        customers: [],
        inventory: [],
        staff: [],
        currentShift: null,
    },
    orderContext: {
        orderType: 'TAKEAWAY',
        tableId: '',
        customerName: 'Khách lẻ',
        customerPhone: '',
        note: '',
        paymentMethod: 'CASH',
        cashReceived: 0,
        staffName: '',
    },
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

function createOperationId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

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
    if (['admin', 'operations'].includes(page) && !isAuthenticatedAdmin && !forceAdmin) {
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
    } else if (page === 'operations') {
        document.getElementById('pageOperations').classList.add('active');
        document.getElementById('btnOperations').classList.add('active');
        loadOperationalData();
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
    renderCategoryFilters();
    renderMenuGrid(APP.menuItems);
    renderMenuTable();
    loadOperationalData();
}

function connectGSheets() {
    const url = document.getElementById('inputScriptUrl').value.trim();
    const apiKey = document.getElementById('inputApiKey')?.value.trim() || '';
    if (!url) { showToast('Vui lòng nhập Script URL', 'error'); return; }
    if (!apiKey) { showToast('Vui lòng nhập API Key', 'error'); return; }
    try {
        const parsedUrl = new URL(url);
        if (!/^https?:$/.test(parsedUrl.protocol)) throw new Error('Invalid protocol');
    } catch {
        showToast('Script URL không hợp lệ', 'error');
        return;
    }

    // Chỉ lưu URL; API Key giữ trong memory để không lưu plaintext lâu dài.
    localStorage.setItem(STORAGE_KEYS.scriptUrl, url);
    localStorage.removeItem(STORAGE_KEYS.apiKey);

    APP.scriptUrl = url;
    APP.apiKey = apiKey;
    APP.demoMode = false;
    closeSetupModal();
    setStatusBadge('online', '● Online');
    loadMenuFromSheets(true);
    loadOperationalData();
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

function makeDemoOperations() {
    if (APP.operational.tables.length) return;
    APP.operational.tables = Array.from({ length: 8 }, (_, index) => ({
        table_id: `T${index + 1}`, name: `Bàn ${index + 1}`, status: 'AVAILABLE'
    }));
    APP.operational.staff = [{ staff_id: 'S1', name: 'Thu ngân', role: 'Cashier', status: 'ACTIVE' }];
    APP.operational.inventory = [
        { item_id: 'I1', name: 'Hạt cà phê', unit: 'kg', quantity: 3, low_stock_threshold: 1 },
        { item_id: 'I2', name: 'Sữa tươi', unit: 'hộp', quantity: 8, low_stock_threshold: 4 }
    ];
}

function applyOperationalData(data) {
    APP.operational.tables = (data.tables || []).map(row => ({ table_id: String(row[0]), name: String(row[1]), status: String(row[2] || 'AVAILABLE') }));
    APP.operational.drafts = (data.drafts || []).map(row => ({
        draft_id: String(row[0]), created_at: String(row[1]), order_type: String(row[3] || 'TAKEAWAY'),
        table_id: String(row[4] || ''), customer_name: String(row[5] || 'Khách lẻ'), customer_phone: String(row[6] || ''),
        note: String(row[7] || ''), vat_percent: Number(row[8] || 0), items: JSON.parse(row[9] || '[]')
    }));
    APP.operational.customers = (data.customers || []).map(row => ({ customer_id: String(row[0]), name: String(row[1]), phone: String(row[2] || '') }));
    APP.operational.inventory = (data.inventory || []).map(row => ({ item_id: String(row[0]), name: String(row[1]), unit: String(row[2]), quantity: Number(row[3]), low_stock_threshold: Number(row[4]) }));
    APP.operational.staff = (data.staff || []).map(row => ({ staff_id: String(row[0]), name: String(row[1]), role: String(row[2]), status: String(row[3]) }));
    APP.operational.currentShift = data.currentShift ? {
        shift_id: String(data.currentShift[0]), opened_at: String(data.currentShift[1]), opening_cash: Number(data.currentShift[3]), staff_name: String(data.currentShift[6] || '')
    } : null;
    renderOperationalControls();
    renderOperationsDashboard();
}

async function loadOperationalData() {
    if (APP.demoMode) {
        makeDemoOperations();
        renderOperationalControls();
        return;
    }
    try {
        const data = await gsFetch('getOperations');
        applyOperationalData(data || {});
    } catch (error) {
        console.warn('Could not load operational data', error);
        showToast('Không thể tải bàn, ca làm và đơn tạm', 'info');
    }
}

function renderOperationalControls() {
    const tableSelect = document.getElementById('tableSelect');
    if (!tableSelect) return;
    const current = APP.orderContext.tableId;
    tableSelect.innerHTML = '<option value="">Chọn bàn</option>' + APP.operational.tables
        .filter(table => table.status !== 'INACTIVE')
        .map(table => `<option value="${escHtml(table.table_id)}">${escHtml(table.name)}${table.status === 'OCCUPIED' ? ' · đang dùng' : ''}</option>`).join('');
    tableSelect.value = current;
    updateOrderContextFields();
}

function renderOperationsDashboard() {
    const board = document.getElementById('tableBoard');
    if (!board) return;
    board.innerHTML = APP.operational.tables.length ? APP.operational.tables.map(table => `
        <div class="table-tile ${String(table.status).toLowerCase()}"><strong>${escHtml(table.name)}</strong><small>${table.status === 'OCCUPIED' ? 'Đang phục vụ' : 'Sẵn sàng'}</small></div>`).join('') : '<span class="summary-label">Chưa có bàn. Thêm dữ liệu trong tab Tables.</span>';
    const shift = document.getElementById('operationsShiftSummary');
    if (shift) shift.textContent = APP.operational.currentShift
        ? `${APP.operational.currentShift.staff_name || 'Chưa ghi tên'} · mở từ ${new Date(APP.operational.currentShift.opened_at).toLocaleTimeString('vi-VN')}`
        : 'Chưa mở ca';
    const lowStock = APP.operational.inventory.filter(item => item.quantity <= item.low_stock_threshold);
    const lowStockList = document.getElementById('lowStockList');
    if (lowStockList) lowStockList.innerHTML = lowStock.length
        ? lowStock.map(item => `<div>${escHtml(item.name)}<span>${item.quantity} ${escHtml(item.unit)}</span></div>`).join('')
        : '<span class="summary-label">Tồn kho đang ổn</span>';
    const customers = document.getElementById('customerList');
    if (customers) customers.innerHTML = APP.operational.customers.length
        ? APP.operational.customers.slice(-5).reverse().map(customer => `<div>${escHtml(customer.name)}<span>${escHtml(customer.phone || 'Chưa có SĐT')}</span></div>`).join('')
        : '<span class="summary-label">Chưa có khách hàng</span>';
    const staff = document.getElementById('staffList');
    if (staff) staff.innerHTML = APP.operational.staff.length
        ? APP.operational.staff.map(person => `<div>${escHtml(person.name)}<span>${escHtml(person.role)}</span></div>`).join('')
        : '<span class="summary-label">Chưa có nhân viên</span>';
}

function updateOrderContextFields() {
    const type = APP.orderContext.orderType;
    const tableSelect = document.getElementById('tableSelect');
    const takeaway = document.getElementById('btnTakeaway');
    const dineIn = document.getElementById('btnDineIn');
    if (tableSelect) tableSelect.hidden = type !== 'DINE_IN';
    takeaway?.classList.toggle('active', type === 'TAKEAWAY');
    dineIn?.classList.toggle('active', type === 'DINE_IN');
    const customerName = document.getElementById('customerName');
    const customerPhone = document.getElementById('customerPhone');
    const note = document.getElementById('orderNote');
    if (customerName) customerName.value = APP.orderContext.customerName === 'Khách lẻ' ? '' : APP.orderContext.customerName;
    if (customerPhone) customerPhone.value = APP.orderContext.customerPhone;
    if (note) note.value = APP.orderContext.note;
    const payment = document.getElementById('paymentMethod');
    if (payment) payment.value = APP.orderContext.paymentMethod;
    updateCashChange();
}

function setOrderType(type) {
    APP.orderContext.orderType = type;
    if (type === 'TAKEAWAY') APP.orderContext.tableId = '';
    renderOperationalControls();
}

function setOrderTable(tableId) { APP.orderContext.tableId = tableId; }

function updateOrderContext() {
    APP.orderContext.customerName = document.getElementById('customerName')?.value.trim() || 'Khách lẻ';
    APP.orderContext.customerPhone = document.getElementById('customerPhone')?.value.trim() || '';
    APP.orderContext.note = document.getElementById('orderNote')?.value.trim() || '';
}

function updatePaymentMethod() {
    APP.orderContext.paymentMethod = document.getElementById('paymentMethod')?.value || 'CASH';
    updateCashChange();
}

function updateCashChange() {
    const received = Number(document.getElementById('cashReceived')?.value || 0);
    const grand = calcGrandTotal(calcSubtotal(), calcTax(calcSubtotal(), Number(document.getElementById('vatSelect')?.value || 0)));
    const isCash = APP.orderContext.paymentMethod === 'CASH';
    const changeRow = document.getElementById('cashChangeRow');
    if (changeRow) changeRow.hidden = !isCash || received <= 0;
    const change = Math.max(0, received - grand);
    APP.orderContext.cashReceived = received;
    const display = document.getElementById('cashChangeDisplay');
    if (display) display.textContent = formatCurrency(change);
}

function currentDraftPayload() {
    updateOrderContext();
    return {
        draft_id: APP.activeDraftId,
        order_type: APP.orderContext.orderType,
        table_id: APP.orderContext.tableId,
        customer_name: APP.orderContext.customerName,
        customer_phone: APP.orderContext.customerPhone,
        note: APP.orderContext.note,
        vat_percent: Number(document.getElementById('vatSelect')?.value || 0),
        items: APP.cartItems.map(item => ({ id: item.id, name: item.name, price: item.price, quantity: item.quantity }))
    };
}

function generateDraftId() {
    return `DRF-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

async function saveCurrentDraft() {
    if (!APP.cartItems.length) return showToast('Chưa có món để giữ đơn', 'error');
    if (!APP.activeDraftId) APP.activeDraftId = generateDraftId();
    const draft = currentDraftPayload();
    try {
        if (APP.demoMode) {
            const existing = APP.operational.drafts.findIndex(item => item.draft_id === draft.draft_id);
            if (existing >= 0) APP.operational.drafts[existing] = draft;
            else APP.operational.drafts.unshift(draft);
        } else {
            const result = await gsFetch('saveDraft', { draft });
            await verifyWriteAccepted(result.operationId);
            await loadOperationalData();
        }
        APP.activeDraftId = draft.draft_id;
        showToast('Đã giữ đơn tạm', 'success');
    } catch (error) {
        showToast(`Không thể giữ đơn: ${friendlyErrorMessage(error)}`, 'error', 6000);
    }
}

function openDraftModal() {
    renderDraftList();
    document.getElementById('draftModal').classList.add('active');
}

function renderDraftList() {
    const list = document.getElementById('draftList');
    if (!list) return;
    if (!APP.operational.drafts.length) {
        list.innerHTML = '<div class="cart-empty"><span>📂</span><p>Chưa có đơn tạm</p></div>';
        return;
    }
    list.innerHTML = APP.operational.drafts.map(draft => `
        <div class="operational-item">
            <div><strong>${escHtml(draft.customer_name || 'Khách lẻ')}</strong><small>${draft.order_type === 'DINE_IN' ? `Tại bàn ${escHtml(draft.table_id)}` : 'Mang đi'} · ${draft.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)} món</small></div>
            <div class="table-actions"><button class="btn-secondary btn-sm" data-draft-action="delete" data-draft-id="${escHtml(draft.draft_id)}">Xóa</button><button class="btn-primary" data-draft-action="restore" data-draft-id="${escHtml(draft.draft_id)}">Mở</button></div>
        </div>`).join('');
}

async function restoreDraft(draftId) {
    const draft = APP.operational.drafts.find(item => item.draft_id === draftId);
    if (!draft) return;
    APP.cartItems = draft.items.map(item => ({ id: item.id, name: item.name, price: Number(item.price), quantity: Number(item.quantity) }));
    APP.activeDraftId = draft.draft_id;
    APP.orderContext.orderType = draft.order_type;
    APP.orderContext.tableId = draft.table_id;
    APP.orderContext.customerName = draft.customer_name;
    APP.orderContext.customerPhone = draft.customer_phone;
    APP.orderContext.note = draft.note;
    document.getElementById('vatSelect').value = String(draft.vat_percent || 0);
    renderOperationalControls();
    renderCart();
    updateCalc();
    closeOperationalModal('draftModal');
    showToast('Đã mở đơn tạm', 'success');
}

async function deleteDraftUI(draftId) {
    if (!confirm('Xóa đơn tạm này?')) return;
    try {
        if (APP.demoMode) {
            APP.operational.drafts = APP.operational.drafts.filter(draft => draft.draft_id !== draftId);
        } else {
            const result = await gsFetch('deleteDraft', { draft_id: draftId });
            await verifyWriteAccepted(result.operationId);
            await loadOperationalData();
        }
        if (APP.activeDraftId === draftId) APP.activeDraftId = '';
        renderDraftList();
        showToast('Đã xóa đơn tạm', 'success');
    } catch (error) {
        showToast(`Không thể xóa đơn tạm: ${friendlyErrorMessage(error)}`, 'error', 6000);
    }
}

function closeOperationalModal(id) { document.getElementById(id)?.classList.remove('active'); }

function openShiftModal() {
    const current = APP.operational.currentShift;
    document.getElementById('shiftStatus').textContent = current
        ? `Đang mở ca: ${current.staff_name || 'Chưa ghi tên'} · từ ${new Date(current.opened_at).toLocaleTimeString('vi-VN')}`
        : 'Chưa mở ca bán hàng.';
    document.getElementById('shiftCashLabel').textContent = current ? 'Tiền kiểm ca' : 'Tiền đầu ca';
    document.getElementById('shiftActionBtn').textContent = current ? 'Chốt ca' : 'Mở ca';
    document.getElementById('shiftStaffName').value = current?.staff_name || APP.orderContext.staffName || '';
    document.getElementById('shiftCash').value = '';
    document.getElementById('shiftModal').classList.add('active');
}

async function submitShiftAction() {
    const cash = Number(document.getElementById('shiftCash').value || 0);
    const staffName = document.getElementById('shiftStaffName').value.trim();
    try {
        if (APP.operational.currentShift) {
            const closedShift = { ...APP.operational.currentShift };
            if (!APP.demoMode) {
                const result = await gsFetch('closeShift', { shift: { closing_cash: cash } });
                await verifyWriteAccepted(result.operationId);
            }
            APP.operational.currentShift = null;
            if (APP.demoMode) {
                openShiftReport({
                    opening_cash: closedShift.opening_cash,
                    cash_sales: 0,
                    expected_cash: closedShift.opening_cash,
                    closing_cash: cash,
                    difference: cash - closedShift.opening_cash,
                    order_count: 0
                });
            } else {
                const report = await gsFetch('getShiftReport', { shift_id: closedShift.shift_id });
                if (!report?.success) throw new Error(report?.error || 'Không thể tải đối soát ca');
                openShiftReport(report);
            }
            showToast('Đã chốt ca và tạo đối soát', 'success');
        } else {
            if (!APP.demoMode) {
                const result = await gsFetch('openShift', { shift: { opening_cash: cash, staff_name: staffName } });
                await verifyWriteAccepted(result.operationId);
            }
            APP.operational.currentShift = { opened_at: new Date().toISOString(), opening_cash: cash, staff_name: staffName };
            APP.orderContext.staffName = staffName;
            showToast('Đã mở ca', 'success');
        }
        if (!APP.demoMode) await loadOperationalData();
        closeOperationalModal('shiftModal');
    } catch (error) {
        showToast(`Không thể cập nhật ca: ${friendlyErrorMessage(error)}`, 'error', 6000);
    }
}

function openShiftReport(report = {}) {
    const body = document.getElementById('shiftReportBody');
    if (!body) return;
    const rows = [
        ['Tiền đầu ca', formatCurrency(Number(report.opening_cash || 0))],
        ['Doanh thu tiền mặt', formatCurrency(Number(report.cash_sales || 0))],
        ['Tiền dự kiến', formatCurrency(Number(report.expected_cash || 0))],
        ['Tiền kiểm thực tế', formatCurrency(Number(report.closing_cash || 0))],
        ['Chênh lệch', formatCurrency(Math.abs(Number(report.difference || 0)))]
    ];
    const difference = Number(report.difference || 0);
    body.innerHTML = `<div class="shift-report-summary ${difference === 0 ? 'balanced' : 'unbalanced'}"><strong>${difference === 0 ? 'Khớp tiền mặt' : difference > 0 ? 'Dư tiền mặt' : 'Thiếu tiền mặt'}</strong><span>${Number(report.order_count || 0)} đơn tiền mặt trong ca</span></div>`
        + rows.map(([label, value]) => `<div class="shift-report-row"><span>${label}</span><strong>${value}</strong></div>`).join('');
    document.getElementById('shiftReportModal').classList.add('active');
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
        if (['getMenu', 'getHistory', 'getOrder', 'getOperationStatus', 'getOperations', 'getShiftReport'].includes(action)) {
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
            if (action === 'getOperationStatus' && payload.operation_id) {
                url.searchParams.set('operation_id', payload.operation_id);
            }
            if (action === 'getShiftReport' && payload.shift_id) {
                url.searchParams.set('shift_id', payload.shift_id);
            }
            const res = await fetch(url.toString(), { method: 'GET' });
            const data = await res.json();
            if (data && data.success === false) {
                throw new Error(data.error || 'Google Sheets request failed');
            }
            return data;
        } else {
            const operationId = createOperationId();
            const body = APP.apiKey
                ? { action, key: APP.apiKey, ...payload, operation_id: operationId }
                : { action, ...payload, operation_id: operationId };
            if (['appendMenuItem', 'updateMenuItem', 'deleteMenuItem', 'cancelOrder', 'cancelOrders'].includes(action)) body.admin_pin = APP.adminPin;

            // POST no-cors: Apps Script nhận dữ liệu, sau đó app xác minh bằng GET.
            await fetch(APP.scriptUrl, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify(body),
            });
            return { success: true, pendingVerification: true, operationId };
        }
    } catch (e) {
        console.error('GSheets error:', e);
        throw e;
    }
}

async function verifyWriteAccepted(operationId) {
    if (!operationId) return false;
    for (let attempt = 0; attempt < WRITE_VERIFY_ATTEMPTS; attempt++) {
        const data = await gsFetch('getOperationStatus', { operation_id: operationId });
        if (data && data.status === 'SUCCESS') return true;
        if (data && data.status === 'FAILED') throw new Error(data.error || 'Server rejected the operation');
        await sleep(WRITE_VERIFY_DELAY_MS);
    }
    // Không chặn luồng cũ nếu server xử lý xong nhưng status bị trễ/mất.
    return false;
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
        if (data && data.order && ['ACTIVE', 'PAID'].includes(String(data.order[6]))
            && Array.isArray(data.items) && data.items.length === expectedItems.length
            && data.items.every((item, index) => Number(item[2]) === expectedItems[index].quantity
                && String(item[5]) === 'ACTIVE')) return data;
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
                renderCategoryFilters();
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
        renderCategoryFilters();
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
function normalizeSearchText(value) {
    return String(value || '')
        .toLocaleLowerCase('vi-VN')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function getMenuCategory(name) {
    const n = normalizeSearchText(name);
    if (n.includes('ca phe') || n.includes('coffee') || n.includes('matcha')) return 'Cà phê';
    if (n.includes('tra') || n.includes('tea')) return 'Trà';
    if (n.includes('sinh to') || n.includes('nuoc ep') || n.includes('juice')) return 'Nước ép';
    return 'Khác';
}

function renderCategoryFilters() {
    const el = document.getElementById('categoryFilters');
    if (!el) return;
    const categories = ['all', ...new Set(APP.menuItems.filter(i => i.status === 'Active').map(i => getMenuCategory(i.name)))];
    el.innerHTML = categories.map(category => {
        const label = category === 'all' ? 'Tất cả món' : category;
        return `<button class="category-chip ${APP.menuCategory === category ? 'active' : ''}" data-category="${escHtml(category)}">${escHtml(label)}</button>`;
    }).join('');
}

function setMenuCategory(category) {
    APP.menuCategory = category || 'all';
    renderCategoryFilters();
    filterMenu(document.getElementById('searchMenu')?.value || '');
}

function renderMenuGrid(items, filterText = '') {
    const grid = document.getElementById('menuGrid');
    const normalizedFilter = normalizeSearchText(filterText);
    const active = items.filter(i =>
        i.status === 'Active' &&
        (APP.menuCategory === 'all' || getMenuCategory(i.name) === APP.menuCategory) &&
        (!normalizedFilter || normalizeSearchText(i.name).includes(normalizedFilter))
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
    if (!item) return;
    if (item.quantity >= 100) {
        showToast('Mỗi món tối đa 100 phần trong một đơn', 'info');
        return;
    }
    item.quantity += 1;
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
    const cartItemsSummary = document.getElementById('cartItemsSummary');
    const cartTotalSummary = document.getElementById('cartTotalSummary');
    const clearCartBtn = document.getElementById('btnClearCart');
    const totalItems = APP.cartItems.reduce((s, i) => s + i.quantity, 0);
    const subtotal = calcSubtotal();

    cartCount.textContent = `${totalItems} món`;
    cartItemsSummary.textContent = totalItems > 0 ? `${totalItems} món trong giỏ` : 'Giỏ hàng trống';
    cartTotalSummary.textContent = formatCurrency(subtotal);
    clearCartBtn.disabled = totalItems === 0;

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
      <div>
        <span class="cart-item-name" title="${escHtml(item.name)}">${escHtml(item.name)}</span>
        <span class="cart-item-note">${item.quantity} x ${formatCurrency(item.price)}</span>
      </div>
      <div class="cart-item-controls">
        <button class="qty-btn minus" data-cart-action="decrease" data-cart-id="${escHtml(item.id)}" title="Giảm">−</button>
        <span class="qty-num">${item.quantity}</span>
        <button class="qty-btn" data-cart-action="increase" data-cart-id="${escHtml(item.id)}" title="Tăng">+</button>
        <button class="qty-btn btn-remove" data-cart-action="remove" data-cart-id="${escHtml(item.id)}" title="Xóa">×</button>
      </div>
      <span class="cart-item-price">${formatCurrency(item.price * item.quantity)}</span>
    </div>
  `).join('');

    document.getElementById('btnCheckout').disabled = false;
}

function clearCart() {
    if (APP.cartItems.length === 0) return;
    APP.cartItems = [];
    renderCart();
    updateCalc();
    showToast('Đã xóa toàn bộ giỏ hàng', 'info');
}

function pulseCartBadge() {
    const badge = document.getElementById('cartCount');
    badge.style.transform = 'scale(1.25)';
    setTimeout(() => badge.style.transform = '', 200);
}

function toggleMobileCart(forceOpen) {
    const panel = document.getElementById('mobileCartPanel');
    const toggle = document.getElementById('btnMobileCartToggle');
    if (!panel || !toggle || !window.matchMedia('(max-width: 700px)').matches) return;
    const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !panel.classList.contains('mobile-expanded');
    panel.classList.toggle('mobile-expanded', shouldOpen);
    document.body.classList.toggle('cart-sheet-open', shouldOpen);
    toggle.textContent = shouldOpen ? 'Thu gọn' : 'Mở giỏ';
    toggle.setAttribute('aria-expanded', String(shouldOpen));
    if (shouldOpen) document.getElementById('cartList')?.scrollTo({ top: 0, behavior: 'smooth' });
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
    updateCashChange();
}

// ============================================================
// 8. CHECKOUT ACTION FLOW  (ghi tuần tự vào 2 tab Google Sheets)
// ============================================================
async function checkout(orderData = null) {
    const pending = orderData || APP.pendingCheckout;
    if (!pending && APP.cartItems.length === 0) { showToast('Giỏ hàng đang trống!', 'error'); return; }

    const btn = document.getElementById('btnCheckout');
    const confirmBtn = document.getElementById('btnConfirmCheckout');
    btn.disabled = true;
    if (confirmBtn) confirmBtn.disabled = true;
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin 0.8s linear infinite"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg> Đang xử lý...`;

    try {
        const data = pending || (() => {
            const orderId = generateOrderId();
            const now = new Date().toISOString();
            const vatPercent = Number(document.getElementById('vatSelect').value);
            const subtotal = calcSubtotal();
            const taxAmount = calcTax(subtotal, vatPercent);
            const grandTotal = calcGrandTotal(subtotal, taxAmount);
            return { orderId, timestamp: now, vatPercent, subtotal, taxAmount, grandTotal };
        })();

        const orderId = data.orderId;
        const now = data.timestamp;
        const vatPercent = data.vatPercent;
        const subtotal = data.subtotal;
        const taxAmount = data.taxAmount;
        const grandTotal = data.grandTotal;

        if (!APP.demoMode) {
            const orderRow = {
                order_id: orderId,
                timestamp: now,
                sub_total: subtotal,
                tax_percent: vatPercent,
                tax_amount: taxAmount,
                grand_total: grandTotal,
            };

            const itemSnapshot = data.items || APP.cartItems.map(item => ({
                id: item.id,
                name: item.name,
                quantity: item.quantity,
                price: item.price,
            }));

            const itemRows = itemSnapshot.map(item => ({
                order_id: orderId,
                menu_id: item.id,
                item_name: item.name,
                quantity: item.quantity,
                unit_price: item.price,
                line_total: item.quantity * item.price,
            }));

            const writeResult = await gsFetch('checkoutOrder', {
                orderRow: orderRow,
                itemRows: itemRows,
                orderMeta: {
                    ...(data.context || APP.orderContext),
                    shiftId: APP.operational.currentShift?.shift_id || ''
                }
            });
            await verifyWriteAccepted(writeResult.operationId);

            const verified = await verifyOrderWritten(orderId, itemRows);
            const serverOrder = verified.order;
            const serverItems = verified.items.map(item => ({
                name: String(item[1]),
                quantity: Number(item[2]),
                price: Number(item[3])
            }));
            data.orderId = String(serverOrder[0]);
            data.timestamp = String(serverOrder[1]);
            data.subtotal = Number(serverOrder[2]);
            data.vatPercent = Number(serverOrder[3]);
            data.taxAmount = Number(serverOrder[4]);
            data.grandTotal = Number(serverOrder[5]);
            data.items = serverItems;
        }

        const receiptItems = data.items || APP.cartItems;
        buildReceipt(data.orderId, data.timestamp, data.subtotal, data.vatPercent, data.taxAmount, data.grandTotal, receiptItems);
        APP.resetCartOnReceiptClose = true;
        APP.pendingCheckout = null;
        document.getElementById('receiptModal').classList.add('active');
        if (confirmBtn) confirmBtn.hidden = true;
        document.getElementById('btnPrintReceipt').hidden = false;

        btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> XUẤT HÓA ĐƠN`;
        btn.disabled = true;
    } catch (err) {
        console.error('Checkout error:', err);
        showToast(`❌ Lỗi: ${friendlyErrorMessage(err)}`, 'error', 6000);
        btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> XUẤT HÓA ĐƠN`;
        btn.disabled = false;
        if (confirmBtn) confirmBtn.disabled = false;
    }
}

// ============================================================
// 9. ADMIN – MENU CRUD
// ============================================================
function renderMenuTable() {
    const tbody = document.getElementById('menuTableBody');
    const items = APP.menuItems;
    const filterValue = normalizeSearchText(document.getElementById('adminSearch')?.value.trim());
    const statusFilter = document.getElementById('adminStatusFilter')?.value || 'all';

    const filteredItems = items.filter(item => {
        const matchesText = !filterValue || normalizeSearchText(item.name).includes(filterValue) || normalizeSearchText(item.id).includes(filterValue);
        const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
        return matchesText && matchesStatus;
    });

    // Update summary cards
    document.getElementById('totalItems').textContent = filteredItems.length;
    document.getElementById('activeItems').textContent = filteredItems.filter(i => i.status === 'Active').length;
    document.getElementById('inactiveItems').textContent = filteredItems.filter(i => i.status === 'Inactive').length;

    if (filteredItems.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:32px">
      Không tìm thấy món phù hợp với bộ lọc.
    </td></tr>`;
        return;
    }

    tbody.innerHTML = filteredItems.map(item => `
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

function filterAdminMenu(value) {
    const searchField = document.getElementById('adminSearch');
    if (searchField) searchField.value = value;
    renderMenuTable();
}

function filterHistory(value) {
    APP.historySearchQuery = String(value || '').trim().toLowerCase();
    renderHistoryTable();
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
                const writeResult = await gsFetch('updateMenuItem', { id: editId, name, price, status });
                await verifyWriteAccepted(writeResult.operationId);
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
                const writeResult = await gsFetch('appendMenuItem', { row: { id: newId, name, price, status } });
                await verifyWriteAccepted(writeResult.operationId);
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
            const writeResult = await gsFetch('updateMenuItem', { id, name: item.name, price: item.price, status: 'Inactive' });
            await verifyWriteAccepted(writeResult.operationId);
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
    const historySelection = e.target.closest('[data-history-select]');
    if (historySelection) {
        toggleHistoryOrder(historySelection.dataset.historySelect, historySelection.checked);
        return;
    }

    const draftButton = e.target.closest('[data-draft-action]');
    if (draftButton?.dataset.draftAction === 'restore') {
        restoreDraft(draftButton.dataset.draftId);
        return;
    }
    if (draftButton?.dataset.draftAction === 'delete') {
        deleteDraftUI(draftButton.dataset.draftId);
        return;
    }

    const categoryButton = e.target.closest('[data-category]');
    if (categoryButton) {
        setMenuCategory(categoryButton.dataset.category);
        return;
    }

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
        if (cartButton.dataset.cartAction === 'remove') removeFromCart(id);
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
        if (historyButton.dataset.historyAction === 'detail') openHistoryDetail(orderId);
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
        const typingTarget = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
        if ((e.key === '/' || (e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey))) && !typingTarget) {
            const activeSearch = document.querySelector('.page.active .search-input');
            if (activeSearch) {
                e.preventDefault();
                activeSearch.focus();
            }
            return;
        }
        if (e.key === 'Escape') {
            document.getElementById('itemModal').classList.remove('active');
            document.getElementById('deleteModal').classList.remove('active');
            closeHistoryDetail();
            closeCancellationModal();
            closeOperationalModal('shiftReportModal');
        }
    });
    document.addEventListener('click', handleDynamicClick);
    document.addEventListener('keydown', handleDynamicKeydown);
    window.addEventListener('resize', () => {
        if (!window.matchMedia('(max-width: 700px)').matches) {
            document.getElementById('mobileCartPanel')?.classList.remove('mobile-expanded');
            document.body.classList.remove('cart-sheet-open');
            const toggle = document.getElementById('btnMobileCartToggle');
            if (toggle) { toggle.textContent = 'Mở giỏ'; toggle.setAttribute('aria-expanded', 'false'); }
        }
    });

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
    // API Key không còn được tự động nạp từ localStorage.
    localStorage.removeItem(STORAGE_KEYS.apiKey);
    if (savedUrl) {
        document.getElementById('inputScriptUrl').value = savedUrl;
    }
});

// ============================================================
// 12. RECEIPT LOGIC
// ============================================================

function buildReceipt(orderId, timestamp, subtotal, vatPercent, taxAmount, grandTotal, receiptItems = APP.cartItems) {
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
    rItems.innerHTML = receiptItems.map(item => `
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
        APP.orderContext = { orderType: 'TAKEAWAY', tableId: '', customerName: 'Khách lẻ', customerPhone: '', note: '', paymentMethod: 'CASH', cashReceived: 0, staffName: APP.orderContext.staffName || '' };
        APP.activeDraftId = '';
        const cashInput = document.getElementById('cashReceived');
        if (cashInput) cashInput.value = '';
        renderOperationalControls();
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

function exportHistoryCsv() {
    const rows = [['Mã đơn', 'Thời gian', 'Tạm tính', 'VAT', 'Thuế', 'Tổng cộng', 'Trạng thái']];
    APP.history.orders.forEach(order => rows.push([
        order.order_id, order.timestamp, order.sub_total, order.tax_percent,
        order.tax_amount, order.grand_total, order.status
    ]));
    if (rows.length === 1) return showToast('Chưa có lịch sử để xuất', 'info');
    const csv = '\uFEFF' + rows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `cafe-pos-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
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
            APP.history.orders = (data.orders || []).filter(o => String(o[0] || '').trim().toLowerCase() !== 'order_id').map(o => ({
                order_id: String(o[0]), timestamp: String(o[1]), sub_total: Number(o[2]),
                tax_percent: Number(o[3]), tax_amount: Number(o[4]), grand_total: Number(o[5]),
                status: o[6] ? String(o[6]) : 'ACTIVE' // cột status mới
            }));
            APP.history.items = (data.items || []).filter(i => String(i[0] || '').trim().toLowerCase() !== 'order_id').map(i => ({
                order_id: String(i[0]), item_name: String(i[1]), quantity: Number(i[2]),
                unit_price: Number(i[3]), line_total: Number(i[4])
            }));
            APP.history.meta = (data.meta || []).map(row => ({
                order_id: String(row[0]), order_type: String(row[1] || 'TAKEAWAY'), table_id: String(row[2] || ''),
                customer_name: String(row[3] || 'Khách lẻ'), customer_phone: String(row[4] || ''), note: String(row[5] || ''),
                payment_method: String(row[6] || 'CASH'), cash_received: Number(row[7] || 0), change_amount: Number(row[8] || 0),
                staff_name: String(row[9] || ''), shift_id: String(row[10] || '')
            }));
            APP.history.cancellations = (data.cancellations || []).reduce((records, row) => {
                records[String(row[0])] = { cancelled_at: String(row[1] || ''), reason: String(row[2] || ''), note: String(row[3] || '') };
                return records;
            }, {});
            APP.selectedHistoryOrderIds.clear();
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

function getFilteredHistoryOrders() {
    const query = APP.historySearchQuery || '';
    return APP.history.orders
        .slice()
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .filter(order => !query || String(order.order_id).toLowerCase().includes(query));
}

function renderHistoryTable() {
    const tbody = document.getElementById('historyTableBody');
    const filteredOrders = getFilteredHistoryOrders();
    let totalRevenue = 0;
    let totalOrdersCount = 0;
    let cancelledCount = 0;
    filteredOrders.forEach(order => {
        if (order.status === 'CANCELLED') cancelledCount++;
        else { totalRevenue += order.grand_total; totalOrdersCount++; }
    });

    document.getElementById('historyTotalRevenue').textContent = formatCurrency(totalRevenue);
    document.getElementById('historyTotalOrders').textContent = totalOrdersCount;
    const cancelledEl = document.getElementById('historyCancelledOrders');
    if (cancelledEl) cancelledEl.textContent = cancelledCount;
    renderHistoryInsights(filteredOrders);
    renderHistoryBulkBar(filteredOrders);

    if (!filteredOrders.length) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--text-muted);padding:32px">Chưa có hóa đơn nào được lưu.</td></tr>`;
        return;
    }

    tbody.innerHTML = filteredOrders.map(order => {
        const date = new Date(order.timestamp);
        const isCancelled = order.status === 'CANCELLED';
        const checked = APP.selectedHistoryOrderIds.has(order.order_id) ? 'checked' : '';
        const cancellation = APP.history.cancellations[order.order_id];
        return `<tr class="history-row ${isCancelled ? 'is-cancelled' : ''}">
            <td class="history-select-col"><input type="checkbox" data-history-select="${escHtml(order.order_id)}" ${checked} ${isCancelled ? 'disabled' : ''} aria-label="Chọn đơn ${escHtml(order.order_id)}" /></td>
            <td class="history-order-id">${escHtml(order.order_id)}</td>
            <td class="history-time">${date.toLocaleDateString('vi-VN')}<small>${date.toLocaleTimeString('vi-VN')}</small></td>
            <td class="history-total">${formatCurrency(order.grand_total)}</td>
            <td>${isCancelled
                ? `<span class="badge badge-inactive">Đã hủy</span>${cancellation?.reason ? `<small class="cancellation-reason">${escHtml(cancellation.reason)}</small>` : ''}`
                : '<span class="badge badge-active">Đã thanh toán</span>'}</td>
            <td><button class="action-btn" data-history-action="detail" data-order-id="${escHtml(order.order_id)}">Chi tiết</button></td>
        </tr>`;
    }).join('');
}

function renderHistoryBulkBar(visibleOrders = getFilteredHistoryOrders()) {
    const activeIds = new Set(APP.history.orders.filter(order => order.status !== 'CANCELLED').map(order => order.order_id));
    [...APP.selectedHistoryOrderIds].forEach(id => { if (!activeIds.has(id)) APP.selectedHistoryOrderIds.delete(id); });
    const count = APP.selectedHistoryOrderIds.size;
    const bar = document.getElementById('historyBulkBar');
    const countEl = document.getElementById('historySelectionCount');
    const selectAll = document.getElementById('historySelectAll');
    if (bar) bar.hidden = count === 0;
    if (countEl) countEl.textContent = count;
    const selectableVisible = visibleOrders.filter(order => order.status !== 'CANCELLED');
    if (selectAll) {
        selectAll.checked = selectableVisible.length > 0 && selectableVisible.every(order => APP.selectedHistoryOrderIds.has(order.order_id));
        selectAll.indeterminate = !selectAll.checked && selectableVisible.some(order => APP.selectedHistoryOrderIds.has(order.order_id));
    }
}

function toggleHistoryOrder(orderId, checked) {
    if (checked) APP.selectedHistoryOrderIds.add(orderId);
    else APP.selectedHistoryOrderIds.delete(orderId);
    renderHistoryTable();
}

function toggleAllHistoryOrders(checked) {
    getFilteredHistoryOrders().filter(order => order.status !== 'CANCELLED').forEach(order => {
        if (checked) APP.selectedHistoryOrderIds.add(order.order_id);
        else APP.selectedHistoryOrderIds.delete(order.order_id);
    });
    renderHistoryTable();
}

function clearHistorySelection() {
    APP.selectedHistoryOrderIds.clear();
    renderHistoryTable();
}

function renderHistoryInsights(orders) {
    const container = document.getElementById('historyInsights');
    if (!container) return;
    const activeIds = new Set(orders.filter(order => order.status !== 'CANCELLED').map(order => order.order_id));
    const itemTotals = new Map();
    APP.history.items.filter(item => activeIds.has(item.order_id)).forEach(item => {
        itemTotals.set(item.item_name, (itemTotals.get(item.item_name) || 0) + item.quantity);
    });
    const topItems = [...itemTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const maxQuantity = topItems[0]?.[1] || 1;
    const daily = new Map();
    orders.filter(order => order.status !== 'CANCELLED').forEach(order => {
        const key = new Date(order.timestamp).toLocaleDateString('vi-VN');
        daily.set(key, (daily.get(key) || 0) + order.grand_total);
    });
    const latestDay = [...daily.entries()].slice(-1)[0];
    const reasons = new Map();
    orders.filter(order => order.status === 'CANCELLED').forEach(order => {
        const reason = APP.history.cancellations[order.order_id]?.reason || 'Chưa ghi lý do';
        reasons.set(reason, (reasons.get(reason) || 0) + 1);
    });
    const cancellationSummary = [...reasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    container.innerHTML = `
        <section class="insight-panel"><h3>Món bán chạy</h3>${topItems.length ? topItems.map(([name, quantity]) => `<div class="insight-row"><span>${escHtml(name)} · ${quantity}</span><span class="insight-bar"><i style="width:${Math.max(8, quantity / maxQuantity * 100)}%"></i></span></div>`).join('') : '<span class="summary-label">Chưa có dữ liệu bán hàng</span>'}</section>
        <section class="insight-panel"><h3>Doanh thu gần nhất</h3><div class="summary-value">${latestDay ? formatCurrency(latestDay[1]) : '0 ₫'}</div><div class="summary-label">${latestDay ? latestDay[0] : 'Chưa có hóa đơn hoàn tất'}</div></section>
        <section class="insight-panel"><h3>Phân tích hủy đơn</h3>${cancellationSummary.length ? cancellationSummary.map(([reason, count]) => `<div class="insight-row"><span>${escHtml(reason)}</span><strong>${count} đơn</strong></div>`).join('') : '<span class="summary-label">Chưa có đơn hủy trong phạm vi này</span>'}</section>`;
}

function openHistoryDetail(orderId) {
    const order = APP.history.orders.find(item => item.order_id === orderId);
    if (!order) return showToast('Không tìm thấy hóa đơn', 'error');
    APP.historyDetailOrderId = orderId;
    const items = APP.history.items.filter(item => item.order_id === orderId);
    const meta = APP.history.meta.find(item => item.order_id === orderId);
    const cancellation = APP.history.cancellations[orderId];
    const isCancelled = order.status === 'CANCELLED';
    document.getElementById('historyDetailTitle').textContent = orderId;
    document.getElementById('historyDetailBody').innerHTML = `
        <div class="history-detail-meta">
            <div><span>Thời gian</span><strong>${new Date(order.timestamp).toLocaleString('vi-VN')}</strong></div>
            <div><span>Trạng thái</span><strong class="${isCancelled ? 'text-danger' : 'text-success'}">${isCancelled ? 'Đã hủy' : 'Đã thanh toán'}</strong></div>
            <div><span>Thanh toán</span><strong>${escHtml(meta?.payment_method || 'Tiền mặt')}</strong></div>
            <div><span>Khách hàng</span><strong>${escHtml(meta?.customer_name || 'Khách lẻ')}</strong></div>
        </div>
        <div class="history-detail-items">${items.map(item => `<div><span>${escHtml(item.item_name)} <small>× ${item.quantity}</small></span><strong>${formatCurrency(item.line_total)}</strong></div>`).join('') || '<span class="summary-label">Không có chi tiết món</span>'}</div>
        <div class="history-detail-total"><span>Tổng cộng</span><strong>${formatCurrency(order.grand_total)}</strong></div>
        ${cancellation ? `<div class="cancellation-record"><strong>Nhật ký hủy</strong><span>${escHtml(cancellation.reason || 'Chưa ghi lý do')}</span>${cancellation.note ? `<small>${escHtml(cancellation.note)}</small>` : ''}<small>${new Date(cancellation.cancelled_at).toLocaleString('vi-VN')}</small></div>` : ''}`;
    document.getElementById('historyDetailCancel').hidden = isCancelled;
    document.getElementById('historyDetailModal').classList.add('active');
}

function closeHistoryDetail() { document.getElementById('historyDetailModal').classList.remove('active'); }
function reprintCurrentHistoryOrder() { if (APP.historyDetailOrderId) reprintOrder(APP.historyDetailOrderId); }
function requestCurrentHistoryCancellation() { if (APP.historyDetailOrderId) openCancellationModal([APP.historyDetailOrderId]); }
function requestSelectedCancellation() { openCancellationModal([...APP.selectedHistoryOrderIds]); }
function cancelOrderUI(orderId) { openCancellationModal([orderId]); }

function openCancellationModal(orderIds) {
    const ids = [...new Set(orderIds)].filter(id => APP.history.orders.some(order => order.order_id === id && order.status !== 'CANCELLED'));
    if (!ids.length) return showToast('Chỉ có thể hủy đơn đã thanh toán', 'info');
    APP.pendingCancellationOrderIds = ids;
    document.getElementById('cancellationOrderList').innerHTML = ids.map(id => {
        const order = APP.history.orders.find(item => item.order_id === id);
        return `<div><span>${escHtml(id)}</span><strong>${formatCurrency(order?.grand_total || 0)}</strong></div>`;
    }).join('');
    document.getElementById('cancellationReason').value = '';
    document.getElementById('cancellationNote').value = '';
    document.getElementById('cancellationPin').value = '';
    toggleCancellationNote();
    document.getElementById('cancellationModal').classList.add('active');
    setTimeout(() => document.getElementById('cancellationReason').focus(), 100);
}

function closeCancellationModal() {
    APP.pendingCancellationOrderIds = [];
    document.getElementById('cancellationModal').classList.remove('active');
}

function toggleCancellationNote() {
    const isOther = document.getElementById('cancellationReason')?.value === 'Khác';
    document.getElementById('cancellationNoteRequired').hidden = !isOther;
}

async function submitCancellation() {
    const ids = APP.pendingCancellationOrderIds;
    const reason = document.getElementById('cancellationReason').value;
    const note = document.getElementById('cancellationNote').value.trim();
    const pin = document.getElementById('cancellationPin').value.trim();
    if (!ids.length || !reason) return showToast('Vui lòng chọn lý do hủy', 'error');
    if (reason === 'Khác' && !note) return showToast('Vui lòng nhập ghi chú cho lý do khác', 'error');
    if (!APP.demoMode && pin.length < 4) return showToast('Vui lòng nhập PIN quản lý hợp lệ', 'error');
    const button = document.getElementById('confirmCancellationBtn');
    button.disabled = true;
    const oldText = button.textContent;
    button.textContent = 'Đang hủy...';
    try {
        APP.adminPin = pin;
        isAuthenticatedAdmin = true;
        if (!APP.demoMode) {
            const result = await gsFetch('cancelOrders', { order_ids: ids, cancellation: { reason, note } });
            await verifyWriteAccepted(result.operationId);
            await Promise.all(ids.map(verifyOrderCancelled));
        }
        const cancelledAt = new Date().toISOString();
        ids.forEach(id => {
            const order = APP.history.orders.find(item => item.order_id === id);
            if (order) order.status = 'CANCELLED';
            APP.history.cancellations[id] = { cancelled_at: cancelledAt, reason, note };
            APP.selectedHistoryOrderIds.delete(id);
        });
        closeCancellationModal();
        closeHistoryDetail();
        renderHistoryTable();
        showToast(`Đã hủy ${ids.length} đơn và lưu nhật ký`, 'success');
    } catch (error) {
        showToast(`Không thể hủy đơn: ${friendlyErrorMessage(error)}`, 'error', 6000);
    } finally {
        button.disabled = false;
        button.textContent = oldText;
    }
}

function reprintOrder(orderId) {
    const order = APP.history.orders.find(o => o.order_id === orderId);
    if (!order) return showToast('Không tìm thấy hóa đơn', 'error');

    const items = APP.history.items.filter(i => i.order_id === orderId).map(i => ({
        name: i.item_name,
        quantity: i.quantity,
        price: i.unit_price
    }));

    buildReceipt(orderId, order.timestamp, order.sub_total, order.tax_percent, order.tax_amount, order.grand_total, items);
    APP.resetCartOnReceiptClose = false;
    document.getElementById('btnConfirmCheckout').hidden = true;
    document.getElementById('btnPrintReceipt').hidden = false;
    document.getElementById('receiptModal').classList.add('active');
}
function previewCheckout() {
    if (!APP.cartItems.length) return showToast('Giỏ hàng đang trống', 'error');
    updateOrderContext();
    updatePaymentMethod();
    if (APP.orderContext.orderType === 'DINE_IN' && !APP.orderContext.tableId) {
        return showToast('Vui lòng chọn bàn cho đơn tại bàn', 'error');
    }
    const vatPercent = Number(document.getElementById('vatSelect').value);
    const subtotal = calcSubtotal();
    const taxAmount = calcTax(subtotal, vatPercent);
    const grandTotal = calcGrandTotal(subtotal, taxAmount);
    const cashReceived = Number(document.getElementById('cashReceived')?.value || 0);
    if (APP.orderContext.paymentMethod === 'CASH' && cashReceived > 0 && cashReceived < grandTotal) {
        return showToast('Tiền khách đưa chưa đủ', 'error');
    }
    APP.pendingCheckout = {
        orderId: generateOrderId(),
        timestamp: new Date().toISOString(),
        vatPercent: vatPercent,
        subtotal: subtotal,
        taxAmount: taxAmount,
        grandTotal,
        context: { ...APP.orderContext, cashReceived, changeAmount: Math.max(0, cashReceived - grandTotal) },
        activeDraftId: APP.activeDraftId || '',
        items: APP.cartItems.map(item => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            price: item.price
        }))
    };
    buildReceipt(APP.pendingCheckout.orderId, APP.pendingCheckout.timestamp, subtotal, vatPercent, taxAmount, APP.pendingCheckout.grandTotal, APP.pendingCheckout.items);
    document.getElementById('btnConfirmCheckout').hidden = false;
    document.getElementById('btnConfirmCheckout').disabled = false;
    document.getElementById('btnConfirmCheckout').textContent = '✔️ Xác nhận thanh toán';
    document.getElementById('btnPrintReceipt').hidden = true;
    document.getElementById('receiptModal').classList.add('active');
}

async function confirmCheckout() {
    if (!APP.pendingCheckout) return;
    const completedCheckout = APP.pendingCheckout;
    const btn = document.getElementById('btnConfirmCheckout');
    btn.disabled = true;
    btn.textContent = 'Đang lưu...';
    await checkout(APP.pendingCheckout);
    if (APP.resetCartOnReceiptClose) {
        await persistCheckoutCustomer(completedCheckout.context);
        await completeDraftAfterCheckout(completedCheckout.activeDraftId);
        btn.hidden = true;
        document.getElementById('btnPrintReceipt').hidden = false;
    } else {
        btn.disabled = false;
        btn.textContent = '✔️ Xác nhận thanh toán';
        showToast('Lưu đơn thất bại', 'error');
    }
}

async function persistCheckoutCustomer(context) {
    if (!context?.customerPhone || !context.customerName || context.customerName === 'Khách lẻ') return;
    try {
        if (APP.demoMode) {
            const exists = APP.operational.customers.some(customer => customer.phone === context.customerPhone);
            if (!exists) APP.operational.customers.push({ customer_id: `CUS-${Date.now()}`, name: context.customerName, phone: context.customerPhone });
        } else {
            const result = await gsFetch('saveCustomer', { customer: { name: context.customerName, phone: context.customerPhone } });
            await verifyWriteAccepted(result.operationId);
        }
    } catch (error) {
        console.warn('Could not save customer', error);
    }
}

async function completeDraftAfterCheckout(draftId) {
    if (!draftId) return;
    try {
        if (APP.demoMode) {
            APP.operational.drafts = APP.operational.drafts.filter(draft => draft.draft_id !== draftId);
        } else {
            const result = await gsFetch('deleteDraft', { draft_id: draftId });
            await verifyWriteAccepted(result.operationId);
            await loadOperationalData();
        }
        APP.activeDraftId = '';
    } catch (error) {
        console.warn('Could not close completed draft', error);
    }
}
