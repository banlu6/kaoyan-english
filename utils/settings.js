// utils/settings.js
// 设置读写与默认值管理。所有数值在使用前做区间兜底，保证 UI 不会因脏数据崩溃。
const KEY = 'settings';

/** 设置默认值 */
const DEFAULTS = {
  articleSize: 17,      // 文章字号 14-26
  questionSize: 15,     // 题目字号 12-22
  lineHeight: 1.8,      // 段落行距 1.4-2.2
  showZh: false,        // 显示中文翻译
  showOptZh: false,     // 显示选项中译
  tapMode: true,        // 取词模式（双击取词）
  longPressDict: true,  // 长按看释义
  orientation: 'landscape' // 阅读方向：landscape 横屏精读（默认）/ portrait 竖屏阅读
};

/** 各数值字段的合法区间 */
const RANGES = {
  articleSize: [14, 26],
  questionSize: [12, 22],
  lineHeight: [1.4, 2.2]
};

/**
 * 取数值型设置：缺失 / 空 / 非法时返回该字段默认值，否则夹取到 [lo, hi] 区间内。
 * @param {object} src 原始设置
 * @param {string} key 字段名
 * @param {number} lo 下限
 * @param {number} hi 上限
 * @param {number} dflt 默认值
 * @returns {number} 合法数值
 */
function pickNum(src, key, lo, hi, dflt) {
  const v = src ? src[key] : undefined;
  if (v === undefined || v === null || v === '') return dflt;
  const n = Number(v);
  if (!isFinite(n)) return dflt;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/** 取得默认设置的浅拷贝 */
function getDefaults() {
  return Object.assign({}, DEFAULTS);
}

/**
 * 规范化一份设置对象：补齐缺失字段并做数值/布尔兜底。
 * @param {object} raw 原始设置
 * @returns {object} 规范化后的设置
 */
function normalize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = getDefaults();
  out.articleSize = pickNum(src, 'articleSize', RANGES.articleSize[0], RANGES.articleSize[1], DEFAULTS.articleSize);
  out.questionSize = pickNum(src, 'questionSize', RANGES.questionSize[0], RANGES.questionSize[1], DEFAULTS.questionSize);
  out.lineHeight = pickNum(src, 'lineHeight', RANGES.lineHeight[0], RANGES.lineHeight[1], DEFAULTS.lineHeight);
  out.showZh = !!src.showZh;
  out.showOptZh = !!src.showOptZh;
  out.tapMode = src.tapMode === undefined ? DEFAULTS.tapMode : !!src.tapMode;
  out.longPressDict = src.longPressDict === undefined ? DEFAULTS.longPressDict : !!src.longPressDict;
  // 阅读方向：仅允许 'portrait'，其余一律归为 'landscape'（白名单兜底）
  out.orientation = (src.orientation === 'portrait') ? 'portrait' : 'landscape';
  return out;
}

/**
 * 读取设置（永抛错）。仅访问本地存储，不依赖 getApp。
 * @returns {object} 规范化后的设置
 */
function get() {
  let raw = null;
  try {
    raw = wx.getStorageSync(KEY);
  } catch (err) {
    raw = null;
  }
  return normalize(raw);
}

/**
 * 合并写入设置，并同步到 globalData 供其它页面即时读取。
 * @param {object} patch 需要更新的字段
 * @returns {object} 更新后的完整设置
 */
function set(patch) {
  const next = normalize(Object.assign({}, get(), patch || {}));
  try {
    wx.setStorageSync(KEY, next);
  } catch (err) {
    // 忽略：存储写入失败不影响当前会话使用
  }
  try {
    const app = getApp();
    if (app && app.globalData) app.globalData.settings = next;
  } catch (err) {
    // 忽略：应用未就绪时静默跳过
  }
  return next;
}

/**
 * 恢复默认设置。
 * @returns {object} 默认设置
 */
function reset() {
  try {
    wx.setStorageSync(KEY, getDefaults());
  } catch (err) {
    // 忽略
  }
  const d = getDefaults();
  try {
    const app = getApp();
    if (app && app.globalData) app.globalData.settings = d;
  } catch (err) {
    // 忽略
  }
  return d;
}

module.exports = { KEY, DEFAULTS, RANGES, get, getDefaults, set, reset, normalize };
