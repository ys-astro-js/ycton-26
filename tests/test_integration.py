"""실제 모델 호출 없이 런타임 계약·HTTP·MCP·검증 프로세스를 연결해 검증한다."""
import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient
from ycton.orchestration.config import Settings
from ycton.orchestration.main import create_app
from ycton.orchestration.identity import Identity, Tokens
from ycton.orchestration.runtime_config import RuntimeConfig, AgentKind, Verification
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
    config=RuntimeConfig(root,root/'worktrees',root/'logs','http://127.0.0.1:8000',
                         {'demo':AgentKind(('fake-adapter',))},
                         {'unit':Verification((sys.executable,'-c',"print('verified')"))})
    prompt=json.dumps({'title':'task','detail':'','scope':'','verify':'unit','instruction':'go','handoff':''})
    request=RuntimeRequest(session['id'],int(actor['room_id']),int(actor['participant_id']),'work',prompt,'demo',tid)
    return svc, config, request


def test_work_adapter_persists_path_and_checks_verification(bridge,monkeypatch):
    import ycton.orchestration.acp_bridge as module
    svc,config,request=setup_work(bridge)
    async def work(*args,**kwargs):
        with svc.db.connect() as c:
            assert c.execute('SELECT worktree FROM sessions WHERE id=?',(request.session_id,)).fetchone()[0] == str(kwargs['worktree'])
        kwargs['worktree'].mkdir(parents=True)
        kwargs['on_update']({'update':'progress'})
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
    config=RuntimeConfig(root,root/'worktrees',root/'logs','http://127.0.0.1:8000',
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
    request=RuntimeRequest(sid,int(actor['room_id']),int(actor['participant_id']),'chat','context','demo')
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


def test_work_mcp_exposes_only_send():
    async def exercise():
        async with httpx.AsyncClient(base_url="http://127.0.0.1") as client:
            server = build_room_server(client, room_id="1", participant_id="2", work=True)
            assert {t.name for t in await server.list_tools()} == {"send"}
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
