"""동기 ACP 콜백 → 유한 큐 → 비동기 소비. 전체 이벤트는 파일, 최신 요약만 DB에 저장."""
import asyncio
import json
from pathlib import Path


class EventLog:
    def __init__(self, path: Path, service, session_id, secrets=()):
        self.path, self.service, self.session_id = path, service, session_id
        self.secrets = secrets
        self.queue = asyncio.Queue(maxsize=512)
        self.dropped = 0
        self.consumer = None
        self.file = None

    def redact(self, value):
        for secret in self.secrets:
            value = value.replace(secret, "[REDACTED]")
        return value

    def on_update(self, notification):
        # 런타임의 같은 이벤트 루프에서 실행된다. 여기서 파일/DB IO를 하지 않는다.
        try:
            self.queue.put_nowait(notification)
        except asyncio.QueueFull:
            self.dropped += 1

    async def __aenter__(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.file = self.path.open("a", encoding="utf-8")
        self.consumer = asyncio.create_task(self.consume())
        return self

    def write(self, raw):
        self.file.write(raw + "\n")
        self.file.flush()
        self.service.execution_metadata(self.session_id, latest_event=raw[:2000])

    async def consume(self):
        while True:
            event = await self.queue.get()
            if event is None:
                return
            data = event.model_dump(mode="json") if hasattr(event, "model_dump") else event
            raw = self.redact(json.dumps(data, ensure_ascii=False, default=str))
            await asyncio.to_thread(self.write, raw)

    async def __aexit__(self, *exc):
        try:
            if self.consumer.done():
                await self.consumer
            else:
                # 소비자가 실패하면 큐 삽입이 영원히 대기하지 않게 함께 감시한다.
                put = asyncio.create_task(self.queue.put(None))
                done, _ = await asyncio.wait([put, self.consumer], return_when=asyncio.FIRST_COMPLETED)
                if self.consumer in done:
                    put.cancel()
                    await asyncio.gather(put, return_exceptions=True)
                else:
                    await put
                await self.consumer
            if self.dropped:
                await asyncio.to_thread(self.write, json.dumps({"dropped_events": self.dropped}))
        finally:
            self.file.close()


def _public_event(data):
    if not isinstance(data, dict):
        return None
    if type(data.get("dropped_events")) is int and data["dropped_events"] > 0:
        return "log_gap", f"기록하지 못한 이벤트 {data['dropped_events']}개"
    update = data.get("update")
    if not isinstance(update, dict):
        return None
    kind = update.get("session_update")
    if kind == "agent_message_chunk":
        content = update.get("content")
        if isinstance(content, dict) and content.get("type") == "text" and isinstance(content.get("text"), str):
            return "message", content["text"][:4000]
    if kind in ("tool_call", "tool_call_update"):
        status = update.get("status")
        if status == "completed":
            return "tool", "도구 실행 완료"
        if status == "failed":
            return "tool", "도구 실행 실패"
        if kind == "tool_call":
            return "tool", "도구 실행 요청"
    if kind == "plan":
        return "plan", "작업 계획 갱신"
    # 추론, 도구 인자·출력, 프롬프트 등 원본 ACP 페이로드는 브라우저에 내보내지 않는다.
    return None


def read_event_page(path: Path, cursor: int):
    events = []
    record_limit = 64 * 1024
    try:
        file = path.open("rb")
    except FileNotFoundError:
        return {"events": events, "next_cursor": cursor, "has_more": False}
    with file:
        end = file.seek(0, 2)
        if cursor > end:
            raise ValueError("invalid event cursor")
        if cursor:
            file.seek(cursor - 1)
            if file.read(1) != b"\n":
                raise ValueError("invalid event cursor")
        file.seek(cursor)
        while len(events) < 40 and file.tell() - cursor < 256 * 1024:
            start = file.tell()
            if start >= end:
                break
            raw = file.readline(min(record_limit + 1, end - start))
            if len(raw) > record_limit:
                # 한 줄이 크더라도 전체를 메모리에 올리지 않는다.
                while not raw.endswith(b"\n") and file.tell() < end:
                    raw = file.readline(min(record_limit, end - file.tell()))
                if raw.endswith(b"\n"):
                    continue
            if not raw.endswith(b"\n"):
                return {"events": events, "next_cursor": start, "has_more": False}
            try:
                event = _public_event(json.loads(raw))
            except (ValueError, UnicodeError, RecursionError):
                continue
            if event is not None:
                kind, text = event
                events.append({"id": start, "kind": kind, "text": text})
        offset = file.tell()
        return {"events": events, "next_cursor": offset, "has_more": offset < end}
