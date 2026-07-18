import argparse
import getpass
import socket
import sys
from typing import Optional

import paramiko


DEFAULT_HOST = "119.29.132.10"
DEFAULT_PORT = 22
DEFAULT_USER = "fy"


def prompt_password() -> str:
    gui_password = prompt_password_gui()
    if gui_password is not None:
        return gui_password

    return prompt_password_cli()


def prompt_password_gui() -> Optional[str]:
    try:
        import tkinter as tk
        from tkinter import simpledialog
    except Exception:
        return None

    root = tk.Tk()
    root.withdraw()
    root.attributes("-topmost", True)

    try:
        password = simpledialog.askstring(
            "SSH 登录",
            f"请输入 {DEFAULT_USER}@{DEFAULT_HOST} 的密码：",
            show="*",
            parent=root,
        )
        if password is None:
            print("已取消输入密码。", file=sys.stderr)
            raise SystemExit(1)
        return password
    except SystemExit:
        raise
    except Exception:
        return None
    finally:
        root.destroy()


def prompt_password_cli() -> str:
    try:
        return getpass.getpass("SSH password: ")
    except (EOFError, KeyboardInterrupt):
        print("\n已取消输入密码。", file=sys.stderr)
        raise SystemExit(1)


def run_remote_command(
    host: str,
    port: int,
    user: str,
    password: str,
    command: str,
    timeout: int,
) -> int:
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())

    try:
        client.connect(
            hostname=host,
            port=port,
            username=user,
            password=password,
            timeout=timeout,
            banner_timeout=timeout,
            auth_timeout=timeout,
            look_for_keys=False,
            allow_agent=False,
        )
        stdin, stdout, stderr = client.exec_command(command)
        exit_code = stdout.channel.recv_exit_status()

        out_text = stdout.read().decode("utf-8", errors="replace")
        err_text = stderr.read().decode("utf-8", errors="replace")

        if out_text:
            print(out_text, end="")
        if err_text:
            print(err_text, end="", file=sys.stderr)

        return exit_code
    except paramiko.AuthenticationException:
        print("SSH 认证失败：用户名或密码不正确。", file=sys.stderr)
        return 255
    except (paramiko.SSHException, socket.error, TimeoutError) as exc:
        print(f"SSH 连接失败：{exc}", file=sys.stderr)
        return 255
    finally:
        client.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="输入密码后执行远程 SSH 命令。"
    )
    parser.add_argument(
        "command",
        nargs="?",
        default="whoami && hostname && groups",
        help="要在远程服务器执行的命令",
    )
    parser.add_argument("--host", default=DEFAULT_HOST, help="SSH 主机地址")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="SSH 端口")
    parser.add_argument("--user", default=DEFAULT_USER, help="SSH 用户名")
    parser.add_argument(
        "--password",
        help="直接传入密码；不传时会弹出安全输入提示",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=10,
        help="连接超时时间（秒）",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    password: Optional[str] = args.password or prompt_password()
    return run_remote_command(
        host=args.host,
        port=args.port,
        user=args.user,
        password=password,
        command=args.command,
        timeout=args.timeout,
    )


if __name__ == "__main__":
    raise SystemExit(main())
