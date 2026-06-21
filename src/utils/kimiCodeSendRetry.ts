type SendKimiCodePromptRequest = Parameters<Window["api"]["sendKimiCodePrompt"]>[0];
type SendKimiCodePromptResponse = Awaited<ReturnType<Window["api"]["sendKimiCodePrompt"]>>;

const ACTIVE_TURN_RETRY_DELAYS_MS = [600, 1200, 2200, 3500];

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function isKimiActiveTurnError(message: string) {
  return /another turn .* active|turn .* active|Cannot launch a new turn/i.test(message);
}

export function getKimiAlreadyExistsSessionId(message: string) {
  if (!/already exists/i.test(message)) return null;
  return message.match(/Session\s+"([^"]+)"/i)?.[1]
    ?? message.match(/\bsession[_-][0-9a-z-]+/i)?.[0]
    ?? null;
}

export function isKimiAlreadyExistsSessionError(message: string) {
  return getKimiAlreadyExistsSessionId(message) !== null;
}

export async function sendKimiCodePromptWithRetry(req: SendKimiCodePromptRequest): Promise<SendKimiCodePromptResponse> {
  let last = await window.api.sendKimiCodePrompt(req);
  for (const delay of ACTIVE_TURN_RETRY_DELAYS_MS) {
    if (last.success || !isKimiActiveTurnError(last.error)) return last;
    await sleep(delay);
    last = await window.api.sendKimiCodePrompt(req);
  }
  return last;
}
