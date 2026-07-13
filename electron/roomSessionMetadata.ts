import path from "node:path";
import { createHash } from "node:crypto";
import { normalizePathForComparison } from "../src/utils/pathCase";
import {
  officialRoomMetadataMatches,
  type RoomSessionMetadataInput,
} from "../src/utils/roomSessionMetadata";

export {
  buildOfficialRoomMetadata,
  KIMIX_ROOM_METADATA_SCHEMA_VERSION,
  KIMIX_ROOM_METADATA_SOURCE,
  officialRoomMetadataMatches,
  parseOfficialRoomMetadata,
  parseRoomMetadataRequest,
} from "../src/utils/roomSessionMetadata";

export interface RoomSessionMetadataCandidate {
  id: string;
  workDir: string;
  archived?: boolean;
  metadata?: Record<string, unknown>;
}

export function deriveRoomAgentSessionId(roomAgentId: string): string {
  const digest = createHash("sha256").update(roomAgentId, "utf8").digest("hex").slice(0, 24);
  return `kimix-room-${digest}`;
}

function normalizedWorkDir(value: string): string {
  return normalizePathForComparison(path.resolve(value));
}

export function selectExistingRoomSession<T extends RoomSessionMetadataCandidate>(
  candidates: readonly T[],
  expected: RoomSessionMetadataInput,
  workDir: string,
): T | null {
  const targetWorkDir = normalizedWorkDir(workDir);
  const matches = candidates.filter((candidate) => {
    const candidateWorkDir = candidate.workDir || (typeof candidate.metadata?.cwd === "string" ? candidate.metadata.cwd : "");
    return Boolean(candidate.id && candidateWorkDir && normalizedWorkDir(candidateWorkDir) === targetWorkDir &&
      officialRoomMetadataMatches(candidate.metadata, expected));
  });
  const active = matches.filter((candidate) => candidate.archived !== true);
  if (active.length > 1) {
    throw new Error(`检测到 ${active.length} 个重复的房间 Agent session，已停止自动绑定。`);
  }
  if (active.length === 1) return active[0];
  if (matches.length > 0) {
    throw new Error("对应的房间 Agent session 已归档，不能自动创建重复 session。");
  }
  return null;
}
