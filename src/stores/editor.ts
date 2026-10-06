import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { ObjectType, PerformanceSettings, SceneDocument, SceneObject, TransformMode, Vec3 } from '../types/scene'
import { createSceneObject, createStarterScene, descendantsOf, uid } from '../utils/scene'

interface EditorState {
  name: string
  objects: SceneObject[]
  selectedId: string | null
  transformMode: TransformMode
  snapEnabled: boolean
  snapSize: number
  performance: PerformanceSettings
  notice: string
  select: (id: string | null) => void
  add: (type: ObjectType, parentId?: string | null) => void
  update: (id: string, patch: Partial<SceneObject>) => void
  setTransform: (id: string, patch: Pick<SceneObject, 'position' | 'rotation' | 'scale'>) => void
  reparent: (id: string, parentId: string | null) => boolean
  remove: (id: string) => void
  duplicate: (id: string) => void
  setTransformMode: (mode: TransformMode) => void
  setSnapEnabled: (enabled: boolean) => void
  setSnapSize: (size: number) => void
  setPerformance: (patch: Partial<PerformanceSettings>) => void
  align: (axis: 0 | 1 | 2) => void
  addStressObjects: (count?: number) => void
  loadScene: (document: SceneDocument) => void
  reset: () => void
  noticeMessage: (message: string) => void
}

export const useEditorStore = create<EditorState>()(immer((set, get) => ({
  name: '产品发布会三维展台',
  objects: createStarterScene(),
  selectedId: 'hero-box',
  transformMode: 'translate',
  snapEnabled: true,
  snapSize: 0.25,
  performance: { instanceMode: false, shadows: true, showGrid: true, pixelRatio: 1.5 },
  notice: '选择物体后可使用 G / R / S 切换变换工具',

  select: (id) => set((state: EditorState) => { state.selectedId = id }),

  add: (type, parentId = null) => set((state: EditorState) => {
    const object = createSceneObject(type, parentId)
    const index = state.objects.filter((item) => item.parentId === parentId).length
    object.position[0] += index * 0.8
    object.position[2] += index * 0.35
    state.objects.push(object)
    state.selectedId = object.id
    state.notice = `已添加${object.name}`
  }),

  update: (id, patch) => set((state: EditorState) => {
    const index = state.objects.findIndex((item) => item.id === id)
    if (index >= 0) state.objects[index] = { ...state.objects[index], ...patch }
  }),

  setTransform: (id, patch) => set((state: EditorState) => {
    const object = state.objects.find((item) => item.id === id)
    if (!object) return
    object.position = patch.position
    object.rotation = patch.rotation
    object.scale = patch.scale
  }),

  reparent: (id, parentId) => {
    if (id === parentId || (parentId && descendantsOf(id, get().objects).has(parentId))) {
      set((state: EditorState) => { state.notice = '无法将物体挂载到自身的子级' })
      return false
    }
    set((state: EditorState) => {
      const object = state.objects.find((item) => item.id === id)
      if (object) object.parentId = parentId
      state.notice = parentId ? '层级关系已更新' : '已移动到场景根节点'
    })
    return true
  },

  remove: (id) => set((state: EditorState) => {
    const removed = descendantsOf(id, state.objects)
    removed.add(id)
    state.objects = state.objects.filter((item) => !removed.has(item.id))
    if (state.selectedId && removed.has(state.selectedId)) state.selectedId = null
    state.notice = `已删除 ${removed.size} 个对象`
  }),

  duplicate: (id) => set((state: EditorState) => {
    const source = state.objects.find((item) => item.id === id)
    if (!source) return
    const copy = JSON.parse(JSON.stringify(source)) as SceneObject
    copy.id = uid(source.type)
    copy.name = `${source.name} 副本`
    copy.position[0] += 0.8
    state.objects.push(copy)
    state.selectedId = copy.id
    state.notice = '已复制物体'
  }),

  setTransformMode: (mode) => set((state: EditorState) => { state.transformMode = mode }),
  setSnapEnabled: (enabled) => set((state: EditorState) => { state.snapEnabled = enabled }),
  setSnapSize: (size) => set((state: EditorState) => { state.snapSize = size }),
  setPerformance: (patch) => set((state: EditorState) => { Object.assign(state.performance, patch) }),

  align: (axis) => set((state: EditorState) => {
    const object = state.objects.find((item) => item.id === state.selectedId)
    if (!object) return
    object.position[axis] = 0
    state.notice = `已沿 ${['X', 'Y', 'Z'][axis]} 轴对齐到原点`
  }),

  addStressObjects: (count = 240) => set((state: EditorState) => {
    for (let index = 0; index < count; index += 1) {
      const type: ObjectType = index % 3 === 0 ? 'box' : index % 3 === 1 ? 'sphere' : 'cylinder'
      const object = createSceneObject(type)
      const grid = 20
      object.name = `压力测试 ${index + 1}`
      object.position = [((index % grid) - grid / 2) * 0.75, 0.35 + Math.floor(index / (grid * grid)) * 0.7, (Math.floor(index / grid) % grid - grid / 2) * 0.75]
      object.scale = [0.25, 0.25, 0.25]
      object.material.color = ['#3b82f6', '#14b8a6', '#f59e0b', '#ef4444'][index % 4]
      state.objects.push(object)
    }
    state.performance.instanceMode = true
    state.notice = `已添加 ${count} 个几何体并开启实例化渲染`
  }),

  loadScene: (document) => set((state: EditorState) => {
    state.name = document.name
    state.objects = document.objects
    state.selectedId = document.objects[0]?.id ?? null
    state.notice = '场景 JSON 已导入'
  }),

  reset: () => set((state: EditorState) => {
    state.name = '产品发布会三维展台'
    state.objects = createStarterScene()
    state.selectedId = 'hero-box'
    state.notice = '已恢复示例场景'
  }),

  noticeMessage: (message) => set((state: EditorState) => { state.notice = message }),
})))

export function updateVector(vector: Vec3, axis: 0 | 1 | 2, value: number): Vec3 {
  const next: Vec3 = [...vector]
  next[axis] = value
  return next
}
