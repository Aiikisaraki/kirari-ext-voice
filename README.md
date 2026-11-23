# kirari-ext-voice

Kirari 语音扩展包：中文 VITS 语音合成（AISHELL3，174 音色），完全离线。

## 快速开始

| 环境 | 命令 |
| --- | --- |
| 桌宠端 / 核心版本机 | `npm run ext:install`（或 `node scripts/install.mjs`） |
| 核心版 Docker 容器 | `npm run ext:install:docker -- --docker pet-api` 或 `node scripts/install.mjs --docker pet-api` |

详细步骤、容器内脚本、常见问题 → [docs/INSTALL.md](docs/INSTALL.md)。

## 结构

    bin/server.cjs          sidecar 入口（JSON-RPC over stdio，宿主 host-node 模式拉起）
    scripts/install.mjs     一键安装（本机 / 容器两种模式）
    scripts/ext-install.cjs 容器内管理脚本（镜像自带，宿主机不直接用）
    scripts/selftest.mjs    端到端自测（握手 → 列音色 → 合成）
    scripts/build-installer.mjs  NSIS 安装包（运行时，~6MB）
    voices.catalog.json     音色库清单（两端共享的单一事实源）
    voices/                 音色库存放处（安装后按需下载或手动放置）

## 文档

- docs/INSTALL.md — 安装指南（三环境）
- docs/voices-design.md — 音色库管理设计
- docs/mcp-apps-spec.md — MCP Apps 规范存档（路线 B 调研遗留，未采用）
