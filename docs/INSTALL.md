# Kirari 扩展包安装指南

> 扩展包 = 独立安装包 / 独立目录，装进数据根的 `extensions/<packId>/`。
> 桌宠端与核心版共用同一份扩展包（node_modules 按目标平台各自装一次）。

## 当前可用的扩展包

| 包 | id | 提供的服务 | 平台 |
| --- | --- | --- | --- |
| 语音合成（AISHELL3，174 音色） | `com.akisaki.voice.aishell3` | `speech.tts` | Windows / Linux / macOS |

---


> ⚠️ npm script 名叫 `ext:install` 而不是 `install` —— npm 会把 `install` 当生命周期钩子，
> `npm install` 时会递归触发自己（已踩过）。直接 `node scripts/install.mjs` 也完全可以。

## 桌宠端（Windows/macOS/Linux 桌面）

### 一键安装（推荐）

```bash
cd kirari-ext-voice
node scripts/install.mjs
```

脚本自动完成：安装依赖 → 复制到 `~/.kirari/extensions/com.akisaki.voice.aishell3/` → 跑 selftest 验证。

可选参数：

```bash
node scripts/install.mjs --target D:/kirari-data   # 装到指定数据根（便携/多开）
```

装完**重启 Kirari**，设置里出现「语音」页；在页内下载音色库（30MB）即可使用。

### NSIS 安装包

```bash
node scripts/build-installer.mjs
# 产物: release/kirari-voice-pack-aishell3-setup-<ver>.exe (~6MB，运行时；音色库装后在设置里下载)
```

---

## 核心版（本机 Node 服务）

与桌宠端同一份数据根（`~/.kirari/extensions/`）—— **装一次，桌宠和控制台都可用**：

```bash
cd kirari-ext-voice
node scripts/install.mjs        # 就是同一个目录
# 或显式： node scripts/install.mjs --target ~/.kirari
```

重启核心版服务后生效。音色库通过控制台 HTTP 端点下载：

```bash
curl -H "X-Admin-Token: xxx" http://localhost:9089/api/extensions/voices
curl -X POST -H "X-Admin-Token: xxx" http://localhost:9089/api/extensions/voices/aishell3/download
curl -H "X-Admin-Token: xxx" http://localhost:9089/api/extensions/voices/progress
```

---

## 核心版（Docker 容器）

容器里扩展包在数据卷 `/data/extensions/`。两个角色分工：

- **宿主机** `install.mjs --docker <容器名>`：准备 Linux 版依赖 → 打包 → docker cp → 调容器内脚本安装 → 重启
- **容器内** `ext-install.cjs`：校验、落位、状态检查（镜像自带，无需额外安装）

### 一键安装（宿主机执行）

```bash
cd kirari-ext-voice
node scripts/install.mjs --docker pet-api
```

### 容器内手动操作

```bash
# 列出已装扩展包
docker exec pet-api node /app/scripts/ext-install.cjs list

# 查看某个包（会检查原生库平台是否为 linux —— 装错平台会直接警告）
docker exec pet-api node /app/scripts/ext-install.cjs status com.akisaki.voice.aishell3

# 从 tar.gz 安装（宿主机 docker cp 进来后）
docker cp voice-pack.tar.gz pet-api:/tmp/voice-pack.tar.gz
docker exec pet-api node /app/scripts/ext-install.cjs install /tmp/voice-pack.tar.gz

# 删除
docker exec pet-api node /app/scripts/ext-install.cjs remove com.akisaki.voice.aishell3
```

装完重启服务：`docker restart pet-api`。验证：

```bash
docker logs pet-api 2>&1 | grep ext   # 应看到 loaded com.akisaki.voice.aishell3
```

### 音色库下载（容器内）

扩展包装好后，音色库**不要**打进包里（30MB，且更新频繁），通过 HTTP 端点下载：

```bash
curl -X POST -H "X-Admin-Token: xxx" http://host:9089/api/extensions/voices/aishell3/download
curl -H "X-Admin-Token: xxx" http://host:9089/api/extensions/voices/progress   # 轮询进度
```

或手动 `docker cp` 解压好的模型目录到 `/data/extensions/<packId>/voices/<libId>/`。

---

## 常见问题

**Q: 容器日志报 `sherpa-onnx` 平台不对？**
包是在 Windows 上打的。重新用 `node scripts/install.mjs --docker pet-api`（它会强制按 linux/x64 重装依赖），或按上面「容器内手动操作」确认平台。

**Q: 控制台能下载音色库，但桌宠端看不到？**
两端数据根不同（桌宠 `~/.kirari`，容器 `/data`）。音色库在各自数据根的扩展包目录里，互不共享；如需共享可自行同步 `voices/` 目录（模型文件平台无关）。

**Q: 如何彻底卸载？**

```bash
# 桌宠端 / 核心版本机
rm -rf ~/.kirari/extensions/com.akisaki.voice.aishell3
# 容器
docker exec pet-api node /app/scripts/ext-install.cjs remove com.akisaki.voice.aishell3
```