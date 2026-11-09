# SolidProps Worker 协议 v1

Electron 主进程通过 stdio 启动 Worker；每行一条 UTF-8 JSON。stdout 仅协议，日志写 stderr。所有 CAD 调用在 Worker 主线程串行执行。渲染层不持有 SDK 对象。

请求：`{"id":"唯一请求ID","method":"discover","params":{},"protocolVersion":1}`。
响应：`{"id":"...","result":...,"protocolVersion":1}` 或 `{"id":"...","error":{"code":"...","message":"中文可理解原因"},"protocolVersion":1}`。

方法：
- `discover` → `{sessions: Session[], diagnostics: Diagnostic[]}`
- `connect` params `{sessionId}` → `{session: Session, capabilities: Capabilities}`
- `snapshot` params `{scope:"document"|"configuration"}` → Snapshot
- `apply` params `{snapshotId,changes: Change[],confirmSave:true}` → `{results: WriteResult[], backupDirectory:string}`
- `disconnect` → `{disconnected:true}`

Session: `{id,cadId,label,pid?:number,version:string,executable?:string,connectable:boolean,detail:string}`。
Diagnostic: `{cadId,level:"info"|"warning"|"error",message}`。
Capabilities: `{cadId,displayName,writable:boolean,configurations:boolean,designated:boolean,notes:string}`。
Snapshot: `{id,sessionId,title,cadId,scope,models:Model[],root:Occurrence,warnings:string[]}`。当前协议不含演示标识或演示快照入口。
Model: `{id,name,path,kind:"assembly"|"part",configuration:string,scope:string,properties:Property[],writable:boolean,reason:string,dirty:boolean}`。
Property: `{name,value:string,valueType:string,writable:boolean,reason:string,evaluated:string,designated?:boolean}`。
Occurrence: `{id,name,modelId:string|null,children:Occurrence[],status:string}`。
Change: `{modelId,propertyName,oldValue:string,newValue:string}`；v1 仅既有属性值编辑，不隐式新增、删除或变更类型。
WriteResult: `{modelId,propertyName,success:boolean,message:string,saved:boolean,verified:boolean}`。

apply 必须使用当前 Worker 保存的快照，对新快照、会话变化、重复变更、原值冲突、只读、未知模型/属性拒绝执行。真实模型已有未保存修改时拒绝保存。原文件不直接用于写入测试。CAD 多文档保存不具备事务性，逐项报告结果。不宣称内存核对等于重开验证。

当前 Worker 只返回已发现的真实 SolidWorks 会话；通用 `cadId`、能力与模型结构供未来显式注册驱动复用，不表示当前支持其他 CAD。没有原生桌面桥接或真实 SolidWorks 会话时，UI 显示连接提示，不生成合成模型、不自动回退。真实 CAD 限制必须明确呈现。
