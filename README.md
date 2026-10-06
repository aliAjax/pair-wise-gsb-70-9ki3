# API 契约兼容性审查与版本发布平台

用于后端维护者、接口评审人和调用方负责人协作处理 API 契约变化的独立前端工程。工程没有真实后端，首次运行加载本地模拟契约，后续状态写入浏览器 `localStorage`。

## 技术栈

- React 19 + TypeScript + Vite 8
- shadcn/ui 风格本地组件 + Radix UI primitives
- Zustand + persist
- TanStack Router
- TanStack Query
- Monaco Editor / Diff Editor
- Tailwind CSS 4

## 功能

- OpenAPI JSON 导入、契约列表搜索和领域/状态筛选
- 共享模型库：契约引用共享模型替代逐份复制的字段定义，生效定义 = 内联定义 + 引用模型解析结果
- 保存模型时按引用关系重算受影响契约；删字段、改类型或加必填会使旧评审结论失效并需重新确认
- 乐观并发：两个窗口同时编辑共享模型和引用契约时，后保存者保留草稿并可查看对方改动后选择覆盖或放弃
- 旧数据自动迁移：没有引用信息的契约按内联定义继续生效；冻结版本快照记录模型基线，不被模型变化改写
- 字段新增、删除、可选性、枚举与错误码变化展示
- 自动判定兼容、警告或不兼容，并要求调用方影响说明与迁移方案
- Monaco Editor 编辑契约定义，Monaco Diff Editor 比较正式版本快照与冲突版本
- 调用方列表、示例请求生成、逐条接受、退回和兼容层豁免
- 跨契约批量评审、发布门禁、正式版本冻结与版本历史
- Markdown 变更报告与 JSON 导出

## 运行

```bash
npm install
npm run dev
```

默认开发地址为 `http://localhost:18470`。

生产构建：

```bash
npm run build
```

构建输出位于 `dist`。

## 目录

```text
src/
  components/             shadcn/Radix 基础组件、业务组件、应用外壳
  data/                   本地模拟契约与共享模型
  lib/                    通用工具
  models/                 契约模型、共享模型 diff/重算、兼容性与发布门禁规则
  pages/                  工作台、详情、批量评审、共享模型、发布、报告
  services/               本地持久化（含版本迁移与乐观并发）、TanStack Query hooks
  store/                  Zustand 评审工作区状态
```
