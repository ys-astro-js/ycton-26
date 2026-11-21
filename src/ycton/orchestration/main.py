"""앱 조립 지점. DB·서비스·실행기·스케줄러를 연결하고 생명주기를 관리한다."""
import asyncio
import logging
from contextlib import asynccontextmanager, suppress
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from ycton.orchestration.config import Settings
from ycton.orchestration.db import Database
from ycton.orchestration.services.task_service import TaskService, DomainError
from ycton.orchestration.fake_runtime import FakeRuntime
from ycton.orchestration.scheduler import Scheduler
from ycton.orchestration.dispatch import Dispatcher
from ycton.orchestration.jev import OpenRouterJev
from ycton.orchestration.api import rooms, tasks, sessions, agent_bridge
from ycton.orchestration.identity import Tokens
from ycton.orchestration.runtime_config import RuntimeConfig
from ycton.orchestration.folders import FolderPicker


async def load_model_names(svc):
    """어댑터마다 세션을 한 번 열어 모델 표시 이름을 받는다. 설정에 적었지만 어댑터가 모르는 모델은 경고한다."""
    from ycton.acp_runtime import describe_session
    config = svc.runtime_config
    config.worktrees.mkdir(parents=True, exist_ok=True)
    for name, kind in config.kinds.items():
        try:
            options = await describe_session(*kind.command, cwd=config.worktrees, timeout=60)
        except Exception as exc:
            logging.warning("%s 어댑터에서 모델 목록을 받지 못했습니다: %s", name, exc)
            continue
        svc.model_names[name] = options.get("model", {})
        unknown = [m for m in kind.models if m not in svc.model_names[name]]
        if unknown:
            logging.warning("%s 어댑터가 제공하지 않는 모델이 설정에 있습니다: %s", name, ", ".join(unknown))


def create_app(settings=None, runtime_factory=None, start_scheduler=True, folder_picker=None):
    config = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app):
        runtime_config = RuntimeConfig.read(config.runtime_config) if config.mode == "acp" else None
        db = Database(config.db_path)
        db.initialize()
        svc = TaskService(db, config)
        svc.recover()
        app.state.tokens = Tokens()
        app.state.folder_picker = folder_picker or FolderPicker()
        if runtime_config is not None:
            from ycton.orchestration.acp_bridge import AcpRuntime
            svc.runtime_config = runtime_config
            # ACP가 자체 시간 제한과 프로세스 정리를 수행할 여유를 포함한다.
            config.timeout_seconds = svc.runtime_config.timeout + max(v.timeout for v in svc.runtime_config.verifiers.values()) + 30
            runtime = AcpRuntime(svc, svc.runtime_config, app.state.tokens)
        else:
            runtime = (runtime_factory or FakeRuntime)(svc, config)
        names = asyncio.create_task(load_model_names(svc)) if runtime_config is not None else None
        scheduler = Scheduler(svc, runtime, config)
        app.state.service, app.state.scheduler = svc, scheduler
        app.state.jev = OpenRouterJev(config.openrouter_api_key, config.jev_model) if config.openrouter_api_key else None
        app.state.dispatcher = scheduler.dispatcher = Dispatcher(svc, app.state.jev)
        if start_scheduler:
            scheduler.start()
        try:
            yield
        finally:
            try:
                if names is not None:
                    names.cancel()
                    with suppress(asyncio.CancelledError):
                        await names
            finally:
                try:
                    await scheduler.stop()
                    await app.state.dispatcher.close()
                finally:
                    if app.state.jev is not None:
                        await app.state.jev.close()

    app = FastAPI(title="Ycton orchestration", version="0.1.0", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=list(config.origins),
                       allow_methods=["GET", "POST"], allow_headers=["Content-Type", "Authorization", "X-Orch-Client"])
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=["localhost", "127.0.0.1"])

    @app.middleware("http")
    async def check_origin(request: Request, call_next):
        origin = request.headers.get("origin")
        if origin is not None and origin not in config.origins:
            return JSONResponse(status_code=403, content={"detail": "허용되지 않은 Origin입니다"})
        return await call_next(request)

    @app.exception_handler(DomainError)
    async def domain_error(request, exc):
        return JSONResponse(status_code=exc.status, content={"detail": exc.message})

    @app.get("/health")
    def health():
        return {"ok": True, "mode": config.mode}

    for router in (rooms.router, tasks.router, agent_bridge.router, sessions.router):
        app.include_router(router)
    return app


app = create_app()
