// Keep the HTTP fallback synchronous with the user's click. The deployed Web
// UI may not have the secure-context Clipboard API.
export async function copyTerminalText(text: string, container: HTMLElement = document.body) {
  const fallback = () => {
    const selection = window.getSelection();
    const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
    const focused = document.activeElement;
    const input = document.createElement("textarea");
    input.value = text;
    input.readOnly = true;
    input.setAttribute("inputmode", "none");
    input.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;";
    container.appendChild(input);
    try {
      input.focus({ preventScroll: true });
      input.select();
      if (!document.execCommand("copy")) throw new Error("浏览器未允许复制，请使用系统复制菜单或 Ctrl/Cmd+C。");
    } finally {
      input.remove();
      if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
      selection?.removeAllRanges();
      ranges.forEach(range => selection?.addRange(range));
    }
  };
  if (!navigator.clipboard?.writeText) {
    fallback();
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    fallback();
  }
}
