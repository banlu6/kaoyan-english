// utils/dict.js
// 词典查询：查本地离线词库 data/dict.js（ECDICT 派生，约十万词，无需联网）。
// 真实词库结构：{ "<原形>": { p: 音标, t: 词性, c: 中文释义 } }
// 另有 data/forms.js：{ "<变形>": "<原形或标记>" }。两个文件都可能缺失，故 require 全部 try/catch。

const text = require('./text.js');

let LOCAL = {};
try {
  LOCAL = require('../data/dict.js');
} catch (err) {
  LOCAL = {};
}
if (!LOCAL || typeof LOCAL !== 'object') LOCAL = {};

let FORMS = {};
try {
  FORMS = require('../data/forms.js');
} catch (err) {
  FORMS = {};
}
if (!FORMS || typeof FORMS !== 'object') FORMS = {};

// 合法的“原形”形态：至少 3 个字母，允许词内撇号与连字符。
// forms.js 中混入了 's' / 'dp' / 'pd' 之类的短标记，用此规则过滤，避免把标记当成原形。
const LEMMA_RE = /^[a-z][a-z'\u2019-]{2,}$/;

/**
 * 本地词库条目数。
 * @returns {number} 词条数量
 */
function localSize() {
  return Object.keys(LOCAL).length;
}

/**
 * 读取词库条目（兼容 p/t/c 与 ph/pos/cn 两种键名）。
 * @param {string} key 原形
 * @returns {{ph:string, pos:string, cn:string}|null} 条目或 null
 */
function entryOf(key) {
  if (!key || !Object.prototype.hasOwnProperty.call(LOCAL, key)) return null;
  const e = LOCAL[key] || {};
  return {
    ph: e.p || e.ph || '',
    pos: e.t || e.pos || '',
    cn: e.c || e.cn || ''
  };
}

/**
 * 词形还原到「可用原形」。
 * 口径（生词本 key 与释义卡原形标注共用，保证两条路径一致）：
 *   1) 先去掉所有格后缀：donkey's -> donkey；
 *   2) 优先 forms.js 的显式映射（最可信）；
 *   3) 其次后缀规则回溯；
 *   4) **只接受词库中确实有条目的原形**，保证音标/释义一定可用；
 *   5) 都得不到时退回（去掉所有格后的）原词形。
 * @param {string} word 任意词形
 * @returns {string} 原形；找不到可用原形时返回归一化后的词
 */
function lemmaOf(word) {
  let w = text.normalize(word);
  if (!w) return '';
  const stripped = w.replace(/'s$/, '').replace(/'$/, '');
  const stems = [w];
  if (stripped && stripped !== w) stems.push(stripped);
  for (let si = 0; si < stems.length; si++) {
    const s = stems[si];
    const cands = [];
    const f = FORMS[s];
    if (typeof f === 'string' && f !== s && LEMMA_RE.test(f)) cands.push(f);
    const rule = text.lemmatize(s, LOCAL);
    if (rule && rule !== s && cands.indexOf(rule) < 0) cands.push(rule);
    for (let i = 0; i < cands.length; i++) {
      if (entryOf(cands[i])) return cands[i];
    }
    if (si > 0) return s;
  }
  return w;
}

/**
 * 求某词的查询基形与「原形标注」。
 * 与原词不同且确实可查时返回原形，否则标注为空串。
 * @param {string} word 归一化后的词
 * @returns {{base:string, lemma:string}} base: 查词用；lemma: 若与原词不同则为原形，否则空串
 */
function resolveBase(word) {
  const w = text.normalize(word) || String(word == null ? '' : word);
  if (!w) return { base: '', lemma: '' };
  const lem = lemmaOf(w);
  if (lem && lem !== w && entryOf(lem)) return { base: lem, lemma: lem };
  return { base: w, lemma: '' };
}

/**
 * 查询一个词（纯本地词库，无网络请求）。
 * @param {string} word 词
 * @returns {Promise<{w:string, ph:string, pos:string, cn:string, lemma:string, from:string}>}
 *          from: 'local' 本地命中 | 'none' 未收录
 */
function query(word) {
  const raw = String(word == null ? '' : word).trim();
  const k = text.normalize(raw) || raw;
  const r = resolveBase(k);
  const hit = entryOf(r.base);
  if (hit) {
    return Promise.resolve({
      w: k,
      ph: hit.ph,
      pos: hit.pos,
      cn: hit.cn,
      lemma: r.lemma && r.lemma !== k ? r.lemma : '',
      from: 'local'
    });
  }
  return Promise.resolve({ w: k, ph: '', pos: '', cn: '本地词库未收录该词', lemma: '', from: 'none' });
}

module.exports = {
  query,
  resolveBase,
  lemmaOf,
  entryOf,
  localSize,
  formsSize: function () { return Object.keys(FORMS).length; },
  hasLocal: localSize() > 0
};
