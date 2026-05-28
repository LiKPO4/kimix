export function sendDocumentCommand(command: string) {
  document.execCommand(command);
}

export function isInputLike(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}
