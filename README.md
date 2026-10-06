# SceneForge 浏览器三维场景编辑器

技术栈：React、TypeScript、Vite、Three.js、React Three Fiber、Drei、Zustand、MUI、Leva。

## 功能

- 添加程序化几何体、灯光和透视相机，不依赖外部模型。
- 在层级树中拖拽对象建立或取消父子关系，并跟随父级变换。
- 使用移动、旋转、缩放控件编辑对象，支持步长吸附和三轴对齐。
- 编辑材质颜色、粗糙度、金属度、透明度、线框和阴影参数。
- 场景保存为 JSON 并可重新加载。
- 提供 InstancedMesh 批量渲染模式，可添加 240 个对象进行压力验证。

## 运行

```bash
corepack pnpm install
corepack pnpm dev
corepack pnpm build
```
