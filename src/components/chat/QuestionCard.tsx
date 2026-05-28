import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, CircleHelp, SendHorizontal } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { TimelineEvent } from "@/types/ui";
import { getRuntimeSessionId } from "@/utils/runtimeSession";

interface QuestionCardProps {
  event: Extract<TimelineEvent, { type: "question_request" }>;
}

type LocalAnswers = Record<string, string[]>;

function optionKey(question: string, label: string) {
  return `${question}::${label}`;
}

export function QuestionCard({ event }: QuestionCardProps) {
  const currentSession = useAppStore((s) => s.currentSession);
  const setCurrentSession = useAppStore((s) => s.setCurrentSession);
  const updateSession = useSessionStore((s) => s.updateSession);
  const initialAnswers = useMemo<LocalAnswers>(() => {
    const next: LocalAnswers = {};
    event.questions.forEach((question) => {
      const saved = event.answers?.[question.question]?.trim();
      if (saved) {
        const labels = question.options.map((option) => option.label);
        next[question.question] = question.multiSelect
          ? saved.split(/\s*,\s*/).filter((item) => labels.includes(item))
          : labels.includes(saved) ? [saved] : [];
        return;
      }
      const first = event.status === "pending" ? question.options[0]?.label : undefined;
      next[question.question] = first ? [first] : [];
    });
    return next;
  }, [event.answers, event.questions, event.status]);
  const initialCustomAnswers = useMemo<Record<string, string>>(() => {
    const next: Record<string, string> = {};
    event.questions.forEach((question) => {
      const saved = event.answers?.[question.question]?.trim();
      if (!saved) return;
      const labels = question.options.map((option) => option.label);
      if (!labels.includes(saved)) next[question.question] = saved;
    });
    return next;
  }, [event.answers, event.questions]);
  const [answers, setAnswers] = useState<LocalAnswers>(initialAnswers);
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>(initialCustomAnswers);
  const [customSelected, setCustomSelected] = useState<Record<string, boolean>>(() => Object.fromEntries(Object.keys(initialCustomAnswers).map((key) => [key, true])));
  const [collapsed, setCollapsed] = useState(event.status !== "pending");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setAnswers(initialAnswers);
    setCustomAnswers(initialCustomAnswers);
    setCustomSelected(Object.fromEntries(Object.keys(initialCustomAnswers).map((key) => [key, true])));
    setCollapsed(event.status !== "pending");
  }, [event.id, event.status, initialAnswers, initialCustomAnswers]);

  const setQuestionAnswer = (question: string, label: string, multiSelect?: boolean) => {
    setCustomSelected((prev) => ({ ...prev, [question]: false }));
    setAnswers((prev) => {
      const current = prev[question] ?? [];
      if (!multiSelect) return { ...prev, [question]: [label] };
      const exists = current.includes(label);
      const next = exists ? current.filter((item) => item !== label) : [...current, label];
      return { ...prev, [question]: next };
    });
  };

  const setQuestionCustomAnswer = (question: string, value: string) => {
    setCustomAnswers((prev) => ({ ...prev, [question]: value }));
    setCustomSelected((prev) => ({ ...prev, [question]: value.trim().length > 0 }));
    if (!value.trim()) return;
    setAnswers((prev) => ({ ...prev, [question]: [] }));
  };

  const selectQuestionCustomAnswer = (question: string) => {
    const value = customAnswers[question]?.trim();
    if (!value) return;
    setCustomSelected((prev) => ({ ...prev, [question]: true }));
    setAnswers((prev) => ({ ...prev, [question]: [] }));
  };

  const buildAnswerPayload = () => {
    const payload: Record<string, string> = {};
    event.questions.forEach((question) => {
      const custom = customAnswers[question.question]?.trim();
      if (custom && customSelected[question.question]) {
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
    let updatedSession = currentSession;
    updateSession(currentSession.id, (session) => {
      updatedSession = {
      ...session,
      events: session.events.map((item) => (
        item.id === event.id && item.type === "question_request"
          ? { ...item, status, answers: answerPayload }
          : item
      )),
      updatedAt: Date.now(),
      };
      return updatedSession;
    });
    setCurrentSession(updatedSession);
  };

  const submitAnswers = async (skip = false) => {
    if (!currentSession || isSubmitting) return;
    setIsSubmitting(true);
    const answerPayload = skip ? {} : buildAnswerPayload();
    try {
      const runtimeSessionId = getRuntimeSessionId(currentSession);
      if (!runtimeSessionId) return;
      const res = await window.api.respondQuestion({
        sessionId: runtimeSessionId,
        rpcRequestId: event.rpcRequestId,
        questionRequestId: event.requestId,
        answers: answerPayload,
      });
      if (!res.success) throw new Error(res.error);
      markSettled(skip ? "skipped" : "answered", answerPayload);
      setCollapsed(true);
    } catch (err) {
      console.error("Respond question failed:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const isPending = event.status === "pending";
  const summary = event.status === "answered"
    ? `已提交：${Object.values(event.answers ?? {}).filter(Boolean).join(" / ") || "已回答"}`
    : event.status === "skipped"
      ? "已跳过澄清"
      : "等待选择后继续执行";

  return (
    <div className="flex justify-center">
      <div
        className="w-full max-w-[96%] rounded-2xl border border-accent-primary-soft bg-accent-primary-light text-text-primary"
        style={{ padding: collapsed ? "12px 16px" : "20px 22px 12px" }}
      >
        <button
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          className="flex w-full items-center rounded-xl text-left transition-colors hover:bg-surface-elevated/60"
          style={{ gap: 14, minHeight: 48, paddingLeft: collapsed ? 8 : 0, paddingRight: collapsed ? 10 : 0 }}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-elevated text-accent-primary shadow-[0_1px_2px_rgba(25,23,20,0.08)]">
            <CircleHelp size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium leading-6">需要你确认一下</div>
            <div className="mt-0.5 truncate text-[13px] leading-5 text-text-secondary">{summary}</div>
          </div>
          <span className="ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-accent-primary-soft">
            {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </span>
        </button>

        {!collapsed && (
          <>
        <div className="text-[13px] leading-5 text-text-secondary" style={{ marginTop: 8, marginBottom: 18, paddingLeft: 48 }}>
          Kimi 官方结构化提问会在你选择后继续执行。
        </div>

        <div className="flex flex-col" style={{ gap: 18 }}>
          {event.questions.map((question, questionIndex) => {
            const selected = answers[question.question] ?? [];
            const customValue = customAnswers[question.question] ?? "";
            const customActive = Boolean(customSelected[question.question] && customValue.trim().length > 0);
            return (
              <div key={`${question.question}-${questionIndex}`} className="rounded-xl border border-border-subtle bg-surface-elevated" style={{ padding: "16px 16px 17px" }}>
                <div className="flex items-center" style={{ gap: 12, minHeight: 30 }}>
                  {question.header && (
                    <span className="shrink-0 rounded-md bg-accent-primary-light text-[12px] leading-5 text-accent-primary" style={{ paddingLeft: 9, paddingRight: 9 }}>
                      {question.header}
                    </span>
                  )}
                  <div className="min-w-0 flex-1 text-[14.5px] leading-6 text-text-primary">{question.question}</div>
                </div>
                <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))]" style={{ gap: 12, marginTop: 12 }}>
                  {question.options.map((option) => {
                    const active = !customActive && selected.includes(option.label);
                    return (
                      <button
                        key={optionKey(question.question, option.label)}
                        type="button"
                        disabled={!isPending || isSubmitting}
                        onClick={() => setQuestionAnswer(question.question, option.label, question.multiSelect)}
                        className={`flex w-full items-center rounded-xl border text-left text-[13.5px] transition-colors disabled:cursor-not-allowed ${active ? "border-accent-primary bg-accent-primary-light text-accent-primary-dark" : "border-border-subtle bg-surface-elevated text-text-primary hover:bg-surface-hover"}`}
                        style={{ gap: 10, minHeight: 58, paddingLeft: 13, paddingRight: 13, paddingTop: 10, paddingBottom: 10 }}
                        title={option.description}
                      >
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${active ? "border-accent-primary bg-accent-primary text-white" : "border-border-default text-transparent"}`}>
                          <Check size={10} />
                        </span>
                        <span className="min-w-0">
                          <span className="block leading-5">{option.label}</span>
                          {option.description && <span className="block max-w-[360px] truncate text-[12px] leading-5 text-text-muted">{option.description}</span>}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {(isPending || customValue) && (
                  <input
                    value={customValue}
                    onChange={(inputEvent) => setQuestionCustomAnswer(question.question, inputEvent.target.value)}
                    onClick={() => selectQuestionCustomAnswer(question.question)}
                    onFocus={() => selectQuestionCustomAnswer(question.question)}
                    placeholder="其他回答（可选）"
                    className={`w-full rounded-xl border text-[13.5px] outline-none transition-colors placeholder:text-text-muted ${customActive ? "border-accent-primary bg-accent-primary-light text-accent-primary-dark" : "border-border-subtle bg-surface-base text-text-primary focus:border-accent-primary-soft focus:bg-surface-elevated"}`}
                    style={{ height: 40, marginTop: 14, paddingLeft: 14, paddingRight: 14 }}
                    disabled={!isPending || isSubmitting}
                  />
                )}
              </div>
            );
          })}
        </div>

        {isPending ? (
          <div className="flex flex-wrap items-center" style={{ gap: 12, minHeight: 46, marginTop: 5 }}>
            <button
              type="button"
              onClick={() => submitAnswers(false)}
              disabled={isSubmitting}
              className="kimix-icon-text-button bg-accent-primary text-white hover:bg-accent-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
              style={{ paddingLeft: 17, paddingRight: 17, paddingTop: 8, paddingBottom: 8 }}
            >
              <span>{isSubmitting ? "提交中" : "提交回答"}</span>
              <SendHorizontal size={14} />
            </button>
            <button
              type="button"
              onClick={() => submitAnswers(true)}
              disabled={isSubmitting}
              className="kimix-icon-text-button text-text-secondary hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
              style={{ paddingLeft: 15, paddingRight: 15, paddingTop: 8, paddingBottom: 8 }}
            >
              跳过澄清
            </button>
          </div>
        ) : (
          <div className="flex items-center text-[13px] leading-5 text-text-secondary" style={{ minHeight: 50, marginTop: 10 }}>
            {event.status === "answered" ? "已提交回答，Kimi 会继续执行。" : "已跳过澄清，Kimi 会按当前信息继续。"}
          </div>
        )}
          </>
        )}
      </div>
    </div>
  );
}
