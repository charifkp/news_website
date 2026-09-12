-- ============================================================
--  NEWS PROJECT — MySQL Schema
--  Reference: index.html, news-detail.html, dashboard.html,
--             upload.html, admin-login.html
-- ============================================================

CREATE DATABASE IF NOT EXISTS news_database
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE news_database;

-- ============================================================
-- 1. ADMIN USERS
--    (from admin-login.html: username + password auth)
-- ============================================================
CREATE TABLE admins (
  id           INT          UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username     VARCHAR(100) NOT NULL UNIQUE,
  password     VARCHAR(255) NOT NULL,          -- bcrypt hash
  display_name VARCHAR(150) NOT NULL,
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Demo admin (password = admin1234 hashed with bcrypt)
INSERT INTO admins (username, password, display_name)
VALUES ('admin', '$2b$10$PLACEHOLDER_BCRYPT_HASH', 'Administrator');


-- ============================================================
-- 2. CATEGORIES / TAGS
--    (from news-detail.html: แถลงการณ์, ประกาศ, กิจกรรม, บริการ)
-- ============================================================
CREATE TABLE categories (
  id         INT          UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(100) NOT NULL UNIQUE,      -- e.g. "ประกาศ"
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO categories (name) VALUES
  ('แถลงการณ์'),
  ('ประกาศ'),
  ('กิจกรรม'),
  ('บริการ');


-- ============================================================
-- 3. NEWS
--    (from news-detail.html: NEWS_DB fields)
-- ============================================================
CREATE TABLE news (
  id            INT           UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  category_id   INT           UNSIGNED NOT NULL,
  title         VARCHAR(500)  NOT NULL,
  subtitle      VARCHAR(500)  DEFAULT NULL,     -- "เรื่อง ..."
  content       LONGTEXT      NOT NULL,         -- เนื้อหา (HTML หรือ plain text)
  author        VARCHAR(200)  NOT NULL DEFAULT 'สภานักศึกษา มหาวิทยาลัยมหิดล',
  img_path      VARCHAR(500)  DEFAULT NULL,     -- e.g. image/instagram/xxx.webp
  status        ENUM('published','draft')
                              NOT NULL DEFAULT 'draft',
  views         INT           UNSIGNED NOT NULL DEFAULT 0,
  published_at  DATE          DEFAULT NULL,     -- วันที่เผยแพร่ (พ.ศ. แปลงเป็น ค.ศ.)
  created_by    INT           UNSIGNED NOT NULL, -- FK → admins.id
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_news_category FOREIGN KEY (category_id) REFERENCES categories(id),
  CONSTRAINT fk_news_admin    FOREIGN KEY (created_by)  REFERENCES admins(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Indexes for filtering & sorting (ใช้ใน news-history.html)
CREATE INDEX idx_news_status       ON news(status);
CREATE INDEX idx_news_published_at ON news(published_at DESC);
CREATE INDEX idx_news_category     ON news(category_id);


-- ============================================================
-- 4. NEWS ATTACHMENTS (PDF)
--    (from news-detail.html: pdfs: [{ name, size, url }])
-- ============================================================
CREATE TABLE news_attachments (
  id           INT          UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  news_id      INT          UNSIGNED NOT NULL,
  file_name    VARCHAR(300) NOT NULL,           -- e.g. "แถลงการณ์.pdf"
  file_path    VARCHAR(500) NOT NULL,           -- e.g. "docs/statement.pdf"
  file_size    VARCHAR(50)  DEFAULT NULL,       -- e.g. "245 KB"
  sort_order   TINYINT      UNSIGNED NOT NULL DEFAULT 0,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_attachment_news FOREIGN KEY (news_id) REFERENCES news(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ============================================================
-- 5. NEWS RELATED (ข่าวที่เกี่ยวข้อง)
--    (from news-detail.html: relatedIds: ['2','4'])
-- ============================================================
CREATE TABLE news_related (
  news_id         INT UNSIGNED NOT NULL,
  related_news_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (news_id, related_news_id),
  CONSTRAINT fk_related_news    FOREIGN KEY (news_id)         REFERENCES news(id) ON DELETE CASCADE,
  CONSTRAINT fk_related_target  FOREIGN KEY (related_news_id) REFERENCES news(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ============================================================
-- 6. ACTIVITY LOG
--    (from dashboard.html: กิจกรรมล่าสุด — add/edit/delete)
-- ============================================================
CREATE TABLE activity_logs (
  id          INT          UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_id    INT          UNSIGNED NOT NULL,
  action      ENUM('create','update','delete') NOT NULL,
  target_id   INT          UNSIGNED NOT NULL,   -- news.id
  description VARCHAR(500) DEFAULT NULL,        -- e.g. "เพิ่มข่าว: ..."
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_log_admin FOREIGN KEY (admin_id) REFERENCES admins(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_log_created ON activity_logs(created_at DESC);


-- ============================================================
-- 7. SEED DATA
--    (5 ข่าวจาก news-detail.html NEWS_DB)
-- ============================================================
INSERT INTO news
  (id, category_id, title, subtitle, content, author, img_path, status, published_at, created_by)
VALUES
(1,
 (SELECT id FROM categories WHERE name='แถลงการณ์'),
 'แถลงการณ์ร่วมสภานักศึกษา มหาวิทยาลัยมหิดล และมหาวิทยาลัยธรรมศาสตร์ ศูนย์ลำปาง',
 'เรื่อง ชะตากรรม ร่าง พรบ. อากาศสะอาด',
 'สภานักศึกษา มหาวิทยาลัยมหิดล และสภานักศึกษา มหาวิทยาลัยธรรมศาสตร์ ศูนย์ลำปาง ขอออกแถลงการณ์ร่วมเพื่อแสดงจุดยืนและความห่วงใยต่อสถานการณ์ร่าง พระราชบัญญัติอากาศสะอาด',
 'สภานักศึกษา มหาวิทยาลัยมหิดล',
 'image/instagram/694713966_18091086695595564_3927902782432047810_n.webp',
 'published', '2025-05-12', 1),

(2,
 (SELECT id FROM categories WHERE name='ประกาศ'),
 'ประกาศสภานักศึกษามหาวิทยาลัยมหิดล',
 'เรื่อง ประกาศรายชื่อคณะกรรมการสโมสรนักศึกษามหาวิทยาลัยมหิดล ประจำปีการศึกษา 2569',
 'ตามที่สภานักศึกษา มหาวิทยาลัยมหิดล ได้ดำเนินการสรรหาและคัดเลือกนักศึกษาเพื่อดำรงตำแหน่งคณะกรรมการสโมสรนักศึกษา ประจำปีการศึกษา 2569 เสร็จสิ้นแล้วนั้น',
 'สภานักศึกษา มหาวิทยาลัยมหิดล',
 'image/instagram/659591458_18090415328595564_8426637387155158581_n.webp',
 'published', '2025-05-07', 1),

(3,
 (SELECT id FROM categories WHERE name='ประกาศ'),
 'ประกาศสภานักศึกษามหาวิทยาลัยมหิดล',
 'เรื่อง ประกาศรายชื่อสมาชิกสภานักศึกษามหาวิทยาลัยมหิดล ประจำปีวาระ 2569 (ฉบับไม่เป็นทางการ)',
 'สภานักศึกษา มหาวิทยาลัยมหิดล ขอประกาศรายชื่อสมาชิกสภานักศึกษา ประจำปีวาระ 2569 (ฉบับไม่เป็นทางการ) เพื่อให้นักศึกษาและบุคลากรได้รับทราบ',
 'สภานักศึกษา มหาวิทยาลัยมหิดล',
 'image/instagram/671187312_18088653605595564_5971510714895221743_n.webp',
 'published', '2025-04-23', 1),

(4,
 (SELECT id FROM categories WHERE name='แถลงการณ์'),
 'แถลงการณ์ขอโทษ',
 'กรณีความผิดพลาดในลำดับการรับรองรายชื่อนักศึกษาสรรหาเพื่อดำรงตำแหน่งคณะกรรมการสโมสรนักศึกษามหาวิทยาลัยมหิดล ประจำปีการศึกษา 2569',
 'สภานักศึกษา มหาวิทยาลัยมหิดล ขอแสดงความรับผิดชอบและขอโทษต่อความผิดพลาดที่เกิดขึ้นในกระบวนการรับรองรายชื่อนักศึกษา',
 'สภานักศึกษา มหาวิทยาลัยมหิดล',
 'image/instagram/674395107_18088653500595564_8262444920406159664_n.webp',
 'published', '2025-04-23', 1),

(5,
 (SELECT id FROM categories WHERE name='ประกาศ'),
 'นักศึกษามหิดลทุกคนเตรียมแอพ We Mahidol ให้พร้อม!',
 'ลงมติรับรองรายชื่อนักศึกษาสรรหาเป็นคณะกรรมการสโมสรนักศึกษามหาวิทยาลัยมหิดล ประจำปีการศึกษา 2569',
 'สภานักศึกษา มหาวิทยาลัยมหิดล ขอเชิญชวนนักศึกษาทุกท่านร่วมลงมติรับรองรายชื่อนักศึกษาสรรหาผ่านแอพ We Mahidol วันที่ 21-22 เมษายน 2568',
 'สภานักศึกษา มหาวิทยาลัยมหิดล',
 'image/instagram/670603463_18088192883595564_5219576456899627411_n.webp',
 'published', '2025-04-20', 1);


-- ============================================================
-- 8. SEED ATTACHMENTS (PDF)
-- ============================================================
INSERT INTO news_attachments (news_id, file_name, file_path, file_size, sort_order) VALUES
(1, 'แถลงการณ์ร่วม-อากาศสะอาด.pdf',              'docs/statement-clean-air.pdf',    '245 KB', 0),
(2, 'ประกาศรายชื่อคณะกรรมการสโมสร-2569.pdf',      'docs/committee-list-2569.pdf',    '380 KB', 0),
(2, 'ภาคผนวก-รายชื่อ.pdf',                        'docs/appendix-list-2569.pdf',     '120 KB', 1),
(3, 'รายชื่อสมาชิกสภานักศึกษา-2569-ไม่เป็นทางการ.pdf', 'docs/members-unofficial-2569.pdf', '210 KB', 0),
(4, 'แถลงการณ์ขอโทษ-คณะกรรมการสโมสร.pdf',        'docs/apology-statement.pdf',      '185 KB', 0);


-- ============================================================
-- 9. SEED RELATED NEWS
-- ============================================================
INSERT INTO news_related (news_id, related_news_id) VALUES
(1,2),(1,4),
(2,3),(2,5),
(3,2),(3,4),
(4,1),(4,3),
(5,2),(5,3);


-- ============================================================
-- USEFUL QUERIES
-- ============================================================

-- Get all published news (news-history.html)
-- SELECT n.id, c.name AS tag, n.title, n.subtitle, n.published_at,
--        n.img_path, n.views
-- FROM   news n
-- JOIN   categories c ON c.id = n.category_id
-- WHERE  n.status = 'published'
-- ORDER  BY n.published_at DESC;

-- Get single news detail (news-detail.html?id=X)
-- SELECT n.*, c.name AS tag
-- FROM   news n
-- JOIN   categories c ON c.id = n.category_id
-- WHERE  n.id = ? AND n.status = 'published';

-- Get attachments for a news
-- SELECT * FROM news_attachments WHERE news_id = ? ORDER BY sort_order;

-- Get related news
-- SELECT n.id, n.title, n.published_at, n.img_path
-- FROM   news_related r
-- JOIN   news n ON n.id = r.related_news_id
-- WHERE  r.news_id = ? AND n.status = 'published';

-- Dashboard stats
-- SELECT
--   COUNT(*)                                         AS total,
--   SUM(status = 'published')                        AS published,
--   SUM(status = 'draft')                            AS draft,
--   SUM(views)                                       AS total_views
-- FROM news;

-- Recent activity log
-- SELECT l.action, l.description, l.created_at, a.display_name
-- FROM   activity_logs l
-- JOIN   admins a ON a.id = l.admin_id
-- ORDER  BY l.created_at DESC
-- LIMIT  10;

USE news_database;
SET SQL_SAFE_UPDATES = 0;
DELETE FROM news_attachments
WHERE file_path LIKE 'docs/%';

SELECT id, news_id, file_name, file_path FROM news_attachments;
SET SQL_SAFE_UPDATES = 1;

DELETE FROM news_attachments
WHERE file_path LIKE 'uploads/pdf_%25%' -- %25 = encoded %
   OR file_path LIKE 'uploads/pdf_%-%%'; -- contains % after timestamp
   
SELECT id, news_id, file_name, file_path, file_size FROM news_attachments;
DELETE FROM news_attachments WHERE news_id = 1;
SELECT id, news_id, file_name, file_path FROM news_attachments WHERE news_id = 1;

-- ============================================================
--  ADD MULTI-IMAGE SUPPORT — news_images table
--  Run this once on existing news_database
-- ===========================================================

CREATE TABLE IF NOT EXISTS news_images (
  id         INT          UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  news_id    INT          UNSIGNED NOT NULL,
  img_path   VARCHAR(500) NOT NULL,        -- e.g. uploads/img_169...jpg
  sort_order TINYINT      UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
 
  CONSTRAINT fk_image_news FOREIGN KEY (news_id) REFERENCES news(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE INDEX idx_images_news ON news_images(news_id, sort_order);

-- Migrate existing single img_path (from `news` table) into news_images
-- so old news keep their cover image as image #1 in the gallery
INSERT INTO news_images (news_id, img_path, sort_order)
SELECT id, img_path, 0
FROM news
WHERE img_path IS NOT NULL AND img_path != ''
  AND id NOT IN (SELECT DISTINCT news_id FROM news_images);

-- ============================================================
--  Sync the seed admin's password hash with settings.html
--  The original schema.sql inserted a placeholder bcrypt hash
--  that doesn't match anything. This sets it to the SHA-256
--  hash of "admin1234" so changing it via settings.html works
--  the first time without needing the demo-mode fallback.
-- ============================================================
UPDATE admins
SET password = SHA2('admin1234', 256)
WHERE id = 1;
 

-- verify
SELECT * FROM admins;
show tables;
<<<<<<< HEAD
        
=======
        
 
>>>>>>> 38c5ed2 (news update)
