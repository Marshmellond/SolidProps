# SolidProps · SolidWorks 文档属性

Electron / React / TypeScript 桌面端 + 独立 Python CAD Worker。聚焦装配父子模型属性集中编辑；不直接修改 CAD 私有文件格式。

支持 Windows 10 / Windows 11 64 位；Windows 7 / 8 / 8.1 和 32 位系统不支持。目标机需已安装 SolidWorks（读取最低 2018，写回仅认证 34.0.0）。

## 下载

Windows 安装包通过 [GitHub Releases](https://github.com/Marshmellond/SolidProps/releases) 发布，文件名 `SolidProps-Setup-<版本>-x64.exe`，Release 说明中同时提供 SHA256。Git tag 只标记源码版本，安装包作为 Release 附件上传，不提交到仓库。

## 项目边界

- 客户 CAD 模型不进入 Git 仓库，也不直接执行写回测试；工作副本放 `.local/`。
- 仓库通过 Git 远程发布源码，构建产物和客户模型不提交。
- 当前产品仅连接用户已打开的 SolidWorks，不提供演示模式或其他 CAD 运行时驱动；未验证版本、组件和写入能力不宣称支持。

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
- `workers/cad-python`：stdio 服务、领域模型、SolidWorks 适配器。
- `docs/architecture/protocol.md`：版本化通信协议。
- `docs/compatibility`：真实能力和环境限制。
- `scripts/verify-public-repo.ps1`：提交前检查客户模型没有进入 Git。

运行期用户配置、日志、备份不写入安装目录。多文档 CAD 保存不具有数据库事务保证。完整使用与打包说明随实现更新。

## 当前使用流程

- 简体中文导航：工作台、连接。仅附着已有 SolidWorks 真实会话，无会话时显示连接提示，不生成合成数据。
- **保存 ≠ 写回**：“保存”只将本地编辑持久化为 SQLite 草稿；保存后经预览“提交”，才请求真实 CAD 写入和分文档保存。草稿按 CAD、根模型路径和作用域隔离，冲突项保留在数据库但不载入提交。
- 提交后自动重读，包括请求抛出异常时；重读失败锁定编辑/提交，需先检查 CAD 再重新读取，不能自动重试未知写入。
- 桌面主进程在 CAD 变更请求前先持久保存 pending 审计，作为写入安全的一部分；界面不提供记录页或导出。
- 变更支持可选 `operation: update/add/delete`（省略为 update）；新增仅普通文本，已有属性修改/删除仅未链接普通文本。**新增/删除目前只有 fake COM 逻辑测试，没有真实 CAD 写回及关闭重开认证。**模板仍只更新已有可写字段。

## 使用和验收

- [用户说明](docs/product/user-guide.md)
- [测试记录](docs/product/test-report.md)
- [视觉规范](docs/design/visual-system.md)
- [SolidWorks Save3 副本实机认证](docs/compatibility/sw-save3-validation.md)

```powershell
# Electron + Worker 桌面自动化检查（测试替身不代表产品演示模式）
pnpm test:desktop
# 构建 Worker、界面及 Windows 安装包
pwsh -NoProfile -File scripts/build.ps1
```

安装包输出到 `artifacts/desktop/SolidProps-Setup-0.1.0-x64.exe`。默认 Git 忽略 CAD 原始模型、`.local` 工作副本和 artifacts 构建产物。正式外部分发需配置代码签名、验证目标 CAD 版本并在干净机器测试。当前构建仅提供 SolidWorks 运行时，以兼容文档声明的实际能力为准：仅认证 revision `34.0.0` 的已加载、非 dirty、非只读且不受原始测试文件保护的模型允许 `document` 作用域写回，configuration 只读，其他版本禁写。单零件工作副本的既有未链接文本属性修改与 Save3 关闭重开已认证；新增/删除和完整装配子件分组保存尚未完成实机认证。SQLite 草稿/审计事务不代表 CAD 多文档事务，也不能回滚 CAD。

## Windows 分发与报毒

未签名的新构建可能触发 SmartScreen 或杀软误报。降低误报的做法：

- 正式分发必须签名 `SolidProps-Setup-*.exe`、`SolidProps.exe`、`cad-worker.exe` 和卸载器；OV/EV 证书比自签名有效，EV 证书更快建立 SmartScreen 信誉。配置 `CSC_LINK` / `CSC_KEY_PASSWORD` 后 electron-builder 会签名应用和安装包，`cad-worker.exe` 需额外用 `signtool` 签名。
- Worker 固定使用 PyInstaller `--onedir --noupx`，不使用 `--onefile` 或 UPX；单文件自解压和 UPX 压缩是误报高发项。
- 安装包为按用户安装，不打包未使用的 `elevate.exe`（`packElevateHelper: false`），减少包内未签名可执行文件。
- `cad-worker.exe` 已写入 SolidProps 公司名、产品名、版本和图标，安装包与主程序由 electron-builder 写入版本信息。
- 首次外发后向 Microsoft Defender 文件提交（`https://www.microsoft.com/en-us/wdsi/filesubmission`）提交误报，并在 360、腾讯、火绒的样本申诉渠道提交；每次大版本重新提交。
- 对外提供 SHA256，说明未签名版本可能出现的提示；不要建议用户关闭杀软。
