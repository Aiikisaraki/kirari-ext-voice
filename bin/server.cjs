"use strict";

// Kirari 扩展包 · 中文语音合成（VITS，多音色库）
//
// 契约见 ../docs/extensions/README.md；音色库管理见 voices-design.md。
//
// 关键设计：
//   · 音色库放在 <pack>/voices/<libId>/，sidecar 启动时扫描，不缓存目录状态 ——
//     用户手动丢一个目录进来，下次 listVoices 就能看到（不需要重启桌宠）。
//   · 每个 lib 一个懒加载的 tts 实例（模型加载要 1~2 秒 + 常驻内存，
//     用户没用到哪个库就不加载哪个）。
//   · voiceId 支持 "<libId>:sid:N" 与 "sid:N"（省略 libId = 第一个可用库）。
//
// 铁律：日志只能写 stderr。

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const PACK_DIR = path.resolve(__dirname, "..");
const VOICES_DIR = path.join(PACK_DIR, "voices");

/** 已加载的 tts 实例：libId -> OfflineTts */
const engines = new Map();
/** 加载失败的库：libId -> 错误消息（避免每次合成都重试一个坏模型） */
const failedLibs = new Map();

function log() {
    console.error("[voice-vits]", ...arguments);
}

/** 扫描 voices/ 下所有含 tokens.txt 的子目录。每次调用都重新扫，不缓存。 */
function scanLibs() {
    if (!fs.existsSync(VOICES_DIR)) return [];
    const out = [];
    for (const e of fs.readdirSync(VOICES_DIR, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const dir = path.join(VOICES_DIR, e.name);
        const files = fs.readdirSync(dir);
        if (!files.some((f) => f.endsWith(".onnx"))) continue;
        if (!files.includes("tokens.txt")) {
            log("跳过 " + e.name + "：缺 tokens.txt");
            continue;
        }
        const speakersFile = path.join(dir, "speakers.txt");
        let speakers = null;
        try {
            speakers = fs.readFileSync(speakersFile, "utf-8")
                .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        } catch { /* 没有清单就按单音色处理 */ }
        out.push({ id: e.name, dir, speakers: speakers && speakers.length ? speakers : null });
    }
    return out;
}

function pick(dir, suffix) {
    return fs.readdirSync(dir).find((f) => f.endsWith(suffix)) || "";
}

/** 懒加载某个库的引擎。失败会记住原因，下次直接抛。 */
function getEngine(lib) {
    if (engines.has(lib.id)) return engines.get(lib.id);
    if (failedLibs.has(lib.id)) throw new Error(failedLibs.get(lib.id));

    let sherpa;
    try {
        sherpa = require("sherpa-onnx-node");
    } catch (e) {
        const msg = "加载 sherpa-onnx-node 失败：" + (e && e.message);
        failedLibs.set(lib.id, msg);
        throw new Error(msg);
    }

    const ruleFsts = ["date.fst", "number.fst", "phone.fst", "new_heteronym.fst"]
        .map((f) => path.join(lib.dir, f))
        .filter((p) => fs.existsSync(p))
        .join(",");
    // rule.far（180MB）sherpa-onnx-node 1.12.27 加载会报 "Please check your config!"，
    // 且 FST 已覆盖日期/数字/电话的规范化 —— 不加它，省内存也避开这个坑。

    log("加载音色库 " + lib.id + "…");
    const t0 = Date.now();
    const tts = new sherpa.OfflineTts({
        model: {
            vits: {
                model: path.join(lib.dir, pick(lib.dir, ".onnx")),
                tokens: path.join(lib.dir, "tokens.txt"),
                ...(fs.existsSync(path.join(lib.dir, "lexicon.txt"))
                    ? { lexicon: path.join(lib.dir, "lexicon.txt") } : {}),
            },
            numThreads: Math.max(1, Math.min(4, require("os").cpus().length - 1)),
            debug: false,
            provider: "cpu",
        },
        maxNumSentences: 1,
        ...(ruleFsts ? { ruleFsts } : {}),
    });
    log("音色库 " + lib.id + " 就绪，耗时 " + (Date.now() - t0) + "ms");
    engines.set(lib.id, tts);
    return tts;
}

function encodeWav(samples, sampleRate) {
    const n = samples.length;
    const buf = Buffer.alloc(44 + n * 2);
    buf.write("RIFF", 0, "ascii");
    buf.writeUInt32LE(36 + n * 2, 4);
    buf.write("WAVE", 8, "ascii");
    buf.write("fmt ", 12, "ascii");
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(1, 22);
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * 2, 28);
    buf.writeUInt16LE(2, 32);
    buf.writeUInt16LE(16, 34);
    buf.write("data", 36, "ascii");
    buf.writeUInt32LE(n * 2, 40);
    for (let i = 0; i < n; i++) {
        let v = samples[i];
        if (v > 1) v = 1; else if (v < -1) v = -1;
        buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
    }
    return buf;
}

/** voiceId -> { lib, sid }。支持 "<lib>:sid:N" / "sid:N"（省略 lib = 第一个库）。 */
function resolveVoice(voiceId, libs) {
    const raw = String(voiceId || "").trim();
    if (!libs.length) throw new Error("没有任何音色库（voices/ 目录为空或未下载）");
    let libId = null;
    let sidPart = raw;
    const colon = raw.indexOf(":");
    if (colon > 0 && !raw.startsWith("sid:")) {
        libId = raw.slice(0, colon);
        sidPart = raw.slice(colon + 1);
    }
    const lib = libId ? libs.find((l) => l.id === libId) : libs[0];
    if (!lib) throw new Error("音色库不存在：" + libId);
    const m = /(\d+)\s*$/.exec(sidPart);
    const count = lib.speakers ? lib.speakers.length : 1;
    const sid = m ? Math.max(0, Math.min(count - 1, Math.floor(Number(m[1])))) : 0;
    return { lib, sid };
}

function listVoices() {
    const libs = scanLibs();
    const voices = [];
    const libInfos = [];
    for (const lib of libs) {
        const count = lib.speakers ? lib.speakers.length : 1;
        libInfos.push({ id: lib.id, speakerCount: count });
        for (let sid = 0; sid < count; sid++) {
            voices.push({
                id: lib.id + ":sid:" + sid,
                label: (lib.speakers ? lib.speakers[sid] : "音色 " + (sid + 1)) + "（" + lib.id + "）",
                language: "zh-CN",
            });
        }
    }
    return { voices, libs: libInfos };
}

function synthesize(args0) {
    const req = args0 && typeof args0 === "object" ? args0 : {};
    const text = String(req.text || "").trim();
    if (!text) throw new Error("text 为空");
    const MAX_CHARS = 600;
    const clipped = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text;

    const libs = scanLibs();
    const { lib, sid } = resolveVoice(req.voiceId, libs);
    const engine = getEngine(lib);
    const speed = Number(req.speed) > 0 ? Number(req.speed) : 1;
    const t0 = Date.now();
    const audio = engine.generate({ text: clipped, sid, speed });
    const durationMs = Math.round((audio.samples.length / audio.sampleRate) * 1000);
    log("合成 lib=" + lib.id + " sid=" + sid + " 时长=" + durationMs + "ms 耗时=" + (Date.now() - t0) + "ms");
    return {
        dataUrl: "data:audio/wav;base64," + encodeWav(audio.samples, audio.sampleRate).toString("base64"),
        format: "wav",
        durationMs,
    };
}

// ── JSON-RPC over stdio ────────────────────────────────────────────────────
function send(msg) { process.stdout.write(JSON.stringify(msg) + "\n"); }
function reply(id, result) { send({ jsonrpc: "2.0", id, result }); }
function replyError(id, message) { send({ jsonrpc: "2.0", id, error: { code: -32000, message: String(message || "unknown") } }); }

let disposed = false;
let buffer = "";

async function handleLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { log("忽略非 JSON 输入"); return; }
    const { id, method, params } = msg || {};
    try {
        if (method === "host.hello") {
            log("握手 host=" + (params && params.hostVersion) + " api=" + (params && params.apiVersion));
            reply(id, { ok: true, packId: "com.akisaki.voice.aishell3" });
            return;
        }
        if (method === "host.ping") { reply(id, { ok: true }); return; }
        if (method === "host.dispose") {
            reply(id, { ok: true });
            disposed = true;
            setTimeout(() => process.exit(0), 10);
            return;
        }
        if (method === "capability.list") { reply(id, { capabilities: [] }); return; }
        if (method === "service.call") {
            const p = params || {};
            const args = (p.params && p.params.args) || [];
            if (p.serviceId !== "speech.tts") throw new Error("未知服务：" + p.serviceId);
            if (p.method === "listVoices") { reply(id, listVoices()); return; }
            if (p.method === "synthesize") { reply(id, synthesize(args[0])); return; }
            throw new Error("未知方法：" + p.method);
        }
        reply(id, null);
    } catch (e) {
        log("处理失败：", e && e.message);
        if (id !== undefined) replyError(id, e && e.message);
    }
}

process.stdin.setEncoding("utf-8");
process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let idx = buffer.indexOf("\n");
    while (idx >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) void handleLine(line);
        idx = buffer.indexOf("\n");
    }
});
process.stdin.on("end", () => { if (!disposed) process.exit(0); });

log("已启动 pack=" + PACK_DIR);
