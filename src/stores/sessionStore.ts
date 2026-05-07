import { create } from "zustand";
import type { Session, TimelineEvent, Project } from "@/types/ui";

interface SessionStore {
  sessions: Session[];
  recentProjects: Project[];
  pendingMessages: string[];
  addSession: (session: Session) => void;
  updateSession: (id: string, updater: (s: Session) => Session) => void;
  addEvent: (sessionId: string, event: TimelineEvent) => void;
  loadHistory: (sessionId: string, events: TimelineEvent[]) => void;
  deleteSession: (id: string) => void;
  setRecentProjects: (projects: Project[]) => void;
  addPendingMessage: (msg: string) => void;
  shiftPendingMessage: () => string | undefined;
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: [],
  recentProjects: [],
  pendingMessages: [],

  addSession: (session) =>
    set((state) => ({ sessions: [session, ...state.sessions] })),

  updateSession: (id, updater) =>
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? updater(s) : s)),
    })),

  addEvent: (sessionId, event) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, events: [...s.events, event], updatedAt: Date.now() } : s
      ),
    })),

  loadHistory: (sessionId, events) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, events, isLoading: false } : s
      ),
    })),

  deleteSession: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
    })),

  setRecentProjects: (projects) => set({ recentProjects: projects }),

  addPendingMessage: (msg) =>
    set((state) => ({ pendingMessages: [...state.pendingMessages, msg] })),

  shiftPendingMessage: () => {
    let result: string | undefined;
    set((state) => {
      result = state.pendingMessages[0];
      return { pendingMessages: state.pendingMessages.slice(1) };
    });
    return result;
  },
}));
