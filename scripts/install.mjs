#!/usr/bin/env node
// 一键安装语音扩展包。
//
// 用法：
//   node scripts/install.mjs                      # 装到本机 ~/.kirari/extensions/（桌宠端或核心版本机）
//   node scripts/install.mjs --docker <容器名>    # 装进 Docker 容器的 /data/extensions/（核心版容器）
//   node scripts/install.mjs --target <目录>      # 装到指定 extensions 根目录（高级用法）
//
// 做的事：
//   1. 按目标平台准备 node_modules（容器是 Linux；sherpa-onnx 原生库按平台装）
//   2. 打包 manifest + package.json + bin + node_modules
//   3. 落位到目标 extensions/<pack-id>/（已存在则询问覆盖）
//   4. --docker 模式：docker cp 进容器 + 重启，并打印验证命令
//   5. 本机模式装完跑 selftest

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as readline from "node:readline";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PACK_ID = "com.akisaki.voice.aishell3";

// ── 参数 ──
const args = process.argv.slice(2);
let mode = "local";
let dockerContainer = null;
let targetRoot = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--docker") {
    mode = "docker";
    dockerContainer = args[++i] || null;
    if (!dockerContainer) die("--docker 需要容器名");
  } else if (args[i] === "--target") {
    targetRoot = args[++i] || null;
  } else if (args[i] === "--help" || args[i] === "-h") {
    console.log("用法见文件头注释");
    process.exit(0);
  }
}

// ── 工具 ──
const log = (...a) => console.log("[install]", ...a);
const die = (msg) => { console.error("[install] X", msg); process.exit(1); };

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (ans) => { rl.close(); resolve(/^y(es)?$/i.test(ans.trim())); });
  });
}

/** sherpa-onnx 平台目录名。 */
function platformDir(platform, arch) {
  if (platform === "win32" && arch === "x64") return "sherpa-onnx-win-x64";
  if (platform === "linux" && arch === "x64") return "sherpa-onnx-linux-x64";
  if (platform === "linux" && arch === "arm64") return "sherpa-onnx-linux-arm64";
  if (platform === "darwin") return arch === "arm64" ? "sherpa-onnx-osx-arm64" : "sherpa-onnx-osx-x64";
  return "sherpa-onnx-" + platform + "-" + arch;
}

/** 当前 node_modules 的原生库平台是否匹配目标。 */
function nodeModulesMatches(targetPlatform) {
  const dir = path.join(ROOT, "node_modules");
  if (!fs.existsSync(dir)) return false;
  const hit = fs.readdirSync(dir).find((d) => d.startsWith("sherpa-onnx-"));
  if (!hit) return false;
  return hit === platformDir(targetPlatform, process.arch);
}

/** 准备依赖。container=true 时强制按 linux/x64 目标重装。 */
function prepareNodeModules(targetPlatform, forContainer) {
  const nm = path.join(ROOT, "node_modules");
  if (fs.existsSync(nm) && !forContainer && nodeModulesMatches(targetPlatform)) {
    log("node_modules 平台匹配，跳过重装");
    return;
  }
  if (forContainer) {
    log("容器模式：按 linux/x64 目标重装依赖…");
    fs.rmSync(nm, { recursive: true, force: true });
    const r = spawnSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund",
      "--target_platform=linux", "--target_arch=x64"], { cwd: ROOT, stdio: "inherit", shell: true });
    if (r.status !== 0) die("npm install（Linux 目标）失败");
    return;
  }
  log("安装依赖…");
  const r = spawnSync("npm", ["install", "--omit=dev", "--no-audit", "--no-fund"],
    { cwd: ROOT, stdio: "inherit", shell: true });
  if (r.status !== 0) die("npm install 失败");
}

function buildArchive() {
  const out = path.join(os.tmpdir(), "kirari-voice-pack-" + Date.now() + ".tar.gz");
  log("打包 -> " + out);
  const r = spawnSync("tar", ["-czf", out, "manifest.json", "package.json", "bin", "node_modules"],
    { cwd: ROOT, stdio: "inherit", shell: true });
  if (r.status !== 0) die("打包失败");
  return out;
}

// ── 本机安装 ──
async function installLocal(extensionsRoot) {
  prepareNodeModules(process.platform, false);
  const dest = path.join(extensionsRoot, PACK_ID);
  if (fs.existsSync(dest)) {
    const ok = await ask("目标已存在 " + dest + "，覆盖？[y/N] ");
    if (!ok) die("已取消");
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.mkdirSync(dest, { recursive: true });
  log("落位…");
  for (const item of ["manifest.json", "package.json", "bin", "node_modules"]) {
    fs.cpSync(path.join(ROOT, item), path.join(dest, item), { recursive: true });
  }
  log("已安装到 " + dest);
  log("运行 selftest 验证…");
  const r = spawnSync("node", ["scripts/selftest.mjs"], { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) console.warn("[install] selftest 未通过，看上面输出定位");
  console.log("");
  log("完成。重启 Kirari 后生效，设置里会出现「语音」页。");
}

// ── 容器安装 ──
function installDocker(container) {
  const probe = spawnSync("docker", ["version", "--format", "ok"], { shell: true, encoding: "utf-8" });
  if (probe.status !== 0) die("docker 不可用：" + (probe.stderr || "daemon 未启动？"));
  const inspect = spawnSync("docker", ["inspect", "-f", "{{" + "." + "State" + "." + "Running}}", container], { shell: true, encoding: "utf-8" });
  if (inspect.status !== 0) die("容器不存在：" + container);
  if (!String(inspect.stdout).includes("true")) die("容器未在运行：" + container);

  // 容器内数据根
  const envOut = spawnSync("docker", ["exec", container, "sh", "-c", "echo $PET_API_DATA_DIR"], { encoding: "utf-8" });
  const dataRoot = String(envOut.stdout).trim() || "/data";
  const dest = dataRoot + "/extensions/" + PACK_ID;
  log("容器数据根 = " + dataRoot + "；目标 = " + dest);

  prepareNodeModules("linux", true);
  const archive = buildArchive();

  log("docker cp -> 容器…");
  const cp = spawnSync("docker", ["cp", archive, container + ":/tmp/voice-pack.tar.gz"], { stdio: "inherit", shell: true });
  if (cp.status !== 0) die("docker cp 失败");

  log("容器内安装（脚本会校验 manifest 与平台）…");
  const untar = spawnSync("docker", ["exec", container, "node", "/app/scripts/ext-install.cjs", "install", "/tmp/voice-pack.tar.gz"],
    { stdio: "inherit", shell: true });
  if (untar.status !== 0) die("容器内安装失败");

  log("确认包状态…");
  spawnSync("docker", ["exec", container, "node", "/app/scripts/ext-install.cjs", "status", PACK_ID],
    { stdio: "inherit", shell: true });

  log("重启容器…");
  const restart = spawnSync("docker", ["restart", container], { stdio: "inherit", shell: true });
  if (restart.status !== 0) die("docker restart 失败");

  console.log("");
  log("完成。验证：");
  console.log("  docker logs " + container + " 2>&1 | grep ext");
  console.log("  curl -H \"X-Admin-Token: xxx\" http://localhost:9089/api/extensions/voices");
  console.log("");
  log("音色库（30MB）用 HTTP 端点下载，或 docker cp 进 voices/。");
}

// ── 入口 ──
if (mode === "docker") {
  installDocker(dockerContainer);
} else {
  const envHome = process.env.KIRARI_HOME;
  const root = targetRoot || envHome || path.join(os.homedir(), ".kirari");
  log("目标 extensions 根 = " + path.join(root, "extensions"));
  installLocal(path.join(root, "extensions"));
}
