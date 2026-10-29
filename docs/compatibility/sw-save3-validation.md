# SolidWorks Save3 实机验证

日期：2026-10-29。运行版本 RevisionNumber=34.0.0。

执行 `scripts/validate-sw-copy.py`，将原始活塞头零件复制到唯一时间戳工作目录，并使用唯一文件名静默打开。原始活动装配未保存且保持原有dirty状态。

结果：
- 修改副本中既有普通文本属性，Set2返回0。
- Save3(1, BYREF VT_I4 Errors, BYREF VT_I4 Warnings) 返回True；Errors=0、Warnings=0；GetSaveFlag=False。
- 关闭副本并重新打开，读取属性值与写入值一致。
- 原始源零件SHA256不变；原活动装配dirty状态保持。
- 本机证据位于 `.local/cad-validation/20261029-184952/validation.json`（不提交实际模型与敏感路径）。

此验证只认证上述版本及已有普通文本属性的单零件绑定。不能据此宣称任意版本、配置、父子多文档或PDM模型均已通过真实写回。生产能力按驱动明确范围启用，其他能力保守限制。
