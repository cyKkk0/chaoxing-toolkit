const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('学习通脚本.js', 'utf8');
const context = vm.createContext({ console, Number, Array, setInterval, clearInterval });
vm.runInContext(source.slice(source.indexOf('  class Cx {'), source.indexOf('  const pinia = pinia$1.createPinia()')) + '\nthis.Cx = Cx;', context);
const store = () => ({ task: { video: {}, work: {} }, reset() {}, insert() {}, get() { return {}; }, log() {}, msg() {} });

async function testVideo() {
  const timers = new Map(), events = new Map();
  let ended = false, duration = 0, time = 0, paused = false, plays = 0, now = 0;
  Object.assign(context, {
    waitElementLoaded: async () => {},
    setInterval: (fn) => { timers.set(1, fn); return 1; },
    clearInterval: (id) => timers.delete(id),
    Date: { now: () => now },
  });
  const player = { muted() {}, playbackRate() {}, play: () => { plays++; paused = false; return Promise.resolve(); },
    on: (name, fn) => events.set(name, fn), off: (name) => events.delete(name),
    ended: () => ended, paused: () => paused, duration: () => duration, currentTime: () => time };
  const model = Object.create(context.Cx.prototype);
  model.askStore = store();
  let settled = false;
  const promise = model.video({ videojs: () => player }).then(value => { settled = true; return value; });
  await new Promise(setImmediate);
  timers.get(1)();
  await Promise.resolve();
  assert.equal(settled, false, 'missing isUnFinishJob must not complete video');
  assert.equal(plays, 1);
  paused = true; now = 4000;
  timers.get(1)();
  await new Promise(setImmediate);
  assert.equal(plays, 2, 'paused unfinished video should resume');
  paused = true; now = 4500;
  timers.get(1)();
  await new Promise(setImmediate);
  assert.equal(plays, 2, 'resume attempts should be throttled');
  ended = true;
  events.get('ended')();
  await Promise.resolve();
  assert.equal(settled, false, 'zero duration must not complete video');
  duration = 100; time = 10;
  events.get('ended')();
  await Promise.resolve();
  assert.equal(settled, false, 'premature ended event must not complete video');
  time = 100;
  events.get('ended')();
  assert.equal(await promise, true);
  assert.equal(timers.size, 0);
  assert.equal(plays, 2, 'ended video must not replay');
  const canceled = model.video({ videojs: () => player }, () => false);
  assert.equal(await canceled, false);
}

async function testWork() {
  let submitted = 0, saved = 0;
  Object.assign(context, { decode() {}, getQuestion: () => ({}), randomSleep: async () => {},
    sleep: async () => {}, getAnswers: async () => [], fillAnswer: () => false });
  const model = Object.create(context.Cx.prototype);
  model.askStore = store();
  model.defaultConfig = { autoSubmit: true, minAccuracy: 0.8 };
  const win = { document: { querySelectorAll: () => [{}] }, noSubmit: () => saved++,
    btnBlueSubmit: () => submitted++, submitCheckTimes: () => submitted++ };
  assert.equal(await model.work(win), false);
  assert.equal(saved, 1); assert.equal(submitted, 0);
  context.fillAnswer = () => 'answer';
  model.defaultConfig.autoSubmit = false;
  assert.equal(await model.work(win), false);
  assert.equal(submitted, 0);
  model.defaultConfig.autoSubmit = true;
  assert.equal(await model.work(win), true);
  assert.equal(submitted, 2);
  win.document.querySelectorAll = () => [];
  assert.equal(await model.work(win), false);
}

async function testChapter() {
  const start = source.indexOf('      const startWork = async (cardsIframe');
  const end = source.indexOf('      let checkingChapter', start);
  let jumps = 0, marked = false, connected = true;
  const job = { get isConnected() { return connected; }, parentElement: {
    classList: { contains: () => marked }, querySelector: () => taskFrame } };
  const doc = { querySelectorAll: () => [job] };
  const frame = { isConnected: true, contentDocument: doc, contentWindow: { location: { href: 'chapter' } } };
  const taskFrame = { src: '/ananas/modules/video/index.html', contentWindow: {} };
  const model = { askStore: store(), video: async () => true };
  Object.assign(context, { _self: { document: { querySelector: () => frame } },
    top: { document: { querySelector: () => ({ click: () => jumps++, getAttribute: () => null }) } },
    cxModel: model, formStore: { forminput: { autoVideo: true, autoJump: true, interval: 0 } },
    sleep: async () => {}, waitIframeLoaded: async () => {} });
  vm.runInContext(start >= 0 ? source.slice(start, end) + '\nthis.startWork = startWork;' : '', context);
  await context.startWork(frame, doc, 'chapter');
  assert.equal(jumps, 0, 'media ended without platform confirmation must not jump');
  model.video = async () => { marked = true; return true; };
  await context.startWork(frame, doc, 'chapter');
  assert.equal(jumps, 1, 'confirmed completion permits jumping');
  marked = false;
  context.formStore.forminput.autoVideo = false;
  await context.startWork(frame, doc, 'chapter');
  assert.equal(jumps, 1, 'disabled task must not be skipped');
  context.formStore.forminput.autoVideo = true;
  model.video = async () => { frame.contentDocument = {}; return true; };
  await context.startWork(frame, doc, 'chapter');
  assert.equal(jumps, 1, 'stale chapter must not jump');
}

(async () => {
  await testVideo(); await testWork(); await testChapter();
  console.log('Video, quiz and chapter navigation regression checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
