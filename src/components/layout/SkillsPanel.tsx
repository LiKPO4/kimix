import { useEffect, useState } from "react";
import { Check, LayoutGrid, X } from "lucide-react";

type SkillInfo = {
  name: string;
  description: string;
  path: string;
  source: string;
  enabled: boolean;
};

export function SkillsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [enabledNames, setEnabledNames] = useState<string[]>([]);
  const [enabledDir, setEnabledDir] = useState("");
  const [message, setMessage] = useState("正在扫描本地 Skills...");
  const [saving, setSaving] = useState(false);

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
  };

  const shortDescription = (description: string) => {
    const firstSentence = description.split(/(?<=[.!?。！？])\s+/)[0]?.trim() || description.trim();
    return firstSentence.length > 96 ? `${firstSentence.slice(0, 96)}...` : firstSentence;
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/20 px-5" onMouseDown={onClose}>
      <div className="w-full max-w-[640px] overflow-hidden rounded-[18px] border border-[#dedad2] bg-white shadow-[0_28px_90px_rgba(25,23,20,0.24)]" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[#eee9e1]" style={{ padding: "16px 20px" }}>
          <div className="flex items-center gap-2.5 text-[18px] font-semibold text-[#24211d]">
            <LayoutGrid size={18} />
            <span>技能</span>
          </div>
          <button className="flex h-8 w-8 items-center justify-center rounded-lg text-[#8a847a] hover:bg-[#f3f1ec]" onClick={onClose} aria-label="关闭技能面板">
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[68vh] overflow-y-auto" style={{ padding: 20 }}>
          <div className="rounded-xl border border-[#e5e1d8] bg-[#faf8f4] text-[13.5px] leading-6 text-[#625d55]" style={{ padding: "12px 16px" }}>
            勾选后全局启用 Skill；新建/恢复会话时通过官方 `--skills-dir` 传给 CLI。
          </div>
          <div className="rounded-xl bg-[#faf8f4] text-[13px] leading-6 text-[#8f887e]" style={{ marginTop: 12, padding: "12px 16px" }}>
            <div>{message}{saving ? "，正在保存..." : ""}</div>
            {enabledDir && <div className="truncate" title={enabledDir}>启用目录：{enabledDir}</div>}
            <div>不要发送 `/skill:xxx`；它只是普通文本。</div>
          </div>
          <div className="flex flex-col" style={{ gap: 12, marginTop: 14 }}>
            {skills.map((skill) => (
              <button
                key={skill.path}
                type="button"
                onClick={() => void toggleSkill(skill.name)}
                className={`w-full rounded-xl border bg-white text-left transition-colors hover:bg-[#faf8f4] ${enabledNames.includes(skill.name) ? "border-[#cfc8bc]" : "border-[#e5e1d8]"}`}
                style={{ padding: "18px 22px" }}
              >
                <div className="flex items-start" style={{ gap: 16 }}>
                  <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${enabledNames.includes(skill.name) ? "border-[#24211d] bg-[#24211d] text-white" : "border-[#d8d2c8] text-transparent"}`}>
                    <Check size={13} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold text-[#24211d]">{skill.name}</span>
                    <span className="mt-1 block text-[13.5px] leading-5 text-[#625d55]" title={skill.description}>{shortDescription(skill.description)}</span>
                    <span className="mt-2 block truncate text-[12px] text-[#aaa49a]" title={skill.path}>{skill.path}</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-[#f3f1ec] text-[12px] text-[#8a847a]" style={{ padding: "4px 10px", marginRight: 2 }}>
                    {enabledNames.includes(skill.name) ? "已启用" : "未启用"}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
