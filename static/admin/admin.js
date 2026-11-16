/* 写信的桌子 —— 一个不需要懂 Markdown 的写稿页
   数据：GitHub Contents API（直接提交 .md）
   图片：直传 cloudflare-imgbed-auw.pages.dev
   待提交：改动先攒在本机队列里，攒够了一次 commit（只触发一次构建）
   草稿：localStorage，改动后 700ms 自动存，刷新不丢 */
'use strict';

/* 改了这个文件就把 BUILD 往后挪一位：页面会拿它跟线上的比，
   发现线上更新了就顶一条「有新版本」，点一下就能刷新（手机上没有 Ctrl+R）。 */
const BUILD = '2026-11-16.2';

const CFG = {
  owner: 'cyjx007',
  repo: 'blog',
  branch: 'main',
  dir: 'content/posts',
  imgEndpoint: 'https://cloudflare-imgbed-auw.pages.dev/upload',
  siteBase: 'https://blog.tanghuang.dpdns.org/posts/',
};

const LS = { token: 'desk.token', img: 'desk.imgauth', draft: 'desk.draft', meta: 'desk.meta', queue: 'desk.queue' };

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const editor = $('#editor');
const LIST_PAGE = 20;

const state = {
  token: '',
  imgAuth: '',
  posts: [],          // 仓库里的文件（Contents API 列表）
  queue: [],          // 待提交的改动
  current: null,      // 正在编辑的这封
  initialHtml: '',    // 打开时的 HTML：用来判断正文到底动没动过
  savedRange: null,
  timer: null,
  dirty: false,
  listLimit: LIST_PAGE,
  filter: 'all',      // all | queued | draft
  queueOpen: false,
  flashPath: '',      // 刚加进队列的那行，闪一下
};

/* ── 小工具 ───────────────────────────────────────────── */
let toastTimer = null;
function toast(msg, ms = 2400) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function h(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function toB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function fromB64(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

const pad = (n) => String(n).padStart(2, '0');

function localIso(d) {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`;
}

function toDateInput(iso) {
  const m = String(iso || '').match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/);
  return m ? `${m[1]}T${m[2]}` : '';
}

function fromDateInput(v) {
  if (!v) return localIso(new Date());
  const d = new Date(v);
  return isNaN(d) ? localIso(new Date()) : localIso(d);
}

function esc(s) { return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

function slugify(title) {
  return String(title).trim()
    // 半角非法字符 + 常见全角标点，都从地址里去掉
    .replace(/[\\/:*?"<>|#%{}^~[\]`]/g, '')
    .replace(/[：，。！？、；：""''（）《》〈〉「」『』【】…·—]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'untitled-' + Date.now();
}

function parseTags(v) {
  return String(v || '').split(/[,，]/).map((s) => s.trim()).filter(Boolean);
}

function tagsFromYaml(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try { return JSON.parse(s).map(String); } catch (e) { /* 手工兜底 */ }
    return s.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
  }
  return [s.replace(/^["']|["']$/g, '')];
}

function pathName(path) { return String(path || '').split('/').pop() || ''; }
function pathSlug(path) { return pathName(path).replace(/\.md$/i, ''); }
function pathTitle(path) { return pathSlug(path).replace(/-/g, ' '); }

/* 「12 分钟前」这种，队列里比时间戳好读 */
function relTime(ts) {
  if (!ts) return '';
  const d = Date.now() - ts;
  if (d < 0) return '刚刚';
  if (d < 60e3) return '刚刚';
  if (d < 3600e3) return `${Math.floor(d / 60e3)} 分钟前`;
  if (d < 86400e3) return `${Math.floor(d / 3600e3)} 小时前`;
  if (d < 7 * 86400e3) return `${Math.floor(d / 86400e3)} 天前`;
  const t = new Date(ts);
  return `${t.getMonth() + 1} 月 ${t.getDate()} 日`;
}

function chip(text, cls) {
  const s = document.createElement('span');
  s.className = 'badge' + (cls ? ' ' + cls : '');
  s.textContent = text;
  return s;
}

/* ── 弹层：确认 / 输入 / 提示（替掉原生 confirm、prompt，那个太丑了） ── */
let dlgResolve = null;

function askConfirm(opt) {
  return openDialog({
    title: opt.title || '确认一下',
    message: opt.message || '',
    okText: opt.okText || '确定',
    cancelText: opt.cancelText || '取消',
    danger: !!opt.danger,
  }).then((v) => v === true);
}

function askPrompt(opt) {
  return openDialog({
    title: opt.title || '填一下',
    message: opt.message || '',
    okText: opt.okText || '确定',
    cancelText: opt.cancelText || '取消',
    input: true,
    value: opt.value || '',
    placeholder: opt.placeholder || '',
  }).then((v) => (typeof v === 'string' && v.trim() ? v.trim() : null));
}

function openDialog(opt) {
  return new Promise((resolve) => {
    /* 上一张没关就先按取消结掉，别把 Promise 悬着 */
    if (dlgResolve) { const prev = dlgResolve; dlgResolve = null; prev(null); }
    dlgResolve = resolve;

    $('#dlg-title').textContent = opt.title;
    const msg = $('#dlg-msg');
    msg.textContent = opt.message || '';
    msg.hidden = !opt.message;

    const input = $('#dlg-input');
    input.hidden = !opt.input;
    input.value = opt.value || '';
    input.placeholder = opt.placeholder || '';

    const ok = $('#dlg-ok');
    ok.textContent = opt.okText;
    ok.classList.toggle('btn-danger', !!opt.danger);
    $('#dlg-cancel').textContent = opt.cancelText;

    $('#dlg-modal').hidden = false;
    setTimeout(() => {
      if (opt.input) { input.focus(); input.select(); }
      else ok.focus();
    }, 40);
  });
}

function closeDialog(result) {
  const modal = $('#dlg-modal');
  if (modal.hidden) return;
  modal.hidden = true;
  const r = dlgResolve;
  dlgResolve = null;
  if (r) r(result);
}

/* ── GitHub ───────────────────────────────────────────── */
async function gh(pathname, opts = {}) {
  const res = await fetch(`https://api.github.com/repos/${CFG.owner}/${CFG.repo}${pathname}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${state.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 200);
    if (res.status === 401) throw new Error('令牌无效，或者没有这个仓库的权限');
    if (res.status === 403) throw new Error('令牌权限不够（需要 Contents: Read and write）');
    if (res.status === 404) throw new Error('找不到（仓库名或路径不对）');
    if (res.status === 409) throw new Error('GitHub 409：这个文件在别处被改过了');
    if (res.status === 422) throw new Error(`GitHub 422：${text}`);
    throw new Error(`GitHub ${res.status}：${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

/* ── 视图切换 ─────────────────────────────────────────── */
function show(name) {
  ['setup', 'list', 'editor'].forEach((v) => { $('#view-' + v).hidden = v !== name; });
  window.scrollTo(0, 0);
}

/* ── 设置 ─────────────────────────────────────────────── */
function initSetup() {
  $('#in-token').value = state.token;
  $('#in-imgauth').value = state.imgAuth;
  $('#btn-connect').addEventListener('click', async () => {
    const token = $('#in-token').value.trim();
    const img = $('#in-imgauth').value.trim();
    if (!token) { toast('先填令牌'); return; }
    const btn = $('#btn-connect');
    btn.disabled = true;
    btn.textContent = '检查中…';
    try {
      state.token = token;
      state.imgAuth = img;
      await gh('');
      localStorage.setItem(LS.token, token);
      localStorage.setItem(LS.img, img);
      $('#setup-error').hidden = true;
      show('list');
      loadList();
    } catch (e) {
      $('#setup-error').textContent = e.message;
      $('#setup-error').hidden = false;
      state.token = '';
    } finally {
      btn.disabled = false;
      btn.textContent = '连上，开始写';
    }
  });
  $('#btn-refresh-setup').addEventListener('click', hardReload);
}

/* ── 列表 ─────────────────────────────────────────────── */
async function loadList() {
  const hint = $('#list-hint');
  hint.hidden = false;
  hint.textContent = '正在读信匣…';
  try {
    const items = await gh(`/contents/${CFG.dir}?ref=${CFG.branch}`);
    state.posts = items
      .filter((i) => i.type === 'file' && i.name.endsWith('.md') && !i.name.startsWith('_'))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    hint.hidden = true;
    state.listLimit = LIST_PAGE;
    adoptQueueBase();
    renderList();
    enrichMeta();   /* 标题/日期/草稿标记：后台补，不挡列表 */
  } catch (e) {
    hint.textContent = e.message;
  }
}

/* ── 标题缓存：按文件 sha 存，没变过的文件不重复拉 ── */
function readMetaCache() {
  try { return JSON.parse(localStorage.getItem(LS.meta) || '{}'); } catch (e) { return {}; }
}
function writeMetaCache(c) {
  try { localStorage.setItem(LS.meta, JSON.stringify(c)); } catch (e) {}
}

let renderTimer = null;
function scheduleRender() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(renderList, 40);
}

async function enrichMeta() {
  const cache = readMetaCache();
  const live = new Set(state.posts.map((p) => p.path));
  Object.keys(cache).forEach((k) => { if (!live.has(k)) delete cache[k]; });   /* 删掉的文件别留在缓存里 */
  const todo = state.posts.filter((i) => !cache[i.path] || cache[i.path].sha !== i.sha).slice(0, 40);
  let dirty = false;
  for (const item of todo) {
    try {
      const data = await gh(`/contents/${encodeURI(item.path)}?ref=${CFG.branch}`);
      const { fm } = parseFront(fromB64(data.content));
      cache[item.path] = {
        sha: item.sha,
        title: fm.title || '',
        date: fm.date || '',
        draft: String(fm.draft).toLowerCase() === 'true',
        tags: tagsFromYaml(fm.tags),
      };
      dirty = true;
      scheduleRender();
    } catch (e) { /* 单个失败就保持文件名 */ }
  }
  if (dirty) writeMetaCache(cache);
}

/* 合并两个来源：仓库里的文件 + 队列里还没进仓库的新信 */
function listRows() {
  const cache = readMetaCache();
  const qmap = queueMap();
  const rows = [];
  const seen = new Set();

  state.posts.forEach((item) => {
    const m = cache[item.path] || {};
    rows.push({
      path: item.path,
      title: m.title || pathTitle(item.path),
      date: (m.date || '').slice(0, 10),
      draft: !!m.draft,
      tags: m.tags || [],
      remoteSha: item.sha,
      exists: true,
      queued: qmap.get(item.path) || null,
    });
    seen.add(item.path);
  });

  qmap.forEach((item) => {
    if (seen.has(item.path)) return;
    const { fm } = parseFront(item.md);
    rows.push({
      path: item.path,
      title: item.title || fm.title || pathTitle(item.path),
      date: String(fm.date || '').slice(0, 10),
      draft: String(fm.draft).toLowerCase() === 'true',
      tags: tagsFromYaml(fm.tags),
      remoteSha: null,
      exists: false,
      queued: item,
    });
  });

  return rows;
}

function updateFilterChips(counts) {
  const label = { all: '全部', queued: '待提交', draft: '草稿' };
  $$('#filter-row .chip').forEach((b) => {
    const k = b.dataset.filter;
    const n = counts[k] || 0;
    b.textContent = label[k] + (n ? ` ${n}` : '');
    const on = state.filter === k;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

function renderList() {
  const ul = $('#post-list');
  if (!ul) return;
  const q = ($('#list-search').value || '').trim().toLowerCase();
  const all = listRows();

  const counts = {
    all: all.length,
    queued: all.filter((r) => r.queued).length,
    draft: all.filter((r) => r.draft).length,
  };
  updateFilterChips(counts);

  const rows = all.filter((r) => {
    if (state.filter === 'queued' && !r.queued) return false;
    if (state.filter === 'draft' && !r.draft) return false;
    if (!q) return true;
    return r.title.toLowerCase().includes(q) ||
      r.path.toLowerCase().includes(q) ||
      r.tags.some((t) => String(t).toLowerCase().includes(q));
  });

  /* 有日期的按日期新→旧，没日期的排后面按标题 */
  rows.sort((a, b) => {
    if (a.date && b.date && a.date !== b.date) return b.date.localeCompare(a.date);
    if (a.date && !b.date) return -1;
    if (!a.date && b.date) return 1;
    return a.title.localeCompare(b.title, 'zh');
  });

  ul.innerHTML = '';

  if (!rows.length) {
    const li = document.createElement('li');
    li.className = 'list-empty';
    li.textContent = q ? '没有匹配的信'
      : state.filter === 'queued' ? '还没有待提交的改动'
      : state.filter === 'draft' ? '没有草稿'
      : '还没有信';
    ul.appendChild(li);
    return;
  }

  rows.slice(0, state.listLimit).forEach((r) => {
    const li = document.createElement('li');
    if (r.queued) li.classList.add('is-queued');
    if (state.flashPath && state.flashPath === r.path) li.classList.add('is-flash');

    const a = document.createElement('a');
    a.href = '#';

    const t = document.createElement('span');
    t.className = 't';
    t.textContent = r.title;
    a.appendChild(t);

    /* 一眼看出来哪封改了、哪封没改 */
    if (r.queued) a.appendChild(chip(r.exists ? '待提交' : '待提交 · 新', 'badge-pending'));
    if (r.queued && r.exists && r.queued.baseSha && r.remoteSha !== r.queued.baseSha) {
      a.appendChild(chip('线上已变', 'badge-warn'));
    }
    if (r.draft) a.appendChild(chip('草稿', ''));

    if (r.date) {
      const d = document.createElement('span');
      d.className = 'd';
      d.textContent = r.date;
      a.appendChild(d);
    }

    a.addEventListener('click', (ev) => { ev.preventDefault(); openRow(r); });
    li.appendChild(a);
    ul.appendChild(li);
  });

  /* 分页：一次 20 封，点「加载更多」再加 20 */
  if (rows.length > state.listLimit) {
    const li = document.createElement('li');
    li.className = 'list-more';
    const b = document.createElement('button');
    b.className = 'btn btn-small btn-ghost';
    b.textContent = `还有 ${rows.length - state.listLimit} 封，加载更多`;
    b.addEventListener('click', () => {
      state.listLimit += LIST_PAGE;
      renderList();
    });
    li.appendChild(b);
    ul.appendChild(li);
  }
}

function openRow(row) {
  if (row.queued) { openQueued(row.queued); return; }
  openRemote(row.path);
}

/* ── 待提交队列：攒几篇改动，一次 commit = 一次构建 ── */
function readQueue() {
  let raw;
  try { raw = JSON.parse(localStorage.getItem(LS.queue) || '[]'); } catch (e) { raw = []; }
  if (!Array.isArray(raw)) raw = [];
  const seen = new Set();
  return raw
    .filter((i) => i && typeof i.path === 'string' && typeof i.md === 'string')
    .map((i) => ({
      path: i.path,
      title: i.title || pathTitle(i.path),
      slug: i.slug || pathSlug(i.path),
      md: i.md,
      /* 老版本队列没有 baseSha：null 表示「不知道基线」，adoptQueueBase() 会按仓库现状补上 */
      baseSha: i.baseSha === undefined ? null : i.baseSha,
      at: i.at || 0,
    }))
    .filter((i) => { if (seen.has(i.path)) return false; seen.add(i.path); return true; });
}

function writeQueue(q) {
  try { localStorage.setItem(LS.queue, JSON.stringify(q)); }
  catch (e) { toast('本机存不下了（浏览器存储满了），先清几封', 4200); }
  refreshQueueUI();
}

function queueMap() {
  const m = new Map();
  state.queue.forEach((i) => m.set(i.path, i));
  return m;
}

function refreshQueueUI() {
  state.queue = readQueue();
  renderQueuePanel();
  renderList();
  updateEditorChrome();
}

/* 老队列没记基线 sha 的，按仓库当前版本补上（否则会被当成「新信」） */
function adoptQueueBase() {
  const byPath = new Map(state.posts.map((p) => [p.path, p]));
  let changed = false;
  state.queue = state.queue.map((q) => {
    if (q.baseSha === null && byPath.has(q.path)) {
      changed = true;
      return { ...q, baseSha: byPath.get(q.path).sha };
    }
    return q;
  });
  if (changed) writeQueue(state.queue);
}

function renderQueuePanel() {
  const panel = $('#queue-panel');
  if (!panel) return;
  const q = state.queue;
  if (!q.length) {
    panel.hidden = true;
    state.queueOpen = false;
    $('#queue-count').textContent = '待提交 0 封';
    return;
  }
  panel.hidden = false;

  const edits = q.filter((i) => i.baseSha).length;
  const news = q.length - edits;
  const parts = [];
  if (edits) parts.push(`${edits} 改`);
  if (news) parts.push(`${news} 新`);
  $('#queue-count').textContent = `待提交 ${q.length} 封` + (parts.length ? `（${parts.join(' · ')}）` : '');

  const toggle = $('#btn-queue-toggle');
  toggle.setAttribute('aria-expanded', state.queueOpen ? 'true' : 'false');
  panel.classList.toggle('is-open', state.queueOpen);

  const ul = $('#queue-list');
  ul.hidden = !state.queueOpen;
  if (!state.queueOpen) { ul.innerHTML = ''; return; }

  ul.innerHTML = '';
  q.slice().sort((a, b) => b.at - a.at).forEach((item) => {
    const li = document.createElement('li');
    li.className = 'queue-item';

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'queue-item__open';
    const t = document.createElement('span');
    t.className = 'queue-item__title';
    t.textContent = item.title || pathTitle(item.path);
    const m = document.createElement('span');
    m.className = 'queue-item__meta';
    m.textContent = (item.baseSha ? '改旧信' : '新信') + ' · ' + relTime(item.at);
    open.append(t, m);
    open.addEventListener('click', () => {
      state.queueOpen = false;
      renderQueuePanel();
      openQueued(item);
    });

    const acts = document.createElement('div');
    acts.className = 'queue-item__acts';

    const diff = document.createElement('button');
    diff.type = 'button';
    diff.className = 'queue-item__act';
    diff.textContent = '看改动';
    diff.addEventListener('click', () => showDiff(item.path));

    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'queue-item__act queue-item__act--danger';
    drop.textContent = '撤回';
    drop.addEventListener('click', () => dropQueueItem(item.path));

    acts.append(diff, drop);
    li.append(open, acts);
    ul.appendChild(li);
  });
}

function toggleQueuePanel(open) {
  state.queueOpen = typeof open === 'boolean' ? open : !state.queueOpen;
  renderQueuePanel();
}

async function queueCurrent() {
  if (!state.current) return;
  const built = buildMarkdown();
  if (!built.title) { toast('先给这封信起个名字'); $('#in-title').focus(); return; }
  if (!built.body.trim() && !state.current.sha) {
    const ok = await askConfirm({
      title: '正文是空的',
      message: '这封还没有正文。也要先加进待提交吗？',
      okText: '先加进去',
    });
    if (!ok) return;
  }

  const path = state.current.path || `${CFG.dir}/${built.slug}.md`;
  const q = state.queue.filter((i) => i.path !== path);
  q.push({
    path,
    title: built.title,
    slug: built.slug,
    md: built.md,
    baseSha: state.current.sha || null,
    at: Date.now(),
  });

  /* 队列里的东西已经是「存下来的」，本机草稿就没用了 */
  clearTimeout(state.timer);
  try { localStorage.removeItem(LS.draft); } catch (e) {}
  state.dirty = false;
  state.initialHtml = editor.innerHTML;
  state.current.markdown = built.body;
  state.current.path = path;
  state.current.slug = built.slug;
  state.flashPath = path;

  writeQueue(q);
  showDraftCard();
  show('list');
  updateEditorChrome();
  setTimeout(() => {
    if (state.flashPath === path) { state.flashPath = ''; renderList(); }
  }, 2600);
  toast(`已加入待提交（共 ${q.length} 封），攒够了点「一次提交」`, 3200);
}

async function dropQueueItem(path) {
  const item = queueMap().get(path);
  if (!item) return;
  const ok = await askConfirm({
    title: '撤回这封的改动？',
    message: `「${item.title || pathTitle(path)}」在待提交里的内容会被丢掉。` +
      (item.baseSha ? '编辑器里会换回线上那一版。' : '这是一封还没进仓库的新信，撤回就没了。'),
    okText: '撤回',
    danger: true,
  });
  if (!ok) return;

  writeQueue(state.queue.filter((i) => i.path !== path));

  const onThis = state.current && currentPath() === path;
  if (onThis && !state.dirty) {
    if (item.baseSha) {
      await openRemote(path);
      toast('已撤回，编辑器换回线上版本');
    } else {
      state.current = null;
      show('list');
      toast('已撤回这封新信');
    }
  } else if (onThis) {
    toast('已从待提交撤回（编辑器里还是你现在改的内容）', 3200);
  } else {
    toast('已撤回');
  }
}

async function commitQueue() {
  const q = state.queue.slice();
  if (!q.length) return;
  if (!state.token) { show('setup'); return; }

  /* 线上这封在我们排队之后又变过（多半是在电脑上发过），提交会覆盖掉 */
  const byPath = new Map(state.posts.map((p) => [p.path, p]));
  const stale = q.filter((i) => i.baseSha && (!byPath.has(i.path) || byPath.get(i.path).sha !== i.baseSha));

  let message = `一次提交 ${q.length} 封？只触发一次构建。\n\n` + q.map((i) => '· ' + i.title).join('\n');
  if (stale.length) {
    message += `\n\n注意：这 ${stale.length} 封线上已经改过了，会用你这里的版本覆盖：\n` +
      stale.map((i) => '· ' + i.title).join('\n');
  }

  const ok = await askConfirm({
    title: '一次提交',
    message,
    okText: '提交',
    danger: stale.length > 0,
  });
  if (!ok) return;

  const btn = $('#btn-commit-all');
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = '提交中…';
  try {
    const ref = await gh(`/git/ref/heads/${CFG.branch}`);
    const baseSha = ref.object.sha;
    const baseCommit = await gh(`/git/commits/${baseSha}`);
    const treeItems = [];
    for (const item of q) {
      const blob = await gh('/git/blobs', {
        method: 'POST',
        body: JSON.stringify({ content: item.md, encoding: 'utf-8' }),
      });
      treeItems.push({ path: item.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const tree = await gh('/git/trees', {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree: treeItems }),
    });
    const msg = q.length === 1
      ? `post: ${q[0].title}`
      : `post: ${q.length} 封（${q.map((i) => i.title).join('、').slice(0, 50)}）`;
    const commit = await gh('/git/commits', {
      method: 'POST',
      body: JSON.stringify({ message: msg, tree: tree.sha, parents: [baseSha] }),
    });
    await gh(`/git/refs/heads/${CFG.branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha }),
    });

    /* 提交完，这些文件的标题缓存也过期了 */
    const cache = readMetaCache();
    q.forEach((i) => { delete cache[i.path]; });
    writeMetaCache(cache);

    state.flashPath = '';
    writeQueue([]);
    toast(`已提交 ${q.length} 封，一分钟左右上线`, 3200);
    loadList();
  } catch (e) {
    toast('提交失败：' + e.message, 5200);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}

async function clearQueue() {
  if (!state.queue.length) return;
  const ok = await askConfirm({
    title: '清空待提交？',
    message: `${state.queue.length} 封的改动还没进仓库，清掉就没了。`,
    okText: '清空',
    danger: true,
  });
  if (!ok) return;
  writeQueue([]);
  toast('待提交已清空');
}

/* ── 看改动：把线上版本和队列里的版本逐行比一下 ── */
const remoteCache = new Map();

async function fetchRemoteMd(path, wantSha) {
  const hit = remoteCache.get(path);
  if (hit && hit.sha && (!wantSha || hit.sha === wantSha)) return hit.md;
  try {
    const data = await gh(`/contents/${encodeURI(path)}?ref=${CFG.branch}`);
    const md = fromB64(data.content);
    remoteCache.set(path, { sha: data.sha, md });
    return md;
  } catch (e) {
    if (/找不到/.test(e.message)) { remoteCache.set(path, { sha: null, md: null }); return null; }
    throw e;
  }
}

/* 最长公共子序列，够用了；两边都限制在 1000 行内 */
function diffLines(oldText, newText) {
  const norm = (s) => String(s).replace(/\r\n/g, '\n').replace(/\n+$/, '');
  const A = norm(oldText).split('\n');
  const B = norm(newText).split('\n');
  const n = A.length, m = B.length;
  if (n > 1000 || m > 1000) return null;

  const w = m + 1;
  const dp = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    const row = i * w, next = (i + 1) * w;
    for (let j = m - 1; j >= 0; j--) {
      dp[row + j] = A[i] === B[j]
        ? dp[next + j + 1] + 1
        : Math.max(dp[next + j], dp[row + j + 1]);
    }
  }

  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { ops.push({ t: ' ', s: A[i] }); i++; j++; }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) { ops.push({ t: '-', s: A[i] }); i++; }
    else { ops.push({ t: '+', s: B[j] }); j++; }
  }
  while (i < n) ops.push({ t: '-', s: A[i++] });
  while (j < m) ops.push({ t: '+', s: B[j++] });
  return ops;
}

function renderDiff(ops, box) {
  const CONTEXT = 3;
  let added = 0, removed = 0;
  ops.forEach((o) => { if (o.t === '+') added++; else if (o.t === '-') removed++; });

  if (!added && !removed) {
    box.innerHTML = '<p class="diff-empty">和线上完全一样。</p>';
    return { added, removed };
  }

  const keep = new Uint8Array(ops.length);
  ops.forEach((o, i) => {
    if (o.t === ' ') return;
    const from = Math.max(0, i - CONTEXT);
    const to = Math.min(ops.length - 1, i + CONTEXT);
    for (let k = from; k <= to; k++) keep[k] = 1;
  });

  const html = [];
  let gap = false;
  ops.forEach((o, i) => {
    if (!keep[i]) { gap = true; return; }
    if (gap) { html.push('<div class="diff-gap">⋯</div>'); gap = false; }
    const cls = o.t === '+' ? 'diff-add' : o.t === '-' ? 'diff-del' : 'diff-ctx';
    html.push(`<div class="diff-line ${cls}"><span class="diff-sign">${o.t}</span><span class="diff-text">${h(o.s) || '&nbsp;'}</span></div>`);
  });
  if (gap) html.push('<div class="diff-gap">⋯</div>');

  box.innerHTML = html.join('');
  return { added, removed };
}

async function showDiff(path) {
  const item = queueMap().get(path);
  if (!item) return;
  const box = $('#diff-body');
  $('#diff-title').textContent = item.title || pathTitle(path);
  $('#diff-hint').textContent = '正在取线上版本…';
  box.innerHTML = '';
  openModal('#diff-modal');

  let remote = null;
  try {
    remote = await fetchRemoteMd(path, item.baseSha);
  } catch (e) {
    $('#diff-hint').textContent = '取线上版本失败：' + e.message;
    return;
  }

  if (remote === null) {
    const ops = item.md.replace(/\n+$/, '').split('\n').map((s) => ({ t: '+', s }));
    $('#diff-hint').textContent = '线上还没有这个文件 · 一整封都是新的';
    renderDiff(ops, box);
    return;
  }

  const ops = diffLines(remote, item.md);
  if (!ops) {
    $('#diff-hint').textContent = '文件太长，没法在这里逐行比。用「看 Markdown 原文」核对吧。';
    return;
  }
  const { added, removed } = renderDiff(ops, box);
  const stale = item.baseSha && state.posts.some((p) => p.path === path && p.sha !== item.baseSha);
  $('#diff-hint').textContent = (added || removed ? `+${added} 行 · −${removed} 行` : '和线上一样') +
    (stale ? ' · 线上这封在你排队之后又改过' : '');
}

/* ── 草稿（本机） ─────────────────────────────────────── */
function readDraft() {
  try { return JSON.parse(localStorage.getItem(LS.draft) || 'null'); } catch (e) { return null; }
}

function showDraftCard() {
  const d = readDraft();
  const card = $('#draft-card');
  if (!d || !d.html) { card.hidden = true; return; }
  /* 改的是旧信就说「改到一半」，别说成「没写完的新信」 */
  $('#draft-head').textContent = d.sha ? '有一封旧信改到一半' : '有一封新信没写完';
  $('#draft-title').textContent = d.title || '（没标题）';
  card.hidden = false;
}

function writeDraft() {
  if (!state.current || !state.dirty) return;
  const d = {
    title: $('#in-title').value,
    date: $('#in-date').value,
    tags: $('#in-tags').value,
    salutation: $('#in-salutation').value,
    draft: $('#in-draft').checked,
    pin: $('#in-pin').checked,
    html: editor.innerHTML,
    /* 把原文和打开时的 HTML 也存下来：刷新后才知道正文到底动没动过，
       不然每次恢复都会把老文章 Markdown→HTML→Markdown 重排一遍 */
    markdown: state.current.markdown || '',
    initialHtml: state.initialHtml || '',
    path: state.current.path,
    sha: state.current.sha,
    slug: state.current.slug,
    at: Date.now(),
  };
  try { localStorage.setItem(LS.draft, JSON.stringify(d)); } catch (e) {}
  const t = new Date();
  $('#save-hint').textContent = `已自动存到本机 · ${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

function scheduleDraft() {
  state.dirty = true;
  clearTimeout(state.timer);
  state.timer = setTimeout(writeDraft, 700);
}

/* ── 粘 Markdown / 导入 .md：认 front matter，认标题和空行 ── */
function splitFrontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text || '');
  if (!m) return { meta: null, body: text || '' };
  const meta = {};
  m[1].split(/\r?\n/).forEach((line) => {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) return;
    let v = kv[2].trim();
    if (/^".*"$/.test(v) || /^'.*'$/.test(v)) v = v.slice(1, -1);
    meta[kv[1].toLowerCase()] = v;
  });
  return { meta, body: text.slice(m[0].length) };
}

function applyMeta(meta) {
  if (!meta) return 0;
  let n = 0;
  if (meta.title && !$('#in-title').value) { $('#in-title').value = meta.title; n++; }
  if (meta.date) {
    const d = toDateInput(meta.date);
    if (d && !$('#in-date').value) { $('#in-date').value = d; n++; }
  }
  if (meta.tags) {
    const tags = meta.tags.replace(/^\[|\]$/g, '').split(',')
      .map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    if (tags.length && !$('#in-tags').value) { $('#in-tags').value = tags.join(', '); n++; }
  }
  if (meta.salutation && !$('#in-salutation').value) { $('#in-salutation').value = meta.salutation; n++; }
  if (meta.draft === 'true' && !$('#in-draft').checked) { $('#in-draft').checked = true; n++; }
  if (meta.pin === 'true' && !$('#in-pin').checked) { $('#in-pin').checked = true; n++; }
  return n;
}

function looksLikeMarkdown(s) {
  return /^#{1,6}\s/m.test(s) || /^\s*[-*+]\s+/m.test(s) || /^\s*\d+\.\s+/m.test(s) ||
    /^\s*>\s/m.test(s) || /```/.test(s) || /\*\*[^*]+\*\*/.test(s);
}

function textToHtml(text) {
  return String(text).split(/\r?\n\s*\r?\n/).map((para) => {
    const e = para.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return '<p>' + e.replace(/\r?\n/g, '<br>') + '</p>';
  }).join('');
}

/* 一段文本 → 编辑器 HTML：像 Markdown 就渲染，否则按空行分段 */
function textToEditorHtml(text) {
  return looksLikeMarkdown(text) ? sanitizeHtml(marked.parse(text)) : textToHtml(text);
}

/* 贴进来的 HTML（包括 marked 渲染结果）都过一遍：去掉脚本和内联事件 */
function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe,meta,link,object,embed,form,input,button,textarea').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((n) => {
    Array.from(n.attributes).forEach((a) => {
      if (/^on/i.test(a.name)) n.removeAttribute(a.name);
      else if ((a.name === 'href' || a.name === 'src' || a.name === 'xlink:href') && /^\s*(javascript|data:text\/html)/i.test(a.value)) n.removeAttribute(a.name);
      else if (a.name === 'style' && /expression|url\s*\(\s*['"]?\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
    });
  });
  return doc.body.innerHTML;
}

function importMarkdownFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const { meta, body } = splitFrontMatter(String(reader.result || ''));
    const filled = applyMeta(meta);
    editor.innerHTML = textToEditorHtml(body);
    state.dirty = true;
    scheduleDraft();
    toast(filled ? `导入完成，顺手填了 ${filled} 个字段` : '导入完成', 3000);
  };
  reader.readAsText(file, 'utf-8');
}

/* ── 编辑器 ───────────────────────────────────────────── */
function currentPath() {
  if (!state.current) return '';
  if (state.current.path) return state.current.path;
  const title = $('#in-title').value.trim();
  return title ? `${CFG.dir}/${slugify(title)}.md` : '';
}

function updateEditorChrome() {
  if (!state.current) return;
  const path = currentPath();
  const queued = path ? queueMap().get(path) : null;
  const isEdit = !!state.current.sha;

  let status = isEdit ? '改一封旧信' : '新的一封';
  if (state.current.draft) status += '（前台不显示）';
  if (queued) status += ' · 待提交';
  $('#editor-status').textContent = status;

  $('#btn-save').textContent = queued ? '更新待提交' : '加入待提交';
  $('#btn-delete').hidden = !isEdit;

  const slug = state.current.slug || (($('#in-title').value.trim()) ? slugify($('#in-title').value.trim()) : '');
  $('#slug-line').textContent = slug ? `地址：${CFG.siteBase}${slug}/` : '地址按标题自动生成';

  const strip = $('#pending-strip');
  if (!queued) { strip.hidden = true; return; }
  strip.hidden = false;
  $('#pending-text').textContent =
    (queued.baseSha ? '这封改过的旧信' : '这封新信') + `还在待提交里 · ${relTime(queued.at)}加入`;
}

function fillEditor(post) {
  $('#in-title').value = post.title || '';
  $('#in-date').value = toDateInput(post.dateIso) || toDateInput(localIso(new Date()));
  $('#in-tags').value = (post.tags || []).join(', ');
  $('#in-salutation').value = post.salutation || '';
  $('#in-draft').checked = !!post.draft;
  $('#in-pin').checked = !!post.pin;
  $('#save-hint').textContent = '';
  editor.innerHTML = post.markdown ? marked.parse(post.markdown) : '';
  state.initialHtml = editor.innerHTML;
  state.dirty = false;   /* 刚打开还没改：别立刻写草稿 */
  show('editor');
  updateEditorChrome();
  if (!post.title) $('#in-title').focus();
}

/* 打开一份 Markdown：远程文件、队列里的版本、草稿，都走这里 */
function applyMarkdown(md, opts) {
  const { fm, body } = parseFront(md);
  state.current = {
    path: opts.path || null,
    sha: opts.sha || null,
    slug: fm.slug || pathSlug(opts.path || ''),
    title: fm.title || '',
    dateIso: fm.date || '',
    tags: tagsFromYaml(fm.tags),
    salutation: fm.salutation || '',
    draft: String(fm.draft).toLowerCase() === 'true',
    pin: String(fm.pin).toLowerCase() === 'true',
    markdown: body,
  };
  fillEditor(state.current);
}

function newPost() {
  state.current = {
    path: null, sha: null, slug: '', title: '', dateIso: localIso(new Date()),
    tags: [], salutation: '', draft: false, pin: false, markdown: '',
  };
  fillEditor(state.current);
}

async function openRemote(path) {
  try {
    toast('打开中…', 800);
    const data = await gh(`/contents/${encodeURI(path)}?ref=${CFG.branch}`);
    const md = fromB64(data.content);
    remoteCache.set(path, { sha: data.sha, md });
    applyMarkdown(md, { path: data.path, sha: data.sha });
  } catch (e) {
    toast(e.message);
  }
}

/* 队列里已经有一版：打开的是你还没提交的那一版，不是线上的 */
function openQueued(item) {
  if (!item) return;
  applyMarkdown(item.md, { path: item.path, sha: item.baseSha || null });
}

function parseFront(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: {}, body: String(text) };
  const fm = {};
  let lastKey = null;
  m[1].split(/\r?\n/).forEach((line) => {
    if (!line.trim() || line.trim().startsWith('#')) return;
    if (/^\s*-\s+/.test(line) && lastKey) {
      fm[lastKey] = (fm[lastKey] || '') + (fm[lastKey] ? ', ' : '') + line.trim().replace(/^-\s+/, '');
      return;
    }
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) {
      lastKey = kv[1];
      fm[lastKey] = kv[2].trim().replace(/^"(.*)"$/, '$1').replace(/\\"/g, '"');
    }
  });
  return { fm, body: String(text).slice(m[0].length).replace(/^\n+/, '') };
}

function buildMarkdown() {
  const title = $('#in-title').value.trim();
  const dateIso = fromDateInput($('#in-date').value);
  const tags = parseTags($('#in-tags').value);
  const salutation = $('#in-salutation').value.trim();
  const draft = $('#in-draft').checked;
  const pin = $('#in-pin').checked;
  const cur = state.current || {};
  const slug = cur.slug || slugify(title);

  // 正文没动过就原样保留（避免 Markdown → HTML → Markdown 把老文章重排）
  const untouched = cur.markdown && editor.innerHTML === state.initialHtml;
  const body = untouched
    ? cur.markdown.trim()
    : turndownService.turndown(editor.innerHTML)
        .replace(/^(\s*)-   /gm, '$1- ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

  const lines = ['---', `title: "${esc(title)}"`, `date: ${dateIso}`, `draft: ${draft}`, `slug: "${esc(slug)}"`];
  if (salutation) lines.push(`salutation: "${esc(salutation)}"`);
  if (pin) lines.push('pin: true');
  lines.push(`tags: ${JSON.stringify(tags)}`, 'categories: []', '---', '');
  return { md: lines.join('\n') + '\n' + body + '\n', body, title, slug, tags, dateIso, draft, pin };
}

async function save() {
  if (!state.token) { show('setup'); return; }
  if (!state.current) return;
  const built = buildMarkdown();
  if (!built.title) { toast('先给这封信起个名字'); $('#in-title').focus(); return; }

  const btn = $('#btn-publish');
  btn.disabled = true;
  btn.textContent = '提交中…';
  const path = state.current.path || `${CFG.dir}/${built.slug}.md`;
  const body = {
    message: `${state.current.sha ? 'edit' : 'post'}: ${built.title}`,
    content: toB64(built.md),
    branch: CFG.branch,
  };
  if (state.current.sha) body.sha = state.current.sha;
  try {
    let res;
    try {
      res = await gh(`/contents/${encodeURI(path)}`, { method: 'PUT', body: JSON.stringify(body) });
    } catch (e) {
      if (!/409/.test(e.message)) throw e;
      /* 远端被改过（多半是刚从电脑上发过一封）：问一句再覆盖，别让人白写 */
      let cur = null;
      try { cur = await gh(`/contents/${encodeURI(path)}`); } catch (e2) { cur = null; }
      if (!cur || !cur.sha) throw e;
      const ok = await askConfirm({
        title: '这封在别处改过了',
        message: '远端版本比你这边的更新（可能是从电脑上发的）。用你现在写的覆盖它吗？',
        okText: '覆盖',
        danger: true,
      });
      if (!ok) throw new Error('没覆盖。先把正文复制出来，再刷新重写。');
      body.sha = cur.sha;
      res = await gh(`/contents/${encodeURI(path)}`, { method: 'PUT', body: JSON.stringify(body) });
    }

    state.current.sha = res.content.sha;
    state.current.path = res.content.path;
    state.current.slug = built.slug;
    state.current.markdown = built.body;
    state.initialHtml = editor.innerHTML;
    state.dirty = false;
    try { localStorage.removeItem(LS.draft); } catch (e) {}
    showDraftCard();

    /* 已经发出去了，队列里那份就不该再留着（否则会重复提交） */
    if (state.queue.some((i) => i.path === state.current.path)) {
      writeQueue(state.queue.filter((i) => i.path !== state.current.path));
    }
    remoteCache.delete(state.current.path);
    const cache = readMetaCache();
    delete cache[state.current.path];
    writeMetaCache(cache);

    updateEditorChrome();
    toast(built.draft ? '已存成草稿（不会上线）' : '已提交，一分钟左右上线');
    $('#save-hint').textContent = `上次提交：${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  } catch (e) {
    toast(e.message, 4200);
  } finally {
    btn.disabled = false;
    btn.textContent = '立即发布';
  }
}

async function removePost() {
  if (!state.current || !state.current.sha) return;
  const ok = await askConfirm({
    title: '删掉这封信？',
    message: `「${state.current.title || pathTitle(state.current.path)}」会从仓库里删掉，线上也就没了。`,
    okText: '删除',
    danger: true,
  });
  if (!ok) return;
  const path = state.current.path;
  try {
    await gh(`/contents/${encodeURI(path)}`, {
      method: 'DELETE',
      body: JSON.stringify({ message: `delete: ${state.current.title}`, sha: state.current.sha, branch: CFG.branch }),
    });
    try { localStorage.removeItem(LS.draft); } catch (e) {}
    remoteCache.delete(path);
    const cache = readMetaCache();
    delete cache[path];
    writeMetaCache(cache);
    state.current = null;
    if (state.queue.some((i) => i.path === path)) writeQueue(state.queue.filter((i) => i.path !== path));
    show('list');
    toast('已删除');
    loadList();
  } catch (e) {
    toast(e.message, 4000);
  }
}

/* ── Markdown 转换 ────────────────────────────────────── */
const turndownService = new TurndownService({
  headingStyle: 'atx',
  hr: '---',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
});
turndownService.addRule('strikethrough', {
  filter: ['del', 's'],
  replacement: (c) => '~~' + c + '~~',
});

/* ── 工具栏 ───────────────────────────────────────────── */
function rememberRange() {
  const sel = window.getSelection();
  if (sel && sel.rangeCount && editor.contains(sel.anchorNode)) {
    state.savedRange = sel.getRangeAt(0).cloneRange();
  }
}

function restoreRange() {
  if (!state.savedRange || !editor.contains(state.savedRange.commonAncestorContainer)) return false;
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(state.savedRange);
  return true;
}

function insertHtml(html) {
  editor.focus();
  restoreRange();
  document.execCommand('insertHTML', false, html);
  rememberRange();
}

function block(tag) {
  editor.focus();
  try {
    document.execCommand('formatBlock', false, `<${tag}>`);
  } catch (e) {
    document.execCommand('formatBlock', false, tag);
  }
}

function insertCode() {
  const sel = window.getSelection();
  const text = sel ? sel.toString() : '';
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  insertHtml(`<pre><code>${safe}</code></pre><p><br></p>`);
}

async function insertLink() {
  rememberRange();
  const sel = window.getSelection();
  const selected = sel ? sel.toString().trim() : '';
  const url = await askPrompt({
    title: '插入链接',
    message: selected ? `给「${selected.slice(0, 30)}」加个地址` : '链接地址',
    value: 'https://',
    placeholder: 'https://example.com',
    okText: '插入',
  });
  if (!url) return;

  /* 弹层把选区抢走了，回来得先还原 */
  editor.focus();
  restoreRange();
  const now = window.getSelection();
  if (now && now.toString().trim()) {
    document.execCommand('createLink', false, url);
  } else {
    insertHtml(`<a href="${h(url)}">${h(url)}</a>`);
  }
  rememberRange();
}

async function pickImage() {
  rememberRange();
  $('#file-input').value = '';
  $('#file-input').click();
}

/* 手机照片动辄 5 MB：先缩到长边 1600 再传，快、也省图床 */
function fmtKB(n) { return n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB'; }

async function shrinkImage(file) {
  if (/^image\/(gif|svg)/.test(file.type)) return file;          /* 动图/矢量不动 */
  if (file.size < 400 * 1024) return file;                       /* 小图不折腾 */
  let bmp;
  try { bmp = await createImageBitmap(file); } catch (e) { return file; }  /* HEIC 之类解不开就原样传 */
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale));
  const hgt = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, hgt);
  const png = /png$/.test(file.type);                            /* PNG 保持 PNG，别把透明转成黑底 */
  const blob = await new Promise((r) => canvas.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.85));
  if (!blob || blob.size >= file.size * 0.9) return file;
  const name = (file.name || 'image').replace(/\.[^.]+$/, '') + (png ? '.png' : '.jpg');
  return new File([blob], name, { type: png ? 'image/png' : 'image/jpeg' });
}

async function handleFile(file) {
  if (!file) return;
  if (!/^image\//.test(file.type)) { toast('只支持图片'); return; }
  toast('处理中…', 1500);
  try {
    const small = await shrinkImage(file);
    if (small !== file) toast(`压缩 ${fmtKB(file.size)} → ${fmtKB(small.size)}`, 2000);
    const url = await uploadImage(small);
    insertHtml(`<img src="${h(url)}" alt="${h((file.name || 'image').replace(/\.[^.]+$/, ''))}">`);
    toast('图片已插进来');
  } catch (e) {
    toast('上传失败：' + e.message, 4000);
  }
}

async function uploadImage(file) {
  const fd = new FormData();
  fd.append('file', file, file.name || `image-${Date.now()}.png`);
  const res = await fetch(`${CFG.imgEndpoint}?authCode=${encodeURIComponent(state.imgAuth)}&returnFormat=full`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) throw new Error(`图床返回 ${res.status}`);
  const json = await res.json();
  const item = Array.isArray(json) ? json[0] : json;
  const src = item && (item.src || item.url);
  if (!src) throw new Error('图床没给地址');
  return src;
}

function bindToolbar() {
  $('#toolbar').addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-cmd]');
    if (!btn) return;
    const c = btn.dataset.cmd;
    if (c === 'image') { pickImage(); return; }
    editor.focus();
    if (c === 'h2' || c === 'h3' || c === 'p') block(c === 'p' ? 'p' : c);
    else if (c === 'quote') block('blockquote');
    else if (c === 'code') insertCode();
    else if (c === 'link') insertLink();
    else if (c === 'ul') document.execCommand('insertUnorderedList');
    else if (c === 'ol') document.execCommand('insertOrderedList');
    else if (c === 'hr') insertHtml('<hr><p><br></p>');
    else if (c === 'undo') document.execCommand('undo');
    else document.execCommand(c);
    scheduleDraft();
  });

  $('#file-input').addEventListener('change', (ev) => {
    handleFile(ev.target.files[0]);
  });

  bindMarkdownInput();
  bindPaste();
  document.addEventListener('selectionchange', () => {
    if (document.activeElement === editor) syncFormatButtons();
  });
  editor.addEventListener('keyup', syncFormatButtons);
  editor.addEventListener('mouseup', syncFormatButtons);
  editor.addEventListener('focus', syncFormatButtons);
}

/* ── 敲 "## " 变标题、"- " 变列表、"> " 变引用…… ── */
function bindMarkdownInput() {
  editor.addEventListener('beforeinput', (ev) => {
    if (ev.inputType !== 'insertText' || ev.data !== ' ') return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE) return;

    const before = node.textContent.slice(0, sel.anchorOffset);
    const m = /^(#{1,3}|[-*+]|1\.|>|```)$/.exec(before);
    if (!m) return;
    ev.preventDefault();

    /* 去掉行首记号，光标回到块首，再套上对应的块格式 */
    node.textContent = node.textContent.slice(sel.anchorOffset);
    const r = document.createRange();
    r.setStart(node, 0);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);

    const mark = m[1];
    if (mark[0] === '#') block(mark.length >= 3 ? 'h3' : 'h2');
    else if (mark === '>') block('blockquote');
    else if (mark === '```') insertCode();
    else if (mark === '1.') document.execCommand('insertOrderedList');
    else document.execCommand('insertUnorderedList');
    syncFormatButtons();
    scheduleDraft();
  });
}

/* ── 光标在哪，工具栏就亮哪个 ── */
function syncFormatButtons() {
  const btns = $$('#toolbar button[data-cmd]');
  if (!btns.length) return;

  const set = (cmd, on) => {
    const b = btns.find((x) => x.dataset.cmd === cmd);
    if (b) b.classList.toggle('is-active', !!on);
  };

  const inEditor = editor.contains(window.getSelection() ? window.getSelection().anchorNode : null);
  if (!inEditor) { btns.forEach((b) => b.classList.remove('is-active')); return; }

  let tag = '';
  try { tag = String(document.queryCommandValue('formatBlock') || '').toLowerCase(); } catch (e) {}
  const is = (c) => { try { return document.queryCommandState(c); } catch (e) { return false; } };

  set('h2', tag === 'h2');
  set('h3', tag === 'h3' || tag === 'h4');
  set('quote', tag === 'blockquote');
  set('code', tag === 'pre');
  set('p', !tag || tag === 'p' || tag === 'div');
  set('bold', is('bold'));
  set('italic', is('italic'));
  set('ul', is('insertUnorderedList'));
  set('ol', is('insertOrderedList'));
}

function bindPaste() {
  editor.addEventListener('paste', (ev) => {
    const cd = ev.clipboardData;
    if (!cd) return;
    const files = cd.files;
    if (files && files.length && /^image\//.test(files[0].type)) {
      ev.preventDefault();
      handleFile(files[0]);
      return;
    }

    const html = cd.getData('text/html');
    if (html) {
      ev.preventDefault();
      document.execCommand('insertHTML', false, sanitizeHtml(html));
      scheduleDraft();
      return;
    }

    /* 纯文本：多半是从编辑器里整篇粘过来的 Markdown。
       先把 front matter 拆出来填表单，剩下的按 Markdown 渲染——不然会挤成一大段。 */
    const text = cd.getData('text/plain');
    if (!text) return;
    ev.preventDefault();
    const { meta, body } = splitFrontMatter(text);
    const filled = applyMeta(meta);
    insertHtml(textToEditorHtml(body));
    scheduleDraft();
    if (filled) toast(`认出了 ${filled} 个字段（标题/日期/标签…）`, 2600);
  });
}

/* ── 弹层开关 ─────────────────────────────────────────── */
function openModal(sel) {
  const m = $(sel);
  if (!m) return;
  m.hidden = false;
  const box = m.querySelector('.modal-box');
  if (box) box.scrollTop = 0;
}

function closeModal(sel) {
  const m = $(sel);
  if (m) m.hidden = true;
}

/* ── 版本检查 + 强制刷新（手机浏览器没有 Ctrl+R） ── */
let latestBuild = '';

async function checkVersion() {
  try {
    const res = await fetch(`/admin/admin.js?ts=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return;
    const text = await res.text();
    const m = text.match(/const\s+BUILD\s*=\s*['"]([^'"]+)['"]/);
    if (!m || !m[1] || m[1] === BUILD) return;
    latestBuild = m[1];
    const bar = $('#update-bar');
    if (bar) {
      $('#update-text').textContent = `写稿台有新版本（${m[1]}），刷新一下就能用上`;
      bar.hidden = false;
    }
  } catch (e) { /* 离线就算了 */ }
}

async function hardReload() {
  toast('正在刷新…', 1200);
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if (window.caches && caches.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) { /* 清不掉也照样刷 */ }
  const url = new URL(location.href);
  url.searchParams.set('_r', String(Date.now()));
  location.replace(url.toString());
}

/* 刷新完把 ?_r=… 从地址栏抹掉，别留在历史里 */
function cleanReloadParam() {
  try {
    const url = new URL(location.href);
    if (!url.searchParams.has('_r')) return;
    url.searchParams.delete('_r');
    history.replaceState(null, '', url.pathname + (url.search ? url.search : '') + url.hash);
  } catch (e) {}
}

/* ── 启动 ─────────────────────────────────────────────── */
function boot() {
  state.token = localStorage.getItem(LS.token) || '';
  state.imgAuth = localStorage.getItem(LS.img) || 'tanghuang';
  state.queue = readQueue();
  cleanReloadParam();

  initSetup();
  bindToolbar();

  $('#btn-new').addEventListener('click', newPost);
  $('#btn-settings').addEventListener('click', () => {
    $('#in-token').value = state.token;
    $('#in-imgauth').value = state.imgAuth;
    $('#setup-version').textContent = `写稿台版本 ${BUILD}`;
    show('setup');
  });
  $('#btn-back').addEventListener('click', async () => {
    if (state.dirty) {
      const ok = await askConfirm({
        title: '还没加进待提交',
        message: '这封改动只存在本机草稿里。回列表也行，下次点「继续写」能接着改。',
        okText: '回列表',
        cancelText: '再改改',
      });
      if (!ok) return;
    }
    show('list');
    if (state.token) loadList();
    showDraftCard();
  });
  $('#btn-save').addEventListener('click', queueCurrent);
  $('#btn-publish').addEventListener('click', save);
  $('#btn-delete').addEventListener('click', removePost);

  $('#btn-source').addEventListener('click', () => {
    const { md } = buildMarkdown();
    $('#md-text').value = md;
    openModal('#md-modal');
  });

  $('#list-search').addEventListener('input', () => {
    state.listLimit = LIST_PAGE;
    renderList();
  });

  $('#filter-row').addEventListener('click', (ev) => {
    const b = ev.target.closest('.chip');
    if (!b) return;
    state.filter = b.dataset.filter;
    state.listLimit = LIST_PAGE;
    renderList();
  });

  $('#btn-queue-toggle').addEventListener('click', () => toggleQueuePanel());
  $('#btn-commit-all').addEventListener('click', commitQueue);
  $('#btn-clear-queue').addEventListener('click', clearQueue);

  $('#btn-pending-diff').addEventListener('click', () => {
    const path = currentPath();
    if (path && queueMap().has(path)) showDiff(path);
  });
  $('#btn-pending-drop').addEventListener('click', () => {
    const path = currentPath();
    if (path && queueMap().has(path)) dropQueueItem(path);
  });

  $('#btn-preview').addEventListener('click', () => {
    const { md, title } = buildMarkdown();
    const { body } = splitFrontMatter(md);
    $('#pv-title').textContent = title || '预览';
    $('#pv-body').innerHTML = sanitizeHtml(marked.parse(body));
    openModal('#pv-modal');
    $('#pv-body').scrollTop = 0;
  });

  $('#btn-refresh').addEventListener('click', hardReload);
  $('#btn-update').addEventListener('click', hardReload);

  /* 弹层：关闭按钮 + 点空白 + Esc */
  $('#pv-close').addEventListener('click', () => closeModal('#pv-modal'));
  $('#pv-modal').addEventListener('click', (ev) => { if (ev.target.id === 'pv-modal') closeModal('#pv-modal'); });
  $('#md-close').addEventListener('click', () => closeModal('#md-modal'));
  $('#md-close2').addEventListener('click', () => closeModal('#md-modal'));
  $('#md-modal').addEventListener('click', (ev) => { if (ev.target.id === 'md-modal') closeModal('#md-modal'); });
  $('#diff-close').addEventListener('click', () => closeModal('#diff-modal'));
  $('#diff-modal').addEventListener('click', (ev) => { if (ev.target.id === 'diff-modal') closeModal('#diff-modal'); });

  $('#dlg-ok').addEventListener('click', () => {
    const input = $('#dlg-input');
    closeDialog(input.hidden ? true : input.value);
  });
  $('#dlg-cancel').addEventListener('click', () => closeDialog($('#dlg-input').hidden ? false : null));
  $('#dlg-modal').addEventListener('click', (ev) => { if (ev.target.id === 'dlg-modal') closeDialog($('#dlg-input').hidden ? false : null); });
  $('#dlg-input').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); closeDialog($('#dlg-input').value); }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Escape') return;
    if (!$('#dlg-modal').hidden) { closeDialog($('#dlg-input').hidden ? false : null); return; }
    if (!$('#diff-modal').hidden) { closeModal('#diff-modal'); return; }
    if (!$('#md-modal').hidden) { closeModal('#md-modal'); return; }
    if (!$('#pv-modal').hidden) { closeModal('#pv-modal'); return; }
  });

  $('#md-copy').addEventListener('click', async () => {
    const text = $('#md-text').value;
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      $('#md-text').select();
      document.execCommand('copy');
    }
    toast('已复制');
  });

  $('#btn-import').addEventListener('click', () => {
    $('#md-input').value = '';
    $('#md-input').click();
  });
  $('#md-input').addEventListener('change', (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (f) importMarkdownFile(f);
  });

  editor.addEventListener('input', scheduleDraft);
  ['#in-title', '#in-date', '#in-tags', '#in-salutation'].forEach((s) => {
    $(s).addEventListener('input', scheduleDraft);
  });
  /* 标题改了，地址预览和「加入待提交/更新待提交」跟着变（打字时别每键都算一遍） */
  let chromeTimer = null;
  $('#in-title').addEventListener('input', () => {
    clearTimeout(chromeTimer);
    chromeTimer = setTimeout(updateEditorChrome, 220);
  });
  $('#in-draft').addEventListener('change', scheduleDraft);
  $('#in-pin').addEventListener('change', scheduleDraft);
  $('#in-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); editor.focus(); }
  });

  document.addEventListener('selectionchange', () => {
    if (document.activeElement === editor) rememberRange();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) writeDraft();
    else checkVersion();      /* 从后台切回来时瞄一眼有没有新版本 */
  });
  window.addEventListener('pagehide', writeDraft);

  /* 有没提交的改动时，关标签/刷新先问一句 */
  window.addEventListener('beforeunload', (e) => {
    if (!state.dirty) return;
    writeDraft();
    e.preventDefault();
    e.returnValue = '';
  });

  $('#btn-resume').addEventListener('click', () => resumeDraft(readDraft()));
  $('#btn-drop-draft').addEventListener('click', async () => {
    const ok = await askConfirm({
      title: '丢掉这份草稿？',
      message: '本机存着的那份没写完的改动会被删掉。已经加进「待提交」的不受影响。',
      okText: '丢掉',
      danger: true,
    });
    if (!ok) return;
    clearTimeout(state.timer);
    try { localStorage.removeItem(LS.draft); } catch (e) {}
    /* 光删 localStorage 不够：编辑器里还有内容，pagehide / 输入又会把它写回去 */
    state.current = null;
    state.dirty = false;
    editor.innerHTML = '';
    $('#in-title').value = '';
    $('#in-tags').value = '';
    $('#in-salutation').value = '';
    $('#in-draft').checked = false;
    $('#in-pin').checked = false;
    $('#save-hint').textContent = '';
    showDraftCard();
    toast('草稿已丢掉', 2200);
  });

  renderQueuePanel();
  showDraftCard();

  if (!state.token) { show('setup'); $('#setup-version').textContent = `写稿台版本 ${BUILD}`; checkVersion(); return; }
  show('list');
  loadList();
  checkVersion();

  /* 刷新、误触下拉之后：半小时内的草稿直接接着写，不用再回列表点一次 */
  setTimeout(() => {
    const d = readDraft();
    if (d && d.html && Date.now() - (d.at || 0) < 30 * 60 * 1000) {
      resumeDraft(d);
      toast('接着上次没写完的写', 2600);
    }
  }, 300);
}

function resumeDraft(d) {
  if (!d) return;
  state.current = {
    path: d.path || null, sha: d.sha || null, slug: d.slug || '',
    title: d.title || '', dateIso: '', tags: [], salutation: '', draft: false, pin: !!d.pin,
    markdown: d.markdown || '',
  };
  fillEditor(state.current);
  $('#in-title').value = d.title || '';
  $('#in-date').value = d.date || toDateInput(localIso(new Date()));
  $('#in-tags').value = d.tags || '';
  $('#in-salutation').value = d.salutation || '';
  $('#in-draft').checked = !!d.draft;
  $('#in-pin').checked = !!d.pin;
  editor.innerHTML = d.html || '';
  state.initialHtml = d.initialHtml || '';
  state.dirty = false;
  updateEditorChrome();
  $('#save-hint').textContent = '已恢复上次没写完的草稿';
}

boot();

/* 装成 App：写稿台有自己的 manifest（start_url=/admin/），装到桌面就是全屏、没有地址栏 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
