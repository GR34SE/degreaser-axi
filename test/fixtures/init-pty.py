"""Drive compiled init through a real terminal, not a product test flag."""
import errno
import fcntl
import re
import struct
import termios
import json
import os
import pty
import select
import signal
import sys
import time

answers = iter(json.loads(sys.argv[1]))
next_answer = next(answers, None)
pid, fd = pty.fork()
if pid == 0:
    fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack("HHHH", 36, 100, 0, 0))
    os.execv(sys.argv[2], sys.argv[2:])

output = b""
pending = b""
deadline = time.monotonic() + 25
try:
    while time.monotonic() < deadline:
        if next_answer and isinstance(next_answer[0], dict):
            trigger = next_answer[0]
            if os.path.exists(trigger["file"]):
                with open(trigger["file"]) as source:
                    if trigger["contains"] in source.read():
                        os.write(fd, next_answer[1].encode())
                        next_answer = next(answers, None)
                        pending = b""
        if not select.select([fd], [], [], 0.1)[0]:
            continue
        try:
            chunk = os.read(fd, 65536)
        except OSError as error:
            if error.errno == errno.EIO:
                break
            raise
        if not chunk:
            break
        output += chunk
        pending += chunk
        plain = re.sub(rb"\x1b\[[0-?]*[ -/]*[@-~]", b"", pending)
        if next_answer and isinstance(next_answer[0], str) and next_answer[0].encode() in plain:
            os.write(fd, next_answer[1].encode())
            next_answer = next(answers, None)
            pending = b""
    else:
        os.kill(pid, signal.SIGKILL)
        raise TimeoutError("init terminal did not finish")
finally:
    os.close(fd)
    _, status = os.waitpid(pid, 0)
    sys.stdout.buffer.write(output)
sys.exit(os.waitstatus_to_exitcode(status))
