type WindowsEditorEnvironment = {
  LOCALAPPDATA?: string;
  ProgramFiles?: string;
  "ProgramFiles(x86)"?: string;
};

const WINDOWS_VSCODE_PATHS = [
  ["LOCALAPPDATA", "Programs", "Microsoft VS Code", "Code.exe"],
  ["ProgramFiles", "Microsoft VS Code", "Code.exe"],
  ["ProgramFiles(x86)", "Microsoft VS Code", "Code.exe"],
];

export function getWindowsVsCodeCandidates(
  env: WindowsEditorEnvironment,
): string[] {
  return WINDOWS_VSCODE_PATHS.flatMap(([environmentKey, ...segments]) => {
    const root = env[environmentKey as keyof WindowsEditorEnvironment];
    return root ? [[root, ...segments].join("\\")] : [];
  });
}
