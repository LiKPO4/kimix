// Git Bash 运行环境（Windows）：官方 Kimi Code 运行时在 Windows 上强制依赖 Git Bash 执行命令，
// 缺失时会话直接失败。这里集中存放检测特征与安装引导常量，供错误检测弹窗和设置页状态卡复用。

export const GIT_FOR_WINDOWS_DOWNLOAD_URL = "https://gitforwindows.org/";

export const GIT_INSTALL_COMMAND = "winget install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements";

const GIT_BASH_MISSING_PATTERN = /Git Bash was not found|KIMI_SHELL_PATH/i;

/** 判断一条错误文本是否为官方运行时的「Git Bash 缺失」报错。 */
export function isGitBashMissingError(text: string | undefined | null): boolean {
  return Boolean(text) && GIT_BASH_MISSING_PATTERN.test(text as string);
}
