"use client";

import { useRef, useState } from "react";
import { Button, Textarea } from "@navanta-ai/design-system";
import { CaretDown, CaretUp, Paperclip } from "@phosphor-icons/react";
import { MercerStar } from "@/components/mercer";

/**
 * Inline "upload your details, Mercer analyzes them" affordance shared by the
 * task checklist (auto-track progress) and the RFP scaffold (upgrade the
 * draft). Accepts a pasted block of text or a plain-text file (.txt/.md — no
 * PDF/DOCX parsing here, that needs a server-side parser). The analysis
 * itself (what `onAnalyze` does with the text) is heuristic extraction, not a
 * live model call — see @/lib/uploadAnalysis.
 */
export function UploadAnalyze({
  label,
  placeholder,
  onAnalyze,
}: {
  label: string;
  placeholder: string;
  onAnalyze: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result ?? ""));
      setFileName(file.name);
    };
    reader.readAsText(file);
  };

  const handleAnalyze = () => {
    if (!text.trim()) return;
    onAnalyze(text);
    setOpen(false);
    setText("");
    setFileName(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-fit items-center gap-1.5 text-[12px] font-medium"
        style={{ color: "var(--text-secondary)" }}
      >
        <Paperclip size={13} weight="bold" />
        {label}
        {open ? <CaretUp size={11} weight="bold" /> : <CaretDown size={11} weight="bold" />}
      </button>

      {open && (
        <div
          className="flex flex-col gap-2 rounded-[8px] p-3"
          style={{ border: "1px solid var(--border-light)", background: "var(--surface-raised)" }}
        >
          <Textarea
            rows={5}
            placeholder={placeholder}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFileName(null);
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                Upload file
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.md,text/plain"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />
              {fileName && (
                <span className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
                  {fileName}
                </span>
              )}
            </div>
            <Button
              variant="christy"
              size="sm"
              iconLeft={<MercerStar size={12} />}
              onClick={handleAnalyze}
              disabled={!text.trim()}
            >
              Analyze
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
