import json
from pathlib import Path
from types import SimpleNamespace
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tiku'))

from app.database import AsyncDatabase
from app.matching import question_match_key
from app.routes.search import search_answer
from app.schemas import SearchRequest


class MatchingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = AsyncDatabase(str(Path(self.temp.name) / 'questions.db'))
        await self.db.init_db()
        questions = json.loads((ROOT / 'tiku' / 'tiku.json').read_text(encoding='utf-8'))
        self.target = next(q for q in questions if q['question'].startswith('通过创新创业课程学生需要掌握'))
        conn = await self.db._get_connection()
        try:
            await conn.executemany(
                'INSERT INTO questions(question, type, options, answer) VALUES (?, ?, ?, ?)',
                [(f'模拟题目编号{i:04d}用于验证匹配候选截断', '1', '[]', '模拟答案') for i in range(600)]
            )
            await conn.execute(
                'INSERT INTO questions(question, type, options, answer) VALUES (?, ?, ?, ?)',
                (self.target['question'], self.target['type'], json.dumps(self.target['options']), self.target['answer'])
            )
            await conn.commit()
        finally:
            await self.db._release_connection(conn)

    async def asyncTearDown(self):
        for conn in self.db._connection_pool:
            await conn.close()
        self.temp.cleanup()

    async def test_fullwidth_question_mark_beyond_500_candidates(self):
        question = self.target['question'].rstrip('?') + '？'
        result = await self.db.find_by_question(question, '1', self.target['options'])
        self.assertIsNotNone(result)
        self.assertEqual(result['answer'], self.target['answer'])
        request = SimpleNamespace(app=SimpleNamespace(state=SimpleNamespace(db=self.db)))
        response = await search_answer(SearchRequest(question=question, type='1', options=self.target['options'], key=''), request)
        self.assertEqual(response.code, -1)
        self.assertEqual(response.data['answer'], '基础知识#基本理论#基本流程#基本方法')

    async def test_original_question_still_matches(self):
        result = await self.db.find_by_question(self.target['question'], '1')
        self.assertEqual(result['answer'], self.target['answer'])

    async def test_missing_question_remains_missing(self):
        self.assertIsNone(await self.db.find_by_question('不存在的量子光学实验问题', '1'))

    def test_normalization_preserves_meaningful_content(self):
        self.assertEqual(question_match_key('ＡＢＣ 是什么？ '), question_match_key('ABC是什么?'))
        self.assertEqual(question_match_key('题目。'), question_match_key('题目'))
        self.assertNotEqual(question_match_key('正确'), question_match_key('不正确'))
        self.assertNotEqual(question_match_key('公式(x+1)?'), question_match_key('公式(x-1)？'))


if __name__ == '__main__':
    unittest.main()
