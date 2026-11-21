"""실제 모델 호출 없이 런타임 계약·HTTP·MCP·검증 프로세스를 연결해 검증한다."""
import asyncio
from dataclasses import replace
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient
from ycton.orchestration.config import Settings
from ycton.orchestration.main import create_app
from ycton.orchestration.identity import Identity, Tokens
from ycton.orchestration.runtime_config import AgentKind, Repository, RuntimeConfig, Verification
from ycton.orchestration.runtime_port import RuntimeRequest
from ycton.orchestration.acp_bridge import AcpRuntime, verify_worktree
from ycton.orchestration.event_log import EventLog
from ycton.room_mcp import build_room_server


@pytest.fixture
def bridge(tmp_path):
    app = create_app(Settings(db_path=tmp_path/'test.db'), start_scheduler=False)
    with TestClient(app, base_url='http://localhost', headers={'X-Orch-Client': 'web'}) as client:
        room = client.post('/api/rooms', json={'name':'room'}).json()['id']
        aid = client.post(f'/api/rooms/{room}/agents', json={'name':'A','kind':'demo'}).json()['id']
        tid = client.post(f'/api/rooms/{room}/tasks', json={'title':'task','verify':'unit'}).json()['id']
        svc = app.state.service
        with svc.db.connect(write=True) as c:
            sid = c.execute("SELECT id FROM sessions WHERE agent_id=? AND kind='chat'", (aid,)).fetchone()[0]
            c.execute("UPDATE sessions SET status='running' WHERE id=?", (sid,))
        token = app.state.tokens.issue(Identity(sid,room,aid))
        actor = {'room_id':str(room),'participant_id':str(aid)}
        yield app, client, actor, token, sid, tid, tmp_path


def test_send_claim_delegate_contract_and_token_scope(bridge):
    app, client, actor, token, sid, tid, _ = bridge
    headers = {'Authorization':f'Bearer {token}'}
    assert client.post('/api/agent/messages', headers=headers, json={**actor,'text':'맡겠습니다'}).status_code == 201
    assert client.post('/api/agent/messages', headers=headers, json={**actor,'participant_id':'999','text':'fake'}).status_code == 403
    assert client.post('/api/agent/tasks/claim', headers=headers, json={**actor,'task_id':str(tid)}).status_code == 200
    body = {**actor,'task_id':str(tid),'request_id':'once','instructions':'go'}
    first = client.post('/api/agent/tasks/delegate', headers=headers, json=body)
    assert first.status_code == 202
    assert client.post('/api/agent/tasks/delegate', headers=headers, json=body).json()['id'] == first.json()['id']
    assert client.post('/api/rooms', headers=headers,json={'name':'fake human'}).status_code == 403
    state = client.get(f"/api/rooms/{actor['room_id']}/state").text
    assert token not in state
    with app.state.service.db.connect(write=True) as c:
        c.execute("UPDATE sessions SET status='succeeded' WHERE id=?",(sid,))
    assert client.post('/api/agent/messages',headers=headers,json={**actor,'text':'late'}).status_code == 403
    app.state.tokens.revoke(token)
    assert client.post('/api/agent/messages',headers=headers,json={**actor,'text':'late'}).status_code == 401


def test_mcp_tools_reach_real_api(bridge):
    app, client, actor, token, sid, tid, _ = bridge
    async def exercise():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1',
                                    headers={'Authorization':f'Bearer {token}'}) as http:
            mcp = build_room_server(http, **{'room_id':actor['room_id'],'participant_id':actor['participant_id']})
            names = {t.name for t in await mcp.list_tools()}
            assert names == {'send','list_tasks','claim','delegate'}
            await mcp.call_tool('send', {'text':'MCP 왕복'})
            await mcp.call_tool('list_tasks', {})
            await mcp.call_tool('claim', {'task_id':str(tid)})
            await mcp.call_tool('delegate', {'task_id':str(tid),'request_id':'mcp-1','instructions':'go'})
    asyncio.run(exercise())
    state = app.state.service.snapshot(int(actor['room_id']))
    assert state['tasks'][0]['status'] == 'claimed'
    assert state['tasks'][0]['active_session_id']
    assert any(m['content']=='MCP 왕복' for m in state['messages'])


def test_verification_uses_exit_code_and_required_output(tmp_path):
    async def exercise():
        ok, output = await verify_worktree(Verification((sys.executable,'-c',"print('PASSED')"),contains='PASSED'),tmp_path)
        assert ok and 'exit_code=0' in output
        ok, _ = await verify_worktree(Verification((sys.executable,'-c',"print('PASSED');raise SystemExit(1)"),contains='PASSED'),tmp_path)
        assert not ok
        ok, _ = await verify_worktree(Verification((sys.executable,'-c',"print('wrong')"),contains='PASSED'),tmp_path)
        assert not ok
        with pytest.raises(TimeoutError):
            await verify_worktree(Verification((sys.executable,'-c','import time;time.sleep(10)'),timeout=.02),tmp_path)
    asyncio.run(exercise())


def setup_work(bridge):
    app, client, actor, token, sid, tid, root = bridge
    svc=app.state.service
    svc.claim(tid,int(actor['participant_id']))
    session=svc.delegate(tid,int(actor['participant_id']),'runtime-test','go')
    config=RuntimeConfig({'default':Repository(root,'기본 저장소',('unit',),'unit')},
                         root/'worktrees',root/'logs','http://127.0.0.1:8000',
                         {'demo':AgentKind(('fake-adapter',))},
                         {'unit':Verification((sys.executable,'-c',"print('verified')"))})
    prompt=json.dumps({'title':'task','detail':'','scope':'','verify':'unit','instruction':'go','handoff':''})
    request=RuntimeRequest(session['id'],int(actor['room_id']),int(actor['participant_id']),'work',prompt,'demo',
                           repository_id='default',task_id=tid)
    return svc, config, request


def test_work_runs_in_the_picked_folder(bridge,monkeypatch,repo):
    import ycton.orchestration.acp_bridge as module
    svc,config,request=setup_work(bridge)
    svc.runtime_config=config
    monkeypatch.setattr(svc.settings,'mode','acp')
    request=replace(request,repository_id='',repo=repo)
    seen={}
    async def work(*args,**kwargs):
        seen['repo']=kwargs['repo']
        return SimpleNamespace(session=SimpleNamespace(session_id='acp-1',stop_reason='cancelled',text=''))
    monkeypatch.setattr(module,'run_work_session',work)
    result=asyncio.run(AcpRuntime(svc,config,Tokens()).run(request))
    assert seen['repo']==Path(repo) and not result.succeeded
    missing=replace(request,repo=str(Path(repo)/'gone'))
    assert asyncio.run(AcpRuntime(svc,config,Tokens()).run(missing)).summary=='연결한 폴더를 찾을 수 없습니다'


def test_work_adapter_persists_path_and_checks_verification(bridge,monkeypatch):
    import ycton.orchestration.acp_bridge as module
    svc,config,request=setup_work(bridge)
    async def work(*args,**kwargs):
        with svc.db.connect() as c:
            assert c.execute('SELECT worktree FROM sessions WHERE id=?',(request.session_id,)).fetchone()[0] == str(kwargs['worktree'])
        kwargs['worktree'].mkdir(parents=True)
        kwargs['on_update']({'update':'progress'})
        # commit 도구가 남기는 기록을 흉내 낸다.
        with svc.db.connect(write=True) as c:
            c.execute("UPDATE sessions SET commit_hash='abc123' WHERE id=?",(request.session_id,))
        return SimpleNamespace(session=SimpleNamespace(session_id='acp-1',stop_reason='end_turn',text='report'))
    monkeypatch.setattr(module,'run_work_session',work)
    result=asyncio.run(AcpRuntime(svc,config,Tokens()).run(request))
    assert result.succeeded and result.verification=='passed'
    assert 'verified' in result.summary
    svc.finish(request.session_id,result)
    state=svc.snapshot(request.room_id)
    assert state['tasks'][0]['status']=='done'
    session=next(s for s in state['sessions'] if s['id']==request.session_id)
    assert session['acp_session_id']=='acp-1' and session['worktree']


def test_work_error_keeps_attempt_path(bridge,monkeypatch):
    import ycton.orchestration.acp_bridge as module
    svc,config,request=setup_work(bridge)
    async def work(*args,**kwargs):
        raise TimeoutError
    monkeypatch.setattr(module,'run_work_session',work)
    result=asyncio.run(AcpRuntime(svc,config,Tokens()).run(request))
    assert not result.succeeded and 'worktree=' in result.summary
    svc.finish(request.session_id,result)
    assert svc.snapshot(request.room_id)['tasks'][0]['status']=='open'


def test_chat_token_is_revoked_and_final_text_not_posted(bridge,monkeypatch):
    import ycton.orchestration.acp_bridge as module
    app,client,actor,token,sid,tid,root=bridge
    svc=app.state.service
    config=RuntimeConfig({'default':Repository(root,'기본 저장소',('unit',),'unit')},
                         root/'worktrees',root/'logs','http://127.0.0.1:8000',
                         {'demo':AgentKind(('fake',))},{'unit':Verification(('echo','ok'))})
    tokens=Tokens()
    captured=[]
    async def chat(*args,**kwargs):
        env={v.name:v.value for v in kwargs['mcp_servers'][0].env}
        captured.append(env['YCTON_AGENT_TOKEN'])
        assert tokens.resolve(captured[0])
        assert captured[0] not in kwargs['prompt']
        kwargs['on_update']({'token_echo':captured[0]})
        return SimpleNamespace(session_id='acp-chat',stop_reason='end_turn',text='SHOULD_NOT_BE_POSTED')
    monkeypatch.setattr(module,'run_session',chat)
    request=RuntimeRequest(sid,int(actor['room_id']),int(actor['participant_id']),'chat','context','demo',
                           repository_id='default')
    result=asyncio.run(AcpRuntime(svc,config,tokens).run(request))
    assert result.succeeded and tokens.resolve(captured[0]) is None
    assert 'SHOULD_NOT_BE_POSTED' not in json.dumps(svc.snapshot(request.room_id))
    assert captured[0] not in Path(result.log_path).read_text()


@pytest.mark.parametrize('tool,allowed',[('send',True),('list_tasks',True),('claim',True),('delegate',True),('terminal',False)])
def test_permission_allowlist(tool,allowed):
    from acp.schema import ToolCallStart,ToolCallUpdate,PermissionOption
    from ycton.acp_runtime import _SessionClient
    async def exercise():
        client=_SessionClient(None,room_tools=("send", "list_tasks", "claim", "delegate"))
        await client.session_update('s',ToolCallStart(tool_call_id='t',title=tool,
            raw_input={'server':'room','tool':tool},field_meta={'is_mcp_tool_call':True}))
        response=await client.request_permission('s',ToolCallUpdate(tool_call_id='t'),
            [PermissionOption(option_id='yes',name='yes',kind='allow_once')],is_mcp_tool_approval=True)
        assert (response.outcome.outcome=='selected') == allowed
    asyncio.run(exercise())


def test_chat_failure_releases_unstarted_claim(bridge):
    from ycton.orchestration.runtime_port import RuntimeResult
    app,client,actor,token,sid,tid,root=bridge
    svc=app.state.service
    svc.claim(tid,int(actor['participant_id']))
    svc.finish(sid,RuntimeResult(False,'adapter failed'))
    assert svc.snapshot(int(actor['room_id']))['tasks'][0]['status']=='open'


def test_wrong_stop_reason_cannot_complete_work(bridge,monkeypatch):
    import ycton.orchestration.acp_bridge as module
    svc,config,request=setup_work(bridge)
    async def work(*args,**kwargs):
        return SimpleNamespace(session=SimpleNamespace(session_id='s',stop_reason='cancelled',text='all good'))
    async def never(*args):
        raise AssertionError('verification should not run after cancelled turn')
    monkeypatch.setattr(module,'run_work_session',work)
    monkeypatch.setattr(module,'verify_worktree',never)
    result=asyncio.run(AcpRuntime(svc,config,Tokens()).run(request))
    assert not result.succeeded


def test_work_mcp_exposes_only_commit():
    async def exercise():
        async with httpx.AsyncClient(base_url="http://127.0.0.1") as client:
            server = build_room_server(client, room_id="1", participant_id="2", work=True)
            assert {t.name for t in await server.list_tools()} == {"commit"}
    asyncio.run(exercise())


def test_teammate_numeric_id_and_delegate_without_request_id(bridge):
    app, client, actor, token, sid, tid, _ = bridge
    headers = {"Authorization": f"Bearer {token}"}
    assert client.post("/api/agent/tasks/claim", headers=headers,
                       json={**actor, "task_id": tid}).status_code == 200
    body = {**actor, "task_id": tid, "instructions": "go"}
    first = client.post("/api/agent/tasks/delegate", headers=headers, json=body)
    second = client.post("/api/agent/tasks/delegate", headers=headers, json=body)
    assert first.status_code == 202 and second.json()["id"] == first.json()["id"]


def git_repo(path):
    import subprocess
    path.mkdir()
    for args in (('init', '-q'), ('config', 'user.name', 'test'), ('config', 'user.email', 'test@example.com')):
        subprocess.run(('git', '-C', str(path), *args), check=True)
    (path / 'app.txt').write_text('before\n')
    subprocess.run(('git', '-C', str(path), 'add', 'app.txt'), check=True)
    subprocess.run(('git', '-C', str(path), 'commit', '-qm', 'init'), check=True)
    return path


def test_work_session_starts_worktree_on_requested_branch(tmp_path, monkeypatch):
    import subprocess
    import ycton.work_session as module
    repo = git_repo(tmp_path / 'repo')
    async def session(*args, **kwargs):
        return SimpleNamespace(session_id='s', stop_reason='end_turn', text='')
    monkeypatch.setattr(module, '_run_session', session)
    task = module.WorkTask(title='t', detail='', scope='', verify='', instructions='')
    result = asyncio.run(module.run_work_session('fake', repo=repo, worktree=tmp_path / 'wt', task=task,
                                                 branch='ycton/task-1-abc'))
    current = subprocess.run(('git', '-C', str(result.worktree), 'branch', '--show-current'),
                             check=True, capture_output=True, text=True).stdout.strip()
    assert current == 'ycton/task-1-abc'


def running_work(bridge):
    """실제 git worktree에서 실행 중인 작업 세션과 그 세션의 토큰을 만든다."""
    import subprocess
    app, client, actor, token, sid, tid, root = bridge
    svc, _, request = setup_work(bridge)
    repo = git_repo(root / 'repo')
    worktree = root / 'wt'
    subprocess.run(('git', '-C', str(repo), 'worktree', 'add', '-q', '-b', 'ycton/task', str(worktree)), check=True)
    with svc.db.connect(write=True) as c:
        c.execute("UPDATE sessions SET status='running' WHERE id=?", (request.session_id,))
    svc.execution_metadata(request.session_id, worktree=str(worktree))
    work_token = app.state.tokens.issue(Identity(request.session_id, request.room_id, request.agent_id))
    return svc, request, worktree, work_token


def git_out(worktree, *args):
    import subprocess
    return subprocess.run(('git', '-C', str(worktree), *args), check=True, capture_output=True, text=True).stdout


def test_commit_tool_commits_only_chosen_files_and_links_task(bridge):
    from ycton.orchestration.runtime_port import RuntimeResult
    app, client, actor, token, sid, tid, root = bridge
    svc, request, worktree, work_token = running_work(bridge)
    (worktree / 'app.txt').write_text('after\n')
    (worktree / 'new.txt').write_text('new\n')
    (worktree / 'other.txt').write_text('not part of the task\n')
    git_out(worktree, 'add', 'other.txt')

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://127.0.0.1',
                                    headers={'Authorization': f'Bearer {work_token}'}) as http:
            mcp = build_room_server(http, room_id=actor['room_id'], participant_id=actor['participant_id'], work=True)
            return await mcp.call_tool('commit', {'paths': ['app.txt', 'new.txt'], 'message': 'Update app'})
    asyncio.run(exercise())

    head = git_out(worktree, 'rev-parse', 'HEAD').strip()
    assert sorted(git_out(worktree, 'show', '--name-only', '--format=', 'HEAD').split()) == ['app.txt', 'new.txt']
    assert git_out(worktree, 'log', '-1', '--format=%an').strip() == 'A (ycton)'
    assert 'A  other.txt' in git_out(worktree, 'status', '--short')
    session = next(s for s in svc.snapshot(request.room_id)['sessions'] if s['id'] == request.session_id)
    assert session['commit_hash'] == head
    assert any(e['event'] == 'committed' and head in e['detail']
               for e in client.get(f'/api/tasks/{tid}/events').json())

    svc.finish(request.session_id, RuntimeResult(True, 'report', 'passed'))
    task = svc.snapshot(request.room_id)['tasks'][0]
    assert task['status'] == 'done' and task['commit_hash'] == head
    assert f'commit={head}' in task['handoff']


def test_commit_tool_rejects_outside_paths_and_wrong_sessions(bridge):
    app, client, actor, token, sid, tid, root = bridge
    svc, request, worktree, work_token = running_work(bridge)
    (worktree / 'app.txt').write_text('after\n')
    work = {'Authorization': f'Bearer {work_token}'}
    body = {**actor, 'paths': ['app.txt'], 'message': 'Update app'}
    for paths in (['../repo/app.txt'], [str(worktree / 'app.txt')], ['.git/config'], ['.']):
        response = client.post('/api/agent/commit', headers=work, json={**body, 'paths': paths})
        assert response.status_code == 422, paths
    # 채팅 토큰은 커밋할 수 없고, 작업 토큰은 방에 말할 수 없다.
    assert client.post('/api/agent/commit', headers={'Authorization': f'Bearer {token}'}, json=body).status_code == 403
    assert client.post('/api/agent/messages', headers=work, json={**actor, 'text': 'hi'}).status_code == 403
    # 변경이 없는 파일은 커밋할 것이 없어 거절하고, 그 이유를 돌려준다.
    nothing = client.post('/api/agent/commit', headers=work, json={**body, 'paths': ['missing.txt']})
    assert nothing.status_code == 422 and 'git add' in nothing.json()['detail']
    assert git_out(worktree, 'rev-list', '--count', 'HEAD').strip() == '1'


def test_failed_attempt_keeps_commit_in_handoff_only(bridge):
    from ycton.orchestration.runtime_port import RuntimeResult
    app, client, actor, token, sid, tid, root = bridge
    svc, request, worktree, work_token = running_work(bridge)
    (worktree / 'app.txt').write_text('after\n')
    response = client.post('/api/agent/commit', headers={'Authorization': f'Bearer {work_token}'},
                           json={**actor, 'paths': ['app.txt'], 'message': 'Try fix'})
    assert response.status_code == 201
    svc.finish(request.session_id, RuntimeResult(False, 'verification failed', 'failed'))
    task = svc.snapshot(request.room_id)['tasks'][0]
    assert task['status'] == 'open' and task['commit_hash'] is None
    assert f"commit={response.json()['commit']}" in task['handoff']


def test_work_runtime_passes_commit_mcp_and_revokes_token(bridge, monkeypatch):
    import ycton.orchestration.acp_bridge as module
    svc, config, request = setup_work(bridge)
    tokens = Tokens()
    seen = {}
    async def work(*args, **kwargs):
        server = kwargs['mcp_servers'][0]
        env = {v.name: v.value for v in server.env}
        seen['token'] = env['YCTON_AGENT_TOKEN']
        seen['identity'] = tokens.resolve(seen['token'])
        seen['branch'] = kwargs['branch']
        kwargs['worktree'].mkdir(parents=True)
        return SimpleNamespace(session=SimpleNamespace(session_id='acp-1', stop_reason='end_turn', text='report'))
    monkeypatch.setattr(module, 'run_work_session', work)
    asyncio.run(AcpRuntime(svc, config, tokens).run(request))
    assert seen['identity'].session_id == request.session_id
    assert seen['branch'].startswith(f'ycton/task-{request.task_id}-')
    assert tokens.resolve(seen['token']) is None


def test_work_prompt_mentions_commit_only_with_room_mcp():
    from ycton.work_session import WorkTask, _work_prompt
    task = WorkTask(title='t', detail='', scope='', verify='', instructions='')
    assert '`commit` tool' in _work_prompt(task, can_commit=True)
    assert 'Do not commit' in _work_prompt(task)


def test_verified_work_without_commit_is_not_done(bridge, monkeypatch):
    import ycton.orchestration.acp_bridge as module
    svc, config, request = setup_work(bridge)
    async def work(*args, **kwargs):
        kwargs['worktree'].mkdir(parents=True)
        return SimpleNamespace(session=SimpleNamespace(session_id='acp-1', stop_reason='end_turn', text='report'))
    monkeypatch.setattr(module, 'run_work_session', work)
    result = asyncio.run(AcpRuntime(svc, config, Tokens()).run(request))
    assert not result.succeeded and result.verification == 'passed'
    assert '커밋 없음' in result.summary
    svc.finish(request.session_id, result)
    task = svc.snapshot(request.room_id)['tasks'][0]
    assert task['status'] == 'open' and '커밋 없음' in task['handoff']


@pytest.fixture
def project_config(tmp_path):
    for name in ("primary", "secondary"):
        repo = tmp_path / name
        repo.mkdir()
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        subprocess.run(["git", "-C", str(repo), "-c", "user.name=Test",
                        "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture",
                        "--allow-empty"], check=True)
    root = """
repo = "primary"
worktrees = "worktrees"
logs = "logs"
api_url = "http://127.0.0.1:8000"
"""
    commands = f"""
[kinds.frontend]
command = ["unused-frontend"]
[kinds.backend]
command = ["unused-backend"]
models = ["routing-model"]
efforts = ["low"]
[verify.unit]
command = ["unused"]
[verify.custom]
command = {json.dumps([sys.executable, "-c", "from pathlib import Path; print(Path('proof.txt').read_text())"], ensure_ascii=False)}
contains = "secondary-worktree"
"""
    extra = """
[repositories.secondary]
path = "secondary"
label = "두 번째 저장소"
verification_profiles = ["custom"]
"""
    path = tmp_path / "runtime.toml"
    path.write_text(root + 'verification_profiles = ["unit"]\n' + extra + commands, encoding="utf-8")
    settings = Settings(db_path=tmp_path / "binding.db", mode="acp", runtime_config=path)
    return settings, root + commands


def test_runtime_catalog_and_persistent_project_binding(project_config):
    settings, old_config = project_config
    url = "/api/runtime/options"
    headers = {"X-Orch-Client": "web"}
    with TestClient(create_app(settings, start_scheduler=False), base_url="http://localhost") as client:
        assert client.get(url).status_code == 403
        assert client.get(url, headers={**headers, "Authorization": "Bearer agent"}).status_code == 403
        client.headers.update(headers)
        assert client.get(url).json() == {
            "mode": "acp", "agent_kinds": ["backend", "frontend"], "default_agent_kind": "backend",
            "default_repository_id": "default",
            "repositories": [
                {"id": "default", "label": "기본 저장소", "verification_profiles": ["unit"],
                 "default_verification_profile": "unit"},
                {"id": "secondary", "label": "두 번째 저장소", "verification_profiles": ["custom"],
                 "default_verification_profile": "custom"},
            ],
        }
        for unknown in ("missing", "C:/external/repo"):
            assert client.post("/api/rooms", json={"name": "unknown", "repository_id": unknown}).status_code == 422
        response = client.post("/api/rooms", json={"name": "two", "repository_id": "secondary"})
        assert response.status_code == 201 and response.json()["repository_id"] == "secondary"
        room = response.json()["id"]
        path = f"/api/rooms/{room}"
        assert client.post(f"{path}/tasks", json={"title": "task", "verify": "unit"}).status_code == 422
        assert client.post(f"{path}/tasks", json={"title": "task", "verify": "custom"}).status_code == 201

    settings.runtime_config.write_text(old_config, encoding="utf-8")
    with TestClient(create_app(settings, start_scheduler=False), base_url="http://localhost", headers=headers) as client:
        assert client.get("/api/rooms").json()[0]["repository_id"] == "secondary"
        state = client.get(f"{path}/state").json()
        assert state["room"]["repository_id"] == "secondary" and state["tasks"][0]["verify"] == "custom"
        assert client.get(url).json()["repositories"] == [
            {"id": "default", "label": "기본 저장소", "verification_profiles": ["custom", "unit"],
             "default_verification_profile": "unit"},
        ]
        assert client.post("/api/rooms", json={"name": "old caller"}).json()["repository_id"] == "default"
        secondary = settings.runtime_config.parent / "secondary"
        picked = client.post("/api/rooms", json={"name": "picked", "repo": str(secondary)}).json()
        assert picked["repo"] == str(secondary.resolve())
        # 고른 폴더에는 서버에 등록된 검증 프로필을 모두 쓸 수 있다
        assert client.post(f"/api/rooms/{picked['id']}/tasks", json={"title": "t", "verify": "custom"}).status_code == 201
        assert client.post(f"{path}/pause").status_code == 200
        assert client.post(f"{path}/resume").status_code == 422
        assert client.post(f"{path}/agents", json={"name": "new", "kind": "backend"}).status_code == 422
        assert client.post(f"{path}/tasks", json={"title": "new", "verify": "unit"}).status_code == 422


def test_invalid_checkout_stops_before_database_initialization(project_config):
    settings, _ = project_config
    uncommitted = settings.runtime_config.parent / "uncommitted"
    subprocess.run(["git", "init", "-q", str(uncommitted)], check=True)
    text = settings.runtime_config.read_text(encoding="utf-8")
    settings.runtime_config.write_text(text.replace('path = "secondary"', 'path = "uncommitted"'), encoding="utf-8")
    with pytest.raises(ValueError, match="저장소 secondary: 커밋이 있는 Git 저장소"):
        with TestClient(create_app(settings, start_scheduler=False), base_url="http://localhost"):
            pytest.fail("invalid repository started")
    assert not settings.db_path.exists()


def test_scheduler_routes_chat_work_and_verification_to_selected_project(project_config, monkeypatch):
    import ycton.orchestration.acp_bridge as module

    settings, _ = project_config
    expected = settings.runtime_config.parent / "secondary"
    calls = []

    async def chat(*args, cwd, config, **kwargs):
        calls.append(("chat", cwd, config))
        return SimpleNamespace(session_id="chat-acp", stop_reason="end_turn")

    async def work(*args, repo, worktree, branch, config, **kwargs):
        calls.append(("work", repo, config))
        worktree.parent.mkdir(parents=True)
        git_out(repo, "worktree", "add", "-q", "-b", branch, str(worktree), "HEAD")
        (worktree / "proof.txt").write_text("secondary-worktree", encoding="utf-8")
        svc.commit_work(sid, ["proof.txt"], "Record verifier proof")
        return SimpleNamespace(session=SimpleNamespace(session_id="work-acp", stop_reason="end_turn", text="report"))

    monkeypatch.setattr(module, "run_session", chat)
    monkeypatch.setattr(module, "run_work_session", work)
    app = create_app(settings, start_scheduler=False)
    with TestClient(app, base_url="http://localhost"):
        svc = app.state.service
        scheduler = app.state.scheduler
        room = svc.create_room("two", "secondary")["id"]
        agent = svc.create_agent(room, "runner", "backend", [], model="routing-model", effort="low")["id"]
        task = svc.create_task(room, "change", "", "", "custom")["id"]
        svc.claim(task, agent)
        sid = svc.delegate(task, agent, "route-test", "")["id"]

        async def dispatch():
            scheduler.dispatch()
            await asyncio.gather(*scheduler.running.values())

        asyncio.run(dispatch())
        state = svc.snapshot(room)
        expected_config = {"model": "routing-model", "thought_level": "low"}
        assert sorted(calls) == [("chat", expected, expected_config), ("work", expected, expected_config)]
        assert state["tasks"][0]["status"] == "done"
        session = next(s for s in state["sessions"] if s["id"] == sid)
        assert session["acp_session_id"] == "work-acp"
        assert "exit_code=0\nsecondary-worktree" in session["verification_output"]
        assert session["commit_hash"] == state["tasks"][0]["commit_hash"] == git_out(session["worktree"], "rev-parse", "HEAD").strip()
        assert not (expected / "proof.txt").exists()


def test_manual_hold_is_visible_to_humans_but_not_mcp(bridge):
    app, client, actor, token, sid, tid, _ = bridge
    svc = app.state.service
    agent = int(actor["participant_id"])
    svc.claim(tid, agent)
    work = svc.delegate(tid, agent, "hold-via-http", "")["id"]
    assert client.post(f"/api/sessions/{work}/cancel").json()["status"] == "cancelled"
    svc.create_task(int(actor["room_id"]), "other", "", "", "unit")

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://127.0.0.1",
                                     headers={"Authorization": f"Bearer {token}"}) as http:
            mcp = build_room_server(http, **actor)
            (content,) = await mcp.call_tool("list_tasks", {})
            result = json.loads(content.text)
            assert [task["title"] for task in result["tasks"]] == ["other"]

    asyncio.run(exercise())
    state = client.get(f"/api/rooms/{actor['room_id']}/state").json()
    assert state["tasks"][0]["id"] == tid and state["tasks"][0]["retry_required"] == 1
