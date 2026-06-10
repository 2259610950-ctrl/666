// UniCampus - 全局脚本

// 导航滚动效果
window.addEventListener('scroll', () => {
  const nav = document.getElementById('navbar');
  if (nav) nav.classList.toggle('scrolled', window.scrollY > 10);
});

// 搜索
function openSearch() {
  document.getElementById('searchOverlay').classList.add('active');
  setTimeout(() => document.getElementById('searchInput')?.focus(), 50);
}
function closeSearch() {
  document.getElementById('searchOverlay').classList.remove('active');
}
function fillSearch(el) {
  const input = document.getElementById('searchInput');
  if (input) { input.value = el.textContent; input.focus(); }
}
document.getElementById('searchBtn')?.addEventListener('click', openSearch);
document.getElementById('searchOverlay')?.addEventListener('click', function(e) {
  if (e.target === this) closeSearch();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSearch(); });

// 点赞切换
function toggleLike(btn) {
  btn.classList.toggle('liked');
  const span = btn.querySelector('span');
  const num = parseInt(span.textContent) || 0;
  span.textContent = btn.classList.contains('liked') ? num + 1 : num - 1;
}

// Feed标签切换
function switchTab(btn, tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

// 快速发布类型切换
document.querySelectorAll('.qp-type').forEach(btn => {
  btn.addEventListener('click', function() {
    document.querySelectorAll('.qp-type').forEach(b => b.classList.remove('active'));
    this.classList.add('active');
  });
});

// 快速发布按钮
document.querySelector('.qp-submit')?.addEventListener('click', function() {
  const ta = document.querySelector('.quick-post textarea');
  if (ta && ta.value.trim()) {
    showToast('发布成功！');
    ta.value = '';
  } else {
    ta?.focus();
  }
});

// 加好友
document.querySelectorAll('.add-friend-btn').forEach(btn => {
  btn.addEventListener('click', function() {
    if (this.textContent === '加好友') {
      this.textContent = '已发送';
      this.style.background = '#EEF2FF';
      this.style.color = '#6366F1';
      this.style.borderColor = '#C7D2FE';
      showToast('好友申请已发送');
    }
  });
});

// 报名参加
document.querySelectorAll('.join-btn').forEach(btn => {
  btn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (this.textContent !== '已报名') {
      this.textContent = '已报名';
      this.style.background = '#D1FAE5';
      this.style.color = '#065F46';
      showToast('报名成功！活动前一天会收到提醒');
    }
  });
});

// 申请内推
document.querySelectorAll('.refer-btn').forEach(btn => {
  btn.addEventListener('click', function(e) {
    e.stopPropagation();
    showToast('已发送内推申请，请等待对方回复');
  });
});

// Toast提示
function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  t.style.cssText = `
    position:fixed; bottom:80px; left:50%; transform:translateX(-50%) translateY(20px);
    background:#1a1a2e; color:white; padding:10px 20px; border-radius:24px;
    font-size:13px; z-index:999; opacity:0; transition:all 0.3s ease;
    box-shadow:0 4px 16px rgba(0,0,0,0.15); white-space:nowrap;
  `;
  document.body.appendChild(t);
  requestAnimationFrame(() => {
    t.style.opacity = '1';
    t.style.transform = 'translateX(-50%) translateY(0)';
  });
  setTimeout(() => {
    t.style.opacity = '0'; t.style.transform = 'translateX(-50%) translateY(10px)';
    setTimeout(() => t.remove(), 300);
  }, 2500);
}

// 筛选标签
document.querySelectorAll('.filter-tag').forEach(tag => {
  tag.addEventListener('click', function() {
    const group = this.closest('.filter-bar');
    if (group) {
      group.querySelectorAll('.filter-tag').forEach(t => t.classList.remove('active'));
    }
    this.classList.add('active');
  });
});

// 聊天面板
let chatOpen = false;
function toggleChat() {
  const panel = document.getElementById('chatPanel');
  if (!panel) return;
  chatOpen = !chatOpen;
  panel.classList.toggle('open', chatOpen);
}

function sendMsg() {
  const input = document.getElementById('chatMsgInput');
  if (!input || !input.value.trim()) return;
  const msgs = document.getElementById('chatMsgs');
  const row = document.createElement('div');
  row.className = 'msg-row self';
  row.innerHTML = `<div class="msg-bubble">${input.value}</div>`;
  msgs.appendChild(row);
  input.value = '';
  msgs.scrollTop = msgs.scrollHeight;
  // 模拟回复
  setTimeout(() => {
    const reply = document.createElement('div');
    reply.className = 'msg-row';
    reply.innerHTML = `
      <div class="msg-avatar" style="background:#EEEDFE;color:#534AB7">系</div>
      <div class="msg-bubble">收到你的消息了！稍后回复你 😊</div>
    `;
    msgs.appendChild(reply);
    msgs.scrollTop = msgs.scrollHeight;
  }, 800);
}

document.getElementById('chatMsgInput')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') sendMsg();
});

console.log('%cUniCampus 已加载', 'color:#4F46E5;font-size:14px;font-weight:bold;');
