const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('学习通脚本.js', 'utf8');
let callback, cleared = false;
const context = vm.createContext({ console, Number,
  setInterval(fn) { callback = fn; cleared = false; return 1; },
  clearInterval() { cleared = true; } });
vm.runInContext(source.slice(source.indexOf('  function findUnfinishedChapter('), source.indexOf('  const pinia = pinia$1.createPinia()')) +
  '\nthis.find = findUnfinishedChapter; this.start = startDirectoryNavigation;', context);

function row({ done = false, count = '1', locked = false, title = '未完成章节' } = {}) {
  return { id: 'cur1', isConnected: true, clicks: 0,
    getAttribute(name) { return name === 'onclick' ? "toOld('1','2','3',0)" : name === 'title' ? title : null; },
    hasAttribute() { return false; }, click() { this.clicks++; },
    querySelector() { return { querySelector(selector) {
      if (selector === '.icon_yiwanc') return done ? {} : null;
      if (selector.includes('.icon-bukaifang')) return locked ? {} : null;
      if (selector === '.catalog_points_yi') return count === null ? null : { textContent: count };
      return null;
    } }; } };
}
const completed = row({ done: true }), restricted = row({ locked: true }), unfinished = row();
const doc = { readyState: 'interactive', documentElement: { dataset: {} }, querySelectorAll: () => [completed, restricted, unfinished], querySelector: () => ({}) };
assert.equal(context.find(doc), unfinished);
assert.equal(context.find({ querySelectorAll: () => [completed, restricted, row({ count: '0' }), row({ count: null })] }), null);
const frame = { isConnected: true, contentDocument: doc, contentWindow: {} };
const page = { document: { querySelector: () => frame } }; page.top = page;
context.start(page, () => ({ autoJump: true }), () => {});
callback();
assert.equal(unfinished.clicks, 1); assert.equal(cleared, true);
context.start(page, () => ({ autoJump: true }), () => {});
callback();
assert.equal(unfinished.clicks, 1, 'parent and child must not navigate twice');
delete doc.documentElement.dataset.autoChapterEntering;
let entered = 0;
const childPage = { document: doc, toOld() { entered++; } };
childPage.top = page;
doc.querySelector = selector => selector === '#frame_content-zj' ? null : {};
context.start(childPage, () => ({ autoJump: true }), () => {});
callback();
assert.equal(entered, 1, 'inner directory must enter via native handler while document is interactive');
context.start(page, () => ({ autoJump: false }), () => {});
callback();
assert.equal(unfinished.clicks, 1); assert.equal(cleared, true);
const loadingPage = { document: { querySelector: () => null } }; loadingPage.top = loadingPage;
context.start(loadingPage, () => ({ autoJump: true }), () => {});
for (let i = 0; i < 60; i++) callback();
assert.equal(cleared, true, 'missing iframe must stop after bounded wait');

// The overview opens on Tasks; activate the native Chapters menu before reading its iframe.
let menuClicks = 0;
const chapterMenu = { getAttribute: () => 'zj', classList: { contains: () => false }, click() { menuClicks++; } };
const targetChapter = row();
const overviewDoc = { documentElement: { dataset: {} }, querySelectorAll: () => [targetChapter], querySelector: () => ({}) };
const overviewFrame = { isConnected: true, contentDocument: overviewDoc, contentWindow: {} };
const overviewPage = { document: { querySelector: selector => selector.includes('stuNavigationList') ? chapterMenu : overviewFrame } };
context.start(overviewPage, () => ({ autoJump: true }), () => {});
callback();
assert.equal(menuClicks, 1); assert.equal(targetChapter.clicks, 0);
callback();
assert.equal(menuClicks, 1); assert.equal(targetChapter.clicks, 1);

// Check real saved directory markup without retaining account or transfer data in fixtures.
if (fs.existsSync('tiku/课程目录_files/studentcourse.html')) {
const html = fs.readFileSync('tiku/课程目录_files/studentcourse.html', 'utf8');
const chunks = html.split(/<div class="chapter_item" id="/).slice(1);
const rows = chunks.map(chunk => {
  const status = chunk.match(/<div class="catalog_task">([\s\S]*?)<\/div>\s*<\/div>/)?.[1] || '';
  return row({ title: chunk.match(/title="([^"]*)"/)?.[1], done: /icon_yiwanc/.test(status),
    locked: /icon-bukaifang|icon-dingshi|icon-chuangguan/.test(status),
    count: status.match(/class="catalog_points_yi">([^<]*)</)?.[1] ?? null });
});
const selected = context.find({ querySelectorAll: () => rows });
assert.ok(selected);
assert.equal(selected.getAttribute('title'), '科研人的基本价值共识');
console.log('Directory tests passed; saved page selects 2.3 科研人的基本价值共识.');
}
console.log('Directory regression checks passed.');
