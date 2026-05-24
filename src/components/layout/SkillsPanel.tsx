import { useEffect, useState } from "react";
import { Check, LayoutGrid, Plus, Sparkles, Upload } from "lucide-react";

type SkillInfo = {
  name: string;
  description: string;
  path: string;
  source: string;
  enabled: boolean;
};

type SuperpowersDiagnostics = {
  enabled: boolean;
  agentFile?: string;
  skillsDir?: string;
  enabledNames?: string[];
  superpowerSkills?: string[];
  agentFileExists?: boolean;
  skillsDirExists?: boolean;
  legacyAgentFileExists?: boolean;
  usingSkillPath?: string;
  diagnostics?: string[];
};

export function SkillsPanel({ open }: { open: boolean }) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [enabledNames, setEnabledNames] = useState<string[]>([]);
  const [enabledDir, setEnabledDir] = useState("");
  const [message, setMessage] = useState("正在扫描本地 Skills...");
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  const [installingSuperpowers, setInstallingSuperpowers] = useState(false);
  const [checkingSuperpowers, setCheckingSuperpowers] = useState(false);
  const [superpowersDiagnostics, setSuperpowersDiagnostics] = useState<SuperpowersDiagnostics | null>(null);
  const [dragActive, setDragActive] = useState(false);

  const refreshSuperpowersDiagnostics = async () => {
    setCheckingSuperpowers(true);
    const res = await window.api.getSuperpowersBootstrap();
    setCheckingSuperpowers(false);
    if (!res.success) {
      setSuperpowersDiagnostics({
        enabled: false,
        diagnostics: [`诊断失败：${res.error}`],
      });
      return;
    }
    setSuperpowersDiagnostics(res.data);
  };

  const refreshSkills = async (nextMessage?: string) => {
    setMessage("正在扫描本地 Skills...");
    const res = await window.api.listSkills();
    if (!res.success) {
      setMessage(`扫描失败：${res.error}`);
      return;
    }
    setSkills(res.data.skills);
    setEnabledNames(res.data.enabledNames);
    setEnabledDir(res.data.enabledDir);
    setMessage(nextMessage ?? (res.data.skills.length > 0 ? `已发现 ${res.data.skills.length} 个本地 Skill` : "未发现本地 Skill"));
    void refreshSuperpowersDiagnostics();
  };

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setMessage("正在扫描本地 Skills...");
    void window.api.listSkills().then((res) => {
      if (cancelled) return;
      if (!res.success) {
        setMessage(`扫描失败：${res.error}`);
        return;
      }
      setSkills(res.data.skills);
      setEnabledNames(res.data.enabledNames);
      setEnabledDir(res.data.enabledDir);
      setMessage(res.data.skills.length > 0 ? `已发现 ${res.data.skills.length} 个本地 Skill` : "未发现本地 Skill");
      void refreshSuperpowersDiagnostics();
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const toggleSkill = async (name: string) => {
    const next = enabledNames.includes(name)
      ? enabledNames.filter((item) => item !== name)
      : [...enabledNames, name];
    setEnabledNames(next);
    setSaving(true);
    const res = await window.api.saveEnabledSkills({ names: next });
    setSaving(false);
    if (!res.success) {
      setMessage(`保存失败：${res.error}`);
      return;
    }
    setEnabledNames(res.data.enabledNames);
    setEnabledDir(res.data.enabledDir);
    setMessage(`已启用 ${res.data.enabledNames.length} 个 Skill。新会话将通过 --skills-dir 使用这些 Skill。`);
    void refreshSuperpowersDiagnostics();
  };

  const importArchive = async (archivePath?: string) => {
    setImporting(true);
    setMessage("正在导入 Skill 压缩包...");
    const res = await window.api.importSkillArchive(archivePath ? { archivePath } : undefined);
    setImporting(false);
    setDragActive(false);
    if (!res.success) {
      setMessage(`导入失败：${res.error}`);
      return;
    }
    setSkills(res.data.skills);
    const importedNames = res.data.imported.map((skill) => skill.name);
    setMessage(importedNames.length > 0 ? `已导入 ${importedNames.join("、")}` : "已取消导入");
    void refreshSkills(importedNames.length > 0 ? `已导入 ${importedNames.join("、")}` : undefined);
  };

  const installSuperpowers = async () => {
    setInstallingSuperpowers(true);
    setMessage("正在安装 Superpowers...");
    const res = await window.api.installSuperpowers();
    setInstallingSuperpowers(false);
    if (!res.success) {
      setMessage(`安装失败：${res.error}`);
      return;
    }
    setSkills(res.data.skills);
    setEnabledNames(res.data.enabledNames);
    setEnabledDir(res.data.enabledDir);
    setMessage(`已安装 Superpowers：${res.data.installed.length} 个 Skill 已写入本地并启用核心 bootstrap。`);
    void refreshSuperpowersDiagnostics();
  };

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    setDragActive(true);
  };

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault();
    setDragActive(false);
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const file = Array.from(event.dataTransfer.files).find((item) => item.name.toLowerCase().endsWith(".zip"));
    const archivePath = file ? (file as unknown as { path?: string }).path : "";
    if (!archivePath) {
      setDragActive(false);
      setMessage("请拖入本地 .zip Skill 压缩包");
      return;
    }
    void importArchive(archivePath);
  };

  const shortDescription = (description: string) => {
    const firstSentence = description.split(/(?<=[.!?。！？])\s+/)[0]?.trim() || description.trim();
    return firstSentence.length > 96 ? `${firstSentence.slice(0, 96)}...` : firstSentence;
  };

  if (!open) return null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--kimix-panel-bg)]">
      <div
        className={`relative flex min-h-0 flex-1 flex-col overflow-hidden ${dragActive ? "outline outline-2 outline-[var(--accent-blue)]" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {dragActive && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[color:var(--kimix-overlay-bg)]">
            <div className="kimix-floating-panel flex items-center rounded-xl text-[15px]" style={{ gap: 10, padding: "14px 18px" }}>
              <Upload size={17} />
              <span>松开导入 Skill 压缩包</span>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between border-b border-[var(--kimix-panel-divider)]" style={{ padding: "18px 28px" }}>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5 text-[20px] font-semibold leading-7 text-[var(--kimix-panel-text)]">
              <LayoutGrid size={20} />
              <span>插件</span>
            </div>
            <div className="mt-1 text-[13.5px] leading-5 text-[var(--kimix-panel-text-secondary)]">
              管理 Kimix 传给 Kimi Code 的 Skills，后续会扩展为完整 Plugins 项目工具箱。
            </div>
          </div>
          <div className="flex items-center" style={{ gap: 8 }}>
            <button
              type="button"
              onClick={() => void installSuperpowers()}
              disabled={installingSuperpowers}
              className="kimix-icon-text-button kimix-muted-action is-compact disabled:cursor-wait disabled:opacity-50"
              title="安装 Superpowers"
            >
              <Sparkles size={15} />
              <span>{installingSuperpowers ? "安装中" : "Superpowers"}</span>
            </button>
            <button
              type="button"
              onClick={() => void importArchive()}
              disabled={importing}
              className="kimix-icon-text-button kimix-muted-action is-compact disabled:cursor-wait disabled:opacity-50"
              title="导入 Skill 压缩包"
            >
              <Plus size={15} />
              <span>{importing ? "导入中" : "添加"}</span>
            </button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto" style={{ padding: "22px 28px 30px" }}>
          <div className="grid w-full items-start" style={{ gridTemplateColumns: "320px minmax(0, 1fr)", gap: 18 }}>
            <aside className="flex flex-col" style={{ gap: 14 }}>
              <div className="kimix-soft-card rounded-xl text-[13.5px] leading-6" style={{ padding: "14px 16px" }}>
                勾选后全局启用 Skill；新建/恢复会话时通过官方 `--skills-dir` 传给 CLI。
              </div>
              <div className="kimix-soft-card rounded-xl text-[13px] leading-6" style={{ padding: "14px 16px" }}>
                <div>{message}{saving ? "，正在保存..." : ""}</div>
                {enabledDir && <div className="mt-1 break-all" title={enabledDir}>启用目录：{enabledDir}</div>}
              </div>
              <div className="kimix-soft-card rounded-xl text-[13px] leading-6" style={{ padding: "14px 16px" }}>
                <div className="flex items-start justify-between" style={{ gap: 12 }}>
                  <div className="min-w-0">
                    <div className="font-medium text-[var(--kimix-panel-text)]">
                      Superpowers：{superpowersDiagnostics?.enabled ? "已接入" : "未接入"}
                    </div>
                    <div className="mt-1 text-[var(--kimix-panel-text-secondary)]">
                      {superpowersDiagnostics?.enabled
                        ? `已启用 ${superpowersDiagnostics.superpowerSkills?.length ?? 0} 个 Superpowers Skill`
                        : "需要安装并启用 using-superpowers 后，新会话才会注入 agent-file。"}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void refreshSuperpowersDiagnostics()}
                    disabled={checkingSuperpowers}
                    className="kimix-icon-text-button kimix-muted-action is-compact shrink-0 disabled:cursor-wait disabled:opacity-50"
                  >
                    <Sparkles size={14} />
                    <span>{checkingSuperpowers ? "检查中" : "诊断"}</span>
                  </button>
                </div>
                {superpowersDiagnostics && (
                  <div className="mt-3 flex flex-col text-[12.5px] text-[var(--kimix-panel-text-muted)]" style={{ gap: 6 }}>
                    {superpowersDiagnostics.skillsDir && <div className="break-all" title={superpowersDiagnostics.skillsDir}>skills-dir：{superpowersDiagnostics.skillsDir}{superpowersDiagnostics.skillsDirExists === false ? "（不存在）" : ""}</div>}
                    {superpowersDiagnostics.agentFile && <div className="break-all" title={superpowersDiagnostics.agentFile}>agent-file：{superpowersDiagnostics.agentFile}{superpowersDiagnostics.agentFileExists === false ? "（未生成）" : ""}</div>}
                    {superpowersDiagnostics.usingSkillPath && <div className="break-all" title={superpowersDiagnostics.usingSkillPath}>using-superpowers：{superpowersDiagnostics.usingSkillPath}</div>}
                    {superpowersDiagnostics.legacyAgentFileExists && <div className="text-[#9b4b34]">检测到旧 superpowers-agent.md 残留，当前版本会改用 superpowers-agent.yaml。</div>}
                    {(superpowersDiagnostics.diagnostics ?? []).map((line) => (
                      <div key={line} className="break-all" title={line}>{line}</div>
                    ))}
                  </div>
                )}
              </div>
            </aside>
            <section className="grid min-w-0 items-start" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              {skills.map((skill) => (
                <button
                  key={skill.path}
                  type="button"
                  onClick={() => void toggleSkill(skill.name)}
                  className={`min-h-[142px] w-full rounded-xl border text-left transition-colors hover:bg-[var(--kimix-panel-soft-bg)] ${enabledNames.includes(skill.name) ? "border-[var(--accent-blue)]" : "border-[var(--kimix-panel-border-soft)] bg-[var(--kimix-panel-bg)]"}`}
                  style={{
                    padding: "16px 18px",
                    background: enabledNames.includes(skill.name)
                      ? "color-mix(in srgb, var(--accent-blue) 8%, var(--kimix-panel-bg))"
                      : undefined,
                  }}
                >
                  <div className="grid h-full" style={{ gridTemplateColumns: "22px minmax(0, 1fr) auto", gap: 12 }}>
                    <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${enabledNames.includes(skill.name) ? "border-[var(--accent-blue)] bg-[var(--accent-blue)] text-white" : "border-[var(--kimix-selection-idle-border)] text-transparent"}`}>
                      <Check size={13} />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-semibold leading-5 text-[var(--kimix-panel-text)]">{skill.name}</span>
                      <span className="mt-2 line-clamp-2 block text-[13px] leading-5 text-[var(--kimix-panel-text-secondary)]" title={skill.description}>{shortDescription(skill.description)}</span>
                      <span className="mt-2 block truncate text-[12px] text-[var(--kimix-panel-text-muted)]" title={skill.path}>{skill.path}</span>
                    </span>
                    <span className={`h-6 shrink-0 rounded-full text-[12px] font-medium leading-6 ${enabledNames.includes(skill.name) ? "bg-[var(--accent-blue)] text-white" : "bg-[var(--kimix-panel-badge-bg)] text-[var(--kimix-panel-badge-text)]"}`} style={{ paddingLeft: 9, paddingRight: 9 }}>
                      {enabledNames.includes(skill.name) ? "已启用" : "未启用"}
                    </span>
                  </div>
                </button>
              ))}
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
