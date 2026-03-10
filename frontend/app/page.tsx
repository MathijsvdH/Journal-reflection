'use client'

import { useState, useRef, ChangeEvent, JSX } from "react";

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
  const fileRef = useRef<HTMLInputElement>(null);

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

  async function startDeepDive(): Promise<void> {
    setLoading(true);
    setError("");
    try {
      // Fetch segments
      const segRes = await fetch(`${API}/segment`, { method: "POST" });
      if (!segRes.ok) {
        const data = await segRes.json().catch(() => ({}));
        throw new Error(data.detail || "Failed to load segments");
      }
      const data = await segRes.json();
      setSegments(data.segments);
      setJournalText(data.journal_text);

      if (data.segments.length > 0) {
        setStage("segment-select");
        setLoading(false);
      } else {
        setStep(1);
        setLoading(false);
        await generate({ step: 1, mode: "deep_dive" });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : "Unknown error";
      setError(error);
      setLoading(false);
    }
  }

  function selectSegmentAndDive(segmentIndex: number): void {
    setSelectedSegment(segmentIndex);
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
                <p className="text-xs tracking-wide text-[#999]">click a highlighted segment to explore it</p>

                {/* Journal text with highlighted segments */}
                <div className="max-h-80 overflow-y-auto border border-[#2a2a2a] rounded p-4 text-sm leading-relaxed text-[#999]">
                  {(() => {
                    const colors = ["#c8b89a", "#9ab8c8", "#b89ac8", "#9ac8a3", "#c89a9a", "#c8c09a"];
                    const parts: JSX.Element[] = [];
                    let lastEnd = 0;
                    const sorted = [...segments]
                      .map((s, i) => ({ ...s, originalIndex: i }))
                      .sort((a, b) => a.startIndex - b.startIndex);
                    sorted.forEach((seg) => {
                      if (seg.startIndex > lastEnd) {
                        parts.push(<span key={`gap-${lastEnd}`}>{journalText.slice(lastEnd, seg.startIndex)}</span>);
                      }
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
                      lastEnd = seg.endIndex;
                    });
                    if (lastEnd < journalText.length) {
                      parts.push(<span key="tail">{journalText.slice(lastEnd)}</span>);
                    }
                    return parts;
                  })()}
                </div>

                {/* Segment legend */}
                <div className="flex flex-wrap gap-2">
                  {segments.map((seg, idx) => {
                    const colors = ["#c8b89a", "#9ab8c8", "#b89ac8", "#9ac8a3", "#c89a9a", "#c8c09a"];
                    const color = colors[idx % colors.length];
                    return (
                      <button
                        key={idx}
                        className="text-xs px-2 py-1 rounded border cursor-pointer transition-colors hover:opacity-80"
                        style={{ borderColor: color, color: color }}
                        onClick={() => selectSegmentAndDive(idx)}
                      >
                        {seg.name}
                      </button>
                    );
                  })}
                </div>

                <div className="flex gap-3 flex-wrap">
                  <button
                    className="bg-transparent border border-[#3a3a3a] rounded-sm text-[#c8b89a] px-4 py-2 text-xs tracking-wider cursor-pointer hover:border-[#c8b89a] transition-colors"
                    onClick={() => { setStep(1); generate({ step: 1, mode: "deep_dive" }); }}
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
                  <div className="flex gap-1.5 items-center">
                    {STEPS.map((st) => (
                      <div key={st.n} title={st.label} className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${st.n === step ? "bg-[#c8b89a]" : st.n < step ? "bg-[#4a4a4a]" : "bg-[#2e2e2e]"}`} />
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
                <div className="flex gap-1.5 items-center">
                  {STEPS.map((st) => (
                    <div key={st.n} title={st.label} className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${st.n === step ? "bg-[#c8b89a]" : st.n < step ? "bg-[#4a4a4a]" : "bg-[#2e2e2e]"}`} />
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
