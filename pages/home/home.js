// pages/home/home.js
// 首页：卷种/年份/篇目选择 + 单词本/设置入口 + 继续上次。
const bank = require('../../utils/bank.js');
const store = require('../../utils/store.js');

const KIND_ORDER = ['reading', 'cloze'];
const KIND_LABEL = { reading: '阅读理解', cloze: '完形填空' };
const PAPER_ROOT = { en1: 'packageEn1', en2: 'packageEn2' };
// 四六级：一个卷种(cet6/cet4)按年份拆 2 分包绕过单包 2MB，进入时按 pid 年份路由。
const CET_SPLIT_YEAR = 2021;
function resolveRoot(pid, paper) {
  const m = /^(cet[46])-(\d{4})-/.exec(pid || '');
  if (m) {
    const exam = m[1], year = +m[2];
    return 'package' + exam.charAt(0).toUpperCase() + exam.slice(1)
      + (year >= CET_SPLIT_YEAR ? 'Recent' : 'Vintage'); // cet6Recent / cet6Vintage ...
  }
  return PAPER_ROOT[paper] || 'packageEn1';
}

Page({
  data: {
    papers: [],
    activePaper: 'en1',
    paperName: '',
    years: [],
    expandedYear: 0,
    groups: [],
    lastPid: '',
    lastLabel: '',
    vocabCount: 0,
    totalDone: 0,
    totalCount: 0,
    showContact: false,
    showGuide: false,
    // 联系方式：首页「联系作者 / 提建议」弹窗展示，点击可复制
    contactEmail: 'banlu6@qq.com',
    // 免责声明：首次启动强制阅读，倒计时结束才能点「同意」，确认后不再出现
    showDisclaimer: false,
    agreeReady: false,
    agreeCountdown: 3
  },

  onLoad() {
    this.init();
    // 首次启动先弹免责声明；同意后再按需弹使用教程
    let agreed = false;
    try { agreed = !!wx.getStorageSync('disclaimerAgreed'); } catch (err) { agreed = false; }
    if (!agreed) {
      this.openDisclaimer();
      return;
    }
    this.maybeShowGuide();
  },

  onUnload() {
    if (this._agreeTimer) { clearInterval(this._agreeTimer); this._agreeTimer = null; }
  },

  /** 打开免责声明弹窗并启动 3 秒强制阅读倒计时。 */
  openDisclaimer() {
    this.setData({ showDisclaimer: true, agreeReady: false, agreeCountdown: 3 });
    if (this._agreeTimer) clearInterval(this._agreeTimer);
    this._agreeTimer = setInterval(() => {
      const left = this.data.agreeCountdown - 1;
      if (left <= 0) {
        clearInterval(this._agreeTimer); this._agreeTimer = null;
        this.setData({ agreeCountdown: 0, agreeReady: true });
      } else {
        this.setData({ agreeCountdown: left });
      }
    }, 1000);
  },

  /** 同意免责声明：落库、关闭，然后继续首次教程引导。遮罩点击不关闭（无 handler）。 */
  agreeDisclaimer() {
    if (!this.data.agreeReady) return;
    try { wx.setStorageSync('disclaimerAgreed', true); } catch (err) { /* 忽略 */ }
    this.setData({ showDisclaimer: false });
    this.maybeShowGuide();
  },

  /** 吞掉弹窗内点击，避免冒泡到遮罩。 */
  onDisclaimerNoop() {},

  /** 首次使用自动弹一次使用教程；之后从「使用教程」入口进入。 */
  maybeShowGuide() {
    let seen = false;
    try { seen = !!wx.getStorageSync('guideSeen'); } catch (err) { seen = false; }
    if (!seen) {
      this.setData({ showGuide: true });
      try { wx.setStorageSync('guideSeen', true); } catch (err) { /* 忽略 */ }
    }
  },

  onShow() {
    const active = this.data.activePaper || 'en1';
    this.renderYears(active);
    const y = this.data.expandedYear;
    if (y) this.buildGroups(active, y);
    this.refreshStats();
    this.refreshLast();
  },

  /** 初始化卷种列表与默认卷种年份。 */
  init() {
    const reg = bank.getRegistry();
    const papers = (reg.papers || []).map(function (p) {
      return { id: p.id, name: p.name };
    });
    const active = papers.length ? papers[0].id : 'en1';
    this.setData({ papers: papers, activePaper: active });
    this.renderYears(active);
    this.refreshStats();
    this.refreshLast();
  },

  /**
   * 渲染某卷种的年份列表（按年份倒序，统计每年已做篇数）。
   * @param {string} paperId 卷种 id
   */
  renderYears(paperId) {
    const reg = bank.getRegistry();
    const papers = reg.papers || [];
    let paper = null;
    for (let i = 0; i < papers.length; i++) {
      if (papers[i].id === paperId) { paper = papers[i]; break; }
    }
    if (!paper) {
      this.setData({ years: [], paperName: '' });
      return;
    }
    const progress = store.getProgress();
    const years = (paper.years || []).slice().sort(function (a, b) {
      return b.year - a.year;
    }).map(function (y) {
      const list = y.passages || [];
      let doneCount = 0;
      for (let i = 0; i < list.length; i++) {
        const pr = progress[list[i].id];
        if (pr && pr.done) doneCount += 1;
      }
      return { year: y.year, count: list.length, doneCount: doneCount };
    });
    this.setData({ years: years, paperName: paper.name, activePaper: paperId });
  },

  /**
   * 构建某年篇目分组（按题型）。
   * @param {string} paperId 卷种 id
   * @param {number} year 年份
   */
  buildGroups(paperId, year) {
    const reg = bank.getRegistry();
    const papers = reg.papers || [];
    let paper = null;
    for (let i = 0; i < papers.length; i++) {
      if (papers[i].id === paperId) { paper = papers[i]; break; }
    }
    if (!paper) return;
    let y = null;
    const ys = paper.years || [];
    for (let i = 0; i < ys.length; i++) {
      if (ys[i].year === year) { y = ys[i]; break; }
    }
    if (!y) return;

    const progress = store.getProgress();
    const list = y.passages || [];
    const groups = [];

    const pushGroup = function (kind, label) {
      const items = list.filter(function (ps) {
        return ps.kind === kind;
      }).map(function (ps) {
        const pr = progress[ps.id] || null;
        return {
          id: ps.id,
          title: ps.title,
          qcount: ps.qcount,
          done: !!(pr && pr.done),
          started: !!(pr && !pr.done),
          correct: pr ? pr.correct : 0,
          total: pr && pr.total ? pr.total : (ps.qcount || 0)
        };
      });
      if (items.length) groups.push({ kind: kind, label: label, items: items });
    };

    for (let i = 0; i < KIND_ORDER.length; i++) {
      pushGroup(KIND_ORDER[i], KIND_LABEL[KIND_ORDER[i]] || KIND_ORDER[i]);
    }
    // 兜底：数据中出现但未登记的题型
    const extra = [];
    list.forEach(function (ps) {
      if (KIND_ORDER.indexOf(ps.kind) < 0 && extra.indexOf(ps.kind) < 0) extra.push(ps.kind);
    });
    for (let i = 0; i < extra.length; i++) pushGroup(extra[i], extra[i]);

    this.setData({ expandedYear: year, groups: groups });
  },

  /** 刷新整体统计与生词数。 */
  refreshStats() {
    const reg = bank.getRegistry();
    const progress = store.getProgress();
    let total = 0;
    let done = 0;
    (reg.papers || []).forEach(function (p) {
      (p.years || []).forEach(function (y) {
        (y.passages || []).forEach(function (ps) {
          total += 1;
          const pr = progress[ps.id];
          if (pr && pr.done) done += 1;
        });
      });
    });
    this.setData({ totalCount: total, totalDone: done, vocabCount: store.getVocab().length, wrongsCount: store.getWrongs().length });
  },

  /**
   * 导出错题：把错题本拼成纯文本复制到剪贴板。
   * 文本可用于贴到笔记 / 打印 / 发给自己复习。
   */
  onExportWrong() {
    const wrongs = store.getWrongs();
    if (!wrongs.length) {
      wx.showToast({ title: '还没有错题，先去刷题吧', icon: 'none' });
      return;
    }
    const LET = ['A', 'B', 'C', 'D'];
    const lines = [];
    lines.push('我的错题本（共 ' + wrongs.length + ' 题）');
    lines.push('导出于 ' + new Date().toLocaleDateString());
    lines.push('');
    let lastKey = '';
    wrongs.forEach(function (w, i) {
      const key = (w.paperName || w.paper || '') + ' ' + (w.year || '') + ' ' + (w.title || '');
      if (key !== lastKey) {
        lines.push('【' + (w.paperName || w.paper || '') + ' ' + (w.year || '') + ' · ' + (w.title || w.pid) + '】');
        lastKey = key;
      }
      lines.push((i + 1) + '. 第 ' + w.no + ' 题：' + (w.stem || '（题干缺失）'));
      lines.push('   你的答案：' + (LET[w.pick] || '?') + '　正确答案：' + (LET[w.answer] || '?'));
      lines.push('');
    });
    const txt = lines.join('\n').trim();
    wx.setClipboardData({
      data: txt,
      success: () => wx.showToast({ title: '错题已复制，去粘贴吧', icon: 'none' }),
      fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' })
    });
  },

  /** 刷新「继续上次」信息。 */
  refreshLast() {
    const pid = store.getLastPid();
    if (!pid) {
      this.setData({ lastPid: '', lastLabel: '' });
      return;
    }
    const meta = bank.findMeta(pid);
    this.setData({ lastPid: pid, lastLabel: meta ? meta.title : pid });
  },

  /** 切换卷种。 */
  switchPaper(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || id === this.data.activePaper) return;
    this.setData({ expandedYear: 0, groups: [] });
    this.renderYears(id);
  },

  /** 展开/收起某年。 */
  toggleYear(e) {
    const year = Number(e.currentTarget.dataset.year);
    if (this.data.expandedYear === year) {
      this.setData({ expandedYear: 0, groups: [] });
      return;
    }
    this.buildGroups(this.data.activePaper, year);
  },

  /** 打开某篇。 */
  onPassageTap(e) {
    this.goRead(e.currentTarget.dataset.id);
  },

  /** 继续上次。 */
  goLast() {
    this.goRead(this.data.lastPid);
  },

  /**
   * 跳转到横屏做题页（分包页面路径必须带分包 root 前缀）。
   * @param {string} pid 篇目 id
   */
  goRead(pid) {
    if (!pid) return;
    const paper = bank.paperOf(pid) || this.data.activePaper || 'en1';
    const root = resolveRoot(pid, paper);
    wx.navigateTo({ url: '/' + root + '/pages/read/read?pid=' + pid });
  },

  /** 打开单词本。 */
  goVocab() {
    wx.navigateTo({ url: '/pages/vocab/vocab' });
  },

  /** 打开设置。 */
  goSettings() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  },

  /** 打开联系弹窗。 */
  onContactTap() {
    this.setData({ showContact: true });
  },

  /** 打开使用教程弹窗。 */
  onGuideTap() {
    this.setData({ showGuide: true });
  },

  /** 关闭使用教程弹窗。 */
  closeGuide() {
    this.setData({ showGuide: false });
  },

  /** 关闭联系弹窗。 */
  closeContact() {
    this.setData({ showContact: false });
  },

  /** 阻止弹窗内部点击冒泡到遮罩（catchtap 需要对应 handler）。 */
  onContactNoop() {},

  /** 复制联系方式到剪贴板。 */
  copyContact(e) {
    const txt = e.currentTarget.dataset.copy || '';
    if (!txt) return;
    wx.setClipboardData({
      data: txt,
      success: function () {
        wx.showToast({ title: '已复制', icon: 'none' });
      }
    });
  }
});
