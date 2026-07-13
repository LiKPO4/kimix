import { describe, expect, it } from "vitest";
import {
  buildOfficialRoomMetadata,
  officialRoomMetadataMatches,
  parseOfficialRoomMetadata,
  parseRoomMetadataRequest,
  selectExistingRoomSession,
} from "../../../electron/roomSessionMetadata";

const request = {
  schemaVersion: 1 as const,
  roomId: "room-1",
  roomAgentId: "agent-2",
  primarySessionId: "session-primary",
};

describe("roomSessionMetadata", () => {
  it("accepts only the dedicated renderer contract and maps controlled official fields", () => {
    expect(parseRoomMetadataRequest(request)).toEqual(request);
    const official = buildOfficialRoomMetadata(request);
    expect(official).toEqual({
      source: "kimix-room-agent",
      kimixRoomSchemaVersion: 1,
      kimixRoomId: "room-1",
      kimixRoomAgentId: "agent-2",
      kimixPrimarySessionId: "session-primary",
    });
    expect(parseOfficialRoomMetadata({ ...official, cwd: "D:/repo" })).toEqual(request);
    expect(officialRoomMetadataMatches(official, request)).toBe(true);
  });

  it("rejects arbitrary metadata keys, unsupported schemas and unsafe identities", () => {
    expect(() => parseRoomMetadataRequest({ ...request, arbitrary: "value" })).toThrow("Invalid room metadata payload");
    expect(() => parseRoomMetadataRequest({ ...request, schemaVersion: 2 })).toThrow("Unsupported room metadata schema");
    expect(() => parseRoomMetadataRequest({ ...request, roomAgentId: "bad\nagent" })).toThrow("roomAgentId");
    expect(() => parseRoomMetadataRequest({ ...request, roomAgentId: "bad/agent" })).toThrow("roomAgentId");
    expect(parseOfficialRoomMetadata({ source: "kimix-room-agent", kimixRoomSchemaVersion: 99 })).toBeNull();
  });

  it("finds an empty matching session and refuses ambiguous or archived recovery", () => {
    const metadata = buildOfficialRoomMetadata(request);
    const empty = { id: "session-empty", workDir: "D:/repo", metadata };
    expect(selectExistingRoomSession([empty], request, "D:\\repo")).toBe(empty);
    expect(selectExistingRoomSession([{ ...empty, metadata: { ...metadata, kimixRoomAgentId: "other" } }], request, "D:/repo")).toBeNull();
    expect(() => selectExistingRoomSession([empty, { ...empty, id: "duplicate" }], request, "D:/repo"))
      .toThrow("重复的房间 Agent session");
    expect(() => selectExistingRoomSession([{ ...empty, archived: true }], request, "D:/repo"))
      .toThrow("已归档");
  });
});
