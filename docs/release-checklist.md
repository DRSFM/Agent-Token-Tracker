# Agent Token Tracker Release Checklist

## v1.0 必须完成

- `npm run test:backend`
- `npm run lint`
- `npm run build`
- `npm run release:portable`
- `npm run release:installer`
- 在干净目录解压 portable zip，并确认 `Agent Token Tracker.exe` 可启动。
- 设置页确认 Claude Code / Codex 路径、重新扫描、清理缓存、打开目录可用。
- 概览 / 会话 / 模型 / 趋势四页在有数据和无数据时都可读。
- 设置页确认背景图库、背景清晰度、静默背景欣赏模式可用。

## 发送前说明

- 当前未做代码签名，Windows 可能提示未知发布者。
- 数据只读取本机日志，不上传网络。
- 朋友电脑上不需要 Node.js、npm 或源码目录。

## 可选项

- 开启 Windows 开发者模式或使用管理员终端后再尝试 `npm run release:installer` 生成 NSIS 安装包。
- 真正公开分发前再考虑代码签名证书和自动更新。

## 手动 QA 步骤

### 空数据状态在哪看

最容易触发的是新页面：

1. 打开「会话」页，选择较短时间范围，再切换到没有记录的数据源。
2. 打开「模型」页，选择一个没有记录的时间范围。
3. 打开「趋势」页，选择没有记录的时间范围。

如果本机最近一直有数据，可以临时改名这两个目录再启动应用检查空状态：

- `%USERPROFILE%\.claude\projects`
- `%USERPROFILE%\.codex\sessions`

检查完再改回原名，然后在设置页点「重新扫描」。

### 安装器检查

1. 运行 `release/Agent Token Tracker Setup <version>.exe`。
2. 确认安装器不是一键安装，而是向导模式。
3. 确认可以自选安装目录。
4. 确认选择安装目录后出现 Shortcuts 页面，并可选择是否创建桌面快捷方式。
5. 安装完成后确认开始菜单和可选桌面快捷方式能启动应用。

### 卸载位置

Windows 设置 → 应用 → 已安装的应用 → Agent Token Tracker → 卸载。

也可以在开始菜单搜索 Agent Token Tracker，右键进入卸载入口。

### 静默背景模式检查

1. 设置页上传一张背景图。
2. 开启「静默背景欣赏」。
3. 临时选择 30 秒或自定义 5 秒。
4. 不操作等待进入静默态，确认界面淡成轻玻璃感。
5. 点击任意位置，确认界面渐渐恢复活跃态。
