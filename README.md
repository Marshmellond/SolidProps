# CadWeave · 模型属性工作台

Electron / React / TypeScript 桌面端 + 独立 Python CAD Worker。聚焦装配父子模型属性集中编辑；不直接修改 CAD 私有文件格式。

## 项目边界

- 所有开发在本目录进行；客户提供的原始测试模型位于 `测试文件/`，仅保留在本机，不进入 Git 仓库。
- `测试文件/` 已由 `.gitignore` 排除；请勿用 `git add -f` 强行加入，也不要把客户模型上传到 GitHub。
- 原始测试模型不纳入 Git、不直接执行写回测试；工作副本放 `.local/`。
- 当前产品仅连接用户已打开的 SolidWorks，不提供演示模式或其他 CAD 运行时驱动。保留通用 CAD 插件契约供未来扩展；未验证版本、组件和写入能力不宣称支持。
- 不配置远程仓库，不上传模型。

## 开发

```powershell
pnpm install
uv sync --project workers/cad-python
pnpm dev
```

Electron 开发入口由 Electron Vite 启动，不依赖其他应用的本地服务。

## 检查

```powershell
pnpm typecheck
pnpm test
pnpm test:worker
pnpm test:ui
pnpm test:desktop
pwsh -NoProfile -File scripts/verify-public-repo.ps1
```

## 架构

- `apps/desktop`：主进程、安全预加载接口、React 界面。
- `workers/cad-python`：stdio 服务、领域模型、CAD 插件。
- `docs/architecture/protocol.md`：版本化通信协议。
- `docs/compatibility`：真实能力和环境限制。
- `scripts/verify-public-repo.ps1`：提交前检查客户模型没有进入 Git。

运行期用户配置、日志、备份不写入安装目录。多文档 CAD 保存不具有数据库事务保证。完整使用与打包说明随实现更新。

## 使用和验收

- [用户说明](docs/product/user-guide.md)
- [测试记录](docs/product/test-report.md)
- [插件扩展约定](docs/architecture/plugin-development.md)
- [视觉规范](docs/design/visual-system.md)
- [SolidWorks Save3 副本实机认证](docs/compatibility/sw-save3-validation.md)

```powershell
# Electron + Worker 桌面自动化检查（测试替身不代表产品演示模式）
pnpm test:desktop
# 构建 Worker、界面及 Windows 安装包
pwsh -NoProfile -File scripts/build.ps1
```

默认 Git 忽略 CAD 原始模型、`.local` 工作副本和 artifacts 构建产物，不设置远程仓库。正式外部分发需配置代码签名、验证目标 CAD 版本并在干净机器测试。当前构建仅提供 SolidWorks 运行时，以兼容文档声明的实际能力为准：仅精确 revision `34.0.0` 的既有未链接文本 document 属性允许写回，configuration 只读；完整装配子件分组保存尚未完成实机认证。无 SolidWorks 会话时显示连接提示，不生成合成数据。
