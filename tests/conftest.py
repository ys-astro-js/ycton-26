import subprocess

import pytest


@pytest.fixture
def repo(tmp_path):
    """폴더 선택으로 연결할, 커밋이 하나 있는 Git 저장소"""
    path = tmp_path / "project"
    path.mkdir()
    subprocess.run(["git", "init", "-q", str(path)], check=True)
    subprocess.run(["git", "-C", str(path), "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                    "commit", "-qm", "fixture", "--allow-empty"], check=True)
    return str(path.resolve())
