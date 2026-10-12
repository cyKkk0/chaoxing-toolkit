const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('学习通脚本.js', 'utf8');
let tick, stopped, messages = [];
const context = vm.createContext({ console, URL, Map, Set,
  setInterval(fn) { tick = fn; stopped = false; messages = []; return 1; },
  clearInterval() { stopped = true; } });
vm.runInContext(source.slice(source.indexOf('  function inspectCourseList('), source.indexOf('  function findUnfinishedChapter(')) +
  '\nthis.inspect = inspectCourseList; this.start = startCourseListNavigation; this.space = startPersonalSpaceNavigation;', context);
function card(name, progress, blocked = false) {
  const link = { href: 'https://mooc1.chaoxing.com/visit/stucoursemiddle?courseid=1&clazzid=2&cpi=3' };
  return { isConnected: true, id: name, getAttribute: () => name,
    querySelector(selector) {
      if (selector === '.course-name') return { textContent: name };
      if (selector.startsWith('.course-info')) return link;
      if (selector === '.btm-cover .l-txt') return progress === null ? null : { textContent: progress };
      if (selector === '.not-open-tip') return blocked ? {} : null;
      return null;
    } };
}
function start(cards, enabled = true) {
  const page = { document: { documentElement: { dataset: {} }, querySelectorAll: () => cards },
    location: { href: 'https://mooc2-ans.chaoxing.com/visit/interaction' } };
  page.top = page;
  context.start(page, () => ({ autoJump: enabled }), (message) => messages.push(message));
  return page;
}
const done = card('已完成', '97/97'), empty = card('无任务点', '0/0');
const locked = card('未开放', '0/10', true), pending = card('待完成', '16/190');
let page = start([done, empty, locked, pending]);
tick();
assert.equal(stopped, true);
assert.ok(page.location.href.includes('stucoursemiddle'));
assert.ok(messages.some(message => message.includes('进入 待完成')));
page = start([done, empty, locked]); tick();
assert.ok(page.location.href.includes('interaction'));
assert.ok(messages.some(message => message.includes('没有可进入')));
page = start([pending], false); tick();
assert.equal(stopped, true); assert.ok(page.location.href.includes('interaction'));
const loading = card('待加载', null);
page = start([loading]);
let loads = 0;
page.batchLoadJobInfo = roles => { assert.equal(roles.length, 1); loads++; };
tick(); tick();
assert.equal(loads, 1, 'native progress loading should not repeat');
assert.equal(stopped, false);
for (let i = 0; i < 60; i++) tick();
assert.equal(stopped, true); assert.ok(messages.some(message => message.includes('超时')));
page = start([pending]); tick();
context.start(page, () => ({ autoJump: true }), () => {}); tick();
assert.equal(stopped, true, 'repeat initialization must not enter twice');
const space = { addEventListener() {}, document: { querySelector: () => ({ classList: { contains: () => false }, click() { loads++; } }) } };
context.space(space, () => ({ autoJump: true }), () => {}); tick();
assert.equal(loads, 2); assert.equal(stopped, true);

// The cross-origin frame must ask its parent to navigate instead of touching top.location.
page = start([pending]);
let navigationRequest;
page.top = {
  postMessage(data, origin) { navigationRequest = { data, origin }; },
  get location() { throw new Error('Cross-origin top navigation is blocked'); }
};
tick();
assert.equal(navigationRequest.origin, 'https://i.chaoxing.com');
assert.equal(navigationRequest.data.type, 'chaoxing-toolkit-enter-course');
assert.ok(page.location.href.includes('/visit/interaction'));
let messageHandler;
const frameWindow = {};
const frame = { contentWindow: frameWindow, src: 'https://mooc2-ans.chaoxing.com/visit/interaction' };
const parent = { location: { href: 'https://i.chaoxing.com/base' },
  addEventListener(type, handler) { assert.equal(type, 'message'); messageHandler = handler; },
  document: { querySelector(selector) { return selector === '#frame_content' ? frame : null; } } };
context.space(parent, () => ({ autoJump: true }), () => {});
const request = { source: frameWindow, origin: 'https://mooc2-ans.chaoxing.com', data: navigationRequest.data };
messageHandler({ ...request, source: {} });
assert.equal(parent.location.href, 'https://i.chaoxing.com/base', 'ignore other windows');
messageHandler({ ...request, origin: 'https://evil.example' });
assert.equal(parent.location.href, 'https://i.chaoxing.com/base', 'ignore another origin');
messageHandler({ ...request, data: { ...request.data, url: 'https://evil.example/visit/stucoursemiddle' } });
assert.equal(parent.location.href, 'https://i.chaoxing.com/base', 'reject external destinations');
messageHandler(request);
assert.equal(parent.location.href, request.data.url);

// Extract only course names, progress and availability from the provided saved iframe.
if (fs.existsSync('tiku/个人空间_files/interaction.html') && fs.existsSync('tiku/课程界面.html')) {
const html = fs.readFileSync('tiku/个人空间_files/interaction.html', 'utf8');
const cards = html.split(/<div class="course clearfix\s+learnCourse /).slice(1).map(chunk =>
  card(chunk.match(/class="course-name[^\"]*"[^>]*>([^<]*)</)?.[1] || '',
    chunk.match(/class="fl l-txt">([^<]*)</)?.[1] || null, /class="not-open-tip"/.test(chunk)));
const inspected = context.inspect({ querySelectorAll: () => cards });
const unfinished = inspected.filter(course => course.unfinished);
assert.equal(unfinished.length, 2);
assert.equal(unfinished[0].name, '创新创业基础');
assert.equal(unfinished[0].total, 97);
assert.equal(unfinished[1].finished, 16);
assert.equal(unfinished[1].total, 190);
const overview = fs.readFileSync('tiku/课程界面.html', 'utf8');
assert.ok(/dataname="zj"/.test(overview));
assert.ok(/title="章节" data-url="\/mooc2-ans\/mycourse\/studentcourse"/.test(overview));
console.log('Optional local saved HTML checks passed.');
}
console.log('Course scanning, progress loading and navigation gates passed.');
