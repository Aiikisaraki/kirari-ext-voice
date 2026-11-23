# Kirari 语音扩展包 · 音色库管理

> 本包 = sherpa-onnx 运行时（安装器内置）+ 音色库（按需下载或手动放置）。

## 目录约定（两端一致）

    <pack-dir>/                      ← 独立安装包装到这里
      manifest.json
      bin/server.cjs                 ← sidecar
      node_modules/                  ← sherpa-onnx-node（内置）
      voices/                        ← 音色库根目录（**可写**；models/ 已废弃）
        aishell3/                    ← 一个音色库 = 一个子目录
          model.onnx
          speakers.txt               ← 可选：一行一个说话人名
          lexicon.txt                ← 可选
          tokens.txt                 ← 必需
          date.fst / number.fst ...  ← 可选（文本规范化）
        huayan/                      ← 手动放置的库也放这里，目录名随意
          ...

## 音色库来源（两种，结果等价）

### A. 包内下载器（推荐）

安装器只带运行时（~15MB）。用户在设置里点"下载音色库"：
  · 内置清单：aishell3（30.1MB，174 音色）、huayan（64.1MB，单音色）
  · 下载 URL 走 GitHub releases，国内自动回退 hf-mirror.com
  · 下载到 voices/<id>/.tmp-*，校验解压成功后原子改名
  · 已存在的库显示"已安装"，可删除、可重下

### B. 手动放置

用户自己下载 tar.bz2 / 已解压目录，丢进 voices/<随便起的名字>/ 即可。
sidecar 扫描 voices/ 下所有含 tokens.txt 的子目录，每个都注册为可用音色库。
（tar.bz2 不自动解压：手动放置请先解压，或者干脆用 A 方案。）

## sidecar 协议增量

listVoices 返回结构变为：
  { voices: [...], libs: [{ id, name, speakerCount, source: "builtin"|"manual" }] }
synthesize 的 voiceId 支持 "sid:N"（当前激活库）与 "<libId>:sid:N"（指定库）。

## 宿主增量（两端）

桌宠端：设置页「语音」区块 → 音色库列表 + 下载/删除按钮 + 打开目录按钮。
核心版：consoleRoutes 增加 GET /api/extensions/voices 等只读端点 +
  POST /api/extensions/voices/<id>/download（走同一个下载器模块）。
下载器两端各一份实现（TS / JS），逻辑一致、清单共享（voices.catalog.json）。
