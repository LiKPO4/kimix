import { Sidebar } from "./Sidebar";
import { ChatThread } from "@/components/chat/ChatThread";
import { Composer } from "@/components/chat/Composer";
import { ContextBar } from "@/components/chat/ContextBar";
import { SettingsPanel } from "@/components/settings/SettingsPanel";

export function AppShell() {
  return (
    <div className="flex h-full w-full bg-bg-primary">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 bg-bg-primary">
        <ChatThread />
        <Composer />
        <ContextBar />
      </div>
      <SettingsPanel />
    </div>
  );
}
