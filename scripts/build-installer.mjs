#!/usr/bin/env node
// 构建扩展包安装器（NSIS）—— 运行时版。
//
// 路线 A 定稿：安装包只含运行时（manifest + bin + node_modules），**不含音色库**。
// 音色库由用户装好后，在桌宠设置里一键下载（voices/<id>/），或手动放置。
// 所以这个安装包只有 ~15MB。
//
// 需要 makensis。优先 NSIS_MAKENSIS；其次 PATH；最后复用 electron-builder 缓存。

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8"));
const version = process.argv[2] || pkg.version;

function findMakensis() {
    const explicit = process.env.NSIS_MAKENSIS;
    if (explicit && fs.existsSync(explicit)) return explicit;
    const which = spawnSync("where", ["makensis.exe"], { encoding: "utf-8" });
    if (which.status === 0) {
        const first = String(which.stdout).split(/\r?\n/).find(Boolean);
        if (first) return first.trim();
    }
    const cacheRoot = path.join(os.homedir(), "AppData", "Local", "electron-builder", "Cache");
    if (fs.existsSync(cacheRoot)) {
        for (const dir of fs.readdirSync(cacheRoot)) {
            if (!dir.startsWith("nsis-")) continue;
            const base = path.join(cacheRoot, dir);
            for (const sub of fs.readdirSync(base)) {
                const candidate = path.join(base, sub, "makensis.exe");
                if (fs.existsSync(candidate)) return candidate;
            }
        }
    }
    return null;
}

const makensis = findMakensis();
if (!makensis) {
    console.error("找不到 makensis。装一个 NSIS，或设置 NSIS_MAKENSIS 指向 makensis.exe。");
    process.exit(1);
}
console.log("makensis:", makensis);

// 发布前自检：运行时齐全（音色库按需下载，不检查 models/voices）
const required = [
    "manifest.json",
    "package.json",
    "bin/server.cjs",
    path.join("node_modules", "sherpa-onnx-node"),
];
for (const rel of required) {
    if (!fs.existsSync(path.join(ROOT, rel))) {
        console.error("缺少 " + rel + "，先跑 npm install。");
        process.exit(1);
    }
}

const script = path.join(ROOT, "installer", "installer.nsi");
fs.mkdirSync(path.join(ROOT, "release"), { recursive: true });

const res = spawnSync(makensis, ["/DAPP_VERSION=" + version, script], {
    cwd: ROOT,
    stdio: "inherit",
});
if (res.status !== 0) process.exit(res.status || 1);

const out = path.join(ROOT, "release", "kirari-voice-pack-aishell3-setup-" + version + ".exe");
if (!fs.existsSync(out)) {
    console.error("构建返回成功但没找到产物：" + out);
    process.exit(1);
}
console.log("安装包：" + out);
console.log("大小：" + (fs.statSync(out).size / 1024 / 1024).toFixed(1) + " MB");
