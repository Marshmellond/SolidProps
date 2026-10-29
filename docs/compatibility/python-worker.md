# Python Worker 实现与实测边界

## 当前产品范围

当前运行时只发现并附着用户已打开的 SolidWorks；不包含 Creo 发现、连接、参数读取或演示适配器。没有会话或官方接口不可用时返回空会话和诊断，不生成合成模型，不启动或配置 CAD。通用 `CadAdapter` / `CadPlugin` 契约与显式插件注册保留，`builtin_plugins()` 当前仅注册 SolidWorks；其他 CAD 需独立实现和认证，未知 `cadId` 拒绝连接。

## 历史实测记录（2026-10-29，Windows，Python 3.12.14）

以下描述此前版本的实测证据，不是本轮重新执行的结果。历史测试数量、演示输出和旧安装包不代表当前回归通过，不沿用为新数量。

- uv 安装成功；默认 PyPI 出现 TLS handshake EOF，显式使用清华 PyPI 镜像成功，不修改用户全局配置。
- 历史 pytest 覆盖协议、合成数据、只读诊断、假 COM 保存协调器和安全边界；测试仅使用内存数据与 pytest 临时目录中的 FAKE MODEL BYTES，不修改真实模型。旧 self-test 的演示输出不适用于当前无演示运行时。
- 用户自行打开 SolidWorks 后，真实 attach-only 读取验证成功，RevisionNumber `34.0.0`。活动装配读取5个去重模型（根总成+4个已加载零件），40个文档属性，6个子发生项；重复发生项共享 modelId。根模型本来为 dirty，未调用 Set2/Save3/重建/激活配置/退出 CAD。
- 真实首次读取发现动态 COM 对象本身可 callable；已修复 ActiveDoc/Extension 等 COM 属性对象被当作 DISPID_VALUE 方法调用的问题，并加入当时回归测试。
- 随后在独立复制的 SLDPRT 上认证真实写回：revision `34.0.0`，既有文本 Set2 返回0；Save3(1, BYREF I4 errors, BYREF I4 warnings) 返回 True/0/0；关闭副本并重开值持久化。原模型 SHA256 不变，原活动 dirty 状态保留。证据 `.local/cad-validation/20261029-184952/validation.json`。仅该精确 revision 启用 document 作用域已加载根/子模型分文档写回，其他版本保守禁用。
- 此前 Creo 环境/类型库检查属于已移除驱动的历史调查，不构成当前能力，不再提供对应运行时或诊断工具。

### 历史装配分组写回补充验证

- 当时记录65项 pytest 通过，包含全批 dirty/readonly/COM 身份/原值检查、全批备份后再修改、第二组失败保留第一组成功并取消第三组、保存失败锁、configuration 只读、原始测试文件 guard 等测试。这不是本轮测试数量。
- `scripts/validate-sw-assembly-copy.py` 完整复制装配目录到 `.local/cad-validation/assembly-20261029-190328/assembly-copy`，但 OpenDoc6 未返回副本精确路径（用户原同名装配已加载）。脚本在任何 Set2 前安全拒绝，`mutated:false, sourceUnchanged:true, originalDirtyPreserved:true`。证据为同目录 validation.json。
- 因同名文档复用风险，当时未强行关闭用户模型或修改引用，**未完成真实装配子件分组保存的集成认证**。协调器逻辑使用假 COM 验证，Save3 绑定仅单零件独立副本真实认证。不得把安全拒绝描述为子件真实保存成功。

## 当前能力矩阵

|能力|SolidWorks|证据与限制|
|---|---|---|
|发现|psutil + COM 注册只读诊断|只处理已打开的真实会话，不启动 CAD|
|连接|仅 GetActiveObject 已有实例，单实例 + PID 复核|多实例或身份不明拒绝|
|根属性读取|document 与活动 configuration|document 历史实机验证；configuration 有实现/假 COM 覆盖，只读|
|父子结构|已加载非抑制子模型属性、发生项、去重|不解析未加载、轻量化、抑制组件|
|修改|仅精确 revision `34.0.0`，已加载根/子文档既有未链接文本|按文件保存；configuration 只读；完整装配分组保存未实机认证|
|持久化验证|独立单零件副本认证成功|生产 apply 仅报告 API 保存，`verified:false`，不关闭重开用户模型|
|其他 CAD / 演示|不提供|通用扩展契约不代表已交付驱动|

## 安全与残余限制

所有 COM 运行在 Worker 主线程 STA 串行路径。发现多实例立即拒绝；请求中复核进程创建时间、PID、ROT 对象 PID、活动 COM 文档身份、路径和配置。只读读取 Get6 采用缓存避免激活配置/重建；缓存过期会提示，读取失败不捏造原值。

apply 整批校验后才可能写：必须当前快照、旧值相符、既有未链接文本、模型/属性可写、非 dirty、非只读、显式 confirmSave。快照消耗防重放；请求 ID 也防重复。新快照尝试即废旧快照。备份默认用户目录 CadWeave/backups/UUID，唯一目录、copy2 后 hash 核对；备份失败不修改。逐属性结果报告，遇 Set2/内存回读失败不保存后项；开始 Set2 即锁定不确定状态，只有明确 Save 成功解锁。保存失败后禁止该连接后续自动保存，即使 COM 异常报告 dirty=false。

假 COM 写路径测试不等于真实 CAD 认证。生产 ComBridge 默认 write_certified=False，仅实际连接 RevisionNumber 精确 `34.0.0` 时开启；未知/其他版本能力、属性、模型全部只读，用户无法从协议参数绕过。该版本已在独立副本验证 Set2 状态、Save3 bool+errors/warnings、关闭重开值；未把用户 dirty 原模型用于测试。未来其他版本仍须独立认证。生产 apply 始终 `verified:false`，因为并不关闭重开用户模型。

没有多文档事务保证、生产重开验证、PDM 锁定/签出集成或外部进程并发修改事务。外部 CAD 用户仍可能在最后复核与 COM 调用间操作，本 Worker 尽力缩小窗口但不声称原子性。根/子模型按规范化文件路径统一去重、私有 COM 映射持有，逐次核对 GetOpenDocumentByName 身份和路径；仅 document 作用域写回，configuration 只读。全批目标预检与全批备份均在第一项 Set2 前完成；每文件组保存，组失败停止后续组，前组已保存不伪装回滚。开发 checkout 原始测试目录硬保护禁止写回，冻结产品不依赖开发路径。

## 官方参考

- [SolidWorks ICustomPropertyManager.Get6](https://help.solidworks.com/2026/English/api/sldworksapi/SolidWorks.Interop.sldworks~SolidWorks.Interop.sldworks.ICustomPropertyManager~Get6.html)：缓存/链接/解析标志，2018起可用。
- [SolidWorks ICustomPropertyManager.Set2](https://help.solidworks.com/2026/English/api/sldworksapi/SOLIDWORKS.Interop.sldworks~SOLIDWORKS.Interop.sldworks.ICustomPropertyManager~Set2.html)：仅既有属性值，必须检查状态码。
