export const KIMIX_ROOM_METADATA_SOURCE = "kimix-room-agent" as const;
export const KIMIX_ROOM_METADATA_SCHEMA_VERSION = 1 as const;

export interface RoomSessionMetadataInput {
  schemaVersion: 1;
  roomId: string;
  roomAgentId: string;
  primarySessionId: string;
}

const ROOM_METADATA_KEYS = new Set(["schemaVersion", "roomId", "roomAgentId", "primarySessionId"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requiredIdentity(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`Invalid room metadata: ${field}`);
  const normalized = value.trim();
  if (!normalized || normalized.length > 240 || /[\0\r\n]/.test(normalized)) {
    throw new Error(`Invalid room metadata: ${field}`);
  }
  return normalized;
}

export function parseRoomMetadataRequest(value: unknown): RoomSessionMetadataInput | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value) || Object.keys(value).some((key) => !ROOM_METADATA_KEYS.has(key))) {
    throw new Error("Invalid room metadata payload");
  }
  if (value.schemaVersion !== KIMIX_ROOM_METADATA_SCHEMA_VERSION) {
    throw new Error("Unsupported room metadata schema");
  }
  const roomAgentId = requiredIdentity(value.roomAgentId, "roomAgentId");
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(roomAgentId)) {
    throw new Error("Invalid room metadata: roomAgentId");
  }
  return {
    schemaVersion: KIMIX_ROOM_METADATA_SCHEMA_VERSION,
    roomId: requiredIdentity(value.roomId, "roomId"),
    roomAgentId,
    primarySessionId: requiredIdentity(value.primarySessionId, "primarySessionId"),
  };
}

export function buildOfficialRoomMetadata(input: RoomSessionMetadataInput): Record<string, unknown> {
  return {
    source: KIMIX_ROOM_METADATA_SOURCE,
    kimixRoomSchemaVersion: KIMIX_ROOM_METADATA_SCHEMA_VERSION,
    kimixRoomId: input.roomId,
    kimixRoomAgentId: input.roomAgentId,
    kimixPrimarySessionId: input.primarySessionId,
  };
}

export function parseOfficialRoomMetadata(value: unknown): RoomSessionMetadataInput | null {
  if (!isRecord(value) || value.source !== KIMIX_ROOM_METADATA_SOURCE) return null;
  try {
    return parseRoomMetadataRequest({
      schemaVersion: value.kimixRoomSchemaVersion,
      roomId: value.kimixRoomId,
      roomAgentId: value.kimixRoomAgentId,
      primarySessionId: value.kimixPrimarySessionId,
    }) ?? null;
  } catch {
    return null;
  }
}

export function officialRoomMetadataMatches(value: unknown, expected: RoomSessionMetadataInput): boolean {
  const parsed = parseOfficialRoomMetadata(value);
  return Boolean(parsed &&
    parsed.schemaVersion === expected.schemaVersion &&
    parsed.roomId === expected.roomId &&
    parsed.roomAgentId === expected.roomAgentId &&
    parsed.primarySessionId === expected.primarySessionId);
}
