"""실행 세션에만 유효한 MCP 토큰. 토큰은 DB·프롬프트·브라우저에 반환하지 않는다."""
from dataclasses import dataclass
import secrets


@dataclass(frozen=True)
class Identity:
    session_id: str
    room_id: int
    agent_id: int


class Tokens:
    def __init__(self):
        self._tokens = {}

    def issue(self, identity: Identity):
        token = secrets.token_urlsafe(32)
        self._tokens[token] = identity
        return token

    def resolve(self, token):
        return self._tokens.get(token)

    def revoke(self, token):
        self._tokens.pop(token, None)
