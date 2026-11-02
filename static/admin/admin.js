/* 写信的桌子 —— 一个不需要懂 Markdown 的写稿页
   数据：GitHub Contents API（直接提交 .md）
   图片：直传 img.tanghuang.dpdns.org
   草稿：localStorage，每 700ms 自动存一次，刷新不丢 */
'use strict';

const CFG = {
  owner: 'cyjx007',
  repo: 'blog',
  branch: 'main',
  dir: 'content/posts',
  imgEndpoint: 'https://img.tanghuang.dpdns.org/upload',
  siteBase: 'https://blog.tanghuang.dpdns.org/posts/',
};

const LS = { token: 'desk.token', img: 'desk.imgauth', draft: 'desk.draft' };

const $ = (s) => document.querySelector(s);
const editor = $('#editor');
const state = { token: '', imgAuth: '', posts: [], current: null, savedRange: null, timer: null };

/* ── 小工具 ───────────────────────────────────────────── */
let toastTimer = null;
function toast(msg, ms = 2400) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
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

/* ── GitHub ───────────────────────────────────────────── */
async function gh(pathname, opts = {}) {
  const res = await fetch(`https://api.github.com/repos/${CFG.owner}/${CFG.repo}${pathname}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${state.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) {
    const text = (await res.text()).slice(0, 200);
    if (res.status === 401) throw new Error('令牌无效，或者没有这个仓库的权限');
    if (res.status === 403) throw new Error('令牌权限不够（需要 Contents: Read and write）');
    if (res.status === 404) throw new Error('找不到（仓库名或路径不对）');
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
    renderList();
  } catch (e) {
    hint.textContent = e.message;
  }
}

function renderList() {
  const ul = $('#post-list');
  ul.innerHTML = '';
  state.posts.forEach((item) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = item.name.replace(/\.md$/, '');
    a.addEventListener('click', (ev) => { ev.preventDefault(); openPost(item); });
    li.appendChild(a);
    ul.appendChild(li);
  });
}

/* ── 草稿（本机） ─────────────────────────────────────── */
function readDraft() {
  try { return JSON.parse(localStorage.getItem(LS.draft) || 'null'); } catch (e) { return null; }
}

function showDraftCard() {
  const d = readDraft();
  const card = $('#draft-card');
  if (!d || !d.html) { card.hidden = true; return; }
  $('#draft-title').textContent = d.title || '（没标题）';
  card.hidden = false;
}

function writeDraft() {
  if (!state.current) return;
  const d = {
    title: $('#in-title').value,
    date: $('#in-date').value,
    tags: $('#in-tags').value,
    salutation: $('#in-salutation').value,
    draft: $('#in-draft').checked,
    html: editor.innerHTML,
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
  clearTimeout(state.timer);
  state.timer = setTimeout(writeDraft, 700);
}

/* ── 编辑器 ───────────────────────────────────────────── */
function fillEditor(post) {
  $('#in-title').value = post.title || '';
  $('#in-date').value = toDateInput(post.dateIso) || toDateInput(localIso(new Date()));
  $('#in-tags').value = (post.tags || []).join(', ');
  $('#in-salutation').value = post.salutation || '';
  $('#in-draft').checked = !!post.draft;
  $('#slug-line').textContent = post.slug ? `地址：${CFG.siteBase}${post.slug}/` : '地址按标题自动生成';
  $('#btn-delete').hidden = !post.sha;
  $('#editor-status').textContent = post.sha ? '改一封旧信' : '新的一封';
  $('#save-hint').textContent = '';
  editor.innerHTML = post.markdown ? marked.parse(post.markdown) : '';
  state.initialHtml = editor.innerHTML;
  show('editor');
  if (!post.title) $('#in-title').focus();
}

function newPost() {
  state.current = {
    path: null, sha: null, slug: '', title: '', dateIso: localIso(new Date()),
    tags: [], salutation: '', draft: false, markdown: '',
  };
  fillEditor(state.current);
}

async function openPost(item) {
  try {
    toast('打开中…', 800);
    const data = await gh(`/contents/${encodeURI(item.path)}?ref=${CFG.branch}`);
    const text = fromB64(data.content);
    const { fm, body } = parseFront(text);
    state.current = {
      path: data.path,
      sha: data.sha,
      slug: fm.slug || item.name.replace(/\.md$/, ''),
      title: fm.title || '',
      dateIso: fm.date || '',
      tags: tagsFromYaml(fm.tags),
      salutation: fm.salutation || '',
      draft: fm.draft === 'true',
      markdown: body,
    };
    fillEditor(state.current);
  } catch (e) {
    toast(e.message);
  }
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
  const slug = state.current.slug || slugify(title);

  // 正文没动过就原样保留（避免 Markdown → HTML → Markdown 把老文章重排）
  const untouched = state.current.markdown && editor.innerHTML === state.initialHtml;
  const body = untouched
    ? state.current.markdown.trim()
    : turndownService.turndown(editor.innerHTML)
        .replace(/^(\s*)-   /gm, '$1- ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

  const lines = ['---', `title: "${esc(title)}"`, `date: ${dateIso}`, `draft: ${draft}`, `slug: "${esc(slug)}"`];
  if (salutation) lines.push(`salutation: "${esc(salutation)}"`);
  lines.push(`tags: ${JSON.stringify(tags)}`, 'categories: []', '---', '');
  return { md: lines.join('\n') + '\n' + body + '\n', title, slug, tags, dateIso, draft };
}

async function save() {
  if (!state.token) { show('setup'); return; }
  const built = buildMarkdown();
  if (!built.title) { toast('先给这封信起个名字'); $('#in-title').focus(); return; }

  const btn = $('#btn-save');
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
      if (!/GitHub 409/.test(e.message)) throw e;
      /* 远端被改过（多半是刚从电脑上发过一封）：问一句再覆盖，别让人白写 */
      let cur = null;
      try { cur = await gh(`/contents/${encodeURI(path)}`); } catch (e2) { cur = null; }
      if (!cur || !cur.sha) throw e;
      if (!confirm('这封在别处改过了（远端版本更新）。用你现在写的覆盖它吗？')) {
        throw new Error('没覆盖。先把正文复制出来，再刷新重写。');
      }
      body.sha = cur.sha;
      res = await gh(`/contents/${encodeURI(path)}`, { method: 'PUT', body: JSON.stringify(body) });
    }

    state.current.sha = res.content.sha;
    state.current.path = res.content.path;
    state.current.slug = built.slug;
    localStorage.removeItem(LS.draft);
    showDraftCard();
    toast(built.draft ? '已存成草稿（不会上线）' : '已提交，一分钟左右上线');
    $('#save-hint').textContent = `上次提交：${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    $('#btn-delete').hidden = false;
    $('#editor-status').textContent = '改一封旧信';
  } catch (e) {
    toast(e.message, 4200);
  } finally {
    btn.disabled = false;
    btn.textContent = '保存';
  }
}

async function removePost() {
  if (!state.current || !state.current.sha) return;
  if (!confirm('删掉这封信？会从仓库里删掉这个文件。')) return;
  try {
    await gh(`/contents/${encodeURI(state.current.path)}`, {
      method: 'DELETE',
      body: JSON.stringify({ message: `delete: ${state.current.title}`, sha: state.current.sha, branch: CFG.branch }),
    });
    toast('已删除');
    localStorage.removeItem(LS.draft);
    state.current = null;
    show('list');
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

function insertHtml(html) {
  editor.focus();
  const sel = window.getSelection();
  if (state.savedRange && editor.contains(state.savedRange.commonAncestorContainer)) {
    sel.removeAllRanges();
    sel.addRange(state.savedRange);
  }
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

function insertLink() {
  const url = prompt('链接地址（https://…）', 'https://');
  if (!url) return;
  const sel = window.getSelection();
  if (sel && sel.toString()) {
    document.execCommand('createLink', false, url);
  } else {
    insertHtml(`<a href="${url.replace(/"/g, '&quot;')}">${url}</a>`);
  }
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
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
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
    insertHtml(`<img src="${url}" alt="${(file.name || 'image').replace(/"/g, '')}">`);
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
  });

  $('#file-input').addEventListener('change', (ev) => {
    handleFile(ev.target.files[0]);
  });

  editor.addEventListener('paste', (ev) => {
    const files = ev.clipboardData && ev.clipboardData.files;
    if (files && files.length && /^image\//.test(files[0].type)) {
      ev.preventDefault();
      handleFile(files[0]);
      return;
    }
    const html = ev.clipboardData && ev.clipboardData.getData('text/html');
    if (html) {
      ev.preventDefault();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      doc.querySelectorAll('script,style,iframe,meta,link,object,embed').forEach((n) => n.remove());
      doc.querySelectorAll('*').forEach((n) => {
        Array.from(n.attributes).forEach((a) => {
          if (/^on/i.test(a.name) || (a.name === 'href' && /^javascript:/i.test(a.value))) n.removeAttribute(a.name);
        });
      });
      document.execCommand('insertHTML', false, doc.body.innerHTML);
    }
  });
}

/* ── 启动 ─────────────────────────────────────────────── */
function boot() {
  state.token = localStorage.getItem(LS.token) || '';
  state.imgAuth = localStorage.getItem(LS.img) || 'tanghuang';

  initSetup();
  bindToolbar();

  $('#btn-new').addEventListener('click', newPost);
  $('#btn-settings').addEventListener('click', () => {
    $('#in-token').value = state.token;
    $('#in-imgauth').value = state.imgAuth;
    show('setup');
  });
  $('#btn-back').addEventListener('click', () => {
    show('list');
    if (state.token) loadList();
    showDraftCard();
  });
  $('#btn-save').addEventListener('click', save);
  $('#btn-delete').addEventListener('click', removePost);
  $('#btn-source').addEventListener('click', () => {
    const { md } = buildMarkdown();
    const box = prompt('Markdown 原文（只读，想改就直接改正文）', md);
    if (box && box !== md) {
      const back = turndownService.turndown(marked.parse(box));
      editor.innerHTML = marked.parse(back);
    }
  });

  editor.addEventListener('input', scheduleDraft);
  ['#in-title', '#in-date', '#in-tags', '#in-salutation'].forEach((s) => {
    $(s).addEventListener('input', scheduleDraft);
  });
  $('#in-draft').addEventListener('change', scheduleDraft);
  $('#in-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); editor.focus(); }
  });

  document.addEventListener('selectionchange', () => {
    if (document.activeElement === editor) rememberRange();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) writeDraft();
  });
  window.addEventListener('pagehide', writeDraft);

  $('#btn-resume').addEventListener('click', () => {
    const d = readDraft();
    if (!d) return;
    state.current = {
      path: d.path || null, sha: d.sha || null, slug: d.slug || '',
      title: d.title || '', dateIso: '', tags: [], salutation: '', draft: false, markdown: '',
    };
    fillEditor(state.current);
    $('#in-title').value = d.title || '';
    $('#in-date').value = d.date || toDateInput(localIso(new Date()));
    $('#in-tags').value = d.tags || '';
    $('#in-salutation').value = d.salutation || '';
    $('#in-draft').checked = !!d.draft;
    editor.innerHTML = d.html || '';
    $('#save-hint').textContent = '已恢复上次没写完的草稿';
  });
  $('#btn-drop-draft').addEventListener('click', () => {
    if (!confirm('丢掉这份草稿？')) return;
    localStorage.removeItem(LS.draft);
    showDraftCard();
  });

  showDraftCard();

  if (!state.token) { show('setup'); return; }
  show('list');
  loadList();
}

boot();
