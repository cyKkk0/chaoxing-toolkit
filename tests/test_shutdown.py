import asyncio
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tiku'))

import app
from app.database import AsyncDatabase


class ShutdownTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.db = AsyncDatabase(str(Path(self.temp.name) / 'questions.db'))

    async def asyncTearDown(self):
        await self.db.close()
        self.temp.cleanup()

    async def assert_closed(self, connection):
        with self.assertRaises(ValueError):
            await connection.execute('SELECT 1')
        # aiosqlite versions use either a separate Thread or a Thread subclass.
        worker = getattr(connection, '_thread', connection)
        await asyncio.to_thread(worker.join, 2)
        self.assertFalse(worker.is_alive())

    async def test_close_borrowed_and_idle_connections(self):
        borrowed = await self.db._get_connection()
        idle = await self.db._get_connection()
        await self.db._release_connection(idle)
        await asyncio.gather(self.db.close(), self.db.close())
        await self.db._release_connection(borrowed)
        await self.assert_closed(borrowed)
        await self.assert_closed(idle)
        self.assertEqual(self.db._connection_pool, [])
        with self.assertRaises(RuntimeError):
            await self.db._get_connection()

    async def test_repeated_cancellation_waits_for_worker(self):
        connection = await self.db._get_connection()
        started = asyncio.Event()
        finish = asyncio.Event()
        original_close = connection.close

        async def delayed_close():
            started.set()
            await finish.wait()
            await original_close()

        with patch.object(connection, 'close', delayed_close):
            task = asyncio.create_task(self.db.close())
            await started.wait()
            for _ in range(2):
                task.cancel()
                await asyncio.sleep(0)
                self.assertFalse(task.done())
            finish.set()
            with self.assertRaises(asyncio.CancelledError):
                await task
        await self.assert_closed(connection)

    async def test_connection_setup_cancellation_closes_worker(self):
        import aiosqlite
        connection = await aiosqlite.connect(self.db.db_file)
        async def connected(*args, **kwargs):
            return connection

        with patch('app.database.aiosqlite.connect', connected), patch.object(
            connection, 'create_function', side_effect=asyncio.CancelledError
        ):
            with self.assertRaises(asyncio.CancelledError):
                await self.db._get_connection()
        await self.assert_closed(connection)

    async def exercise_lifespan(self, cancelled):
        application = SimpleNamespace(state=SimpleNamespace())
        with patch.object(app, 'DATABASE_FILE', self.db.db_file), patch.object(
            app, 'JSON_FILE', str(Path(self.temp.name) / 'missing.json')
        ), patch.object(app, 'AsyncDatabase', return_value=self.db):
            context = app.lifespan(application)
            await context.__aenter__()
            connection = self.db._connection_pool[0]
            if cancelled:
                suppressed = await context.__aexit__(asyncio.CancelledError, asyncio.CancelledError(), None)
                self.assertFalse(suppressed)
            else:
                await context.__aexit__(None, None, None)
            await self.assert_closed(connection)

    async def test_normal_lifespan_exit(self):
        await self.exercise_lifespan(False)

    async def test_cancelled_lifespan_exit(self):
        await self.exercise_lifespan(True)

    async def test_cancelled_asgi_lifespan_task(self):
        from fastapi import FastAPI
        messages = asyncio.Queue()
        started = asyncio.Event()
        await messages.put({'type': 'lifespan.startup'})

        async def send(message):
            if message['type'] == 'lifespan.startup.complete':
                started.set()

        with patch.object(app, 'AsyncDatabase', return_value=self.db), patch.object(
            app, 'JSON_FILE', str(Path(self.temp.name) / 'missing.json')
        ):
            application = FastAPI(lifespan=app.lifespan)
            task = asyncio.create_task(application(
                {'type': 'lifespan', 'asgi': {'version': '3.0'}}, messages.get, send
            ))
            await asyncio.wait_for(started.wait(), 3)
            connection = self.db._connection_pool[0]
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await asyncio.wait_for(task, 3)
            await self.assert_closed(connection)

    async def test_startup_failure_closes_worker(self):
        connection = await self.db._get_connection()
        await self.db._release_connection(connection)
        with patch.object(app, 'AsyncDatabase', return_value=self.db), patch.object(
            self.db, 'init_db', side_effect=RuntimeError('startup failed')
        ):
            with self.assertRaisesRegex(RuntimeError, 'startup failed'):
                async with app.lifespan(SimpleNamespace(state=SimpleNamespace())):
                    self.fail('startup must fail')
        await self.assert_closed(connection)


if __name__ == '__main__':
    unittest.main()
