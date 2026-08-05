# Cafe POS System

🌐 **Ứng dụng quản lý bán hàng cho quán cafe** — Chạy trực tiếp trên trình duyệt, dữ liệu lưu trên Google Sheets.

## Tính năng
- ☕ Giao diện Thu ngân (POS) với giỏ hàng và thanh toán
- 📋 Quản lý Menu (thêm/sửa/xóa món, bảo vệ bằng PIN)
- 🧾 Xuất và In hóa đơn (hỗ trợ máy in nhiệt 80mm)
- 📊 Lịch sử bán hàng & doanh thu hàng ngày
- ❌ Hủy đơn hàng
- 💾 Dữ liệu đồng bộ lên Google Sheets qua Apps Script
- ✅ Xác minh lại dữ liệu sau khi ghi để tránh báo thành công giả
- 📱 Hỗ trợ PWA (cài như App trên điện thoại/tablet)

## Cách dùng
1. Mở trang web
2. Nhập **Google Apps Script Web App URL** vào ô cấu hình → Bấm **Kết nối**
3. URL sẽ được ghi nhớ cho những lần sau

## Bảo mật bắt buộc
- Trước khi Deploy, thay `API_KEY` và `ADMIN_PIN` trong `apps-script.js` bằng hai giá trị riêng, khó đoán. Không dùng giá trị mẫu `REPLACE_...`.
- Nhập đúng **API Key** khi kết nối app (khớp `API_KEY` trong `apps-script.js`) — nếu sai, app sẽ báo lỗi rõ ràng khi tải thực đơn thay vì chỉ hiện "không kết nối được".
- Khi vào trang Admin, app chỉ hỏi PIN như một lớp chặn nhẹ trên giao diện — PIN thật sự luôn được **Apps Script kiểm tra lại** mỗi khi bạn lưu/sửa/xóa món hoặc hủy đơn. Chỉ cần nhớ và nhập đúng `ADMIN_PIN` đã đặt trong `apps-script.js`; không còn bản sao PIN nào khác trong code cần sửa theo (bản trước có PIN hardcode `1234` trong `app.js`, dễ bị quên đồng bộ khi đổi PIN — bản này đã bỏ).
- Không chia sẻ URL Web App, API key hoặc PIN ra ngoài gia đình. Sao lưu Google Sheet định kỳ trên Drive.
- Món đã bán nên chuyển sang Inactive; không xóa để bảo toàn lịch sử.
- Mỗi lần sửa `apps-script.js` phải **Deploy lại** (Manage deployments → Edit → New version) — Apps Script không tự cập nhật code cho Web App đang chạy.
## Cài đặt Google Apps Script
1. Mở Google Sheets → **Tiện ích mở rộng → Apps Script**
2. Paste toàn bộ nội dung file `apps-script.js`
3. Deploy → **New deployment → Web App**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Copy URL và dán vào app
5. Nếu đã từng deploy trước đó, chọn **Manage deployments → Edit → New version** sau khi cập nhật `apps-script.js`

## Xử lý sự cố: Trang Thu ngân và Quản lý Menu không hiện món
Cả hai trang đều đọc chung dữ liệu thực đơn, nên nếu cả hai cùng trống, hãy kiểm tra theo thứ tự:
1. **Đọc kỹ nội dung toast báo lỗi màu đỏ** khi mở app — bản cập nhật này đã hiện rõ lý do thật (sai API key, sai URL, chưa deploy lại, v.v.) thay vì thông báo chung chung.
2. Trong Google Sheet, kiểm tra có đúng tab tên **`Menu`** (phân biệt hoa/thường) chứa dữ liệu, cột đầu tiên (`id`) không để trống.
3. Trong Apps Script, đảm bảo đã **Deploy → New version** sau lần sửa `apps-script.js` gần nhất (sửa code không tự áp dụng cho Web App đang chạy).
4. Kiểm tra ô **API Key** khi kết nối app khớp đúng `API_KEY` trong `apps-script.js`.
5. Kiểm tra **URL** dán vào app là link kết thúc bằng `/exec` (không phải link Google Sheet, không phải link `/dev`).
6. Nếu vẫn chưa có dữ liệu mẫu, vào Apps Script Editor, chọn hàm `setupDemoData` → **Run** một lần để tạo dữ liệu mẫu ban đầu.