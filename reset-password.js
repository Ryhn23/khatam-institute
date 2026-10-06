const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

function resolveDbPath() {
  if (process.env.DB_PATH) return process.env.DB_PATH;
  if (process.env.DATA_DIR) return path.join(process.env.DATA_DIR, 'database.sqlite');
  
  const rootDb = path.join(__dirname, 'database.sqlite');
  try {
    if (fs.existsSync(rootDb)) {
      const stat = fs.statSync(rootDb);
      if (stat.isFile()) return rootDb;
      if (stat.isDirectory()) return path.join(rootDb, 'database.sqlite');
    }
  } catch (e) {}

  const dataDb = path.join(__dirname, 'data', 'database.sqlite');
  if (fs.existsSync(dataDb)) return dataDb;

  return rootDb;
}

const dbPath = resolveDbPath();

async function resetPassword() {
  console.log('Memulai proses reset password...');

  if (!fs.existsSync(dbPath)) {
    console.error(`Error: Database tidak ditemukan di "${dbPath}". Jalankan aplikasi terlebih dahulu.`);
    process.exit(1);
  }

  try {
    const SQL = await initSqlJs();
    const fileBuffer = fs.readFileSync(dbPath);
    const db = new SQL.Database(fileBuffer);

    // Cek apakah user admin ada
    const result = db.exec("SELECT * FROM users WHERE username = 'admin'");
    
    if (result.length === 0) {
      console.error('Error: User admin tidak ditemukan di database.');
      process.exit(1);
    }

    // Buat password baru (admin123)
    const newPassword = 'admin123';
    const hash = bcrypt.hashSync(newPassword, 10);

    // Update database
    db.run("UPDATE users SET password = ? WHERE username = 'admin'", [hash]);

    // Simpan kembali ke file
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));

    console.log('✅ SUKSES! Password untuk user "admin" telah direset kembali menjadi: admin123');
    console.log('Silakan login dan segera ganti password Anda di menu Pengaturan.');
  } catch (error) {
    console.error('Terjadi kesalahan saat mereset password:', error);
  }
}

resetPassword();
