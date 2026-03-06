"use client";

import { useState, useRef } from "react";

const API = "http://localhost:8000";

const STEPS = [
  { n: 1, label: "Description" },
  { n: 2, label: "Feelings" },
  { n: 3, label: "Evaluation" },
  { n: 4, label: "Analysis" },
  { n: 5, label: "Conclusion" },
  { n: 6, label: "Action" },
];

export default function Home() {
  const [stage, setStage] = useState("upload"); // upload | choose | question
  const [filename, setFilename] = useState("");
  const [mode, setMode] = useState(null);
  const [topic, setTopic] = useState("");
  const [step, setStep] = useState(1);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef();

  async function handleUpload(e) {
    const file = e.target.files[0];
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
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function generate(currentStep, currentMode = mode) {
    setLoading(true);
    setQuestion("");
    setError("");
    try {
      const res = await fetch(`${API}/generate-question`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: currentMode,
          step: mode === "deep_dive" ? currentStep : null,
          topic: topic || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Something went wrong");
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
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
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleModeSelect(m) {
    setMode(m);
    if (m === "clarifying") generate(null, m);
  }

  function handleNextStep() {
    const next = step + 1;
    setStep(next);
    generate(next);
  }

  function reset() {
    setStage("choose");
    setFilename("");
    setMode(null);
    setTopic("");
    setStep(1);
    setQuestion("");
    setError("");
    fileRef.current.value = "";
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
            <div className="w-5 h-5 rounded-full border border-[#c8b89a] border-t-transparent animate-spin" />
            <p className="text-xs tracking-widest text-[#555]">thinking</p>
          </div>
        ) : (
          <>
            {/* Upload */}
            {stage === "upload" && (
              <div className="flex flex-col gap-5">
                <p className="text-xs tracking-wide text-[#888]">upload a journal entry to begin</p>
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
                <p className="text-xs tracking-wide text-[#888]">how do you want to reflect?</p>
                <div className="flex gap-3 flex-wrap">
                  <button className="bg-transparent border border-[#3a3a3a] rounded-sm text-[#c8b89a] px-4 py-2 text-xs tracking-wider cursor-pointer hover:border-[#c8b89a] transition-colors disabled:opacity-40" onClick={() => handleModeSelect("clarifying")}>broad questions</button>
                  <button className="bg-transparent border border-[#3a3a3a] rounded-sm text-[#c8b89a] px-4 py-2 text-xs tracking-wider cursor-pointer hover:border-[#c8b89a] transition-colors disabled:opacity-40" onClick={() => setMode("deep_dive")}>deep dive</button>
                </div>
                {mode === "deep_dive" && (
                  <div className="flex gap-3">
                    <input className="flex-1 bg-[#0e0e0e] border border-[#2e2e2e] rounded-sm text-[#e8e0d4] px-3 py-2 text-sm font-serif outline-none focus:border-[#444] transition-colors" placeholder="topic (optional)" value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === "Enter" && generate(1, "deep_dive")} />
                    <button className="bg-transparent border border-[#3a3a3a] rounded-sm text-[#c8b89a] px-4 py-2 text-xs tracking-wider cursor-pointer hover:border-[#c8b89a] transition-colors" onClick={() => generate(1, "deep_dive")}>start →</button>
                  </div>
                )}
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
                <p className="text-base leading-relaxed text-[#e8e0d4] min-h-16">{question || "..."}</p>
                <div className="flex gap-3 flex-wrap">
                  {mode === "deep_dive" && step < 6 && (
                    <button className="bg-transparent border border-[#3a3a3a] rounded-sm text-[#c8b89a] px-4 py-2 text-xs tracking-wider cursor-pointer hover:border-[#c8b89a] transition-colors" onClick={handleNextStep}>next step →</button>
                  )}
                  <button className="bg-transparent border border-[#2a2a2a] rounded-sm text-[#555] px-4 py-2 text-xs tracking-wider cursor-pointer hover:border-[#3a3a3a] hover:text-[#888] transition-colors" onClick={reset}>start over</button>
                </div>
              </div>
            )}

            {error && <p className="mt-4 text-xs text-[#a05050]">{error}</p>}
          </>
        )}

        {error && <p className="mt-4 text-xs text-[#a05050]">{error}</p>}
      </div>
    </main>
  );
}
