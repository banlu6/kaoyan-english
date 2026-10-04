// pages/vocab/vocab.js
// 单词本：列表 / 搜索 / 按卷种年份筛选 / 掌握度切换 / 删除 / 导出。
const bank = require('../../utils/bank.js');
const store = require('../../utils/store.js');

/**
 * 从篇目 id 解析卷种与年份。
 * @param {string} srcId 篇目 id，如 'en1-2010-reading-1'
 * @returns {{paper:string, year:number}} 解析结果
 */
function parseSrc(srcId) {
  const m = /^(en\d+)-(\d{4})-/.exec(String(srcId || ''));
  if (!m) return { paper: '', year: 0 };
  return { paper: m[1], year: Number(m[2]) };
}

/**
 * 格式化时间戳为 YYYY-MM-DD。
 * @param {number} ts 时间戳
 * @returns {string} 日期字符串
 */
function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

Page({
  data: {
    all: [],
    list: [],
    keyword: '',
    paperOptions: [{ value: 'all', label: '全部卷种' }],
    paperIndex: 0,
    yearOptions: [{ value: 0, label: '全部年份' }],
    yearIndex: 0,
    // 扁平化当前筛选项文案：WXML 直接绑定，不用 obj[index] 动态取值
    currentPaperLabel: '全部卷种',
    currentYearLabel: '全部年份'
  },

  onShow() {
    this.reload();
  },

  /** 重新读取生词本并构建筛选项。 */
  reload() {
    const raw = store.getVocab();
    const all = raw.map(function (it) {
      const loc = parseSrc(it.srcId);
      const level = typeof it.level === 'number' ? it.level : 0;
      return {
        w: it.w || '',
        ph: it.ph || '',
        pos: it.pos || '',
        cn: it.cn || '未找到释义',
        src: it.src || '',
        srcId: it.srcId || '',
        paper: loc.paper,
        year: loc.year,
        level: level,
        levelLabel: store.LEVELS[level] || '生疏',
        timeLabel: fmtDate(it.ts)
      };
    });

    // 卷种选项（固定两项 + 数据中出现的其它卷种）
    const reg = bank.getRegistry();
    const paperOptions = [{ value: 'all', label: '全部卷种' }];
    (reg.papers || []).forEach(function (p) {
      paperOptions.push({ value: p.id, label: p.name });
    });

    // 年份选项：数据中出现过的年份，倒序
    const yearSet = {};
    all.forEach(function (it) {
      if (it.year) yearSet[it.year] = 1;
    });
    const years = Object.keys(yearSet).map(Number).sort(function (a, b) { return b - a; });
    const yearOptions = [{ value: 0, label: '全部年份' }];
    years.forEach(function (y) {
      yearOptions.push({ value: y, label: String(y) });
    });

    // 保持已选筛选（若仍有效）
    const prevPaper = (this.data.paperOptions[this.data.paperIndex] || {}).value || 'all';
    const prevYear = (this.data.yearOptions[this.data.yearIndex] || {}).value || 0;
    let paperIndex = 0;
    for (let i = 0; i < paperOptions.length; i++) {
      if (paperOptions[i].value === prevPaper) { paperIndex = i; break; }
    }
    let yearIndex = 0;
    for (let i = 0; i < yearOptions.length; i++) {
      if (yearOptions[i].value === prevYear) { yearIndex = i; break; }
    }

    this.setData({
      all: all,
      paperOptions: paperOptions,
      yearOptions: yearOptions,
      paperIndex: paperIndex,
      yearIndex: yearIndex,
      currentPaperLabel: (paperOptions[paperIndex] || {}).label || '全部卷种',
      currentYearLabel: (yearOptions[yearIndex] || {}).label || '全部年份'
    }, () => {
      this.applyFilter();
    });
  },

  /** 应用搜索与筛选。 */
  applyFilter() {
    const kw = String(this.data.keyword || '').trim().toLowerCase();
    const paper = (this.data.paperOptions[this.data.paperIndex] || {}).value || 'all';
    const year = (this.data.yearOptions[this.data.yearIndex] || {}).value || 0;
    const list = this.data.all.filter(function (it) {
      if (paper !== 'all' && it.paper !== paper) return false;
      if (year && it.year !== year) return false;
      if (kw) {
        const hay = (it.w + ' ' + it.cn).toLowerCase();
        if (hay.indexOf(kw) < 0) return false;
      }
      return true;
    });
    this.setData({ list: list });
  },

  /** 搜索输入。 */
  onSearch(e) {
    this.setData({ keyword: e.detail.value }, () => {
      this.applyFilter();
    });
  },

  /** 卷种筛选。 */
  onPaperChange(e) {
    const paperIndex = Number(e.detail.value);
    const opt = this.data.paperOptions[paperIndex] || {};
    this.setData({
      paperIndex: paperIndex,
      currentPaperLabel: opt.label || '全部卷种'
    }, () => {
      this.applyFilter();
    });
  },

  /** 年份筛选。 */
  onYearChange(e) {
    const yearIndex = Number(e.detail.value);
    const opt = this.data.yearOptions[yearIndex] || {};
    this.setData({
      yearIndex: yearIndex,
      currentYearLabel: opt.label || '全部年份'
    }, () => {
      this.applyFilter();
    });
  },

  /** 循环切换掌握度：生疏 -> 模糊 -> 熟悉。 */
  onCycleLevel(e) {
    const w = e.currentTarget.dataset.w;
    if (!w) return;
    const lv = store.cycleVocabLevel(w);
    if (lv < 0) return;
    const all = this.data.all.map(function (it) {
      if (it.w !== w) return it;
      return Object.assign({}, it, { level: lv, levelLabel: store.LEVELS[lv] || '生疏' });
    });
    this.setData({ all: all }, () => {
      this.applyFilter();
    });
  },

  /** 长按删除。 */
  onLongPress(e) {
    this.confirmDelete(e.currentTarget.dataset.w);
  },

  /** 删除按钮。 */
  onDelete(e) {
    this.confirmDelete(e.currentTarget.dataset.w);
  },

  /**
   * 二次确认后删除生词。
   * @param {string} w 单词
   */
  confirmDelete(w) {
    if (!w) return;
    wx.showModal({
      title: '删除生词',
      content: '确定从生词本移除「' + w + '」吗？',
      confirmColor: '#E74C3C',
      success: (r) => {
        if (!r.confirm) return;
        store.removeVocab(w);
        this.reload();
        wx.showToast({ title: '已移除', icon: 'none' });
      }
    });
  },

  /** 导出为文本并复制到剪贴板。 */
  onExport() {
    const list = this.data.list;
    if (!list.length) {
      wx.showToast({ title: '没有可导出的生词', icon: 'none' });
      return;
    }
    const lines = [];
    lines.push('考研英语生词本（共 ' + list.length + ' 个）');
    lines.push('导出时间：' + fmtDate(Date.now()));
    lines.push('--------------------------------');
    list.forEach(function (it, i) {
      const ph = it.ph ? ' /' + it.ph + '/' : '';
      const pos = it.pos ? ' ' + it.pos : '';
      lines.push((i + 1) + '. ' + it.w + ph + pos + ' ' + it.cn);
      if (it.src) lines.push('    来源：' + it.src + ' · ' + it.levelLabel);
    });
    const data = lines.join('\n');
    wx.setClipboardData({
      data: data,
      success: function () {
        wx.showToast({ title: '已复制到剪贴板', icon: 'none' });
      },
      fail: function () {
        wx.showToast({ title: '复制失败', icon: 'none' });
      }
    });
  },

  /** 空态跳首页。 */
  goHome() {
    wx.reLaunch({ url: '/pages/home/home' });
  }
});
