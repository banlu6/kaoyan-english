// utils/bank.js
// 题库访问层：页面与组件访问题库的唯一入口。
// 设计要点：主包无法 require 分包文件，分包薄页面在 onLoad 时把题库对象挂到
//           app.globalData.bank[paper]；这里负责读取，避免用 setData/property 传大数据。

const registry = require('../data/registry.js');

/**
 * 安全获取 App 实例（组件/页面生命周期极早期可能取不到）。
 * @returns {object|null} App 实例或 null
 */
function appRef() {
  try {
    return getApp();
  } catch (err) {
    return null;
  }
}

/**
 * 获取题库目录索引（静态数据，直接来自 data/registry.js）。
 * @returns {{papers:Array}} 目录索引
 */
function getRegistry() {
  return registry || { papers: [] };
}

/**
 * 挂载某卷种的题库映射（由分包薄页面调用）。
 * @param {string} paper 卷种 id，如 'en1'
 * @param {object} map 形如 { '<pid>': passage }
 */
function setBank(paper, map) {
  const app = appRef();
  if (!app || !paper || !map) return;
  if (!app.globalData.bank) app.globalData.bank = {};
  app.globalData.bank[paper] = map;
}

/**
 * 读取一篇真题数据。
 * @param {string} paper 卷种 id
 * @param {string} pid 篇目 id
 * @returns {object|null} 篇目数据或 null
 */
function getPassage(paper, pid) {
  const app = appRef();
  if (!app || !app.globalData || !app.globalData.bank) return null;
  const bucket = app.globalData.bank[paper];
  if (!bucket || !pid) return null;
  return bucket[pid] || null;
}

/**
 * 在目录索引中定位某篇目，返回其归属卷种与年份。
 * @param {string} pid 篇目 id
 * @returns {{paper:string, paperName:string, year:number, passage:object}|null} 定位结果
 */
function findLocation(pid) {
  if (!pid) return null;
  const reg = getRegistry();
  const papers = Array.isArray(reg.papers) ? reg.papers : [];
  for (let i = 0; i < papers.length; i++) {
    const p = papers[i] || {};
    const years = Array.isArray(p.years) ? p.years : [];
    for (let j = 0; j < years.length; j++) {
      const y = years[j] || {};
      const list = Array.isArray(y.passages) ? y.passages : [];
      for (let k = 0; k < list.length; k++) {
        if (list[k] && list[k].id === pid) {
          return { paper: p.id, paperName: p.name, year: y.year, passage: list[k] };
        }
      }
    }
  }
  return null;
}

/**
 * 读取篇目的目录元信息（题数等），用于首页展示。
 * @param {string} pid 篇目 id
 * @returns {object|null} 元信息或 null
 */
function findMeta(pid) {
  const loc = findLocation(pid);
  return loc ? loc.passage : null;
}

/**
 * 判断篇目 id 属于哪个卷种（用于“继续上次”跳转）。
 * @param {string} pid 篇目 id
 * @returns {string} 卷种 id；未知返回空串
 */
function paperOf(pid) {
  const loc = findLocation(pid);
  return loc ? loc.paper : '';
}

module.exports = {
  getRegistry,
  setBank,
  getPassage,
  findLocation,
  findMeta,
  paperOf
};
