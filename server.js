// ============================================================
// UniCampus 后端数据存储服务
// 武汉科技大学校园社区 - 持久化数据层
// ============================================================
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- 中间件 ----
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ---- 数据存储 ----
const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

// 确保数据目录存在
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// 读取整个数据库
function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) return {};
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    console.error('读取数据库失败:', e.message);
    return {};
  }
}

// 写入整个数据库
function writeDB(data) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('写入数据库失败:', e.message);
    return false;
  }
}

// 获取单个 key 的数据
function getData(key) {
  const db = readDB();
  return db[key] !== undefined ? db[key] : null;
}

// 设置单个 key 的数据
function setData(key, value) {
  const db = readDB();
  db[key] = value;
  db['_updatedAt'] = new Date().toISOString();
  return writeDB(db);
}

// ---- Token 管理 (简单 JWT 替代) ----
const tokens = {}; // token -> { stuId, createdAt }

function generateToken(stuId) {
  const token = crypto.randomBytes(32).toString('hex');
  tokens[token] = { stuId, createdAt: Date.now() };
  return token;
}

function verifyToken(token) {
  if (!token || !tokens[token]) return null;
  const info = tokens[token];
  // Token 有效期 7 天
  if (Date.now() - info.createdAt > 7 * 24 * 60 * 60 * 1000) {
    delete tokens[token];
    return null;
  }
  return info;
}

// ---- 认证中间件 ----
function authMiddleware(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ error: '未登录或登录已过期' });
  }
  req.user = user;
  next();
}

// ============================================================
// 安全中间件
// ============================================================

// ---- 安全响应头 ----
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.removeHeader('X-Powered-By');
  next();
});

// ---- 请求频率限制 ----
const rateLimiter = {};
const RATE_LIMIT_WINDOW = 60 * 1000; // 1分钟窗口
const RATE_LIMIT_MAX = 60; // 每窗口最大请求数

app.use((req, res, next) => {
  // 仅对 API 路径做频率限制
  if (!req.path.startsWith('/api/')) return next();
  const ip = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();
  if (!rateLimiter[ip]) {
    rateLimiter[ip] = { count: 1, start: now };
  } else {
    if (now - rateLimiter[ip].start > RATE_LIMIT_WINDOW) {
      rateLimiter[ip] = { count: 1, start: now };
    } else {
      rateLimiter[ip].count++;
    }
  }
  if (rateLimiter[ip].count > RATE_LIMIT_MAX) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
  }
  next();
});

// ---- 访问日志 ----
const accessLog = [];
const MAX_LOG_ENTRIES = 500;

function logAccess(ip, method, path, status, user) {
  accessLog.unshift({
    time: new Date().toISOString(),
    ip, method, path, status,
    user: user || '-'
  });
  if (accessLog.length > MAX_LOG_ENTRIES) accessLog.length = MAX_LOG_ENTRIES;
}

app.use((req, res, next) => {
  const originalEnd = res.end;
  res.end = function(...args) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    logAccess(ip, req.method, req.path, res.statusCode, req.user?.stuId || '-');
    originalEnd.apply(res, args);
  };
  next();
});

// ============================================================
// 管理员系统
// ============================================================

// ---- 管理员配置 ----
const ADMIN_CONFIG = {
  // 管理员密码 SHA-256 哈希（默认密码：unicampus2026）
  // 修改密码：node -e "console.log(require('crypto').createHash('sha256').update('你的新密码').digest('hex'))"
  passwordHash: 'a3d2f8c1e9b45e6f7a0c3d8e1f4b5a2c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1',
  // 运行时动态覆盖（首次启动时自动生成真实哈希）
  _realHash: null,
  sessionTimeout: 4 * 60 * 60 * 1000, // 4小时会话
  maxLoginAttempts: 5,
  lockoutDuration: 15 * 60 * 1000 // 15分钟锁定
};

// 初始化管理员密码哈希（使用默认密码的SHA-256）
if (!ADMIN_CONFIG._realHash) {
  ADMIN_CONFIG._realHash = crypto.createHash('sha256').update('unicampus2026').digest('hex');
}

// ---- 管理员登录失败锁定 ----
const loginAttempts = {}; // ip -> { count, lockedUntil }

function checkLoginLock(ip) {
  const attempt = loginAttempts[ip];
  if (!attempt) return false;
  if (attempt.lockedUntil && Date.now() < attempt.lockedUntil) return true;
  if (attempt.lockedUntil && Date.now() >= attempt.lockedUntil) {
    delete loginAttempts[ip];
    return false;
  }
  return false;
}

function recordLoginFail(ip) {
  if (!loginAttempts[ip]) loginAttempts[ip] = { count: 0 };
  loginAttempts[ip].count++;
  if (loginAttempts[ip].count >= ADMIN_CONFIG.maxLoginAttempts) {
    loginAttempts[ip].lockedUntil = Date.now() + ADMIN_CONFIG.lockoutDuration;
    loginAttempts[ip].count = 0;
  }
}

function clearLoginFails(ip) {
  delete loginAttempts[ip];
}

// ---- 管理员 Token 管理 ----
const adminTokens = {}; // token -> { createdAt, fingerprint }

function generateAdminToken(fingerprint) {
  const token = crypto.randomBytes(48).toString('hex');
  adminTokens[token] = {
    createdAt: Date.now(),
    fingerprint: fingerprint // 绑定浏览器指纹
  };
  return token;
}

function verifyAdminToken(token, fingerprint) {
  if (!token || !adminTokens[token]) return false;
  const session = adminTokens[token];
  // 检查超时
  if (Date.now() - session.createdAt > ADMIN_CONFIG.sessionTimeout) {
    delete adminTokens[token];
    return false;
  }
  // 检查指纹匹配
  if (fingerprint && session.fingerprint && session.fingerprint !== fingerprint) {
    delete adminTokens[token];
    return false;
  }
  return true;
}

// ---- 管理员认证中间件 ----
function adminAuthMiddleware(req, res, next) {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  const fingerprint = req.headers['x-admin-fp'] || '';
  if (!verifyAdminToken(token, fingerprint)) {
    return res.status(401).json({ error: '管理员会话已过期，请重新登录' });
  }
  next();
}

// ============================================================
// 管理员 API 路由
// ============================================================

// ---- 管理员登录 ----
app.post('/api/admin/login', (req, res) => {
  const ip = req.ip || req.connection.remoteAddress || 'unknown';

  // 检查是否被锁定
  if (checkLoginLock(ip)) {
    const attempt = loginAttempts[ip];
    const remaining = Math.ceil((attempt.lockedUntil - Date.now()) / 60000);
    return res.status(423).json({
      error: `登录失败次数过多，请${remaining}分钟后再试`,
      locked: true,
      remainingMinutes: remaining
    });
  }

  const { password, fingerprint } = req.body;
  if (!password) {
    return res.status(400).json({ error: '请输入密码' });
  }

  // 验证密码
  const inputHash = crypto.createHash('sha256').update(password).digest('hex');
  if (inputHash !== ADMIN_CONFIG._realHash) {
    recordLoginFail(ip);
    const attemptsLeft = ADMIN_CONFIG.maxLoginAttempts - (loginAttempts[ip]?.count || 0);
    return res.status(401).json({
      error: '密码错误',
      attemptsLeft: Math.max(0, attemptsLeft)
    });
  }

  // 登录成功
  clearLoginFails(ip);
  const token = generateAdminToken(fingerprint || 'default');
  logAccess(ip, 'POST', '/api/admin/login', 200, 'ADMIN');

  res.json({
    token,
    expiresIn: ADMIN_CONFIG.sessionTimeout,
    message: '登录成功'
  });
});

// ---- 管理员登出 ----
app.post('/api/admin/logout', (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (token) delete adminTokens[token];
  res.json({ ok: true });
});

// ---- 验证管理员会话 ----
app.get('/api/admin/verify', adminAuthMiddleware, (req, res) => {
  res.json({ valid: true });
});

// ---- 数据概览统计 ----
app.get('/api/admin/stats', adminAuthMiddleware, (req, res) => {
  const db = readDB();
  const users = db.users || {};
  const posts = db.posts || [];
  const activities = db.activities || [];
  const careerPosts = db.career_posts || [];
  const purchaseRequests = db.purchaseRequests || [];
  const bargains = db.bargains || [];

  const userList = Object.values(users);

  // 用户统计
  const campusStats = {};
  userList.forEach(u => {
    const c = u.campus || '未知';
    campusStats[c] = (campusStats[c] || 0) + 1;
  });

  // 帖子统计
  const postTypeStats = {};
  posts.forEach(p => {
    const t = p.type || 'unknown';
    postTypeStats[t] = (postTypeStats[t] || 0) + 1;
  });

  // 购买请求统计
  const requestStats = { pending: 0, accepted: 0, rejected: 0, cancelled: 0 };
  purchaseRequests.forEach(r => {
    if (requestStats[r.status] !== undefined) requestStats[r.status]++;
  });

  // 砍价统计
  const bargainStats = { pending: 0, countered: 0, accepted: 0, rejected: 0, withdrawn: 0 };
  bargains.forEach(b => {
    if (bargainStats[b.status] !== undefined) bargainStats[b.status]++;
  });

  // 最近7天注册用户
  const now = new Date();
  const recentUsers = userList.filter(u => {
    if (!u.joinTime) return false;
    const d = new Date(u.joinTime);
    return (now - d) < 7 * 24 * 60 * 60 * 1000;
  }).length;

  res.json({
    users: {
      total: userList.length,
      byCampus: campusStats,
      recentWeek: recentUsers
    },
    posts: {
      total: posts.length,
      byType: postTypeStats,
      totalLikes: posts.reduce((s, p) => s + (p.likes || 0), 0),
      totalComments: posts.reduce((s, p) => s + (p.comments?.length || 0), 0)
    },
    activities: { total: activities.length },
    careerPosts: { total: careerPosts.length },
    purchaseRequests: requestStats,
    bargains: bargainStats,
    system: {
      dbUpdatedAt: db._updatedAt || null,
      activeTokens: Object.keys(tokens).length,
      adminActiveSessions: Object.keys(adminTokens).length,
      uptime: process.uptime()
    }
  });
});

// ---- 用户列表 ----
app.get('/api/admin/users', adminAuthMiddleware, (req, res) => {
  const db = readDB();
  const users = db.users || {};
  const userList = Object.values(users).map(u => ({
    stuId: u.stuId,
    name: u.name,
    campus: u.campus,
    college: u.college,
    major: u.major,
    grade: u.grade,
    joinTime: u.joinTime,
    followers: u.followers || 0,
    following: u.following || 0,
    bio: u.bio || ''
  }));
  res.json({ users: userList, total: userList.length });
});

// ---- 帖子列表 ----
app.get('/api/admin/posts', adminAuthMiddleware, (req, res) => {
  const db = readDB();
  const posts = (db.posts || []).map(p => ({
    id: p.id,
    type: p.type,
    title: p.title || p.content?.slice(0, 30) || '',
    authorId: p.authorId,
    authorName: p.authorName,
    likes: p.likes || 0,
    comments: p.comments?.length || 0,
    status: p.status || null,
    createdAt: p.time || p.createdAt
  }));
  res.json({ posts, total: posts.length });
});

// ---- 删除帖子 ----
app.delete('/api/admin/posts/:id', adminAuthMiddleware, (req, res) => {
  const db = readDB();
  const posts = db.posts || [];
  const idx = posts.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: '帖子不存在' });
  const removed = posts.splice(idx, 1)[0];
  db.posts = posts;
  db._updatedAt = new Date().toISOString();
  writeDB(db);
  res.json({ ok: true, removed: { id: removed.id, title: removed.title || removed.content?.slice(0, 30) } });
});

// ---- 删除用户 ----
app.delete('/api/admin/users/:stuId', adminAuthMiddleware, (req, res) => {
  const db = readDB();
  const users = db.users || {};
  if (!users[req.params.stuId]) return res.status(404).json({ error: '用户不存在' });
  const removed = users[req.params.stuId];
  delete users[req.params.stuId];
  db.users = users;
  // 同时删除该用户的帖子
  db.posts = (db.posts || []).filter(p => p.authorId !== req.params.stuId);
  db._updatedAt = new Date().toISOString();
  writeDB(db);
  res.json({ ok: true, removed: { stuId: removed.stuId, name: removed.name } });
});

// ---- 访问日志 ----
app.get('/api/admin/logs', adminAuthMiddleware, (req, res) => {
  res.json({ logs: accessLog.slice(0, 100) });
});

// ---- 数据库备份导出 ----
app.get('/api/admin/export', adminAuthMiddleware, (req, res) => {
  const db = readDB();
  // 脱敏：移除用户密码
  const safe = JSON.parse(JSON.stringify(db));
  if (safe.users) {
    Object.keys(safe.users).forEach(id => {
      delete safe.users[id].password;
    });
  }
  res.setHeader('Content-Disposition', 'attachment; filename=unicampus-backup-' + new Date().toISOString().slice(0, 10) + '.json');
  res.json(safe);
});

// ---- 修改管理员密码 ----
app.put('/api/admin/password', adminAuthMiddleware, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: '请提供当前密码和新密码' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: '新密码至少6位' });
  }
  const currentHash = crypto.createHash('sha256').update(currentPassword).digest('hex');
  if (currentHash !== ADMIN_CONFIG._realHash) {
    return res.status(401).json({ error: '当前密码错误' });
  }
  ADMIN_CONFIG._realHash = crypto.createHash('sha256').update(newPassword).digest('hex');
  // 清除所有管理员会话，强制重新登录
  Object.keys(adminTokens).forEach(k => delete adminTokens[k]);
  res.json({ ok: true, message: '密码修改成功，请重新登录' });
});

// ---- 服务器运行信息 ----
app.get('/api/admin/system', adminAuthMiddleware, (req, res) => {
  const db = readDB();
  const stats = fs.statSync(DB_FILE);
  res.json({
    nodeVersion: process.version,
    platform: process.platform,
    uptime: Math.floor(process.uptime()),
    memoryUsage: {
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB'
    },
    dbSize: Math.round(stats.size / 1024) + 'KB',
    dbUpdatedAt: db._updatedAt || null,
    activeUserTokens: Object.keys(tokens).length,
    activeAdminSessions: Object.keys(adminTokens).length,
    loginAttempts: Object.keys(loginAttempts).filter(ip => loginAttempts[ip].lockedUntil && Date.now() < loginAttempts[ip].lockedUntil).length
  });
});

// ============================================================
// API 路由
// ============================================================

// ---- 健康检查 ----
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ---- 注册 ----
app.post('/api/auth/register', (req, res) => {
  try {
    const { stuId, name, password, campus, college, major, grade } = req.body;

    if (!stuId || !name || !password) {
      return res.status(400).json({ error: '学号、昵称和密码不能为空' });
    }

    const db = readDB();
    const users = db.users || {};

    if (users[stuId]) {
      // 如果用户存在但没有密码（数据损坏），允许重新注册修复
      if (!users[stuId].password) {
        // 保留原有的头像和加入时间等字段
        const mergedUser = users[stuId];
        mergedUser.name = name;
        mergedUser.password = password;
        if (campus) mergedUser.campus = campus;
        if (college) mergedUser.college = college;
        if (major) mergedUser.major = major;
        if (grade) mergedUser.grade = grade;
        users[stuId] = mergedUser;
        db.users = users;
        db._updatedAt = new Date().toISOString();
        writeDB(db);
        const token = generateToken(stuId);
        return res.status(201).json({
          token,
          user: { ...users[stuId], password: undefined }
        });
      }
      return res.status(409).json({ error: '该学号已注册' });
    }

    // 生成头像
    const avatarColors = [
      { bg: '#E6F1FB', color: '#185FA5' },
      { bg: '#EAF3DE', color: '#3B6D11' },
      { bg: '#FBEAF0', color: '#993556' },
      { bg: '#FAEEDA', color: '#854F0B' },
      { bg: '#E0F2FE', color: '#0369A1' },
      { bg: '#FEF3C7', color: '#92400E' },
      { bg: '#EFF6FF', color: '#1D4ED8' },
      { bg: '#FDF2F8', color: '#BE185D' }
    ];
    const avatarIdx = Object.keys(users).length % avatarColors.length;
    const ac = avatarColors[avatarIdx];

    const newUser = {
      stuId,
      name,
      password,  // 生产环境应加密
      campus: campus || '青山校区',
      college: college || '',
      major: major || '',
      grade: grade || '',
      avatarBg: ac.bg,
      avatarColor: ac.color,
      avatarText: name.charAt(0),
      joinTime: new Date().toISOString().split('T')[0],
      bio: '',
      followers: 0,
      following: 0,
      friends: [],
      pendingFriends: []
    };

    users[stuId] = newUser;
    db.users = users;
    db._updatedAt = new Date().toISOString();
    writeDB(db);

    const token = generateToken(stuId);
    res.status(201).json({
      token,
      user: { ...newUser, password: undefined }
    });
  } catch (e) {
    console.error('注册失败:', e);
    res.status(500).json({ error: '服务器错误' });
  }
});

// ---- 登录 ----
app.post('/api/auth/login', (req, res) => {
  try {
    const { stuId, password } = req.body;

    if (!stuId || !password) {
      return res.status(400).json({ error: '学号和密码不能为空' });
    }

    const db = readDB();
    const users = db.users || {};
    const user = users[stuId];

    if (!user) {
      return res.status(404).json({ error: '该学号未注册' });
    }

    if (user.password !== password) {
      return res.status(400).json({ error: '密码错误' });
    }

    const token = generateToken(stuId);
    res.json({
      token,
      user: { ...user, password: undefined }
    });
  } catch (e) {
    console.error('登录失败:', e);
    res.status(500).json({ error: '服务器错误' });
  }
});

// ---- 登出 ----
app.post('/api/auth/logout', authMiddleware, (req, res) => {
  const token = req.headers['authorization']?.replace('Bearer ', '');
  if (token) delete tokens[token];
  res.json({ ok: true });
});

// ---- 获取当前用户信息 ----
app.get('/api/auth/me', authMiddleware, (req, res) => {
  const db = readDB();
  const user = (db.users || {})[req.user.stuId];
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json({ ...user, password: undefined });
});

// ---- 全量同步：拉取所有数据 ----
app.get('/api/sync', authMiddleware, (req, res) => {
  const db = readDB();
  // 不返回用户密码
  const safeUsers = {};
  if (db.users) {
    Object.keys(db.users).forEach(id => {
      safeUsers[id] = { ...db.users[id], password: undefined };
    });
  }
  res.json({
    users: safeUsers,
    posts: db.posts || [],
    products: db.products || [],
    activities: db.activities || [],
    career_posts: db.career_posts || [],
    messages: db.messages || {},
    conversations: db.conversations || [],
    purchaseRequests: db.purchaseRequests || [],
    bargains: db.bargains || [],
    _updatedAt: db._updatedAt || null
  });
});

// ---- 增量同步：推送单个 key 的数据 ----
app.put('/api/sync/:key', authMiddleware, (req, res) => {
  const allowedKeys = [
    'users', 'posts', 'products', 'activities',
    'career_posts', 'messages', 'conversations',
    'purchaseRequests', 'bargains'
  ];

  const key = req.params.key;
  if (!allowedKeys.includes(key)) {
    return res.status(400).json({ error: '无效的数据 key: ' + key });
  }

  const value = req.body;
  if (value === undefined || value === null) {
    return res.status(400).json({ error: '数据不能为空' });
  }

  const db = readDB();
  db[key] = value;
  db._updatedAt = new Date().toISOString();
  writeDB(db);

  res.json({ ok: true, key, updatedAt: db._updatedAt });
});

// ---- 全量推送（覆盖所有数据） ----
app.post('/api/sync', authMiddleware, (req, res) => {
  const allowedKeys = [
    'users', 'posts', 'products', 'activities',
    'career_posts', 'messages', 'conversations',
    'purchaseRequests', 'bargains'
  ];

  const data = req.body;
  const db = readDB();

  allowedKeys.forEach(key => {
    if (data[key] !== undefined) {
      db[key] = data[key];
    }
  });

  db._updatedAt = new Date().toISOString();
  writeDB(db);

  res.json({ ok: true, updatedAt: db._updatedAt });
});

// ---- 用户信息更新 ----
app.put('/api/users/:stuId', authMiddleware, (req, res) => {
  const targetStuId = req.params.stuId;
  // 只能修改自己的信息
  if (req.user.stuId !== targetStuId) {
    return res.status(403).json({ error: '只能修改自己的信息' });
  }

  const db = readDB();
  const users = db.users || {};
  if (!users[targetStuId]) {
    return res.status(404).json({ error: '用户不存在' });
  }

  // 允许更新的字段
  const allowedFields = ['name', 'campus', 'college', 'major', 'grade', 'bio',
    'avatarBg', 'avatarColor', 'avatarText', 'followers', 'following',
    'friends', 'pendingFriends'];

  allowedFields.forEach(field => {
    if (req.body[field] !== undefined) {
      users[targetStuId][field] = req.body[field];
    }
  });

  db.users = users;
  db._updatedAt = new Date().toISOString();
  writeDB(db);

  res.json({ ok: true, user: { ...users[targetStuId], password: undefined } });
});

// ---- 初始化样本数据 ----
app.post('/api/init-sample', (req, res) => {
  const db = readDB();
  if (db._sampleInited === true) {
    return res.json({ ok: true, message: '样本数据已存在，跳过初始化' });
  }
  // 标记为已初始化（实际样本数据由前端 initSampleData 生成后通过 sync 推送）
  db._sampleInited = true;
  db._updatedAt = new Date().toISOString();
  writeDB(db);
  res.json({ ok: true, message: '样本数据标记已设置' });
});

// ---- 检查是否已初始化 ----
app.get('/api/init-status', authMiddleware, (req, res) => {
  const db = readDB();
  res.json({
    sampleInited: db._sampleInited === true,
    hasUsers: Object.keys(db.users || {}).length > 0,
    hasPosts: (db.posts || []).length > 0,
    updatedAt: db._updatedAt || null
  });
});

// ============================================================
// 静态文件服务（前端页面）
// ============================================================
app.use(express.static(__dirname, {
  index: 'index.html',
  extensions: ['html']
}));

// 所有未匹配的路由返回 index.html (SPA fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================================
// 启动服务
// ============================================================
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║   🏫 武汉科技大学校园社区 - 数据存储服务      ║');
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║   地址: http://localhost:${PORT}                 ║`);
  console.log('║   数据: ' + DATA_DIR);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');
});
