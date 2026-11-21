"""Own the lifetime of an ACP adapter and its child processes."""

import asyncio
import os
import shutil
import signal
import sys
from collections.abc import AsyncIterator, Mapping
from contextlib import asynccontextmanager, suppress
from pathlib import Path

if sys.platform == "win32":
    import win32api
    import win32con
    import win32job

# The launcher consumes one byte before inheriting the ACP pipes to the adapter.
# This keeps the adapter from spawning descendants before assignment to the job.
_WINDOWS_LAUNCHER = """\
import os, subprocess, sys
if os.read(0, 1) != b'+':
    sys.exit(1)
sys.exit(subprocess.call(sys.argv[1:], stdin=sys.stdin, stdout=sys.stdout, stderr=sys.stderr))
"""
_SHUTDOWN_TIMEOUT = 2


def _windows_job():
    job = win32job.CreateJobObject(None, "")
    try:
        limits = win32job.QueryInformationJobObject(job, win32job.JobObjectExtendedLimitInformation)
        limits["BasicLimitInformation"]["LimitFlags"] |= win32job.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        win32job.SetInformationJobObject(job, win32job.JobObjectExtendedLimitInformation, limits)
    except BaseException:
        job.Close()
        raise
    return job


async def _wait_for_exit(process: asyncio.subprocess.Process) -> None:
    async with asyncio.timeout(_SHUTDOWN_TIMEOUT):
        await process.wait()


def _signal_group(pid: int, sig: int) -> None:
    with suppress(ProcessLookupError):
        os.killpg(pid, sig)


@asynccontextmanager
async def spawn_owned_agent(
    executable: str, *args: str, cwd: Path, env: Mapping[str, str]
) -> AsyncIterator[asyncio.subprocess.Process]:
    windows = sys.platform == "win32"
    job = _windows_job() if windows else None
    process = None
    assigned = False
    try:
        command = (executable, *args)
        if windows:
            resolved = shutil.which(executable)
            if resolved is None:
                raise FileNotFoundError(f"ACP adapter executable not found: {executable}")
            command = (sys.executable, "-I", "-c", _WINDOWS_LAUNCHER, str(Path(resolved).resolve()), *args)
        process = await asyncio.create_subprocess_exec(
            *command, cwd=cwd, env=env, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
            start_new_session=not windows,
        )
        assert process.stdin is not None
        if windows:
            assert job is not None
            handle = win32api.OpenProcess(win32con.PROCESS_SET_QUOTA | win32con.PROCESS_TERMINATE, False, process.pid)
            try:
                win32job.AssignProcessToJobObject(job, handle)
                assigned = True
            finally:
                handle.Close()
            process.stdin.write(b"+")
            await process.stdin.drain()
        try:
            yield process
        finally:
            process.stdin.close()
            try:
                await _wait_for_exit(process)
            except TimeoutError:
                if not windows:
                    _signal_group(process.pid, signal.SIGTERM)
                    with suppress(TimeoutError):
                        await _wait_for_exit(process)
    finally:
        if job is not None:
            job.Close()
        if process is not None:
            if not windows:
                _signal_group(process.pid, signal.SIGKILL)
            elif not assigned:
                with suppress(ProcessLookupError):
                    process.kill()
            await process.wait()
