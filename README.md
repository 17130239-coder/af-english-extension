# 🎬 AF English - Subtitle Downloader & Vocabulary POS Studio (Netflix & YouTube)

Tiện ích mở rộng cao cấp (Chrome Extension Manifest V3) giúp bạn **tải toàn bộ phụ đề tiếng Anh trên Netflix và YouTube** dưới các định dạng chuẩn (`.SRT`, `.VTT`, `.TXT`), đồng thời **tự động phân tích và tách từ vựng theo 4 loại từ: Danh từ (Nouns), Động từ (Verbs), Tính từ (Adjectives), Trạng từ (Adverbs)**, tra cứu nghĩa tiếng Việt offline (A1–C2), phát âm TTS, flashcard 3D và xuất thẻ Anki / CSV để học tiếng Anh một cách hiệu quả và dễ dàng nhất!

Ngoài ra, tiện ích vẫn duy trì tính năng **sao chép phụ đề 1-chạm** trên video, đồng bộ dữ liệu đám mây **Neon Serverless Postgres** và dịch ngữ pháp thông minh với **AI (9Router / Gemini / OpenAI)**.

---

## 🌟 Tính Năng Nổi Bật

### 1. 📥 Tải Phụ Đề Tiếng Anh Trọn Gói (Netflix & YouTube)
- **Hỗ trợ đầy đủ Netflix**:
  - Tự động bắt streaming manifest của tập phim / phim lẻ Netflix (`webvtt-lssdh-ios8`, `dfxp-ls-sdh`, `imsc1.1`).
  - Hỗ trợ đổi tập / đổi mùa tự động trong series Netflix.
  - Tải nhanh phụ đề dạng:
    - **`.SRT`**: Định dạng SubRip tương thích mọi trình phát VLC, TV, máy tính.
    - **`.VTT`**: Định dạng WebVTT tiêu chuẩn web và player hiện đại.
    - **`.TXT`**: Văn bản hội thoại mượt mà, loại bỏ timestamp rối rắm, gom câu tự nhiên để đọc và ôn tập.
- **Hỗ trợ đầy đủ YouTube**:
  - Tự động nhận diện phụ đề tiếng Anh của video (chuẩn English hoặc English [CC] / Tự động tạo).
  - Tải nhanh file `.SRT`, `.VTT`, `.TXT` chỉ với 1 click.
- **Nút bấm trực quan (Floating Widget)**:
  - Một nút nổi bo tròn tinh tế `#af-netflix-widget` và `#af-youtube-widget` xuất hiện ngay góc trên trình phát phim/video, tiện lợi tải phụ đề hoặc mở bộ tách từ vựng bất cứ lúc nào.
  - Có thể thao tác trực tiếp từ cửa sổ **Popup Extension** hoặc **Dashboard Studio**.

---

### 2. ⚡ Tách Từ Vựng Theo Loại Từ (POS: Danh từ, Động từ, Tính từ, Trạng từ)
Không còn tình trạng học lan man cả nghìn từ rời rạc. Tiện ích sử dụng thư viện NLP Compromise chạy hoàn toàn offline trên trình duyệt để phân tách chính xác:

- 🔵 **Danh từ (Nouns)**: Đưa số nhiều về số ít nguyên mẫu (lemmatization), lọc bỏ các đại từ chung chung như *it, they, someone*.
- 🟢 **Động từ (Verbs)**: Chuẩn hóa mọi thì quá khứ, tiếp diễn, hoàn thành về **dạng nguyên mẫu (Infinitive)**. Tự động lọc sạch các trợ động từ dư thừa (*is, are, was, were, been, have, had, do, did*), chỉ giữ lại động từ mang ý nghĩa.
- 🟡 **Tính từ (Adjectives)**: Chuẩn hóa tính từ so sánh hơn/nhất về dạng gốc (*bigger -> big*, *happiest -> happy*).
- 🟣 **Trạng từ (Adverbs)**: Tách các trạng từ bổ nghĩa hành động, trạng thái (kể cả trạng từ đuôi `-ly`), tự động liên kết về tính từ gốc để tra nghĩa.
- ⚪ **Tất cả từ (All Vocab)**: Xem tổng quan toàn bộ kho từ vựng của video.

Mỗi từ vựng được tự động:
1. **Đếm tần suất xuất hiện (Frequency count)** trong video (Ví dụ: `appear 5x`).
2. **Gán nhãn cấp độ CEFR** từ A1, A2, B1, B2 đến C1, C2.
3. **Tra nghĩa tiếng Việt & Phiên âm quốc tế IPA** từ bộ từ điển ngoại tuyến tích hợp sẵn 2,500+ từ vựng cốt lõi.
4. **Trích xuất câu ngữ cảnh (Context sentence)** thực tế kèm timestamp chính xác.
5. **Nút phát âm chuẩn bản xứ (TTS)**: Click biểu tượng loa để nghe phát âm ngay tức thì.
6. **Nhảy trực tiếp đến đoạn nói trong phim (Seek to Timestamp)**: Bấm `▶ 04:12` để video tự nhảy đến phân cảnh chứa câu nói đó.

---

### 3. 🃏 Chế Độ Flashcard Học Từ 3D & Xuất Thẻ Anki / CSV
- **Flashcard 3D Interactive**: Lật thẻ trực quan với hiệu ứng 3D mượt mà:
  - *Mặt trước*: Từ vựng tiếng Anh, nhãn loại từ (N, V, Adj, Adv), phiên âm IPA và câu ngữ cảnh trong phim.
  - *Mặt sau*: Nghĩa tiếng Việt đầy đủ và giải thích.
  - Hỗ trợ phím mũi tên `←` / `→` hoặc `Space` để lật thẻ và chuyển từ.
- **Xuất file Anki (.txt)**: Định dạng chuẩn `#separator:Tab` với thẻ HTML có màu sắc nổi bật, IPA và câu ví dụ, sẵn sàng để Import vào Anki chỉ với 1 thao tác.
- **Xuất file CSV (.csv)**: Tương thích 100% Microsoft Excel, Google Sheets, Notion Database.
- **Lưu đồng bộ lên Neon Cloud**: Nút **"Lưu vào Neon DB"** cho phép đồng bộ hàng loạt các từ vựng đã lọc vào cơ sở dữ liệu học tập cá nhân.

---

### 4. 🗂️ Không Gian Học Tập Đa Năng (Subtitle & Vocab Studio)
Trang Dashboard cung cấp 2 chế độ xem linh hoạt:
1. **Vocabulary Studio**:
   - Tự động nhận diện video Netflix hoặc YouTube đang phát trên tab đang hoạt động.
   - Kéo-thả (Drag & Drop) hoặc tải file `.srt`, `.vtt` từ máy tính lên.
   - Dán trực tiếp văn bản phụ đề bất kỳ vào để phân tích từ vựng tức thì.
   - Thẻ thống kê trực quan số lượng Danh từ, Động từ, Tính từ, Trạng từ.
   - Bộ lọc linh hoạt: Lọc theo độ khó CEFR (A1 -> C2), lọc theo tần suất xuất hiện, sắp xếp theo A-Z hoặc tần suất nhiều nhất.
2. **Danh sách phụ đề đã lưu (Saved Subtitles)**:
   - Quản lý các câu phụ đề đã lưu 1-chạm hoặc bôi đen khi xem video.
   - Dịch tự động với AI (9Router, Gemini, OpenAI, Google Translate).
   - Chỉnh sửa câu, tạo câu ví dụ và quản lý mục yêu thích ⭐.

---

## 🚀 Hướng Dẫn Cài Đặt (Load Unpacked)

Tiện ích tương thích với toàn bộ trình duyệt Chromium: **Google Chrome, Microsoft Edge, Brave, Cốc Cốc, Arc...**

1. Mở trang quản lý tiện ích trình duyệt:
   - Trên Chrome/Brave: `chrome://extensions/`
   - Trên Edge: `edge://extensions/`
2. Bật công tắc **"Chế độ dành cho nhà phát triển"** (Developer mode) ở góc trên bên phải.
3. Bấm nút **"Tải tiện ích đã giải nén"** (Load unpacked).
4. Chọn thư mục dự án:
   ```
   /Users/andynguyen/workspace/youtube-subtitle-copy-extension
   ```
5. Nhấn **Select / Chọn**. Tiện ích `af-english` phiên bản mới nhất sẽ sẵn sàng hoạt động!

---

## 💡 Hướng Dẫn Sử Dụng Chi Tiết

### 1. Khi xem phim trên Netflix:
1. Mở phim hoặc tập phim bất kỳ trên [netflix.com](https://www.netflix.com).
2. Đảm bảo phim đã bật phụ đề tiếng Anh (English hoặc English [CC]).
3. Bạn sẽ thấy biểu tượng tròn **AF English** ở góc trên player hoặc mở biểu tượng Extension trên thanh công cụ:
   - Bấm **.SRT / .VTT / .TXT** để tải ngay file phụ đề về máy.
   - Bấm **"⚡ Tách từ vựng"** để mở giao diện phân tách Danh từ, Động từ, Tính từ, Trạng từ.
   - Bạn có thể luyện nghe từ, bấm nhảy đến phân cảnh trong phim, hoặc luyện thẻ Flashcard 3D!

### 2. Khi xem video trên YouTube:
1. Mở video bài học, tin tức, TED Talk hoặc vlog trên [youtube.com](https://www.youtube.com).
2. Tiện ích tự động phát hiện phụ đề tiếng Anh:
   - Bấm vào widget nổi góc trên bên phải player hoặc mở popup tiện ích để tải phụ đề `.SRT`, `.VTT`, `.TXT`.
   - Bấm **"Tách từ vựng (POS)"** để xem ngay danh sách từ phân loại theo 4 nhóm từ vựng.
   - Click trực tiếp lên bất kỳ dòng phụ đề nào trên video để copy nhanh 1-chạm vào Clipboard và lưu vào danh sách học.

### 3. Phân tích file phụ đề có sẵn trên máy tính:
1. Bấm vào icon Extension -> Chọn **Dashboard**.
2. Chọn tab **"Phân tích từ vựng (Studio)"**.
3. Kéo thả file `.srt` hoặc `.vtt` bạn có vào khung tải lên hoặc dán nội dung vào ô text.
4. Bấm **"⚡ Phân tích từ vựng"** -> Toàn bộ kho từ sẽ được phân loại thành Danh từ, Động từ, Tính từ, Trạng từ trong tích tắc!

---

## 📂 Cấu Trúc Mã Nguồn

```
youtube-subtitle-copy-extension/
├── manifest.json            # Cấu hình Manifest V3, permissions (Netflix, YouTube, Storage)
├── lib/
│   ├── subtitleParser.js    # Bộ phân tích phụ đề SRT, WebVTT, Netflix TTML XML & YouTube TimedText
│   ├── compromise.js        # Thư viện NLP Compromise offline (Part-of-Speech & Lemmatization)
│   ├── cefrDict.js          # Từ điển offline CEFR (A1-C2) & 2,500+ định nghĩa tiếng Việt kèm IPA
│   ├── vocabAnalyzer.js     # Engine tách Nouns, Verbs, Adjectives, Adverbs, tần suất & Anki exporter
│   ├── neonClient.js        # Neon Serverless Postgres Client (HTTPS /sql REST API)
│   ├── utils.js             # Hàm tiện ích (TTS, download file, format timestamp, clipboard)
│   └── constants.js         # Hằng số hệ thống
├── background/
│   └── background.js        # Service Worker: NLP analysis, Neon sync, fetch proxy, media status
├── content/
│   ├── netflixInjected.js   # Script tiêm MAIN world bắt manifest & player tracks của Netflix
│   ├── netflixContent.js    # Content script Netflix: Floating widget, download & modal tách từ vựng
│   ├── netflixContent.css   # Dark theme cao cấp & glassmorphism trên player Netflix
│   ├── youtubeInjected.js   # Script MAIN world trích xuất caption tracks của YouTube Player
│   ├── content.js           # Bắt click phụ đề YouTube, Floating widget & modal tách từ vựng
│   └── content.css          # CSS tương tác phụ đề YouTube, modal & từ vựng
├── popup/
│   ├── popup.html           # Thẻ nhận diện Netflix/YouTube, nút tải phụ đề & tách từ vựng
│   ├── popup.css            # Giao diện Zinc/Amber tối giản
│   └── popup.js             # Kết nối live tab media, tải phụ đề và quản lý lịch sử
├── dashboard/
│   ├── dashboard.html       # Studio phân tích từ vựng 4 POS + Quản lý phụ đề & Flashcard 3D
│   ├── dashboard.css        # Hệ thống giao diện tối chuyên nghiệp
│   └── dashboard.js         # Logic VocabStudioManager, Flashcard controller & Neon Cloud Sync
└── README.md                # Tài liệu hướng dẫn sử dụng toàn diện
```

---

## 🛡️ Quyền Riêng Tư & An Toàn
- Toàn bộ quá trình phân tích từ vựng và tra từ điển diễn ra **100% offline trên trình duyệt** của bạn, không gửi phụ đề của bạn lên bất kỳ máy chủ bên thứ ba nào.
- Dữ liệu đám mây (nếu bật) được lưu trữ riêng biệt trên tài khoản **Neon Serverless Postgres** của bạn.
