import { useMemo, useState } from "react";
import { Check, CircleHelp, SendHorizontal } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { TimelineEvent } from "@/types/ui";

interface QuestionCardProps {
  event: Extract<TimelineEvent, { type: "question_request" }>;
}

type LocalAnswers = Record<string, string[]>;

function optionKey(question: string, label: string) {
  return `${question}::${label}`;
}

export function QuestionCard({ event }: QuestionCardProps) {
  const currentSession = useAppStore((s) => s.currentSession);
  const updateSession = useSessionStore((s) => s.updateSession);
  const initialAnswers = useMemo<LocalAnswers>(() => {
    const next: LocalAnswers = {};
    event.questions.forEach((question) => {
      const first = question.options[0]?.label;
      next[question.question] = first ? [first] : [];
    });
    return next;
  }, [event.questions]);
  const [answers, setAnswers] = useState<LocalAnswers>(initialAnswers);
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const setQuestionAnswer = (question: string, label: string, multiSelect?: boolean) => {
    setAnswers((prev) => {
      const current = prev[question] ?? [];
      if (!multiSelect) return { ...prev, [question]: [label] };
      const exists = current.includes(label);
      const next = exists ? current.filter((item) => item !== label) : [...current, label];
      return { ...prev, [question]: next };
    });
  };

  const buildAnswerPayload = () => {
    const payload: Record<string, string> = {};
    event.questions.forEach((question) => {
      const custom = customAnswers[question.question]?.trim();
      if (custom) {
        payload[question.question] = custom;
        return;
      }
      const selected = answers[question.question] ?? [];
      payload[question.question] = selected.join(", ");
    });
    return payload;
  };

  const markSettled = (status: "answered" | "skipped", answerPayload?: Record<string, string>) => {
    if (!currentSession) return;
    updateSession(currentSession.id, (session) => ({
      ...session,
      events: session.events.map((item) => (
        item.id === event.id && item.type === "question_request"
          ? { ...item, status, answers: answerPayload }
          : item
      )),
      updatedAt: Date.now(),
    }));
  };

  const submitAnswers = async (skip = false) => {
    if (!currentSession || isSubmitting) return;
    setIsSubmitting(true);
    const answerPayload = skip ? {} : buildAnswerPayload();
    try {
      const res = await window.api.respondQuestion({
        sessionId: currentSession.runtimeSessionId ?? currentSession.id,
        rpcRequestId: event.rpcRequestId,
        questionRequestId: event.requestId,
        answers: answerPayload,
      });
      if (!res.success) throw new Error(res.error);
      markSettled(skip ? "skipped" : "answered", answerPayload);
    } catch (err) {
      console.error("Respond question failed:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isPending = event.status === "pending";

  return (
    <div className="flex justify-center">
      <div
        className="w-full max-w-[90%] rounded-2xl border border-[#cfe4fb] bg-[#f4f9ff] text-[#24211d]"
        style={{ padding: "16px 18px 17px" }}
      >
        <div className="flex items-start" style={{ gap: 12 }}>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-[#339af0] shadow-[0_1px_2px_rgba(25,23,20,0.08)]">
            <CircleHelp size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium leading-6">需要你确认一下</div>
            <div className="mt-0.5 text-[13px] leading-5 text-[#706b63]">Kimi 官方结构化提问会在你选择后继续执行。</div>
          </div>
        </div>

        <div className="mt-4 flex flex-col" style={{ gap: 14 }}>
          {event.questions.map((question, questionIndex) => {
            const selected = answers[question.question] ?? [];
            return (
              <div key={`${question.question}-${questionIndex}`} className="rounded-xl border border-[#dbeafa] bg-white" style={{ padding: "13px 14px 14px" }}>
                <div className="flex items-start" style={{ gap: 10 }}>
                  {question.header && (
                    <span className="shrink-0 rounded-md bg-[#eef7ff] text-[12px] leading-5 text-[#2f83cc]" style={{ paddingLeft: 8, paddingRight: 8 }}>
                      {question.header}
                    </span>
                  )}
                  <div className="min-w-0 flex-1 text-[14.5px] leading-6 text-[#302d28]">{question.question}</div>
                </div>
                <div className="mt-3 flex flex-wrap" style={{ gap: 8 }}>
                  {question.options.map((option) => {
                    const active = selected.includes(option.label);
                    return (
                      <button
                        key={optionKey(question.question, option.label)}
                        type="button"
                        disabled={!isPending || isSubmitting}
                        onClick={() => setQuestionAnswer(question.question, option.label, question.multiSelect)}
                        className={`flex min-h-9 items-center rounded-xl border text-left text-[13.5px] transition-colors disabled:cursor-not-allowed ${active ? "border-[#339af0] bg-[#eef7ff] text-[#1769aa]" : "border-[#e3ded6] bg-white text-[#4b4640] hover:bg-[#faf8f4]"}`}
                        style={{ gap: 8, paddingLeft: 12, paddingRight: 12, paddingTop: 7, paddingBottom: 7 }}
                        title={option.description}
                      >
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${active ? "border-[#339af0] bg-[#339af0] text-white" : "border-[#d8d2c8] text-transparent"}`}>
                          <Check size={10} />
                        </span>
                        <span className="min-w-0">
                          <span className="block leading-5">{option.label}</span>
                          {option.description && <span className="block max-w-[360px] truncate text-[12px] leading-5 text-[#8f887e]">{option.description}</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {isPending && (
                  <input
                    value={customAnswers[question.question] ?? ""}
                    onChange={(inputEvent) => setCustomAnswers((prev) => ({ ...prev, [question.question]: inputEvent.target.value }))}
                    placeholder="其他回答（可选）"
                    className="mt-3 h-9 w-full rounded-xl border border-[#e3ded6] bg-[#fbfaf7] text-[13.5px] outline-none transition-colors placeholder:text-[#aaa49a] focus:border-[#b7d9f7] focus:bg-white"
                    style={{ paddingLeft: 12, paddingRight: 12 }}
                    disabled={!isPending || isSubmitting}
                  />
                )}
              </div>
            );
          })}
        </div>

        {isPending ? (
          <div className="mt-4 flex flex-wrap items-center" style={{ gap: 10 }}>
            <button
              type="button"
              onClick={() => submitAnswers(false)}
              disabled={isSubmitting}
              className="kimix-icon-text-button bg-[#339af0] text-white hover:bg-[#228be6] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span>{isSubmitting ? "提交中" : "提交回答"}</span>
              <SendHorizontal size={14} />
            </button>
            <button
              type="button"
              onClick={() => submitAnswers(true)}
              disabled={isSubmitting}
              className="kimix-icon-text-button text-[#706b63] hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-60"
            >
              跳过澄清
            </button>
          </div>
        ) : (
          <div className="mt-4 text-[13px] leading-5 text-[#706b63]">
            {event.status === "answered" ? "已提交回答，Kimi 会继续执行。" : "已跳过澄清，Kimi 会按当前信息继续。"}
          </div>
        )}
      </div>
    </div>
  );
}
