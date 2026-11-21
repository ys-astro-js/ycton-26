"""프로젝트 폴더를 고르고 확인한다. 경로는 사람이 타이핑하지 않고 서버가 띄운 OS 폴더 선택 창에서만 받는다."""
import asyncio
import shutil
import subprocess
import sys
from pathlib import Path

PROMPT = "프로젝트 폴더 선택"


class FolderError(Exception):
    def __init__(self, message, status=422):
        self.message, self.status = message, status


def picker_command():
    """이 컴퓨터에서 쓸 수 있는 기본 폴더 선택 창 명령. 없으면 None."""
    if sys.platform == "darwin":
        # activate로 선택 창을 브라우저 앞에 띄운다. 다른 앱을 제어하지 않으므로 자동화 권한이 필요 없다.
        return ["osascript", "-e", "activate", "-e", f'POSIX path of (choose folder with prompt "{PROMPT}")']
    if shutil.which("zenity"):
        return ["zenity", "--file-selection", "--directory", f"--title={PROMPT}"]
    if shutil.which("kdialog"):
        return ["kdialog", "--getexistingdirectory", str(Path.home()), "--title", PROMPT]
    if sys.platform == "win32":
        script = ("Add-Type -AssemblyName System.Windows.Forms;"
                  "$d=New-Object System.Windows.Forms.FolderBrowserDialog;"
                  f"$d.Description='{PROMPT}';"
                  "if($d.ShowDialog() -eq 'OK'){$d.SelectedPath}")
        return ["powershell", "-NoProfile", "-STA", "-Command", script]
    return None


class FolderPicker:
    """서버가 도는 컴퓨터에 폴더 선택 창을 하나만 띄운다. 취소하면 None."""

    def __init__(self, command=picker_command):
        self.command = command
        self.lock = asyncio.Lock()

    async def pick(self):
        if self.lock.locked():
            raise FolderError("폴더 선택 창이 이미 열려 있습니다", 409)
        command = self.command()
        if command is None:
            raise FolderError("이 컴퓨터에서 폴더 선택 창을 열 수 없습니다", 501)
        async with self.lock:
            process = await asyncio.create_subprocess_exec(
                *command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            try:
                stdout, _ = await process.communicate()
            except asyncio.CancelledError:
                process.kill()
                await process.wait()
                raise
        path = stdout.decode().strip()
        # 사람이 취소하면 각 명령이 0이 아닌 코드로 끝나고 아무것도 출력하지 않는다.
        if process.returncode != 0 or not path:
            return None
        return path


def git_root(folder):
    """폴더가 속한 Git 저장소의 최상위 경로. 작업은 이 저장소의 worktree에서 돈다."""
    path = Path(folder).expanduser()
    if not path.is_absolute() or not path.is_dir():
        raise FolderError("폴더를 찾을 수 없습니다")
    try:
        result = subprocess.run(["git", "-C", str(path), "rev-parse", "--show-toplevel"],
                                capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        raise FolderError("Git을 실행할 수 없습니다", 500)
    if result.returncode != 0:
        raise FolderError("Git 저장소가 아닌 폴더입니다. git init을 한 폴더를 고르세요")
    return str(Path(result.stdout.strip()).resolve())

