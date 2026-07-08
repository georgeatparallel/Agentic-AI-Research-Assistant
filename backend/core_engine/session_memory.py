"""
Session Memory Module
=====================
Lightweight conversational memory for the research engine.

Each frontend chat session (identified by a `session_id` generated in the browser)
maps to a sliding window of LangChain messages (HumanMessage / AIMessage pairs).
The orchestrator seeds every LangGraph worker with this history via the
`chat_history` state field (tracked with LangGraph's `add_messages` reducer),
so the Gap Analyzer and Synthesizer can reference previously generated reports
when the user asks a follow-up question.
"""

from typing import Dict, List, Optional

from langchain_core.messages import AIMessage, BaseMessage, HumanMessage

# Sliding window: keep the last N user/assistant turn pairs per session.
MAX_TURNS = 4
# Cap each stored message so old reports cannot blow up the LLM context window.
MAX_MESSAGE_CHARS = 6000


class SessionStore:
    """In-process store mapping session_id -> sliding window of chat messages."""

    def __init__(self, max_turns: int = MAX_TURNS):
        self._sessions: Dict[str, List[BaseMessage]] = {}
        self.max_turns = max_turns

    def get_messages(self, session_id: Optional[str]) -> List[BaseMessage]:
        """Return a copy of the stored chat history for a session (empty if unknown)."""
        if not session_id:
            return []
        return list(self._sessions.get(session_id, []))

    def append_turn(self, session_id: Optional[str], query: str, report: str) -> None:
        """Record one completed research turn (user question + generated report)."""
        if not session_id:
            return
        history = self._sessions.setdefault(session_id, [])
        history.append(HumanMessage(content=query))
        history.append(AIMessage(content=(report or "")[:MAX_MESSAGE_CHARS]))

        # Enforce the sliding window (2 messages per turn).
        max_messages = self.max_turns * 2
        if len(history) > max_messages:
            del history[: len(history) - max_messages]

    def clear(self, session_id: Optional[str]) -> None:
        """Drop all memory for a session."""
        if session_id:
            self._sessions.pop(session_id, None)


def format_messages_for_prompt(messages: List[BaseMessage], max_chars: int = 8000) -> str:
    """Render chat messages as a plain-text transcript for prompt injection."""
    if not messages:
        return "No prior conversation."

    lines = []
    for message in messages:
        role = "User" if isinstance(message, HumanMessage) else "Assistant"
        content = message.content if isinstance(message.content, str) else str(message.content)
        lines.append(f"{role}: {content}")

    text = "\n\n".join(lines)
    return text[-max_chars:] if len(text) > max_chars else text
