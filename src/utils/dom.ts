export function sendDocumentCommand(command: string) {
  document.execCommand(command);
}

export function isInputLike(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

export function deleteSelection(): void {
  const target = document.activeElement;
  if (isInputLike(target)) {
    const start = target.selectionStart ?? 0;
    const end = target.selectionEnd ?? 0;
    if (start === end) return;
    target.setRangeText("", start, end, "end");
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
  } else {
    document.execCommand("delete");
  }
}
