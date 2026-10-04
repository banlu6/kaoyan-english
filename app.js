// app.js
// 小程序入口：初始化全局数据与设置快照。
// 说明：本项目纯本地运行，不做任何 wx.request 网络请求。
const settings = require('./utils/settings.js');

App({
  /**
   * 全局数据
   * - bank: 分包题库挂载点，形如 { en1: { '<pid>': passage }, en2: {...} }。
   *         分包薄页面把自己的题库对象挂到这里，避免通过 setData/property 传递大数据。
   * - settings: 当前设置快照，供各页面同步读取。
   * - pendingPid: 分包薄页面 onLoad 时暂存的待打开篇目 id。
   */
  globalData: {
    bank: {},
    settings: null,
    pendingPid: ''
  },

  onLaunch() {
    // 启动即初始化设置，保证首屏同步读取到默认值
    try {
      this.globalData.settings = settings.get();
    } catch (err) {
      this.globalData.settings = settings.getDefaults();
    }
  },

  onShow() {
    // 从后台回到前台时刷新设置，保持与设置页一致
    try {
      this.globalData.settings = settings.get();
    } catch (err) {
      // 忽略：读取失败时保留上一次快照
    }
  }
});
