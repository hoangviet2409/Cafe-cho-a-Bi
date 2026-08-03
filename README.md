# Cafe POS System

🌐 **Ứng dụng quản lý bán hàng cho quán cafe** — Chạy trực tiếp trên trình duyệt, dữ liệu lưu trên Google Sheets.

## Tính năng
- ☕ Giao diện Thu ngân (POS) với giỏ hàng và thanh toán
- 📋 Quản lý Menu (thêm/sửa/xóa món, bảo vệ bằng PIN)
- 🧾 Xuất và In hóa đơn (hỗ trợ máy in nhiệt 80mm)
- 📊 Lịch sử bán hàng & doanh thu hàng ngày
- ❌ Hủy đơn hàng
- 💾 Dữ liệu đồng bộ lên Google Sheets qua Apps Script
- 📱 Hỗ trợ PWA (cài như App trên điện thoại/tablet)

## Cách dùng
1. Mở trang web
2. Nhập **Google Apps Script Web App URL** vào ô cấu hình → Bấm **Kết nối**
3. URL sẽ được ghi nhớ cho những lần sau

## Cấu hình Admin
- Mã PIN mặc định: **1234** (đổi trong `app.js` → const `ADMIN_PIN`)

## Cài đặt Google Apps Script
1. Mở Google Sheets → **Tiện ích mở rộng → Apps Script**
2. Paste toàn bộ nội dung file `apps-script.js`
3. Deploy → **New deployment → Web App**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Copy URL và dán vào app
