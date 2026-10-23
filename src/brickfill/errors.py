from __future__ import annotations


def safe_exception_message(exc: BaseException, secret: str, limit: int = 2000) -> str:
    """Flatten exception groups while ensuring credentials never reach logs or Delta."""
    messages: list[str] = []
    seen: set[int] = set()

    def visit(error: BaseException) -> None:
        if id(error) in seen:
            return
        seen.add(id(error))
        messages.append(f"{type(error).__name__}: {error}")
        for child in getattr(error, "exceptions", ()):
            if isinstance(child, BaseException):
                visit(child)
        cause = error.__cause__ or error.__context__
        if cause is not None:
            visit(cause)

    visit(exc)
    return " | ".join(messages).replace(secret, "[REDACTED]")[:limit]
