"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Link from 'next/link';
import {
  BrainCircuit, UploadCloud, Send, Loader2, CheckCircle2, AlertTriangle,
  FileText, Download, ChevronDown, ChevronRight, Check,
  Search, BookOpen, Globe, Database, Timer, Activity, Cpu, Pin, X,
  MessageSquare, Plus, Table2, Clock, Book, Bell, FileSearch, ListChecks, Sparkles,
} from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api';

// \u2500\u2500\u2500 Types \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

type ToolTask = { tool: string; query: string; doc_id?: string | null };

type UploadedDoc = { docId: string; name: string };

type ToolTelemetryEvent = { count: number; tasks: ToolTask[] };

type TelemetryData = {
  execution_time: number;
  cache_hits: number;
  api_calls: number;
  tokens_saved: number;
};

type ExtractionRecord = {
  title: string;
  url_or_source: string;
  abstract_summary: string;
  methodology: string;
  sample_size: string;
  key_findings: string;
};

// Elicit command-bar selections sent to the backend as `workflow_mode`.
type WorkflowMode =
  | 'find_papers'
  | 'chat_with_papers'
  | 'extract_data'
  | 'research_agent'
  | 'report'
  | 'systematic_review';

type WorkflowOption = {
  value: WorkflowMode;
  label: string;
  desc: string;
  group: 'TOOLS' | 'WORKFLOWS';
};

const WORKFLOW_OPTIONS: WorkflowOption[] = [
  { value: 'find_papers',       label: 'Find papers',       desc: 'Parallel search with an extraction matrix.',   group: 'TOOLS' },
  { value: 'chat_with_papers',  label: 'Chat with papers',  desc: 'Answer from your uploaded documents only.',    group: 'TOOLS' },
  { value: 'extract_data',      label: 'Extract data',      desc: 'Structured data extraction from sources.',     group: 'TOOLS' },
  { value: 'research_agent',    label: 'Research agent',    desc: 'Clarifies scope, then runs deep research.',    group: 'WORKFLOWS' },
  { value: 'report',            label: 'Report',            desc: 'Long-form literature review.',                 group: 'WORKFLOWS' },
  { value: 'systematic_review', label: 'Systematic review', desc: 'PRISMA-style search, screening, synthesis.',   group: 'WORKFLOWS' },
];

const WORKFLOW_ICONS: Record<WorkflowMode, React.ReactNode> = {
  find_papers:       <FileSearch className="w-4 h-4" />,
  chat_with_papers:  <MessageSquare className="w-4 h-4" />,
  extract_data:      <Table2 className="w-4 h-4" />,
  research_agent:    <Sparkles className="w-4 h-4" />,
  report:            <FileText className="w-4 h-4" />,
  systematic_review: <ListChecks className="w-4 h-4" />,
};

type MessageRole = 'user' | 'assistant';

interface ChatMessage {
  id: string;
  role: MessageRole;
  assurance: string;
  chatText: string;
  toolTelemetry: ToolTelemetryEvent | null;
  report: string;
  extractionMatrix: ExtractionRecord[] | null;
  telemetry: TelemetryData | null;
  isStreaming: boolean;
  text?: string;
}

type SessionSummary = { id: string; title: string; updatedAt: string };
type StoredSession = SessionSummary & { messages: ChatMessage[] };

// \u2500\u2500\u2500 Helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

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

const SESSIONS_KEY = 'agenticSessions';
const MAX_STORED_SESSIONS = 30;

function generateId() {
  return Math.random().toString(36).slice(2);
}

function readStoredSessions(): StoredSession[] {
  try {
    return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]') as StoredSession[];
  } catch {
    return [];
  }
}

function normalizeMessage(msg: Partial<ChatMessage>): ChatMessage {
  return {
    id: msg.id ?? generateId(),
    role: msg.role ?? 'assistant',
    assurance: msg.assurance ?? '',
    chatText: msg.chatText ?? '',
    toolTelemetry: msg.toolTelemetry ?? null,
    report: msg.report ?? '',
    extractionMatrix: msg.extractionMatrix ?? null,
    telemetry: msg.telemetry ?? null,
    isStreaming: false,
    text: msg.text,
  };
}

// \u2500\u2500\u2500 Sub-components \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

function ToolAccordion({ telemetry, onPinDoc }: { telemetry: ToolTelemetryEvent; onPinDoc?: (docId: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-slate-600 hover:bg-slate-100 transition-colors"
      >
        <span className="flex items-center gap-2 font-medium">
          <Search className="w-4 h-4 text-teal-600" />
          Ran analysis: {telemetry.count} search{telemetry.count !== 1 ? 'es' : ''}
        </span>
        {open
          ? <ChevronDown  className="w-4 h-4 text-slate-400" />
          : <ChevronRight className="w-4 h-4 text-slate-400" />}
      </button>
      {open && (
        <ul className="border-t border-slate-200 divide-y divide-slate-100 bg-white">
          {telemetry.tasks.map((t, i) => (
            <li key={i} className="flex items-start gap-3 px-4 py-2.5">
              <span className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold text-teal-700 shrink-0 w-28">
                {TOOL_ICONS[t.tool] ?? <Search className="w-3.5 h-3.5" />}
                {TOOL_LABELS[t.tool] ?? t.tool}
              </span>
              <span className="flex-1 text-xs text-slate-500 leading-relaxed">{t.query}</span>
              {t.doc_id && onPinDoc && (
                <button
                  onClick={() => onPinDoc(t.doc_id!)}
                  className="shrink-0 flex items-center gap-1 text-[10px] font-semibold text-teal-700 hover:text-teal-800 border border-teal-200 hover:border-teal-400 rounded-md px-2 py-1 transition-colors"
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
        { icon: <Timer    className="w-4 h-4" />, label: 'Time',         value: `${data.execution_time}s`,                color: 'text-teal-600',    bg: 'bg-teal-50' },
        { icon: <Activity className="w-4 h-4" />, label: 'API Calls',    value: String(data.api_calls),                   color: 'text-indigo-600',  bg: 'bg-indigo-50' },
        { icon: <Database className="w-4 h-4" />, label: 'Cache Hits',   value: String(data.cache_hits),                  color: 'text-emerald-600', bg: 'bg-emerald-50' },
        { icon: <Cpu      className="w-4 h-4" />, label: 'Tokens Saved', value: `~${data.tokens_saved.toLocaleString()}`, color: 'text-amber-600',   bg: 'bg-amber-50' },
      ].map(({ icon, label, value, color, bg }) => (
        <div key={label} className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl p-3">
          <div className={`p-2 rounded-lg ${bg} ${color}`}>{icon}</div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
            <div className="text-sm font-semibold text-[#0F172A]">{value}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ExtractionGrid({ records }: { records: ExtractionRecord[] }) {
  if (!records.length) return null;
  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-200 bg-slate-50">
        <Table2 className="w-4 h-4 text-teal-600" />
        <span className="text-xs font-bold text-teal-700 uppercase tracking-widest">Extraction Matrix</span>
        <span className="ml-auto text-[10px] font-semibold text-slate-400">
          {records.length} source{records.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="bg-slate-50 text-slate-500 uppercase tracking-wider text-[10px] border-b border-slate-200">
              <th className="px-4 py-3 font-bold min-w-[180px]">Paper Title</th>
              <th className="px-4 py-3 font-bold min-w-[220px]">Abstract Summary</th>
              <th className="px-4 py-3 font-bold min-w-[160px]">Methodology</th>
              <th className="px-4 py-3 font-bold min-w-[90px]">Sample Size</th>
              <th className="px-4 py-3 font-bold min-w-[220px]">Key Findings</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {records.map((r, i) => (
              <tr key={i} className="hover:bg-teal-50/50 transition-colors align-top">
                <td className="px-4 py-3 font-semibold text-[#0F172A]">
                  {/^https?:\/\//i.test(r.url_or_source) ? (
                    <a
                      href={r.url_or_source}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-teal-700 hover:text-teal-800 hover:underline"
                    >
                      {r.title || r.url_or_source}
                    </a>
                  ) : (
                    <>
                      {r.title}
                      {r.url_or_source && (
                        <span className="block text-[10px] text-slate-400 font-normal mt-1">{r.url_or_source}</span>
                      )}
                    </>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-600 leading-relaxed">{r.abstract_summary}</td>
                <td className="px-4 py-3 text-slate-600 leading-relaxed">{r.methodology}</td>
                <td className="px-4 py-3 text-slate-700">{r.sample_size}</td>
                <td className="px-4 py-3 text-slate-600 leading-relaxed">{r.key_findings}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AssistantBubble({ msg, onDownload, onPinDoc }: { msg: ChatMessage; onDownload: (msg: ChatMessage) => void; onPinDoc?: (docId: string) => void }) {
  return (
    <div className="flex flex-col gap-1 max-w-3xl w-full">
      <div className="flex items-center gap-2 mb-1">
        <BrainCircuit className="w-5 h-5 text-teal-600" />
        <span className="text-xs font-semibold text-slate-500">A.R.I.A.</span>
      </div>

      {msg.assurance && (
        <p className="text-slate-500 text-sm leading-relaxed italic">
          {msg.assurance}
          {msg.isStreaming && !msg.toolTelemetry && !msg.report && !msg.chatText && (
            <span className="inline-block w-1.5 h-4 bg-teal-500 ml-1 animate-pulse rounded-sm" />
          )}
        </p>
      )}

      {msg.chatText && (
        <div className="text-slate-800 text-sm leading-relaxed">
          <div className="prose prose-slate max-w-none prose-sm prose-p:my-2 prose-a:text-teal-700">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.chatText}</ReactMarkdown>
          </div>
          {msg.isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-teal-500 animate-pulse rounded-sm" />
          )}
        </div>
      )}

      {msg.toolTelemetry && <ToolAccordion telemetry={msg.toolTelemetry} onPinDoc={onPinDoc} />}

      {msg.isStreaming && msg.toolTelemetry && !msg.report && (
        <div className="flex items-center gap-2 mt-3 text-xs text-slate-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Synthesizing report...
        </div>
      )}

      {msg.report && (
        <div className="mt-4 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-200">
            <span className="text-xs font-bold text-teal-700 uppercase tracking-widest">Final Report</span>
            <button
              onClick={() => onDownload(msg)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-600 hover:text-[#0F172A] rounded-lg transition-colors border border-slate-200 text-xs font-medium"
            >
              <Download className="w-3.5 h-3.5" /> Download
            </button>
          </div>
          <div className="prose prose-slate max-w-none prose-headings:text-[#0F172A] prose-a:text-teal-700 hover:prose-a:text-teal-800 prose-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.report}</ReactMarkdown>
          </div>
        </div>
      )}

      {msg.extractionMatrix && msg.extractionMatrix.length > 0 && (
        <ExtractionGrid records={msg.extractionMatrix} />
      )}

      {msg.telemetry && msg.report && <TelemetryBar data={msg.telemetry} />}
    </div>
  );
}

// \u2500\u2500\u2500 Elicit Command Bar \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

function CommandBar({
  query, setQuery, workflow, setWorkflow, onSubmit, isLoading,
  pinnedDoc, onClearPin, inputRef, dropUp,
}: {
  query: string;
  setQuery: (v: string) => void;
  workflow: WorkflowMode;
  setWorkflow: (w: WorkflowMode) => void;
  onSubmit: () => void;
  isLoading: boolean;
  pinnedDoc: UploadedDoc | null;
  onClearPin: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  dropUp: boolean;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selected = WORKFLOW_OPTIONS.find(o => o.value === workflow) ?? WORKFLOW_OPTIONS[0];

  return (
    <div className="bg-white border border-slate-300 rounded-2xl shadow-lg transition-all focus-within:border-teal-500 focus-within:ring-2 focus-within:ring-teal-500/20">

      {pinnedDoc && (
        <div className="flex items-center justify-between px-5 pt-3">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-teal-700 bg-teal-50 border border-teal-200 rounded-full px-3 py-1 min-w-0">
            <Pin className="w-3 h-3 shrink-0" />
            <span className="truncate">Focused on: {pinnedDoc.name}</span>
          </span>
          <button
            onClick={onClearPin}
            className="shrink-0 text-slate-400 hover:text-[#0F172A] transition-colors"
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
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && onSubmit()}
          placeholder={
            isLoading ? 'Working...'
            : pinnedDoc ? `Ask about "${pinnedDoc.name}" (paper focus mode)...`
            : workflow === 'research_agent' ? 'Describe your research goal...'
            : 'Search for a topic, question, or paper...'
          }
          className="flex-1 bg-transparent border-none text-[#0F172A] text-base focus:ring-0 outline-none placeholder-slate-400"
          disabled={isLoading}
        />
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2.5">
        {/* TOOLS / WORKFLOWS dropdown */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setOpen(o => !o)}
            disabled={isLoading}
            className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 transition-colors disabled:opacity-50"
          >
            <span className="text-teal-600">{WORKFLOW_ICONS[selected.value]}</span>
            {selected.label}
            <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>

          {open && (
            /* Constrained container: max-h + overflow-y-auto keeps the expanded
               TOOLS/WORKFLOWS categories inside the viewport with a smooth
               vertical scrollbar instead of spilling off-screen. */
            <div className={`absolute left-0 w-72 bg-white border border-slate-200 rounded-xl shadow-2xl max-h-[320px] overflow-y-auto overscroll-contain z-50 ${dropUp ? 'bottom-full mb-2' : 'top-full mt-2'}`}>
              {(['TOOLS', 'WORKFLOWS'] as const).map(group => (
                <div key={group}>
                  <div className="px-4 pt-3 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                    {group}
                  </div>
                  {WORKFLOW_OPTIONS.filter(o => o.group === group).map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => { setWorkflow(opt.value); setOpen(false); }}
                      className={`w-full text-left px-4 py-2.5 flex items-start gap-3 transition-colors ${
                        workflow === opt.value ? 'bg-teal-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span className={`mt-0.5 ${workflow === opt.value ? 'text-teal-600' : 'text-slate-400'}`}>
                        {WORKFLOW_ICONS[opt.value]}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className={`block text-sm font-semibold ${workflow === opt.value ? 'text-teal-700' : 'text-[#0F172A]'}`}>
                          {opt.label}
                        </span>
                        <span className="block text-xs text-slate-400 mt-0.5">{opt.desc}</span>
                      </span>
                      {workflow === opt.value && <Check className="w-4 h-4 text-teal-600 mt-1 shrink-0" />}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Send button */}
        <button
          onClick={onSubmit}
          disabled={isLoading || !query.trim()}
          className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 disabled:bg-slate-100 disabled:text-slate-400 text-white font-semibold rounded-xl px-5 py-2 text-sm transition-all"
        >
          {isLoading
            ? <><Loader2 className="w-4 h-4 animate-spin" /> Working...</>
            : <><Send className="w-4 h-4" /> Send</>}
        </button>
      </div>
    </div>
  );
}

// \u2500\u2500\u2500 Main Page \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

export default function AgenticChat() {
  const [messages, setMessages]   = useState<ChatMessage[]>([]);
  const [query, setQuery]         = useState('');
  const [workflow, setWorkflow]   = useState<WorkflowMode>('find_papers');
  const [isLoading, setIsLoading] = useState(false);
  const [showRecents, setShowRecents] = useState(true);
  const [uploadStatus, setUploadStatus] = useState<{
    type: 'idle' | 'loading' | 'success' | 'error'; message: string;
  }>({ type: 'idle', message: '' });

  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([]);
  const [pinnedDoc, setPinnedDoc] = useState<UploadedDoc | null>(null);

  const [recentSessions, setRecentSessions] = useState<SessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState('');

  const sessionIdRef = useRef<string>(generateId());
  const bottomRef    = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setRecentSessions(
      readStoredSessions().map(({ id, title, updatedAt }) => ({ id, title, updatedAt }))
    );
    setActiveSessionId(sessionIdRef.current);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Persist the full session timeline (bubbles + matrices) after each turn.
  useEffect(() => {
    if (isLoading || messages.length === 0) return;
    const sessions = readStoredSessions();
    const sessionTitle =
      messages.find(m => m.role === 'user')?.text?.slice(0, 80) || 'Untitled session';
    const entry: StoredSession = {
      id: sessionIdRef.current,
      title: sessionTitle,
      updatedAt: new Date().toISOString(),
      messages,
    };
    const next = [entry, ...sessions.filter(s => s.id !== entry.id)].slice(0, MAX_STORED_SESSIONS);
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(next));
    setRecentSessions(next.map(({ id, title, updatedAt }) => ({ id, title, updatedAt })));
  }, [isLoading, messages]);

  const saveToHistory = (q: string, workflowLabel: string, report: string) => {
    const existing = JSON.parse(localStorage.getItem('agenticHistory') || '[]');
    localStorage.setItem('agenticHistory', JSON.stringify([
      { id: Date.now().toString(), query: q, mode: workflowLabel, report, date: new Date().toLocaleString() },
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

  const pinDocById = (docId: string) => {
    const doc = uploadedDocs.find(d => d.docId === docId);
    setPinnedDoc(doc ?? { docId, name: 'pinned paper' });
    inputRef.current?.focus();
  };

  const loadSession = (id: string) => {
    if (isLoading) return;
    const session = readStoredSessions().find(s => s.id === id);
    if (!session) return;
    sessionIdRef.current = id;
    setActiveSessionId(id);
    setPinnedDoc(null);
    setMessages(session.messages.map(normalizeMessage));
    inputRef.current?.focus();
  };

  const startNewSession = () => {
    if (isLoading) return;
    sessionIdRef.current = generateId();
    setActiveSessionId(sessionIdRef.current);
    setMessages([]);
    setPinnedDoc(null);
    inputRef.current?.focus();
  };

  const handleResearch = async () => {
    const trimmed = query.trim();
    if (!trimmed || isLoading) return;

    const userMsgId = generateId();
    const asstMsgId = generateId();
    const userQuery = trimmed;
    const currentWorkflow = workflow;
    const workflowLabel = WORKFLOW_OPTIONS.find(o => o.value === currentWorkflow)?.label ?? currentWorkflow;
    const focusDoc = pinnedDoc;

    setQuery('');
    setIsLoading(true);

    setMessages(prev => [
      ...prev,
      {
        id: userMsgId, role: 'user', text: userQuery,
        assurance: '', chatText: '', toolTelemetry: null, report: '', extractionMatrix: null, telemetry: null, isStreaming: false,
      },
      {
        id: asstMsgId, role: 'assistant',
        assurance: '', chatText: '', toolTelemetry: null, report: '', extractionMatrix: null, telemetry: null, isStreaming: true,
      },
    ]);

    // Set when `message` tokens arrive: this turn is conversational (chat reply
    // or a Research Agent clarification), not a report.
    let isChatTurn = false;

    try {
      const endpoint = focusDoc ? 'research-paper-stream' : 'research-stream';
      // The selected dropdown value travels to the backend as workflow_mode.
      const payload = focusDoc
        ? { query: userQuery, session_id: sessionIdRef.current, target_doc_id: focusDoc.docId, workflow_mode: 'chat_with_papers' }
        : { query: userQuery, mode: 'single', session_id: sessionIdRef.current, workflow_mode: currentWorkflow };

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
              updateAssistantMsg(asstMsgId, prev => ({
                assurance: prev.assurance + (data.token ?? ''),
              }));

            } else if (event === 'message') {
              isChatTurn = true;
              updateAssistantMsg(asstMsgId, prev => ({
                chatText: prev.chatText + (data.token ?? ''),
              }));

            } else if (event === 'tool_telemetry') {
              updateAssistantMsg(asstMsgId, prev => ({
                toolTelemetry: prev.toolTelemetry
                  ? { count: prev.toolTelemetry.count + data.count, tasks: [...prev.toolTelemetry.tasks, ...data.tasks] }
                  : data,
              }));

            } else if (event === 'matrix') {
              updateAssistantMsg(asstMsgId, () => ({
                extractionMatrix: (data.extraction_matrix as ExtractionRecord[]) ?? [],
              }));

            } else if (event === 'telemetry') {
              updateAssistantMsg(asstMsgId, () => ({ telemetry: data }));

            } else if (event === 'complete') {
              const raw = (data.report as string) ?? '';
              if (isChatTurn) {
                updateAssistantMsg(asstMsgId, prev => ({
                  chatText: raw || prev.chatText,
                  report: '',
                  isStreaming: false,
                }));
              } else {
                const cleaned = raw.replace(/^(#\s*)?Research Summary:?\s*/i, '').trim();
                updateAssistantMsg(asstMsgId, () => ({ report: cleaned, isStreaming: false }));
                saveToHistory(userQuery, workflowLabel, cleaned);
              }

            } else if (event === 'error') {
              updateAssistantMsg(asstMsgId, () => ({
                report: `**Error:** ${data.message ?? data}`,
                isStreaming: false,
              }));
            }
          } catch {
            // Malformed JSON block \u2014 skip silently.
          }
        }
      }
    } catch {
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

  const navItemClass = 'flex items-center gap-3 px-4 py-2.5 text-slate-600 hover:text-[#0F172A] hover:bg-slate-100 rounded-xl font-medium text-sm transition-colors';

  // \u2500\u2500\u2500 Render \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  return (
    <div className="flex h-screen bg-white text-[#0F172A] font-sans overflow-hidden">

      {/* SIDEBAR */}
      <aside className="w-72 bg-slate-50 border-r border-slate-200 p-5 flex flex-col shrink-0">
        <div className="flex items-center gap-3 mb-6">
          <BrainCircuit className="w-7 h-7 text-teal-600" />
          <h1 className="text-xl font-bold text-[#0F172A] tracking-tight">A.R.I.A.</h1>
        </div>

        <nav className="flex flex-col gap-1 mb-6">
          <button
            onClick={startNewSession}
            disabled={isLoading}
            className="flex items-center gap-3 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-semibold text-sm transition-colors disabled:opacity-50 text-left"
          >
            <Plus className="w-4 h-4" /> New
          </button>
          <button onClick={() => setShowRecents(s => !s)} className={navItemClass}>
            <Clock className="w-4 h-4" /> Recents
          </button>
          <Link href="/history" className={navItemClass}>
            <Book className="w-4 h-4" /> Library
          </Link>
          <button className={`${navItemClass} cursor-default`} title="Coming soon">
            <Bell className="w-4 h-4" /> Alerts
            <span className="ml-auto text-[9px] bg-slate-200 text-slate-500 rounded-full px-1.5 py-0.5 font-bold">SOON</span>
          </button>
        </nav>

        {/* RECENTS */}
        {showRecents && (
          <div className="flex-1 min-h-0 flex flex-col mb-6">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3 px-1">Recents</p>
            <div className="flex-1 overflow-y-auto flex flex-col gap-1 pr-1">
              {recentSessions.length === 0 && (
                <p className="text-xs text-slate-400 px-1">No sessions yet. Start researching!</p>
              )}
              {recentSessions.map(session => (
                <button
                  key={session.id}
                  onClick={() => loadSession(session.id)}
                  disabled={isLoading}
                  className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors border disabled:opacity-50 ${
                    session.id === activeSessionId
                      ? 'bg-teal-50 border-teal-200 text-teal-800'
                      : 'bg-transparent border-transparent text-slate-500 hover:bg-slate-100 hover:text-[#0F172A]'
                  }`}
                  title={session.title}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate text-xs font-medium">{session.title}</span>
                  </span>
                  <span className="block text-[10px] text-slate-400 mt-0.5 ml-5">
                    {new Date(session.updatedAt).toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {!showRecents && <div className="flex-1" />}

        {/* KNOWLEDGE BASE */}
        <div className="shrink-0">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest mb-3 px-1">Knowledge Base</p>
          <label className="cursor-pointer flex flex-col items-center justify-center w-full h-28 border-2 border-slate-300 border-dashed rounded-xl hover:bg-teal-50/40 hover:border-teal-500 transition-all group bg-white">
            <UploadCloud className="w-7 h-7 text-slate-400 group-hover:text-teal-600 mb-1.5 transition-colors" />
            <p className="text-sm font-medium text-slate-700">Upload PDF to RAG</p>
            <p className="text-xs text-slate-400 mt-0.5">Updates local Vector DB</p>
            <input type="file" className="hidden" accept=".pdf" onChange={handleFileUpload} />
          </label>
          {uploadStatus.type !== 'idle' && (
            <div className={`mt-3 p-3 rounded-lg flex items-start gap-2 text-xs ${
              uploadStatus.type === 'loading' ? 'bg-teal-50 text-teal-700 border border-teal-200'
              : uploadStatus.type === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {uploadStatus.type === 'loading' && <Loader2 className="w-3.5 h-3.5 animate-spin mt-0.5" />}
              {uploadStatus.type === 'success' && <CheckCircle2 className="w-3.5 h-3.5 mt-0.5" />}
              {uploadStatus.type === 'error'   && <AlertTriangle className="w-3.5 h-3.5 mt-0.5" />}
              <span>{uploadStatus.message}</span>
            </div>
          )}

          {uploadedDocs.length > 0 && (
            <ul className="mt-4 flex flex-col gap-2 max-h-36 overflow-y-auto">
              {uploadedDocs.map(doc => (
                <li key={doc.docId} className="flex items-center justify-between gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2">
                  <span className="flex items-center gap-2 text-xs text-slate-700 min-w-0">
                    <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <span className="truncate">{doc.name}</span>
                  </span>
                  <button
                    onClick={() => { setPinnedDoc(doc); inputRef.current?.focus(); }}
                    className="shrink-0 flex items-center gap-1 text-[10px] font-semibold text-teal-700 hover:text-teal-800 border border-teal-200 hover:border-teal-400 rounded-md px-2 py-1 transition-colors"
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

      {/* MAIN AREA */}
      <main className="flex-1 flex flex-col h-full overflow-hidden bg-white">

        {messages.length === 0 ? (
          /* HERO: central Elicit-style command component */
          <div className="flex-1 flex flex-col items-center justify-center px-6">
            <h2 className="text-3xl font-semibold text-[#0F172A] mb-3 tracking-tight">
              What do you want to research?
            </h2>
            <p className="text-slate-500 text-sm mb-8 max-w-md text-center">
              Find papers, extract data, chat with your documents, or run full research workflows.
            </p>
            <div className="w-full max-w-2xl">
              <CommandBar
                query={query} setQuery={setQuery}
                workflow={workflow} setWorkflow={setWorkflow}
                onSubmit={handleResearch} isLoading={isLoading}
                pinnedDoc={pinnedDoc} onClearPin={() => setPinnedDoc(null)}
                inputRef={inputRef} dropUp={false}
              />
            </div>
          </div>
        ) : (
          <>
            {/* Message list */}
            <div className="flex-1 overflow-y-auto px-6 py-8 space-y-8">
              {messages.map(msg => (
                <div key={msg.id} className={`flex ${ msg.role === 'user' ? 'justify-end' : 'justify-start' }`}>
                  {msg.role === 'user' ? (
                    <div className="max-w-xl bg-slate-100 border border-slate-200 text-slate-800 rounded-2xl rounded-tr-sm px-5 py-3 text-sm leading-relaxed">
                      {msg.text}
                    </div>
                  ) : (
                    <AssistantBubble msg={msg} onDownload={handleDownload} onPinDoc={pinDocById} />
                  )}
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Docked command bar */}
            <div className="shrink-0 bg-gradient-to-t from-white via-white/95 to-transparent pt-6 pb-6 px-6">
              <div className="max-w-3xl mx-auto">
                <CommandBar
                  query={query} setQuery={setQuery}
                  workflow={workflow} setWorkflow={setWorkflow}
                  onSubmit={handleResearch} isLoading={isLoading}
                  pinnedDoc={pinnedDoc} onClearPin={() => setPinnedDoc(null)}
                  inputRef={inputRef} dropUp={true}
                />
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
