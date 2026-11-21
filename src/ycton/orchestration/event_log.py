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
