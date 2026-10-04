// packageEn2/pages/read/read.js
// 英语二 做题「薄页面」：与 packageEn1 对称，复用共享工厂 utils/readPage.js，仅卷种与题库不同。
const passages = require('../../data/passages/index.js');
const { createReadPage } = require('../../../utils/readPage.js');

Page(createReadPage('en2', passages));
