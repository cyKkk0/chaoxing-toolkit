const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('学习通脚本.js', 'utf8');
const requests = [], logs = [];
let replies = [], config;
const context = vm.createContext({
  console: { log() {}, error() {} },
  getConfig: () => config,
  useAskStore: () => ({ log: (message, level) => logs.push({ message, level }) }),
  __publicField: (obj, key, value) => { obj[key] = value; },
  _unsafeWindow: {},
  _GM_xmlhttpRequest: request => {
    requests.push(request);
    const reply = replies.shift();
    if (reply === 'throw') throw new Error('Permission denied');
    if (reply === 'timeout') request.ontimeout();
    else if (reply === 'error') request.onerror({});
    else request.onload({ status: 200, ...reply });
  }
});
vm.runInContext(source.slice(source.indexOf('  class ServerApi'), source.indexOf('  function getDefaultExportFromCjs')) + '\nthis.ServerApi = ServerApi;', context);
vm.runInContext('const ' + source.slice(source.indexOf('logAnswerStep ='), source.indexOf('  }, setAnswer =')) + '\n}; this.getAnswers = getAnswers; this.fillAnswer = fillAnswer;', context);
const question = { question: '测试题目', type: '0', options: ['选项一', '选项二'] };
const aiReply = { responseText: JSON.stringify({ choices: [{ message: { content: 'B' } }] }) };
function reset(responses, overrides = {}) {
  config = { customApiEnabled: true, customApiUrl: 'http://localhost:8001/api/search', aiEnabled: true, aiApiKey: 'test-key', aiApiUrl: 'https://example.test/chat/completions', aiModel: 'test-model', ...overrides };
  requests.length = 0; logs.length = 0; replies = responses;
}
async function run() {
  for (const code of [-1, 0, 1]) {
    reset([{ responseText: JSON.stringify({ code, data: { answer: '选项一' } }) }]);
    const result = await context.getAnswers(question);
    assert.equal(result[0].answer, '选项一');
    assert.equal(requests.length, 1, 'local hit must skip AI');
    assert.ok(logs.some(item => item.message.includes('命中')));
    assert.equal(JSON.parse(requests[0].data).question, question.question);
  }
  for (const failure of [
    { responseText: '{"code":0,"msg":"未找到答案","data":{}}' },
    { responseText: 'invalid json' },
    { status: 500, responseText: '{"code":-1,"data":{"answer":"选项一"}}' },
    'timeout', 'error', 'throw'
  ]) {
    reset([failure, aiReply]);
    const result = await context.getAnswers(question);
    assert.equal(result[0].form, 'AI');
    assert.equal(result[0].answer[0], '选项二');
    assert.equal(requests.length, 2);
    assert.ok(logs.some(item => item.message.includes('回退')));
    assert.ok(logs.some(item => item.message.includes('AI：解析成功')));
    assert.ok(logs.every(item => !item.message.includes('test-key')));
  }
  reset([{ responseText: '{"code":0,"data":{}}' }], { aiEnabled: false });
  assert.equal((await context.getAnswers(question))[0].answer, '');
  assert.equal(requests.length, 1);
  assert.ok(logs.some(item => item.message.includes('AI：未启用')));
  reset([aiReply], { customApiEnabled: false });
  assert.equal((await context.getAnswers(question))[0].form, 'AI');
  assert.equal(requests.length, 1);
  reset([{ responseText: '{"code":0,"data":{}}' }, { status: 401, responseText: '{}' }]);
  assert.equal((await context.getAnswers(question))[0].answer, '');
  assert.ok(logs.some(item => item.message.includes('HTTP 401')));
  reset([{ responseText: '{"code":0,"data":{}}' }, { responseText: '{"choices":[{"message":{"content":"Z"}}]}' }]);
  assert.equal((await context.getAnswers(question))[0].answer, '');
  assert.ok(logs.some(item => item.message.includes('未取得可用答案')));
  context.setAnswer = () => '选项一';
  assert.equal(context.fillAnswer([{ form: '自定义题库', answer: '选项一' }], question, {}, {}), '选项一');
  assert.ok(logs.some(item => item.message.includes('填写完成，来源=自定义题库')));
  context.setAnswer = () => false;
  assert.equal(context.fillAnswer([{ form: 'AI', answer: ['选项二'] }], question, {}, {}), false);
  assert.ok(logs.some(item => item.message.includes('答案无法匹配或填写')));
  console.log('Local answer priority, AI fallback and step logging checks passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
