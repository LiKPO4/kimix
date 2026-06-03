import { create } from "zustand";
import type { Session, TimelineEvent, Project, UserMessageImage } from "@/types/ui";

export interface PendingMessage {
  id: string;
  sessionId: string;
  content: string;
  createdAt: number;
  images?: UserMessageImage[];
}

export interface SessionStore {
  sessions: Session[];
  recentProjects: Project[];
  pendingMessages: PendingMessage[];
  addSession: (session: Session) => void;
  updateSession: (id: string, updater: (s: Session) => Session) => void;
  addEvent: (sessionId: string, event: TimelineEvent) => void;
  loadHistory: (sessionId: string, events: TimelineEvent[]) => void;
  deleteSession: (id: string) => void;
  archiveSession: (id: string) => void;
  restoreSession: (id: string) => void;
  setRecentProjects: (projects: Project[]) => void;
  addPendingMessage: (sessionId: string, content: string, images?: UserMessageImage[]) => void;
  updatePendingMessage: (id: string, content: string) => void;
  removePendingMessage: (id: string) => void;
  movePendingMessage: (id: string, direction: "up" | "down") => void;
  reorderPendingMessage: (dragId: string, targetId: string) => void;
  promotePendingMessage: (id: string) => void;
  shiftPendingMessage: (sessionId: string) => PendingMessage | undefined;
}

function createPendingMessage(sessionId: string, content: string, images: UserMessageImage[] = []): PendingMessage {
  return {
    id: crypto.randomUUID(),
    sessionId,
    content,
    createdAt: Date.now(),
    images,
  };
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
      pendingMessages: state.pendingMessages.filter((msg) => msg.sessionId !== id),
    })),

  archiveSession: (id) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, archivedAt: Date.now(), updatedAt: Date.now() } : s
      ),
    })),

  restoreSession: (id) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, archivedAt: undefined, updatedAt: Date.now() } : s
      ),
    })),

  setRecentProjects: (projects) => set({ recentProjects: projects }),

  addPendingMessage: (sessionId, content, images = []) =>
    set((state) => {
      const normalized = content.trim();
      const normalizedImages = images.filter((image) => Boolean(image.dataUrl));
      if (!normalized && normalizedImages.length === 0) return state;
      return { pendingMessages: [...state.pendingMessages, createPendingMessage(sessionId, normalized, normalizedImages)] };
    }),

  updatePendingMessage: (id, content) =>
    set((state) => ({
      pendingMessages: state.pendingMessages.map((msg) =>
        msg.id === id ? { ...msg, content } : msg
      ),
    })),

  removePendingMessage: (id) =>
    set((state) => ({
      pendingMessages: state.pendingMessages.filter((msg) => msg.id !== id),
    })),

  movePendingMessage: (id, direction) =>
    set((state) => {
      const index = state.pendingMessages.findIndex((msg) => msg.id === id);
      if (index < 0) return state;
      const nextIndex = direction === "up" ? index - 1 : index + 1;
      if (nextIndex < 0 || nextIndex >= state.pendingMessages.length) return state;
      const pendingMessages = [...state.pendingMessages];
      const [item] = pendingMessages.splice(index, 1);
      pendingMessages.splice(nextIndex, 0, item);
      return { pendingMessages };
    }),

  reorderPendingMessage: (dragId, targetId) =>
    set((state) => {
      if (dragId === targetId) return state;
      const fromIndex = state.pendingMessages.findIndex((msg) => msg.id === dragId);
      const toIndex = state.pendingMessages.findIndex((msg) => msg.id === targetId);
      if (fromIndex < 0 || toIndex < 0) return state;
      const pendingMessages = [...state.pendingMessages];
      const [item] = pendingMessages.splice(fromIndex, 1);
      pendingMessages.splice(toIndex, 0, item);
      return { pendingMessages };
    }),

  promotePendingMessage: (id) =>
    set((state) => {
      const index = state.pendingMessages.findIndex((msg) => msg.id === id);
      if (index <= 0) return state;
      const pendingMessages = [...state.pendingMessages];
      const [item] = pendingMessages.splice(index, 1);
      pendingMessages.unshift(item);
      return { pendingMessages };
    }),

  shiftPendingMessage: (sessionId) => {
    let result: PendingMessage | undefined;
    set((state) => {
      result = state.pendingMessages.find((msg) => msg.sessionId === sessionId);
      if (!result) return state;
      const removeId = result.id;
      return { pendingMessages: state.pendingMessages.filter((msg) => msg.id !== removeId) };
    });
    return result;
  },
}));
