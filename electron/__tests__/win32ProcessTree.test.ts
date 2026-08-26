import { describe, expect, it } from "vitest";
import { collectOwnProcessIds, parseWin32ProcessTable } from "../win32ProcessTree";

const WEBBRIDGE = "kimi-webbridge.exe";

describe("Win32 进程表解析", () => {
  it("数组输出解析为条目并跳过无效项", () => {
    const output = JSON.stringify([
      { Name: WEBBRIDGE, ProcessId: 10, ParentProcessId: 5 },
      { Name: "", ProcessId: 11, ParentProcessId: 5 },
      { Name: "bad.exe", ProcessId: "x", ParentProcessId: 5 },
      null,
    ]);
    expect(parseWin32ProcessTable(output)).toEqual([{ name: WEBBRIDGE, pid: 10, ppid: 5 }]);
  });

  it("单对象输出也解析为单元素数组", () => {
    const output = JSON.stringify({ Name: "kimi-cu.exe", ProcessId: 12, ParentProcessId: 6 });
    expect(parseWin32ProcessTable(output)).toEqual([{ name: "kimi-cu.exe", pid: 12, ppid: 6 }]);
  });

  it("非法或截断输出返回空表", () => {
    expect(parseWin32ProcessTable("not json")).toEqual([]);
    expect(parseWin32ProcessTable('{"Name":"a.exe","ProcessId":1,')).toEqual([]);
    expect(parseWin32ProcessTable("")).toEqual([]);
  });
});

describe("能力二进制自有进程识别", () => {
  it("当前进程的直接子进程与隔代后代都会被选中", () => {
    const table = [
      { name: "electron.exe", pid: 100, ppid: 1 },
      { name: WEBBRIDGE, pid: 200, ppid: 100 },
      { name: "kimi-server.exe", pid: 300, ppid: 100 },
      { name: WEBBRIDGE, pid: 400, ppid: 300 },
    ];
    expect(collectOwnProcessIds(table, 100, WEBBRIDGE)).toEqual([200, 400]);
  });

  it("父进程已退出的孤儿（上一实例残留）会被选中", () => {
    const table = [
      { name: "electron.exe", pid: 100, ppid: 1 },
      { name: WEBBRIDGE, pid: 500, ppid: 999 },
    ];
    expect(collectOwnProcessIds(table, 100, WEBBRIDGE)).toEqual([500]);
  });

  it("其他存活应用的同名进程不会被选中", () => {
    const table = [
      { name: "electron.exe", pid: 100, ppid: 1 },
      { name: "other-tool.exe", pid: 600, ppid: 1 },
      { name: WEBBRIDGE, pid: 700, ppid: 600 },
    ];
    expect(collectOwnProcessIds(table, 100, WEBBRIDGE)).toEqual([]);
  });

  it("镜像名大小写不敏感", () => {
    const table = [
      { name: "electron.exe", pid: 100, ppid: 1 },
      { name: "KIMI-WEBBRIDGE.EXE", pid: 200, ppid: 100 },
    ];
    expect(collectOwnProcessIds(table, 100, WEBBRIDGE)).toEqual([200]);
  });

  it("父链成环时安全终止且不误判后代", () => {
    const table = [
      { name: "electron.exe", pid: 100, ppid: 1 },
      { name: "a.exe", pid: 800, ppid: 900 },
      { name: "b.exe", pid: 900, ppid: 800 },
      { name: WEBBRIDGE, pid: 950, ppid: 800 },
    ];
    expect(collectOwnProcessIds(table, 100, WEBBRIDGE)).toEqual([]);
  });

  it("root 自身与系统关键进程即使镜像名匹配也不入选", () => {
    const table = [
      { name: WEBBRIDGE, pid: 100, ppid: 1 },
      { name: WEBBRIDGE, pid: 4, ppid: 2 },
    ];
    expect(collectOwnProcessIds(table, 100, WEBBRIDGE)).toEqual([]);
  });
});
