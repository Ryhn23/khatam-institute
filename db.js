const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

function resolveDbPath() {
  if (process.env.DB_PATH) {
    return process.env.DB_PATH;
  }
  if (process.env.DATA_DIR) {
    return path.join(process.env.DATA_DIR, 'database.sqlite');
  }

  const rootDb = path.join(__dirname, 'database.sqlite');
  try {
    if (fs.existsSync(rootDb)) {
      const stat = fs.statSync(rootDb);
      if (stat.isFile()) {
        return rootDb;
      }
    }
  } catch (e) {}

  return path.join(__dirname, 'data', 'database.sqlite');
}

let dbPath = resolveDbPath();
let dbInstance = null;

// Save database to disk
function saveDB() {
  if (dbInstance) {
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(dbPath, buffer);
  }
}

async function initDB() {
  if (dbInstance) return;

  const SQL = await initSqlJs();

  // If dbPath exists and is accidentally a directory (e.g. caused by Docker mounting a non-existent file),
  // adapt by using a database file inside that directory instead of crashing with EISDIR.
  if (fs.existsSync(dbPath)) {
    try {
      const stat = fs.statSync(dbPath);
      if (stat.isDirectory()) {
        console.warn(`[DB Warning] "${dbPath}" is a directory. Using database file inside it.`);
        dbPath = path.join(dbPath, 'database.sqlite');
      }
    } catch (e) {}
  }

  // Ensure target folder exists
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Load existing database or create new one
  if (fs.existsSync(dbPath) && fs.statSync(dbPath).isFile()) {
    const fileBuffer = fs.readFileSync(dbPath);
    dbInstance = new SQL.Database(fileBuffer);
  } else {
    dbInstance = new SQL.Database();
  }

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    )
  `);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      content TEXT NOT NULL,
      meta_description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS banners (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      subtitle TEXT,
      image_url TEXT NOT NULL,
      link_url TEXT,
      button_text TEXT,
      order_num INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  dbInstance.run(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  try {
    dbInstance.run('ALTER TABLE posts ADD COLUMN category_id INTEGER');
  } catch (e) {
    // Column already exists
  }

  // Insert default categories if empty
  const catResult = dbInstance.exec("SELECT COUNT(*) as count FROM categories");
  const catCount = catResult.length > 0 && catResult[0].values.length > 0 ? catResult[0].values[0][0] : 0;
  if (catCount === 0) {
    const defaultCats = [
      ['Kajian Islam', 'kajian-islam'],
      ['Filsafat & Pemikiran', 'filsafat-pemikiran'],
      ['Sains & Peradaban', 'sains-peradaban'],
      ['Metodologi Riset', 'metodologi-riset'],
      ['Opini & Refleksi', 'opini-refleksi']
    ];
    for (const [name, slug] of defaultCats) {
      dbInstance.run('INSERT INTO categories (name, slug) VALUES (?, ?)', [name, slug]);
    }
    try {
      dbInstance.run('UPDATE posts SET category_id = 1 WHERE category_id IS NULL');
    } catch (e) {}
    saveDB();
  }

  // Insert default admin if none exists
  const result = dbInstance.exec("SELECT * FROM users WHERE username = 'admin'");
  if (result.length === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    dbInstance.run('INSERT INTO users (username, password) VALUES (?, ?)', ['admin', hash]);
    saveDB();
    console.log('Default admin user created. (admin / admin123)');
  }

  // Ensure default settings exist
  const defaultSettings = [
      ['site_name', 'Khatam Institute'],
      ['site_tagline', 'Membangun Intelektualitas Berbasis Riset & Spiritualitas'],
      ['hero_title', 'Membangun Intelektualitas Berbasis Riset & Spiritualitas'],
      ['hero_subtitle', 'Khatam Institute berkomitmen mencetak kader kritis, kreatif, dan berakhlak mulia melalui pengkajian keilmuan yang holistik.'],
      ['about_title', 'Profil Khatam Institute'],
      ['about_description', 'Khatam Institute adalah lembaga pendidikan dan riset independen yang fokus pada pengembangan wawasan keilmuan, kajian pemikiran Islam, literasi kritis, dan peradaban kontemporer.'],
      ['about_hero_title', 'Membangun Tradisi Riset, Menegakkan Nalar Kritis, dan Menumbuhkan Keilmuan Peradaban'],
      ['about_philosophy', 'Di tengah derasnya arus disrupsi informasi dan percepatan zaman, masyarakat kontemporer kerap dihadapkan pada fragmentasi wacana dan pendangkalan literasi. Keilmuan sering kali tereduksi menjadi konsumsi instan tanpa proses perenungan, telaah kritis, serta ketelitian metodologis.\n\nKhatam Institute lahir sebagai ruang ikhtiar intelektual independen untuk menghidupkan kembali tradisi ilmiah yang mendalam. Kami meyakini bahwa kemajuan peradaban bertumpu pada kemampuan mengintegrasikan khazanah kearifan klasik, ketajaman metodologi sains kontemporer, dan kepekaan nurani terhadap persoalan kemanusiaan.\n\nMelalui dedikasi riset yang berkesinambungan, kami berupaya melahirkan gagasan-gagasan yang mencerahkan, tidak terjebak pada fanatisme sempit, serta berorientasi pada kemaslahatan publik yang inklusif dan berkelanjutan.'],
      ['about_focus', ''],
      ['vision', 'Menjadi pusat riset dan kajian keilmuan Islam terdepan yang mencerahkan, independen, dan berdaya saing global.'],
      ['mission', '1. Mengembangkan budaya riset dan literasi kritis.\n2. Menyelenggarakan forum kajian akademik dan intelektual berkala.\n3. Menerbitkan karya ilmiah dan publikasi edukatif.\n4. Membangun kolaborasi riset lintas institusi.'],
      ['goal_1', 'Membina intelektualitas santri & mahasiswa'],
      ['goal_2', 'Mengembangkan budaya riset dan literasi'],
      ['goal_3', 'Membentuk kader berakhlak dan visioner'],
      ['goal_4', 'Mendorong kolaborasi keilmuan dan publikasi'],
      ['contact_address', 'Jl. Munggang No. 25, Balekambang, Kramat Jati, Jakarta Timur'],
      ['contact_email', 'info@khataminstitute.com'],
      ['contact_phone', '+62 812-3456-7890'],
      ['footer_text', 'Lembaga Kajian Riset dan Intelektual Khatam Institute.']
    ];

    for (const [key, value] of defaultSettings) {
      dbInstance.run('INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)', [key, value]);
    }
    saveDB();

  // Insert default banner if empty
  const bannerResult = dbInstance.exec("SELECT COUNT(*) as count FROM banners");
  const bannerCount = bannerResult.length > 0 && bannerResult[0].values.length > 0 ? bannerResult[0].values[0][0] : 0;
  if (bannerCount === 0) {
    dbInstance.run(`
      INSERT INTO banners (title, subtitle, image_url, link_url, button_text, order_num, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      'Selamat Datang di Khatam Institute',
      'Pusat Kajian Pemikiran, Riset Intelektual & Literasi Kontemporer',
      'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?q=80&w=1600&auto=format&fit=crop',
      '#tentang',
      'Pelajari Lebih Lanjut',
      1,
      1
    ]);
    dbInstance.run(`
      INSERT INTO banners (title, subtitle, image_url, link_url, button_text, order_num, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      'Riset & Publikasi Ilmiah',
      'Menyajikan artikel, kajian mendalam, dan hasil telaah ilmiah terkini',
      'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?q=80&w=1600&auto=format&fit=crop',
      '/blog',
      'Baca Artikel',
      2,
      1
    ]);
    saveDB();
  }

  // Auto-save on exit
  process.on('exit', saveDB);
  process.on('SIGINT', () => { saveDB(); process.exit(); });
  process.on('SIGTERM', () => { saveDB(); process.exit(); });
}

// Helper: convert sql.js result to array of objects
function rowsToObjects(result) {
  if (!result || result.length === 0) return [];
  const columns = result[0].columns;
  const values = result[0].values;
  return values.map(row => {
    const obj = {};
    columns.forEach((col, i) => { obj[col] = row[i]; });
    return obj;
  });
}

// Query helpers that mimic the old API
function getAll(sql, params = []) {
  const result = dbInstance.exec(sql, params);
  return rowsToObjects(result);
}

function getOne(sql, params = []) {
  const rows = getAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function run(sql, params = []) {
  dbInstance.run(sql, params);
  saveDB();
}

function getSettings() {
  const rows = getAll('SELECT key, value FROM site_settings');
  const settings = {};
  rows.forEach(r => {
    settings[r.key] = r.value;
  });
  return settings;
}

function updateSetting(key, value) {
  run('INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]);
}

module.exports = { initDB, getAll, getOne, run, getSettings, updateSetting };
