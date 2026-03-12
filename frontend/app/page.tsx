'use client'

import { useState, useRef, useCallback, ChangeEvent, JSX, } from "react";
import { customScrollbar } from '../lib/scrollbar';

const API = "http://localhost:8000";

type Stage = "upload" | "choose" | "segment-select" | "question" | "deep-dive-options";
type Mode = "clarifying" | "deep_dive" | null;

interface Step {
  n: number;
  label: string;
}

interface QAEntry {
  timestamp: string;
  question: string;
  answer: string;
}

interface Segment {
  name: string;
  summary: string;
  startIndex: number;
  endIndex: number;
}

type SegmentMode = "manual" | "llm";

interface PendingSegment {
  startIndex: number;
  endIndex: number;
  x: number;
  y: number;
}

interface GenerateOptions {
  step: number;
  mode?: Mode;
  textOverride?: string;
  segmentIndex?: number;
  history?: QAEntry[];
}

const STEPS: Step[] = [
  { n: 1, label: "Description" },
  { n: 2, label: "Feelings" },
  { n: 3, label: "Evaluation" },
  { n: 4, label: "Analysis" },
  { n: 5, label: "Conclusion" },
  { n: 6, label: "Action" },
];

export default function Home(): JSX.Element {
  const [stage, setStage] = useState<Stage>("upload");
  const [filename, setFilename] = useState<string>("");
  const [mode, setMode] = useState<Mode>(null);
  const [step, setStep] = useState<number>(1);
  const [deepDiveStep, setDeepDiveStep] = useState<number | null>(null);
  const [question, setQuestion] = useState<string>("");
  const [answer, setAnswer] = useState<string>("");
  const [history, setHistory] = useState<QAEntry[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [journalText, setJournalText] = useState<string>("");
  const [selectedSegment, setSelectedSegment] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [segmentMode, setSegmentMode] = useState<SegmentMode>("manual");
  const [pendingSegment, setPendingSegment] = useState<PendingSegment | null>(null);
  const [segmentName, setSegmentName] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);
  const journalRef = useRef<HTMLDivElement>(null);

  async function handleUpload(e: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setLoading(true);
    const form = new FormData();
    form.append("file", file);
    try {
      const res = await fetch(`${API}/upload`, { method: "POST", body: form });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Something went wrong");
      }
      const data = await res.json();
      setFilename(data.filename);
      setStage("choose");
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error";
      setError(error);
    } finally {
      setLoading(false);
    }
  }

  async function generate({ step, mode: m = mode, textOverride, segmentIndex, history: historyOverride }: GenerateOptions): Promise<void> {
    setLoading(true);
    setQuestion("");
    setError("");
    try {
      const segmentData = segmentIndex !== undefined && segments[segmentIndex]
        ? {
          segment: textOverride || null,
          segment_indexes: [segments[segmentIndex].startIndex, segments[segmentIndex].endIndex]
        }
        : {
          segment: null,
          segment_indexes: null
        };

      const res = await fetch(`${API}/generate-question`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: m,
          step: m === "deep_dive" ? step : null,
          topic: null,
          history: historyOverride ?? history,
          ...segmentData,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Something went wrong");
      }
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const payload = line.slice(6);
            if (payload === "[DONE]") break;
            try {
              const { token } = JSON.parse(payload);
              setQuestion((q) => q + token);
            } catch { }
          }
        }
      }
      setStage("question");
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error";
      setError(error);
    } finally {
      setLoading(false);
    }
  }

  function handleModeSelect(m: Mode): void {
    setMode(m);
    setAnswer("");
    setQuestion("");
    if (m === "clarifying") generate({ step: 0, mode: m });
  }

  function saveAnswerAndGetHistory(): QAEntry[] {
    if (!answer.trim()) return history;
    const updated = [...history, { timestamp: new Date().toISOString(), question, answer }];
    setHistory(updated);
    setAnswer("");
    return updated;
  }

  function handleSubmitAnswer(): void {
    saveAnswerAndGetHistory();
    if (mode === "deep_dive") {
      setStage("deep-dive-options");
      setQuestion("");
    } else if (mode === "clarifying" && deepDiveStep !== null) {
      // Returning from clarifying detour — go back to deep dive options
      setMode("deep_dive");
      setStep(deepDiveStep);
      setStage("deep-dive-options");
      setQuestion("");
    } else {
      goBackToModes();
    }
  }

  function deepDiveAskAnother(): void {
    const textOverride = selectedSegment !== null ? segments[selectedSegment].name + "\n" + segments[selectedSegment].summary : undefined;
    generate({ step, mode: "deep_dive", textOverride, segmentIndex: selectedSegment ?? undefined, history });
  }

  function deepDiveNextStep(): void {
    const next = step + 1;
    setStep(next);
    const textOverride = selectedSegment !== null ? segments[selectedSegment].name + "\n" + segments[selectedSegment].summary : undefined;
    generate({ step: next, mode: "deep_dive", textOverride, segmentIndex: selectedSegment ?? undefined, history });
  }

  function startClarifyingDetour(): void {
    setDeepDiveStep(step);
    setMode("clarifying");
    setAnswer("");
    generate({ step: 0, mode: "clarifying", history });
  }

  function goBackToModes(): void {
    setStage("choose");
    setMode(null);
    setQuestion("");
    setAnswer("");
    setDeepDiveStep(null);
    setError("");
  }

  function getCharOffset(container: HTMLElement, node: Node, offset: number): number {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let charCount = 0;
    let current = walker.nextNode();
    while (current) {
      if (current === node) return charCount + offset;
      charCount += (current.textContent?.length ?? 0);
      current = walker.nextNode();
    }
    return charCount + offset;
  }

  function getOverlapping(startIdx: number, endIdx: number): number[] {
    const indices: number[] = [];
    segments.forEach((seg, i) => {
      if (startIdx < seg.endIndex && endIdx > seg.startIndex) indices.push(i);
    });
    return indices;
  }

  const handleMouseUp = useCallback(() => {
    if (segmentMode !== "manual" || !journalRef.current) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (!journalRef.current.contains(range.startContainer) || !journalRef.current.contains(range.endContainer)) return;

    const startIdx = getCharOffset(journalRef.current, range.startContainer, range.startOffset);
    const endIdx = getCharOffset(journalRef.current, range.endContainer, range.endOffset);
    if (startIdx >= endIdx) return;

    // Remove any overlapping segments — the new selection replaces them
    const overlapping = getOverlapping(startIdx, endIdx);
    if (overlapping.length > 0) {
      setSegments((prev) => prev.filter((_, i) => !overlapping.includes(i)));
    }

    const rect = range.getBoundingClientRect();
    const containerRect = journalRef.current.getBoundingClientRect();
    setPendingSegment({
      startIndex: startIdx,
      endIndex: endIdx,
      x: rect.left - containerRect.left + rect.width / 2,
      y: rect.bottom - containerRect.top + 8,
    });
    setSegmentName("");
    setError("");
    sel.removeAllRanges();
  }, [segmentMode, segments, journalText]);

  function confirmSegment(): void {
    if (!pendingSegment || !segmentName.trim()) return;
    const selectedText = journalText.slice(pendingSegment.startIndex, pendingSegment.endIndex);
    setSegments((prev) => [...prev, {
      name: segmentName.trim(),
      summary: selectedText.slice(0, 100),
      startIndex: pendingSegment.startIndex,
      endIndex: pendingSegment.endIndex,
    }]);
    setPendingSegment(null);
    setSegmentName("");
    window.getSelection()?.removeAllRanges();
  }

  function cancelSegment(): void {
    setPendingSegment(null);
    setSegmentName("");
    window.getSelection()?.removeAllRanges();
  }

  function removeSegment(idx: number): void {
    setSegments((prev) => prev.filter((_, i) => i !== idx));
  }

  async function startDeepDive(): Promise<void> {
    setLoading(true);
    setError("");
    setMode("deep_dive");
    setSegmentMode("manual");
    setSegments([]);
    setPendingSegment(null);
    try {
      const res = await fetch(`${API}/journal-text`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to load journal");
      }
      const data = await res.json();
      setJournalText(data.journal_text);
      setStage("segment-select");
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error";
      setError(error);
    } finally {
      setLoading(false);
    }
  }

  async function loadLlmSegments(): Promise<void> {
    setLoading(true);
    setError("");
    try {
      const segRes = await fetch(`${API}/segment`, { method: "POST" });
      if (!segRes.ok) {
        const data = await segRes.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to load segments");
      }
      const data = await segRes.json();
      setSegments(data.segments);
      setJournalText(data.journal_text);
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error";
      setError(error);
    } finally {
      setLoading(false);
    }
  }

  function selectSegmentAndDive(segmentIndex: number): void {
    setSelectedSegment(segmentIndex);
    setMode("deep_dive");
    const segment = segments[segmentIndex];
    const segmentText = segment ? segment.name + "\n" + segment.summary : "";
    setStep(1);
    generate({ step: 1, mode: "deep_dive", textOverride: segmentText, segmentIndex: segmentIndex ?? undefined });
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#0e0e0e] p-8 font-serif">
      <div className="w-full max-w-lg bg-[#161616] border border-[#2a2a2a] rounded p-10">

        {/* Header */}
        <div className="flex items-center gap-2 mb-8">
          <span className="text-2xl text-[#c8b89a]">◎</span>
          <h1 className="text-sm font-normal tracking-widest text-[#e8e0d4]">reflect</h1>
        </div>

        {loading ? (
          <div className="flex flex-col items-center gap-3 py-6">
            <div className="w-5 h-5 rounded-full border border-[#999] border-t-transparent animate-spin" />
            <p className="text-xs tracking-widest text-[#999]">thinking</p>
          </div>
        ) : (
          <>
            {/* Upload */}
            {stage === "upload" && (
              <div className="flex flex-col gap-5">
                <p className="text-xs tracking-wide text-[#999]">upload a journal entry to begin</p>
                <label className="flex flex-col items-center justify-center gap-2 border border-dashed border-[#2e2e2e] rounded p-10 cursor-pointer text-[#555] hover:border-[#444] transition-colors">
                  <input ref={fileRef} type="file" accept=".txt" onChange={handleUpload} className="hidden" />
                  <span className="text-2xl text-[#c8b89a]">↑</span>
                  <span className="text-xs">.txt file</span>
                </label>
              </div>
            )}

            {/* Choose mode */}
            {stage === "choose" && (
              <div className="flex flex-col gap-5">
                <p className="text-xs text-[#555]">↳ {filename}</p>
                <p className="text-xs tracking-wide text-[#999]">how do you want to reflect?</p>
                <div className="flex gap-3 flex-wrap">
                  <button className="bg-transparent border border-[#3a3a3a] rounded-sm text-[#c8b89a] px-4 py-2 text-xs tracking-wider cursor-pointer hover:border-[#c8b89a] transition-colors disabled:opacity-40"
                    onClick={() => handleModeSelect("clarifying")}>broad questions</button>
                  <button className="bg-transparent border border-[#3a3a3a] rounded-sm text-[#c8b89a] px-4 py-2 text-xs tracking-wider cursor-pointer hover:border-[#c8b89a] transition-colors disabled:opacity-40"
                    onClick={startDeepDive}>deep dive</button>
                </div>
              </div>
            )}

            {/* Select Segment for Deep Dive */}
            {stage === "segment-select" && (
              <div className="flex flex-col gap-5">
                {/* Mode toggle */}
                <div className="flex gap-3">
                  <button
                    className={`px-4 py-2 text-xs tracking-wider rounded-sm border cursor-pointer transition-colors ${segmentMode === "manual"
                      ? "border-[#c8b89a] text-[#c8b89a]"
                      : "border-[#3a3a3a] text-[#555] hover:border-[#555]"
                      }`}
                    onClick={() => { setSegmentMode("manual"); setPendingSegment(null); }}
                  >
                    manual
                  </button>
                  <button
                    className={`px-4 py-2 text-xs tracking-wider rounded-sm border cursor-pointer transition-colors ${segmentMode === "llm"
                      ? "border-[#c8b89a] text-[#c8b89a]"
                      : "border-[#3a3a3a] text-[#555] hover:border-[#555]"
                      }`}
                    onClick={() => { setSegmentMode("llm"); setPendingSegment(null); loadLlmSegments(); }}
                  >
                    llm-based
                  </button>
                </div>

                <p className="text-xs tracking-wide text-[#999]">
                  {segmentMode === "manual"
                    ? "select text to create segments, then click one to explore"
                    : "click a highlighted segment to explore it"}
                </p>

                {/* Journal text with highlighted segments */}
                <div
                  ref={journalRef}
                  className={`${customScrollbar}relative max-h-80 overflow-y-auto border border-[#2a2a2a] rounded p-4 text-sm leading-relaxed text-[#999] select-text whitespace-pre-wrap`}
                  onMouseUp={segmentMode === "manual" ? handleMouseUp : undefined}
                >
                  {(() => {
                    const colors = ["#c8b89a", "#9ab8c8", "#b89ac8", "#9ac8a3", "#c89a9a", "#c8c09a"];
                    // Merge confirmed segments + pending selection into one sorted list for rendering
                    const allRanges: { startIndex: number; endIndex: number; originalIndex: number; isPending: boolean; name: string; summary: string }[] =
                      segments.map((s, i) => ({ ...s, originalIndex: i, isPending: false }));
                    if (pendingSegment) {
                      allRanges.push({
                        startIndex: pendingSegment.startIndex,
                        endIndex: pendingSegment.endIndex,
                        originalIndex: -1,
                        isPending: true,
                        name: "",
                        summary: "",
                      });
                    }
                    allRanges.sort((a, b) => a.startIndex - b.startIndex);

                    const parts: JSX.Element[] = [];
                    let lastEnd = 0;
                    allRanges.forEach((seg) => {
                      if (seg.startIndex > lastEnd) {
                        parts.push(<span key={`gap-${lastEnd}`}>{journalText.slice(lastEnd, seg.startIndex)}</span>);
                      }
                      if (seg.isPending) {
                        parts.push(
                          <span
                            key="pending"
                            className="rounded px-0.5"
                            style={{ backgroundColor: "#c8b89a33", borderBottom: "2px dashed #c8b89a" }}
                          >
                            {journalText.slice(seg.startIndex, seg.endIndex)}
                          </span>
                        );
                      } else {
                        const color = colors[seg.originalIndex % colors.length];
                        parts.push(
                          <span
                            key={`seg-${seg.originalIndex}`}
                            className="cursor-pointer rounded px-0.5 transition-opacity hover:opacity-80"
                            style={{ backgroundColor: color + "22", borderBottom: `2px solid ${color}` }}
                            title={`${seg.name}: ${seg.summary}`}
                            onClick={() => selectSegmentAndDive(seg.originalIndex)}
                          >
                            {journalText.slice(seg.startIndex, seg.endIndex)}
                          </span>
                        );
                      }
                      lastEnd = seg.endIndex;
                    });
                    if (lastEnd < journalText.length) {
                      parts.push(<span key="tail">{journalText.slice(lastEnd)}</span>);
                    }
                    return parts;
                  })()}

                  {/* Naming popup */}
                  {pendingSegment && (
                    <div
                      className="absolute z-10 bg-[#1e1e1e] border border-[#3a3a3a] rounded p-3 flex flex-col gap-2 shadow-lg"
                      style={{ left: Math.max(0, pendingSegment.x - 100), top: pendingSegment.y, width: 200 }}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <p className="text-xs text-[#999]">name this segment</p>
                      <input
                        className="w-full bg-[#0e0e0e] border border-[#2e2e2e] rounded-sm text-[#e8e0d4] px-2 py-1 text-xs font-serif outline-none focus:border-[#444] transition-colors"
                        placeholder="segment name..."
                        value={segmentName}
                        onChange={(e) => setSegmentName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") confirmSegment(); if (e.key === "Escape") cancelSegment(); }}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button
                          className="flex-1 bg-transparent border border-[#3a3a3a] rounded-sm text-[#c8b89a] px-2 py-1 text-xs cursor-pointer hover:border-[#c8b89a] transition-colors disabled:opacity-40"
                          onClick={confirmSegment}
                          disabled={!segmentName.trim()}
                        >
                          create
                        </button>
                        <button
                          className="flex-1 bg-transparent border border-[#555] rounded-sm text-[#999] px-2 py-1 text-xs cursor-pointer hover:border-[#777] transition-colors"
                          onClick={cancelSegment}
                        >
                          cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Segment legend */}
                {segments.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {segments.map((seg, idx) => {
                      const colors = ["#c8b89a", "#9ab8c8", "#b89ac8", "#9ac8a3", "#c89a9a", "#c8c09a"];
                      const color = colors[idx % colors.length];
                      return (
                        <div key={idx} className="flex items-center gap-1">
                          <button
                            className="text-xs px-2 py-1 rounded border cursor-pointer transition-colors hover:opacity-80"
                            style={{ borderColor: color, color: color }}
                            onClick={() => selectSegmentAndDive(idx)}
                          >
                            {seg.name}
                          </button>
                          <button
                            className="text-xs text-[#555] hover:text-[#a05050] cursor-pointer transition-colors"
                            onClick={() => removeSegment(idx)}
                            title="remove segment"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="flex gap-3 flex-wrap">
                  <button
                    className="bg-transparent border border-[#3a3a3a] rounded-sm text-[#c8b89a] px-4 py-2 text-xs tracking-wider cursor-pointer hover:border-[#c8b89a] transition-colors"
                    onClick={() => { setMode("deep_dive"); setStep(1); generate({ step: 1, mode: "deep_dive" }); }}
                  >
                    skip — explore all
                  </button>
                  <button
                    className="bg-transparent border border-[#555] rounded-sm text-[#999] px-4 py-2 text-xs tracking-wider cursor-pointer hover:border-[#777] hover:text-[#ccc] transition-colors"
                    onClick={goBackToModes}
                  >
                    back to modes
                  </button>
                </div>
              </div>
            )}

            {/* Question */}
            {stage === "question" && (
              <div className="flex flex-col gap-5">
                {mode === "deep_dive" && (
                  <div className="flex justify-between w-full">
                    {STEPS.map((st) => (
                      <div key={st.n} className="flex flex-col items-center gap-1">
                        <div className={`w-2 h-2 rounded-full transition-colors duration-300 ${st.n === step ? "bg-[#c8b89a]" : st.n < step ? "bg-[#555]" : "bg-[#2e2e2e]"}`} />
                        <span className={`text-[10px] tracking-wide transition-colors duration-300 ${st.n === step ? "text-[#c8b89a]" : st.n < step ? "text-[#555]" : "text-[#2e2e2e]"}`}>{st.label.toLowerCase()}</span>
                      </div>
                    ))}
                  </div>
                )}
                {mode === "clarifying" && deepDiveStep !== null && (
                  <p className="text-xs text-[#555]">clarifying detour — will return to step {deepDiveStep}</p>
                )}
                <p className="text-base leading-relaxed text-[#e8e0d4] min-h-16">{question || "..."}</p>
                <textarea
                  className="w-full bg-[#0e0e0e] border border-[#2e2e2e] rounded-sm text-[#e8e0d4] px-3 py-2 text-sm font-serif outline-none focus:border-[#444] transition-colors resize-none"
                  placeholder="Your answer..."
                  rows={4}
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                />
                <button className="bg-transparent border border-[#3a3a3a] rounded-sm text-[#c8b89a] px-4 py-2 text-xs tracking-wider cursor-pointer hover:border-[#c8b89a] transition-colors"
                  onClick={handleSubmitAnswer}>answer</button>
              </div>
            )}

            {/* Deep Dive Options (after answering) */}
            {stage === "deep-dive-options" && (
              <div className="flex flex-col gap-5">
                <div className="flex justify-between w-full">
                  {STEPS.map((st) => (
                    <div key={st.n} className="flex flex-col items-center gap-1">
                      <div className={`w-2 h-2 rounded-full transition-colors duration-300 ${st.n === step ? "bg-[#c8b89a]" : st.n < step ? "bg-[#555]" : "bg-[#2e2e2e]"}`} />
                      <span className={`text-[10px] tracking-wide transition-colors duration-300 ${st.n === step ? "text-[#c8b89a]" : st.n < step ? "text-[#555]" : "text-[#2e2e2e]"}`}>{st.label.toLowerCase()}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs tracking-wide text-[#999]">what would you like to do next?</p>
                <div className="flex flex-col gap-3">
                  <button className="bg-transparent border border-[#3a3a3a] rounded-sm text-[#c8b89a] px-4 py-2 text-xs tracking-wider cursor-pointer hover:border-[#c8b89a] transition-colors"
                    onClick={deepDiveAskAnother}>ask another — {STEPS[step - 1]?.label.toLowerCase()}</button>
                  {step < 6 && (
                    <button className="bg-transparent border border-[#3a3a3a] rounded-sm text-[#c8b89a] px-4 py-2 text-xs tracking-wider cursor-pointer hover:border-[#c8b89a] transition-colors"
                      onClick={deepDiveNextStep}>next step → {STEPS[step]?.label.toLowerCase()}</button>
                  )}
                  <button className="bg-transparent border border-[#3a3a3a] rounded-sm text-[#c8b89a] px-4 py-2 text-xs tracking-wider cursor-pointer hover:border-[#c8b89a] transition-colors"
                    onClick={startClarifyingDetour}>clarifying question</button>
                  <button className="bg-transparent border border-[#555] rounded-sm text-[#999] px-4 py-2 text-xs tracking-wider cursor-pointer hover:border-[#777] hover:text-[#ccc] transition-colors"
                    onClick={goBackToModes}>back to modes</button>
                </div>
              </div>
            )}

            {error && <p className="mt-4 text-xs text-[#a05050]">{error}</p>}
          </>
        )}

      </div>
    </main>
  );
}
