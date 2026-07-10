"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Link from 'next/link';
import {
  BrainCircuit, UploadCloud, Send, Loader2, CheckCircle2, AlertTriangle,
  FileText, LayoutDashboard, Library, Download, ChevronDown, ChevronRight,
  Zap, Search, BookOpen, Globe, Database, Timer, Activity, Cpu, Pin, X,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type ToolTask = { tool: string; query: string; doc_id?: string | null };

// A PDF ingested into the local vector store, addressable for isolated
// "Chat with Paper" runs via its backend-generated document ID.
type UploadedDoc = { docId: string; name: string };

type ToolTelemetryEvent = { count: number; tasks: ToolTask[] };

type TelemetryData = {
  execution_time: number;
  cache_hits: number;
  api_calls: number;
  tokens_saved: number;
};

type MessageRole = 'user' | 'assistant';

interface ChatMessage {
  id: string;
  role: MessageRole;
  // For assistant messages the content is built incrementally.
  assurance: string;          // instant intent acknowledgment
  toolTelemetry: ToolTelemetryEvent | null;
  report: string;             // final markdown report
  telemetry: TelemetryData | null;
  isStreaming: boolean;
  // For user messages only.
  text?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, React.ReactNode> = {
  web_searcher:    <Globe    className="w-3.5 h-3.5" />,
  arxiv_researcher:<BookOpen className="w-3.5 h-3.5" />,
  rag_retriever:   <Database className="w-3.5 h-3.5" />,
  web_crawler:     <Search   className="w-3.5 h-3.5" />,
};

const TOOL_LABELS: Record<string, string> = {
  web_searcher:    'Web Search',
  arxiv_researcher:'arXiv',
  rag_retriever:   'Local RAG',
  web_crawler:     'Web Crawl',
};

function generateId() {
  return Math.random().toString(36).slice(2);
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ToolAccordion({ telemetry, onPinDoc }: { telemetry: ToolTelemetryEvent; onPinDoc?: (docId: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 rounded-xl border border-slate-700 bg-slate-900/60 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800/60 transition-colors"
      >
        <span className="flex items-center gap-2 font-medium">
          <Search className="w-4 h-4 text-blue-400" />
          Ran analysis: {telemetry.count} search{telemetry.count !== 1 ? 'es' : ''}
        </span>
        {open
          ? <ChevronDown  className="w-4 h-4 text-slate-500" />
          : <ChevronRight className="w-4 h-4 text-slate-500" />}
      </button>
      {open && (
        <ul className="border-t border-slate-700 divide-y divide-slate-800">
          {telemetry.tasks.map((t, i) => (
            <li key={i} className="flex items-start gap-3 px-4 py-2.5">
              <span className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold text-blue-400 shrink-0 w-28">
                {TOOL_ICONS[t.tool] ?? <Search className="w-3.5 h-3.5" />}
                {TOOL_LABELS[t.tool] ?? t.tool}
              </span>
              <span className="flex-1 text-xs text-slate-400 leading-relaxed">{t.query}</span>
              {t.doc_id && onPinDoc && (
                <button
                  onClick={() => onPinDoc(t.doc_id!)}
                  className="shrink-0 flex items-center gap-1 text-[10px] font-semibold text-blue-400 hover:text-blue-300 border border-blue-500/30 hover:border-blue-400/50 rounded-md px-2 py-1 transition-colors"
                  title="Restrict your next questions to this document"
                >
                  <Pin className="w-3 h-3" /> Chat with this paper
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TelemetryBar({ data }: { data: TelemetryData }) {
  return (
    <div className="mt-4 grid grid-cols-4 gap-3">
      {[
        { icon: <Timer    className="w-4 h-4" />, label: 'Time',         value: `${data.execution_time}s`,                  color: 'text-blue-400',   bg: 'bg-blue-900/20' },
        { icon: <Activity className="w-4 h-4" />, label: 'API Calls',    value: String(data.api_calls),                     color: 'text-indigo-400', bg: 'bg-indigo-900/20' },
        { icon: <Database className="w-4 h-4" />, label: 'Cache Hits',   value: String(data.cache_hits),                    color: 'text-emerald-400',bg: 'bg-emerald-900/20' },
        { icon: <Cpu      className="w-4 h-4" />, label: 'Tokens Saved', value: `~${data.tokens_saved.toLocaleString()}`,   color: 'text-amber-400',  bg: 'bg-amber-900/20' },
      ].map(({ icon, label, value, color, bg }) => (
        <div key={label} className="flex items-center gap-3 bg-slate-900 border border-slate-800 rounded-xl p-3">
          <div className={`p-2 rounded-lg ${bg} ${color}`}>{icon}</div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
            <div className="text-sm font-semibold text-white">{value}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function AssistantBubble({ msg, onDownload, onPinDoc }: { msg: ChatMessage; onDownload: (msg: ChatMessage) => void; onPinDoc?: (docId: string) => void }) {
  return (
    <div className="flex flex-col gap-1 max-w-3xl">
      <div className="flex items-center gap-2 mb-1">
        <BrainCircuit className="w-5 h-5 text-blue-500" />
        <span className="text-xs font-semibold text-slate-400">A.R.I.A.</span>
      </div>

      {/* Assurance */}
      {msg.assurance && (
        <p className="text-slate-300 text-sm leading-relaxed italic">
          {msg.assurance}
          {msg.isStreaming && !msg.toolTelemetry && !msg.report && (
            <span className="inline-block w-1.5 h-4 bg-blue-400 ml-1 animate-pulse rounded-sm" />
          )}
        </p>
      )}

      {/* Tool accordion */}
      {msg.toolTelemetry && <ToolAccordion telemetry={msg.toolTelemetry} onPinDoc={onPinDoc} />}

      {/* Streaming indicator while report is being written */}
      {msg.isStreaming && msg.toolTelemetry && !msg.report && (
        <div className="flex items-center gap-2 mt-3 text-xs text-slate-500">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Synthesizing report...
        </div>
      )}

      {/* Final report */}
      {msg.report && (
        <div className="mt-4 bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-800">
            <span className="text-xs font-bold text-blue-500 uppercase tracking-widest">Final Report</span>
            <button
              onClick={() => onDownload(msg)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg transition-colors border border-slate-700 text-xs font-medium"
            >
              <Download className="w-3.5 h-3.5" /> Download
            </button>
          </div>
          <div className="prose prose-invert prose-blue max-w-none prose-headings:text-slate-200 prose-a:text-blue-400 hover:prose-a:text-blue-300 prose-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.report}</ReactMarkdown>
          </div>
        </div>
      )}

      {/* Telemetry bar */}
      {msg.telemetry && msg.report && <TelemetryBar data={msg.telemetry} />}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AgenticChat() {
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [query, setQuery]         = useState('');
  const [mode, setMode]           = useState('single');
  const [isModeOpen, setIsModeOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{
    type: 'idle' | 'loading' | 'success' | 'error'; message: string;
  }>({ type: 'idle', message: '' });

  // "Chat with Paper": documents ingested this session + the pinned focus doc.
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([]);
  const [pinnedDoc, setPinnedDoc] = useState<UploadedDoc | null>(null);

  // Stable session id for the lifetime of this browser tab.
  const sessionIdRef = useRef<string>(generateId());
  const bottomRef    = useRef<HTMLDivElement>(null);
  const modeRef      = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new content.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Close mode dropdown on outside click.
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modeRef.current && !modeRef.current.contains(e.target as Node))
        setIsModeOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const saveToHistory = (q: string, m: string, report: string) => {
    const existing = JSON.parse(localStorage.getItem('agenticHistory') || '[]');
    localStorage.setItem('agenticHistory', JSON.stringify([
      { id: Date.now().toString(), query: q, mode: m === 'single' ? 'Flash Agent' : 'Deep Parallel', report, date: new Date().toLocaleString() },
      ...existing,
    ]));
  };

  const handleDownload = (msg: ChatMessage) => {
    const title = msg.text || 'report';
    const blob  = new Blob([msg.report], { type: 'text/markdown' });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href      = url;
    a.download  = `${title.replace(/\s+/g, '_').toLowerCase()}_report.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const updateAssistantMsg = useCallback(
    (id: string, updater: (prev: ChatMessage) => Partial<ChatMessage>) => {
      setMessages(prev =>
        prev.map(m => m.id === id ? { ...m, ...updater(m) } : m)
      );
    },
    []
  );

  // Pin a document: subsequent submissions run in isolated "Chat with Paper"
  // mode against this document only, until the pin is dismissed.
  const pinDocById = (docId: string) => {
    const doc = uploadedDocs.find(d => d.docId === docId);
    setPinnedDoc(doc ?? { docId, name: 'pinned paper' });
    inputRef.current?.focus();
  };

  const handleResearch = async () => {
    const trimmed = query.trim();
    if (!trimmed || isLoading) return;

    const userMsgId = generateId();
    const asstMsgId = generateId();
    const userQuery = trimmed;
    const currentMode = mode;
    const focusDoc = pinnedDoc;

    setQuery('');
    setIsLoading(true);

    // Add user bubble immediately.
    setMessages(prev => [
      ...prev,
      {
        id: userMsgId, role: 'user', text: userQuery,
        assurance: '', toolTelemetry: null, report: '', telemetry: null, isStreaming: false,
      },
      {
        id: asstMsgId, role: 'assistant',
        assurance: '', toolTelemetry: null, report: '', telemetry: null, isStreaming: true,
      },
    ]);

    try {
      // Pinned paper focus routes to the isolated single-document endpoint.
      const endpoint = focusDoc ? 'research-paper-stream' : 'research-stream';
      const payload = focusDoc
        ? { query: userQuery, session_id: sessionIdRef.current, target_doc_id: focusDoc.docId }
        : { query: userQuery, mode: currentMode, session_id: sessionIdRef.current };

      const response = await fetch(`${API_URL}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.body) throw new Error('No readable stream available.');

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() ?? '';

        for (const block of blocks) {
          if (!block.trim()) continue;

          const eventMatch = block.match(/^event:\s*(.*)/m);
          const dataMatch  = block.match(/^data:\s*(.*)/m);
          if (!eventMatch || !dataMatch) continue;

          const event   = eventMatch[1].trim();
          const dataStr = dataMatch[1].trim();

          try {
            const data = JSON.parse(dataStr);

            if (event === 'assurance') {
              // Append streamed token to the assurance string.
              updateAssistantMsg(asstMsgId, prev => ({
                assurance: prev.assurance + (data.token ?? ''),
              }));

            } else if (event === 'tool_telemetry') {
              // First telemetry packet wins (subsequent loops add more).
              updateAssistantMsg(asstMsgId, prev => ({
                toolTelemetry: prev.toolTelemetry
                  ? { count: prev.toolTelemetry.count + data.count, tasks: [...prev.toolTelemetry.tasks, ...data.tasks] }
                  : data,
              }));

            } else if (event === 'telemetry') {
              updateAssistantMsg(asstMsgId, () => ({ telemetry: data }));

            } else if (event === 'complete') {
              const cleaned = (data.report as string).replace(/^(#\s*)?Research Summary:?\s*/i, '').trim();
              updateAssistantMsg(asstMsgId, () => ({ report: cleaned, isStreaming: false }));
              saveToHistory(userQuery, currentMode, cleaned);

            } else if (event === 'error') {
              updateAssistantMsg(asstMsgId, () => ({
                report: `**Error:** ${data.message ?? data}`,
                isStreaming: false,
              }));
            }
          } catch {
            // Malformed JSON block — skip silently.
          }
        }
      }
    } catch (err) {
      updateAssistantMsg(asstMsgId, () => ({
        report: '**Connection Error:** Make sure the FastAPI backend is running.',
        isStreaming: false,
      }));
    } finally {
      setIsLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadStatus({ type: 'loading', message: `Ingesting ${file.name}...` });
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res  = await fetch(`${API_URL}/upload-pdf`, { method: 'POST', body: formData });
      const data = await res.json();
      if (res.ok) {
        setUploadStatus({ type: 'success', message: `${file.name} embedded!` });
        // Register the doc so "Chat with this paper" can pin it.
        if (data.doc_id) {
          setUploadedDocs(prev => [{ docId: data.doc_id, name: data.filename || file.name }, ...prev]);
        }
      } else {
        setUploadStatus({ type: 'error', message: data.detail || 'Upload failed.' });
      }
    } catch {
      setUploadStatus({ type: 'error', message: 'Connection error during upload.' });
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-slate-950 text-slate-200 font-sans overflow-hidden">

      {/* SIDEBAR */}
      <aside className="w-72 bg-slate-900 border-r border-slate-800 p-6 flex flex-col shrink-0">
        <div className="flex items-center gap-3 mb-10">
          <BrainCircuit className="w-7 h-7 text-blue-500" />
          <h1 className="text-xl font-bold text-white tracking-tight">A.R.I.A.</h1>
        </div>

        <nav className="flex flex-col gap-1.5 mb-8">
          <Link href="/" className="flex items-center gap-3 px-4 py-2.5 bg-blue-600/10 text-blue-400 rounded-xl font-medium border border-blue-500/20">
            <LayoutDashboard className="w-4 h-4" /> New Research
          </Link>
          <Link href="/history" className="flex items-center gap-3 px-4 py-2.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl font-medium transition-colors">
            <Library className="w-4 h-4" /> Research Library
          </Link>
        </nav>

        <div className="mt-auto">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Knowledge Base</p>
          <label className="cursor-pointer flex flex-col items-center justify-center w-full h-32 border-2 border-slate-700 border-dashed rounded-xl hover:bg-slate-800 hover:border-blue-500 transition-all group">
            <UploadCloud className="w-7 h-7 text-slate-500 group-hover:text-blue-400 mb-1.5 transition-colors" />
            <p className="text-sm font-medium text-slate-300">Upload PDF to RAG</p>
            <p className="text-xs text-slate-500 mt-0.5">Updates local Vector DB</p>
            <input type="file" className="hidden" accept=".pdf" onChange={handleFileUpload} />
          </label>
          {uploadStatus.type !== 'idle' && (
            <div className={`mt-3 p-3 rounded-lg flex items-start gap-2 text-xs ${
              uploadStatus.type === 'loading' ? 'bg-blue-900/20 text-blue-400 border border-blue-900/50'
              : uploadStatus.type === 'success' ? 'bg-emerald-900/20 text-emerald-400 border border-emerald-900/50'
              : 'bg-red-900/20 text-red-400 border border-red-900/50'
            }`}>
              {uploadStatus.type === 'loading' && <Loader2 className="w-3.5 h-3.5 animate-spin mt-0.5" />}
              {uploadStatus.type === 'success' && <CheckCircle2 className="w-3.5 h-3.5 mt-0.5" />}
              {uploadStatus.type === 'error'   && <AlertTriangle className="w-3.5 h-3.5 mt-0.5" />}
              <span>{uploadStatus.message}</span>
            </div>
          )}

          {uploadedDocs.length > 0 && (
            <ul className="mt-4 flex flex-col gap-2">
              {uploadedDocs.map(doc => (
                <li key={doc.docId} className="flex items-center justify-between gap-2 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2">
                  <span className="flex items-center gap-2 text-xs text-slate-300 min-w-0">
                    <FileText className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span className="truncate">{doc.name}</span>
                  </span>
                  <button
                    onClick={() => { setPinnedDoc(doc); inputRef.current?.focus(); }}
                    className="shrink-0 flex items-center gap-1 text-[10px] font-semibold text-blue-400 hover:text-blue-300 border border-blue-500/30 hover:border-blue-400/50 rounded-md px-2 py-1 transition-colors"
                    title="Restrict your next questions to this document"
                  >
                    <Pin className="w-3 h-3" /> Chat with this paper
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* CHAT AREA */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">

        {/* Message list */}
        <div className="flex-1 overflow-y-auto px-6 py-8 space-y-8">

          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <FileText className="w-14 h-14 text-slate-800 mb-5" />
              <h2 className="text-2xl font-bold text-white mb-2">Start a Research Session</h2>
              <p className="text-slate-400 max-w-sm text-sm">
                Ask anything. A.R.I.A. will search the web, pull academic papers, and synthesize a cited report.
                Follow-up questions are supported.
              </p>
            </div>
          )}

          {messages.map(msg => (
            <div key={msg.id} className={`flex ${ msg.role === 'user' ? 'justify-end' : 'justify-start' }`}>
              {msg.role === 'user' ? (
                <div className="max-w-xl bg-blue-600/20 border border-blue-500/30 text-slate-200 rounded-2xl rounded-tr-sm px-5 py-3 text-sm leading-relaxed">
                  {msg.text}
                </div>
              ) : (
                <AssistantBubble msg={msg} onDownload={handleDownload} onPinDoc={pinDocById} />
              )}
            </div>
          ))}

          <div ref={bottomRef} />
        </div>

        {/* INPUT DOCK — fixed to bottom of chat area */}
        <div className="shrink-0 bg-gradient-to-t from-slate-950 via-slate-950/95 to-transparent pt-6 pb-6 px-6">
          <div className="max-w-3xl mx-auto bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl transition-all focus-within:border-blue-500/50">

            {pinnedDoc && (
              <div className="flex items-center justify-between px-5 pt-3">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold text-blue-400 bg-blue-600/10 border border-blue-500/30 rounded-full px-3 py-1 min-w-0">
                  <Pin className="w-3 h-3 shrink-0" />
                  <span className="truncate">Focused on: {pinnedDoc.name}</span>
                </span>
                <button
                  onClick={() => setPinnedDoc(null)}
                  className="shrink-0 text-slate-500 hover:text-white transition-colors"
                  title="Exit paper focus mode"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <div className="flex items-center px-5 pt-4 pb-2">
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleResearch()}
                placeholder={
                  isLoading ? 'Researching...'
                  : pinnedDoc ? `Ask about "${pinnedDoc.name}" (paper focus mode)...`
                  : messages.length > 0 ? 'Ask a follow-up question...'
                  : 'What would you like to research?'
                }
                className="flex-1 bg-transparent border-none text-white text-base focus:ring-0 outline-none placeholder-slate-500"
                disabled={isLoading}
              />
            </div>

            <div className="flex items-center justify-between border-t border-slate-800 px-4 py-2.5" ref={modeRef}>
              {/* Mode selector */}
              <div className="relative">
                <button
                  onClick={() => setIsModeOpen(o => !o)}
                  disabled={isLoading || !!pinnedDoc}
                  className="flex items-center gap-2 px-3 py-1.5 bg-slate-950 hover:bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-300 transition-colors disabled:opacity-50"
                >
                  {mode === 'single'
                    ? <><Zap className="w-3.5 h-3.5 text-amber-400" /> Flash Agent</>
                    : <><BrainCircuit className="w-3.5 h-3.5 text-purple-400" /> Deep Parallel</>}
                  <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform ${isModeOpen ? 'rotate-180' : ''}`} />
                </button>

                {isModeOpen && (
                  <div className="absolute bottom-full left-0 mb-2 w-56 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl overflow-hidden z-50">
                    {[
                      { value: 'single', icon: <Zap className="w-4 h-4 text-amber-400" />, label: 'Flash Agent',    desc: 'Iterative loop. Fast & efficient.' },
                      { value: 'deep',   icon: <BrainCircuit className="w-4 h-4 text-purple-400" />, label: 'Deep Parallel', desc: 'Multi-agent. Highly detailed.' },
                    ].map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => { setMode(opt.value); setIsModeOpen(false); }}
                        className={`w-full text-left px-4 py-3 hover:bg-slate-700 flex items-start gap-3 transition-colors border-b border-slate-700 last:border-0 ${ mode === opt.value ? 'bg-slate-700/50' : '' }`}
                      >
                        {opt.icon}
                        <div>
                          <div className="text-sm font-semibold text-white">{opt.label}</div>
                          <div className="text-xs text-slate-400 mt-0.5">{opt.desc}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Send button */}
              <button
                onClick={handleResearch}
                disabled={isLoading || !query.trim()}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-semibold rounded-xl px-5 py-2 text-sm transition-all"
              >
                {isLoading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Researching...</>
                  : <><Send className="w-4 h-4" /> Research</>}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
