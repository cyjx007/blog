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
const state = { token: '', imgAuth: '', posts: [], current: null, savedRange: null, timer: null, dirty: false };

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
  return n;
}

function looksLikeMarkdown(s) {
  return /^#{1,6}\s/m.test(s) || /^\s*[-*+]\s+/m.test(s) || /^\s*\d+\.\s+/m.test(s) ||
    /^\s*>\s/m.test(s) || /```/.test(s) || /\*\*[^*]+\*\*/.test(s);
}

function textToHtml(text) {
  return String(text).split(/\r?\n\s*\r?\n/).map((para) => {
    const esc = para.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return '<p>' + esc.replace(/\r?\n/g, '<br>') + '</p>';
  }).join('');
}

/* 一段文本 → 编辑器 HTML：像 Markdown 就渲染，否则按空行分段 */
function textToEditorHtml(text) {
  return looksLikeMarkdown(text) ? sanitizeHtml(marked.parse(text)) : textToHtml(text);
}

/* 贴进来的 HTML（包括 marked 渲染结果）都过一遍：去掉脚本和内联事件 */
function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,iframe,meta,link,object,embed').forEach((n) => n.remove());
  doc.querySelectorAll('*').forEach((n) => {
    Array.from(n.attributes).forEach((a) => {
      if (/^on/i.test(a.name)) n.removeAttribute(a.name);
      else if ((a.name === 'href' || a.name === 'src') && /^javascript:/i.test(a.value)) n.removeAttribute(a.name);
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
    state.dirty = false;
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
    else if (mark === '>' ) block('blockquote');
    else if (mark === '```') insertCode();
    else if (mark === '1.') document.execCommand('insertOrderedList');
    else document.execCommand('insertUnorderedList');
    syncFormatButtons();
  });
}

/* ── 光标在哪，工具栏就亮哪个 ── */
function syncFormatButtons() {
  const btns = Array.from(document.querySelectorAll('#toolbar button[data-cmd]'));
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
    if (filled) toast(`认出了 ${filled} 个字段（标题/日期/标签…）`, 2600);
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
    $('#md-text').value = md;
    $('#md-modal').hidden = false;
  });
  const closeMd = () => { $('#md-modal').hidden = true; };
  ['#md-close', '#md-close2'].forEach((s) => $(s).addEventListener('click', closeMd));
  $('#md-modal').addEventListener('click', (ev) => { if (ev.target.id === 'md-modal') closeMd(); });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !$('#md-modal').hidden) closeMd();
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

  /* 有没提交的改动时，关标签/刷新先问一句 */
  window.addEventListener('beforeunload', (e) => {
    if (!state.dirty) return;
    writeDraft();
    e.preventDefault();
    e.returnValue = '';
  });

  $('#btn-resume').addEventListener('click', () => resumeDraft(readDraft()));
  $('#btn-drop-draft').addEventListener('click', () => {
    if (!confirm('丢掉这份草稿？')) return;
    clearTimeout(state.timer);
    localStorage.removeItem(LS.draft);
    /* 光删 localStorage 不够：编辑器里还有内容，pagehide / 输入又会把它写回去 */
    state.current = null;
    state.dirty = false;
    editor.innerHTML = '';
    $('#in-title').value = '';
    $('#in-tags').value = '';
    $('#in-salutation').value = '';
    $('#in-draft').checked = false;
    $('#save-hint').textContent = '';
    showDraftCard();
    toast('草稿已丢掉', 2200);
  });

  showDraftCard();

  if (!state.token) { show('setup'); return; }
  show('list');
  loadList();

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
    title: d.title || '', dateIso: '', tags: [], salutation: '', draft: false, markdown: '',
  };
  fillEditor(state.current);
  $('#in-title').value = d.title || '';
  $('#in-date').value = d.date || toDateInput(localIso(new Date()));
  $('#in-tags').value = d.tags || '';
  $('#in-salutation').value = d.salutation || '';
  $('#in-draft').checked = !!d.draft;
  editor.innerHTML = d.html || '';
  state.dirty = false;
  $('#save-hint').textContent = '已恢复上次没写完的草稿';
}

boot();

/* 装成 App：写稿台有自己的 manifest（start_url=/admin/），装到桌面就是全屏、没有地址栏 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
