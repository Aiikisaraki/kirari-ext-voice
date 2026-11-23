#!/usr/bin/env node
// kirari-ext-install —— 容器内扩展包安装/管理脚本。
//
// 这个脚本被 COPY 进镜像（/app/scripts/ext-install.cjs），在**容器内**执行：
//   docker exec pet-api node /app/scripts/ext-install.cjs list
//   docker exec pet-api node /app/scripts/ext-install.cjs install <tar.gz>
//   docker exec pet-api node /app/scripts/ext-install.cjs remove <packId>
//   docker exec pet-api node /app/scripts/ext-install.cjs status
//
// 为什么要有它：扩展包装在数据卷（/data/extensions/），宿主侧 docker cp 后
// 还要 chown/重启/验证，命令又长又容易漏。这个脚本把这些固定下来，
// 也让「核心版装扩展」和「桌宠端装扩展」的操作体验对齐。
//
// 设计约束：
//   · 只依赖 Node 内置模块（容器内零额外安装）
//   · install 解压前校验包结构（manifest 存在且合法、bin/server.cjs 存在），
//     坏包拒绝落地 —— 这是防「拷了个垃圾文件进卷」的唯一闸门
//   · 落位用「临时目录 + 原子改名」，中断不会留半个包
//   · 装完不自动重启服务：扩展宿主只在启动时扫描，提示用户 docker restart
//     （自动重启对 exec 环境太激进，杀掉正在回复的对话不好）

"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const PACK_ROOT = process.env.PET_API_DATA_DIR || "/data";
const EXT_ROOT = path.join(PACK_ROOT, "extensions");
const API = 1;

function log(...a) { console.log("[ext-install]", ...a); }
function die(msg) { console.error("[ext-install] X", msg); process.exit(1); }

/** manifest 校验：与两端宿主同一套规则（JS 精简版）。非法即拒绝。 */
function parseManifest(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("manifest 必须是 JSON 对象");
  const id = String(raw.id || "");
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/.test(id)) throw new Error("id 不合法: " + id);
  if (!/^\d+\.\d+\.\d+/.test(String(raw.version || ""))) throw new Error("版本号不是 semver");
  const apiVersion = Number(raw.apiVersion);
  if (!Number.isFinite(apiVersion) || apiVersion > API) throw new Error("apiVersion 不支持: " + raw.apiVersion);
  const engine = raw.engine || {};
  if (engine.runtime !== "sidecar") throw new Error("runtime 必须是 sidecar");
  if (engine.protocol !== "jsonrpc-stdio@1") throw new Error("protocol 必须是 jsonrpc-stdio@1");
  const command = String(engine.command || "");
  if (!command || path.isAbsolute(command) || command.includes("..")) throw new Error("engine.command 非法");
  if (!Array.isArray(raw.contributions) || !raw.contributions.length) throw new Error("缺少 contributions");
  return raw;
}

function cmdList() {
  if (!fs.existsSync(EXT_ROOT)) { log("扩展目录为空:", EXT_ROOT); return; }
  const packs = fs.readdirSync(EXT_ROOT, { withFileTypes: true }).filter((e) => e.isDirectory());
  if (!packs.length) { log("未安装任何扩展包"); return; }
  for (const p of packs) {
    const dir = path.join(EXT_ROOT, p.name);
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf-8"));
      const services = (m.contributions || []).filter((c) => c.type === "service").map((c) => c.id);
      log(p.name, "  v" + m.version, "  services: " + (services.join(", ") || "(无)"));
    } catch (e) {
      log(p.name, "  (manifest 不可读: " + e.message + ")");
    }
  }
}

function cmdStatus(packId) {
  const dir = path.join(EXT_ROOT, packId);
  if (!fs.existsSync(dir)) die("未安装: " + packId);
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf-8"));
    log("packId:", m.id);
    log("version:", m.version);
    log("apiVersion:", m.apiVersion, "/ 宿主支持:", API);
    log("engine:", m.engine.runtime, m.engine.protocol, "launch=" + (m.engine.launch || "binary"));
    const nm = path.join(dir, "node_modules");
    const plat = fs.readdirSync(nm).find((d) => d.startsWith("sherpa-onnx-"));
    log("原生库平台:", plat || "(无 sherpa-onnx)");
    if (plat && !plat.includes("linux")) {
      console.error("[ext-install] ⚠ 原生库不是 linux 版 —— 这个包在容器里跑不起来！");
      console.error("[ext-install]   请在 Linux 上执行 npm install 后重新打包，或用 install.mjs --docker。");
      process.exitCode = 2;
    }
    const voices = path.join(dir, "voices");
    if (fs.existsSync(voices)) {
      const libs = fs.readdirSync(voices, { withFileTypes: true }).filter((e) => e.isDirectory());
      log("音色库:", libs.length ? libs.map((l) => l.name).join(", ") : "(未下载)");
    } else {
      log("音色库: (未下载)");
    }
  } catch (e) {
    die("读取失败: " + e.message);
  }
}

/** 解压 tar.gz 到临时目录并校验包结构，通过后原子改名为正式目录。 */
function cmdInstall(archivePath) {
  if (!fs.existsSync(archivePath)) die("找不到包: " + archivePath);
  const tmp = EXT_ROOT + "/.tmp-install-" + Date.now();
  fs.mkdirSync(tmp, { recursive: true });
  try {
    log("解压…");
    const r = spawnSync("tar", ["-xzf", archivePath, "-C", tmp], { stdio: "inherit" });
    if (r.status !== 0) die("解压失败（exit " + r.status + "）");

    // 包内可能带一层目录（打包方式不同），归一化到含 manifest.json 的那层
    let root = tmp;
    if (!fs.existsSync(path.join(root, "manifest.json"))) {
      const subs = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory());
      const hit = subs.find((s) => fs.existsSync(path.join(root, s.name, "manifest.json")));
      if (!hit) die("包里找不到 manifest.json —— 不是合法的扩展包");
      root = path.join(root, hit.name);
    }

    // 校验
    let manifest;
    try {
      manifest = parseManifest(JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf-8")));
    } catch (e) {
      die("manifest 校验失败: " + e.message);
    }
    if (!fs.existsSync(path.join(root, "bin", "server.cjs"))) {
      die("包里缺 bin/server.cjs（sidecar 入口）");
    }
    if (!fs.existsSync(path.join(root, "node_modules"))) {
      console.error("[ext-install] ⚠ 包里没有 node_modules —— 装上后大概率跑不起来。");
      console.error("[ext-install]   请确认打包时包含了 npm install --omit=dev 的产物。");
      process.exitCode = 2;
    }

    // 原子落位
    const dest = path.join(EXT_ROOT, manifest.id);
    if (fs.existsSync(dest)) {
      log("覆盖已存在的包:", manifest.id);
      fs.rmSync(dest, { recursive: true, force: true });
    }
    fs.renameSync(root, dest);
    fs.rmSync(tmp, { recursive: true, force: true });
    log("已安装:", manifest.id + "@v" + manifest.version);
    log("重启服务后生效:  docker restart $(hostname)   （或在宿主机 docker restart pet-api）");
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    die(e.message);
  }
}

function cmdRemove(packId) {
  if (!/^[a-z0-9][a-z0-9._-]{2,63}$/i.test(packId)) die("packId 非法");
  const dir = path.join(EXT_ROOT, packId);
  if (!fs.existsSync(dir)) die("未安装: " + packId);
  fs.rmSync(dir, { recursive: true, force: true });
  log("已删除:", packId, "（重启服务后宿主不再加载）");
}

function usage() {
  console.log([
    "用法: node ext-install.cjs <命令>",
    "",
    "  list                  列出已安装的扩展包",
    "  status <packId>       查看包详情（含平台检查）",
    "  install <tar.gz>      安装一个扩展包（校验后原子落位）",
    "  remove <packId>       删除扩展包",
    "",
    "环境: EXT_ROOT = " + EXT_ROOT,
  ].join("\n"));
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "list") cmdList();
else if (cmd === "status") cmdStatus(arg || die("缺少 packId"));
else if (cmd === "install") cmdInstall(arg || die("缺少 tar.gz 路径"));
else if (cmd === "remove") cmdRemove(arg || die("缺少 packId"));
else usage();
