// utils/readPage.js
// 分包做题「薄页面」的共享工厂。
// 背景：en1 / en2 两个分包页面除「卷种 id」与「本分包题库对象」外完全相同。
//       主包无法 require 分包数据文件，故题库 passages 仍由各分包页面自行静态 require 后传入，
//       其余生命周期与方向切换逻辑统一收敛到这里，消除逐字重复。
const bank = require('./bank.js');
const store = require('./store.js');
const settings = require('./settings.js');

/**
 * 生成一个做题薄页面的 Page 配置对象。
 * @param {string} paper 卷种 id，如 'en1' / 'en2'
 * @param {object} passages 该分包的题库映射（{ '<pid>': passage }），由分包页面 require 后传入
 * @returns {object} 可直接传给 Page() 的配置对象
 */
function createReadPage(paper, passages) {
  return {
    data: { pid: '' },

    onLoad(query) {
      const pid = query && query.pid ? String(query.pid) : '';
      // 分包内静态 require 的词库映射 -> 挂到 globalData，避免 setData 传大数据
      bank.setBank(paper, passages);
      const app = getApp();
      if (app && app.globalData) app.globalData.pendingPid = pid;
      if (pid) store.setLastPid(pid);
      this.setData({ pid: pid });
      this.applyOrientation();
    },

    onShow() {
      // 从设置页返回时同步最新设置与阅读方向
      this.applyOrientation();
      const reader = this.selectComponent('#reader');
      if (reader && typeof reader.onPageShow === 'function') {
        reader.onPageShow();
      }
    },

    /**
     * 按用户设置切换页面方向。
     * wx.setPageOrientation 未列入官方文档且部分平台（如 PC）不支持，故：
     * ① 判 typeof；② 整段 try/catch；③ 任何失败静默降级——
     *    此时页面 json 的 pageOrientation:"auto" 会让页面跟随手机旋转，用户手动旋转即可竖屏。
     */
    applyOrientation() {
      let target = 'landscape';
      try {
        const s = settings.get();
        target = s && s.orientation === 'portrait' ? 'portrait' : 'landscape';
      } catch (err) {
        // 忽略：读取失败按默认横屏
      }
      if (typeof wx.setPageOrientation !== 'function') return;
      try {
        wx.setPageOrientation({ orientation: target, fail() { /* 静默降级 */ } });
      } catch (err) {
        // 忽略：API 不可用时静默降级
      }
    },

    /** 页面尺寸变化（真机旋转触发）：把最新尺寸交给阅读组件重算横竖屏。 */
    onResize(res) {
      const reader = this.selectComponent('#reader');
      if (reader && typeof reader.onResize === 'function') {
        reader.onResize(res);
      }
    }
  };
}

module.exports = { createReadPage };
