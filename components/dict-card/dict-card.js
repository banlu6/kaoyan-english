// components/dict-card/dict-card.js
// 单词释义卡片：长按文章中的单词时弹出。
// 例 句：并非查词库，而是从当前文章段落中找出包含该词的第一句（英文原句 + 所在段译文）。

Component({
  properties: {
    show: { type: Boolean, value: false },
    word: { type: String, value: '' },
    ph: { type: String, value: '' },
    pos: { type: String, value: '' },
    cn: { type: String, value: '' },
    lemma: { type: String, value: '' },
    from: { type: String, value: '' },   // local | plugin | none
    exEn: { type: String, value: '' },
    exZh: { type: String, value: '' },
    exN: { type: Number, value: 0 },
    saved: { type: Boolean, value: false },
    loading: { type: Boolean, value: false }
  },

  methods: {
    /** 关闭卡片 */
    onClose() {
      this.triggerEvent('close');
    },
    /** 点击遮罩关闭 */
    onMask() {
      this.triggerEvent('close');
    },
    /** 阻止卡片内的点击冒泡到遮罩 */
    noop() {},
    /** 加入生词本 */
    onAdd() {
      this.triggerEvent('add', { word: this.data.word });
    }
  }
});
