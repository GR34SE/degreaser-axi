"""Drive compiled init through a real terminal, not a product test flag."""
import errno
import json
import os
import pty
import select
import signal
import sys
import time

answers = iter(json.loads(sys.argv[1]))
pid, fd = pty.fork()
if pid == 0:
    os.execv(sys.argv[2], sys.argv[2:])

output = b""
pending = b""
deadline = time.monotonic() + 25
try:
    while time.monotonic() < deadline:
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
        if b"> " in pending:
            os.write(fd, next(answers, "\x04").encode())
            pending = b""
    else:
        os.kill(pid, signal.SIGKILL)
        raise TimeoutError("init terminal did not finish")
finally:
    os.close(fd)
    _, status = os.waitpid(pid, 0)
    sys.stdout.buffer.write(output)
sys.exit(os.waitstatus_to_exitcode(status))
