// utils/store.js
// 本地存储访问层：生词本 / 做题进度 / 作答记录 / 上次阅读位置。
// 统一管理存储 key，页面与组件不得直接读写 wx.Storage。
// 生词本一律以「原形」为 key（见下方 keyOf），因此依赖 utils/dict 做词形还原。
const text = require('./text.js');
const dict = require('./dict.js');

const K_VOCAB = 'vocab';         // 生词本数组
const K_PROGRESS = 'progress';   // { '<pid>': { done, total, correct, ts } }
const K_LAST_PID = 'lastPid';    // 字符串
const K_ANS_PREFIX = 'ans:';     // ans:<pid> -> { '<no>': { pick, submitted } }
const K_WRONGS = 'wrongs';       // 错题本数组（提交判分时缓存的摘要）

/** 掌握度文案：0 生疏 / 1 模糊 / 2 熟悉 */
const LEVELS = ['生疏', '模糊', '熟悉'];

/**
 * 安全读取任意存储项。
 * @param {string} key 存储键
 * @param {*} fallback 读取失败或为空时的兜底值
 * @returns {*} 存储值或兜底值
 */
function safeGet(key, fallback) {
  try {
    const v = wx.getStorageSync(key);
    if (v === '' || v === null || v === undefined) return fallback;
    return v;
  } catch (err) {
    return fallback;
  }
}

/**
 * 安全写入存储项。
 * @param {string} key 存储键
 * @param {*} value 值
 */
function safeSet(key, value) {
  try {
    wx.setStorageSync(key, value);
  } catch (err) {
    // 忽略：写入失败不阻断交互
  }
}

/**
 * 安全删除存储项。
 * @param {string} key 存储键
 */
function safeRemove(key) {
  try {
    wx.removeStorageSync(key);
  } catch (err) {
    // 忽略
  }
}

/* ------------------------------- 生词本 ------------------------------- */

/**
 * 生词本归一化 key：把任意词形还原到「可用原形」（见 dict.lemmaOf）。
 * 所有增删改查都以此为口径，保证 donkeys / donkey's / donkey 只占一条。
 * @param {string} word 任意词形
 * @returns {string} 原形 key；无法处理时返回空串
 */
function keyOf(word) {
  const w = text.normalize(word);
  if (!w) return '';
  const lemma = dict.lemmaOf(w);
  return lemma || w;
}

/**
 * 收集条目的「原文出现词形」（去重，并滤掉等于原形的项）。
 * @param {object} it 存储条目
 * @param {string} lemma 原形 key
 * @returns {string[]} 词形数组
 */
function collectSurfs(it, lemma) {
  const out = [];
  const push = function (x) {
    const n = text.normalize(x);
    if (n && n !== lemma && out.indexOf(n) < 0) out.push(n);
  };
  if (Array.isArray(it.surfs)) it.surfs.forEach(push);
  push(it.surf);
  push(it.surface);
  push(it.w);
  return out;
}

/**
 * 生成条目的「原文出现词形」展示文案（滤掉等于原形的项）。
 * @param {object} item 生词条目
 * @returns {string} 形如 "donkeys / donkey's"；无则空串
 */
function surfTextOf(item) {
  const it = item || {};
  const lemma = text.normalize(it.w);
  const surfs = Array.isArray(it.surfs) ? it.surfs : [];
  const out = [];
  for (let i = 0; i < surfs.length; i++) {
    const n = text.normalize(surfs[i]);
    if (n && n !== lemma && out.indexOf(n) < 0) out.push(n);
  }
  return out.join(' / ');
}

/**
 * 读取生词本（按添加时间倒序）。
 * 读取时按原形去重：旧版按变形词写入的数据会在此自动收拢，既不丢条目也不会报错。
 * @returns {Array<object>} 生词条目数组（w 为原形；surfs 为原文出现词形）
 */
function getVocab() {
  const raw = safeGet(K_VOCAB, []);
  if (!Array.isArray(raw)) return [];
  const out = [];
  const idx = {};
  for (let i = 0; i < raw.length; i++) {
    const it = raw[i];
    if (!it || typeof it.w !== 'string' || !it.w) continue;
    const lemma = keyOf(it.w) || text.normalize(it.w);
    if (!lemma) continue;
    const surfs = collectSurfs(it, lemma);
    const cur = idx[lemma];
    if (cur) {
      for (let s = 0; s < surfs.length; s++) {
        if (cur.surfs.indexOf(surfs[s]) < 0) cur.surfs.push(surfs[s]);
      }
      if (!cur.ph && it.ph) cur.ph = it.ph;
      if (!cur.pos && it.pos) cur.pos = it.pos;
      if (!cur.cn && it.cn) cur.cn = it.cn;
      if (!cur.ctx && it.ctx) cur.ctx = it.ctx;
      if (!cur.ctxZh && it.ctxZh) cur.ctxZh = it.ctxZh;
      cur.count += (typeof it.count === 'number' ? it.count : 1);
      if ((it.ts || 0) > cur.ts) {
        cur.ts = it.ts || 0;
        if (it.src) cur.src = it.src;
        if (it.srcId) cur.srcId = it.srcId;
      }
    } else {
      const item = {
        w: lemma,
        surfs: surfs,
        ph: it.ph || '',
        pos: it.pos || '',
        cn: it.cn || '',
        ctx: it.ctx || '',
        ctxZh: it.ctxZh || '',
        src: it.src || '',
        srcId: it.srcId || '',
        ts: typeof it.ts === 'number' ? it.ts : 0,
        level: typeof it.level === 'number' ? it.level : 0,
        count: typeof it.count === 'number' ? it.count : 1
      };
      idx[lemma] = item;
      out.push(item);
    }
  }
  out.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
  return out;
}

/**
 * 对「按原形匹配」的存储条目逐个执行回调并落库。
 * @param {string} k 原形 key
 * @param {Function} fn 回调 (item, index)
 * @returns {number} 命中条数
 */
function eachByKey(k, fn) {
  if (!k) return 0;
  const list = safeGet(K_VOCAB, []);
  if (!Array.isArray(list)) return 0;
  let hit = 0;
  for (let i = 0; i < list.length; i++) {
    const it = list[i];
    if (!it || typeof it.w !== 'string') continue;
    if (keyOf(it.w) !== k) continue;
    fn(it, i);
    hit += 1;
  }
  if (hit) safeSet(K_VOCAB, list);
  return hit;
}

/**
 * 构建「词 -> 掌握度」映射，用于文章着色。
 * 原形与其在文中出现过的词形都会写入，保证变形词同样着色。
 * @returns {object} 形如 { abandon: 0, abandoned: 0 }
 */
function vocabMap() {
  const map = {};
  const list = getVocab();
  for (let i = 0; i < list.length; i++) {
    const lv = typeof list[i].level === 'number' ? list[i].level : 0;
    const k = keyOf(list[i].w);
    if (k) map[k] = lv;
    const surfs = Array.isArray(list[i].surfs) ? list[i].surfs : [];
    for (let s = 0; s < surfs.length; s++) {
      const n = text.normalize(surfs[s]);
      if (n) map[n] = lv;
    }
  }
  return map;
}

/**
 * 判断某个词是否已在生词本（按原形判定）。
 * @param {string} word 词（任意词形）
 * @returns {boolean} 是否已收录
 */
function hasVocab(word) {
  const k = keyOf(word);
  if (!k) return false;
  const list = getVocab();
  for (let i = 0; i < list.length; i++) {
    if (keyOf(list[i].w) === k) return true;
  }
  return false;
}

/**
 * 添加生词；若已存在则仅累加出现次数 + 刷新时间，不重复插入。
 * @param {object} entry { w, ph, pos, cn, ctx, ctxZh, src, srcId }
 * @returns {{added:boolean, entry:object}} 结果与最终条目
 */
function addVocab(entry) {
  const e = entry || {};
  const norm = String(e.w || '').trim();
  const key = keyOf(norm);
  if (!key) return { added: false, entry: null };
  const list = safeGet(K_VOCAB, []);
  const arr = Array.isArray(list) ? list : [];
  for (let i = 0; i < arr.length; i++) {
    const it = arr[i];
    if (!it || typeof it.w !== 'string') continue;
    if (keyOf(it.w) !== key) continue;
    // 命中同一原形：仅累加词形 + 次数 + 刷新时间，补齐缺口字段，不重复插入。
    const surfs = collectSurfs(it, key);
    if (norm && norm !== key && surfs.indexOf(norm) < 0) surfs.push(norm);
    it.surfs = surfs;
    it.count = (it.count || 1) + 1;
    it.ts = Date.now();
    if (!it.cn && e.cn) it.cn = e.cn;
    if (!it.ph && e.ph) it.ph = e.ph;
    if (!it.pos && e.pos) it.pos = e.pos;
    if (e.src && (!it.src || it.src === '')) it.src = e.src;
    if (e.srcId && (!it.srcId || it.srcId === '')) it.srcId = e.srcId;
    safeSet(K_VOCAB, arr);
    return { added: false, entry: it };
  }
  const item = {
    w: key, // 一律存原形
    surfs: norm && norm !== key ? [norm] : [], // 保留原文出现词形
    ph: e.ph || '',
    pos: e.pos || '',
    cn: e.cn || '',
    ctx: e.ctx || '',
    ctxZh: e.ctxZh || '',
    src: e.src || '',
    srcId: e.srcId || '',
    ts: Date.now(),
    level: typeof e.level === 'number' ? e.level : 0,
    count: 1
  };
  arr.unshift(item);
  safeSet(K_VOCAB, arr);
  return { added: true, entry: item };
}

/**
 * 补全已存在生词的字段（音标/词性/释义），不改变出现次数与添加时间。
 * 用于「先落库保证即时可见，再用词典结果补齐释义」的流程。
 * @param {string} word 词
 * @param {object} info { ph, pos, cn }
 * @returns {boolean} 是否找到并更新
 */
function fillVocab(word, info) {
  const k = keyOf(word);
  if (!k) return false;
  const list = getVocab();
  const o = info || {};
  for (let i = 0; i < list.length; i++) {
    if (keyOf(list[i].w) === k) {
      const it = list[i];
      if (!it.ph && o.ph) it.ph = o.ph;
      if (!it.pos && o.pos) it.pos = o.pos;
      if (!it.cn && o.cn) it.cn = o.cn;
      safeSet(K_VOCAB, list);
      return true;
    }
  }
  return false;
}

/**
 * 删除生词。
 * @param {string} word 词
 * @returns {boolean} 是否删除成功
 */
function removeVocab(word) {
  const k = keyOf(word);
  if (!k) return false;
  const list = getVocab();
  const next = list.filter(function (it) {
    return keyOf(it.w) !== k;
  });
  if (next.length === list.length) return false;
  safeSet(K_VOCAB, next);
  return true;
}

/**
 * 设置生词掌握度。
 * @param {string} word 词
 * @param {number} level 0/1/2
 * @returns {number} 设置后的掌握度；未找到返回 -1
 */
function setVocabLevel(word, level) {
  const k = keyOf(word);
  const lv = Math.max(0, Math.min(2, Number(level) || 0));
  const list = getVocab();
  for (let i = 0; i < list.length; i++) {
    if (keyOf(list[i].w) === k) {
      list[i].level = lv;
      safeSet(K_VOCAB, list);
      return lv;
    }
  }
  return -1;
}

/**
 * 循环切换掌握度：生疏 -> 模糊 -> 熟悉 -> 生疏。
 * @param {string} word 词
 * @returns {number} 切换后的掌握度；未找到返回 -1
 */
function cycleVocabLevel(word) {
  const k = keyOf(word);
  const list = getVocab();
  for (let i = 0; i < list.length; i++) {
    if (keyOf(list[i].w) === k) {
      const cur = typeof list[i].level === 'number' ? list[i].level : 0;
      list[i].level = (cur + 1) % 3;
      safeSet(K_VOCAB, list);
      return list[i].level;
    }
  }
  return -1;
}

/** 清空生词本 */
function clearVocab() {
  safeSet(K_VOCAB, []);
}

/* ------------------------------ 作答记录 ------------------------------ */

/**
 * 读取某篇的作答记录。
 * @param {string} pid 篇目 id
 * @returns {object} 形如 { '21': { pick, submitted } }
 */
function getAnswers(pid) {
  if (!pid) return {};
  const v = safeGet(K_ANS_PREFIX + pid, {});
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

/**
 * 覆盖写入某篇的作答记录。
 * @param {string} pid 篇目 id
 * @param {object} map 作答映射
 */
function saveAnswers(pid, map) {
  if (!pid) return;
  safeSet(K_ANS_PREFIX + pid, map && typeof map === 'object' ? map : {});
}

/**
 * 更新单题作答。
 * @param {string} pid 篇目 id
 * @param {number|string} no 题号
 * @param {object} patch { pick?, submitted? }
 * @returns {object} 更新后的完整作答映射
 */
function setAnswer(pid, no, patch) {
  const map = getAnswers(pid);
  const key = String(no);
  const cur = map[key] || {};
  map[key] = Object.assign({}, cur, patch || {});
  saveAnswers(pid, map);
  return map;
}

/** 清空某篇作答记录 */
function clearAnswers(pid) {
  if (!pid) return;
  safeRemove(K_ANS_PREFIX + pid);
}

/* ------------------------------ 做题进度 ------------------------------ */

/**
 * 读取全部做题进度。
 * @returns {object} 形如 { '<pid>': { done, total, correct, ts } }
 */
function getProgress() {
  const v = safeGet(K_PROGRESS, {});
  return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
}

/**
 * 读取某篇进度。
 * @param {string} pid 篇目 id
 * @returns {object|null} 进度对象或 null
 */
function getProgressOf(pid) {
  if (!pid) return null;
  const all = getProgress();
  return all[pid] || null;
}

/**
 * 覆盖写入某篇进度。
 * @param {string} pid 篇目 id
 * @param {object} obj { done, total, correct }
 */
function setProgress(pid, obj) {
  if (!pid) return;
  const all = getProgress();
  all[pid] = Object.assign({}, all[pid] || {}, obj || {}, { ts: Date.now() });
  safeSet(K_PROGRESS, all);
}

/** 清空全部做题进度与作答记录 */
function clearProgress() {
  const info = getStorageInfoKeys();
  for (let i = 0; i < info.length; i++) {
    if (info[i].indexOf(K_ANS_PREFIX) === 0) safeRemove(info[i]);
  }
  safeRemove(K_PROGRESS);
}

/* ------------------------------ 错题本 ------------------------------ */

/**
 * 读取错题本（新题在前）。
 * @returns {Array<{pid:string,paper:string,paperName:string,year:number,title:string,
 *   no:number,stem:string,pick:number,answer:number,ts:number}>} 错题摘要数组
 */
function getWrongs() {
  const v = safeGet(K_WRONGS, []);
  return Array.isArray(v) ? v : [];
}

/**
 * 记录 / 更新一道错题（同一 pid + no 只保留最新一条）。
 * @param {object} entry 错题摘要
 */
function addWrong(entry) {
  if (!entry || !entry.pid) return;
  const list = getWrongs().filter(function (w) {
    return !(w && w.pid === entry.pid && w.no === entry.no);
  });
  list.unshift(Object.assign({}, entry, { ts: Date.now() }));
  if (list.length > 500) list.length = 500; // 上限保护
  safeSet(K_WRONGS, list);
}

/**
 * 从错题本移除一道题（订正后可调用）。
 * @param {string} pid 篇目 id
 * @param {number|string} no 题号
 */
function removeWrong(pid, no) {
  const list = getWrongs().filter(function (w) {
    return !(w && w.pid === pid && String(w.no) === String(no));
  });
  safeSet(K_WRONGS, list);
}

/** 清空错题本 */
function clearWrongs() {
  safeRemove(K_WRONGS);
}

/**
 * 枚举所有存储 key（失败时返回空数组）。
 * @returns {string[]} key 列表
 */
function getStorageInfoKeys() {
  try {
    const info = wx.getStorageInfoSync();
    return info && Array.isArray(info.keys) ? info.keys : [];
  } catch (err) {
    return [];
  }
}

/* ---------------------------- 上次阅读位置 ---------------------------- */

/**
 * 读取上次阅读的篇目 id。
 * @returns {string} 篇目 id；无记录返回空串
 */
function getLastPid() {
  const v = safeGet(K_LAST_PID, '');
  return typeof v === 'string' ? v : '';
}

/**
 * 记录上次阅读的篇目 id。
 * @param {string} pid 篇目 id
 */
function setLastPid(pid) {
  if (!pid) return;
  safeSet(K_LAST_PID, String(pid));
}

/** 清空上次阅读记录 */
function clearLastPid() {
  safeRemove(K_LAST_PID);
}

/**
 * 一键恢复默认：清空生词本、进度、作答与上次位置。
 */
function clearAll() {
  clearVocab();
  clearProgress();
  clearLastPid();
}

module.exports = {
  LEVELS,
  // 生词本
  keyOf,
  surfTextOf,
  getVocab,
  vocabMap,
  hasVocab,
  addVocab,
  fillVocab,
  removeVocab,
  setVocabLevel,
  cycleVocabLevel,
  clearVocab,
  // 作答
  getAnswers,
  saveAnswers,
  setAnswer,
  clearAnswers,
  // 进度
  getProgress,
  getProgressOf,
  setProgress,
  clearProgress,
  // 错题本
  getWrongs,
  addWrong,
  removeWrong,
  clearWrongs,
  // 其它
  getStorageInfoKeys,
  getLastPid,
  setLastPid,
  clearLastPid,
  clearAll
};
