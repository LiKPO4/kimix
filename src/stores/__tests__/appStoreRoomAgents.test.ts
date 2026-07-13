import { afterEach, describe, expect, it } from "vitest";
import { useAppStore } from "../appStore";
import { roomAgentActivityKey } from "@/utils/collaborationRooms";

afterEach(() => {
  useAppStore.setState({ roomAgentActivities: {}, runningSessionId: null, isRunning: false });
});

describe("appStore room Agent activity", () => {
  it("tracks two independent Agent states in one room", () => {
    const store = useAppStore.getState();
    store.setRoomAgentActivity({
      roomId: "room-1",
      roomAgentId: "agent-a",
      runtimeSessionId: "runtime-a",
      status: "running",
      startedAt: 10,
      updatedAt: 10,
    });
    store.setRoomAgentActivity({
      roomId: "room-1",
      roomAgentId: "agent-b",
      runtimeSessionId: "runtime-b",
      status: "waiting_approval",
      startedAt: 20,
      updatedAt: 25,
    });

    const activities = useAppStore.getState().roomAgentActivities;
    expect(activities[roomAgentActivityKey("room-1", "agent-a")]?.status).toBe("running");
    expect(activities[roomAgentActivityKey("room-1", "agent-b")]?.status).toBe("waiting_approval");
  });

  it("removing one Agent state does not clear another Agent", () => {
    const store = useAppStore.getState();
    store.setRoomAgentActivity({ roomId: "room-1", roomAgentId: "agent-a", status: "completed", updatedAt: 30 });
    store.setRoomAgentActivity({ roomId: "room-1", roomAgentId: "agent-b", status: "running", updatedAt: 30 });
    useAppStore.getState().removeRoomAgentActivity("room-1", "agent-a");

    const activities = useAppStore.getState().roomAgentActivities;
    expect(activities[roomAgentActivityKey("room-1", "agent-a")]).toBeUndefined();
    expect(activities[roomAgentActivityKey("room-1", "agent-b")]?.status).toBe("running");
  });
});
