// pages/settings/settings.js
// 设置：字号/行距/翻译/取词模式等，改完立即持久化；含危险操作二次确认。
const settings = require('../../utils/settings.js');
const store = require('../../utils/store.js');

Page({
  data: {
    s: settings.getDefaults(),
    vocabCount: 0,
    doneCount: 0,
    showContact: false,
    // 联系方式：与首页「联系作者 / 提建议」弹窗一致，点击可复制
    contactEmail: 'banlu6@qq.com'
  },

  onShow() {
    this.refresh();
  },

  /** 刷新设置与统计。 */
  refresh() {
    const progress = store.getProgress();
    let done = 0;
    Object.keys(progress).forEach(function (k) {
      if (progress[k] && progress[k].done) done += 1;
    });
    this.setData({
      s: settings.get(),
      vocabCount: store.getVocab().length,
      doneCount: done
    });
  },

  /**
   * 写入单个设置项。
   * @param {string} key 设置键
   * @param {*} value 值
   */
  setKey(key, value) {
    const patch = {};
    patch[key] = value;
    const next = settings.set(patch);
    this.setData({ s: next });
  },

  onArticleSize(e) { this.setKey('articleSize', Number(e.detail.value)); },
  onQuestionSize(e) { this.setKey('questionSize', Number(e.detail.value)); },
  onLineHeight(e) { this.setKey('lineHeight', Number(e.detail.value)); },
  onShowZh(e) { this.setKey('showZh', !!e.detail.value); },
  onShowOptZh(e) { this.setKey('showOptZh', !!e.detail.value); },
  onTapMode(e) { this.setKey('tapMode', !!e.detail.value); },
  onLongPressDict(e) { this.setKey('longPressDict', !!e.detail.value); },
  onOrientation(e) { this.setKey('orientation', e.detail.value ? 'portrait' : 'landscape'); },

  /** 清空生词本（二次确认）。 */
  clearVocab() {
    wx.showModal({
      title: '清空生词本',
      content: '将删除全部 ' + this.data.vocabCount + ' 个生词，且不可恢复。确定吗？',
      confirmColor: '#E74C3C',
      success: (r) => {
        if (!r.confirm) return;
        store.clearVocab();
        this.refresh();
        wx.showToast({ title: '已清空生词本', icon: 'none' });
      }
    });
  },

  /** 清空做题进度（二次确认）。 */
  clearProgress() {
    wx.showModal({
      title: '清空做题进度',
      content: '将清除全部作答记录与进度统计，且不可恢复。确定吗？',
      confirmColor: '#E74C3C',
      success: (r) => {
        if (!r.confirm) return;
        store.clearProgress();
        this.refresh();
        wx.showToast({ title: '已清空进度', icon: 'none' });
      }
    });
  },

  /** 恢复默认设置（二次确认）。 */
  resetSettings() {
    wx.showModal({
      title: '恢复默认设置',
      content: '字号、行距与各开关将恢复为初始值。确定吗？',
      confirmColor: '#E74C3C',
      success: (r) => {
        if (!r.confirm) return;
        settings.reset();
        this.refresh();
        wx.showToast({ title: '已恢复默认', icon: 'none' });
      }
    });
  },

  /** 打开联系弹窗。 */
  onContactTap() {
    this.setData({ showContact: true });
  },

  /** 关闭联系弹窗。 */
  closeContact() {
    this.setData({ showContact: false });
  },

  /** 阻止弹窗内部点击冒泡到遮罩。 */
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
