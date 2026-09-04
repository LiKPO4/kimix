// 本地思考翻译运行时（@huggingface/transformers 推理栈）按需下载清单。
// 闭包 = transformers 依赖树，剔除 onnxruntime-web（Web 后端，node 路径不经过）与 sharp 及其原生库
// （transformers 顶层静态 import sharp，但翻译路径从不调用；下载器在安装时写入桩模块替代，见
// localThinkingRuntimeDownloader.ts 的 writeSharpStub）。
// worker 必须走 ESM 入口（dist/transformers.node.mjs），CJS 入口会在无原生库时直接抛错。
// version 与 integrity 必须与 pnpm-lock.yaml 完全一致（electron/__tests__/localThinkingRuntimeDownloader.test.ts 锁定）；
// 升级 transformers 时同步更新本文件全部条目。

export type LocalThinkingRuntimePackage = {
  name: string;
  version: string;
  tarballBytes: number;
  integrity: string;
};

export const LOCAL_THINKING_RUNTIME_PACKAGES: readonly LocalThinkingRuntimePackage[] = [
  { name: "@huggingface/jinja", version: "0.5.9", tarballBytes: 72638, integrity: "sha512-uWTG+l3VJRsl7EXxYizuL3P+cCPoc3cRqbWWRcQN0FhejRfbdq0RNhCmbY/YDtnTcz9icdLYuLDjsnz4d8JMuw==" },
  { name: "@huggingface/transformers", version: "3.8.1", tarballBytes: 10482401, integrity: "sha512-tsTk4zVjImqdqjS8/AOZg2yNLd1z9S5v+7oUPpXaasDRwEDhB+xnglK1k5cad26lL5/ZIaeREgWWy0bs9y9pPA==" },
  { name: "@isaacs/fs-minipass", version: "4.0.1", tarballBytes: 12383, integrity: "sha512-wgm9Ehl2jpeqP3zw/7mo3kRHFp5MEDhqAdwy1fTGkHAwnkGOVsgpvQhL8B5n1qlb01jV3n/bI0ZfZp5lWA1k4w==" },
  { name: "boolean", version: "3.2.0", tarballBytes: 4488, integrity: "sha512-d0II/GO9uf9lfUHH2BQsjxzRJZBdsjgsBiW4BvhWk/3qoKwQFjIDVN19PfX8F2D/r9PCMTtLWjYVCFrpeYUzsw==" },
  { name: "chownr", version: "3.0.0", tarballBytes: 4405, integrity: "sha512-+IxzY9BZOQd/XuYPRmrvEVjF/nqj5kgT4kEq7VofrDoM1MxoRjEWkrCC3EtLi59TVawxTAn+orJwFQcrqEN1+g==" },
  { name: "define-data-property", version: "1.1.4", tarballBytes: 8913, integrity: "sha512-rBMvIzlpA8v6E+SJZoo++HAYqsLrkg7MSfIinMPFhmkorw7X+dOXVJQs+QT69zGkzMyfDnIMN2Wid1+NbL3T+A==" },
  { name: "define-properties", version: "1.2.1", tarballBytes: 5203, integrity: "sha512-8QmQKqEASLd5nx0U1B1okLElbUuuttJ/AnYmRXbbbGDWh6uS208EjD4Xqq/I9wK7u0v6O08XhTWnt5XtEbR6Dg==" },
  { name: "detect-node", version: "2.1.0", tarballBytes: 1609, integrity: "sha512-T0NIuQpnTvFDATNuHN5roPwSBG83rFsuO+MXXH9/3N1eFbn4wcPjttvjMLEPWJ0RGUYgQE7cGgS3tNxbqCGM7g==" },
  { name: "es-define-property", version: "1.0.1", tarballBytes: 4431, integrity: "sha512-e3nRfgfUZ4rNGL232gUgX06QNyyez04KdjFrF+LTRoOXmrOgFKDg4BCdsjW8EnT69eqdYGmRpJwiPVYNrCaW3g==" },
  { name: "es-errors", version: "1.3.0", tarballBytes: 5338, integrity: "sha512-Zf5H2Kxt2xjTvbJvP2ZWLEICxA6j+hAmMzIlypy4xcBg1vKVnx89Wy0GbS+kf5cwCVFFzdCFh2XSCFNULS6csw==" },
  { name: "es6-error", version: "4.1.1", tarballBytes: 3294, integrity: "sha512-Um/+FxMr9CISWh0bi5Zv0iOD+4cFh5qLeks1qhAopKVAJw3drgKbKySikp7wGhDL0HPeaja0P5ULZrxLkniUVg==" },
  { name: "escape-string-regexp", version: "4.0.0", tarballBytes: 2017, integrity: "sha512-TtpcNJ3XAzx3Gq8sWRzJaVajRs0uVxA2YAkdb1jm2YkPz4G6egUFAyA3n5vtEIZefPk5Wa4UXbKuS5fKkJWdgA==" },
  { name: "global-agent", version: "3.0.0", tarballBytes: 30541, integrity: "sha512-PT6XReJ+D07JvGoxQMkT6qji/jVNfX/h364XHZOWeRzy64sSFr+xJ5OX7LI3b4MPQzdL4H8Y8M0xzPpsVMwA8Q==" },
  { name: "globalthis", version: "1.0.4", tarballBytes: 8504, integrity: "sha512-DpLKbNU4WylpxJykQujfCcwYWiV/Jhm50Goo0wrVILAv5jOr9d+H+UR3PhSCD2rCCEIg0uc+G+muBTwD54JhDQ==" },
  { name: "gopd", version: "1.2.0", tarballBytes: 4584, integrity: "sha512-ZUKRh6/kUFoAiTAtTYPZJ3hw9wNxx+BIBOijnlG9PnrJsCcSjs1wyyD6vJpaYtgnzDrKYRSqf3OO6Rfa93xsRg==" },
  { name: "has-property-descriptors", version: "1.0.2", tarballBytes: 4429, integrity: "sha512-55JNKuIW+vq4Ke1BjOTjM2YctQIvCT7GFzHwmfZPGo5wnrgkid0YQtnAleFSqumZm4az3n2BS+erby5ipJdgrg==" },
  { name: "json-stringify-safe", version: "5.0.1", tarballBytes: 4014, integrity: "sha512-ZClg6AaYvamvYEE82d3Iyd3vSSIjQ+odgjaTzRuO3s7toCdFKczob2i0zCh7JE8kWn17yvAWhUVxvqGwUalsRA==" },
  { name: "matcher", version: "3.0.0", tarballBytes: 3357, integrity: "sha512-OkeDaAZ/bQCxeFAozM55PKcKU0yJMPGifLwV4Qgjitu+5MoAfSQN4lsLJeXZ1b8w0x+/Emda6MZgXS1jvsapng==" },
  { name: "minipass", version: "7.1.3", tarballBytes: 83605, integrity: "sha512-tEBHqDnIoM/1rXME1zgka9g6Q2lcoCkxHLuc7ODJ5BxbP5d4c2Z5cGgtXAku59200Cx7diuHTOYfSBD8n6mm8A==" },
  { name: "minizlib", version: "3.1.0", tarballBytes: 18461, integrity: "sha512-KZxYo1BUkWD2TVFLr0MQoM8vUUigWD3LlD83a/75BqC+4qE0Hb1Vo5v1FgcfaNXvfXzr+5EhQ6ing/CaBijTlw==" },
  { name: "object-keys", version: "1.1.1", tarballBytes: 7677, integrity: "sha512-NuAESUOUMrlIXOfHKzD6bpPu3tYt3xvjNdRIQ+FeT0lNb4K8WR70CaDxhuNguS2XG+GjkyMwOzsN5ZktImfhLA==" },
  { name: "onnxruntime-common", version: "1.21.0", tarballBytes: 64246, integrity: "sha512-Q632iLLrtCAVOTO65dh2+mNbQir/QNTVBG3h/QdZBpns7mZ0RYbLRBgGABPbpU9351AgYy7SJf1WaeVwMrBFPQ==" },
  { name: "onnxruntime-node", version: "1.21.0", tarballBytes: 80019455, integrity: "sha512-NeaCX6WW2L8cRCSqy3bInlo5ojjQqu2fD3D+9W5qb5irwxhEyWKXeH2vZ8W9r6VxaMPUan+4/7NDwZMtouZxEw==" },
  { name: "roarr", version: "2.15.4", tarballBytes: 17325, integrity: "sha512-CHhPh+UNHD2GTXNYhPWLnU8ONHdI+5DI+4EYIAOaiD63rHeYlZvyh8P+in5999TTSFgUYuKUAjzRI4mdh/p+2A==" },
  { name: "semver", version: "7.7.4", tarballBytes: 28442, integrity: "sha512-vFKC2IEtQnVhpT78h1Yp8wzwrf8CM+MzKMHGJZfBtzhZNycRFnXsHk6E5TxIkkMsgNS7mdX3AGB7x2QM2di4lA==" },
  { name: "semver-compare", version: "1.0.0", tarballBytes: 2003, integrity: "sha512-YM3/ITh2MJ5MtzaM429anh+x2jiLVjqILF4m4oyQB18W7Ggea7BfqdH/wGMK7dDiMghv/6WG7znWMwUDzJiXow==" },
  { name: "serialize-error", version: "7.0.1", tarballBytes: 2756, integrity: "sha512-8I8TjW5KMOKsZQTvoxjuSIa7foAwPWGOts+6o7sgjz41/qMD9VQHEDxi6PBvK2l0MXUmqZyNpUK+T2tQaaElvw==" },
  { name: "sprintf-js", version: "1.1.3", tarballBytes: 10968, integrity: "sha512-Oo+0REFV59/rz3gfJNKQiBlwfHaSESl1pcGyABQsnnIfWOFt6JNj5gCog2U6MLZ//IGYD+nA8nI+mTShREReaA==" },
  { name: "tar", version: "7.5.22", tarballBytes: 471090, integrity: "sha512-MFO/QzvtAOmJbkhOaCTvbGcFN9L9b+JunIsDwaKljSOdcLMea3NJ1k9Usz/rjdfSXTq4dfzfeS7W4p4YOAAHeA==" },
  { name: "type-fest", version: "0.13.1", tarballBytes: 30612, integrity: "sha512-34R7HTnG0XIJcBSn5XhDd7nNFPRcXYRZrBB2O2jdKqYODldSzBAqzsWoZYYvduky73toYS/ESqxPvkDf/F0XMg==" },
  { name: "yallist", version: "5.0.0", tarballBytes: 9821, integrity: "sha512-YgvUTfwqyc7UXVMrB+SImsVYSmTS8X/tSrtdNZMImM+n7+QTriRXyXim0mBrTXNeqzVF0KWGgHPeiyViFFrNDw==" },
];

export const LOCAL_THINKING_RUNTIME_TOTAL_BYTES = 91429010;

const RUNTIME_REGISTRIES = [
  "https://registry.npmmirror.com",
  "https://registry.npmjs.org",
] as const;

export function runtimePackageRegistries(): readonly string[] {
  return RUNTIME_REGISTRIES;
}

export function runtimeTarballUrl(registry: string, pkg: LocalThinkingRuntimePackage): string {
  const baseName = pkg.name.startsWith("@") ? pkg.name.slice(pkg.name.indexOf("/") + 1) : pkg.name;
  return `${registry}/${pkg.name}/-/${baseName}-${pkg.version}.tgz`;
}

// 决定 tarball 内条目（路径形如 package/...）是否需要落到磁盘。
// transformers 只保留运行时入口 dist/；onnxruntime-node 只保留当前平台+架构的原生库，剔除 DirectML.dll。
export function runtimePackageEntryIncluded(
  name: string,
  entryPath: string,
  platform: NodeJS.Platform,
  arch: string,
): boolean {
  if (!entryPath.startsWith("package/")) return false;
  if (entryPath.includes("..")) return false;
  if (name === "@huggingface/transformers") {
    return (
      entryPath === "package/package.json" ||
      entryPath === "package/LICENSE" ||
      entryPath.startsWith("package/dist/")
    );
  }
  if (name === "onnxruntime-node") {
    if (entryPath === "package/package.json" || entryPath === "package/LICENSE") return true;
    if (entryPath.startsWith("package/dist/")) return true;
    if (!entryPath.startsWith(`package/bin/napi-v3/${platform}/${arch}/`)) return false;
    return !entryPath.endsWith("/DirectML.dll");
  }
  return true;
}
