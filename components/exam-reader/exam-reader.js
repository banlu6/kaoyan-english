// components/exam-reader/exam-reader.js
// 【核心】横屏阅读理解整块 UI：文章取词 + 可拖动题卡 + 解析 + 目录抽屉。
// 数据流：分包薄页面把题库挂到 app.globalData.bank -> 本组件经 utils/bank 读取单篇 -> 仅 setData 这一篇。
const bank = require('../../utils/bank.js');
const dict = require('../../utils/dict.js');
const store = require('../../utils/store.js');
const settings = require('../../utils/settings.js');
const text = require('../../utils/text.js');

const LETTERS = ['A', 'B', 'C', 'D'];

/**
 * 数值夹取。
 * @param {number} v 值
 * @param {number} lo 下限
 * @param {number} hi 上限
 * @returns {number} 夹取结果
 */
function clamp(v, lo, hi) {
  if (hi < lo) return lo;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}


/**
 * 打包 token 序列以降低渲染节点数：
 * 把紧跟单词的分隔文本（标点/空格）并入该词的 tail，渲染时用单个 <text> 呈现。
 * 例如一段 400 词的文字，未打包约 800 个节点，打包后约 400 个。
 * @param {Array} tokens text.tokenize 的输出
 * @returns {Array} 打包后的 token（含 node 字段，供 WXML 直接渲染）
 */
function packTokens(tokens) {
  const list = tokens || [];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (t.t === 'word') {
      let tail = '';
      const nx = list[i + 1];
      if (nx && nx.t === 'text') {
        tail = nx.v;
        i += 1;
      }
      out.push({ i: out.length, t: 'word', v: t.v, k: t.k, node: t.v + tail });
    } else {
      out.push({ i: out.length, t: 'text', v: t.v, node: t.v });
    }
  }
  return out;
}

/**
 * 对一段 token 序列做生词着色索引：给每个词 token 预置 sc 标记（1=已收录），
 * 并把它的 setData 数据路径登记进 wordIdx、当前状态登记进 wordState。
 * 文章句 / 题干 / 选项三处结构同构，统一走这里，避免重复。
 * @param {Array} toks packTokens 之后的 token 数组
 * @param {string} prefix 数据路径前缀（不含下标），如 'paras[0].sents[1].tokens['
 * @param {string} suffix 数据路径后缀，如 '].sc'
 * @param {object} vocabMap store.vocabMap() 的词 -> 掌握度映射
 * @param {object} wordIdx 收集「词 -> 路径数组」的输出
 * @param {object} wordState 收集「词 -> 当前着色状态」的输出
 */
function indexVocabTokens(toks, prefix, suffix, vocabMap, wordIdx, wordState) {
  const list = toks || [];
  for (let ti = 0; ti < list.length; ti++) {
    const tk = list[ti];
    if (tk.t !== 'word' || !tk.k) continue;
    const on = vocabMap[tk.k] !== undefined ? 1 : 0;
    tk.sc = on;
    wordState[tk.k] = on;
    if (!wordIdx[tk.k]) wordIdx[tk.k] = [];
    wordIdx[tk.k].push(prefix + ti + suffix);
  }
}

Component({
  properties: {
    pid: { type: String, value: '' },
    paper: { type: String, value: 'en1' }
  },

  data: {
    ready: false,
    err: '',
    title: '',
    source: '',
    paras: [],            // [{ n, id, en, zh, tokens }]
    questions: [],        // 题卡数组（含拖动/作答状态）
    activeIndex: 0,
    showToc: false,
    tocParas: [],         // [{ n, preview, isActive }]
    tocQuestions: [],     // [{ no, preview, answered, isActive }]
    activePara: 0,
    scrollInto: '',

    // 设置快照（展开成平铺字段，便于 WXML 直接使用）
    showZh: false,
    showOptZh: false,
    tapMode: true,
    longPressDict: true,
    aSize: 17,
    qSize: 15,
    lh: 1.8,

    // 题卡面板布局
    panelW: 0,             // 题卡面板宽度（px），由窗口宽度计算，可拖拽右边界调整
    panelCollapsed: false, // 题卡面板是否折叠（会话内生效）
    showFont: false,       // 页内字号调节浮层是否显示

    // 竖屏阅读
    portrait: false,       // 当前是否竖屏（windowHeight > windowWidth）
    panelH: 260,           // 竖屏题卡区高度（px），可拖拽上边界调整
    statusBarH: 0,         // 状态栏高度（px），仅竖屏顶栏避让用（custom 导航下页面从屏幕顶端绘制）
    floatX: 14,            // 悬浮窗（词典卡）位置（px），attached 时按窗口尺寸重算，此处仅占位声明
    floatY: 200,

    // 释义卡片
    dict: {
      show: false, word: '', ph: '', pos: '', cn: '', lemma: '', from: '',
      exEn: '', exZh: '', exN: 0, saved: false, loading: false
    }
  },

  lifetimes: {
    attached() {
      this._drag = null;
      this._rawParas = [];
      this._paraTops = [];
      this._paraIdx = -1;
      this._lastTap = null;
      const W = this.getWindowWidth();
      const H = this.getWindowHeight();
      this._winW = W;
      this._winH = H;
      this._fl = null;
      // 状态栏高度：read 页为 custom 导航（navigationStyle:"custom"），页面自屏幕最顶端绘制，
      // 需留出状态栏（时间/电量条）高度，否则竖屏顶栏被压住。取不到时兜底 0。
      let sb = 0;
      try {
        const w = (typeof wx.getWindowInfo === 'function') ? wx.getWindowInfo() : wx.getSystemInfoSync();
        sb = (w && w.statusBarHeight) || 0;
      } catch (err) { sb = 0; }
      this.setData({
        panelW: Math.round(W * 0.46),
        floatX: 14,
        floatY: Math.max(56, Math.round(Math.max(120, H - 100) * 0.62)),
        // 竖屏判定：高度大于宽度即为竖屏（模拟器不一定触发 onResize，故此处先兜底）
        portrait: H > W,
        statusBarH: sb
      });
      this.applySettings(settings.get());
      this.load();
    },
    ready() {
      this.measure();
    },
    detached() {
      this._drag = null;
      // 组件销毁：清掉所有尚未到期的延时测量回调，避免回调在脱离后触发 setData
      const timers = this._timers || [];
      for (let i = 0; i < timers.length; i++) clearTimeout(timers[i]);
      this._timers = [];
    }
  },

  methods: {
    /* ------------------------------ 设置 ------------------------------ */

    /**
     * 应用设置到组件 data（平铺字段，供 WXML 直接绑定）。
     * @param {object} s 设置对象
     */
    applySettings(s) {
      const set = settings.normalize(s);
      this.setData({
        showZh: set.showZh,
        showOptZh: set.showOptZh,
        tapMode: set.tapMode,
        longPressDict: set.longPressDict,
        aSize: set.articleSize,
        qSize: set.questionSize,
        lh: set.lineHeight
      });
    },

    /** 页面 onShow 时由宿主页面调用：刷新设置与生词着色。 */
    onPageShow() {
      this.applySettings(settings.get());
      this.refreshVocab();
    },

    /** 按「词 -> token 路径」索引刷新生词着色（仅对变化的词做局部 setData）。 */
    refreshVocab() {
      const map = store.vocabMap();
      const idx = this._wordIdx || {};
      const state = this._wordState || {};
      const patch = {};
      let changed = 0;
      Object.keys(idx).forEach(function (k) {
        const on = map[k] !== undefined ? 1 : 0;
        if (state[k] === on) return;
        state[k] = on;
        const paths = idx[k];
        for (let i = 0; i < paths.length; i++) {
          patch[paths[i]] = on;
          changed += 1;
        }
      });
      this._wordState = state;
      if (changed) this.setData(patch);
    },

    /**
     * 受管延迟：登记 timer id，组件 detached 时统一 clearTimeout，
     * 防止页面已销毁仍回调 setData。语义与 setTimeout 完全一致，仅多一层清理。
     * @param {Function} fn 到期执行的函数
     * @param {number} ms 延迟毫秒
     * @returns {number} timer id
     */
    _later(fn, ms) {
      const id = setTimeout(fn, ms);
      if (!this._timers) this._timers = [];
      this._timers.push(id);
      return id;
    },

    /* ------------------------------ 数据 ------------------------------ */

    /** 载入当前篇目，构建文章 token 与题卡。 */
    load() {
      const pid = this.data.pid;
      const paper = this.data.paper;
      if (!pid) {
        this.setData({ ready: false, err: '缺少篇目参数' });
        return;
      }
      const passage = bank.getPassage(paper, pid);
      if (!passage) {
        this.setData({ ready: false, err: '未找到该篇目数据（请从首页进入）' });
        return;
      }

      const rawParas = Array.isArray(passage.paragraphs) ? passage.paragraphs : [];
      this._rawParas = rawParas;

      // 段落再切成句子：每句独立渲染，句尾挂一个「译」按钮按需展开中译。
      // 题库只有「段落级」译文，故：中英句数一致 → 逐句对齐；不一致 → 每句兜底为该段整段译文
      // （宁可重复，也不做按比例硬切导致错位编造）。
      const paras = rawParas.map(function (p) {
        const n = p && typeof p.n === 'number' ? p.n : 0;
        const en = String((p && p.en) || '');
        const zh = String((p && p.zh) || '');
        const enSents = text.splitSentences(en);
        const zhSents = text.splitZhSentences(zh);
        const aligned = zhSents.length > 0 && zhSents.length === enSents.length;
        const list = enSents.length ? enSents : (en ? [en] : []);
        const sents = list.map(function (s, si) {
          return {
            i: si,
            text: s,
            zh: aligned ? zhSents[si] : zh,
            whole: !!zh && !aligned,
            show: false,
            tokens: packTokens(text.tokenize(s))
          };
        });
        return { n: n, id: 'p' + n, en: en, zh: zh, sents: sents };
      });

      // 生词着色：在 token 上预置 sc 标记（1=已收录），并建立「词 -> token 数据路径」索引。
      // 好处：① 首屏即正确着色 ② 之后新增生词只需按路径局部 setData，开销最小
      //       ③ 不依赖 WXML 的 obj[key] 动态取值写法，兼容性更稳。
      const vocabMap = store.vocabMap();
      const wordIdx = {};
      const wordState = {};
      for (let pi = 0; pi < paras.length; pi++) {
        const sents = paras[pi].sents;
        for (let si = 0; si < sents.length; si++) {
          indexVocabTokens(
            sents[si].tokens,
            'paras[' + pi + '].sents[' + si + '].tokens[', '].sc',
            vocabMap, wordIdx, wordState
          );
        }
      }
      this._wordIdx = wordIdx;
      this._wordState = wordState;

      const saved = store.getAnswers(pid);
      // 选项译文默认展开与否，沿用设置页的「显示选项中译」开关；页内「译」按钮可在其基础上逐个切换
      const optZhDefault = !!this.data.showOptZh;
      const rawQs = Array.isArray(passage.questions) ? passage.questions : [];
      const questions = rawQs.map(function (q, i) {
        const src = q || {};
        const options = (Array.isArray(src.options) ? src.options.slice(0, 4) : []).map(function (o) {
          return String(o == null ? '' : o);
        });
        while (options.length < 4) options.push('');
        const optionsZh = (Array.isArray(src.optionsZh) ? src.optionsZh.slice(0, 4) : []).map(function (o) {
          return String(o == null ? '' : o);
        });
        while (optionsZh.length < 4) optionsZh.push('');

        const answer = typeof src.answer === 'number' ? src.answer : -1;
        const no = typeof src.no === 'number' ? src.no : (i + 1);
        const rec = saved[String(no)] || {};
        const pick = typeof rec.pick === 'number' ? rec.pick : -1;
        const submitted = !!rec.submitted;

        // 选项重建为对象数组：携带稳定 i/letter，供 wx:key 与渲染使用
        const stemText = String(src.stem || '');
        const opts = [];
        for (let k = 0; k < 4; k++) {
          opts.push({
            i: k, letter: LETTERS[k], en: options[k], zh: optionsZh[k],
            show: optZhDefault && !!optionsZh[k],
            // 选项也按词切 token：双击记词 / 长按查释义 与文章一致
            tokens: packTokens(text.tokenize(options[k]))
          });
        }

        return {
          no: no,
          stem: stemText,
          stemTokens: packTokens(text.tokenize(stemText)),
          stemZh: String(src.stemZh || ''),
          stemShow: false,   // 题干中译默认收起，点题干末尾的「译」展开
          mini: false,       // 是否已缩成小悬浮签
          mx: 0, my: 0,      // 悬浮签位置（px，相对题卡区）
          opts: opts,
          answer: answer,
          qtype: String(src.qtype || ''),
          locate: src.locate && typeof src.locate === 'object' ? src.locate : null,
          rows: (Array.isArray(src.rows) ? src.rows : []).map(function (r, ri) {
            const row = r || {};
            return { i: ri, tag: String(row.tag || ''), text: String(row.text || '') };
          }),
          optionNotes: (Array.isArray(src.optionNotes) ? src.optionNotes : []).map(function (n, ni) {
            const note = n || {};
            return {
              i: ni,
              letter: String(note.letter || LETTERS[ni] || ''),
              ok: !!note.ok,
              flag: String(note.flag || ''),
              note: String(note.note || '')
            };
          }),
          pick: pick,
          submitted: submitted,
          correct: submitted && answer >= 0 && pick === answer,
          missing: answer < 0,
          x: -9999,
          y: -9999,
          z: i + 1
        };
      });

      // 题干与选项的 token 也进入生词着色索引：双击记词 / 长按查释义与文章完全一致
      for (let qi = 0; qi < questions.length; qi++) {
        const q = questions[qi];
        indexVocabTokens(
          q.stemTokens,
          'questions[' + qi + '].stemTokens[', '].sc',
          vocabMap, wordIdx, wordState
        );
        for (let oi = 0; oi < q.opts.length; oi++) {
          indexVocabTokens(
            q.opts[oi].tokens,
            'questions[' + qi + '].opts[' + oi + '].tokens[', '].sc',
            vocabMap, wordIdx, wordState
          );
        }
      }
      this._wordIdx = wordIdx;
      this._wordState = wordState;

      this.setData({
        ready: true,
        err: '',
        title: String(passage.title || ''),
        source: String(passage.source || '题目与译文整理自公开网络，仅供个人学习交流'),
        paras: paras,
        questions: questions,
        activeIndex: 0,
        activePara: paras.length ? paras[0].n : 0,
        scrollInto: '',
        tocParas: paras.map(function (p, i) {
          return { n: p.n, preview: text.preview(p.en, 22), isActive: i === 0 };
        }),
        tocQuestions: this.buildTocQuestions(questions)
      });
      this.refreshVocab();
      this.updateProgress();
      // 渲染完成后测量各题卡是否内容超屏（决定「题目可下滑」提示）
      this._later(() => {
        for (let i = 0; i < questions.length; i++) this.measureQOverflow(i);
      }, 300);
    },

    /**
     * 构建目录中的题目列表。
     * @param {Array} questions 题卡数组
     * @returns {Array} 目录项
     */
    buildTocQuestions(questions) {
      return (questions || []).map(function (q) {
        const label = q.stem ? q.stem : ('第 ' + q.no + ' 空');
        return { no: q.no, preview: text.preview(label, 20), answered: !!q.submitted, isActive: false };
      });
    },

    /* ------------------------------ 导出 ------------------------------ */

    /**
     * 导出本篇为「像真题卷子」的纯文本并复制到剪贴板：
     * 整篇英文原文 + 全部题目（做错的题标 ✗ 并附你的答案 / 正确答案）+ 答案速查。
     * 数据全部取自组件内已加载的 data，无需回首页，也不依赖分包 require。
     */
    onExport() {
      if (!this.data.ready) {
        wx.showToast({ title: '还没加载好', icon: 'none' });
        return;
      }
      const paras = this.data.paras || [];
      const questions = this.data.questions || [];
      if (!paras.length && !questions.length) {
        wx.showToast({ title: '没有可导出的内容', icon: 'none' });
        return;
      }
      const LET = ['A', 'B', 'C', 'D'];
      // 完形原文用 [[1]] 标记空位，导出时换成 (1) 更贴近真题排版
      const cleanEn = function (s) {
        return String(s || '').replace(/\[\[(\d+)\]\]/g, '($1)');
      };
      const lines = [];
      const now = new Date();
      const pad = function (n) { return (n < 10 ? '0' : '') + n; };
      const stamp = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
        + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes());

      let wrong = 0;
      let right = 0;
      questions.forEach(function (q) {
        if (!q.submitted || q.answer < 0) return;
        if (q.correct) right += 1; else wrong += 1;
      });

      lines.push(this.data.title || '真题');
      if (this.data.source) lines.push('来源：' + this.data.source);
      lines.push('导出：' + stamp + '　作答：对 ' + right + ' / 错 ' + wrong + '（共 ' + questions.length + ' 题）');
      lines.push('');

      lines.push('===== 原文 =====');
      paras.forEach(function (p) {
        const body = cleanEn(p.en);
        if (!body) return;
        lines.push((p.n ? p.n + '. ' : '') + body);
        lines.push('');
      });

      if (questions.length) {
        lines.push('===== 题目 =====');
        questions.forEach(function (q) {
          let mark = '';
          if (q.submitted && q.answer >= 0) {
            mark = q.correct
              ? '　✓'
              : '　✗（你的答案 ' + (LET[q.pick] || '?') + '，正确 ' + (LET[q.answer] || '?') + '）';
          }
          lines.push('第 ' + q.no + ' 题　' + (q.stem || '') + mark);
          (q.opts || []).forEach(function (op) {
            lines.push('   ' + op.letter + '. ' + (op.en || ''));
          });
          lines.push('');
        });

        lines.push('===== 答案速查 =====');
        lines.push(questions.map(function (q) {
          return q.no + ' ' + (q.answer >= 0 ? (LET[q.answer] || '?') : '?');
        }).join('　'));
      }

      const txt = lines.join('\n');
      wx.setClipboardData({
        data: txt,
        success: function () { wx.showToast({ title: '本篇已复制，去粘贴/打印吧', icon: 'none' }); },
        fail: function () { wx.showToast({ title: '复制失败，请重试', icon: 'none' }); }
      });
    },

    /* ------------------------------ 测量与定位 ------------------------------ */

    /** 测量容器/卡片尺寸，写入默认堆叠位置，并记录段落偏移。 */
    measure() {
      if (!this.data.ready) return;
      const q = this.createSelectorQuery();
      q.select('.card-area').boundingClientRect();
      q.select('.q-card').boundingClientRect();
      q.select('.article').boundingClientRect();
      q.selectAll('.para').boundingClientRect();
      q.exec((res) => {
        const area = res[0];
        const card = res[1];
        const art = res[2];
        const paras = res[3] || [];

        const areaW = area && area.width ? area.width : 320;
        const areaH = area && area.height ? area.height : 260;
        const cardW = card && card.width ? card.width : Math.min(260, areaW - 20);
        const cardH = card && card.height ? card.height : 220;

        this._areaW = areaW;
        this._areaH = areaH;
        this._cardW = cardW;
        this._cardH = cardH;
        this._minX = 6;
        this._maxX = Math.max(6, areaW - cardW - 6);
        this._minY = 6;
        this._maxY = Math.max(6, areaH - cardH - 6);

        if (art) {
          this._paraTops = paras.map(function (p) { return p.top - art.top; });
        }

        this.applyDefaultPositions();
      });
    },


    /** 按堆叠规则生成默认卡片位置并写回（同时重置 z 序）。 */
    applyDefaultPositions() {
      const areaW = this._areaW || 320;
      const areaH = this._areaH || 260;
      const cardW = this._cardW || 240;
      const cardH = this._cardH || 200;
      const baseX = clamp(areaW - cardW - 14, 6, Math.max(6, areaW - cardW - 6));
      const wrapH = Math.max(60, areaH - cardH - 14);

      const patch = {};
      const list = this.data.questions;
      for (let i = 0; i < list.length; i++) {
        const x = clamp(baseX - (i % 3) * 16, 6, Math.max(6, areaW - cardW - 6));
        const y = clamp(14 + ((i * 30) % wrapH), 6, Math.max(6, areaH - cardH - 6));
        patch['questions[' + i + '].x'] = x;
        patch['questions[' + i + '].y'] = y;
        patch['questions[' + i + '].z'] = i + 1;
      }
      if (list.length) {
        patch.activeIndex = 0;
        patch['questions[0].z'] = list.length + 1;
      }
      this.setData(patch);
    },

    /* ------------------------------ 卡片拖动 ------------------------------ */

    /**
     * 把某张卡片提到最前。
     * @param {number} idx 卡片下标
     */
    bringToFront(idx) {
      this._zTop = (this._zTop || this.data.questions.length) + 1;
      const patch = {};
      patch['questions[' + idx + '].z'] = this._zTop;
      this.setData(patch);
    },

    /** 拖动开始（仅卡片标题栏触发）。 */
    onCardTouchStart(e) {
      if (this.data.portrait) return; // 竖屏为题卡列表，无拖动
      // 点在「─」最小化按钮上：按下瞬间直接收起（不依赖 tap 合成——
      // 真机上 catchtouch* 祖先下子节点 tap 不稳定，两次实测都点不动）。
      // onCardMini 幂等（只置 true），后续 tap 即使触发也只是重复置 true，无害。
      const tInfo = e.target && e.target.dataset ? e.target.dataset : {};
      if (tInfo.minibtn) {
        this._drag = null;
        const mIdx = Number(e.target.dataset.idx);
        const mq = this.data.questions[mIdx];
        if (mq && !mq.mini) this.setData({ ['questions[' + mIdx + '].mini']: true });
        return;
      }
      const idx = Number(e.currentTarget.dataset.idx);
      const t = e.touches && e.touches[0];
      if (!t || !this.data.questions[idx]) return;
      const q = this.data.questions[idx];
      // 只记录拖拽上下文；置顶/激活延迟到真正拖动时再做（避免 tap 被重渲染吞掉）
      this._drag = {
        idx: idx,
        sx: t.clientX,
        sy: t.clientY,
        ox: q.x,
        oy: q.y,
        moved: false,
        far: false,      // 位移是否超过点击阈值（6px）
        fronted: false
      };
    },

    /** 拖动中。 */
    onCardTouchMove(e) {
      if (this.data.portrait) return;
      const d = this._drag;
      if (!d) return;
      const t = e.touches && e.touches[0];
      if (!t) return;
      const dx = t.clientX - d.sx;
      const dy = t.clientY - d.sy;
      if (!d.fronted && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) {
        d.fronted = true;
        this.bringToFront(d.idx);
        if (this.data.activeIndex !== d.idx) this.setData({ activeIndex: d.idx });
      }
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) d.moved = true;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) d.far = true;
      const nx = clamp(d.ox + dx, this._minX || 6, this._maxX || 9999);
      const ny = clamp(d.oy + dy, this._minY || 6, this._maxY || 9999);
      const patch = {};
      patch['questions[' + d.idx + '].x'] = nx;
      patch['questions[' + d.idx + '].y'] = ny;
      this.setData(patch);
    },

    /**
     * 拖动结束。
     * 关键：位移未超 6px 视为「点击」——悬浮签状态下恢复整卡。
     * 真机上 catchtouch* 祖先下子节点 tap 不稳定（实测点不动），
     * 因此点击语义一律由 touchend + 位移阈值判定，不依赖 tap 合成。
     */
    onCardTouchEnd() {
      if (this.data.portrait) return;
      const d = this._drag;
      this._drag = null;
      if (!d || d.far) return;
      const q = this.data.questions[d.idx];
      if (!q) return;
      if (q.mini) {
        this.setData({ ['questions[' + d.idx + '].mini']: false });
        this._later(() => this.measureQOverflow(d.idx), 60);
      } else {
        this.bringToFront(d.idx);
        if (this.data.activeIndex !== d.idx) this.setData({ activeIndex: d.idx });
      }
    },

    /**
     * 题卡内容滚动：记录「已滚动」隐藏提示条，并同步溢出状态。
     * （bindscroll 只在可滚动时触发，溢出判定另由 measureQOverflow 兜底）
     */
    onQBodyScroll(e) {
      const idx = Number(e.currentTarget.dataset.idx);
      const q = this.data.questions[idx];
      const d = e.detail || {};
      if (!q) return;
      const now = Date.now();
      if (this._qScrollAt && now - this._qScrollAt < 200) return; // 节流
      this._qScrollAt = now;
      const patch = {};
      if (d.scrollTop > 12 && !q.scrolled) patch['questions[' + idx + '].scrolled'] = true;
      if (typeof d.scrollHeight === 'number' && typeof d.height === 'number') {
        const ov = d.scrollHeight > d.height + 2;
        if (!!q.overflow !== ov) patch['questions[' + idx + '].overflow'] = ov;
      }
      if (Object.keys(patch).length) this.setData(patch);
    },

    /**
     * 测量指定题卡内容是否超出一屏（scrollHeight > 可视高），决定是否显示「题目可下滑」。
     * 在卡片激活/提交解析展开/字号变化后调用。
     */
    measureQOverflow(idx) {
      const q = this.data.questions[idx];
      if (!q || q.mini) return;
      this.createSelectorQuery()
        .select('#qb-' + idx)
        .fields({ size: true, scrollOffset: true }, (res) => {
          if (!res) return;
          const ov = res.scrollHeight > res.height + 2;
          if (!!this.data.questions[idx].overflow !== ov) {
            this.setData({ ['questions[' + idx + '].overflow']: ov });
          }
        })
        .exec();
    },

    /** 点卡片空白处：提到最前并激活。 */
    onCardTap(e) {
      const idx = Number(e.currentTarget.dataset.idx);
      if (isNaN(idx)) return;
      this.bringToFront(idx);
      if (this.data.activeIndex !== idx) this.setData({ activeIndex: idx });
      this.measureQOverflow(idx);
    },

    /** 一键复位所有卡片位置。 */
    resetCards() {
      this.applyDefaultPositions();
      wx.showToast({ title: '题卡已复位', icon: 'none' });
    },

    /**
     * 把单张题卡缩成小悬浮签（保留原位置，仅外观收成胶囊，可继续拖动）。
     */
    onCardMini(e) {
      if (this.data.portrait) return; // 竖屏为题卡列表，不提供缩胶囊
      const idx = Number(e.currentTarget.dataset.idx);
      const q = this.data.questions[idx];
      if (!q || q.mini) return;
      const patch = {};
      patch['questions[' + idx + '].mini'] = true;
      this.setData(patch);
    },

    /**
     * 标题栏轻点：悬浮签状态 → 恢复整卡；普通状态 → 置顶并激活。
     * （拖动由 catchtouch* 处理，微信的 tap 自带位移阈值，拖完不会误触发。）
     */
    onHeadTap(e) {
      const idx = Number(e.currentTarget.dataset.idx);
      const q = this.data.questions[idx];
      if (!q) return;
      if (q.mini) {
        this.setData({ ['questions[' + idx + '].mini']: false });
        // 恢复后等一帧再测量（节点刚从胶囊切回整卡）
        this._later(() => this.measureQOverflow(idx), 60);
      } else {
        this.measureQOverflow(idx);
      }
      this.bringToFront(idx);
      if (this.data.activeIndex !== idx) this.setData({ activeIndex: idx });
    },

    /* ------------------------------ 作答 ------------------------------ */

    /** 选择选项。 */
    onOptionTap(e) {
      const ds = e.currentTarget.dataset;
      const idx = Number(ds.idx);
      const oi = Number(ds.oi);
      const q = this.data.questions[idx];
      if (!q) return;
      if (q.submitted) {
        wx.showToast({ title: '本题已提交', icon: 'none' });
        return;
      }
      const patch = {};
      patch['questions[' + idx + '].pick'] = oi;
      this.setData(patch);
      this.bringToFront(idx);
      this.setData({ activeIndex: idx });
      this.measureQOverflow(idx);
      this.persist();
    },

    /** 提交单题：未作答不判分，仅给出提示。 */
    onSubmitOne(e) {
      const idx = Number(e.currentTarget.dataset.idx);
      const q = this.data.questions[idx];
      if (!q) return;
      if (!(q.pick >= 0)) {
        wx.showToast({ title: '本题尚未作答', icon: 'none' });
        return;
      }
      this.submitIndices([idx]);
    },

    /** 提交全部：跳过未作答的题，并提示已回答/未作答数量。 */
    submitAll() {
      const list = this.data.questions;
      if (!list.length) return;
      const all = [];
      for (let i = 0; i < list.length; i++) all.push(i);
      this.submitIndices(all);
      let answered = 0;
      for (let i = 0; i < list.length; i++) {
        if (list[i].pick >= 0) answered += 1;
      }
      const unanswered = list.length - answered;
      wx.showToast({
        title: '已回答 ' + answered + '/' + list.length + ' 题' + (unanswered ? '，' + unanswered + ' 题未作答' : ''),
        icon: 'none'
      });
    },

    /**
     * 提交若干题并写入解析状态。
     * 未作答（pick < 0）的题一律跳过，不计入判分、不置 submitted，
     * 以免被当作答错统计进正确率。
     * @param {Array<number>} indices 题卡下标数组
     * @returns {number} 实际提交（判分）的题数
     */
    submitIndices(indices) {
      const patch = {};
      const list = this.data.questions;
      let submitted = 0;
      for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
        const q = list[idx];
        if (!q) continue;
        if (!(q.pick >= 0)) continue; // 未作答：不判分
        patch['questions[' + idx + '].submitted'] = true;
        patch['questions[' + idx + '].correct'] = q.answer >= 0 && q.pick === q.answer;
        submitted += 1;
      }
      if (!submitted) return 0;
      this.setData(patch, () => {
        this.persist();
        this.setData({ tocQuestions: this.buildTocQuestions(this.data.questions) });
        // 解析展开会显著加长内容，重测各卡溢出状态
        for (let i = 0; i < indices.length; i++) this.measureQOverflow(indices[i]);
        // 错题入错题本（摘要缓存到本地，供首页导出）
        const loc = bank.findLocation(this.data.pid);
        for (let i = 0; i < indices.length; i++) {
          const idx = indices[i];
          const q = this.data.questions[idx];
          if (!q || !q.submitted) continue;
          if (q.correct || q.answer < 0) continue;
          store.addWrong({
            pid: this.data.pid,
            paper: this.data.paper,
            paperName: loc ? loc.paperName : '',
            year: loc ? loc.year : 0,
            title: String(this.data.title || ''),
            no: q.no,
            stem: String(q.stem || ''),
            pick: q.pick,
            answer: q.answer
          });
        }
      });
      return submitted;
    },

    /** 清空本篇作答（带二次确认）。 */
    clearAllAnswers() {
      wx.showModal({
        title: '清空作答',
        content: '将清除本篇所有选择与提交记录，确定吗？',
        confirmColor: '#E74C3C',
        success: (r) => {
          if (!r.confirm) return;
          const patch = {};
          const list = this.data.questions;
          for (let i = 0; i < list.length; i++) {
            patch['questions[' + i + '].pick'] = -1;
            patch['questions[' + i + '].submitted'] = false;
            patch['questions[' + i + '].correct'] = false;
          }
          this.setData(patch, () => {
            store.clearAnswers(this.data.pid);
            // 清空作答 = 重新做：该篇的错题记录一并移除
            const wrongs = store.getWrongs();
            for (let i = 0; i < wrongs.length; i++) {
              if (wrongs[i] && wrongs[i].pid === this.data.pid) store.removeWrong(this.data.pid, wrongs[i].no);
            }
            this.setData({ tocQuestions: this.buildTocQuestions(this.data.questions) });
            this.updateProgress();
          });
        }
      });
    },

    /** 持久化作答记录。 */
    persist() {
      const map = {};
      this.data.questions.forEach(function (q) {
        map[String(q.no)] = { pick: q.pick, submitted: !!q.submitted };
      });
      store.saveAnswers(this.data.pid, map);
      this.updateProgress();
    },

    /** 依据提交情况更新做题进度。 */
    updateProgress() {
      const list = this.data.questions;
      const total = list.length;
      let submitted = 0;
      let correct = 0;
      list.forEach(function (q) {
        if (q.submitted) {
          submitted += 1;
          if (q.answer >= 0 && q.pick === q.answer) correct += 1;
        }
      });
      if (!total) return;
      store.setProgress(this.data.pid, {
        done: submitted === total,
        total: total,
        correct: correct
      });
    },

    /* ------------------------------ 题号切换 ------------------------------ */

    /** 聚焦某张题卡。 */
    focusQuestion(idx) {
      const list = this.data.questions;
      if (!list[idx]) return;
      this.bringToFront(idx);
      const toc = this.data.tocQuestions.map(function (it, i) {
        return { no: it.no, preview: it.preview, answered: it.answered, isActive: i === idx };
      });
      this.setData({ activeIndex: idx, tocQuestions: toc }, () => {
        this.measureQOverflow(idx);
      });
    },

    /** 上一题。 */
    prevQ() {
      const idx = Math.max(0, this.data.activeIndex - 1);
      this.focusQuestion(idx);
    },

    /** 下一题。 */
    nextQ() {
      const idx = Math.min(this.data.questions.length - 1, this.data.activeIndex + 1);
      this.focusQuestion(idx);
    },

    /* ------------------------------ 目录抽屉 ------------------------------ */

    openToc() { this.setData({ showToc: true }); },
    closeToc() { this.setData({ showToc: false }); },

    /** 目录跳转。 */
    onTocJump(e) {
      const d = e.detail || {};
      if (d.type === 'para') {
        const n = Number(d.n);
        const list = this.data.tocParas.map(function (it) {
          return { n: it.n, preview: it.preview, isActive: it.n === n };
        });
        this.setData({ scrollInto: 'p' + n, activePara: n, tocParas: list, showToc: false });
      } else {
        this.focusQuestion(Number(d.index));
        this.setData({ showToc: false });
      }
    },

    /** 文章滚动时更新当前段落高亮。 */
    onArticleScroll(e) {
      const tops = this._paraTops;
      if (!tops || !tops.length) return;
      const st = (e.detail && e.detail.scrollTop) || 0;
      let idx = 0;
      for (let i = 0; i < tops.length; i++) {
        if (tops[i] <= st + 70) idx = i;
        else break;
      }
      if (idx === this._paraIdx) return;
      this._paraIdx = idx;
      const n = (this.data.paras[idx] || {}).n || 0;
      if (n === this.data.activePara) return;
      const list = this.data.tocParas.map(function (it, i) {
        return { n: it.n, preview: it.preview, isActive: i === idx };
      });
      this.setData({ activePara: n, tocParas: list });
    },

    /* ------------------------------ 取词 ------------------------------ */

    /** 单击单词：300ms 内同词二次点击判定为双击取词（切换加入/取消）。 */
    onWordTap(e) {
      if (!this.data.tapMode) return;
      const ds = e.currentTarget.dataset;
      const k = ds.k || text.normalize(ds.w);
      if (!k) return;
      const now = e.timeStamp || Date.now();
      const last = this._lastTap;
      if (last && last.k === k && (now - last.t) < 300) {
        this._lastTap = null;
        this.toggleWord(ds.w, k);
      } else {
        this._lastTap = { k: k, t: now };
      }
    },

    /**
     * 双击取词切换：已收录则移除，未收录则加入。
     * @param {string} raw 原始词
     * @param {string} k 归一化词
     */
    toggleWord(raw, k) {
      const norm = k || text.normalize(raw);
      if (!norm) return;
      if (store.hasVocab(norm)) {
        this.removeWord(norm);
      } else {
        this.addWord(raw, k);
      }
    },

    /**
     * 从生词本移除某个词，并即时刷新文章着色与释义卡片状态。
     * @param {string} norm 归一化词
     */
    removeWord(norm) {
      try { wx.vibrateShort({ type: 'light' }); } catch (err) { /* 忽略 */ }
      store.removeVocab(norm);
      this.refreshVocab();
      wx.showToast({ title: '已移出生词本', icon: 'none' });
      if (this.data.dict.show && text.normalize(this.data.dict.word) === norm) {
        this.setData({ 'dict.saved': false });
      }
    },

    /**
     * 加入生词本（含轻量振动与提示、上下文例句与释义回填）。
     * @param {string} raw 原始词
     * @param {string} k 归一化词
     */
    addWord(raw, k) {
      const norm = k || text.normalize(raw);
      if (!norm) return;
      const already = store.hasVocab(norm);
      // 即时反馈
      try { wx.vibrateShort({ type: 'light' }); } catch (err) { /* 忽略 */ }
      wx.showToast({ title: already ? '已在生词本' : '已加入生词本', icon: 'none' });
      const ex = text.findSentence(this._rawParas, raw || norm);
      // 先落库：保证生词本立即可见、文章立即着色
      store.addVocab({
        w: norm,
        ctx: ex ? ex.en : '',
        ctxZh: ex ? ex.zh : '',
        src: this.data.title,
        srcId: this.data.pid
      });
      this.refreshVocab();
      // 再异步用词典结果补齐音标 / 词性 / 释义（不改变出现次数）
      dict.query(norm).then((res) => {
        store.fillVocab(norm, { ph: res.ph, pos: res.pos, cn: res.cn });
        if (this.data.dict.show && text.normalize(this.data.dict.word) === norm) {
          this.setData({ 'dict.saved': true });
        }
      });
    },

    /** 长按单词：打开释义卡片。 */
    onWordLong(e) {
      if (!this.data.longPressDict) return;
      const ds = e.currentTarget.dataset;
      const norm = ds.k || text.normalize(ds.w);
      if (!norm) return;
      const ex = text.findSentence(this._rawParas, ds.w || norm);
      this.setData({
        dict: {
          show: true,
          word: norm,
          ph: '',
          pos: '',
          cn: '',
          lemma: '',
          from: '',
          exEn: ex ? ex.en : '',
          exZh: ex ? ex.zh : '',
          exN: ex ? ex.n : 0,
          saved: store.hasVocab(norm),
          loading: true
        }
      });
      dict.query(norm).then((res) => {
        this.setData({
          'dict.ph': res.ph,
          'dict.pos': res.pos,
          'dict.cn': res.cn,
          'dict.lemma': res.lemma,
          'dict.from': res.from,
          'dict.loading': false
        });
      });
    },

    /** 关闭释义卡片。 */
    closeDict() {
      this.setData({ 'dict.show': false });
    },

    /** 释义卡片内「加入 / 取消生词本」（切换）。 */
    onDictAdd(e) {
      const w = (e.detail && e.detail.word) || this.data.dict.word;
      this.toggleWord(w, text.normalize(w));
    },

    /* ------------------------------ 面板布局 ------------------------------ */

    /**
     * 取得窗口宽度（兼容新旧 API：优先 wx.getWindowInfo，降级到 wx.getSystemInfoSync）。
     * @returns {number} 窗口宽度（px）
     */
    getWindowWidth() {
      try {
        if (wx.getWindowInfo) return wx.getWindowInfo().windowWidth;
      } catch (err) { /* 忽略 */ }
      try {
        return wx.getSystemInfoSync().windowWidth;
      } catch (err) { /* 忽略 */ }
      return 375;
    },

    /**
     * 取得窗口高度（兼容新旧 API）。
     * @returns {number} 窗口高度（px）
     */
    getWindowHeight() {
      try {
        if (wx.getWindowInfo) return wx.getWindowInfo().windowHeight;
      } catch (err) { /* 忽略 */ }
      try {
        return wx.getSystemInfoSync().windowHeight;
      } catch (err) { /* 忽略 */ }
      return 667;
    },

    /** 分隔条拖拽开始：记录起点与初始宽度。 */
    onDividerTouchStart(e) {
      if (this.data.portrait) return;
      const t = e.touches && e.touches[0];
      if (!t) return;
      this._div = { sx: t.clientX, sw: this.data.panelW };
    },

    /** 分隔条拖拽中：按位移计算新宽度并夹取到 [0.30W, 0.70W]。 */
    onDividerTouchMove(e) {
      if (this.data.portrait) return;
      const d = this._div;
      if (!d) return;
      const t = e.touches && e.touches[0];
      if (!t) return;
      const W = this._winW || this.getWindowWidth();
      const lo = Math.round(W * 0.30);
      const hi = Math.round(W * 0.70);
      const nw = clamp(d.sw + (t.clientX - d.sx), lo, hi);
      this.setData({ panelW: nw });
    },

    /** 分隔条拖拽结束：清空拖拽状态。 */
    onDividerTouchEnd() { if (this.data.portrait) return; this._div = null; },

    /**
     * 折叠题卡面板（会话内生效）。
     * 横屏：题卡区收起后由 .q-float 小悬浮窗代替（文章占满全宽）。
     * 竖屏：题卡区收起后隐藏，由底部整宽恢复条 .panel-restore-h 代替（文章占满全高）。
     */
    onCollapsePanel() {
      this.setData({ panelCollapsed: true, showFont: false });
    },

    /** 展开题卡面板（横屏点悬浮窗/边缘标签，竖屏点底部恢复条）。 */
    onExpandPanel() {
      this.setData({ panelCollapsed: false });
    },

    /** 悬浮窗拖拽开始：记录起点与初始位置。 */
    onFloatTouchStart(e) {
      if (this.data.portrait) return;
      const t = e.touches && e.touches[0];
      if (!t) return;
      this._fl = {
        sx: t.clientX, sy: t.clientY,
        ox: this.data.floatX, oy: this.data.floatY,
        moved: false
      };
    },

    /** 悬浮窗拖拽中：跟随手指移动并夹取在可视区内。 */
    onFloatTouchMove(e) {
      if (this.data.portrait) return;
      const f = this._fl;
      if (!f) return;
      const t = e.touches && e.touches[0];
      if (!t) return;
      const dx = t.clientX - f.sx;
      const dy = t.clientY - f.sy;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) f.moved = true;
      const W = this._winW || this.getWindowWidth();
      const H = this._winH || this.getWindowHeight();
      this.setData({
        floatX: clamp(Math.round(f.ox + dx), 6, Math.max(6, W - 96)),
        floatY: clamp(Math.round(f.oy + dy), 6, Math.max(6, H - 176))
      });
    },

    /**
     * 悬浮窗拖拽结束：位移小于阈值视为「点击」→ 展开面板。
     * 用位移判定而非 bindtap，避免拖动松手时误触发展开。
     */
    onFloatTouchEnd() {
      if (this.data.portrait) return;
      const f = this._fl;
      this._fl = null;
      if (f && !f.moved) this.onExpandPanel();
    },

    /** 切换页内字号调节浮层（替代原「打开设置页」）。 */
    onToggleFont() {
      this.setData({ showFont: !this.data.showFont });
    },

    /** 字号滑块拖动中：实时预览——仅改 data 触发 WXML 绑定刷新，不落库。 */
    onFontChanging(e) {
      const field = e.currentTarget.dataset.field;
      if (!field) return;
      this.setData({ [field]: e.detail.value });
    },

    /** 字号滑块结束：实时预览 + 持久化到设置（change 结束写一次即可）。 */
    onFontChange(e) {
      const field = e.currentTarget.dataset.field;
      const key = e.currentTarget.dataset.key;
      const v = e.detail.value;
      const patch = {};
      if (field) patch[field] = v;
      this.setData(patch);
      if (key) settings.set({ [key]: v });
      // 字号变化会改变内容高度，重测所有题卡的溢出状态
      this._later(() => {
        for (let i = 0; i < this.data.questions.length; i++) this.measureQOverflow(i);
      }, 80);
    },

    /* ------------------------------ 竖屏阅读 ------------------------------ */

    /**
     * 页面尺寸变化（由宿主页面 onResize 转发，真机旋转时触发）。
     * 重算横竖屏；从竖屏切回横屏时复位题卡位置并重测。
     * @param {object} res 尺寸信息 { size: { windowWidth, windowHeight } }
     */
    onResize(res) {
      const size = res && res.size ? res.size : null;
      if (!size) return;
      this._winW = size.windowWidth;
      this._winH = size.windowHeight;
      const p = size.windowHeight > size.windowWidth;
      if (p === this.data.portrait) return;
      this.setData({ portrait: p }, () => {
        if (!p) {
          // 切回横屏：等布局稳定后重新测量并复位题卡位置
          this._later(() => this.measure(), 80);
        } else {
          // 切到竖屏：题卡区若正处于收起态，重置为展开
          if (this.data.panelCollapsed) this.setData({ panelCollapsed: false });
        }
      });
    },

    /** 竖屏横向分隔条拖拽开始：记录起点与初始高度，并测量主体高度供夹取。 */
    onHDividerTouchStart(e) {
      const t = e.touches && e.touches[0];
      if (!t) return;
      this._hd = { sy: t.clientY, sh: this.data.panelH };
      // 异步测量主体高度（竖屏下与横屏不同），拿不到时 move 里回退到窗口高度
      this.createSelectorQuery().select('.body').boundingClientRect((r) => {
        if (r && r.height) this._bodyH = r.height;
      }).exec();
    },

    /**
     * 竖屏横向分隔条拖拽中：手指下移 → 题卡区（在下）变矮、文章变高，故高度取「负增量」；
     * 夹取到 [120, 主体高度 * 0.7]，保证文章区至少保留约 30%。
     */
    onHDividerTouchMove(e) {
      const d = this._hd;
      if (!d) return;
      const t = e.touches && e.touches[0];
      if (!t) return;
      const bodyH = this._bodyH || this.getWindowHeight();
      const lo = 120;
      const hi = Math.max(lo, Math.round(bodyH * 0.7));
      const nh = clamp(d.sh - (t.clientY - d.sy), lo, hi);
      this.setData({ panelH: nh });
    },

    /** 竖屏横向分隔条拖拽结束：清空拖拽状态。 */
    onHDividerTouchEnd() { this._hd = null; },

    /* ------------------------- 逐句 / 逐项译文 ------------------------- */

    /** 展开/收起某一句文章译文（句尾「译」按钮）。 */
    onToggleSentZh(e) {
      const ds = e.currentTarget.dataset;
      const pi = Number(ds.p);
      const si = Number(ds.si);
      const para = this.data.paras[pi];
      const sent = para && para.sents ? para.sents[si] : null;
      if (!sent) return;
      const patch = {};
      patch['paras[' + pi + '].sents[' + si + '].show'] = !sent.show;
      this.setData(patch);
    },

    /** 展开/收起题干中译（题干末尾「译」按钮）。 */
    onToggleStemZh(e) {
      const idx = Number(e.currentTarget.dataset.idx);
      const q = this.data.questions[idx];
      if (!q) return;
      const patch = {};
      patch['questions[' + idx + '].stemShow'] = !q.stemShow;
      this.setData(patch);
    },


    /** 展开/收起某个选项的中译（选项行内「译」按钮）。 */
    onToggleOptZh(e) {
      const ds = e.currentTarget.dataset;
      const idx = Number(ds.idx);
      const oi = Number(ds.oi);
      const q = this.data.questions[idx];
      const opt = q && q.opts ? q.opts[oi] : null;
      if (!opt) return;
      const patch = {};
      patch['questions[' + idx + '].opts[' + oi + '].show'] = !opt.show;
      this.setData(patch);
    },

    /* ------------------------------ 导航 ------------------------------ */

    /** 退出横屏页。 */
    onExit() {
      wx.navigateBack({
        fail: function () {
          wx.reLaunch({ url: '/pages/home/home' });
        }
      });
    }
  }
});
