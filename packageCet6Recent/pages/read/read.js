// 薄页面：createReadPage 收敛逻辑；本包与同卷种另一包共用卷种 id 'cet6'。
const passages = require('../../data/passages/index.js');
const { createReadPage } = require('../../../utils/readPage.js');
Page(createReadPage('cet6', passages));
