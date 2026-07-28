// Minimal ambient typings for the parts of the File System Access API fs-store.ts uses.
// lib.dom.d.ts (as of TS 5.9) ships the older/partial `FileSystemFileHandle` shape but not
// `window.showSaveFilePicker` or the handle's `queryPermission`/`requestPermission` -- those
// need `@types/wicg-file-system-access` or a local declaration; this is the narrower option; no
// new dependency for four members. Chromium-only, per fs-store.ts's own header comment.

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

interface FileSystemFileHandle {
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: { description?: string; accept: Record<string, string[]> }[];
}

interface Window {
  showSaveFilePicker(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
}
