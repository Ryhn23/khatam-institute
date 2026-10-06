const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');

async function resetPassword() {
  console.log('Memulai proses reset password...');

  if (!fs.existsSync(dbPath)) {
    console.error('Error: Database tidak ditemukan. Jalankan aplikasi terlebih dahulu.');
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
