"""Keep the orchestration server's Jev credential out of local subprocesses."""
import os


def child_environment(**overrides: str) -> dict[str, str]:
    env = os.environ.copy()
    env.update(overrides)
    env.pop("OPENROUTER_API_KEY", None)
    return env
