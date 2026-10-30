// Saves text as a file through a temporary object URL.

/** Starts a download of `text` named `fileName`. The URL is revoked on a later task, since
 *  some browsers begin the download asynchronously after `click()`. */
export function downloadText(
  fileName: string,
  text: string,
  type = "application/json",
): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Starts a download of a JSON document. */
export function downloadJson(fileName: string, json: string): void {
  downloadText(fileName, json);
}
