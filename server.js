const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const querystring = require('querystring');

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DB_FILE = path.join(ROOT, 'database.json');
const ADMIN_PASSWORD = 'Banjarmasin27';

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(PUBLIC_DIR)) fs.mkdirSync(PUBLIC_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ exams: [], studentLogs: [] }, null, 2));

const sessions = new Map();

function readDB() {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function send(res, status, body, contentType = 'text/html; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const pairs = header.split(';').map((v) => v.trim()).filter(Boolean);
  const out = {};
  pairs.forEach((pair) => {
    const [k, ...rest] = pair.split('=');
    out[k] = decodeURIComponent(rest.join('='));
  });
  return out;
}

function getSession(req, res) {
  const cookies = parseCookies(req);
  let sid = cookies.sid;
  if (!sid || !sessions.has(sid)) {
    sid = crypto.randomBytes(16).toString('hex');
    sessions.set(sid, {});
    res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; Path=/; SameSite=Lax`);
  }
  return sessions.get(sid);
}

function parseBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

function htmlLayout(title, content) {
  return `<!DOCTYPE html><html lang="id"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${title}</title><link rel="stylesheet" href="/public/styles.css" /></head><body>${content}</body></html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function activeExam(db) {
  const now = new Date().toISOString();
  return db.exams.slice().reverse().find((e) => e.startAt <= now && e.endAt >= now);
}

function studentLoginPage(error = '') {
  return htmlLayout('Login Ujian', `<div class="card login-card"><img class="logo" src="https://blogger.googleusercontent.com/img/b/R29vZ2xl/AVvXsEhgYXQID4BBAw2UXP4XT-83oM7N9YON6txXEXDBL3C6L0SMZyEmR9oizQyc5naXdPPvyCFcKXEqI4roopWbm9x-GxIi191zfJ8lF0tMkWCzwJcqiCMwfDTilzl9EXnLyLMI5R5vzB1kC-MsKMAhI4-_9JsNE1vYA5OtWqlKIxQel6nh22-xuMhw8wVM/s500/9F102055-6DAA-4B25-ABAE-25AA38E34A25.png" alt="Logo Sekolah" /><h1>Portal Ujian Siswa</h1><p>Isi data diri sebelum memulai ujian.</p>${error ? `<div class="error">${error}</div>` : ''}<form method="POST" action="/start" class="form-grid"><label>Nama Lengkap<input type="text" name="fullName" required /></label><label>Kelas<select name="className" required><option value="">Pilih Kelas</option><option>X 1</option><option>X 2</option><option>XI 1</option><option>XI 2</option><option>XII IPS</option><option>XII IPA</option></select></label><button type="submit">Mulai</button></form><a class="small-link" href="/admin/login">Masuk halaman admin sekolah</a></div>`);
}

function adminLoginPage(error = '') {
  return htmlLayout('Login Admin', `<div class="card"><h1>Login Admin Sekolah</h1><p>Masukkan password untuk masuk ke halaman admin.</p>${error ? `<div class="error">${error}</div>` : ''}<form method="POST" action="/admin/login" class="form-grid"><label>Password Admin<input type="password" name="password" required /></label><button type="submit">Masuk Admin</button></form><a class="small-link" href="/">Kembali ke halaman siswa</a></div>`);
}

function rulesPage(student) {
  return htmlLayout('Tata Tertib', `<div class="card"><h1>Tata Tertib Ujian</h1><p><strong>Peserta:</strong> ${student.fullName} - ${student.className}</p><ol><li>Berdoa terlebih dahulu sebelum memulai ujian.</li><li>Dilarang berpindah tab, membuka aplikasi lain, split screen, atau tindakan curang lain.</li><li>Pelanggaran terdeteksi 3 kali, jika lebih maka ujian ditutup otomatis.</li><li>Tekan tombol mulai ujian setelah berdoa.</li></ol><a class="button-link" href="/exam">Mulai Ujian</a></div>`);
}

function examPage(student, exam, cheatCount) {
  return htmlLayout('Ujian Berlangsung', `<header class="exam-header"><div class="profile"><strong>${student.fullName}</strong><span>${student.className}</span></div><div class="timer" id="timer">60:00</div></header><main class="exam-main"><div id="warning" class="warning" hidden>Anda melakukan kecurangan</div><embed src="${exam.pdfPath}#toolbar=1&navpanes=0&scrollbar=1" type="application/pdf" class="pdf-preview" /></main><form id="finishForm" method="POST" action="/exam/finish" class="finish-box"><input type="hidden" name="reason" id="reason" value="manual"/><button type="submit">Selesai Ujian</button></form><script>const endAt=new Date('${exam.endAt}').getTime();const t=document.getElementById('timer');const w=document.getElementById('warning');const f=document.getElementById('finishForm');const r=document.getElementById('reason');let cheat=${cheatCount};async function reportCheating(){const res=await fetch('/exam/cheat',{method:'POST'});if(!res.ok)return;const data=await res.json();cheat=data.cheatCount;w.hidden=false;w.textContent='Anda melakukan kecurangan ('+cheat+'/3)';setTimeout(()=>w.hidden=true,2000);if(data.finished){alert('Ujian dianggap selesai');location.href='/'}}function tick(){const d=endAt-Date.now();if(d<=0){r.value='timeout';f.submit();return;}const m=Math.floor(d/60000);const s=Math.floor((d%60000)/1000);t.textContent=String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');}setInterval(tick,1000);tick();document.addEventListener('visibilitychange',()=>{if(document.hidden)reportCheating();});window.addEventListener('blur',reportCheating);window.addEventListener('keydown',(e)=>{if(e.key==='PrintScreen'||(e.ctrlKey&&e.shiftKey&&['I','i','J','j','C','c'].includes(e.key))){e.preventDefault();reportCheating();}});document.addEventListener('contextmenu',(e)=>e.preventDefault());if(document.documentElement.requestFullscreen){document.documentElement.requestFullscreen().catch(()=>{});}document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)reportCheating();});</script>`);
}

function finishPage(timeout) {
  return htmlLayout('Ujian Selesai', `<div class="card"><h1>Ujian Selesai</h1><p>${timeout ? 'Waktu habis. Ujian ditutup otomatis.' : 'Terima kasih, data ujian Anda tersimpan.'}</p><a class="button-link" href="/">Kembali</a></div>`);
}

function adminPage(db, success) {
  const examRows = db.exams.slice().reverse().map((e) => `<tr><td>${escapeHtml(e.name)}</td><td>${escapeHtml(e.startDate)} ${escapeHtml(e.startTime)} - ${escapeHtml(e.endDate)} ${escapeHtml(e.endTime)}</td><td><a href="${escapeHtml(e.pdfPath)}" target="_blank">Lihat PDF</a></td></tr>`).join('');
  const studentRows = db.studentLogs.slice().reverse().map((s) => {
    const exam = db.exams.find((e) => e.id === s.examId);
    return `<tr><td>${escapeHtml(s.loginTimestamp)}</td><td>${escapeHtml(s.fullName)}</td><td>${escapeHtml(s.className)}</td><td>${escapeHtml(s.status)}</td><td>${escapeHtml(s.notes)}</td><td>${escapeHtml(exam ? exam.name : '-')}</td></tr>`;
  }).join('');

  return htmlLayout('Admin Ujian', `<div class="container admin-layout"><section class="card"><h1>Admin Sekolah - Buat Ujian</h1><a class="small-link" href="/admin/logout">Logout Admin</a>${success ? `<div class="success">${escapeHtml(success)}</div>` : ''}<form method="POST" action="/admin/exams" enctype="multipart/form-data" class="form-grid"><label>Nama Ujian<input type="text" name="examName" required/></label><label>Tanggal Mulai Ujian<input type="date" name="startDate" required/></label><label>Tanggal Akhir Ujian<input type="date" name="endDate" required/></label><label>Waktu Mulai Ujian<input type="time" name="startTime" required/></label><label>Waktu Berakhir Ujian<input type="time" name="endTime" required/></label><label>Upload PDF Soal<input type="file" name="pdfFile" accept="application/pdf" required/></label><button type="submit">Simpan Ujian</button></form></section><section class="card"><h2>Daftar Ujian</h2><table><thead><tr><th>Nama</th><th>Periode</th><th>File</th></tr></thead><tbody>${examRows}</tbody></table></section><section class="card"><h2>Data Siswa Ujian</h2><table><thead><tr><th>Timestamp Login</th><th>Nama</th><th>Kelas</th><th>Status Aktif/Belum Login</th><th>Keterangan</th><th>Ujian</th></tr></thead><tbody>${studentRows}</tbody></table></section></div>`);
}

function parseMultipart(bodyBuffer, contentType) {
  const boundaryMatch = contentType.match(/boundary=(.*)$/);
  if (!boundaryMatch) return null;
  const boundary = `--${boundaryMatch[1]}`;
  const parts = bodyBuffer.toString('binary').split(boundary).slice(1, -1);
  const fields = {};
  let file = null;

  parts.forEach((part) => {
    const idx = part.indexOf('\r\n\r\n');
    if (idx < 0) return;
    const rawHeader = part.slice(0, idx);
    const rawValue = part.slice(idx + 4, part.lastIndexOf('\r\n'));

    const nameMatch = rawHeader.match(/name="([^"]+)"/);
    if (!nameMatch) return;
    const fieldName = nameMatch[1];
    const filenameMatch = rawHeader.match(/filename="([^"]*)"/);

    if (filenameMatch && filenameMatch[1]) {
      const contentTypeMatch = rawHeader.match(/Content-Type:\s*([^\r\n]+)/i);
      file = {
        fieldName,
        filename: path.basename(filenameMatch[1]),
        contentType: contentTypeMatch ? contentTypeMatch[1].trim() : 'application/octet-stream',
        buffer: Buffer.from(rawValue, 'binary')
      };
    } else {
      fields[fieldName] = Buffer.from(rawValue, 'binary').toString('utf8');
    }
  });

  return { fields, file };
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host}`);
  const pathname = urlObj.pathname;
  const session = getSession(req, res);

  if (pathname.startsWith('/public/')) {
    const filePath = path.join(PUBLIC_DIR, pathname.replace('/public/', ''));
    if (!fs.existsSync(filePath)) return send(res, 404, 'Not found');
    return send(res, 200, fs.readFileSync(filePath), 'text/css; charset=utf-8');
  }

  if (pathname.startsWith('/uploads/')) {
    const filePath = path.join(UPLOAD_DIR, pathname.replace('/uploads/', ''));
    if (!fs.existsSync(filePath)) return send(res, 404, 'File tidak ditemukan');
    return send(res, 200, fs.readFileSync(filePath), 'application/pdf');
  }

  const db = readDB();

  if (req.method === 'GET' && pathname === '/') {
    return send(res, 200, studentLoginPage());
  }

  if (req.method === 'GET' && pathname === '/admin/login') {
    return send(res, 200, adminLoginPage());
  }

  if (req.method === 'POST' && pathname === '/admin/login') {
    const body = querystring.parse((await parseBody(req)).toString());
    if (body.password === ADMIN_PASSWORD) {
      session.adminAuthenticated = true;
      res.writeHead(302, { Location: '/admin' });
      return res.end();
    }
    return send(res, 200, adminLoginPage('Password admin salah.'));
  }

  if (req.method === 'GET' && pathname === '/admin/logout') {
    delete session.adminAuthenticated;
    res.writeHead(302, { Location: '/admin/login' });
    return res.end();
  }

  if (req.method === 'POST' && pathname === '/start') {
    const body = querystring.parse((await parseBody(req)).toString());
    const fullName = (body.fullName || '').trim();
    const className = body.className;
    if (!fullName || !className) return send(res, 200, studentLoginPage('Nama lengkap dan kelas wajib diisi.'));

    const exam = activeExam(db);
    if (!exam) return send(res, 200, studentLoginPage('Belum ada ujian aktif saat ini.'));

    const existing = db.studentLogs.find((s) => s.examId === exam.id && s.fullName === fullName && s.className === className && s.status === 'selesai');
    if (existing) return send(res, 200, studentLoginPage('Anda sudah menyelesaikan ujian ini dan tidak bisa mengulang lagi.'));

    const logId = db.studentLogs.length ? db.studentLogs[db.studentLogs.length - 1].id + 1 : 1;
    db.studentLogs.push({ id: logId, examId: exam.id, fullName, className, loginTimestamp: new Date().toISOString(), status: 'aktif', cheatCount: 0, notes: 'Jujur', finishedAt: null });
    writeDB(db);

    session.student = { logId, examId: exam.id, fullName, className };
    res.writeHead(302, { Location: '/rules' });
    return res.end();
  }

  if (req.method === 'GET' && pathname === '/rules') {
    if (!session.student) {
      res.writeHead(302, { Location: '/' });
      return res.end();
    }
    return send(res, 200, rulesPage(session.student));
  }

  if (req.method === 'GET' && pathname === '/exam') {
    if (!session.student) {
      res.writeHead(302, { Location: '/' });
      return res.end();
    }
    const exam = db.exams.find((e) => e.id === session.student.examId);
    const log = db.studentLogs.find((s) => s.id === session.student.logId);
    if (!exam || !log || log.status === 'selesai') return send(res, 200, 'Ujian selesai.');
    return send(res, 200, examPage(session.student, exam, log.cheatCount));
  }

  if (req.method === 'POST' && pathname === '/exam/cheat') {
    if (!session.student) return send(res, 401, JSON.stringify({ message: 'Unauthorized' }), 'application/json');
    const log = db.studentLogs.find((s) => s.id === session.student.logId);
    if (!log) return send(res, 400, JSON.stringify({ message: 'Invalid log' }), 'application/json');

    log.cheatCount += 1;
    log.notes = `Kecurangan ${log.cheatCount} kali`;
    let finished = false;

    if (log.cheatCount > 3) {
      log.status = 'selesai';
      log.finishedAt = new Date().toISOString();
      log.notes = 'Selesai otomatis karena kecurangan lebih dari 3 kali';
      finished = true;
      delete session.student;
    }

    writeDB(db);
    return send(res, 200, JSON.stringify({ cheatCount: log.cheatCount, finished }), 'application/json');
  }

  if (req.method === 'POST' && pathname === '/exam/finish') {
    if (!session.student) {
      res.writeHead(302, { Location: '/' });
      return res.end();
    }
    const body = querystring.parse((await parseBody(req)).toString());
    const log = db.studentLogs.find((s) => s.id === session.student.logId);
    if (log) {
      log.status = 'selesai';
      log.finishedAt = new Date().toISOString();
      if (log.cheatCount === 0) log.notes = body.reason === 'timeout' ? 'Jujur (waktu habis otomatis)' : 'Jujur';
      writeDB(db);
    }
    delete session.student;
    return send(res, 200, finishPage(body.reason === 'timeout'));
  }

  if (req.method === 'GET' && pathname === '/admin') {
    if (!session.adminAuthenticated) {
      res.writeHead(302, { Location: '/admin/login' });
      return res.end();
    }
    return send(res, 200, adminPage(db, urlObj.searchParams.get('success') || ''));
  }

  if (req.method === 'POST' && pathname === '/admin/exams') {
    if (!session.adminAuthenticated) {
      res.writeHead(302, { Location: '/admin/login' });
      return res.end();
    }

    const parsed = parseMultipart(await parseBody(req), req.headers['content-type'] || '');
    if (!parsed) return send(res, 400, 'Format upload tidak valid.');
    const { fields, file } = parsed;

    if (!file || file.contentType !== 'application/pdf') return send(res, 400, 'File harus PDF.');
    if (!fields.examName || !fields.startDate || !fields.endDate || !fields.startTime || !fields.endTime) {
      return send(res, 400, 'Semua field wajib diisi.');
    }

    const safeName = file.filename.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9._-]/g, '');
    const stored = `${Date.now()}-${safeName}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, stored), file.buffer);

    const id = db.exams.length ? db.exams[db.exams.length - 1].id + 1 : 1;
    db.exams.push({
      id,
      name: fields.examName,
      startDate: fields.startDate,
      endDate: fields.endDate,
      startTime: fields.startTime,
      endTime: fields.endTime,
      startAt: new Date(`${fields.startDate}T${fields.startTime}:00`).toISOString(),
      endAt: new Date(`${fields.endDate}T${fields.endTime}:00`).toISOString(),
      pdfPath: `/uploads/${stored}`,
      createdAt: new Date().toISOString()
    });
    writeDB(db);

    res.writeHead(302, { Location: '/admin?success=Upload%20PDF%20sukses' });
    return res.end();
  }

  return send(res, 404, 'Halaman tidak ditemukan.');
});

server.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});
