const express = require('express');
const session = require('express-session');
const path = require('path');
const slugify = require('slugify');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const fs = require('fs');
const { initDB, getAll, getOne, run, getSettings, updateSetting } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

// Security: Disable Express fingerprinting
app.disable('x-powered-by');

// Multer Storage Configuration (Strict Whitelist against malicious uploads)
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = path.join(__dirname, 'public/uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname).toLowerCase();
    const safeExt = ALLOWED_EXTENSIONS.includes(ext) ? ext : '.jpg';
    cb(null, 'banner-' + uniqueSuffix + safeExt);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_MIME_TYPES.includes(file.mimetype) && ALLOWED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Format file tidak didukung! Hanya gambar .jpg, .jpeg, .png, .webp, atau .gif yang diizinkan.'));
    }
  }
});

// Middleware
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.json({ limit: '20mb' }));

// Global middleware to pass settings to all views
app.use((req, res, next) => {
  try {
    res.locals.settings = getSettings();
  } catch (e) {
    res.locals.settings = {};
  }
  next();
});

// Security: Helmet HTTP Headers
app.use(helmet({
  contentSecurityPolicy: false, // Disabled for inline scripts/styles (AOS, Swiper, Quill)
}));

// Security: CORS Configuration
const corsOptionsDelegate = (req, callback) => {
  const origin = req.header('Origin');
  const corsOptions = { credentials: true };

  // Allow requests with no origin or string "null" (direct navigations, standard form POSTs, curl, privacy mode)
  if (!origin || origin === 'null') {
    corsOptions.origin = true;
    return callback(null, corsOptions);
  }

  try {
    const originUrl = new URL(origin);
    const originHost = originUrl.host.toLowerCase();
    const originHostname = originUrl.hostname.toLowerCase();
    const reqHost = (req.get('host') || '').toLowerCase();
    const reqHostname = (req.hostname || '').toLowerCase();

    // 1. Same-origin requests (Origin host matches server Host) are always allowed
    if (reqHost && (originHost === reqHost || originHostname === reqHostname)) {
      corsOptions.origin = true;
      return callback(null, corsOptions);
    }

    // 2. Allowed domain whitelist (*.khatamunnabiyyin.net, localhost, 127.0.0.1, khataminstitute)
    const defaultAllowedDomains = [
      'khatamunnabiyyin.net',
      'khataminstitute.com',
      'khatam-institute.com',
      'localhost',
      '127.0.0.1'
    ];

    const envOrigins = (process.env.ALLOWED_ORIGINS || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);

    const allAllowed = [...defaultAllowedDomains, ...envOrigins];

    const isAllowed = allAllowed.some(domain => 
      originHostname === domain || originHostname.endsWith('.' + domain)
    );

    if (isAllowed) {
      corsOptions.origin = true;
      return callback(null, corsOptions);
    }
  } catch (e) {}

  // For untrusted cross-origin requests, disable CORS headers cleanly without throwing a 500 error
  corsOptions.origin = false;
  return callback(null, corsOptions);
};

app.use(cors(corsOptionsDelegate));

// Security: Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300,
});
app.use(limiter);

const loginLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 15,
  message: 'Terlalu banyak percobaan login dari IP ini. Silakan coba lagi setelah satu jam.',
});

const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  message: 'Terlalu banyak percobaan perubahan password. Silakan coba lagi setelah 15 menit.',
});

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

app.use(session({
  name: 'ki_sid', // Obfuscated session cookie name
  secret: process.env.SESSION_SECRET || 'khatam-institute-production-secure-key-replace-in-env',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.COOKIE_SECURE === 'true' || (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false'),
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 7 // 7 days
  }
}));

// Auth Middleware
const requireAuth = (req, res, next) => {
  if (req.session.userId) {
    next();
  } else {
    res.redirect('/admin/login');
  }
};

// --- PUBLIC ROUTES ---

app.get('/', (req, res) => {
  const posts = getAll(`
    SELECT posts.*, categories.name AS category_name, categories.slug AS category_slug 
    FROM posts 
    LEFT JOIN categories ON posts.category_id = categories.id 
    ORDER BY posts.created_at DESC 
    LIMIT 6
  `);
  const banners = getAll('SELECT * FROM banners WHERE is_active = 1 ORDER BY order_num ASC, id ASC');
  const categories = getAll('SELECT * FROM categories ORDER BY name ASC');
  const settings = getSettings();
  res.render('index', { posts, banners, categories, settings });
});

app.get('/blog', (req, res) => {
  const q = (req.query.q || '').trim();
  const categorySlug = (req.query.category || '').trim();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = 10;
  const offset = (page - 1) * limit;

  const categories = getAll(`
    SELECT categories.*, COUNT(posts.id) AS post_count 
    FROM categories 
    LEFT JOIN posts ON categories.id = posts.category_id 
    GROUP BY categories.id 
    ORDER BY categories.name ASC
  `);

  let currentCategory = null;
  if (categorySlug) {
    currentCategory = getOne('SELECT * FROM categories WHERE slug = ?', [categorySlug]);
  }

  let whereClauses = [];
  let params = [];

  if (currentCategory) {
    whereClauses.push('posts.category_id = ?');
    params.push(currentCategory.id);
  }

  if (q) {
    whereClauses.push('(posts.title LIKE ? OR posts.content LIKE ? OR posts.meta_description LIKE ?)');
    const searchTerm = `%${q}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  const whereSql = whereClauses.length > 0 ? 'WHERE ' + whereClauses.join(' AND ') : '';

  const countRow = getOne(`SELECT COUNT(*) as total FROM posts ${whereSql}`, params);
  const totalCount = countRow ? countRow.total : 0;

  const posts = getAll(`
    SELECT posts.*, categories.name AS category_name, categories.slug AS category_slug 
    FROM posts 
    LEFT JOIN categories ON posts.category_id = categories.id 
    ${whereSql} 
    ORDER BY posts.created_at DESC 
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  const totalPages = Math.ceil(totalCount / limit) || 1;

  res.render('blog', {
    posts,
    categories,
    currentCategory,
    currentPage: page,
    totalPages,
    totalPosts: totalCount,
    searchQuery: q,
    limit
  });
});

app.get('/tentang', (req, res) => {
  const settings = getSettings();
  const categories = getAll('SELECT * FROM categories ORDER BY name ASC');
  res.render('about', { settings, categories });
});

app.get('/about', (req, res) => {
  res.redirect('/tentang');
});

app.get('/profil', (req, res) => {
  res.redirect('/#profil');
});

app.get('/blog/:slug', (req, res) => {
  const post = getOne(`
    SELECT posts.*, categories.name AS category_name, categories.slug AS category_slug 
    FROM posts 
    LEFT JOIN categories ON posts.category_id = categories.id 
    WHERE posts.slug = ?
  `, [req.params.slug]);

  if (!post) {
    return res.status(404).render('404');
  }
  res.render('post', { post });
});

// --- ADMIN ROUTES ---

app.get('/admin/login', (req, res) => {
  if (req.session.userId) return res.redirect('/admin');
  res.render('admin/login', { error: null });
});

app.post('/admin/login', loginLimiter, (req, res) => {
  const { username, password } = req.body;
  const user = getOne('SELECT * FROM users WHERE username = ?', [username]);
  
  if (user && bcrypt.compareSync(password, user.password)) {
    req.session.userId = user.id;
    res.redirect('/admin');
  } else {
    res.render('admin/login', { error: 'Username atau password salah' });
  }
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
});

app.get('/admin', requireAuth, (req, res) => {
  const posts = getAll(`
    SELECT posts.*, categories.name AS category_name, categories.slug AS category_slug 
    FROM posts 
    LEFT JOIN categories ON posts.category_id = categories.id 
    ORDER BY posts.created_at DESC
  `);
  res.render('admin/dashboard', { posts });
});

app.get('/admin/posts/new', requireAuth, (req, res) => {
  const categories = getAll('SELECT * FROM categories ORDER BY name ASC');
  res.render('admin/edit', { post: null, categories });
});

// Helper to parse dates reliably (supports YYYY-MM-DD, DD/MM/YYYY, etc.) without swapping day and month
function formatPostDate(input) {
  if (!input || typeof input !== 'string' || !input.trim()) return null;
  const str = input.trim();
  
  // 1. Matches YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (isoMatch) {
    const y = isoMatch[1];
    const m = isoMatch[2].padStart(2, '0');
    const d = isoMatch[3].padStart(2, '0');
    return `${y}-${m}-${d} 00:00:00`;
  }
  
  // 2. Matches DD/MM/YYYY or DD-MM-YYYY (Indonesian format)
  const idMatch = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
  if (idMatch) {
    const d = idMatch[1].padStart(2, '0');
    const m = idMatch[2].padStart(2, '0');
    const y = idMatch[3];
    return `${y}-${m}-${d} 00:00:00`;
  }

  // 3. Fallback to Date parser
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d} 00:00:00`;
  }
  return null;
}

// Helper to sanitize Quill HTML against XSS vectors (script tags, dangerous inline handlers)
function sanitizeHtmlContent(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/\bon\w+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\bon\w+\s*=\s*[^>\s]+/gi, '')
    .replace(/href\s*=\s*(['"])javascript:[^'"]*\1/gi, 'href="#"');
}

app.post('/admin/posts', requireAuth, (req, res) => {
  const { title, content, meta_description, created_at, category_id } = req.body;
  const slug = slugify(title, { lower: true, strict: true });
  const catId = category_id && category_id.trim() ? parseInt(category_id) : null;
  const cleanContent = sanitizeHtmlContent(content);
  
  try {
    const postDate = formatPostDate(created_at);
    if (postDate) {
      run('INSERT INTO posts (title, slug, content, meta_description, created_at, category_id) VALUES (?, ?, ?, ?, ?, ?)', [title, slug, cleanContent, meta_description, postDate, catId]);
    } else {
      run('INSERT INTO posts (title, slug, content, meta_description, category_id) VALUES (?, ?, ?, ?, ?)', [title, slug, cleanContent, meta_description, catId]);
    }
    res.redirect('/admin');
  } catch (error) {
    res.status(400).send('Error creating post: ' + error.message);
  }
});

app.get('/admin/posts/:id/edit', requireAuth, (req, res) => {
  const post = getOne('SELECT * FROM posts WHERE id = ?', [req.params.id]);
  if (!post) return res.status(404).send('Post not found');
  const categories = getAll('SELECT * FROM categories ORDER BY name ASC');
  res.render('admin/edit', { post, categories });
});

app.post('/admin/posts/:id', requireAuth, (req, res) => {
  const { title, content, meta_description, created_at, category_id } = req.body;
  const slug = slugify(title, { lower: true, strict: true });
  const catId = category_id && category_id.trim() ? parseInt(category_id) : null;
  const cleanContent = sanitizeHtmlContent(content);
  
  try {
    const postDate = formatPostDate(created_at);
    if (postDate) {
      run('UPDATE posts SET title = ?, slug = ?, content = ?, meta_description = ?, created_at = ?, category_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [title, slug, cleanContent, meta_description, postDate, catId, req.params.id]);
    } else {
      run('UPDATE posts SET title = ?, slug = ?, content = ?, meta_description = ?, category_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [title, slug, cleanContent, meta_description, catId, req.params.id]);
    }
    res.redirect('/admin');
  } catch (error) {
    res.status(400).send('Error updating post: ' + error.message);
  }
});

app.post('/admin/posts/:id/delete', requireAuth, (req, res) => {
  run('DELETE FROM posts WHERE id = ?', [req.params.id]);
  res.redirect('/admin');
});

// --- ADMIN CATEGORIES ROUTES ---

app.get('/admin/categories', requireAuth, (req, res) => {
  const categories = getAll(`
    SELECT categories.*, COUNT(posts.id) AS post_count 
    FROM categories 
    LEFT JOIN posts ON categories.id = posts.category_id 
    GROUP BY categories.id 
    ORDER BY categories.name ASC
  `);
  res.render('admin/categories', { categories, error: null, success: null });
});

app.post('/admin/categories', requireAuth, (req, res) => {
  const { name, slug } = req.body;
  if (!name || !name.trim()) {
    const categories = getAll(`
      SELECT categories.*, COUNT(posts.id) AS post_count 
      FROM categories 
      LEFT JOIN posts ON categories.id = posts.category_id 
      GROUP BY categories.id 
      ORDER BY categories.name ASC
    `);
    return res.render('admin/categories', { categories, error: 'Nama kategori wajib diisi.', success: null });
  }

  const catName = name.trim();
  const catSlug = slugify(slug && slug.trim() ? slug : catName, { lower: true, strict: true });

  try {
    run('INSERT INTO categories (name, slug) VALUES (?, ?)', [catName, catSlug]);
    res.redirect('/admin/categories');
  } catch (err) {
    const categories = getAll(`
      SELECT categories.*, COUNT(posts.id) AS post_count 
      FROM categories 
      LEFT JOIN posts ON categories.id = posts.category_id 
      GROUP BY categories.id 
      ORDER BY categories.name ASC
    `);
    res.render('admin/categories', { categories, error: 'Gagal menambah kategori: Nama atau slug mungkin sudah digunakan.', success: null });
  }
});

app.post('/admin/categories/:id/edit', requireAuth, (req, res) => {
  const { name, slug } = req.body;
  const catName = (name || '').trim();
  const catSlug = slugify(slug && slug.trim() ? slug : catName, { lower: true, strict: true });

  try {
    run('UPDATE categories SET name = ?, slug = ? WHERE id = ?', [catName, catSlug, req.params.id]);
    res.redirect('/admin/categories');
  } catch (err) {
    const categories = getAll(`
      SELECT categories.*, COUNT(posts.id) AS post_count 
      FROM categories 
      LEFT JOIN posts ON categories.id = posts.category_id 
      GROUP BY categories.id 
      ORDER BY categories.name ASC
    `);
    res.render('admin/categories', { categories, error: 'Gagal memperbarui kategori: ' + err.message, success: null });
  }
});

app.post('/admin/categories/:id/delete', requireAuth, (req, res) => {
  try {
    run('UPDATE posts SET category_id = NULL WHERE category_id = ?', [req.params.id]);
    run('DELETE FROM categories WHERE id = ?', [req.params.id]);
  } catch (err) {}
  res.redirect('/admin/categories');
});

// --- ADMIN BANNERS ROUTES ---

app.get('/admin/banners', requireAuth, (req, res) => {
  const banners = getAll('SELECT * FROM banners ORDER BY order_num ASC, id ASC');
  res.render('admin/banners', { banners, error: null, success: null });
});

app.get('/admin/banners/new', requireAuth, (req, res) => {
  res.render('admin/banner-edit', { banner: null, error: null });
});

app.post('/admin/banners', requireAuth, upload.single('image_file'), (req, res) => {
  const { title, subtitle, link_url, button_text, order_num, is_active } = req.body;
  let image_url = req.body.image_url;

  if (req.file) {
    image_url = '/uploads/' + req.file.filename;
  }

  if (!image_url) {
    return res.status(400).send('Gambar banner wajib diisi via upload atau URL!');
  }

  const activeVal = is_active ? 1 : 0;
  const orderVal = parseInt(order_num, 10) || 1;

  try {
    run(`
      INSERT INTO banners (title, subtitle, image_url, link_url, button_text, order_num, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [title, subtitle, image_url, link_url, button_text, orderVal, activeVal]);
    res.redirect('/admin/banners');
  } catch (error) {
    res.status(400).send('Error adding banner: ' + error.message);
  }
});

app.get('/admin/banners/:id/edit', requireAuth, (req, res) => {
  const banner = getOne('SELECT * FROM banners WHERE id = ?', [req.params.id]);
  if (!banner) return res.status(404).send('Banner tidak ditemukan');
  res.render('admin/banner-edit', { banner, error: null });
});

app.post('/admin/banners/:id', requireAuth, upload.single('image_file'), (req, res) => {
  const banner = getOne('SELECT * FROM banners WHERE id = ?', [req.params.id]);
  if (!banner) return res.status(404).send('Banner tidak ditemukan');

  const { title, subtitle, link_url, button_text, order_num, is_active } = req.body;
  let image_url = banner.image_url;

  if (req.file) {
    image_url = '/uploads/' + req.file.filename;
  } else if (req.body.image_url && req.body.image_url.trim() !== '') {
    image_url = req.body.image_url.trim();
  }

  const activeVal = is_active ? 1 : 0;
  const orderVal = parseInt(order_num, 10) || 1;

  try {
    run(`
      UPDATE banners 
      SET title = ?, subtitle = ?, image_url = ?, link_url = ?, button_text = ?, order_num = ?, is_active = ?
      WHERE id = ?
    `, [title, subtitle, image_url, link_url, button_text, orderVal, activeVal, req.params.id]);
    res.redirect('/admin/banners');
  } catch (error) {
    res.status(400).send('Error updating banner: ' + error.message);
  }
});

app.post('/admin/banners/:id/delete', requireAuth, (req, res) => {
  const banner = getOne('SELECT * FROM banners WHERE id = ?', [req.params.id]);
  if (banner && banner.image_url && banner.image_url.startsWith('/uploads/')) {
    const filePath = path.join(__dirname, 'public', banner.image_url);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (e) { /* ignore unlink error */ }
    }
  }
  run('DELETE FROM banners WHERE id = ?', [req.params.id]);
  res.redirect('/admin/banners');
});

// --- ADMIN HOMEPAGE & PROFILE/ABOUT SETTINGS ROUTES ---

app.get('/admin/homepage', requireAuth, (req, res) => {
  const settings = getSettings();
  res.render('admin/homepage', { settings, error: null, success: null });
});

app.get('/admin/profil', requireAuth, (req, res) => {
  res.redirect('/admin/homepage');
});

app.get('/admin/profile', requireAuth, (req, res) => {
  res.redirect('/admin/homepage');
});

app.post('/admin/homepage', requireAuth, (req, res) => {
  const allowedKeys = [
    'site_name', 'site_tagline', 'about_title', 'about_description',
    'about_hero_title', 'about_philosophy', 'about_focus',
    'vision', 'mission', 'goal_1', 'goal_2', 'goal_3', 'goal_4',
    'contact_address', 'contact_email', 'contact_phone', 'footer_text'
  ];

  try {
    for (const key of allowedKeys) {
      if (req.body[key] !== undefined) {
        updateSetting(key, req.body[key]);
      }
    }
    const settings = getSettings();
    res.render('admin/homepage', { settings, error: null, success: 'Pengaturan profil & halaman tentang berhasil diperbarui!' });
  } catch (error) {
    const settings = getSettings();
    res.render('admin/homepage', { settings, error: 'Gagal memperbarui: ' + error.message, success: null });
  }
});

// --- ADMIN ACCOUNT SETTINGS ROUTES ---

app.get('/admin/settings', requireAuth, (req, res) => {
  res.render('admin/settings', { error: null, success: null });
});

app.post('/admin/settings/password', requireAuth, passwordLimiter, (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  
  if (new_password !== confirm_password) {
    return res.render('admin/settings', { error: 'Password baru dan konfirmasi tidak cocok.', success: null });
  }

  const user = getOne('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  
  if (user && bcrypt.compareSync(current_password, user.password)) {
    const hash = bcrypt.hashSync(new_password, 10);
    run('UPDATE users SET password = ? WHERE id = ?', [hash, req.session.userId]);
    res.render('admin/settings', { error: null, success: 'Password berhasil diubah!' });
  } else {
    res.render('admin/settings', { error: 'Password saat ini salah.', success: null });
  }
});

// --- ERROR HANDLING & 404 HANDLER ---

// 404 Page Handler
app.use((req, res) => {
  res.status(404).render('404');
});

// Centralized Error Handler (Prevent Stack Trace Leaks)
app.use((err, req, res, next) => {
  console.error('Unhandled Application Error:', err.message);
  if (res.headersSent) {
    return next(err);
  }
  if (err.message && err.message.includes('CORS')) {
    return res.status(403).send('Akses diblokir oleh kebijakan keamanan CORS.');
  }
  if (err.message && err.message.includes('Hanya gambar')) {
    return res.status(400).send('Upload gagal: ' + err.message);
  }
  res.status(err.status || 500).render('404');
});

// Start Server
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
