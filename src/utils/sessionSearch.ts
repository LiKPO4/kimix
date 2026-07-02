import type { Session } from "@/types/ui";

export type SessionSearchEntry = {
  session: Session;
  lastPrompt: string;
};

function compact(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function lastSessionPrompt(session: Session): string {
  for (let index = session.events.length - 1; index >= 0; index -= 1) {
    const event = session.events[index];
    if (event?.type === "user_message" || event?.type === "steer_message") {
      const content = compact(event.content);
      if (content) return content;
    }
  }
  return "";
}

export function searchSessions(sessions: Session[], query: string, limit = 200): SessionSearchEntry[] {
  const normalized = compact(query).toLocaleLowerCase();
  return sessions
    .filter((session) => !session.archivedAt)
    .map((session) => ({ session, lastPrompt: lastSessionPrompt(session) }))
    .filter(({ session, lastPrompt }) => !normalized || [session.title, session.projectPath, lastPrompt]
      .some((value) => value.toLocaleLowerCase().includes(normalized)))
    .sort((a, b) => b.session.updatedAt - a.session.updatedAt)
    .slice(0, limit);
}
