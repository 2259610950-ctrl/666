// ============================================================
// WKUST Campus - 核心数据与认证系统
// 武汉科技大学校园社区
// ============================================================

// ---- 全局按钮涟漪效果 ----
(function initRippleSystem() {
  document.addEventListener('click', function(e) {
    var btn = e.target.closest('button:not(:disabled)');
    if (!btn) return;
    // 跳过不需要涟漪的按钮
    if (btn.classList.contains('no-ripple')) return;

    var rect = btn.getBoundingClientRect();
    var size = Math.max(rect.width, rect.height) * 2;
    var x = e.clientX - rect.left - size / 2;
    var y = e.clientY - rect.top - size / 2;

    var ripple = document.createElement('span');
    ripple.className = 'ripple-circle';

    // 根据按钮背景判断涟漪颜色
    var bg = getComputedStyle(btn).backgroundColor;
    var isLight = bg.includes('rgb(255') || bg.includes('rgb(249') || bg.includes('rgb(243') || bg.includes('rgb(239') || bg.includes('rgb(229') || bg.includes('rgba(255') || bg === 'transparent';
    var isDark = !isLight;
    btn.classList.add(isDark ? 'dark-ripple' : 'light-ripple');
    btn.classList.add('btn-ripple');

    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';

    btn.appendChild(ripple);
    ripple.addEventListener('animationend', function() {
      ripple.remove();
    });
  }, true);
})();

// ============================================================
// 云端数据同步层
// ============================================================
var CloudSync = {
  // 是否为服务器模式（file:// 协议下不可用）
  enabled: window.location.protocol !== 'file:',
  // API 基地址
  baseURL: window.location.origin || '',
  // 同步队列（防抖）
  _queue: {},
  _timer: null,
  // 是否正在同步
  syncing: false,

  // 获取 Token
  getToken: function() {
    return localStorage.getItem('wkust_apiToken') || '';
  },

  // 设置 Token
  setToken: function(token) {
    if (token) {
      localStorage.setItem('wkust_apiToken', token);
    } else {
      localStorage.removeItem('wkust_apiToken');
    }
  },

  // API 请求
  request: function(method, path, body) {
    if (!this.enabled) return Promise.resolve(null);
    var self = this;
    return new Promise(function(resolve) {
      try {
        var opts = {
          method: method,
          headers: { 'Content-Type': 'application/json' }
        };
        var token = self.getToken();
        if (token) opts.headers['Authorization'] = 'Bearer ' + token;
        if (body !== undefined) opts.body = JSON.stringify(body);

        fetch(self.baseURL + path, opts).then(function(resp) {
          if (resp.status === 401) {
            // Token 过期，清除
            self.setToken('');
            resolve({ _error: 'unauthorized' });
            return;
          }
          return resp.json().then(function(data) {
            resolve(data);
          });
        }).catch(function(e) {
          console.warn('[CloudSync] 请求失败:', path, e.message);
          resolve(null);
        });
      } catch(e) {
        console.warn('[CloudSync] 请求异常:', e.message);
        resolve(null);
      }
    });
  },

  // 推送单个 key 到服务器（防抖合并）
  pushKey: function(key, value) {
    if (!this.enabled || !this.getToken()) return;
    var self = this;
    this._queue[key] = value;
    clearTimeout(this._timer);
    this._timer = setTimeout(function() {
      self._flushQueue();
    }, 800);
  },

  // 执行队列中的推送
  _flushQueue: function() {
    var queue = this._queue;
    this._queue = {};
    var self = this;

    // 逐个推送（避免全量覆盖冲突）
    Object.keys(queue).forEach(function(key) {
      self.request('PUT', '/api/sync/' + key, queue[key]).then(function(result) {
        if (result && result.ok) {
          // console.log('[CloudSync] 推送成功:', key);
        }
      });
    });
  },

  // 从服务器拉取全量数据
  pullAll: function() {
    if (!this.enabled || !this.getToken()) return Promise.resolve(false);
    var self = this;
    this.syncing = true;

    return this.request('GET', '/api/sync').then(function(data) {
      self.syncing = false;
      if (!data || data._error) return false;

      // 将服务器数据写入 localStorage
      var keys = ['users','posts','products','activities','career_posts','messages','conversations','purchaseRequests','bargains'];
      keys.forEach(function(k) {
        if (data[k] !== undefined && data[k] !== null) {
          localStorage.setItem('wkust_' + k, JSON.stringify(data[k]));
        }
      });

      // 合并 users：服务器数据可能不含密码，保留本地已有的密码
      var localUsers = {};
      try { localUsers = JSON.parse(localStorage.getItem('wkust_users') || '{}'); } catch(e) {}
      if (data.users) {
        Object.keys(data.users).forEach(function(uid) {
          if (localUsers[uid] && localUsers[uid].password && !data.users[uid].password) {
            data.users[uid].password = localUsers[uid].password;
          }
        });
        localStorage.setItem('wkust_users', JSON.stringify(data.users));
      }

      console.log('[CloudSync] 数据同步完成');
      return true;
    });
  },

  // 全量推送到服务器
  pushAll: function() {
    if (!this.enabled || !this.getToken()) return Promise.resolve(false);
    var data = {};
    var keys = ['users','posts','products','activities','career_posts','messages','conversations','purchaseRequests','bargains'];
    var self = this;
    keys.forEach(function(k) {
      try {
        var val = JSON.parse(localStorage.getItem('wkust_' + k) || 'null');
        if (val !== null) data[k] = val;
      } catch(e) {}
    });
    return this.request('POST', '/api/sync', data).then(function(result) {
      if (result && result.ok) {
        console.log('[CloudSync] 全量推送完成');
      }
      return result && result.ok;
    });
  },

  // 登录
  login: function(stuId, password) {
    var self = this;
    return this.request('POST', '/api/auth/login', { stuId: stuId, password: password }).then(function(data) {
      if (!data) return { error: '服务器连接失败，请检查网络' };
      if (data._error) return { error: '服务器错误，请稍后重试' };
      if (data.error) return data;
      self.setToken(data.token);
      return { token: data.token, user: data.user };
    });
  },

  // 注册
  register: function(info) {
    var self = this;
    return this.request('POST', '/api/auth/register', info).then(function(data) {
      if (!data || data._error) return { error: '网络错误' };
      if (data.error) return data;
      self.setToken(data.token);
      return { token: data.token, user: data.user };
    });
  },

  // 更新用户信息
  updateUser: function(stuId, updates) {
    return this.request('PUT', '/api/users/' + stuId, updates);
  },

  // 检查初始化状态
  getInitStatus: function() {
    return this.request('GET', '/api/init-status');
  }
};

// ---- 数据管理 ----
const DB = {
  get(key) { try { return JSON.parse(localStorage.getItem('wkust_' + key) || 'null'); } catch { return null; } },
  set(key, val) {
    localStorage.setItem('wkust_' + key, JSON.stringify(val));
    // 自动推送到云端（防抖）
    CloudSync.pushKey(key, val);
  },
  getUsers() { return this.get('users') || {}; },
  getPosts() { return this.get('posts') || []; },
  getProducts() { return this.get('products') || []; },
  getActivities() { return this.get('activities') || []; },
  getCareerPosts() { return this.get('career_posts') || []; },
  getCurrentUser() {
    const id = localStorage.getItem('wkust_currentUser');
    if (!id) return null;
    const users = this.getUsers();
    return users[id] || null;
  },
  getCurrentUserId() { return localStorage.getItem('wkust_currentUser'); },
  getMessages() { return this.get('messages') || {}; },
  getConversations() { return this.get('conversations') || []; }
};

// ---- 认证守卫 ----
function requireAuth() {
  const user = DB.getCurrentUser();
  if (!user) {
    window.location.href = 'auth.html';
    return null;
  }
  // 后台静默同步（不阻塞页面渲染）
  if (CloudSync.enabled && CloudSync.getToken()) {
    CloudSync.pullAll().then(function(ok) {
      if (ok) {
        // 数据已更新，刷新需要数据的组件
        window.dispatchEvent(new CustomEvent('dataSynced'));
      }
    });
  }
  return user;
}

// ---- 登出 ----
function logout() {
  if (confirm('确定要退出登录吗？')) {
    // 退出前先推送数据到服务器
    CloudSync.pushAll().then(function() {
      CloudSync.request('POST', '/api/auth/logout');
      CloudSync.setToken('');
      localStorage.removeItem('wkust_currentUser');
      window.location.href = 'auth.html';
    });
  }
}

// ---- 校区过滤器 ----
function getCampusFilter() {
  return localStorage.getItem('wkust_campusFilter') || 'all';
}
function setCampusFilter(campus) {
  localStorage.setItem('wkust_campusFilter', campus);
  // 触发自定义事件通知各页面刷新
  window.dispatchEvent(new CustomEvent('campusChanged', { detail: campus }));
  updateCampusUI(campus);
}
function filterByCampus(posts) {
  const cf = getCampusFilter();
  return cf === 'all' ? posts : posts.filter(p => p.campus === cf);
}
function updateCampusUI(campus) {
  const btnAll = document.getElementById('campusBtnAll');
  const btnQS = document.getElementById('campusBtnQS');
  const btnHJH = document.getElementById('campusBtnHJH');
  if (btnAll) btnAll.classList.toggle('active', campus === 'all');
  if (btnQS) btnQS.classList.toggle('active', campus === '青山校区');
  if (btnHJH) btnHJH.classList.toggle('active', campus === '黄家湖校区');
}

// ---- 私信系统 ----
function sendMessage(fromId, toId, text) {
  if (!text || !text.trim()) return null;
  const key = [fromId, toId].sort().join('_');
  const msgs = DB.getMessages();
  if (!msgs[key]) msgs[key] = [];
  const msg = {
    id: 'm_' + Date.now(),
    from: fromId,
    to: toId,
    text: text.trim(),
    time: new Date().toISOString(),
    read: false
  };
  msgs[key].push(msg);
  DB.set('messages', msgs);

  // 更新会话列表
  const convs = DB.getConversations();
  const users = DB.getUsers();
  const otherUser = users[toId] || { name: '用户', avatarText: '?', avatarBg: '#E5E7EB', avatarColor: '#6B7280' };
  let conv = convs.find(c => c.partnerId === toId);
  if (!conv) {
    conv = { partnerId: toId, partnerName: otherUser.name, partnerAvatar: otherUser.avatarText, partnerAvatarBg: otherUser.avatarBg, partnerAvatarColor: otherUser.avatarColor, lastMsg: text.trim().slice(0, 30), lastTime: msg.time, unread: 0, unreadCount: 0 };
    convs.push(conv);
  } else {
    conv.lastMsg = text.trim().slice(0, 30);
    conv.lastTime = msg.time;
    conv.partnerName = otherUser.name;
    conv.partnerAvatar = otherUser.avatarText;
    conv.partnerAvatarBg = otherUser.avatarBg;
    conv.partnerAvatarColor = otherUser.avatarColor;
  }
  // 对方那边也要有会话（如果是给自己发则跳过）
  if (fromId !== toId) {
    const selfUser = users[fromId] || { name: '用户', avatarText: '?', avatarBg: '#E5E7EB', avatarColor: '#6B7280' };
    let otherConv = convs.find(c => c.partnerId === fromId);
    if (!otherConv) {
      otherConv = { partnerId: fromId, partnerName: selfUser.name, partnerAvatar: selfUser.avatarText, partnerAvatarBg: selfUser.avatarBg, partnerAvatarColor: selfUser.avatarColor, lastMsg: text.trim().slice(0, 30), lastTime: msg.time, unread: 0, unreadCount: 0 };
      convs.push(otherConv);
    } else {
      otherConv.lastMsg = text.trim().slice(0, 30);
      otherConv.lastTime = msg.time;
      otherConv.unreadCount = (otherConv.unreadCount || 0) + 1;
    }
  }
  DB.set('conversations', convs);
  return msg;
}

function getMessagesBetween(userId1, userId2) {
  const key = [userId1, userId2].sort().join('_');
  const msgs = DB.getMessages();
  return msgs[key] || [];
}

function getConversationsForUser(userId) {
  const allConvs = DB.getConversations();
  // 过滤并排序：返回对方的会话
  const convs = allConvs.filter(c => c.partnerId !== userId).sort((a, b) => new Date(b.lastTime) - new Date(a.lastTime));
  // 重新计算未读数
  const msgs = DB.getMessages();
  return convs.map(c => {
    const key = [userId, c.partnerId].sort().join('_');
    const unread = (msgs[key] || []).filter(m => m.to === userId && !m.read).length;
    c.unreadCount = unread;
    return c;
  });
}

function markMessagesAsRead(userId, partnerId) {
  const key = [userId, partnerId].sort().join('_');
  const msgs = DB.getMessages();
  if (!msgs[key]) return;
  let changed = false;
  msgs[key].forEach(m => { if (m.to === userId && !m.read) { m.read = true; changed = true; } });
  if (changed) DB.set('messages', msgs);
  // 更新会话未读数
  const convs = DB.getConversations();
  const conv = convs.find(c => c.partnerId === partnerId);
  if (conv) conv.unreadCount = 0;
  DB.set('conversations', convs);
}

function getTotalUnread(userId) {
  const convs = getConversationsForUser(userId);
  return convs.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
}

function getUserByStuId(stuId) {
  const users = DB.getUsers();
  return users[stuId] || null;
}

// ---- 用户资料更新 ----
function updateUserProfile(stuId, updates) {
  const users = DB.getUsers();
  if (!users[stuId]) return { success: false, error: '用户不存在' };

  // 昵称校验
  if (updates.name !== undefined) {
    const name = updates.name.trim();
    if (!name) return { success: false, error: '昵称不能为空' };
    if (name.length < 2) return { success: false, error: '昵称至少需要2个字符' };
    if (name.length > 12) return { success: false, error: '昵称最长12个字符' };
    updates.name = name;
    // 同步更新头像文字
    updates.avatarText = name.charAt(0);
  }

  // 简介字数限制
  if (updates.bio !== undefined) {
    const bio = updates.bio.trim();
    if (bio.length > 200) return { success: false, error: '简介最长200字' };
    updates.bio = bio;
  }

  // 手机号格式
  if (updates.phone !== undefined && updates.phone !== '') {
    if (!/^1[3-9]\d{9}$/.test(updates.phone)) return { success: false, error: '手机号格式不正确' };
  }

  // 邮箱格式
  if (updates.email !== undefined && updates.email !== '') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) return { success: false, error: '邮箱格式不正确' };
  }

  // QQ号格式
  if (updates.qq !== undefined && updates.qq !== '') {
    if (!/^\d{5,11}$/.test(updates.qq)) return { success: false, error: 'QQ号格式不正确（5-11位数字）' };
  }

  // 微信号格式
  if (updates.wechat !== undefined && updates.wechat !== '') {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]{5,19}$/.test(updates.wechat)) return { success: false, error: '微信号格式不正确（字母开头，6-20位）' };
  }

  // 应用更新
  Object.assign(users[stuId], updates);

  // 同时更新所有帖子中的作者信息
  const posts = DB.getPosts();
  let postChanged = false;
  posts.forEach(p => {
    if (p.authorId === stuId) {
      if (updates.name) p.authorName = updates.name;
      if (updates.avatarText) p.authorAvatar = updates.avatarText;
      if (updates.avatarBg) p.authorAvatarBg = updates.avatarBg;
      if (updates.avatarColor) p.authorAvatarColor = updates.avatarColor;
      postChanged = true;
    }
    // 更新评论中的作者信息
    if (p.comments) {
      p.comments.forEach(c => {
        if (c.authorId === stuId) {
          if (updates.name) c.authorName = updates.name;
          if (updates.avatarText) c.authorAvatar = updates.avatarText;
          if (updates.avatarBg) c.authorAvatarBg = updates.avatarBg;
          if (updates.avatarColor) c.authorAvatarColor = updates.avatarColor;
        }
      });
    }
  });
  if (postChanged) DB.set('posts', posts);

  // 更新会话中的用户信息
  const convs = DB.getConversations();
  convs.forEach(c => {
    if (c.partnerId === stuId) {
      if (updates.name) c.partnerName = updates.name;
      if (updates.avatarText) c.partnerAvatar = updates.avatarText;
      if (updates.avatarBg) c.partnerAvatarBg = updates.avatarBg;
      if (updates.avatarColor) c.partnerAvatarColor = updates.avatarColor;
    }
  });
  DB.set('conversations', convs);

  DB.set('users', users);
  return { success: true, user: users[stuId] };
}

// ---- 头像生成（canvas裁剪） ----
function cropAvatar(imageDataUrl, cropX, cropY, cropSize, outputSize) {
  return new Promise(function(resolve, reject) {
    var img = new Image();
    img.onload = function() {
      var canvas = document.createElement('canvas');
      canvas.width = outputSize || 200;
      canvas.height = outputSize || 200;
      var ctx = canvas.getContext('2d');

      // 计算源图像上的裁剪区域
      var scaleX = img.naturalWidth / 300; // 假设预览画布是300x300
      var scaleY = img.naturalHeight / 300;

      // 圆形裁剪
      ctx.beginPath();
      ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2);
      ctx.clip();

      ctx.drawImage(
        img,
        cropX * scaleX, cropY * scaleY, cropSize * scaleX, cropSize * scaleY,
        0, 0, canvas.width, canvas.height
      );

      // 转换为压缩后的dataURL
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = function() { reject(new Error('图片加载失败')); };
    img.src = imageDataUrl;
  });
}

// ---- 导航栏渲染 ----
function renderNav(activeLink) {
  const user = DB.getCurrentUser();
  if (!user) return;
  const navAvatar = document.getElementById('navAvatar');
  if (navAvatar) {
    navAvatar.style.background = user.avatarBg;
    navAvatar.style.color = user.avatarColor;
    navAvatar.textContent = user.avatarText;
  }
  const navName = document.getElementById('navUserName');
  if (navName) navName.textContent = user.name;
  const campusBadge = document.getElementById('navCampusBadge');
  if (campusBadge) {
    campusBadge.textContent = user.campus;
    campusBadge.className = 'brand-tag ' + (user.campus === '青山校区' ? 'qs' : 'hjh');
  }
  // 统一注入导航链接（解决各页面硬编码不一致的问题）
  const navLinksEl = document.querySelector('.nav-links');
  if (navLinksEl) {
    const links = [
      { href: 'index.html', text: '首页' },
      { href: 'academic.html', text: '学术广场' },
      { href: 'market.html', text: '二手集市' },
      { href: 'services.html', text: '帮帮' },
      { href: 'social.html', text: '社交动态' },
      { href: 'career.html', text: '职业内推' },
      { href: 'activity.html', text: '活动约伴' }
    ];
    navLinksEl.innerHTML = links.map(function(l) {
      return '<a href="' + l.href + '" class="nav-link' + (activeLink && l.href === activeLink ? ' active' : '') + '">' + l.text + '</a>';
    }).join('');
  }
  // 动态注入校区切换器
  injectCampusSwitcher();
  // 动态注入消息 & 通知图标
  injectActionIcons();
}

// 校区切换器注入
function injectCampusSwitcher() {
  const navBrand = document.querySelector('.nav-brand');
  if (!navBrand || document.getElementById('campusSwitcherWrap')) return;
  const sw = document.createElement('div');
  sw.id = 'campusSwitcherWrap';
  sw.className = 'campus-switcher-wrap';
  const cf = getCampusFilter();
  sw.innerHTML = `
    <button class="campus-switch-btn ${cf === 'all' ? 'active' : ''}" id="campusBtnAll" onclick="setCampusFilter('all')">全部</button>
    <button class="campus-switch-btn qs ${cf === '青山校区' ? 'active' : ''}" id="campusBtnQS" onclick="setCampusFilter('青山校区')">青山</button>
    <button class="campus-switch-btn hjh ${cf === '黄家湖校区' ? 'active' : ''}" id="campusBtnHJH" onclick="setCampusFilter('黄家湖校区')">黄家湖</button>`;
  // 插入到 brand 和 links 之间
  const navContainer = navBrand.parentNode;
  const navLinks = document.querySelector('.nav-links');
  if (navContainer && navLinks) navContainer.insertBefore(sw, navLinks);
}

// 消息 & 通知图标注入
function injectActionIcons() {
  const navActions = document.querySelector('.nav-actions');
  if (!navActions || document.getElementById('navMsgIcon')) return;
  const user = DB.getCurrentUser();
  if (!user) return;

  // 私信图标
  const msgBtn = document.createElement('button');
  msgBtn.id = 'navMsgIcon';
  msgBtn.className = 'btn-icon nav-msg-btn';
  msgBtn.title = '私信';
  msgBtn.onclick = function() { window.location.href = 'chat.html'; };
  const unread = getTotalUnread(user.stuId);
  msgBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>${unread > 0 ? `<span class="badge-dot msg-badge" id="msgBadge">${unread > 99 ? '99+' : unread}</span>` : ''}`;

  // 交易通知图标（砍价+购买请求）
  const bargainCount = getBargainCountForSeller(user.stuId);
  const purchaseCount = getPendingPurchaseCountForSeller(user.stuId);
  const totalTradeNotif = bargainCount + purchaseCount;
  const tradeBtn = document.createElement('button');
  tradeBtn.id = 'navTradeIcon';
  tradeBtn.className = 'btn-icon nav-msg-btn';
  tradeBtn.title = '交易通知';
  tradeBtn.style.position = 'relative';
  tradeBtn.onclick = function() { window.location.href = 'market.html'; };
  tradeBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>${totalTradeNotif > 0 ? `<span class="badge-dot" style="background:#F59E0B;position:absolute;top:-2px;right:-2px;font-size:10px;min-width:16px;height:16px;border-radius:10px;display:flex;align-items:center;justify-content:center;padding:0 4px">${totalTradeNotif}</span>` : ''}`;

  // 搜索按钮
  const searchBtn = document.getElementById('searchBtn');

  // 插入到搜索按钮前
  if (searchBtn) {
    navActions.insertBefore(tradeBtn, searchBtn);
    navActions.insertBefore(msgBtn, searchBtn);
  } else {
    navActions.appendChild(tradeBtn);
    navActions.appendChild(msgBtn);
  }
}

// ---- 服务分类定义 ----
const SERVICE_TYPES = {
  study: { name: '学习互助', icon: '📖', css: 'study', desc: '代课、资料共享、作业辅导' },
  errand: { name: '跑腿代办', icon: '🏃', css: 'errand', desc: '代取快递、打印、代办事务' },
  group: { name: '拼单生活', icon: '🛒', css: 'group', desc: '外卖拼单、拼车、团购' },
  lost: { name: '失物招领', icon: '🔍', css: 'lost', desc: '寻物启示、拾物招领' },
  job: { name: '兼职招聘', icon: '💼', css: 'job', desc: '校内兼职、实习、日结' },
  rent: { name: '房屋租转', icon: '🏠', css: 'rent', desc: '转租、合租、短租' },
  giveaway: { name: '闲置赠送', icon: '🎁', css: 'giveaway', desc: '免费送、以物换物' },
  confess: { name: '表白墙', icon: '💌', css: 'confess', desc: '匿名表白、浪漫传递' },
  secret: { name: '树洞吐槽', icon: '🌳', css: 'secret', desc: '匿名倾诉、心事树洞' }
};

function getServiceStats() {
  const posts = DB.getPosts().filter(p => p.type === 'service');
  const stats = {};
  Object.keys(SERVICE_TYPES).forEach(k => { stats[k] = posts.filter(p => p.category === k).length; });
  stats.total = posts.length;
  return stats;
}

// ---- 商品状态管理（已售出/已下架） ----
function markItemSold(postId) {
  const posts = DB.getPosts();
  const idx = posts.findIndex(p => p.id === postId);
  if (idx === -1) return null;
  posts[idx].status = 'sold';
  posts[idx].soldAt = new Date().toISOString();
  DB.set('posts', posts);
  return posts[idx];
}

function toggleDelist(postId) {
  const posts = DB.getPosts();
  const idx = posts.findIndex(p => p.id === postId);
  if (idx === -1) return null;
  const currentStatus = posts[idx].status;
  if (currentStatus === 'delisted') {
    // 重新上架：清除所有状态
    posts[idx].status = null;
    delete posts[idx].delistedAt;
    delete posts[idx].soldAt;
  } else {
    // 下架（无论之前是否已售出）
    posts[idx].status = 'delisted';
    posts[idx].delistedAt = new Date().toISOString();
    delete posts[idx].soldAt; // 清除已售出标记
  }
  DB.set('posts', posts);
  return posts[idx];
}

function getMarketStats() {
  const posts = DB.getPosts().filter(p => p.type === 'market');
  const active = posts.filter(p => !p.status || p.status === null);
  const sold = posts.filter(p => p.status === 'sold');
  const delisted = posts.filter(p => p.status === 'delisted');
  return { total: posts.length, active: active.length, sold: sold.length, delisted: delisted.length };
}

// ---- Toast ----
function showToast(msg, type) {
  const colors = { success: '#059669', error: '#DC2626', info: '#4F46E5', warn: '#D97706' };
  const bg = colors[type] || colors.info;
  const t = document.createElement('div');
  t.className = 'toast-msg';
  t.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%) translateY(20px);background:${bg};color:white;padding:10px 22px;border-radius:24px;font-size:13px;z-index:9999;opacity:0;transition:all .3s ease;box-shadow:0 4px 16px rgba(0,0,0,.18);white-space:nowrap;pointer-events:none;`;
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(0)'; });
  setTimeout(() => {
    t.style.opacity = '0'; t.style.transform = 'translateX(-50%) translateY(10px)';
    setTimeout(() => t.remove(), 300);
  }, 2500);
}

// ---- 模态框 ----
function openModal(html) {
  closeModal();
  const overlay = document.createElement('div');
  overlay.id = 'globalModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `<div class="modal-box">${html}</div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => overlay.classList.add('modal-open'));
}

function closeModal() {
  const m = document.getElementById('globalModal');
  if (m) { m.classList.remove('modal-open'); setTimeout(() => { m.remove(); document.body.style.overflow = ''; }, 300); }
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ---- 帖子相关 ----
function createPost(data) {
  const user = DB.getCurrentUser();
  if (!user) return null;
  const posts = DB.getPosts();
  const post = {
    id: Date.now() + '_' + Math.random().toString(36).slice(2),
    ...data,
    authorId: user.stuId,
    authorName: user.name,
    authorAvatar: user.avatarText,
    authorAvatarBg: user.avatarBg,
    authorAvatarColor: user.avatarColor,
    campus: user.campus,
    college: user.college,
    major: user.major,
    grade: user.grade,
    time: new Date().toISOString(),
    likes: 0,
    likedBy: [],
    comments: [],
    views: 0,
    images: data.images || []
  };
  posts.unshift(post);
  DB.set('posts', posts);
  return post;
}

function getPostById(id) {
  return DB.getPosts().find(p => p.id === id);
}

function togglePostLike(postId) {
  const user = DB.getCurrentUser();
  if (!user) { showToast('请先登录', 'error'); return null; }
  const posts = DB.getPosts();
  const idx = posts.findIndex(p => p.id === postId);
  if (idx === -1) return null;
  const post = posts[idx];
  const likedIdx = (post.likedBy || []).indexOf(user.stuId);
  if (likedIdx === -1) {
    post.likedBy.push(user.stuId);
    post.likes = (post.likes || 0) + 1;
  } else {
    post.likedBy.splice(likedIdx, 1);
    post.likes = Math.max(0, (post.likes || 0) - 1);
  }
  DB.set('posts', posts);
  return { liked: likedIdx === -1, count: post.likes };
}

function addComment(postId, content) {
  const user = DB.getCurrentUser();
  if (!user) { showToast('请先登录', 'error'); return null; }
  if (!content.trim()) return null;
  const posts = DB.getPosts();
  const idx = posts.findIndex(p => p.id === postId);
  if (idx === -1) return null;
  const comment = {
    id: Date.now() + '_c',
    authorId: user.stuId,
    authorName: user.name,
    authorAvatar: user.avatarText,
    authorAvatarBg: user.avatarBg,
    authorAvatarColor: user.avatarColor,
    content: content.trim(),
    time: new Date().toISOString(),
    likes: 0,
    likedBy: []
  };
  if (!posts[idx].comments) posts[idx].comments = [];
  posts[idx].comments.push(comment);
  DB.set('posts', posts);
  return comment;
}

// ---- 时间格式化 ----
function timeAgo(isoStr) {
  const diff = (Date.now() - new Date(isoStr)) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
  if (diff < 604800) return Math.floor(diff / 86400) + '天前';
  return new Date(isoStr).toLocaleDateString('zh-CN');
}

// ---- 搜索 ----
function openSearch() {
  document.getElementById('searchOverlay')?.classList.add('active');
  setTimeout(() => document.getElementById('searchInput')?.focus(), 50);
}
function closeSearch() {
  document.getElementById('searchOverlay')?.classList.remove('active');
}
function fillSearch(el) {
  const input = document.getElementById('searchInput');
  if (input) { input.value = el.textContent; input.focus(); }
}
document.getElementById('searchBtn')?.addEventListener('click', openSearch);
document.getElementById('searchOverlay')?.addEventListener('click', function(e) {
  if (e.target === this) closeSearch();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeSearch(); closeModal(); } });

// ---- 导航滚动 ----
window.addEventListener('scroll', () => {
  const nav = document.getElementById('navbar');
  if (nav) nav.classList.toggle('scrolled', window.scrollY > 10);
});

// ---- 筛选标签 ----
function initFilterTags() {
  document.querySelectorAll('.filter-bar').forEach(bar => {
    bar.querySelectorAll('.filter-tag').forEach(tag => {
      tag.addEventListener('click', function() {
        bar.querySelectorAll('.filter-tag').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
      });
    });
  });
}

// ---- 初始化样本数据 ----
function initSampleData() {
  // 如果已初始化且帖子数据完整，跳过
  if (localStorage.getItem('wkust_sample_inited') === '1') {
    const existing = DB.getPosts();
    if (existing && existing.length >= 10) return;
    console.warn('样本数据异常，重新初始化');
  }

  // ---- 示例用户（共6人） ----
  const sampleUsers = {
    '2021010001': {
      stuId: '2021010001', name: '李思远', campus: '青山校区',
      college: '计算机科学与技术学院', major: '计算机科学与技术', grade: '大三',
      password: '123456', avatarBg: '#E6F1FB', avatarColor: '#185FA5', avatarText: '李',
      joinTime: '2021-09-01', bio: '热爱编程，喜欢打篮球', followers: 128, following: 64, friends: [], pendingFriends: []
    },
    '2022020002': {
      stuId: '2022020002', name: '王晓琳', campus: '青山校区',
      college: '材料科学与工程学院', major: '材料科学与工程', grade: '大二',
      password: '123456', avatarBg: '#EAF3DE', avatarColor: '#3B6D11', avatarText: '王',
      joinTime: '2022-09-01', bio: '文艺女生，爱好摄影', followers: 56, following: 38, friends: [], pendingFriends: []
    },
    '2020030003': {
      stuId: '2020030003', name: '陈梓涵', campus: '黄家湖校区',
      college: '医学部', major: '临床医学', grade: '大四',
      password: '123456', avatarBg: '#FBEAF0', avatarColor: '#993556', avatarText: '陈',
      joinTime: '2020-09-01', bio: '医学生，爱打羽毛球', followers: 89, following: 45, friends: [], pendingFriends: []
    },
    '2019040004': {
      stuId: '2019040004', name: '赵明远', campus: '青山校区',
      college: '法学与经济学院', major: '金融学', grade: '研二',
      password: '123456', avatarBg: '#FAEEDA', avatarColor: '#854F0B', avatarText: '赵',
      joinTime: '2019-09-01', bio: '准职场人，喜欢研究股市', followers: 210, following: 78, friends: [], pendingFriends: []
    },
    '2021050005': {
      stuId: '2021050005', name: '张浩然', campus: '黄家湖校区',
      college: '电子信息学院', major: '电子信息工程', grade: '大三',
      password: '123456', avatarBg: '#E0F2FE', avatarColor: '#0369A1', avatarText: '张',
      joinTime: '2021-09-01', bio: '硬件爱好者，喜欢捣鼓单片机', followers: 95, following: 50, friends: [], pendingFriends: []
    },
    '2023060006': {
      stuId: '2023060006', name: '刘雨桐', campus: '青山校区',
      college: '机械工程学院', major: '机械设计制造及其自动化', grade: '大一',
      password: '123456', avatarBg: '#FEF3C7', avatarColor: '#92400E', avatarText: '刘',
      joinTime: '2023-09-01', bio: '文艺青年，吉他初学+摄影', followers: 34, following: 55, friends: [], pendingFriends: []
    }
  };

  // ---- 示例帖子 ----
  // 时间戳辅助：h=小时,m=分钟,d=天
  var ts = function(h,m,d) {
    var t = Date.now();
    if (d) t -= d * 86400000;
    if (h) t -= h * 3600000;
    if (m) t -= m * 60000;
    return new Date(t).toISOString();
  };

  var samplePosts = [];
  var svcId = 0;

  // ===== 学术广场（5条） =====
  samplePosts.push(
    { id:'p_a1', type:'academic', category:'学术', title:'数据结构期末复习资料整理分享', content:'整理了数据结构（C语言版）的期末复习笔记，包括链表、二叉树、图、排序算法的核心知识点和代码模板。已经做成PDF放在网盘了，需要的同学自取～链接在评论里。另外如果有同学需要答疑，可以约时间在图书馆一起讨论。', authorId:'2021010001', authorName:'李思远', authorAvatar:'李', authorAvatarBg:'#E6F1FB', authorAvatarColor:'#185FA5', campus:'青山校区', college:'计算机科学与技术学院', major:'计算机科学与技术', grade:'大三', time:ts(1,30), likes:56, likedBy:[], views:320, comments:[{ id:'ca1', authorId:'2022020002', authorName:'王晓琳', authorAvatar:'王', authorAvatarBg:'#EAF3DE', authorAvatarColor:'#3B6D11', content:'太及时了！求网盘链接 🙏', time:ts(1,10), likes:8, likedBy:[] },{ id:'ca2', authorId:'2023060006', authorName:'刘雨桐', authorAvatar:'刘', authorAvatarBg:'#FEF3C7', authorAvatarColor:'#92400E', content:'数据结构好难啊，求带飞！', time:ts(0,45), likes:3, likedBy:[] }] },
    { id:'p_a2', type:'academic', category:'学术', title:'有没有同学在学强化学习？', content:'最近在做期末项目，用Q-Learning写了个走迷宫的demo，遇到收敛很慢的问题，有大佬指路吗 🙋 epsilon-greedy策略我设的0.1，learning rate 0.01，折扣因子0.9，跑了5000轮还没稳定。分享下我的代码结构，希望得到反馈。', authorId:'2021010001', authorName:'李思远', authorAvatar:'李', authorAvatarBg:'#E6F1FB', authorAvatarColor:'#185FA5', campus:'青山校区', college:'计算机科学与技术学院', major:'计算机科学与技术', grade:'大三', time:ts(0,5), likes:24, likedBy:[], views:156, comments:[{ id:'ca3', authorId:'2019040004', authorName:'赵明远', authorAvatar:'赵', authorAvatarBg:'#FAEEDA', authorAvatarColor:'#854F0B', content:'试试用Double DQN，收敛会更稳定。另外epsilon可以动态衰减。', time:ts(0,2), likes:12, likedBy:[] }] },
    { id:'p_a3', type:'academic', category:'学术', title:'高等数学B下期末重点题型汇总', content:'临近期末，把高数B下册重点题型整理了下：重积分计算、曲线曲面积分、级数敛散判定。重点做题建议：同济教材课后习题奇数题 + 近五年真题。我整理了一份word版可以分享，有需要dd。', authorId:'2021050005', authorName:'张浩然', authorAvatar:'张', authorAvatarBg:'#E0F2FE', authorAvatarColor:'#0369A1', campus:'黄家湖校区', college:'电子信息学院', major:'电子信息工程', grade:'大三', time:ts(2,0), likes:78, likedBy:[], views:480, comments:[{ id:'ca4', authorId:'2023060006', authorName:'刘雨桐', authorAvatar:'刘', authorAvatarBg:'#FEF3C7', authorAvatarColor:'#92400E', content:'急需！高数真的太折磨了', time:ts(1,0), likes:15, likedBy:[] }] },
    { id:'p_a4', type:'academic', category:'学术', title:'英语四六级考前一周冲刺计划', content:'分享一个压缩版冲刺计划：Day1-2 近两年真题刷一遍，Day3 听力精听，Day4 阅读长难句攻克，Day5 写作模板背诵（议论文框架+图表描述），Day6 翻译+选词填空，Day7 模拟考+错题回顾。重点：听力和阅读最关键，这两块稳定了基本能过线。', authorId:'2022020002', authorName:'王晓琳', authorAvatar:'王', authorAvatarBg:'#EAF3DE', authorAvatarColor:'#3B6D11', campus:'青山校区', college:'材料科学与工程学院', major:'材料科学与工程', grade:'大二', time:ts(3,0), likes:112, likedBy:[], views:620, comments:[] },
    { id:'p_a5', type:'academic', category:'学术', title:'材料科学基础期末考点梳理', content:'给材料学院的学弟学妹们梳理一下材料科学基础的期末考点：相图分析必考（铁碳相图重点）、晶体结构（BCC/FCC/HCP）、扩散机制、力学性能测试。实验室那部分也会出简答题。有疑问可以留言，我尽量回复。', authorId:'2022020002', authorName:'王晓琳', authorAvatar:'王', authorAvatarBg:'#EAF3DE', authorAvatarColor:'#3B6D11', campus:'青山校区', college:'材料科学与工程学院', major:'材料科学与工程', grade:'大二', time:ts(4,0), likes:35, likedBy:[], views:198, comments:[] }
  );

  // ===== 二手集市（7条） =====
  samplePosts.push(
    { id:'p_m1', type:'market', category:'book', title:'出售《高等数学》同济版第七版全新', content:'高等数学（同济版第七版），上学期学校统一买的，基本没用过，书脊无破损，无任何笔记。面交优先，青山校区。价格可议。', price:28, originalPrice:59, condition:'全新', authorId:'2022020002', authorName:'王晓琳', authorAvatar:'王', authorAvatarBg:'#EAF3DE', authorAvatarColor:'#3B6D11', campus:'青山校区', college:'材料科学与工程学院', major:'材料科学与工程', grade:'大二', time:ts(0,20), likes:12, likedBy:[], views:87, comments:[{ id:'cm1', authorId:'2021010001', authorName:'李思远', authorAvatar:'李', authorAvatarBg:'#E6F1FB', authorAvatarColor:'#185FA5', content:'还在吗？我要！加我QQ吧', time:ts(0,15), likes:0, likedBy:[] }] },
    { id:'p_m2', type:'market', category:'digital', title:'MacBook Air M1 8+256 银白色', content:'2022年购入，一直自用，保养很好。无磕碰无划痕，电池健康度92%。配件齐全包括充电器+保护壳。毕业了换台式，所以出手。黄家湖校区面交，可当面验机。', price:3800, originalPrice:7999, condition:'9成新', authorId:'2020030003', authorName:'陈梓涵', authorAvatar:'陈', authorAvatarBg:'#FBEAF0', authorAvatarColor:'#993556', campus:'黄家湖校区', college:'医学院', major:'临床医学', grade:'大四', time:ts(1,0), likes:34, likedBy:[], views:210, comments:[] },
    { id:'p_m3', type:'market', category:'sport', title:'尤尼克斯羽毛球拍 NR900 送球包', content:'打了一年半，换新拍了所以出。手感偏进攻型，适合有一定基础的球友。附送原装球包+2筒羽毛球（全新）。', price:350, originalPrice:890, condition:'8成新', authorId:'2020030003', authorName:'陈梓涵', authorAvatar:'陈', authorAvatarBg:'#FBEAF0', authorAvatarColor:'#993556', campus:'黄家湖校区', college:'医学院', major:'临床医学', grade:'大四', time:ts(3,0), likes:18, likedBy:[], views:145, comments:[] },
    { id:'p_m4', type:'market', category:'life', title:'宿舍用小冰箱 35L 冷藏冷冻', content:'在宿舍用的迷你冰箱，35L容量，有冷藏和冷冻两层。静音效果不错，功率也不高。下学期搬出去住了用不上了，便宜出。青山校区自提。', price:150, originalPrice:320, condition:'7成新', authorId:'2021010001', authorName:'李思远', authorAvatar:'李', authorAvatarBg:'#E6F1FB', authorAvatarColor:'#185FA5', campus:'青山校区', college:'计算机科学与技术学院', major:'计算机科学与技术', grade:'大三', time:ts(2,30), likes:22, likedBy:[], views:178, comments:[] },
    { id:'p_m5', type:'market', category:'digital', title:'iPad Air 5 64G WiFi版 + Apple Pencil', content:'2023年暑期买的，平时就用来看网课和记笔记。屏幕完美，无划痕，电池健康98%。带Apple Pencil二代一起出，不单卖。配件全齐，送一个磁吸保护壳。', price:3200, originalPrice:5998, condition:'95新', authorId:'2023060006', authorName:'刘雨桐', authorAvatar:'刘', authorAvatarBg:'#FEF3C7', authorAvatarColor:'#92400E', campus:'青山校区', college:'机械工程学院', major:'机械设计制造及其自动化', grade:'大一', time:ts(5,0), likes:41, likedBy:[], views:267, comments:[] },
    { id:'p_m6', type:'market', category:'other', title:'考研全套书籍打包出（数一+英一+政治）', content:'2024考研上岸，全套复习资料打包出。包括：张宇1000题、李永乐线代辅导讲义、肖秀荣精讲精练+1000题+肖四肖八。部分有笔记但很整洁。青山校区自取，整套50元拿走。', price:50, originalPrice:200, condition:'有笔记', authorId:'2019040004', authorName:'赵明远', authorAvatar:'赵', authorAvatarBg:'#FAEEDA', authorAvatarColor:'#854F0B', campus:'青山校区', college:'经济学院', major:'金融学', grade:'研二', time:ts(12,0), likes:67, likedBy:[], views:390, comments:[] },
    { id:'p_m7', type:'market', category:'book', title:'C++ Primer Plus 第六版 中文版', content:'计算机入门必读的一本书，买来看了前几章就转Python了，所以基本全新。适合想学C++的大一大二同学。', price:45, originalPrice:99, condition:'9成新', authorId:'2021050005', authorName:'张浩然', authorAvatar:'张', authorAvatarBg:'#E0F2FE', authorAvatarColor:'#0369A1', campus:'黄家湖校区', college:'电子信息学院', major:'电子信息工程', grade:'大三', time:ts(24,0), likes:8, likedBy:[], views:67, comments:[] }
  );

  // ===== 社交动态（5条） =====
  samplePosts.push(
    { id:'p_s1', type:'social', category:'动态', title:'', content:'黄家湖的夕阳真的太美了，宿舍楼顶拍的，附上几张照片。这里虽然离市区远，但风景是真的好，每天傍晚都能看到不一样的晚霞 🌅', authorId:'2020030003', authorName:'陈梓涵', authorAvatar:'陈', authorAvatarBg:'#FBEAF0', authorAvatarColor:'#993556', campus:'黄家湖校区', college:'医学院', major:'临床医学', grade:'大四', time:ts(3,0), likes:68, likedBy:[], views:234, comments:[] },
    { id:'p_s2', type:'social', category:'动态', title:'', content:'青山校区今天新生报到！看到好多新面孔，想起了自己大一刚来的样子。欢迎学弟学妹们加入武科大大家庭！有什么不懂的可以留言问我 👋', authorId:'2021010001', authorName:'李思远', authorAvatar:'李', authorAvatarBg:'#E6F1FB', authorAvatarColor:'#185FA5', campus:'青山校区', college:'计算机科学与技术学院', major:'计算机科学与技术', grade:'大三', time:ts(5,0), likes:143, likedBy:[], views:580, comments:[{ id:'cs1', authorId:'2023060006', authorName:'刘雨桐', authorAvatar:'刘', authorAvatarBg:'#FEF3C7', authorAvatarColor:'#92400E', content:'谢谢学长！大一新生报道 🙋', time:ts(4,0), likes:23, likedBy:[] }] },
    { id:'p_s3', type:'social', category:'动态', title:'', content:'周末去汉口玩了一圈，江汉路、黎黄陂路、吉庆街。武汉果然是一座值得慢慢探索的城市。有没有同学推荐一下青山/黄家湖附近好吃好玩的地方？', authorId:'2023060006', authorName:'刘雨桐', authorAvatar:'刘', authorAvatarBg:'#FEF3C7', authorAvatarColor:'#92400E', campus:'青山校区', college:'机械工程学院', major:'机械设计制造及其自动化', grade:'大一', time:ts(6,0), likes:37, likedBy:[], views:156, comments:[{ id:'cs2', authorId:'2021010001', authorName:'李思远', authorAvatar:'李', authorAvatarBg:'#E6F1FB', authorAvatarColor:'#185FA5', content:'青山的话推荐恩施街，各种小吃超棒！', time:ts(5,0), likes:9, likedBy:[] }] },
    { id:'p_s4', type:'social', category:'动态', title:'', content:'今天实验室做了一天实验，终于出结果了！虽然过程很累，但看到数据的那一刻一切都值了。组会汇报加油💪', authorId:'2021050005', authorName:'张浩然', authorAvatar:'张', authorAvatarBg:'#E0F2FE', authorAvatarColor:'#0369A1', campus:'黄家湖校区', college:'电子信息学院', major:'电子信息工程', grade:'大三', time:ts(10,0), likes:52, likedBy:[], views:189, comments:[] },
    { id:'p_s5', type:'social', category:'动态', title:'', content:'强烈推荐学校图书馆四楼靠窗的位置！采光好、安静、还有电源插座。期末复习的最佳选择 📚 不过要早去占位，8点半以后基本没位置了。', authorId:'2022020002', authorName:'王晓琳', authorAvatar:'王', authorAvatarBg:'#EAF3DE', authorAvatarColor:'#3B6D11', campus:'青山校区', college:'材料科学与工程学院', major:'材料科学与工程', grade:'大二', time:ts(15,0), likes:89, likedBy:[], views:445, comments:[] }
  );

  // ===== 职业内推（5条） =====
  samplePosts.push(
    { id:'p_c1', type:'career', category:'内推', title:'字节跳动-产品经理实习生', content:'字节跳动抖音电商产品部门在招暑期实习，岗位HC较多，走内推通道速度会快很多。要求：本科及以上，逻辑思维强，有产品实习经历优先，26届毕业。Base北京/武汉可选。有意向的同学欢迎私我简历～', company:'字节跳动', position:'产品经理实习生', authorId:'2019040004', authorName:'赵明远', authorAvatar:'赵', authorAvatarBg:'#FAEEDA', authorAvatarColor:'#854F0B', campus:'青山校区', college:'经济学院', major:'金融学', grade:'研二', time:ts(2,0), likes:93, likedBy:[], views:512, comments:[{ id:'cc1', authorId:'2021010001', authorName:'李思远', authorAvatar:'李', authorAvatarBg:'#E6F1FB', authorAvatarColor:'#185FA5', content:'请问需要什么技能？有没有技术要求？', time:ts(1,0), likes:5, likedBy:[] }] },
    { id:'p_c2', type:'career', category:'内推', title:'武钢集团-材料工程师（校招）', content:'武钢集团2025届校园招聘正式启动！材料、冶金、机械类专业优先。岗位：材料工程师/工艺工程师，Base武汉青山。武科大有专门的宣讲会，请关注就业网通知。作为校友分享一波经验。', company:'武钢集团', position:'材料工程师', authorId:'2022020002', authorName:'王晓琳', authorAvatar:'王', authorAvatarBg:'#EAF3DE', authorAvatarColor:'#3B6D11', campus:'青山校区', college:'材料科学与工程学院', major:'材料科学与工程', grade:'大二', time:ts(1,0), likes:45, likedBy:[], views:280, comments:[] },
    { id:'p_c3', type:'career', category:'内推', title:'腾讯-后台开发暑期实习', content:'腾讯云部门招后台开发实习生，技术栈Go/C++，要求：熟悉Linux系统、计算机网络、操作系统。有ACM/项目经验加分。武科大同学可以走内推，简历直达leader。', company:'腾讯', position:'后台开发实习生', authorId:'2021050005', authorName:'张浩然', authorAvatar:'张', authorAvatarBg:'#E0F2FE', authorAvatarColor:'#0369A1', campus:'黄家湖校区', college:'电子信息学院', major:'电子信息工程', grade:'大三', time:ts(4,0), likes:120, likedBy:[], views:630, comments:[] },
    { id:'p_c4', type:'career', category:'内推', title:'华为-硬件测试工程师内推', content:'华为武汉研究所招硬件测试工程师（应届+实习）。通信、电子、自动化相关专业，了解基本电路原理即可。福利很好，有班车有食堂。有意向的同学先发简历给我看看。', company:'华为', position:'硬件测试工程师', authorId:'2019040004', authorName:'赵明远', authorAvatar:'赵', authorAvatarBg:'#FAEEDA', authorAvatarColor:'#854F0B', campus:'青山校区', college:'经济学院', major:'金融学', grade:'研二', time:ts(8,0), likes:76, likedBy:[], views:420, comments:[] },
    { id:'p_c5', type:'career', category:'内推', title:'滴滴-数据分析实习内推', content:'滴滴出行数据平台部门招数据分析实习生，处理千万级出行数据。技能：SQL必备，Python/R熟悉一项即可，了解基本统计学。弹性工作时间，不加班。适合想从事数据方向的同学。', company:'滴滴出行', position:'数据分析实习生', authorId:'2020030003', authorName:'陈梓涵', authorAvatar:'陈', authorAvatarBg:'#FBEAF0', authorAvatarColor:'#993556', campus:'黄家湖校区', college:'医学院', major:'临床医学', grade:'大四', time:ts(18,0), likes:55, likedBy:[], views:310, comments:[] }
  );

  // ===== 活动约伴（5条） =====
  samplePosts.push(
    { id:'p_v1', type:'activity', category:'活动', activitySubtype:'sport', title:'周六下午青山校区约打篮球5v5！', content:'周六下午14:00在青山校区篮球场，5v5全场比赛。已有7人，还缺3人，不限水平，重在参与。打完球一起去恩施街吃烧烤。有意向的留个言我拉群！', location:'青山校区篮球场', activityTime:'周六 14:00', maxPeople:10, currentPeople:7, authorId:'2021010001', authorName:'李思远', authorAvatar:'李', authorAvatarBg:'#E6F1FB', authorAvatarColor:'#185FA5', campus:'青山校区', college:'计算机科学与技术学院', major:'计算机科学与技术', grade:'大三', time:ts(0,30), likes:47, likedBy:[], views:320, comments:[] },
    { id:'p_v2', type:'activity', category:'活动', activitySubtype:'photo', title:'黄家湖周末约拍一组人像', content:'这周末天气不错，在黄家湖校区约个拍摄小组。主题：毕业季/夏日校园风。我带了富士XT5+56mm人像镜头，欢迎喜欢拍照的同学一起。也欢迎想被拍的同学，免费出片～', location:'黄家湖校区', activityTime:'周日 15:00', maxPeople:8, currentPeople:3, authorId:'2020030003', authorName:'陈梓涵', authorAvatar:'陈', authorAvatarBg:'#FBEAF0', authorAvatarColor:'#993556', campus:'黄家湖校区', college:'医学院', major:'临床医学', grade:'大四', time:ts(1,0), likes:56, likedBy:[], views:298, comments:[] },
    { id:'p_v3', type:'activity', category:'活动', activitySubtype:'game', title:'周末剧本杀求组队《死者在幻夜中醒来》', content:'想玩《死者在幻夜中醒来》，7人本，目前在组5人了，缺2人。在青山校区外面那家剧本杀店，人均大概80左右。新手友好，大家基本都是第一次玩这个本。', location:'青山校区校外', activityTime:'周六 13:30', maxPeople:7, currentPeople:5, authorId:'2023060006', authorName:'刘雨桐', authorAvatar:'刘', authorAvatarBg:'#FEF3C7', authorAvatarColor:'#92400E', campus:'青山校区', college:'机械工程学院', major:'机械设计制造及其自动化', grade:'大一', time:ts(2,0), likes:34, likedBy:[], views:156, comments:[] },
    { id:'p_v4', type:'activity', category:'活动', activitySubtype:'study', title:'期末冲刺自习小组（青山图书馆）', content:'期末考试临近，组织一个自习冲刺小组。每天晚上18:00-22:00在青山校区图书馆四楼。互相监督、互相答疑。有计算机、数学、英语各科的高手在群内。进群第一天先立下flag！', location:'青山校区图书馆四楼', activityTime:'每天 18:00-22:00', maxPeople:15, currentPeople:12, authorId:'2021010001', authorName:'李思远', authorAvatar:'李', authorAvatarBg:'#E6F1FB', authorAvatarColor:'#185FA5', campus:'青山校区', college:'计算机科学与技术学院', major:'计算机科学与技术', grade:'大三', time:ts(5,0), likes:88, likedBy:[], views:450, comments:[] },
    { id:'p_v5', type:'activity', category:'活动', activitySubtype:'travel', title:'端午小长假神农架徒步组团', content:'端午三天假想去神农架徒步，有没有一起的？路线：木鱼镇→神农顶→大九湖。计划包车+向导，预算人均500左右（不含吃住）。需要有基本的体力和户外经验。目前我和另一个同学想去，再组2-3人就好～', location:'神农架', activityTime:'端午节（6.8-6.10）', maxPeople:6, currentPeople:2, authorId:'2021050005', authorName:'张浩然', authorAvatar:'张', authorAvatarBg:'#E0F2FE', authorAvatarColor:'#0369A1', campus:'黄家湖校区', college:'电子信息学院', major:'电子信息工程', grade:'大三', time:ts(24,0), likes:35, likedBy:[], views:178, comments:[] }
  );

  // ===== 校园帮帮（9条） =====
  samplePosts.push(
    { id:'svc1', type:'service', category:'errand', title:'黄家湖校区代取快递，菜鸟驿站', content:'明天下午去菜鸟驿站取快递，可以顺便帮同学们带。小件3元，大件5元。黄家湖校区内送到宿舍楼下，需要代取的发取件码给我即可。', price:'小件3元/大件5元', authorId:'2020030003', authorName:'陈梓涵', authorAvatar:'陈', authorAvatarBg:'#FBEAF0', authorAvatarColor:'#993556', campus:'黄家湖校区', college:'医学院', major:'临床医学', grade:'大四', time:ts(0,10), likes:15, likedBy:[], views:89, comments:[] },
    { id:'svc2', type:'service', category:'study', title:'代周三上午第一节高数课，青山校区', content:'周三上午一二节高数课有事去不了，求同学帮忙代签到。不需要记笔记，坐在后排就行。有偿30元，青山校区教三楼。女生优先，因为我们是女生班。', price:'¥30', authorId:'2022020002', authorName:'王晓琳', authorAvatar:'王', authorAvatarBg:'#EAF3DE', authorAvatarColor:'#3B6D11', campus:'青山校区', college:'材料科学与工程学院', major:'材料科学与工程', grade:'大二', time:ts(0,30), likes:8, likedBy:[], views:56, comments:[] },
    { id:'svc3', type:'service', category:'group', title:'今晚海底捞外卖拼单！差2人', content:'今晚想吃海底捞，外卖满200减40，现在有两个人了还差两个。点了虾滑、毛肚、肥牛、炸豆皮...人均大概50左右。青山校区北门集合自取。快滴滴我！', price:'人均约¥50', authorId:'2021010001', authorName:'李思远', authorAvatar:'李', authorAvatarBg:'#E6F1FB', authorAvatarColor:'#185FA5', campus:'青山校区', college:'计算机科学与技术学院', major:'计算机科学与技术', grade:'大三', time:ts(0,45), likes:22, likedBy:[], views:134, comments:[] },
    { id:'svc4', type:'service', category:'lost', title:'青山校区图书馆遗失AirPods Pro 2', content:'昨天下午4点左右在青山校区图书馆三楼自习室遗失了AirPods Pro 2，白色充电盒上面贴了一个小熊猫贴纸。里面有重要备份，如有捡到请联系我，当面酬谢200元！', price:'酬谢¥200', authorId:'2019040004', authorName:'赵明远', authorAvatar:'赵', authorAvatarBg:'#FAEEDA', authorAvatarColor:'#854F0B', campus:'青山校区', college:'经济学院', major:'金融学', grade:'研二', time:ts(2,0), likes:45, likedBy:[], views:280, comments:[] },
    { id:'svc5', type:'service', category:'job', title:'校内招助教，计算机基础课', content:'计算机学院招助教1名，负责大一的计算机基础实验课辅导。每周2次课（周三和周五下午），每次2小时，月薪1200。要求计算机相关专业大二以上，GPA 3.0以上。', price:'月薪¥1200', authorId:'2021010001', authorName:'李思远', authorAvatar:'李', authorAvatarBg:'#E6F1FB', authorAvatarColor:'#185FA5', campus:'青山校区', college:'计算机科学与技术学院', major:'计算机科学与技术', grade:'大三', time:ts(5,0), likes:67, likedBy:[], views:410, comments:[] },
    { id:'svc6', type:'service', category:'rent', title:'黄家湖校区旁转租次卧一间', content:'黄家湖校区步行5分钟，三室一厅次卧转租。月租800含水电网，7月起租，租期到年底。室友都是医学院在读研究生，安静整洁。限女生。', price:'月租¥800', authorId:'2020030003', authorName:'陈梓涵', authorAvatar:'陈', authorAvatarBg:'#FBEAF0', authorAvatarColor:'#993556', campus:'黄家湖校区', college:'医学院', major:'临床医学', grade:'大四', time:ts(8,0), likes:31, likedBy:[], views:196, comments:[] },
    { id:'svc7', type:'service', category:'giveaway', title:'免费送考研复习资料全套', content:'2025考研数一+英语+政治全套复习资料免费送！包括张宇1000题、李永乐线代辅导讲义、肖秀荣精讲精练+1000题+肖四肖八。大部分有笔记但很整洁，不影响使用。青山校区自取，先到先得。', authorId:'2019040004', authorName:'赵明远', authorAvatar:'赵', authorAvatarBg:'#FAEEDA', authorAvatarColor:'#854F0B', campus:'青山校区', college:'经济学院', major:'金融学', grade:'研二', time:ts(12,0), likes:89, likedBy:[], views:520, comments:[] },
    { id:'svc8', type:'service', category:'confess', title:'投稿：致图书馆经常坐我对面的你', content:'我不知道你的名字，但你每个周二和周四下午都会来图书馆四楼靠窗的位置，我总是在你对面。你有一件灰色的卫衣很好看。如果你看到了，给我个信号吧。', authorId:'2021010001', authorName:'匿名', authorAvatar:'匿', authorAvatarBg:'#FDF2F8', authorAvatarColor:'#EC4899', campus:'青山校区', college:'', major:'', grade:'', time:ts(24,0), likes:156, likedBy:[], views:890, comments:[], isAnonymous:true },
    { id:'svc9', type:'service', category:'secret', title:'感觉大学好孤独，有人一样吗', content:'来武汉读大学两年了，但总觉得自己融不进去。室友们都有自己固定的朋友圈了，我每天就是上课、食堂、宿舍三点一线。有时候在食堂看到别人有说有笑，真的会羡慕…有时候想约人出去，翻开通讯录又不知道找谁。', authorId:'2022020002', authorName:'匿名', authorAvatar:'匿', authorAvatarBg:'#F5F3FF', authorAvatarColor:'#7C3AED', campus:'青山校区', college:'', major:'', grade:'', time:ts(36,0), likes:234, likedBy:[], views:1200, comments:[{ id:'scc1', authorId:'2021010001', authorName:'暖心学长', authorAvatar:'心', authorAvatarBg:'#E6F1FB', authorAvatarColor:'#185FA5', content:'兄弟别难过，大学就是这样的。我刚来的时候也是一个人，后来慢慢参加社团活动认识了很多朋友。要不要周末一起去打篮球？', time:ts(30,0), likes:89, likedBy:[] },{ id:'scc2', authorId:'2020030003', authorName:'热心学姐', authorAvatar:'热', authorAvatarBg:'#FBEAF0', authorAvatarColor:'#993556', content:'抱抱你！你一点都不孤单，这个社区里有很多关心你的人。欢迎来黄家湖找我玩～', time:ts(20,0), likes:67, likedBy:[] }], isAnonymous:true }
  );

  // 保存
  var existingUsers = DB.getUsers();
  Object.assign(existingUsers, sampleUsers);
  DB.set('users', existingUsers);

  DB.set('posts', samplePosts);  // 直接用样本数据覆盖，保证干净

  localStorage.setItem('wkust_sample_inited', '1');
  console.log('%c样本数据已加载：', 'color:#059669;font-weight:bold', samplePosts.length, '条帖子，', Object.keys(sampleUsers).length, '位用户');
}

// ---- 帖子详情模态框 ----
function openPostDetail(postId) {
  const post = getPostById(postId);
  if (!post) return;
  const user = DB.getCurrentUser();
  const isLiked = user && (post.likedBy || []).includes(user.stuId);
  const isOwner = user && post.authorId === user.stuId;
  const isSold = post.status === 'sold';
  const isDelisted = post.status === 'delisted';
  const isInactive = isSold || isDelisted;

  const commentsHtml = (post.comments || []).map(c => `
    <div class="comment-item">
      <div class="comment-avatar" style="background:${c.authorAvatarBg};color:${c.authorAvatarColor}">${c.authorAvatar}</div>
      <div class="comment-body">
        <div class="comment-header">
          <span class="comment-author">${c.authorName}</span>
          <span class="comment-time">${timeAgo(c.time)}</span>
          ${user && c.authorId !== user.stuId ? `<button class="btn-dm-tiny" onclick="event.stopPropagation();openChatWith('${c.authorId}')" title="私聊"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> 私聊</button>` : ''}
        </div>
        <p class="comment-text">${escHtml(c.content)}</p>
      </div>
    </div>
  `).join('');

  // 状态横幅（仅市场类型）
  const statusBannerHtml = (post.type === 'market' && isInactive) ? `
    <div class="status-banner ${isSold ? 'sold' : 'delisted'}">
      <span class="status-banner-icon">${isSold ? '🔴' : '⏸️'}</span>
      <span>${isSold ? '该商品已售出' : '该商品已下架'}${isSold && post.soldAt ? ' · ' + new Date(post.soldAt).toLocaleDateString('zh-CN') : ''}${isDelisted && post.delistedAt ? ' · ' + new Date(post.delistedAt).toLocaleDateString('zh-CN') : ''}</span>
      ${isOwner ? `<div class="status-banner-actions">
        ${isSold ? `<button class="btn-status-action btn-status-relist" onclick="event.stopPropagation();handleRelist('${post.id}')">🔄 重新上架</button>` : ''}
        ${isDelisted ? `<button class="btn-status-action btn-status-relist" onclick="event.stopPropagation();handleRelist('${post.id}')">🔄 重新上架</button>` : ''}
        ${isSold ? `<button class="btn-status-action btn-status-delist" onclick="event.stopPropagation();handleDelistDetail('${post.id}')">🔽 转为下架</button>` : ''}
      </div>` : ''}
    </div>` : '';

  const html = `
    <div class="post-detail">
      ${statusBannerHtml}
      <div class="modal-header">
        <div class="post-avatar" style="background:${post.authorAvatarBg};color:${post.authorAvatarColor}">${post.authorAvatar}</div>
        <div class="post-meta-detail">
          <span class="post-author">${post.authorName}</span>
          <span class="post-badge ${post.type}">${post.category}</span>
          <span class="post-sub">${post.college || ''} · ${post.grade || ''} · ${post.campus}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-left:auto">
          ${user && user.stuId !== post.authorId ? `<button class="btn-dm-small" onclick="event.stopPropagation();openChatWith('${post.authorId}')" title="私聊">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> 私聊
          </button>` : ''}
          <span class="modal-time">${timeAgo(post.time)}</span>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
      </div>
      ${post.title ? `<h3 class="detail-title">${escHtml(post.title)}</h3>` : ''}
      ${(post.images && post.images.length > 0) ? `
        <div class="detail-images">
          ${post.images.map((img, i) => `<div class="detail-image${i === 0 ? ' main' : ''}" onclick="openImageViewer('${post.id}',${i})"><img src="${img}" alt="商品图片" loading="lazy"></div>`).join('')}
        </div>` : ''}
      <p class="detail-content">${escHtml(post.content)}</p>
      ${post.type === 'market' ? `
        <div class="detail-product">
          <span class="detail-price">¥${post.price}</span>
          <span class="detail-original">¥${post.originalPrice || ''}</span>
          <span class="detail-condition">${post.condition || ''}</span>
        </div>
        ${isOwner && !isInactive ? `
        <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap;align-items:center">
          <button class="btn-status-action btn-status-sold" onclick="event.stopPropagation();handleMarkSold('${post.id}')">✅ 标记已售出</button>
          <button class="btn-status-action btn-status-delist" onclick="event.stopPropagation();handleDelistDetail('${post.id}')">🔽 下架商品</button>
          ${getAcceptedBuyerForPost(post.id).length > 0 ? '<span class="purchase-approved-hint">' + getAcceptedBuyerForPost(post.id).length + '人已同意购买</span>' : ''}
        </div>` : ''}
        ${isOwner && isSold ? `
        <div style="display:flex;gap:8px;margin-bottom:16px">
          <button class="btn-status-action btn-status-relist" onclick="event.stopPropagation();handleRelist('${post.id}')">🔄 重新上架</button>
        </div>` : ''}
        ${isOwner && isDelisted ? `
        <div style="display:flex;gap:8px;margin-bottom:16px">
          <button class="btn-status-action btn-status-relist" onclick="event.stopPropagation();handleRelist('${post.id}')">🔄 重新上架</button>
          <button class="btn-status-action btn-status-sold" onclick="event.stopPropagation();handleMarkSold('${post.id}')">✅ 标记已售出</button>
        </div>` : ''}
        ${!isOwner && !isInactive ? `
        <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
          <button class="btn-purchase-request" onclick="event.stopPropagation();openPurchaseRequestModal('${post.id}')">💰 我要购买</button>
          <button class="btn-bargain-small" onclick="event.stopPropagation();openBargainModal('${post.id}')">🤝 砍价</button>
        </div>` : ''}` : ''}
      ${post.type === 'market' ? renderPurchaseRequestSection(post, user) : ''}
      ${post.type === 'market' ? renderBargainSection(post, user) : ''}
      ${post.type === 'activity' ? `
        <div class="detail-activity-info">
          <span>📍 ${post.location || ''}</span>
          <span>🕐 ${post.activityTime || ''}</span>
          <span>👥 ${post.currentPeople || 0}/${post.maxPeople || 0}人</span>
        </div>` : ''}
      <div class="detail-actions">
        <button class="action-btn ${isLiked ? 'liked' : ''}" id="detailLikeBtn" onclick="handleDetailLike('${post.id}')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
          <span id="detailLikeCount">${post.likes}</span>
        </button>
        <span class="detail-views">👁 ${post.views} 浏览</span>
      </div>
      <div class="comments-section">
        <h4 class="comments-title">评论 <span id="commentCount">${(post.comments || []).length}</span></h4>
        <div class="comments-list" id="commentsList">${commentsHtml || '<p class="no-comment">暂无评论，快来抢沙发！</p>'}</div>
        <div class="comment-input-wrap">
          <div class="comment-avatar-mini" style="background:${user ? user.avatarBg : '#eee'};color:${user ? user.avatarColor : '#888'}">${user ? user.avatarText : '？'}</div>
          <div class="comment-input-box">
            <textarea id="commentInput" placeholder="${user ? '写下你的评论...' : '登录后才能评论'}" ${user ? '' : 'disabled'} rows="2"></textarea>
            <div class="comment-submit-row">
              <span class="char-count" id="charCount">0/200</span>
              <button class="btn-comment-submit" onclick="submitComment('${post.id}')">发送</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  openModal(html);

  const textarea = document.getElementById('commentInput');
  textarea?.addEventListener('input', function() {
    document.getElementById('charCount').textContent = this.value.length + '/200';
    if (this.value.length > 200) this.value = this.value.slice(0, 200);
  });
}

function handleDetailLike(postId) {
  const result = togglePostLike(postId);
  if (!result) return;
  const btn = document.getElementById('detailLikeBtn');
  const countEl = document.getElementById('detailLikeCount');
  if (btn) { btn.classList.toggle('liked', result.liked); btn.querySelector('path').setAttribute('fill', result.liked ? 'currentColor' : 'none'); }
  if (countEl) countEl.textContent = result.count;
  showToast(result.liked ? '已点赞' : '取消点赞', 'success');
}

function submitComment(postId) {
  const input = document.getElementById('commentInput');
  if (!input || !input.value.trim()) { showToast('请输入评论内容', 'warn'); return; }
  const comment = addComment(postId, input.value);
  if (!comment) return;
  input.value = '';
  document.getElementById('charCount').textContent = '0/200';

  const listEl = document.getElementById('commentsList');
  const noComment = listEl.querySelector('.no-comment');
  if (noComment) noComment.remove();

  const div = document.createElement('div');
  div.className = 'comment-item new-comment';
  div.innerHTML = `
    <div class="comment-avatar" style="background:${comment.authorAvatarBg};color:${comment.authorAvatarColor}">${comment.authorAvatar}</div>
    <div class="comment-body">
      <div class="comment-header">
        <span class="comment-author">${comment.authorName}</span>
        <span class="comment-time">刚刚</span>
      </div>
      <p class="comment-text">${escHtml(comment.content)}</p>
    </div>`;
  listEl.appendChild(div);
  listEl.scrollTop = listEl.scrollHeight;
  const countEl = document.getElementById('commentCount');
  if (countEl) countEl.textContent = parseInt(countEl.textContent || 0) + 1;
  showToast('评论成功！', 'success');
}

// HTML转义
function escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/\n/g,'<br>');
}

// ---- 图片查看器 ----
function openImageViewer(postId, idx) {
  const post = getPostById(postId);
  if (!post || !post.images) return;
  const images = post.images;
  let curIdx = idx;
  function render() {
    const html = `
      <div class="img-viewer">
        <button class="img-viewer-close" onclick="closeModal()">✕</button>
        ${images.length > 1 ? `<button class="img-viewer-nav prev" id="imgPrev" ${curIdx === 0 ? 'disabled' : ''}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>` : ''}
        <img src="${images[curIdx]}" alt="商品图片 ${curIdx + 1}/${images.length}" class="img-viewer-main">
        ${images.length > 1 ? `<button class="img-viewer-nav next" id="imgNext" ${curIdx >= images.length - 1 ? 'disabled' : ''}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></button>` : ''}
        <div class="img-viewer-counter">${curIdx + 1} / ${images.length}</div>
        ${images.length > 1 ? `<div class="img-viewer-dots">${images.map((_, i) => `<span class="img-dot${i === curIdx ? ' active' : ''}"></span>`).join('')}</div>` : ''}
      </div>`;
    const modalBox = document.getElementById('globalModal').querySelector('.modal-box');
    if (modalBox) modalBox.innerHTML = html;
    document.getElementById('imgPrev')?.addEventListener('click', () => { if (curIdx > 0) { curIdx--; render(); } });
    document.getElementById('imgNext')?.addEventListener('click', () => { if (curIdx < images.length - 1) { curIdx++; render(); } });
    document.addEventListener('keydown', function imgKey(e) {
      if (e.key === 'ArrowLeft' && curIdx > 0) { curIdx--; render(); }
      if (e.key === 'ArrowRight' && curIdx < images.length - 1) { curIdx++; render(); }
    });
  }
  // 先渲染初始图片HTML再打开模态框
  const initHtml = `
    <div class="img-viewer">
      <button class="img-viewer-close" onclick="closeModal()">✕</button>
      ${images.length > 1 ? `<button class="img-viewer-nav prev" id="imgPrev" ${curIdx === 0 ? 'disabled' : ''}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg></button>` : ''}
      <img src="${images[curIdx]}" alt="商品图片 ${curIdx + 1}/${images.length}" class="img-viewer-main">
      ${images.length > 1 ? `<button class="img-viewer-nav next" id="imgNext" ${curIdx >= images.length - 1 ? 'disabled' : ''}><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg></button>` : ''}
      <div class="img-viewer-counter">${curIdx + 1} / ${images.length}</div>
      ${images.length > 1 ? `<div class="img-viewer-dots">${images.map((_, i) => `<span class="img-dot${i === curIdx ? ' active' : ''}"></span>`).join('')}</div>` : ''}
    </div>`;
  openModal(initHtml);
  // 绑定事件
  document.getElementById('imgPrev')?.addEventListener('click', () => { if (curIdx > 0) { curIdx--; render(); } });
  document.getElementById('imgNext')?.addEventListener('click', () => { if (curIdx < images.length - 1) { curIdx++; render(); } });
  document.addEventListener('keydown', function imgKey(e) {
    if (e.key === 'ArrowLeft' && curIdx > 0) { curIdx--; render(); }
    if (e.key === 'ArrowRight' && curIdx < images.length - 1) { curIdx++; render(); }
  });
}

// ---- 商品状态处理函数（全局作用域，供模态框调用） ----
function handleMarkSold(postId) {
  const post = getPostById(postId);
  if (!post || post.status === 'sold') {
    if (post && post.status === 'sold') showToast('该商品已经是已售出状态', 'warn');
    return;
  }
  const user = DB.getCurrentUser();
  const isOwner = user && post.authorId === user.stuId;
  if (!isOwner) {
    showToast('只有卖家可以标记商品为已售出', 'warn');
    return;
  }
  // 查看已接受的购买请求
  const accepted = getAcceptedBuyerForPost(postId);
  let buyerInfo = '';
  if (accepted.length > 0) {
    buyerInfo = '<div style="margin-top:10px;padding:10px;background:#F0FDF4;border-radius:8px;font-size:13px;color:#065F46">' +
      accepted.map(r => '👤 ' + r.buyerName + ' (已同意购买)').join('<br>') +
      '</div>';
  }
  showConfirmDialog(
    '确认已售出',
    '确定将该商品标记为"已售出"吗？标记后商品将不再展示给其他用户。' + buyerInfo,
    '确认售出',
    '取消',
    function() {
      markItemSold(postId);
      showToast('已标记为"已售出"', 'success');
      closeModal();
      setTimeout(() => openPostDetail(postId), 350);
    }
  );
}

function handleDelistDetail(postId) {
  const post = getPostById(postId);
  if (!post) return;
  const user = DB.getCurrentUser();
  if (!user || post.authorId !== user.stuId) {
    showToast('只有卖家可以下架商品', 'warn'); return;
  }
  const isDelisted = post.status === 'delisted';
  showConfirmDialog(
    isDelisted ? '重新上架' : '下架商品',
    isDelisted ? '确定重新上架该商品吗？' : '确定下架该商品吗？下架后其他用户将看不到。',
    isDelisted ? '重新上架' : '确认下架',
    '取消',
    function() {
      toggleDelist(postId);
      showToast(isDelisted ? '已重新上架' : '已下架', 'success');
      closeModal();
      setTimeout(() => openPostDetail(postId), 350);
    }
  );
}

function handleRelist(postId) {
  const post = getPostById(postId);
  if (!post) return;
  const user = DB.getCurrentUser();
  if (!user || post.authorId !== user.stuId) {
    showToast('只有卖家可以操作', 'warn'); return;
  }
  showConfirmDialog(
    '重新上架',
    '确定重新上架该商品吗？',
    '确认上架',
    '取消',
    function() {
      const wasSold = post.status === 'sold';
      const posts = DB.getPosts();
      const idx = posts.findIndex(p => p.id === postId);
      if (idx !== -1) {
        posts[idx].status = null;
        delete posts[idx].soldAt;
        delete posts[idx].delistedAt;
        DB.set('posts', posts);
      }
      showToast('商品已重新上架', 'success');
      closeModal();
      setTimeout(() => openPostDetail(postId), 350);
    }
  );
}

// 初始化
try { initSampleData(); } catch(e) { console.warn('样本数据初始化失败（可能 localStorage 已满）:', e); }

// ---- 购买请求系统 ----
function submitPurchaseRequest(postId, message) {
  var user = DB.getCurrentUser();
  if (!user) { showToast('请先登录', 'error'); return null; }
  var post = getPostById(postId);
  if (!post) { showToast('商品不存在', 'error'); return null; }
  if (post.authorId === user.stuId) { showToast('不能购买自己的商品', 'warn'); return null; }
  if (post.status === 'sold') { showToast('该商品已售出', 'warn'); return null; }
  if (post.status === 'delisted') { showToast('该商品已下架', 'warn'); return null; }

  var requests = DB.get('purchaseRequests') || [];
  // 检查是否已有进行中的购买请求
  var existing = requests.find(function(r) {
    return r.postId === postId && r.buyerId === user.stuId && r.status === 'pending';
  });
  if (existing) { showToast('您已提交过购买请求，请等待卖家回复', 'warn'); return null; }

  var request = {
    id: 'pr_' + Date.now() + '_' + Math.random().toString(36).slice(2),
    postId: postId,
    postTitle: post.title || post.content.slice(0, 30),
    postPrice: post.price,
    postImage: (post.images && post.images.length > 0) ? post.images[0] : null,
    sellerId: post.authorId,
    sellerName: post.authorName,
    buyerId: user.stuId,
    buyerName: user.name,
    buyerAvatar: user.avatarText,
    buyerAvatarBg: user.avatarBg,
    buyerAvatarColor: user.avatarColor,
    message: (message || '').trim(),
    status: 'pending',
    time: new Date().toISOString()
  };
  requests.unshift(request);
  DB.set('purchaseRequests', requests);
  return request;
}

function acceptPurchaseRequest(requestId) {
  var requests = DB.get('purchaseRequests') || [];
  var idx = requests.findIndex(function(r) { return r.id === requestId; });
  if (idx === -1) return null;
  var user = DB.getCurrentUser();
  var r = requests[idx];
  if (!user || r.sellerId !== user.stuId) { showToast('只有卖家可以审批购买请求', 'warn'); return null; }
  if (r.status !== 'pending') { showToast('该请求已处理', 'warn'); return null; }

  // 检查商品是否已售出
  var post = getPostById(r.postId);
  if (post && post.status === 'sold') { showToast('该商品已售出，无法再接受购买请求', 'warn'); return null; }

  r.status = 'accepted';
  r.respondedAt = new Date().toISOString();
  r.respondedBy = user.stuId;
  DB.set('purchaseRequests', requests);
  return r;
}

function rejectPurchaseRequest(requestId, reason) {
  var requests = DB.get('purchaseRequests') || [];
  var idx = requests.findIndex(function(r) { return r.id === requestId; });
  if (idx === -1) return null;
  var user = DB.getCurrentUser();
  var r = requests[idx];
  if (!user || r.sellerId !== user.stuId) { showToast('只有卖家可以拒绝购买请求', 'warn'); return null; }
  if (r.status !== 'pending') { showToast('该请求已处理', 'warn'); return null; }

  r.status = 'rejected';
  r.rejectReason = reason || '';
  r.respondedAt = new Date().toISOString();
  r.respondedBy = user.stuId;
  DB.set('purchaseRequests', requests);
  return r;
}

function cancelPurchaseRequest(requestId) {
  var requests = DB.get('purchaseRequests') || [];
  var idx = requests.findIndex(function(r) { return r.id === requestId; });
  if (idx === -1) return null;
  var user = DB.getCurrentUser();
  var r = requests[idx];
  if (!user || r.buyerId !== user.stuId) { showToast('只能取消自己的购买请求', 'warn'); return null; }
  if (r.status !== 'pending') { showToast('该请求已处理，无法取消', 'warn'); return null; }

  r.status = 'cancelled';
  r.cancelledAt = new Date().toISOString();
  DB.set('purchaseRequests', requests);
  return r;
}

function getPurchaseRequestsForPost(postId) {
  var requests = DB.get('purchaseRequests') || [];
  return requests.filter(function(r) { return r.postId === postId; });
}

function getPurchaseRequestsForSeller(userId) {
  var requests = DB.get('purchaseRequests') || [];
  return requests.filter(function(r) { return r.sellerId === userId; });
}

function getPurchaseRequestsForBuyer(userId) {
  var requests = DB.get('purchaseRequests') || [];
  return requests.filter(function(r) { return r.buyerId === userId; });
}

function getPendingPurchaseCountForSeller(userId) {
  return getPurchaseRequestsForSeller(userId).filter(function(r) { return r.status === 'pending'; }).length;
}

function getAcceptedBuyerForPost(postId) {
  var requests = DB.get('purchaseRequests') || [];
  return requests.filter(function(r) { return r.postId === postId && r.status === 'accepted'; });
}

// ---- 砍价系统 ----
function submitBargain(postId, offerPrice, message) {
  var user = DB.getCurrentUser();
  if (!user) { showToast('请先登录', 'error'); return null; }
  var post = getPostById(postId);
  if (!post) { showToast('商品不存在', 'error'); return null; }
  if (post.authorId === user.stuId) { showToast('不能对自己的商品砍价', 'warn'); return null; }
  var offer = parseFloat(offerPrice);
  if (isNaN(offer) || offer <= 0) { showToast('请输入有效的砍价金额', 'warn'); return null; }
  var originalPrice = parseFloat(post.price);
  if (!isNaN(originalPrice) && offer >= originalPrice) { showToast('砍价应低于原价 ¥' + post.price, 'warn'); return null; }
  if (!message || !message.trim()) { showToast('请说几句砍价理由吧', 'warn'); return null; }

  var bargains = DB.get('bargains') || [];
  // 检查是否已有进行中的砍价
  var existing = bargains.find(function(b) { return b.postId === postId && b.fromUserId === user.stuId && (b.status === 'pending' || b.status === 'countered'); });
  if (existing) { showToast('您已有一条进行中的砍价，请等待卖家回复', 'warn'); return null; }

  var bargain = {
    id: 'bg_' + Date.now() + '_' + Math.random().toString(36).slice(2),
    postId: postId,
    postTitle: post.title || post.content.slice(0, 30),
    postPrice: post.price,
    postImage: (post.images && post.images.length > 0) ? post.images[0] : null,
    fromUserId: user.stuId,
    fromUserName: user.name,
    fromUserAvatar: user.avatarText,
    fromUserAvatarBg: user.avatarBg,
    fromUserAvatarColor: user.avatarColor,
    offerPrice: offer,
    message: message.trim(),
    status: 'pending',
    time: new Date().toISOString(),
    history: [{ action: 'offer', price: offer, message: message.trim(), time: new Date().toISOString(), by: user.stuId }]
  };
  bargains.unshift(bargain);
  DB.set('bargains', bargains);
  return bargain;
}

function acceptBargain(bargainId) {
  var bargains = DB.get('bargains') || [];
  var idx = bargains.findIndex(function(b) { return b.id === bargainId; });
  if (idx === -1) return null;
  var user = DB.getCurrentUser();
  var b = bargains[idx];
  if (!user || b.fromUserId === user.stuId) { showToast('只有卖家可以接受砍价', 'warn'); return null; }
  b.status = 'accepted';
  b.acceptedAt = new Date().toISOString();
  b.history.push({ action: 'accept', price: b.offerPrice, message: '卖家接受了您的砍价', time: new Date().toISOString(), by: user.stuId });
  // 不再自动标记为已售出，由卖家手动确认
  DB.set('bargains', bargains);
  return b;
}

function rejectBargain(bargainId, reason) {
  var bargains = DB.get('bargains') || [];
  var idx = bargains.findIndex(function(b) { return b.id === bargainId; });
  if (idx === -1) return null;
  var user = DB.getCurrentUser();
  var b = bargains[idx];
  if (!user || b.fromUserId === user.stuId) { showToast('只有卖家可以拒绝砍价', 'warn'); return null; }
  b.status = 'rejected';
  b.rejectedAt = new Date().toISOString();
  b.history.push({ action: 'reject', message: reason || '卖家拒绝了砍价', time: new Date().toISOString(), by: user.stuId });
  DB.set('bargains', bargains);
  return b;
}

function counterBargain(bargainId, counterPrice, counterMessage) {
  var bargains = DB.get('bargains') || [];
  var idx = bargains.findIndex(function(b) { return b.id === bargainId; });
  if (idx === -1) return null;
  var user = DB.getCurrentUser();
  var b = bargains[idx];
  if (!user || b.fromUserId === user.stuId) { showToast('只有卖家可以还价', 'warn'); return null; }
  var counter = parseFloat(counterPrice);
  if (isNaN(counter) || counter <= 0) { showToast('请输入有效的还价金额', 'warn'); return null; }
  var postPrice = parseFloat(b.postPrice);
  if (!isNaN(postPrice) && counter > postPrice) { showToast('还价不能高于原价', 'warn'); return null; }
  if (counter <= b.offerPrice) { showToast('还价应高于买家出价', 'warn'); return null; }

  b.status = 'countered';
  b.counterPrice = counter;
  b.counterMessage = counterMessage || '';
  b.counterTime = new Date().toISOString();
  b.history.push({ action: 'counter', price: counter, message: counterMessage || '卖家还价了', time: new Date().toISOString(), by: user.stuId });
  DB.set('bargains', bargains);
  return b;
}

function acceptCounter(bargainId) {
  var bargains = DB.get('bargains') || [];
  var idx = bargains.findIndex(function(b) { return b.id === bargainId; });
  if (idx === -1) return null;
  var user = DB.getCurrentUser();
  var b = bargains[idx];
  if (!user || b.fromUserId !== user.stuId) { showToast('只有买家可以接受还价', 'warn'); return null; }
  b.status = 'accepted';
  b.acceptedAt = new Date().toISOString();
  b.finalPrice = b.counterPrice;
  b.history.push({ action: 'accept_counter', price: b.counterPrice, message: '买家接受了还价', time: new Date().toISOString(), by: user.stuId });
  // 不再自动标记为已售出，由卖家手动确认
  DB.set('bargains', bargains);
  return b;
}

function rejectCounter(bargainId) {
  var bargains = DB.get('bargains') || [];
  var idx = bargains.findIndex(function(b) { return b.id === bargainId; });
  if (idx === -1) return null;
  var user = DB.getCurrentUser();
  var b = bargains[idx];
  if (!user || b.fromUserId !== user.stuId) { showToast('只有买家可以拒绝还价', 'warn'); return null; }
  b.status = 'rejected';
  b.rejectedAt = new Date().toISOString();
  b.history.push({ action: 'reject_counter', message: '买家拒绝了还价', time: new Date().toISOString(), by: user.stuId });
  DB.set('bargains', bargains);
  return b;
}

function getBargainsForPost(postId) {
  var bargains = DB.get('bargains') || [];
  return bargains.filter(function(b) { return b.postId === postId; });
}

function getBargainsForSeller(userId) {
  var bargains = DB.get('bargains') || [];
  var posts = DB.getPosts();
  var sellerPostIds = posts.filter(function(p) { return p.authorId === userId && p.type === 'market'; }).map(function(p) { return p.id; });
  return bargains.filter(function(b) { return sellerPostIds.indexOf(b.postId) !== -1; });
}

function getBargainsForBuyer(userId) {
  var bargains = DB.get('bargains') || [];
  return bargains.filter(function(b) { return b.fromUserId === userId; });
}

function getBargainCountForSeller(userId) {
  return getBargainsForSeller(userId).filter(function(b) { return b.status === 'pending' || b.status === 'countered'; }).length;
}

function withdrawBargain(bargainId) {
  var bargains = DB.get('bargains') || [];
  var idx = bargains.findIndex(function(b) { return b.id === bargainId; });
  if (idx === -1) return null;
  var user = DB.getCurrentUser();
  var b = bargains[idx];
  if (!user || b.fromUserId !== user.stuId) { showToast('只能撤回自己的砍价', 'warn'); return null; }
  if (b.status !== 'pending' && b.status !== 'countered') { showToast('该砍价已无法撤回', 'warn'); return null; }
  b.status = 'withdrawn';
  b.history.push({ action: 'withdraw', message: '买家撤回了砍价', time: new Date().toISOString(), by: user.stuId });
  DB.set('bargains', bargains);
  return b;
}

// ---- 购买请求UI渲染 ----
function renderPurchaseRequestSection(post, user) {
  if (!user || post.type !== 'market') return '';
  var requests = getPurchaseRequestsForPost(post.id);
  if (requests.length === 0) return '';
  var isOwner = post.authorId === user.stuId;
  if (!isOwner) {
    // 买家视图：只显示自己的请求
    var myRequest = requests.find(function(r) { return r.buyerId === user.stuId; });
    if (!myRequest) return '';
    var statusLabels = { pending: '⏳ 等待卖家确认', accepted: '✅ 卖家已同意', rejected: '❌ 卖家已拒绝', cancelled: '↩️ 已取消' };
    var html = '<div class="detail-purchase-section">';
    html += '<h4>📋 我的购买申请 <span class="purchase-status-badge ' + myRequest.status + '">' + (statusLabels[myRequest.status] || myRequest.status) + '</span></h4>';
    if (myRequest.status === 'pending') {
      html += '<div class="purchase-hint">已向卖家发送购买请求，请耐心等待卖家确认。卖家同意后，由卖家操作标记已售出完成交易。</div>';
      html += '<div class="purchase-item-actions">';
      html += '<button class="btn-purchase-action cancel" onclick="event.stopPropagation();handleCancelPurchase(\'' + myRequest.id + '\',\'' + post.id + '\')">↩️ 取消申请</button>';
      html += '</div>';
    }
    if (myRequest.status === 'accepted') {
      html += '<div class="purchase-hint success">卖家已同意您的购买请求！请与卖家联系完成线下交易，卖家确认后将标记为已售出。</div>';
      html += '<div class="purchase-item-actions">';
      html += '<button class="btn-purchase-action chat" onclick="event.stopPropagation();openChatWith(\'' + post.authorId + '\')">💬 联系卖家</button>';
      html += '</div>';
    }
    if (myRequest.status === 'rejected') {
      html += '<div class="purchase-hint error">卖家拒绝了您的购买请求。</div>';
      if (myRequest.rejectReason) html += '<div class="purchase-reject-reason">拒绝理由：' + escHtml(myRequest.rejectReason) + '</div>';
      html += '<div class="purchase-item-actions">';
      html += '<button class="btn-purchase-action retry" onclick="event.stopPropagation();openPurchaseRequestModal(\'' + post.id + '\')">🔄 重新申请</button>';
      html += '</div>';
    }
    html += '</div>';
    return html;
  }

  // 卖家视图：显示所有购买请求
  var pending = requests.filter(function(r) { return r.status === 'pending'; });
  var accepted = requests.filter(function(r) { return r.status === 'accepted'; });
  var others = requests.filter(function(r) { return r.status !== 'pending'; });

  var html = '<div class="detail-purchase-section">';
  html += '<h4>📋 购买申请 <span style="font-size:12px;color:#9CA3AF;font-weight:400">(' + requests.length + '条)</span></h4>';

  if (pending.length > 0) {
    html += '<div class="purchase-pending-hint">有 ' + pending.length + ' 位买家希望购买此商品</div>';
  }

  requests.forEach(function(r) {
    var statusLabels = { pending: '⏳ 待确认', accepted: '✅ 已同意', rejected: '❌ 已拒绝', cancelled: '↩️ 已取消' };
    html += '<div class="purchase-request-item ' + r.status + '">';
    html += '<div class="purchase-request-header">';
    html += '<div class="purchase-request-avatar" style="background:' + r.buyerAvatarBg + ';color:' + r.buyerAvatarColor + '">' + r.buyerAvatar + '</div>';
    html += '<span class="purchase-request-name">' + r.buyerName + '</span>';
    html += '<span class="purchase-status-badge ' + r.status + '">' + (statusLabels[r.status] || r.status) + '</span>';
    html += '<span class="purchase-request-time">' + timeAgo(r.time) + '</span>';
    html += '</div>';
    if (r.message) html += '<div class="purchase-request-message">💬 ' + escHtml(r.message) + '</div>';
    if (r.rejectReason) html += '<div class="purchase-reject-reason">拒绝理由：' + escHtml(r.rejectReason) + '</div>';

    // 卖家操作按钮
    html += '<div class="purchase-item-actions">';
    if (r.status === 'pending') {
      html += '<button class="btn-purchase-action accept" onclick="event.stopPropagation();handleAcceptPurchase(\'' + r.id + '\',\'' + post.id + '\')">✅ 同意购买</button>';
      html += '<button class="btn-purchase-action reject" onclick="event.stopPropagation();handleRejectPurchase(\'' + r.id + '\',\'' + post.id + '\')">❌ 拒绝</button>';
      html += '<button class="btn-purchase-action chat" onclick="event.stopPropagation();openChatWith(\'' + r.buyerId + '\')">💬 私聊</button>';
    }
    if (r.status === 'accepted') {
      html += '<span class="purchase-accepted-info">已同意 — 请确认线下交易后标记为已售出</span>';
      html += '<button class="btn-purchase-action chat" onclick="event.stopPropagation();openChatWith(\'' + r.buyerId + '\')">💬 私聊</button>';
    }
    html += '</div>';
    html += '</div>';
  });

  html += '</div>';
  return html;
}

function openPurchaseRequestModal(postId) {
  var post = getPostById(postId);
  if (!post) return;
  var user = DB.getCurrentUser();
  if (!user) { showToast('请先登录', 'error'); return; }
  if (post.authorId === user.stuId) { showToast('不能购买自己的商品', 'warn'); return; }
  if (post.status === 'sold') { showToast('该商品已售出', 'warn'); return; }
  if (post.status === 'delisted') { showToast('该商品已下架', 'warn'); return; }

  // 检查是否已有进行中的请求
  var existing = getPurchaseRequestsForPost(postId).find(function(r) { return r.buyerId === user.stuId && r.status === 'pending'; });
  if (existing) { showToast('您已提交过购买请求，请等待卖家回复', 'warn'); return; }

  var html = '<div class="purchase-form">' +
    '<h3>💰 购买申请</h3>' +
    '<div class="purchase-subtitle">向卖家发送购买请求，卖家同意后由卖家操作完成交易</div>' +
    '<div class="purchase-price-show">' +
      '<div class="purchase-price-item"><div class="label">商品价格</div><div class="value">¥' + (post.price || '面议') + '</div></div>' +
      '<div class="purchase-price-arrow">→</div>' +
      '<div class="purchase-price-item"><div class="label">交易方式</div><div class="value" style="color:#059669">线下当面交易</div></div>' +
    '</div>' +
    '<div class="purchase-input-row">' +
      '<label>💬 给卖家留言（选填）</label>' +
      '<textarea class="purchase-message-input" id="purchaseMsg" placeholder="比如：我想购买此商品，方便什么时候在哪里面交？" rows="3" maxlength="200" oninput="document.getElementById(\'purchaseCharCount\').textContent=this.value.length+\'/200\'"></textarea>' +
      '<div class="purchase-char-count" id="purchaseCharCount">0/200</div>' +
    '</div>' +
    '<div class="purchase-flow-hint">' +
      '<div class="purchase-flow-step"><span class="step-num">1</span>提交购买申请</div>' +
      '<div class="purchase-flow-arrow">→</div>' +
      '<div class="purchase-flow-step"><span class="step-num">2</span>卖家确认同意</div>' +
      '<div class="purchase-flow-arrow">→</div>' +
      '<div class="purchase-flow-step"><span class="step-num">3</span>线下当面交易</div>' +
      '<div class="purchase-flow-arrow">→</div>' +
      '<div class="purchase-flow-step"><span class="step-num">4</span>卖家标记已售出</div>' +
    '</div>' +
    '<button class="btn-purchase-submit" onclick="submitPurchaseFromModal(\'' + postId + '\')">📝 提交购买申请</button>' +
  '</div>';

  openModal(html);
  setTimeout(function() { var el = document.getElementById('purchaseMsg'); if (el) el.focus(); }, 300);
}

function submitPurchaseFromModal(postId) {
  var msgEl = document.getElementById('purchaseMsg');
  var msg = msgEl ? msgEl.value.trim() : '';
  var result = submitPurchaseRequest(postId, msg);
  if (result) {
    showToast('购买申请已提交！等待卖家确认', 'success');
    closeModal();
    setTimeout(function() { openPostDetail(postId); }, 350);
  }
}

function handleAcceptPurchase(requestId, postId) {
  var result = acceptPurchaseRequest(requestId);
  if (result) {
    showToast('已同意购买请求！请线下交易后标记为已售出', 'success');
    closeModal();
    setTimeout(function() { openPostDetail(postId); }, 350);
  }
}

function handleRejectPurchase(requestId, postId) {
  // 使用确认对话框，让卖家输入拒绝理由
  var html = '<div style="padding:24px">' +
    '<h3 style="font-size:17px;font-weight:700;margin-bottom:12px;color:#1F2937">❌ 拒绝购买请求</h3>' +
    '<p style="font-size:13px;color:#6B7280;margin-bottom:16px">请告知买家拒绝的理由（选填）</p>' +
    '<textarea id="rejectReasonInput" class="bargain-message-input" placeholder="比如：商品已预留给其他人、价格不符等..." rows="3" maxlength="100" style="margin-bottom:16px"></textarea>' +
    '<div style="display:flex;gap:10px;justify-content:flex-end">' +
      '<button style="padding:10px 24px;border-radius:10px;background:#F3F4F6;color:#6B7280;font-size:14px;font-weight:500;border:1px solid #E5E7EB;cursor:pointer" onclick="closeModal()">取消</button>' +
      '<button id="confirmRejectBtn" style="padding:10px 24px;border-radius:10px;background:#EF4444;color:white;font-size:14px;font-weight:600;border:none;cursor:pointer">确认拒绝</button>' +
    '</div>' +
  '</div>';
  openModal(html);
  setTimeout(function() {
    var btn = document.getElementById('confirmRejectBtn');
    if (btn) btn.onclick = function() {
      var reasonEl = document.getElementById('rejectReasonInput');
      var reason = reasonEl ? reasonEl.value.trim() : '';
      var result = rejectPurchaseRequest(requestId, reason);
      if (result) {
        showToast('已拒绝购买请求', 'success');
        closeModal();
        setTimeout(function() { openPostDetail(postId); }, 350);
      }
    };
  }, 50);
}

function handleCancelPurchase(requestId, postId) {
  showConfirmDialog(
    '取消购买申请',
    '确定要取消购买申请吗？取消后可以重新提交。',
    '确认取消',
    '返回',
    function() {
      var result = cancelPurchaseRequest(requestId);
      if (result) {
        showToast('已取消购买申请', 'success');
        closeModal();
        setTimeout(function() { openPostDetail(postId); }, 350);
      }
    }
  );
}

// ---- 砍价UI渲染 ----
function renderBargainSection(post, user) {
  if (!user || post.type !== 'market') return '';
  var bargains = getBargainsForPost(post.id);
  var isOwner = post.authorId === user.stuId;
  var hasActiveBargain = bargains.some(function(b) { return b.fromUserId === user.stuId && (b.status === 'pending' || b.status === 'countered'); });

  // 卖家视图：显示所有砍价请求
  if (isOwner && bargains.length === 0) return '';
  if (!isOwner && bargains.length === 0 && !hasActiveBargain) {
    // 买家无砍价记录时不显示区块，只在按钮中提供砍价入口
    return '';
  }

  var statusLabels = { pending: '⏳ 待回复', accepted: '✅ 已接受', rejected: '❌ 已拒绝', countered: '🔄 已还价', withdrawn: '↩️ 已撤回' };

  var html = '<div class="detail-bargain-section">';
  html += '<h4>🤝 砍价记录 <span style="font-size:12px;color:#9CA3AF;font-weight:400">(' + bargains.length + '条)</span></h4>';

  bargains.forEach(function(b) {
    var isBuyer = user && b.fromUserId === user.stuId;
    var showActions = false;

    html += '<div class="bargain-item">';
    html += '<div class="bargain-item-header">';
    html += '<div class="bargain-item-avatar" style="background:' + b.fromUserAvatarBg + ';color:' + b.fromUserAvatarColor + '">' + b.fromUserAvatar + '</div>';
    html += '<span class="bargain-item-name">' + (isBuyer ? '我' : b.fromUserName) + '</span>';
    html += '<span class="bargain-status-badge ' + b.status + '">' + (statusLabels[b.status] || b.status) + '</span>';
    html += '<span class="bargain-item-time">' + timeAgo(b.time) + '</span>';
    html += '</div>';
    html += '<div class="bargain-item-body">';

    // 价格展示
    html += '<div class="bargain-item-prices">';
    html += '<span class="bargain-item-offer">出价 ¥' + b.offerPrice + '</span>';
    if (b.counterPrice) {
      html += '<span class="bargain-item-arrow">→</span>';
      html += '<span class="bargain-item-counter">还价 ¥' + b.counterPrice + '</span>';
    }
    html += '</div>';

    // 消息
    if (b.message) html += '<div class="bargain-item-message">' + escHtml(b.message) + '</div>';
    if (b.counterMessage) html += '<div class="bargain-item-message">💬 还价理由：' + escHtml(b.counterMessage) + '</div>';

    // 时间线
    html += '<div class="bargain-timeline">';
    (b.history || []).forEach(function(h) {
      var actionLabels = { offer: '出价', accept: '接受', reject: '拒绝', counter: '还价', accept_counter: '接受还价', reject_counter: '拒绝还价', withdraw: '撤回' };
      html += '<div class="bargain-timeline-item ' + h.action + '">';
      html += (actionLabels[h.action] || h.action);
      if (h.price) html += ' <span class="tl-price">¥' + h.price + '</span>';
      if (h.message && h.action !== 'offer') html += ' <span class="tl-msg">— ' + escHtml(h.message) + '</span>';
      html += ' <span style="color:#D1D5DB;font-size:11px">' + timeAgo(h.time) + '</span>';
      html += '</div>';
    });
    html += '</div>';

    // 操作按钮
    html += '<div class="bargain-item-actions">';

    // 卖家操作
    if (isOwner && b.status === 'pending') {
      html += '<button class="btn-bargain-action accept" onclick="event.stopPropagation();handleBargainAccept(\'' + b.id + '\',\'' + post.id + '\')">✅ 接受</button>';
      html += '<button class="btn-bargain-action counter" onclick="event.stopPropagation();showCounterForm(\'' + b.id + '\')">🔄 还价</button>';
      html += '<button class="btn-bargain-action reject" onclick="event.stopPropagation();handleBargainReject(\'' + b.id + '\',\'' + post.id + '\')">❌ 拒绝</button>';
      html += '<button class="btn-bargain-action chat" onclick="event.stopPropagation();openChatWith(\'' + b.fromUserId + '\')">💬 私聊</button>';
    }
    if (isOwner && b.status === 'countered') {
      html += '<button class="btn-bargain-action reject" onclick="event.stopPropagation();handleBargainReject(\'' + b.id + '\',\'' + post.id + '\')">❌ 拒绝</button>';
      html += '<button class="btn-bargain-action chat" onclick="event.stopPropagation();openChatWith(\'' + b.fromUserId + '\')">💬 私聊</button>';
    }

    // 买家操作
    if (isBuyer && b.status === 'countered') {
      html += '<button class="btn-bargain-action accept" onclick="event.stopPropagation();handleCounterAccept(\'' + b.id + '\',\'' + post.id + '\')">✅ 接受还价 ¥' + b.counterPrice + '</button>';
      html += '<button class="btn-bargain-action reject" onclick="event.stopPropagation();handleCounterReject(\'' + b.id + '\',\'' + post.id + '\')">❌ 拒绝还价</button>';
    }
    if (isBuyer && (b.status === 'pending' || b.status === 'countered')) {
      html += '<button class="btn-bargain-action withdraw" onclick="event.stopPropagation();handleBargainWithdraw(\'' + b.id + '\',\'' + post.id + '\')">↩️ 撤回</button>';
    }

    html += '</div>';

    // 还价表单容器
    if (isOwner && b.status === 'pending') {
      html += '<div class="counter-form" id="counterForm_' + b.id + '" style="display:none">';
      html += '<input type="number" class="counter-input" id="counterPrice_' + b.id + '" placeholder="还价金额（¥）" min="0" step="0.01">';
      html += '<textarea class="counter-msg" id="counterMsg_' + b.id + '" placeholder="还价理由（选填）" rows="2" maxlength="100"></textarea>';
      html += '<div class="counter-btns">';
      html += '<button style="background:#F3F4F6;color:#6B7280" onclick="document.getElementById(\'counterForm_' + b.id + '\').style.display=\'none\'">取消</button>';
      html += '<button style="background:#3B82F6;color:white" onclick="handleCounterBargain(\'' + b.id + '\',\'' + post.id + '\')">🔄 提交还价</button>';
      html += '</div></div>';
    }

    html += '</div></div>';
  });

  html += '</div>';
  return html;
}

function showCounterForm(bargainId) {
  var form = document.getElementById('counterForm_' + bargainId);
  if (form) {
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
    if (form.style.display === 'block') {
      var input = document.getElementById('counterPrice_' + bargainId);
      if (input) input.focus();
    }
  }
}

function handleBargainAccept(bargainId, postId) {
  var result = acceptBargain(bargainId);
  if (result) {
    showToast('已接受砍价！请线下交易后标记为已售出', 'success');
    closeModal();
    setTimeout(function() { openPostDetail(postId); }, 350);
  }
}

function handleBargainReject(bargainId, postId) {
  var result = rejectBargain(bargainId, '卖家拒绝了砍价');
  if (result) {
    showToast('已拒绝砍价', 'success');
    closeModal();
    setTimeout(function() { openPostDetail(postId); }, 350);
  }
}

function handleCounterBargain(bargainId, postId) {
  var priceEl = document.getElementById('counterPrice_' + bargainId);
  var msgEl = document.getElementById('counterMsg_' + bargainId);
  if (!priceEl || !priceEl.value) { showToast('请输入还价金额', 'warn'); return; }
  var result = counterBargain(bargainId, priceEl.value, msgEl ? msgEl.value : '');
  if (result) {
    showToast('还价成功！', 'success');
    closeModal();
    setTimeout(function() { openPostDetail(postId); }, 350);
  }
}

function handleCounterAccept(bargainId, postId) {
  var result = acceptCounter(bargainId);
  if (result) {
    showToast('已接受还价！请线下交易后标记为已售出', 'success');
    closeModal();
    setTimeout(function() { openPostDetail(postId); }, 350);
  }
}

function handleCounterReject(bargainId, postId) {
  var result = rejectCounter(bargainId);
  if (result) {
    showToast('已拒绝还价', 'success');
    closeModal();
    setTimeout(function() { openPostDetail(postId); }, 350);
  }
}

function handleBargainWithdraw(bargainId, postId) {
  var result = withdrawBargain(bargainId);
  if (result) {
    showToast('已撤回砍价', 'success');
    closeModal();
    setTimeout(function() { openPostDetail(postId); }, 350);
  }
}

function openBargainModal(postId) {
  var post = getPostById(postId);
  if (!post) return;
  var user = DB.getCurrentUser();
  if (!user) { showToast('请先登录', 'error'); return; }
  if (post.authorId === user.stuId) { showToast('不能对自己的商品砍价', 'warn'); return; }

  var postPrice = parseFloat(post.price) || 0;
  var suggestedPrice = postPrice > 0 ? Math.round(postPrice * 0.7) : '';

  var html = '<div class="bargain-form">' +
    '<h3>🤝 砍价出价</h3>' +
    '<div class="bargain-subtitle">向卖家提出你的价格，等待卖家回复</div>' +
    '<div class="bargain-price-compare">' +
      '<div class="bargain-price-item"><div class="label">原价</div><div class="value original">¥' + (post.price || '面议') + '</div></div>' +
      '<div class="bargain-price-arrow">→</div>' +
      '<div class="bargain-price-item"><div class="label">我的出价</div><div class="value offer" id="bargainLivePrice">¥?</div></div>' +
    '</div>' +
    '<div class="bargain-input-row">' +
      '<label>💰 你的出价</label>' +
      '<input type="number" class="bargain-price-input" id="bargainPrice" placeholder="输入你愿意支付的价格" min="0.01" step="0.01" value="' + suggestedPrice + '" oninput="updateBargainPreview(' + postPrice + ')">' +
      '<div class="bargain-discount-hint" id="bargainHint"></div>' +
    '</div>' +
    '<div class="bargain-input-row">' +
      '<label>💬 砍价理由</label>' +
      '<textarea class="bargain-message-input" id="bargainMsg" placeholder="说几句为什么这个价格合理，比如：同款二手市场均价、有轻微瑕疵等..." rows="3" maxlength="200" oninput="document.getElementById(\'bargainCharCount\').textContent=this.value.length+\'/200\'"></textarea>' +
      '<div class="bargain-char-count" id="bargainCharCount">0/200</div>' +
    '</div>' +
    '<button class="btn-bargain-submit" id="bargainSubmitBtn" onclick="submitBargainFromModal(\'' + postId + '\')">🤝 提交砍价</button>' +
  '</div>';

  openModal(html);
  if (suggestedPrice) updateBargainPreview(postPrice);
  setTimeout(function() { document.getElementById('bargainPrice')?.focus(); }, 300);
}

function updateBargainPreview(originalPrice) {
  var priceEl = document.getElementById('bargainPrice');
  var liveEl = document.getElementById('bargainLivePrice');
  var hintEl = document.getElementById('bargainHint');
  var submitEl = document.getElementById('bargainSubmitBtn');
  if (!priceEl) return;

  var offer = parseFloat(priceEl.value);
  if (isNaN(offer) || offer <= 0) {
    if (liveEl) liveEl.textContent = '¥?';
    if (hintEl) { hintEl.textContent = ''; hintEl.className = 'bargain-discount-hint'; }
    if (submitEl) submitEl.disabled = true;
    return;
  }

  if (liveEl) liveEl.textContent = '¥' + offer;
  if (submitEl) submitEl.disabled = false;

  if (originalPrice > 0) {
    var discount = Math.round((1 - offer / originalPrice) * 100);
    if (hintEl) {
      if (discount <= 10) {
        hintEl.textContent = '📉 比原价低 ' + discount + '%，礼貌砍价 👍';
        hintEl.className = 'bargain-discount-hint good';
      } else if (discount <= 30) {
        hintEl.textContent = '📉 比原价低 ' + discount + '%，合理范围';
        hintEl.className = 'bargain-discount-hint warn';
      } else if (discount <= 50) {
        hintEl.textContent = '📉 比原价低 ' + discount + '%，砍价幅度较大，建议说明理由';
        hintEl.className = 'bargain-discount-hint bad';
      } else {
        hintEl.textContent = '📉 比原价低 ' + discount + '%，砍价幅度过大，卖家可能拒绝';
        hintEl.className = 'bargain-discount-hint bad';
      }
    }
    if (offer >= originalPrice) {
      if (hintEl) { hintEl.textContent = '⚠️ 出价不能高于或等于原价'; hintEl.className = 'bargain-discount-hint bad'; }
      if (submitEl) submitEl.disabled = true;
    }
  }
}

function submitBargainFromModal(postId) {
  var priceEl = document.getElementById('bargainPrice');
  var msgEl = document.getElementById('bargainMsg');
  if (!priceEl || !priceEl.value) { showToast('请输入出价金额', 'warn'); return; }
  var msg = msgEl ? msgEl.value.trim() : '';
  if (!msg) { showToast('请说几句砍价理由', 'warn'); return; }

  var result = submitBargain(postId, priceEl.value, msg);
  if (result) {
    showToast('砍价已提交！等待卖家回复', 'success');
    closeModal();
    setTimeout(function() { openPostDetail(postId); }, 350);
  }
}

// ---- 跳转私聊 ----
function openChatWith(stuId) {
  window.location.href = 'chat.html?user=' + stuId;
}

// ---- 校区天气系统 ----
var CAMPUS_COORDS = {
  '青山校区':   { lat: 30.6306, lon: 114.3925, name: '青山校区' },
  '黄家湖校区': { lat: 30.4635, lon: 114.2185, name: '黄家湖校区' }
};

// 当前天气卡片展示的校区
var _weatherCampus = '';

var WMO_CODES = {
  0:  { desc: '晴',       icon: '☀️',  bg: 'mi-sunny',  night: false },
  1:  { desc: '大部晴',   icon: '🌤️', bg: 'mi-sunny',  night: false },
  2:  { desc: '局部多云', icon: '⛅',  bg: 'mi-cloudy',  night: false },
  3:  { desc: '多云',     icon: '☁️',  bg: 'mi-cloudy',  night: false },
  45: { desc: '雾',       icon: '🌫️', bg: 'mi-fog',    night: false },
  48: { desc: '冻雾',     icon: '🌫️', bg: 'mi-fog',    night: false },
  51: { desc: '小毛毛雨', icon: '🌦️', bg: 'mi-rain',    night: false },
  53: { desc: '毛毛雨',   icon: '🌦️', bg: 'mi-rain',    night: false },
  55: { desc: '大毛毛雨', icon: '🌧️', bg: 'mi-rain',    night: false },
  56: { desc: '冻毛毛雨', icon: '🌧️', bg: 'mi-rain',    night: false },
  57: { desc: '冻雨',     icon: '🌧️', bg: 'mi-rain',    night: false },
  61: { desc: '小雨',     icon: '🌧️', bg: 'mi-rain',    night: false },
  63: { desc: '中雨',     icon: '🌧️', bg: 'mi-rain',    night: false },
  65: { desc: '大雨',     icon: '⛈️', bg: 'mi-heavy-rain', night: false },
  66: { desc: '冻雨',     icon: '🌧️', bg: 'mi-rain',    night: false },
  67: { desc: '大冻雨',   icon: '🌧️', bg: 'mi-heavy-rain', night: false },
  71: { desc: '小雪',     icon: '🌨️', bg: 'mi-snow',    night: false },
  73: { desc: '中雪',     icon: '🌨️', bg: 'mi-snow',    night: false },
  75: { desc: '大雪',     icon: '❄️',  bg: 'mi-snow',    night: false },
  77: { desc: '雪粒',     icon: '🌨️', bg: 'mi-snow',    night: false },
  80: { desc: '小阵雨',   icon: '🌦️', bg: 'mi-rain',    night: false },
  81: { desc: '阵雨',     icon: '🌧️', bg: 'mi-rain',    night: false },
  82: { desc: '大阵雨',   icon: '⛈️', bg: 'mi-heavy-rain', night: false },
  85: { desc: '小阵雪',   icon: '🌨️', bg: 'mi-snow',    night: false },
  86: { desc: '大阵雪',   icon: '❄️',  bg: 'mi-snow',    night: false },
  95: { desc: '雷暴',     icon: '⛈️',  bg: 'mi-storm',   night: false },
  96: { desc: '雷暴冰雹', icon: '⛈️',  bg: 'mi-storm',   night: false },
  99: { desc: '强雷暴',   icon: '⛈️',  bg: 'mi-storm',   night: false }
};

function getWeatherInfo(code) {
  return WMO_CODES[code] || { desc: '未知', icon: '🌡️', bg: 'mi-cloudy', night: false };
}

function windDirectionText(deg) {
  var dirs = ['北','北东北','东北','东东北','东','东东南','东南','南东南','南','南西南','西南','西西南','西','西西北','西北','北西北'];
  return dirs[Math.round(deg / 22.5) % 16];
}

// 判断是否夜间
function isNightTime() {
  var h = new Date().getHours();
  return h < 6 || h >= 19;
}

/**
 * 获取校区天气数据（带缓存，30 分钟过期）
 * @param {string} campus - 校区名称
 * @returns {Promise<object|null>}
 */
async function fetchCampusWeather(campus) {
  var coord = CAMPUS_COORDS[campus];
  if (!coord) coord = CAMPUS_COORDS['青山校区'];

  // 检查缓存
  var cacheKey = 'wkust_weather_' + campus;
  var cached = null;
  try { cached = JSON.parse(localStorage.getItem(cacheKey)); } catch(e) {}
  if (cached && (Date.now() - cached.ts < 30 * 60 * 1000)) {
    return cached.data;
  }

  // 请求 Open-Meteo API（增加 hourly 小时预报）
  var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + coord.lat +
    '&longitude=' + coord.lon +
    '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m' +
    '&hourly=weather_code,temperature_2m' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset' +
    '&timezone=Asia/Shanghai&forecast_days=3';

  try {
    var resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    var data = await resp.json();

    // 缓存
    localStorage.setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: data }));
    return data;
  } catch(e) {
    console.warn('天气数据获取失败:', e);
    // 如果有旧缓存，容忍过期使用
    if (cached) return cached.data;
    return null;
  }
}

/**
 * 渲染天气卡片 — 小米天气风格
 * @param {string} campus - 校区名称
 */
async function renderWeatherCard(campus) {
  var container = document.getElementById('weatherCard');
  if (!container) return;

  _weatherCampus = campus;

  // 加载态
  container.innerHTML = '<div class="mi-weather-loading"><div class="mi-weather-spinner"></div><span>正在获取天气…</span></div>';

  var data = await fetchCampusWeather(campus);
  if (!data) {
    container.innerHTML = '<div class="mi-weather-error">⚠️ 天气数据暂时不可用</div>';
    return;
  }

  var cur = data.current;
  var daily = data.daily;
  var hourly = data.hourly;
  var wi = getWeatherInfo(cur.weather_code);
  var isNight = isNightTime();
  var bgClass = wi.bg + (isNight ? ' night' : '');

  // ---- 小时预报横条（取今天剩余 + 明天前几小时，共 12 个）----
  var nowHour = new Date().getHours();
  var hourlyHTML = '';
  if (hourly && hourly.time) {
    var count = 0;
    for (var h = 0; h < hourly.time.length && count < 12; h++) {
      var ht = new Date(hourly.time[h]);
      if (ht.getDate() === new Date().getDate() && ht.getHours() < nowHour) continue;
      var hwi = getWeatherInfo(hourly.weather_code[h]);
      var hLabel = ht.getDate() === new Date().getDate() && ht.getHours() === nowHour ? '现在' : ht.getHours() + ':00';
      hourlyHTML += '<div class="mi-hourly-item">' +
        '<span class="mi-hourly-time">' + hLabel + '</span>' +
        '<span class="mi-hourly-icon">' + hwi.icon + '</span>' +
        '<span class="mi-hourly-temp">' + Math.round(hourly.temperature_2m[h]) + '°</span>' +
      '</div>';
      count++;
    }
  }

  // ---- 三日预报 ----
  var forecastHTML = '';
  var weekDays = ['周日','周一','周二','周三','周四','周五','周六'];
  for (var i = 0; i < daily.time.length; i++) {
    var fwi = getWeatherInfo(daily.weather_code[i]);
    var dt = new Date(daily.time[i]);
    var dayLabel = i === 0 ? '今天' : i === 1 ? '明天' : weekDays[dt.getDay()];
    // 温度条范围
    var minAll = Math.min.apply(null, daily.temperature_2m_min);
    var maxAll = Math.max.apply(null, daily.temperature_2m_max);
    var range = maxAll - minAll || 1;
    var lo = Math.round(daily.temperature_2m_min[i]);
    var hi = Math.round(daily.temperature_2m_max[i]);
    var leftPct  = Math.round(((lo - minAll) / range) * 100);
    var widthPct = Math.max(8, Math.round(((hi - lo) / range) * 100));
    forecastHTML += '<div class="mi-forecast-row">' +
      '<span class="mi-fc-day">' + dayLabel + '</span>' +
      '<span class="mi-fc-icon">' + fwi.icon + '</span>' +
      '<span class="mi-fc-desc">' + fwi.desc + '</span>' +
      '<span class="mi-fc-low">' + lo + '°</span>' +
      '<span class="mi-fc-bar"><span class="mi-fc-bar-fill" style="left:' + leftPct + '%;width:' + widthPct + '%"></span></span>' +
      '<span class="mi-fc-high">' + hi + '°</span>' +
    '</div>';
  }

  // 日出日落
  var sunrise = daily.sunrise[0] ? daily.sunrise[0].split('T')[1] : '--:--';
  var sunset  = daily.sunset[0]  ? daily.sunset[0].split('T')[1]  : '--:--';

  // 当前时间
  var now = new Date();
  var timeStr = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
  var dateStr = (now.getMonth()+1) + '月' + now.getDate() + '日 ' + ['周日','周一','周二','周三','周四','周五','周六'][now.getDay()];

  container.innerHTML =
    // ---- 主视觉区域 ----
    '<div class="mi-weather-hero ' + bgClass + '">' +
      '<div class="mi-hero-bg-deco mi-hero-deco-1"></div>' +
      '<div class="mi-hero-bg-deco mi-hero-deco-2"></div>' +
      '<div class="mi-hero-bg-deco mi-hero-deco-3"></div>' +
      // 顶部行：校区标签 + 刷新
      '<div class="mi-hero-top">' +
        '<div class="mi-campus-chip">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>' +
          '<span>' + escHtml(campus) + '</span>' +
        '</div>' +
        '<button class="mi-refresh-btn no-ripple" onclick="refreshWeather(\'' + escHtml(campus) + '\')" title="刷新">' +
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>' +
        '</button>' +
      '</div>' +
      // 大温度 + 图标
      '<div class="mi-hero-center">' +
        '<span class="mi-hero-icon">' + wi.icon + '</span>' +
        '<div class="mi-hero-temp-wrap">' +
          '<span class="mi-hero-temp">' + Math.round(cur.temperature_2m) + '</span>' +
          '<span class="mi-hero-degree">°</span>' +
        '</div>' +
      '</div>' +
      '<div class="mi-hero-desc">' + wi.desc + '</div>' +
      '<div class="mi-hero-sub">体感 ' + Math.round(cur.apparent_temperature) + '° · ' + dateStr + ' ' + timeStr + '</div>' +
    '</div>' +

    // ---- 信息详情 pill ----
    '<div class="mi-weather-pills">' +
      '<div class="mi-pill"><span class="mi-pill-icon">💧</span><span class="mi-pill-label">湿度</span><span class="mi-pill-val">' + cur.relative_humidity_2m + '%</span></div>' +
      '<div class="mi-pill"><span class="mi-pill-icon">🌬️</span><span class="mi-pill-label">风</span><span class="mi-pill-val">' + cur.wind_speed_10m + 'km/h ' + windDirectionText(cur.wind_direction_10m) + '</span></div>' +
      '<div class="mi-pill"><span class="mi-pill-icon">🌅</span><span class="mi-pill-label">日出</span><span class="mi-pill-val">' + sunrise + '</span></div>' +
      '<div class="mi-pill"><span class="mi-pill-icon">🌇</span><span class="mi-pill-label">日落</span><span class="mi-pill-val">' + sunset + '</span></div>' +
    '</div>' +

    // ---- 小时预报横条 ----
    (hourlyHTML ? '<div class="mi-hourly-section"><div class="mi-section-title">逐时预报</div><div class="mi-hourly-scroll">' + hourlyHTML + '</div></div>' : '') +

    // ---- 三日预报 ----
    '<div class="mi-forecast-section"><div class="mi-section-title">三日预报</div>' + forecastHTML + '</div>';
}

/**
 * 手动刷新天气
 */
async function refreshWeather(campus) {
  // 清除缓存
  localStorage.removeItem('wkust_weather_' + campus);
  await renderWeatherCard(campus);
  showToast('天气已更新', 'success');
}

/**
 * 导航栏迷你天气
 */
async function renderNavWeather(campus) {
  var el = document.getElementById('navWeather');
  if (!el) return;

  var data = await fetchCampusWeather(campus);
  if (!data) { el.textContent = ''; return; }

  var wi = getWeatherInfo(data.current.weather_code);
  el.innerHTML = '<span class="nav-weather-icon">' + wi.icon + '</span><span class="nav-weather-temp">' + Math.round(data.current.temperature_2m) + '°</span>';
}

// ---- 校区切换 → 天气联动 ----
window.addEventListener('campusChanged', function(e) {
  var campus = e.detail;
  // 如果切到"全部"，用用户默认校区
  if (campus === 'all') {
    var user = DB.getCurrentUser();
    campus = user ? user.campus : '青山校区';
  }
  renderWeatherCard(campus);
  renderNavWeather(campus);
});

console.log('%c武汉科技大学校园社区 已加载', 'color:#4F46E5;font-size:14px;font-weight:bold;');

