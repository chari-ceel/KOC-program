from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from datetime import timedelta
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent))

from docker_queue import ActiveLock, DockerQueueManager, FileSpinLock, QueueEntry, StateStore, is_process_alive, iso_now


class DockerQueueManagerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_dir = tempfile.TemporaryDirectory()
        self.state_dir = Path(self.tmp_dir.name)
        self.store = StateStore(self.state_dir)
        self.manager = DockerQueueManager(
            store=self.store,
            stale_seconds=30,
            hostname="test-host",
            current_pid=os.getpid(),
        )

    def tearDown(self) -> None:
        self.tmp_dir.cleanup()

    def test_enqueue_appends_fifo(self) -> None:
        first = self.manager.enqueue(
            command=["docker", "compose", "up"],
            cwd="E:/Visual Code/KOC",
            session_id="session-a",
            label="启动环境",
        )
        second = self.manager.enqueue(
            command=["docker", "compose", "down"],
            cwd="E:/Visual Code/KOC",
            session_id="session-b",
            label="停止环境",
        )

        queue = self.store.read_queue()
        self.assertEqual([item.ticket_id for item in queue], [first.ticket_id, second.ticket_id])

    def test_status_returns_active_and_queue(self) -> None:
        now = iso_now()
        entry = QueueEntry(
            ticket_id="docker-1",
            session_id="session-a",
            command=["docker", "compose", "up"],
            cwd="E:/Visual Code/KOC",
            created_at=now,
            label="启动环境",
            hostname="test-host",
            pid=os.getpid(),
        )
        lock = ActiveLock(
            ticket_id="docker-lock",
            session_id="session-lock",
            command=["docker", "compose", "pull"],
            cwd="E:/Visual Code/KOC",
            acquired_at=now,
            heartbeat_at=now,
            label="拉取镜像",
            hostname="test-host",
            pid=os.getpid(),
        )
        self.store.ensure()
        self.store.write_queue([entry])
        self.store.write_lock(lock)

        status = self.manager.status()

        self.assertEqual(status["active"]["sessionId"], "session-lock")
        self.assertEqual(status["queue"][0]["sessionId"], "session-a")

    def test_release_removes_lock_and_queue_entry(self) -> None:
        entry = self.manager.enqueue(
            command=["docker", "compose", "up"],
            cwd="E:/Visual Code/KOC",
            session_id="session-a",
            label="启动环境",
        )
        self.store.write_lock(
            ActiveLock(
                ticket_id=entry.ticket_id,
                session_id=entry.session_id,
                command=entry.command,
                cwd=entry.cwd,
                acquired_at=entry.created_at,
                heartbeat_at=entry.created_at,
                label=entry.label,
                hostname=entry.hostname,
                pid=entry.pid,
            )
        )

        self.manager.release(entry.ticket_id)

        self.assertEqual(self.store.read_queue(), [])
        self.assertIsNone(self.store.read_lock())

    def test_state_files_are_json(self) -> None:
        entry = self.manager.enqueue(
            command=["docker", "compose", "up"],
            cwd="E:/Visual Code/KOC",
            session_id="session-a",
            label="启动环境",
        )
        raw = json.loads((self.state_dir / "queue.json").read_text(encoding="utf-8"))
        self.assertEqual(raw[0]["ticketId"], entry.ticket_id)

    def test_status_cleans_stale_queue_entry(self) -> None:
        self.store.ensure()
        self.store.write_queue(
            [
                QueueEntry(
                    ticket_id="docker-stale",
                    session_id="session-stale",
                    command=["docker", "compose", "up"],
                    cwd="E:/Visual Code/KOC",
                    created_at="2026-05-24T00:00:00+00:00",
                    label="陈旧任务",
                    hostname="test-host",
                    pid=123456,
                )
            ]
        )

        with patch("docker_queue.is_process_alive", return_value=False):
            status = self.manager.status()

        self.assertEqual(status["queue"], [])

    def test_status_cleans_stale_active_lock(self) -> None:
        self.store.ensure()
        self.store.write_lock(
            ActiveLock(
                ticket_id="docker-lock-stale",
                session_id="session-stale",
                command=["docker", "compose", "up"],
                cwd="E:/Visual Code/KOC",
                acquired_at="2026-05-24T00:00:00+00:00",
                heartbeat_at="2026-05-24T00:00:01+00:00",
                label="陈旧锁",
                hostname="test-host",
                pid=123456,
            )
        )

        with patch("docker_queue.is_process_alive", return_value=False):
            status = self.manager.status()

        self.assertIsNone(status["active"])


class ProcessAliveTests(unittest.TestCase):
    def test_windows_pid_match_is_exact_not_substring(self) -> None:
        fake_stdout = '"docker.exe","1234","Console","1","10,000 K"\r\n'

        class FakeResult:
            stdout = fake_stdout.encode("utf-8")

        with patch("docker_queue.os.name", "nt"), patch("docker_queue.subprocess.run", return_value=FakeResult()):
            self.assertFalse(is_process_alive(12))
            self.assertTrue(is_process_alive(1234))


class FileSpinLockTests(unittest.TestCase):
    def test_breaks_stale_fslock_when_owner_process_is_gone(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            lock_path = Path(tmp) / ".fslock"
            lock_path.write_text(json.dumps({"pid": 123456}), encoding="utf-8")

            with patch("docker_queue.is_process_alive", return_value=False):
                with FileSpinLock(lock_path):
                    self.assertTrue(lock_path.exists())

            self.assertFalse(lock_path.exists())


if __name__ == "__main__":
    unittest.main()
