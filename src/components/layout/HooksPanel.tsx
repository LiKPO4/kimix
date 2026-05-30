import { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { Activity, Bell, Cable, Check, Loader2, Play, Plus, ShieldAlert, Sparkles, TerminalSquare, Trash2, X, type LucideIcon } from "lucide-react";
import { useAppStore } from "@/stores/appStore";
import type { AppSettings, HookRule, HookRunLogEntry } from "@electron/types/ipc";

type HookTemplate = {
  icon: LucideIcon;
  title: string;
  event: HookRule["event"];
  matcher: string;
  action: HookRule["action"];
  command?: string;
  reason?: string;
  timeout?: number;
  desc: string;
};

type CreationMode = "browse" | "create";

const hookTemplates: HookTemplate[] = [
  {
    icon: ShieldAlert,
    title: "危险命令拦截",
    event: "PreToolUse",
    matcher: "(rm -rf|git reset --hard|git push --force|rmdir /S|Remove-Item .* -Recurse)",
    action: "block",
    reason: "高风险命令需要用户确认后再执行。",
    desc: "在删除、重置、强推等高风险命令执行前阻断。",
  },
  {
    icon: TerminalSquare,
    title: "改动后自动构建",
    event: "Stop",
    matcher: "src/|electron/|package.json",
    action: "run_command",
    command: "rtk pnpm build",
    timeout: 120,
    desc: "任务结束后检测到代码改动时自动运行构建。",
  },
  {
    icon: Bell,
    title: "失败时通知",
    event: "StopFailure",
    matcher: ".*",
    action: "notify",
    desc: "运行失败或等待人工处理时提醒用户回来查看。",
  },
];

const hookEvents: HookRule["event"][] = ["PreToolUse", "PostToolUse", "PostToolUseFailure", "Notification", "Stop", "StopFailure", "UserPromptSubmit", "SessionStart", "SessionEnd", "SubagentStart", "SubagentStop", "PreCompact", "PostCompact"];
const hookActions: HookRule["action"][] = ["allow", "block", "notify", "run_command"];

function formatLogTime(timestamp: number) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLogResult(result: HookRunLogEntry["result"]) {
  if (result === "block") return "阻断";
  if (result === "error") return "错误";
  if (result === "run_command") return "命令";
  if (result === "notify") return "通知";
  return "允许";
}

const ruleCreatorPrompt = `你是 Kimix Hooks 规则创建 agent。请把用户的自然语言需求转换为一条 HookRule JSON。
必须遵守：
1. 只能选择 event: PreToolUse / PostToolUse / PostToolUseFailure / Notification / Stop / StopFailure / UserPromptSubmit / SessionStart / SessionEnd / SubagentStart / SubagentStop / PreCompact / PostCompact。
2. 只能选择 action: allow / block / notify / run_command。
3. matcher 使用简短正则或关键词，能匹配工具名、命令、文件路径或事件摘要。
4. 危险命令、删除、强推、重置优先使用 PreToolUse + block。
5. 自动构建、测试、lint 优先使用 Stop + run_command，并填写 command。
6. 失败、等待用户、需要提醒优先使用 StopFailure + notify。
7. 通知类 hook 必须填写可执行 command，stdout 会进入 agent 上下文，例如输出当前时间。
8. 输出要包含 name、event、matcher、action、command、reason、timeout、enabled、scope。`;

function createRule(template?: HookTemplate): HookRule {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: template?.title ?? "自定义 Hook 规则",
    event: template?.event ?? "PreToolUse",
    matcher: template?.matcher ?? ".*",
    action: template?.action ?? "notify",
    command: template?.command ?? "",
    reason: template?.reason ?? "",
    timeout: template?.timeout ?? (template?.action === "run_command" ? 120 : 30),
    enabled: true,
    scope: "global",
    createdAt: now,
    updatedAt: now,
  };
}

function cloneRuleWithUpdate(rule: HookRule, patch: Partial<HookRule>): HookRule {
  return { ...rule, ...patch, updatedAt: Date.now() };
}

function completeHookRuleForDisplay(rule: HookRule, description: string): HookRule {
  const text = description.toLowerCase();
  const patch: Partial<HookRule> = {
    timeout: Math.max(1, Math.min(600, rule.timeout ?? (rule.action === "run_command" ? 120 : 30))),
  };
  if (/时间|日期|current\s*time|date|clock/.test(text)) {
    patch.event = "UserPromptSubmit";
    patch.action = "notify";
    patch.matcher = rule.matcher.trim() || ".*";
    patch.command = rule.command?.trim() || `powershell -NoProfile -Command "Write-Output ('当前时间：' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))"`;
    patch.reason = rule.reason?.trim() || "每轮开始时把当前时间写入 hook 输出，提示给 agent。";
  } else if (rule.action === "notify" && !rule.command?.trim()) {
    const message = (rule.reason || description || "Hook 规则已触发。").replace(/"/g, "'");
    patch.command = `powershell -NoProfile -Command "Write-Output '${message}'"`;
  } else if (rule.action === "block" && !rule.command?.trim()) {
    const message = (rule.reason || "该操作被 Hook 规则阻断。").replace(/"/g, "'");
    patch.command = `powershell -NoProfile -Command "Write-Error '${message}'; exit 2"`;
  }
  return cloneRuleWithUpdate(rule, patch);
}

export function HooksPanel({ onBackToChat }: { onBackToChat?: () => void }) {
  const currentProject = useAppStore((s) => s.currentProject);
  const [rules, setRules] = useState<HookRule[]>([]);
  const [runLog, setRunLog] = useState<HookRunLogEntry[]>([]);
  const [message, setMessage] = useState("正在读取 Hooks 规则...");
  const [saving, setSaving] = useState(false);
  const [selectedRuleId, setSelectedRuleId] = useState<string | null>(null);
  const [mode, setMode] = useState<CreationMode>("browse");
  const [naturalLanguage, setNaturalLanguage] = useState("");
  const [draftRule, setDraftRule] = useState<HookRule | null>(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.api.getSettings().then((res) => {
      if (cancelled) return;
      if (!res.success) {
        setMessage(`读取失败：${res.error}`);
        return;
      }
      const loadedRules = res.data.hookRules ?? [];
      const loadedLog = (res.data.hookRunLog ?? []).slice(0, 12);
      setRules(loadedRules);
      setRunLog(loadedLog);
      setSelectedRuleId(null);
      setMessage(loadedRules.length > 0 ? `已读取 ${loadedRules.length} 条 Hook 规则` : "还没有 Hook 规则，可以从模板或自然语言创建");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enabledCount = useMemo(() => rules.filter((rule) => rule.enabled).length, [rules]);
  const selectedRule = selectedRuleId ? rules.find((rule) => rule.id === selectedRuleId) ?? null : null;
  const createMode = mode === "create";

  const persistRules = async (nextRules: HookRule[], nextMessage = "Hooks 规则已保存") => {
    setSaving(true);
    const payload: Partial<AppSettings> = { hookRules: nextRules };
    const res = await window.api.saveSettings(payload);
    setSaving(false);
    if (!res.success) {
      setMessage(`保存失败：${res.error}`);
      return false;
    }
    setRules(nextRules);
    setMessage(nextMessage);
    return true;
  };

  const startCreate = (template?: HookTemplate) => {
    setMode("create");
    setDraftRule(createRule(template));
    setNaturalLanguage(template ? template.desc : "");
    setMessage("正在创建新规则，已有规则已临时隐藏。");
  };

  const cancelCreate = () => {
    if (generating) return;
    setMode("browse");
    setDraftRule(null);
    setNaturalLanguage("");
    setMessage(rules.length > 0 ? `已读取 ${rules.length} 条 Hook 规则` : "还没有 Hook 规则，可以从模板或自然语言创建");
  };

  const generateDraft = async () => {
    const description = naturalLanguage.trim();
    if (!description) {
      setMessage("请先输入自然语言描述");
      return;
    }
    setGenerating(true);
    setMessage("规则创建 Agent 正在生成草稿...");
    const res = await window.api.generateHookRule({
      description,
      projectPath: currentProject?.path,
    });
    setGenerating(false);
    if (!res.success) {
      setMessage(`生成失败：${res.error}`);
      return;
    }
    const completed = completeHookRuleForDisplay(res.data, description);
    const next = completed.scope === "project"
      ? cloneRuleWithUpdate(completed, { projectPath: currentProject?.path })
      : completed;
    setDraftRule(next);
    setMessage("规则创建 Agent 已生成草稿，请检查后保存。");
  };

  const saveDraftRule = async () => {
    if (!draftRule) {
      setMessage("请先生成或填写规则草稿");
      return;
    }
    const completedDraft = completeHookRuleForDisplay(draftRule, naturalLanguage);
    const normalized = cloneRuleWithUpdate(completedDraft, {
      name: completedDraft.name.trim() || "未命名 Hook 规则",
      matcher: completedDraft.matcher.trim() || ".*",
      timeout: Math.max(1, Math.min(600, completedDraft.timeout ?? 30)),
      projectPath: completedDraft.scope === "project" ? currentProject?.path : undefined,
    });
    const nextRules = [normalized, ...rules];
    const ok = await persistRules(nextRules, `已创建规则：${normalized.name}`);
    if (!ok) return;
    setSelectedRuleId(null);
    setDraftRule(null);
    setNaturalLanguage("");
    setMode("browse");
  };

  const updateRule = (id: string, patch: Partial<HookRule>) => {
    setRules((current) => current.map((rule) => (
      rule.id === id ? cloneRuleWithUpdate(rule, patch) : rule
    )));
  };

  const updateDraft = (patch: Partial<HookRule>) => {
    setDraftRule((current) => current ? cloneRuleWithUpdate(current, patch) : createRule(undefined));
  };

  const deleteRule = async (id: string) => {
    const nextRules = rules.filter((rule) => rule.id !== id);
    const ok = await persistRules(nextRules, "已删除 Hook 规则");
    if (!ok) return;
    setSelectedRuleId(selectedRuleId === id ? null : selectedRuleId);
  };

  const saveSelectedRule = async () => {
    if (!selectedRule) return;
    const completedSelected = completeHookRuleForDisplay(selectedRule, `${selectedRule.name} ${selectedRule.reason ?? ""}`);
    const nextRules = rules.map((rule) => (
      rule.id === selectedRule.id
        ? cloneRuleWithUpdate(completedSelected, {
            name: completedSelected.name.trim() || "未命名 Hook 规则",
            matcher: completedSelected.matcher.trim() || ".*",
            timeout: Math.max(1, Math.min(600, completedSelected.timeout ?? 30)),
            projectPath: completedSelected.scope === "project" ? currentProject?.path : undefined,
          })
        : rule
    ));
    const ok = await persistRules(nextRules, `已保存规则：${selectedRule.name}`);
    if (ok) setSelectedRuleId(null);
  };

  const handleDraftScope = (event: ChangeEvent<HTMLSelectElement>) => {
    updateDraft({
      scope: event.target.value as HookRule["scope"],
      projectPath: event.target.value === "project" ? currentProject?.path : undefined,
    });
  };

  const handleSelectedScope = (event: ChangeEvent<HTMLSelectElement>) => {
    if (!selectedRule) return;
    updateRule(selectedRule.id, {
      scope: event.target.value as HookRule["scope"],
      projectPath: event.target.value === "project" ? currentProject?.path : undefined,
    });
  };

  const renderRuleEditor = (
    rule: HookRule,
    onPatch: (patch: Partial<HookRule>) => void,
    scopeHandler: (event: ChangeEvent<HTMLSelectElement>) => void,
    footer: ReactNode,
  ) => (
    <div className="flex flex-col" style={{ gap: 14 }}>
      <label className="flex flex-col text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ gap: 7 }}>
        规则名称
        <input value={rule.name} onChange={(event) => onPatch({ name: event.target.value })} className="h-9 rounded-lg border border-[var(--kimix-panel-border-soft)] bg-surface-elevated text-[13px] outline-none focus:border-accent-primary" style={{ paddingLeft: 11, paddingRight: 11 }} />
      </label>

      <div className="grid grid-cols-2" style={{ gap: 12 }}>
        <label className="flex flex-col text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ gap: 7 }}>
          事件
          <select value={rule.event} onChange={(event) => onPatch({ event: event.target.value as HookRule["event"] })} className="h-9 rounded-lg border border-[var(--kimix-panel-border-soft)] bg-surface-elevated text-[13px] outline-none focus:border-accent-primary" style={{ paddingLeft: 10, paddingRight: 10 }}>
            {hookEvents.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="flex flex-col text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ gap: 7 }}>
          动作
          <select value={rule.action} onChange={(event) => onPatch({ action: event.target.value as HookRule["action"] })} className="h-9 rounded-lg border border-[var(--kimix-panel-border-soft)] bg-surface-elevated text-[13px] outline-none focus:border-accent-primary" style={{ paddingLeft: 10, paddingRight: 10 }}>
            {hookActions.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>

      <label className="flex flex-col text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ gap: 7 }}>
        匹配器
        <textarea value={rule.matcher} onChange={(event) => onPatch({ matcher: event.target.value })} className="min-h-[82px] rounded-lg border border-[var(--kimix-panel-border-soft)] bg-surface-elevated text-[13px] leading-5 outline-none focus:border-[var(--accent-blue)]" style={{ padding: "10px 11px" }} />
      </label>

      <label className="flex flex-col text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ gap: 7 }}>
        命令 / Hook 脚本
        <input value={rule.command ?? ""} onChange={(event) => onPatch({ command: event.target.value })} className="h-9 rounded-lg border border-[var(--kimix-panel-border-soft)] bg-surface-elevated text-[13px] outline-none focus:border-accent-primary" style={{ paddingLeft: 11, paddingRight: 11 }} placeholder="run_command 时执行，如 rtk pnpm build" />
      </label>

      <label className="flex flex-col text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ gap: 7 }}>
        超时秒数
        <input
          type="number"
          min={1}
          max={600}
          value={rule.timeout ?? 30}
          onChange={(event) => onPatch({ timeout: Math.max(1, Math.min(600, Number(event.target.value) || 30)) })}
          className="h-9 rounded-lg border border-[var(--kimix-panel-border-soft)] bg-surface-elevated text-[13px] outline-none focus:border-accent-primary"
          style={{ paddingLeft: 11, paddingRight: 11 }}
        />
      </label>

      <label className="flex flex-col text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ gap: 7 }}>
        阻断/通知说明
        <textarea value={rule.reason ?? ""} onChange={(event) => onPatch({ reason: event.target.value })} className="min-h-[66px] rounded-lg border border-[var(--kimix-panel-border-soft)] bg-surface-elevated text-[13px] leading-5 outline-none focus:border-[var(--accent-blue)]" style={{ padding: "10px 11px" }} />
      </label>

      <div className="grid grid-cols-2" style={{ gap: 12 }}>
        <label className="flex items-center justify-between rounded-lg border border-[var(--kimix-panel-border-soft)] text-[13px] text-[var(--kimix-panel-text-secondary)]" style={{ padding: "11px 12px", gap: 10 }}>
          <span>启用规则</span>
          <input type="checkbox" checked={rule.enabled} onChange={(event) => onPatch({ enabled: event.target.checked })} className="h-4 w-4 accent-[var(--accent-blue)]" />
        </label>
        <label className="flex flex-col text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ gap: 7 }}>
          范围
          <select value={rule.scope} onChange={scopeHandler} className="h-9 rounded-lg border border-[var(--kimix-panel-border-soft)] bg-surface-elevated text-[13px] outline-none focus:border-accent-primary" style={{ paddingLeft: 10, paddingRight: 10 }}>
            <option value="global">全局</option>
            <option value="project">当前项目</option>
          </select>
        </label>
      </div>

      {footer}
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--kimix-panel-bg)]">
      <div className="flex items-center justify-between border-b border-[var(--kimix-panel-divider)]" style={{ padding: "20px 28px" }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 text-[20px] font-semibold leading-7 text-[var(--kimix-panel-text)]">
            <Cable size={20} />
            <span>Hooks</span>
          </div>
          <div className="mt-1 text-[13.5px] leading-5 text-[var(--kimix-panel-text-secondary)]">
            管理 Kimi Code hooks 规则；创建规则时可用自然语言描述，由规则创建 agent 生成草稿。
          </div>
        </div>
        <div className="flex shrink-0 items-center" style={{ gap: 8 }}>
          <button
            type="button"
            onClick={() => startCreate()}
            className="kimix-icon-text-button is-compact bg-accent-primary text-white shadow-[0_6px_16px_rgba(51,154,240,0.20)] hover:bg-accent-primary-dark"
            style={{ paddingLeft: 14, paddingRight: 14 }}
          >
            <Plus size={15} />
            <span>新建规则</span>
          </button>
          {onBackToChat && (
            <button
              type="button"
              onClick={onBackToChat}
              className="kimix-icon-text-button kimix-muted-action is-compact"
              style={{ marginLeft: 4 }}
            >
              返回对话
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: "22px 28px 30px" }}>
        {createMode ? (
          <div className="grid w-full items-start" style={{ gridTemplateColumns: "minmax(320px, 0.92fr) minmax(0, 1.08fr)", gap: 18 }}>
            <section className="flex flex-col rounded-xl border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-bg)]" style={{ padding: "18px 18px", gap: 16 }}>
              <div className="flex items-start justify-between" style={{ gap: 12 }}>
                <div className="min-w-0">
                  <div className="flex items-center text-[15px] font-semibold leading-6 text-[var(--kimix-panel-text)]" style={{ gap: 9 }}>
                    <Sparkles size={17} className="text-[var(--accent-blue)]" />
                    <span>规则创建 Agent</span>
                  </div>
                  <div className="mt-1 text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]">描述你想自动化的行为，生成后可在右侧微调。</div>
                </div>
                <button type="button" onClick={cancelCreate} disabled={generating} className="kimix-muted-action flex h-8 w-8 shrink-0 items-center justify-center rounded-lg disabled:cursor-wait disabled:opacity-55" aria-label="取消创建">
                  <X size={15} />
                </button>
              </div>

              <label className="flex flex-col text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]" style={{ gap: 8 }}>
                自然语言描述
                <textarea
                  value={naturalLanguage}
                  onChange={(event) => setNaturalLanguage(event.target.value)}
                  disabled={generating}
                  className="min-h-[126px] rounded-lg border border-[var(--kimix-panel-border-soft)] bg-surface-elevated text-[13px] leading-6 outline-none focus:border-[var(--accent-blue)]"
                  style={{ padding: "11px 12px" }}
                  placeholder="例如：如果 agent 要执行 git reset --hard 或删除目录，先拦截并说明风险。"
                />
              </label>

              <div className="rounded-lg border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-soft-bg)]" style={{ padding: "13px 14px" }}>
                <div className="text-[13px] font-medium leading-5 text-[var(--kimix-panel-text)]">创建提示词</div>
                <div className="mt-2 max-h-[150px] overflow-y-auto whitespace-pre-wrap text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]">{ruleCreatorPrompt}</div>
              </div>

              <button
                type="button"
                onClick={() => void generateDraft()}
                disabled={generating || !naturalLanguage.trim()}
                className="kimix-icon-text-button justify-center rounded-lg bg-accent-primary text-white disabled:cursor-wait disabled:opacity-60"
              >
                {generating ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
                <span>{generating ? "Agent 生成中" : "生成规则草稿"}</span>
              </button>

              <div className="flex flex-col" style={{ gap: 10 }}>
                <div className="text-[13px] font-medium leading-5 text-[var(--kimix-panel-text)]">也可以从模板开始</div>
                {hookTemplates.map((template) => {
                  const Icon = template.icon;
                  return (
                    <button key={template.title} type="button" onClick={() => startCreate(template)} disabled={generating} className="w-full rounded-lg border border-[var(--kimix-panel-border-soft)] text-left transition-colors hover:bg-[var(--kimix-panel-soft-bg)] disabled:cursor-wait disabled:opacity-60" style={{ padding: "11px 12px" }}>
                      <div className="flex items-center" style={{ gap: 9 }}>
                        <Icon size={15} className="shrink-0 text-[var(--kimix-panel-text-secondary)]" />
                        <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-[var(--kimix-panel-text)]">{template.title}</span>
                      </div>
                      <div className="mt-1 text-[12.5px] leading-5 text-[var(--kimix-panel-text-muted)]">{template.desc}</div>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="rounded-xl border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-bg)]" style={{ padding: "18px 18px" }}>
              <div className="mb-4 text-[15px] font-semibold leading-6 text-[var(--kimix-panel-text)]">规则草稿</div>
              {draftRule ? renderRuleEditor(
                draftRule,
                updateDraft,
                handleDraftScope,
                <button type="button" onClick={() => void saveDraftRule()} disabled={saving || generating} className="kimix-icon-text-button justify-center rounded-lg bg-accent-primary text-white disabled:cursor-wait disabled:opacity-60">
                  <Check size={15} />
                  <span>{saving ? "保存中" : "创建并保存"}</span>
                </button>,
              ) : (
                <div className="rounded-xl border border-dashed border-[var(--kimix-panel-border-soft)] text-[13.5px] leading-6 text-[var(--kimix-panel-text-muted)]" style={{ padding: "18px 18px" }}>
                  输入自然语言描述后点击“生成规则草稿”，或者选择左侧模板。
                </div>
              )}
            </section>
          </div>
        ) : (
          <div className="grid w-full items-start" style={{ gridTemplateColumns: "320px minmax(0, 1fr)", gap: 18 }}>
            <aside className="flex flex-col" style={{ gap: 14 }}>
              <section className="kimix-soft-card rounded-xl" style={{ padding: "16px 16px" }}>
                <div className="text-[15px] font-semibold leading-6 text-[var(--kimix-panel-text)]">规则状态</div>
                <div className="mt-2 text-[13.5px] leading-6 text-[var(--kimix-panel-text-secondary)]">{message}</div>
                <div className="mt-4 grid grid-cols-2" style={{ gap: 10 }}>
                  <div className="rounded-lg bg-[var(--kimix-panel-bg)] text-[13px] leading-5" style={{ padding: "11px 12px" }}>
                    <div className="text-[var(--kimix-panel-text-muted)]">全部规则</div>
                    <div className="mt-1 text-[18px] font-semibold text-[var(--kimix-panel-text)]">{rules.length}</div>
                  </div>
                  <div className="rounded-lg bg-[var(--kimix-panel-bg)] text-[13px] leading-5" style={{ padding: "11px 12px" }}>
                    <div className="text-[var(--kimix-panel-text-muted)]">已启用</div>
                    <div className="mt-1 text-[18px] font-semibold text-[var(--accent-blue)]">{enabledCount}</div>
                  </div>
                </div>
              </section>

              <section className="rounded-xl border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-bg)]" style={{ padding: "16px 16px" }}>
                <div className="text-[15px] font-semibold leading-6 text-[var(--kimix-panel-text)]">已有规则</div>
                <div className="mt-4 flex min-w-0 flex-col" style={{ gap: 10 }}>
                  {rules.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-[var(--kimix-panel-border-soft)] text-[13px] leading-6 text-[var(--kimix-panel-text-muted)]" style={{ padding: "13px 13px" }}>
                      暂无规则。点击模板或“新建规则”开始配置。
                    </div>
                  ) : rules.map((rule) => (
                    <button key={rule.id} type="button" onClick={() => setSelectedRuleId(rule.id)} className={`w-full rounded-lg border text-left transition-colors ${selectedRule?.id === rule.id ? "border-accent-primary bg-accent-primary-light" : "border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-bg)] hover:bg-[var(--kimix-panel-soft-bg)]"}`} style={{ padding: "12px 12px" }}>
                      <div className="grid items-start" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10 }}>
                        <div className="min-w-0">
                          <div className="truncate text-[13.5px] font-semibold leading-5 text-[var(--kimix-panel-text)]">{rule.name}</div>
                          <div className="mt-1 text-[12.5px] leading-5 text-[var(--kimix-panel-text-muted)]">{rule.event} · {rule.action}</div>
                        </div>
                        <span className={`h-5 shrink-0 rounded-full text-[12px] leading-5 ${rule.enabled ? "bg-[var(--accent-blue)] text-white" : "bg-[var(--kimix-panel-badge-bg)] text-[var(--kimix-panel-badge-text)]"}`} style={{ paddingLeft: 8, paddingRight: 8 }}>
                          {rule.enabled ? "启用" : "停用"}
                        </span>
                      </div>
                      <div className="mt-2 line-clamp-2 text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]">{rule.matcher}</div>
                    </button>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-bg)]" style={{ padding: "16px 16px" }}>
                <div className="flex items-center" style={{ gap: 10 }}>
                  <Play size={16} className="text-[var(--kimix-panel-text-secondary)]" />
                  <div className="text-[15px] font-semibold leading-6 text-[var(--kimix-panel-text)]">模板</div>
                </div>
                <div className="mt-4 flex flex-col" style={{ gap: 10 }}>
                  {hookTemplates.map((template) => {
                    const Icon = template.icon;
                    return (
                      <button key={template.title} type="button" onClick={() => startCreate(template)} className="w-full rounded-lg border border-[var(--kimix-panel-border-soft)] text-left transition-colors hover:bg-[var(--kimix-panel-soft-bg)]" style={{ padding: "12px 12px" }}>
                        <div className="flex items-center" style={{ gap: 9 }}>
                          <Icon size={15} className="shrink-0 text-[var(--kimix-panel-text-secondary)]" />
                          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-[var(--kimix-panel-text)]">{template.title}</span>
                        </div>
                        <div className="mt-1 text-[12.5px] leading-5 text-[var(--kimix-panel-text-muted)]">{template.desc}</div>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-xl border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-bg)]" style={{ padding: "16px 16px" }}>
                <div className="flex items-center" style={{ gap: 10 }}>
                  <Activity size={16} className="text-[var(--kimix-panel-text-secondary)]" />
                  <div className="text-[15px] font-semibold leading-6 text-[var(--kimix-panel-text)]">最近命中</div>
                </div>
                {runLog.length > 0 ? (
                  <div className="mt-3 flex flex-col" style={{ gap: 9 }}>
                    {runLog.slice(0, 6).map((entry) => (
                      <div key={entry.id} className="rounded-lg border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-subtle-bg)]" style={{ padding: "11px 12px" }}>
                        <div className="grid items-center" style={{ gridTemplateColumns: "minmax(0, 1fr) auto", gap: 10 }}>
                          <div className="min-w-0 truncate text-[13px] font-medium leading-5 text-[var(--kimix-panel-text)]">{entry.ruleName}</div>
                          <span className={`h-5 shrink-0 rounded-full text-[12px] leading-5 ${entry.result === "error" || entry.result === "block" ? "bg-accent-danger-light text-accent-danger" : "bg-accent-primary-light text-accent-primary"}`} style={{ paddingLeft: 8, paddingRight: 8 }}>
                            {formatLogResult(entry.result)}
                          </span>
                        </div>
                        <div className="mt-1 truncate text-[12.5px] leading-5 text-[var(--kimix-panel-text-muted)]">{entry.event} · {entry.action} · {formatLogTime(entry.timestamp)}</div>
                        <div className="mt-1 line-clamp-2 text-[12.5px] leading-5 text-[var(--kimix-panel-text-secondary)]">{entry.message}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-dashed border-[var(--kimix-panel-border-soft)] text-[13px] leading-6 text-[var(--kimix-panel-text-muted)]" style={{ padding: "13px 13px" }}>
                    暂无命中记录。规则触发后会在这里显示事件、动作和结果。
                  </div>
                )}
              </section>
            </aside>

            <section className="min-w-0 rounded-xl border border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-bg)]" style={{ padding: "18px 18px" }}>
                {selectedRule ? (
                  <>
                    <div className="mb-4 flex items-start justify-between" style={{ gap: 12 }}>
                      <div className="min-w-0">
                        <div className="text-[15px] font-semibold leading-6 text-[var(--kimix-panel-text)]">规则编辑</div>
                        <div className="mt-1 text-[12.5px] leading-5 text-[var(--kimix-panel-text-muted)]">保存后写入本地 settings.json。</div>
                      </div>
                      <button type="button" onClick={() => setSelectedRuleId(null)} className="kimix-muted-action h-8 rounded-lg text-[13px]" style={{ paddingLeft: 12, paddingRight: 12 }}>
                        取消
                      </button>
                    </div>
                    {renderRuleEditor(
                      selectedRule,
                      (patch) => updateRule(selectedRule.id, patch),
                      handleSelectedScope,
                      <div className="flex flex-col" style={{ gap: 12 }}>
                        <button type="button" onClick={() => void saveSelectedRule()} disabled={saving} className="kimix-icon-text-button justify-center rounded-lg bg-accent-primary text-white disabled:cursor-wait disabled:opacity-60">
                          <Check size={15} />
                          <span>{saving ? "保存中" : "保存规则"}</span>
                        </button>
                        <button type="button" onClick={() => void deleteRule(selectedRule.id)} disabled={saving} className="kimix-icon-text-button justify-center rounded-lg border border-[var(--kimix-panel-border-soft)] text-[var(--accent-red)] hover:bg-[var(--kimix-panel-soft-bg)] disabled:cursor-wait disabled:opacity-60">
                          <Trash2 size={15} />
                          <span>删除规则</span>
                        </button>
                      </div>,
                    )}
                  </>
                ) : (
                  <div className="rounded-xl border border-dashed border-[var(--kimix-panel-border-soft)] text-[13.5px] leading-6 text-[var(--kimix-panel-text-muted)]" style={{ padding: "18px 18px" }}>
                    选择或创建一条规则后在这里编辑。创建规则时会暂时隐藏已有规则，只显示规则创建 Agent 和草稿编辑器。
                  </div>
                )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
