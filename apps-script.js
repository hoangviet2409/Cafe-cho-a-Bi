/**
 * ============================================================
 * Google Apps Script – Cafe POS Backend
 * Deploy as Web App (Execute as: Me, Access: Anyone)
 * ============================================================
 * 
 * Hướng dẫn Deploy:
 * 1. Mở Google Sheets → Tiện ích mở rộng → Apps Script
 * 2. Xóa nội dung mặc định, dán toàn bộ code này vào
 * 3. Nhấn "Deploy" → "New Deployment"
 * 4. Type: Web App, Execute as: Me, Access: Anyone
 * 5. Copy URL vào ô "Google Apps Script URL" trong app POS
 * ============================================================
 */

const SHEET_ID = SpreadsheetApp.getActiveSpreadsheet().getId();

// Tên các tab Google Sheets
const TAB_MENU = 'Menu';
const TAB_ORDERS = 'Orders';
const TAB_ORDER_ITEMS = 'Orders_Items';

// ---- Headers (dòng đầu tiên của mỗi tab) ----
const HEADER_MENU = ['id', 'name', 'price', 'status'];
const HEADER_ORDERS = ['order_id', 'timestamp', 'sub_total', 'tax_percent', 'tax_amount', 'grand_total', 'status'];
const HEADER_ORDER_ITEMS = ['order_id', 'item_name', 'quantity', 'unit_price', 'line_total', 'status'];

// ---- CORS + Router ----
function doPost(e) {
    try {
        const result = handleRequest(e);
        return ContentService
            .createTextOutput(JSON.stringify(result))
            .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
        return ContentService
            .createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}

function doGet(e) {
    try {
        const action = e && e.parameter && e.parameter.action;
        if (action === 'getMenu') {
            return ContentService
                .createTextOutput(JSON.stringify(getMenu()))
                .setMimeType(ContentService.MimeType.JSON);
        } else if (action === 'getHistory') {
            return ContentService
                .createTextOutput(JSON.stringify(getHistory()))
                .setMimeType(ContentService.MimeType.JSON);
        }
        return ContentService
            .createTextOutput(JSON.stringify({ success: true, message: 'Cafe POS API v1.0' }))
            .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
        return ContentService
            .createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
            .setMimeType(ContentService.MimeType.JSON);
    }
}

function handleRequest(e) {
    try {
        const body = JSON.parse(e.postData.contents);
        const action = body.action;

        switch (action) {
            case 'getMenu': return getMenu();
            case 'appendMenuItem': return appendMenuItem(body.row);
            case 'updateMenuItem': return updateMenuItem(body.id, body.name, body.price, body.status);
            case 'deleteMenuItem': return deleteMenuItem(body.id);
            case 'appendOrder': return appendOrder(body.row);
            case 'appendOrderItem': return appendOrderItem(body.row);
            case 'cancelOrder': return cancelOrder(body.order_id);
            default: return { success: false, error: 'Unknown action: ' + action };
        }
    } catch (err) {
        return { success: false, error: err.toString() };
    }
}

// ============================================================
// MENU OPERATIONS
// ============================================================

function getMenu() {
    const sheet = getOrCreateSheet(TAB_MENU, HEADER_MENU);
    const data = sheet.getDataRange().getValues();
    // Bỏ dòng header (index 0)
    const rows = data.slice(1).filter(r => r[0]); // bỏ dòng trống
    return { success: true, rows };
}

function appendMenuItem(row) {
    const sheet = getOrCreateSheet(TAB_MENU, HEADER_MENU);
    sheet.appendRow([row.id, row.name, row.price, row.status]);
    return { success: true };
}

function updateMenuItem(id, name, price, status) {
    const sheet = getOrCreateSheet(TAB_MENU, HEADER_MENU);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (data[i][0] === id) {
            sheet.getRange(i + 1, 1, 1, 4).setValues([[id, name, price, status]]);
            return { success: true };
        }
    }
    return { success: false, error: 'Item not found' };
}

function deleteMenuItem(id) {
    const sheet = getOrCreateSheet(TAB_MENU, HEADER_MENU);
    const data = sheet.getDataRange().getValues();
    for (let i = data.length - 1; i >= 1; i--) {
        if (data[i][0] === id) {
            sheet.deleteRow(i + 1);
            return { success: true };
        }
    }
    return { success: false, error: 'Item not found' };
}

// ============================================================
// ORDERS OPERATIONS
// ============================================================

function appendOrder(row) {
    const sheet = getOrCreateSheet(TAB_ORDERS, HEADER_ORDERS);
    sheet.appendRow([
        row.order_id,
        row.timestamp,
        row.sub_total,
        row.tax_percent,
        row.tax_amount,
        row.grand_total,
        'ACTIVE',
    ]);
    return { success: true };
}

function cancelOrder(orderId) {
    // 1. Đánh dấu CANCELLED trong tab Orders
    const ordersSheet = getOrCreateSheet(TAB_ORDERS, HEADER_ORDERS);
    const ordersData = ordersSheet.getDataRange().getValues();
    let found = false;
    for (let i = 1; i < ordersData.length; i++) {
        if (String(ordersData[i][0]) === String(orderId)) {
            ordersSheet.getRange(i + 1, 7).setValue('CANCELLED');
            found = true;
            break;
        }
    }
    if (!found) return { success: false, error: 'Order not found' };

    // 2. Đánh dấu CANCELLED trong tất cả các dòng Orders_Items có cùng order_id
    const itemsSheet = getOrCreateSheet(TAB_ORDER_ITEMS, HEADER_ORDER_ITEMS);
    const itemsData = itemsSheet.getDataRange().getValues();
    for (let j = 1; j < itemsData.length; j++) {
        if (String(itemsData[j][0]) === String(orderId)) {
            itemsSheet.getRange(j + 1, 6).setValue('CANCELLED'); // cột status = cột thứ 6
        }
    }

    return { success: true };
}

// ============================================================
// ORDER ITEMS OPERATIONS
// ============================================================

function appendOrderItem(row) {
    const sheet = getOrCreateSheet(TAB_ORDER_ITEMS, HEADER_ORDER_ITEMS);
    sheet.appendRow([
        row.order_id,
        row.item_name,
        row.quantity,
        row.unit_price,
        row.line_total,
        'ACTIVE', // cột status mới
    ]);
    return { success: true };
}

// ============================================================
// HELPER: Tạo Sheet nếu chưa tồn tại
// ============================================================
function getOrCreateSheet(name, headers) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
        sheet = ss.insertSheet(name);
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
        // Định dạng header
        sheet.getRange(1, 1, 1, headers.length)
            .setFontWeight('bold')
            .setBackground('#4a4a8a')
            .setFontColor('#ffffff');
        sheet.setFrozenRows(1);
    }
    return sheet;
}

/**
 * Chạy hàm này 1 lần để khởi tạo tất cả các tab Menu mẫu
 * (Vào Apps Script Editor → chọn setupDemoData → Run)
 */
function setupDemoData() {
    // Tạo tab Menu với dữ liệu mẫu
    const menuSheet = getOrCreateSheet(TAB_MENU, HEADER_MENU);
    const demoItems = [
        ['M001', 'Cà Phê Đen', 25000, 'Active'],
        ['M002', 'Cà Phê Sữa Đá', 35000, 'Active'],
        ['M003', 'Bạc Xỉu', 30000, 'Active'],
        ['M004', 'Trà Đào Cam Sả', 45000, 'Active'],
        ['M005', 'Nước Ép Cam', 40000, 'Active'],
        ['M006', 'Sinh Tố Bơ', 55000, 'Active'],
        ['M007', 'Trà Sữa Trân Châu', 50000, 'Active'],
        ['M008', 'Matcha Latte', 60000, 'Active'],
        ['M009', 'Lemon Soda', 35000, 'Active'],
        ['M010', 'Cà Phê Muối', 45000, 'Inactive'],
    ];
    menuSheet.clearContents();
    menuSheet.getRange(1, 1, 1, HEADER_MENU.length).setValues([HEADER_MENU]);
    menuSheet.getRange(2, 1, demoItems.length, demoItems[0].length).setValues(demoItems);

    // Tạo tab Orders và Order_Items (rỗng)
    getOrCreateSheet(TAB_ORDERS, HEADER_ORDERS);
    getOrCreateSheet(TAB_ORDER_ITEMS, HEADER_ORDER_ITEMS);

    SpreadsheetApp.getUi().alert('✅ Đã khởi tạo dữ liệu mẫu thành công!');
}

// ============================================================
// HISTORY OPERATIONS
// ============================================================
function getHistory() {
    const ordersSheet = getOrCreateSheet(TAB_ORDERS, HEADER_ORDERS);
    const itemsSheet = getOrCreateSheet(TAB_ORDER_ITEMS, HEADER_ORDER_ITEMS);

    const ordersData = ordersSheet.getDataRange().getValues();
    const ordersRows = ordersData.length > 1 ? ordersData.slice(1).filter(r => r[0]) : [];

    const itemsData = itemsSheet.getDataRange().getValues();
    const itemsRows = itemsData.length > 1 ? itemsData.slice(1).filter(r => r[0]) : [];

    return { success: true, orders: ordersRows, items: itemsRows };
}
