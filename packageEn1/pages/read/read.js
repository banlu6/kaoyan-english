// packageEn1/pages/read/read.js
// 英语一 做题「薄页面」：页面逻辑已收敛到共享工厂 utils/readPage.js，
// 此处仅静态 require 本分包题库并声明卷种 id，避免与 packageEn2 逐字重复。
const passages = require('../../data/passages/index.js');
const { createReadPage } = require('../../../utils/readPage.js');

Page(createReadPage('en1', passages));
