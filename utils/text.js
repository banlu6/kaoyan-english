// utils/text.js
// 文本工具：分词、取句、词形归一化等。
// 说明：小程序 iOS JSCore 对正则 lookbehind 支持不稳定，故断句使用手写扫描，避免踩坑。

const WORD_CHAR = 'A-Za-z';
// 英文单词：字母，允许词内撇号（含弯引号）与连字符
const WORD_SOURCE = '[' + WORD_CHAR + ']+(?:[\'\u2019\\-][' + WORD_CHAR + ']+)*';

/**
 * 转义正则元字符。
 * @param {string} s 原始字符串
 * @returns {string} 转义后的字符串
 */
function escapeRegExp(s) {
  return String(s == null ? '' : s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 把一段英文切成 token 序列。
 * @param {string} paragraph 英文段落
 * @returns {Array<{t:'word'|'text', v:string, k?:string}>} token 数组；
 *          word 类型额外带 k 字段（归一化后的小写形式，用于生词着色查表）
 */
function tokenize(paragraph) {
  const text = paragraph == null ? '' : String(paragraph);
  const out = [];
  if (!text) return out;
  const re = new RegExp(WORD_SOURCE, 'g');
  let last = 0;
  let m = re.exec(text);
  while (m !== null) {
    if (m.index > last) {
      out.push({ t: 'text', v: text.slice(last, m.index) });
    }
    out.push({ t: 'word', v: m[0], k: normalize(m[0]) });
    last = m.index + m[0].length;
    if (re.lastIndex === m.index) re.lastIndex += 1; // 防御空匹配死循环
    m = re.exec(text);
  }
  if (last < text.length) {
    out.push({ t: 'text', v: text.slice(last) });
  }
  return out;
}

/**
 * 词形归一化：小写、统一弯引号、去掉首尾非字母字符。
 * @param {string} word 原始词
 * @returns {string} 归一化结果
 */
function normalize(word) {
  if (word == null) return '';
  let w = String(word).toLowerCase();
  w = w.replace(/[\u2018\u2019\u201B`\u00B4]/g, "'");
  w = w.replace(/^[^a-z]+/, '').replace(/[^a-z]+$/, '');
  return w;
}

/**
 * 轻量词形还原：对常见变形（复数、过去式、进行时、比较级）回溯到词库中存在的原形。
 * @param {string} word 原始词
 * @param {object} dict 词库对象（键为原形）
 * @returns {string|null} 命中的原形；未命中返回 null
 */
function lemmatize(word, dict) {
  const w = normalize(word);
  if (!w) return null;
  const has = function (x) {
    return !!dict && Object.prototype.hasOwnProperty.call(dict, x);
  };
  if (has(w)) return w;

  const cands = [];
  const push = function (x) {
    if (x && x.length >= 2 && cands.indexOf(x) < 0) cands.push(x);
  };

  // 复数 / 第三人称单数
  if (/ies$/.test(w)) push(w.slice(0, -3) + 'y');
  if (/es$/.test(w)) push(w.slice(0, -2));
  if (/s$/.test(w) && !/ss$/.test(w)) push(w.slice(0, -1));
  // 过去式 / 过去分词
  if (/ied$/.test(w)) push(w.slice(0, -3) + 'y');
  if (/ed$/.test(w)) {
    push(w.slice(0, -2));          // used -> us
    push(w.slice(0, -2) + 'e');    // used -> use
    push(w.slice(0, -1));          // e.g. agreed -> agree (agreed -> agree? slice -1 => agree)
  }
  // 进行时
  if (/ing$/.test(w)) {
    const base = w.slice(0, -3);
    push(base);
    push(base + 'e');
    if (base.length > 2 && base[base.length - 1] === base[base.length - 2]) {
      push(base.slice(0, -1));      // running -> run
    }
  }
  // 比较级 / 最高级
  if (/ier$/.test(w)) push(w.slice(0, -3) + 'y');
  if (/iest$/.test(w)) push(w.slice(0, -4) + 'y');
  if (/est$/.test(w)) {
    push(w.slice(0, -3));
    push(w.slice(0, -2));
  }
  if (/er$/.test(w)) {
    push(w.slice(0, -2));
    push(w.slice(0, -1));
  }

  for (let i = 0; i < cands.length; i++) {
    if (has(cands[i])) return cands[i];
  }
  return null;
}

/**
 * 把英文段落切成句子数组。
 * @param {string} text 英文段落
 * @returns {string[]} 句子数组
 */
function splitSentences(text) {
  const s = text == null ? '' : String(text);
  const out = [];
  if (!s) return out;
  const closers = [' ', '\n', '\t', '\r', '"', "'", '\u201D', '\u2019', ')', ']'];
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    buf += ch;
    if (ch === '.' || ch === '!' || ch === '?') {
      const nx = s[i + 1];
      if (nx === undefined || closers.indexOf(nx) >= 0) {
        const t = buf.trim();
        if (t) out.push(t);
        buf = '';
      }
    }
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

/**
 * 把中文译文切成句子数组（用于「逐句对照译文」）。
 * 以 。！？ 及换行断句，标点保留在句尾；不切分逗号/分号，避免中文被切得过碎。
 * @param {string} text 中文文本
 * @returns {string[]} 句子数组
 */
function splitZhSentences(text) {
  const s = text == null ? '' : String(text);
  const out = [];
  if (!s) return out;
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\n' || ch === '\r') {
      const t = buf.trim();
      if (t) out.push(t);
      buf = '';
      continue;
    }
    buf += ch;
    if (ch === '。' || ch === '！' || ch === '？' || ch === '!' || ch === '?') {
      const t = buf.trim();
      if (t) out.push(t);
      buf = '';
    }
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

/**
 * 在整篇文章中查找包含指定词的第一个句子（英文），并返回其所在段落的中文译文。
 * 注意：题库仅提供段落级译文，故中文部分返回该段落译文（作为语境参考）。
 * @param {Array<{n:number,en:string,zh:string}>} paragraphs 段落数组
 * @param {string} word 目标词
 * @returns {{en:string, zh:string, n:number}|null} 例句信息；未找到返回 null
 */
function findSentence(paragraphs, word) {
  const target = normalize(word);
  if (!target) return null;
  const list = Array.isArray(paragraphs) ? paragraphs : [];
  const strict = new RegExp('\\b' + escapeRegExp(target) + '\\b', 'i');
  const loose = new RegExp('\\b' + escapeRegExp(target), 'i');
  for (let i = 0; i < list.length; i++) {
    const p = list[i] || {};
    const en = String(p.en || '');
    if (!en || !loose.test(en)) continue;
    const sents = splitSentences(en);
    for (let j = 0; j < sents.length; j++) {
      if (strict.test(sents[j]) || loose.test(sents[j])) {
        return { en: sents[j], zh: String(p.zh || ''), n: p.n };
      }
    }
  }
  return null;
}

/**
 * 截取文本前 n 个字符作为预览。
 * @param {string} text 原始文本
 * @param {number} n 截断长度
 * @returns {string} 预览文本
 */
function preview(text, n) {
  const s = text == null ? '' : String(text).replace(/\s+/g, ' ').trim();
  const len = n || 20;
  return s.length > len ? s.slice(0, len) + '…' : s;
}

/**
 * 统计一段英文的词数。
 * @param {string} text 英文文本
 * @returns {number} 词数
 */
function wordCount(text) {
  const re = new RegExp(WORD_SOURCE, 'g');
  const m = String(text || '').match(re);
  return m ? m.length : 0;
}

module.exports = {
  WORD_SOURCE,
  escapeRegExp,
  tokenize,
  normalize,
  lemmatize,
  splitSentences,
  splitZhSentences,
  findSentence,
  preview,
  wordCount
};
