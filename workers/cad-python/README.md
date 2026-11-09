# SolidProps Python worker

协议以仓库 `docs/architecture/protocol.md` 为准：UTF-8 NDJSON，camelCase，stdout 只有协议响应，stderr 诊断。真实 COM 在主线程 STA 串行运行，不启动 CAD。

```powershell
cd workers/cad-python
uv sync --group dev
uv run --no-sync python -m cad_worker
uv run --no-sync python -m cad_worker --self-test
uv run --no-sync python -m cad_worker --diagnose
uv run --no-sync pytest
```

默认 PyPI 网络不通时可显式使用 `uv sync --group dev --index-url https://pypi.tuna.tsinghua.edu.cn/simple`。uv.lock 固定依赖；未更改用户全局 uv/pip 设置。冻结入口为 `entry.py`，dev 组包含 PyInstaller。

## 当前真实支持边界

- **仅 SolidWorks 真实会话**：当前 Worker 只发现并附着用户已打开的 SolidWorks；不包含 Creo 或演示运行时驱动。没有会话或官方接口不可用时，返回空会话及诊断；不创建合成模型，不启动或配置 CAD。通用 CAD 插件契约保留，未来驱动须独立实现和认证。
- **SolidWorks**：GetActiveObject attach-only；进程PID+创建时间、多实例、ROT PID复核；活动文档COM身份、路径和配置复核。document属性与活动configuration属性使用Get6缓存读取，不激活、不重建。已加载非抑制子模型按文件路径/配置去重读取，未加载/轻量化/抑制不强制解析。document作用域支持根/子模型按文件分组保存，configuration只读。
- **SolidWorks真实写回严格限定版本**：仅精确revision `34.0.0` 的已加载根/子模型document作用域既有未链接文本属性可写；该版本Save3 BYREF I4已由主代理在独立副本Set2→Save3→关闭重开认证，原文件hash未变化、原dirty状态保留。其他revision禁用写回。整批预检、用户目录唯一备份+SHA256、Set2明确状态、内存回读、逐属性结果；Save失败/不确定写后锁定连接，禁止后续自动保存。生产apply不会关闭重开，结果`verified:false`。全批预检与全批备份在第一项修改前完成，每文件失败停止后续组，保留前组已保存结果。完整装配副本实测因SW同名原装配复用而在写前拒绝（未修改任何原件），分组流程当前以假COM验证，不宣称真实装配子件已持久化验证。

## 安全

apply要求当前Worker持有快照、明确confirmSave:true；新快照/断开/连接/任何已进入写阶段的apply使旧快照失效；拒绝重复请求、重复属性、未知模型属性、原值冲突、只读和dirty。整个批次先验证再修改。真实备份默认 `~/SolidProps/backups/<uuid>/`，备份失败不得Set2。没有CAD多文档事务保证。真实保存结果 `verified:false`：没有重开验证。测试只写pytest临时目录的合成字节和假COM，绝不写用户原模型。

`probe_readonly.py` 是人工只读诊断，不调用apply/Set2/Save3。当前 Worker 只注册 SolidWorks；未知 `cadId` 拒绝连接。详见兼容性文档。
