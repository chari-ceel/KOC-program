from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT_DIR = Path(__file__).resolve().parents[1]
STATE_DIR = ROOT_DIR / ".codex" / "docker-queue"
QUEUE_FILE = STATE_DIR / "queue.json"
LOCK_FILE = STATE_DIR / "lock.json"
DEFAULT_POLL_SECONDS = 5
DEFAULT_STALE_SECONDS = 60 * 60 * 4
DEFAULT_FSLOCK_STALE_SECONDS = 60


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utc_now().isoformat()


def parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def is_process_alive(pid: int | None) -> bool:
    if pid is None:
        return False
    try:
        if os.name == "nt":
            result = subprocess.run(
                ["tasklist", "/FI", f"PID eq {pid}", "/FO", "CSV", "/NH"],
                capture_output=True,
                text=False,
                check=False,
            )
            stdout = result.stdout.decode(errors="ignore")
            first_line = stdout.strip().splitlines()[0] if stdout.strip() else ""
            if not first_line or first_line.startswith("INFO:"):
                return False
            columns = [part.strip().strip('"') for part in first_line.split(",")]
            if len(columns) < 2:
                return False
            return columns[1] == str(pid)
        os.kill(pid, 0)
        return True
    except Exception:
        return False


@dataclass
class QueueEntry:
    ticket_id: str
    session_id: str
    command: list[str]
    cwd: str
    created_at: str
    label: str
    hostname: str
    pid: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "ticketId": self.ticket_id,
            "sessionId": self.session_id,
            "command": self.command,
            "cwd": self.cwd,
            "createdAt": self.created_at,
            "label": self.label,
            "hostname": self.hostname,
            "pid": self.pid,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "QueueEntry":
        return cls(
            ticket_id=str(data["ticketId"]),
            session_id=str(data["sessionId"]),
            command=list(data["command"]),
            cwd=str(data["cwd"]),
            created_at=str(data["createdAt"]),
            label=str(data.get("label") or ""),
            hostname=str(data.get("hostname") or ""),
            pid=int(data.get("pid") or 0),
        )


@dataclass
class ActiveLock:
    ticket_id: str
    session_id: str
    command: list[str]
    cwd: str
    acquired_at: str
    heartbeat_at: str
    label: str
    hostname: str
    pid: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "ticketId": self.ticket_id,
            "sessionId": self.session_id,
            "command": self.command,
            "cwd": self.cwd,
            "acquiredAt": self.acquired_at,
            "heartbeatAt": self.heartbeat_at,
            "label": self.label,
            "hostname": self.hostname,
            "pid": self.pid,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ActiveLock":
        return cls(
            ticket_id=str(data["ticketId"]),
            session_id=str(data["sessionId"]),
            command=list(data["command"]),
            cwd=str(data["cwd"]),
            acquired_at=str(data["acquiredAt"]),
            heartbeat_at=str(data.get("heartbeatAt") or data["acquiredAt"]),
            label=str(data.get("label") or ""),
            hostname=str(data.get("hostname") or ""),
            pid=int(data.get("pid") or 0),
        )


class StateStore:
    def __init__(self, state_dir: Path = STATE_DIR) -> None:
        self.state_dir = state_dir
        self.queue_file = state_dir / "queue.json"
        self.lock_file = state_dir / "lock.json"
        self.fs_lock_file = state_dir / ".fslock"

    def ensure(self) -> None:
        self.state_dir.mkdir(parents=True, exist_ok=True)

    def read_queue(self) -> list[QueueEntry]:
        data = self._read_json(self.queue_file, [])
        if not isinstance(data, list):
            return []
        entries: list[QueueEntry] = []
        for item in data:
            if isinstance(item, dict):
                try:
                    entries.append(QueueEntry.from_dict(item))
                except Exception:
                    continue
        return entries

    def write_queue(self, entries: list[QueueEntry]) -> None:
        self._write_json(self.queue_file, [entry.to_dict() for entry in entries])

    def read_lock(self) -> ActiveLock | None:
        data = self._read_json(self.lock_file, None)
        if not isinstance(data, dict):
            return None
        try:
            return ActiveLock.from_dict(data)
        except Exception:
            return None

    def write_lock(self, lock: ActiveLock | None) -> None:
        if lock is None:
            if self.lock_file.exists():
                self.lock_file.unlink()
            return
        self._write_json(self.lock_file, lock.to_dict())

    def _read_json(self, path: Path, default: Any) -> Any:
        if not path.exists():
            return default
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return default

    def _write_json(self, path: Path, payload: Any) -> None:
        tmp_path = path.with_suffix(path.suffix + ".tmp")
        tmp_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        os.replace(tmp_path, path)


class FileSpinLock:
    def __init__(
        self,
        path: Path,
        poll_seconds: float = 0.2,
        stale_seconds: int = DEFAULT_FSLOCK_STALE_SECONDS,
    ) -> None:
        self.path = path
        self.poll_seconds = poll_seconds
        self.stale_seconds = stale_seconds
        self.handle: int | None = None

    def __enter__(self) -> "FileSpinLock":
        while True:
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                self.handle = os.open(str(self.path), os.O_CREAT | os.O_EXCL | os.O_RDWR)
                os.write(
                    self.handle,
                    json.dumps(
                        {
                            "pid": os.getpid(),
                            "createdAt": iso_now(),
                        },
                        ensure_ascii=False,
                    ).encode("utf-8"),
                )
                return self
            except FileExistsError:
                self._break_stale_lock()
                time.sleep(self.poll_seconds)

    def __exit__(self, exc_type, exc, tb) -> None:
        if self.handle is not None:
            os.close(self.handle)
            self.handle = None
        try:
            self.path.unlink()
        except FileNotFoundError:
            pass

    def _break_stale_lock(self) -> None:
        try:
            stat = self.path.stat()
        except FileNotFoundError:
            return

        age = time.time() - stat.st_mtime
        metadata = self._read_metadata()
        pid = metadata.get("pid") if isinstance(metadata, dict) else None
        pid_is_alive = is_process_alive(pid) if isinstance(pid, int) else False

        if (not pid_is_alive) or age > self.stale_seconds:
            try:
                self.path.unlink()
            except FileNotFoundError:
                pass

    def _read_metadata(self) -> dict[str, Any] | None:
        try:
            raw = self.path.read_text(encoding="utf-8").strip()
            if not raw:
                return None
            data = json.loads(raw)
            return data if isinstance(data, dict) else None
        except Exception:
            return None


class DockerQueueManager:
    def __init__(
        self,
        store: StateStore | None = None,
        stale_seconds: int = DEFAULT_STALE_SECONDS,
        hostname: str | None = None,
        current_pid: int | None = None,
    ) -> None:
        self.store = store or StateStore()
        self.stale_seconds = stale_seconds
        self.hostname = hostname or socket.gethostname()
        self.current_pid = current_pid or os.getpid()

    def enqueue(
        self,
        command: list[str],
        cwd: str,
        session_id: str,
        label: str,
    ) -> QueueEntry:
        entry = QueueEntry(
            ticket_id=f"docker-{uuid.uuid4().hex[:12]}",
            session_id=session_id,
            command=command,
            cwd=cwd,
            created_at=iso_now(),
            label=label,
            hostname=self.hostname,
            pid=self.current_pid,
        )
        with FileSpinLock(self.store.fs_lock_file):
            self.store.ensure()
            self._cleanup_stale_state()
            queue = self.store.read_queue()
            queue = [item for item in queue if item.ticket_id != entry.ticket_id]
            queue.append(entry)
            self.store.write_queue(queue)
        return entry

    def wait_until_turn(
        self,
        ticket_id: str,
        poll_seconds: int = DEFAULT_POLL_SECONDS,
        stream: Any = sys.stderr,
    ) -> ActiveLock:
        while True:
            with FileSpinLock(self.store.fs_lock_file):
                self.store.ensure()
                self._cleanup_stale_state()
                queue = self.store.read_queue()
                queue = self._dedupe_queue(queue)
                self.store.write_queue(queue)
                lock = self.store.read_lock()

                queue_index = next((i for i, item in enumerate(queue) if item.ticket_id == ticket_id), None)
                if queue_index is None:
                    raise RuntimeError(f"队列票据不存在: {ticket_id}")

                if queue_index == 0 and lock is None:
                    entry = queue.pop(0)
                    active = ActiveLock(
                        ticket_id=entry.ticket_id,
                        session_id=entry.session_id,
                        command=entry.command,
                        cwd=entry.cwd,
                        acquired_at=iso_now(),
                        heartbeat_at=iso_now(),
                        label=entry.label,
                        hostname=entry.hostname,
                        pid=entry.pid,
                    )
                    self.store.write_queue(queue)
                    self.store.write_lock(active)
                    return active

                message = self._build_wait_message(queue_index, lock)
            print(message, file=stream, flush=True)
            time.sleep(poll_seconds)

    def heartbeat(self, ticket_id: str) -> None:
        with FileSpinLock(self.store.fs_lock_file):
            lock = self.store.read_lock()
            if lock and lock.ticket_id == ticket_id:
                lock.heartbeat_at = iso_now()
                self.store.write_lock(lock)

    def release(self, ticket_id: str) -> None:
        with FileSpinLock(self.store.fs_lock_file):
            queue = self.store.read_queue()
            queue = [item for item in queue if item.ticket_id != ticket_id]
            self.store.write_queue(queue)
            lock = self.store.read_lock()
            if lock and lock.ticket_id == ticket_id:
                self.store.write_lock(None)

    def status(self) -> dict[str, Any]:
        with FileSpinLock(self.store.fs_lock_file):
            self.store.ensure()
            self._cleanup_stale_state()
            queue = self._dedupe_queue(self.store.read_queue())
            self.store.write_queue(queue)
            lock = self.store.read_lock()
            return {
                "active": lock.to_dict() if lock else None,
                "queue": [item.to_dict() for item in queue],
            }

    def _cleanup_stale_state(self) -> None:
        queue = self.store.read_queue()
        cleaned_queue = [item for item in queue if not self._is_queue_entry_stale(item)]
        if len(cleaned_queue) != len(queue):
            self.store.write_queue(cleaned_queue)

        lock = self.store.read_lock()
        if lock is None:
            return
        if self._is_stale(lock):
            self.store.write_lock(None)

    def _is_queue_entry_stale(self, entry: QueueEntry) -> bool:
        created_at = parse_timestamp(entry.created_at)
        if created_at is None:
            return True
        age = (utc_now() - created_at).total_seconds()
        if age > self.stale_seconds:
            return True
        if not is_process_alive(entry.pid):
            return True
        return False

    def _is_stale(self, lock: ActiveLock) -> bool:
        heartbeat_at = parse_timestamp(lock.heartbeat_at) or parse_timestamp(lock.acquired_at)
        if heartbeat_at is None:
            return True
        age = (utc_now() - heartbeat_at).total_seconds()
        if age > self.stale_seconds:
            return True
        if not is_process_alive(lock.pid):
            return True
        return False

    def _dedupe_queue(self, queue: list[QueueEntry]) -> list[QueueEntry]:
        seen: set[str] = set()
        deduped: list[QueueEntry] = []
        for item in queue:
            if item.ticket_id in seen:
                continue
            seen.add(item.ticket_id)
            deduped.append(item)
        return deduped

    def _build_wait_message(self, queue_index: int, lock: ActiveLock | None) -> str:
        position = queue_index + 1
        if lock:
            label = lock.label or "docker 操作"
            owner = lock.session_id
            return f"[docker-queue] 当前有进行中的 {label}（session={owner}），已排队，当前位次 {position}，5 秒后重试。"
        return f"[docker-queue] 当前前方还有 {queue_index} 个待执行 Docker 操作，已排队，当前位次 {position}，5 秒后重试。"


def build_default_command(detach: bool) -> list[str]:
    command = ["docker", "compose", "-f", "docker-compose.full.yml", "up", "--build"]
    if detach:
        command.append("-d")
    return command


def build_shell_command(shell_command: str) -> list[str]:
    if os.name == "nt":
        return ["powershell", "-NoProfile", "-Command", shell_command]
    return ["bash", "-lc", shell_command]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="KOC Docker 队列执行器")
    subparsers = parser.add_subparsers(dest="mode", required=False)

    run_parser = subparsers.add_parser("run", help="排队后执行 Docker 命令")
    run_parser.add_argument(
        "--session-id",
        required=True,
        help="当前 Agent/会话的唯一标识",
    )
    run_parser.add_argument(
        "--label",
        default="docker compose",
        help="展示给排队提示的操作标签",
    )
    run_parser.add_argument(
        "--cwd",
        default=str(ROOT_DIR),
        help="执行目录，默认仓库根目录",
    )
    run_parser.add_argument(
        "--poll-seconds",
        type=int,
        default=DEFAULT_POLL_SECONDS,
        help="排队轮询间隔，默认 5 秒",
    )
    run_parser.add_argument(
        "--detach",
        action="store_true",
        help="快捷执行默认的 up --build -d",
    )
    run_parser.add_argument(
        "--shell-command",
        help="把多条 Docker 命令作为同一个批次执行，并在整个批次期间持有队列锁",
    )
    run_parser.add_argument(
        "command",
        nargs=argparse.REMAINDER,
        help="要执行的 docker 命令；为空时使用默认 compose up 命令",
    )

    status_parser = subparsers.add_parser("status", help="查看当前 Docker 队列状态")
    status_parser.add_argument("--json", action="store_true", help="输出 JSON")

    clear_parser = subparsers.add_parser("clear-stale", help="清理过期锁")
    clear_parser.add_argument(
        "--stale-seconds",
        type=int,
        default=DEFAULT_STALE_SECONDS,
        help="锁过期阈值",
    )

    parser.set_defaults(mode="run")
    return parser.parse_args()


def normalize_command(raw_command: list[str], detach: bool, shell_command: str | None) -> list[str]:
    if shell_command:
        return build_shell_command(shell_command)
    if raw_command:
        command = list(raw_command)
        if command and command[0] == "--":
            command = command[1:]
        return command
    return build_default_command(detach=detach)


def run_command(args: argparse.Namespace) -> int:
    command = normalize_command(args.command, detach=args.detach, shell_command=args.shell_command)
    session_id = args.session_id
    cwd = str(Path(args.cwd).resolve())
    manager = DockerQueueManager()
    entry = manager.enqueue(command=command, cwd=cwd, session_id=session_id, label=args.label)
    lock = manager.wait_until_turn(entry.ticket_id, poll_seconds=args.poll_seconds)
    print(
        f"[docker-queue] 已获取执行权，ticket={lock.ticket_id}，session={lock.session_id}，命令={' '.join(command)}",
        file=sys.stderr,
        flush=True,
    )

    process = None
    try:
        process = subprocess.Popen(command, cwd=cwd)
        while True:
            manager.heartbeat(lock.ticket_id)
            return_code = process.poll()
            if return_code is not None:
                return return_code
            time.sleep(1)
    finally:
        if process is not None and process.poll() is None:
            try:
                process.terminate()
            except Exception:
                pass
        manager.release(lock.ticket_id)
        print(f"[docker-queue] 已释放执行权，ticket={lock.ticket_id}", file=sys.stderr, flush=True)


def show_status(args: argparse.Namespace) -> int:
    manager = DockerQueueManager()
    status = manager.status()
    if args.json:
        print(json.dumps(status, ensure_ascii=False, indent=2))
        return 0

    active = status["active"]
    queue = status["queue"]
    if active:
        print(
            f"active: session={active['sessionId']} label={active['label']} command={' '.join(active['command'])}"
        )
    else:
        print("active: none")
    if queue:
        for index, item in enumerate(queue, start=1):
            print(
                f"queue[{index}]: session={item['sessionId']} label={item['label']} command={' '.join(item['command'])}"
            )
    else:
        print("queue: empty")
    return 0


def clear_stale(args: argparse.Namespace) -> int:
    manager = DockerQueueManager(stale_seconds=args.stale_seconds)
    manager.status()
    print("[docker-queue] 已清理过期锁。")
    return 0


def main() -> int:
    args = parse_args()
    if args.mode == "status":
        return show_status(args)
    if args.mode == "clear-stale":
        return clear_stale(args)
    return run_command(args)


if __name__ == "__main__":
    raise SystemExit(main())
