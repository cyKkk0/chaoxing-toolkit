const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('学习通脚本.js', 'utf8');
const clicks = [], logs = [];
let cleared = 0;
const context = vm.createContext({
  console: { log() {} },
  useAskStore: () => ({ log: message => logs.push(message) }),
  clearCurrent: () => { cleared++; },
  $$1: () => ({ find: selector => ({ eq: index => ({ click() { clicks.push({ selector, index }); } }) }) })
});
vm.runInContext('const ' + source.slice(source.indexOf('removeHtml ='), source.indexOf(', cl =')) + ';', context);
vm.runInContext('const ' + source.slice(source.indexOf('logAnswerStep ='), source.indexOf('  }, clearCurrent =')) +
  '\n}; this.match = matchAnswer; this.fill = fillAnswer;', context);
const options = ['直接的', '间接的', '狭义的', '广义的'];
const matched = value => Array.from(context.match(value, options));
assert.deepEqual(matched('狭义的#广义的'), [2, 3]);
assert.deepEqual(matched(['狭义的#广义的']), [2, 3]);
assert.deepEqual(matched(['狭义的', '广义的']), [2, 3], 'AI arrays must remain supported');
assert.deepEqual(matched([' 狭义的 # 广义的 ']), [2, 3]);
assert.deepEqual(matched(['<b>狭义的</b>', '广义的']), [2, 3]);
assert.deepEqual(matched(['狭义的#未知选项']), [], 'partial matches must not be filled');
assert.deepEqual(matched(['狭义的', '狭义的']), [2]);
assert.deepEqual(Array.from(context.match(['C#'], ['Java', 'C#'])), [1]);
const question = { question: '创业的含义可分为哪几种（）', type: '1', options };
const result = context.fill([{ form: '自定义题库', answer: '狭义的#广义的' }], question, {}, {});
assert.deepEqual(Array.from(result), ['狭义的', '广义的']);
assert.equal(cleared, 1);
assert.deepEqual(clicks.filter(click => click.selector.includes(':checkbox')).map(click => click.index), [2, 3]);
assert.ok(logs.some(message => message.includes('C.狭义的；D.广义的')));
assert.ok(logs.some(message => message.includes('填写完成')));
clicks.length = 0;
assert.equal(context.fill([{ form: '自定义题库', answer: '狭义的#未知选项' }], question, {}, {}), false);
assert.equal(clicks.length, 0);
assert.equal(context.fill([{ form: '自定义题库', answer: '狭义的#广义的' }], { ...question, type: '0' }, {}, {}), false);
assert.equal(clicks.length, 0);
console.log('Multi-select # parsing, AI arrays, complete matching and C/D filling checks passed.');
