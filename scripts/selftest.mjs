#!/usr/bin/env node
// 扩展包自测：不经过桌宠，直接按宿主协议跑一遍握手 → 列音色 → 合成。
// 用法：node scripts/selftest.mjs ["要念的文字"]

import { spawn } from "node:child_process";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "..", "bin", "server.cjs");
const TEXT = process.argv[2] || "你好呀，我是绮莉。今天的天气看起来很舒服呢。";

const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"] });
let buf = "";
const pending = new Map();
let seq = 0;

child.stdout.setEncoding("utf-8");
child.stderr.setEncoding("utf-8");
child.stderr.on("data", (c) => process.stderr.write("[server] " + c));
child.stdout.on("data", (chunk) => {
    buf += chunk;
    let i = buf.indexOf("\n");
    while (i >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (line) {
            const msg = JSON.parse(line);
            const r = pending.get(msg.id);
            if (r) {
                pending.delete(msg.id);
                msg.error ? r.reject(new Error(msg.error.message)) : r.resolve(msg.result);
            }
        }
        i = buf.indexOf("\n");
    }
});

function call(method, params) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
        setTimeout(() => {
            if (pending.has(id)) {
                pending.delete(id);
                reject(new Error("超时：" + method));
            }
        }, 30000);
    });
}

const t0 = Date.now();
await call("host.hello", { apiVersion: 1, hostName: "kirari-desktop", hostVersion: "selftest" });
console.log("1) 握手 OK");

const voices = await call("service.call", { serviceId: "speech.tts", method: "listVoices", params: { args: [] } });
console.log("2) 音色 " + voices.voices.length + " 个：");
for (const v of voices.voices.slice(0, 8)) console.log("   - " + v.id + " | " + v.label + " | " + (v.language || "?"));
if (!voices.voices.length) throw new Error("没有任何音色，无法继续");

// 优先挑中文音色
const zh = voices.voices.find((v) => String(v.language || "").toLowerCase().startsWith("zh")) || voices.voices[0];
const audio = await call("service.call", {
    serviceId: "speech.tts",
    method: "synthesize",
    params: { args: [{ text: TEXT, voiceId: zh.id, format: "wav" }] },
});
const b64 = String(audio.dataUrl || "").split(",")[1] || "";
const bytes = Buffer.from(b64, "base64");
console.log("3) 合成 OK");
console.log("   音色：" + zh.id);
console.log("   时长：" + audio.durationMs + "ms");
console.log("   音频：" + bytes.length + " 字节（WAV 头：" + bytes.toString("ascii", 0, 4) + "/" + bytes.toString("ascii", 8, 12) + "）");
console.log("   耗时：" + (Date.now() - t0) + "ms");

// 落盘一份给耳朵验收
import * as fs from "node:fs";
const out = path.join(HERE, "..", "selftest.wav");
fs.writeFileSync(out, bytes);
console.log("4) 已写出 " + out);

await call("host.dispose", null);
console.log("5) 退出 OK");
