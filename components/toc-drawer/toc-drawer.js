// components/toc-drawer/toc-drawer.js
// 可展开侧边栏：文章段落目录 + 题号定位。纯展示组件，交互通过事件回传宿主。
Component({
  properties: {
    show: { type: Boolean, value: false },
    paragraphs: { type: Array, value: [] },   // [{ n, preview, isActive }]
    questions: { type: Array, value: [] }     // [{ no, preview, answered, isActive }]
  },

  methods: {
    /** 关闭抽屉（点遮罩或关闭按钮） */
    onClose() {
      this.triggerEvent('close');
    },
    /** 点击条目跳转 */
    onJump(e) {
      const d = e.currentTarget.dataset;
      this.triggerEvent('jump', {
        type: d.type,
        index: Number(d.index),
        n: Number(d.n)
      });
    }
  }
});
