"""
Orchestrator Module
===================
The master controller for the entire Agentic AI system.
Implements a Map-Reduce concurrency pattern, capable of breaking down
a complex user query into sub-tasks (Map), spinning up independent asynchronous
LangGraph workers to research each sub-task in parallel, and aggregating the results
into a cohesive final document (Reduce).

Conversational upgrade:
- Per-session sliding-window chat memory (SessionStore) keyed by frontend session_id.
- Worker graph compiled with a LangGraph MemorySaver checkpointer; every run gets
  a unique thread_id derived from the session.
- Structured streaming: `assurance` (instant intent acknowledgment tokens),
  `tool_telemetry` (exact concurrent tool queries), `progress`, `telemetry`,
  and `complete` events.
"""

import asyncio
import time
import json
import uuid

from langgraph.checkpoint.memory import MemorySaver

from core_engine.nodes.strategy_planner import strategy_planner_node
from core_engine.loop_worker import build_loop_worker, ResearchState
from core_engine.llm_router import LLMRouter
from core_engine.session_memory import SessionStore, format_messages_for_prompt
from core_engine.utilities.progress import (
    sanitize_status,
    emit_progress,
    register_progress_stream,
    release_progress_stream,
)

ASSURANCE_PROMPT = (
    "You are A.R.I.A., an autonomous research assistant. "
    "In one or two short sentences, tell the user exactly what you are about to research "
    "and which kinds of sources you will consult (web results, academic papers on arXiv, "
    "or their uploaded documents). Start with a phrase like \"I'll\". "
    "Return plain text only: no markdown, no lists, no emojis."
)


def _chunk_text(chunk) -> str:
    """Extract plain text from a streamed LLM chunk (Gemini may return part lists)."""
    content = getattr(chunk, "content", "")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            part if isinstance(part, str) else str(part.get("text", ""))
            for part in content
        )
    return ""


class ResearchOrchestrator:
    """
    Manages the lifecycle and execution of LangGraph research loops.
    """

    def __init__(self):
        # Checkpointer enables thread-scoped LangGraph state persistence.
        self.checkpointer = MemorySaver()
        self.worker_graph = build_loop_worker(checkpointer=self.checkpointer)
        # Conversational memory: session_id -> sliding window of chat messages.
        self.sessions = SessionStore()

    def _thread_config(self, session_id: str | None) -> dict:
        """Build a unique LangGraph thread config for a single worker run."""
        thread_id = f"{session_id or 'anonymous'}::{uuid.uuid4().hex}"
        return {"configurable": {"thread_id": thread_id}}

    async def _run_single_section(
        self,
        overall_query: str,
        section_title: str,
        section_question: str,
        semaphore: asyncio.Semaphore,
        stream_id: str | None = None,
        chat_history: list | None = None,
        session_id: str | None = None,
    ) -> str:
        async with semaphore:
            initial_state: ResearchState = {
                "query": overall_query,
                "current_section_title": section_title,
                "current_section": section_question,
                "research_history": "",
                "research_complete": False,
                "current_gaps": [section_question],
                "pending_tool_tasks": [],
                "completed_sections": [],
                "loop_count": 0,
                "chat_history": chat_history or [],
            }

            print(f"\U0001f9f5 [Worker Spawned] Starting research loop for: '{section_title}'")

            if stream_id is not None:
                initial_state["progress_stream_id"] = stream_id
                emit_progress(initial_state, f"[Worker] Starting research for {section_title}.")

            final_state = await self.worker_graph.ainvoke(
                initial_state, config=self._thread_config(session_id)
            )
            return final_state["completed_sections"][0]

    async def run_deep_research(
        self,
        query: str,
        progress_queue: asyncio.Queue | None = None,
        session_id: str | None = None,
    ) -> str:
        print(f"\n\U0001f680 [Orchestrator] Starting Deep Research for: '{query}'\n")

        stream_id = None
        if progress_queue is not None:
            stream_id = register_progress_stream(progress_queue)
            progress_queue.put_nowait(sanitize_status("[Orchestrator] Starting deep parallel research."))

        chat_history = self.sessions.get_messages(session_id)

        try:
            planner_state = {"query": query}
            if progress_queue is not None:
                # The planner runs outside the checkpointed graph, so the live
                # queue handle is safe to pass directly here.
                planner_state["progress_queue"] = progress_queue
            plan_state = strategy_planner_node(planner_state)
            report_plan = plan_state["report_plan"]

            print(f"\n\U0001f4cb [Orchestrator] Blueprint generated! {len(report_plan.report_outline)} sections required.")

            semaphore = asyncio.Semaphore(2)

            tasks = []
            for section in report_plan.report_outline:
                task_coroutine = self._run_single_section(
                    query,
                    section.title,
                    section.key_question,
                    semaphore,
                    stream_id,
                    chat_history,
                    session_id,
                )
                tasks.append(asyncio.create_task(task_coroutine))

            print("\n\u26a1 [Orchestrator] Firing parallel research loops...\n")

            try:
                completed_sections = await asyncio.gather(*tasks)
            except Exception as e:
                print(f"\n\U0001f6a8 [Orchestrator] CRITICAL WORKER FAILURE: {str(e)}")
                for t in tasks:
                    if not t.done():
                        t.cancel()
                raise e

            print("\n\U0001f4da [Orchestrator] All workers finished. Compiling final report...\n")

            final_report = f"# {report_plan.report_title}\n\n"
            final_report += f"**Background Context:**\n{report_plan.background_context}\n\n"
            final_report += "---\n\n"
            final_report += "\n\n".join(completed_sections)

            # Record this turn so follow-up questions can reference the report.
            self.sessions.append_turn(session_id, query, final_report)

            return final_report
        finally:
            if stream_id:
                release_progress_stream(stream_id)

    async def run_single_research(
        self,
        query: str,
        progress_queue: asyncio.Queue | None = None,
        session_id: str | None = None,
    ) -> str:
        print(f"\n\U0001f680 [Orchestrator] Starting Single Iterative Research for: '{query}'\n")

        initial_state: ResearchState = {
            "query": query,
            "current_section_title": "Research Summary",
            "current_section": query,
            "research_history": "",
            "research_complete": False,
            "current_gaps": [query],
            "pending_tool_tasks": [],
            "completed_sections": [],
            "loop_count": 0,
            "chat_history": self.sessions.get_messages(session_id),
        }

        stream_id = None
        if progress_queue is not None:
            stream_id = register_progress_stream(progress_queue)
            initial_state["progress_stream_id"] = stream_id
            progress_queue.put_nowait(sanitize_status("[Orchestrator] Starting single-agent iterative research."))

        try:
            final_state = await self.worker_graph.ainvoke(
                initial_state, config=self._thread_config(session_id)
            )
        finally:
            if stream_id:
                release_progress_stream(stream_id)

        report = final_state["completed_sections"][0]

        # Record this turn so follow-up questions can reference the report.
        self.sessions.append_turn(session_id, query, report)

        return report

    async def _assurance_stream(self, query: str, session_id: str | None = None):
        """
        Stream an instant, Elicit-style intent acknowledgment from the fast model.
        Falls back to a deterministic sentence if the LLM call fails, so the UI
        always receives an assurance message first.
        """
        fallback = (
            f"I'll research \"{query}\" across the web and recent academic literature, "
            "then synthesize a cited report for you."
        )
        try:
            router = LLMRouter()
            llm = router.fast_model
            history = format_messages_for_prompt(
                self.sessions.get_messages(session_id), max_chars=2000
            )
            messages = [
                ("system", ASSURANCE_PROMPT),
                ("human", f"Prior conversation:\n{history}\n\nNew research request: {query}"),
            ]
            streamed_any = False
            async for chunk in llm.astream(messages):
                text = _chunk_text(chunk)
                if text:
                    streamed_any = True
                    yield text
            if not streamed_any:
                yield fallback
        except Exception:
            yield fallback

    async def stream_research(self, query: str, mode: str, session_id: str | None = None):
        """
        Streams structured events: assurance tokens first, then progress and
        tool_telemetry packets while workers run, then telemetry stats and the
        final report.
        """
        progress_queue: asyncio.Queue = asyncio.Queue()

        start_time = time.time()
        cache_hits = 0
        api_calls = 0

        if mode == "single":
            research_task = asyncio.create_task(
                self.run_single_research(query, progress_queue, session_id)
            )
        elif mode == "deep":
            research_task = asyncio.create_task(
                self.run_deep_research(query, progress_queue, session_id)
            )
        else:
            yield {"event": "error", "data": "Invalid mode. Use 'single' or 'deep'."}
            return

        # 1. ASSURANCE FIRST: the workers are already spinning up in the background
        # while we stream the instant intent acknowledgment to the user.
        async for token in self._assurance_stream(query, session_id):
            yield {"event": "assurance", "data": token}

        # 2. LIVE PROGRESS + STRUCTURED TELEMETRY LOOP
        while not research_task.done():
            try:
                message = await asyncio.wait_for(progress_queue.get(), timeout=0.25)
            except asyncio.TimeoutError:
                continue

            # Structured packets (e.g. tool_telemetry) pass through verbatim.
            if isinstance(message, dict) and "event" in message:
                yield message
                continue

            clean_msg = sanitize_status(message)

            # Dynamically Track Network vs Cache
            if "Cache hit" in clean_msg:
                cache_hits += 1
            elif "Searching" in clean_msg or "Evaluating" in clean_msg or "Querying" in clean_msg:
                api_calls += 1

            yield {"event": "progress", "data": clean_msg}

        # Drain the remaining queue
        while not progress_queue.empty():
            message = progress_queue.get_nowait()
            if isinstance(message, dict) and "event" in message:
                yield message
                continue
            clean_msg = sanitize_status(message)
            if "Cache hit" in clean_msg:
                cache_hits += 1
            yield {"event": "progress", "data": clean_msg}

        try:
            report = await research_task

            # CALCULATE FINAL TELEMETRY
            execution_time = round(time.time() - start_time, 2)
            tokens_saved = cache_hits * 4500  # Estimate of tokens saved by bypassing the scrape

            telemetry_payload = json.dumps({
                "execution_time": execution_time,
                "cache_hits": cache_hits,
                "api_calls": api_calls,
                "tokens_saved": tokens_saved
            })

            yield {"event": "telemetry", "data": telemetry_payload}
            yield {"event": "complete", "data": report}

        except Exception as e:
            yield {"event": "error", "data": sanitize_status(str(e))}
