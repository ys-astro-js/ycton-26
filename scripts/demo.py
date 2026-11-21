"""실행 중인 서버에서 방·에이전트·할 일을 만들고 결과를 확인한다. 표준 라이브러리만 사용."""
import argparse
import json
import time
from urllib.request import Request, urlopen

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:8000")
parser.add_argument("--fail", action="store_true", help="실패 후 최대 두 번 실행되는 흐름 확인")
args = parser.parse_args()


def api(path, data=None):
    request = Request(args.url + path,
                      data=None if data is None else json.dumps(data).encode(),
                      headers={"Content-Type": "application/json", "X-Orch-Client": "web"})
    with urlopen(request, timeout=10) as response:
        return json.load(response)


room = api("/api/rooms", {"name": "오케스트레이션 데모"})["id"]
for name, kind, strengths in (("UI 담당", "frontend", ["UI"]), ("API 담당", "backend", ["API"])):
    api(f"/api/rooms/{room}/agents", {"name": name, "kind": kind, "good_at": strengths})
task = api(f"/api/rooms/{room}/tasks", {
    "title": ("[fail] " if args.fail else "") + "로그인 오류 안내 추가",
    "detail": "현재는 가짜 실행기로 흐름만 검증합니다.",
    "scope": "src/login", "verify": "MOCK: 성공/실패 시뮬레이션",
})
print(f"room={room}, task={task['id']}")
for _ in range(100):
    state = api(f"/api/rooms/{room}/state")
    current = state["tasks"][0]
    if current["status"] == "done" or (current["status"] == "open" and current["attempts"] >= 2):
        print(json.dumps(state, ensure_ascii=False, indent=2))
        break
    time.sleep(0.1)
else:
    raise SystemExit("10초 안에 완료되지 않았습니다. 서버 로그와 state API를 확인하세요.")
