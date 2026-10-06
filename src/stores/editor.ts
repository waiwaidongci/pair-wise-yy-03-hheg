import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type { ObjectType, PerformanceSettings, SceneDocument, SceneObject, TransformMode, Vec3 } from '../types/scene'
import { applyResolutions, mergeDocuments, type ResolutionMap, type MergeResult } from '../utils/merge'
import { createSceneObject, createStarterScene, descendantsOf, liveObjects, migrateDocument, uid } from '../utils/scene'

interface PendingMerge {
  fileName: string
  document: SceneDocument
  result: MergeResult
}

interface EditorState {
  name: string
  objects: SceneObject[]
  /** 共同祖先快照：离线合并的基准 */
  baseObjects: SceneObject[]
  /** 文档修订号 */
  revision: number
  /** 结构修订号：层级 / 对象变化时自增，驱动世界包围盒与导出预览失效重算 */
  sceneRevision: number
  selectedId: string | null
  transformMode: TransformMode
  snapEnabled: boolean
  snapSize: number
  performance: PerformanceSettings
  notice: string
  pendingMerge: PendingMerge | null
  mergeError: string | null
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
  /** 导入并离线合并场景文件：迁移 → 三方合并 → 冲突裁决或直接应用 */
  mergeSceneDocument: (document: unknown, fileName?: string) => void
  applyMerge: (resolutions: ResolutionMap) => void
  cancelMerge: () => void
  mergeFailed: (message: string) => void
  reset: () => void
  noticeMessage: (message: string) => void
}

/** 字段级变更：对象修订号 +1，结构修订号 +1 */
function touchObject(state: EditorState, id: string) {
  const object = state.objects.find((item) => item.id === id)
  if (object) object.rev += 1
  state.sceneRevision += 1
  state.revision += 1
}

/** 结构变更（增删对象 / 合并 / 载入）：仅结构修订号 +1 */
function touchStructure(state: EditorState) {
  state.sceneRevision += 1
  state.revision += 1
}

function starterBase(): SceneObject[] {
  return createStarterScene().map((object) => ({ ...object }))
}

export const useEditorStore = create<EditorState>()(immer((set, get) => ({
  name: '产品发布会三维展台',
  objects: createStarterScene(),
  baseObjects: starterBase(),
  revision: 1,
  sceneRevision: 0,
  selectedId: 'hero-box',
  transformMode: 'translate',
  snapEnabled: true,
  snapSize: 0.25,
  performance: { instanceMode: false, shadows: true, showGrid: true, pixelRatio: 1.5 },
  notice: '选择物体后可使用 G / R / S 切换变换工具',
  pendingMerge: null,
  mergeError: null,

  select: (id) => set((state: EditorState) => { state.selectedId = id }),

  add: (type, parentId = null) => set((state: EditorState) => {
    const object = createSceneObject(type, parentId)
    const siblings = state.objects.filter((item) => !item.deleted && item.parentId === parentId)
    const index = siblings.length
    object.position[0] += index * 0.8
    object.position[2] += index * 0.35
    state.objects.push(object)
    state.selectedId = object.id
    touchStructure(state)
    state.notice = `已添加${object.name}`
  }),

  update: (id, patch) => set((state: EditorState) => {
    const index = state.objects.findIndex((item) => item.id === id)
    if (index >= 0) {
      state.objects[index] = { ...state.objects[index], ...patch }
      touchObject(state, id)
    }
  }),

  setTransform: (id, patch) => set((state: EditorState) => {
    const object = state.objects.find((item) => item.id === id)
    if (!object) return
    object.position = patch.position
    object.rotation = patch.rotation
    object.scale = patch.scale
    touchObject(state, id)
  }),

  reparent: (id, parentId) => {
    if (id === parentId || (parentId && descendantsOf(id, get().objects).has(parentId))) {
      set((state: EditorState) => { state.notice = '无法将物体挂载到自身的子级' })
      return false
    }
    set((state: EditorState) => {
      const object = state.objects.find((item) => item.id === id)
      if (object) {
        object.parentId = parentId
        touchObject(state, id)
      }
      state.notice = parentId ? '层级关系已更新' : '已移动到场景根节点'
    })
    return true
  },

  remove: (id) => set((state: EditorState) => {
    const removed = descendantsOf(id, state.objects)
    removed.add(id)
    let count = 0
    for (const object of state.objects) {
      if (removed.has(object.id) && !object.deleted) {
        object.deleted = true
        object.rev += 1
        count += 1
      }
    }
    if (state.selectedId && removed.has(state.selectedId)) state.selectedId = null
    touchStructure(state)
    state.notice = `已删除 ${count} 个对象（可通过合并保留墓碑）`
  }),

  duplicate: (id) => set((state: EditorState) => {
    const source = state.objects.find((item) => item.id === id && !item.deleted)
    if (!source) return
    const copy = JSON.parse(JSON.stringify(source)) as SceneObject
    copy.id = uid(source.type)
    copy.name = `${source.name} 副本`
    copy.position[0] += 0.8
    copy.rev = 1
    delete copy.deleted
    state.objects.push(copy)
    state.selectedId = copy.id
    touchStructure(state)
    state.notice = '已复制物体'
  }),

  setTransformMode: (mode) => set((state: EditorState) => { state.transformMode = mode }),
  setSnapEnabled: (enabled) => set((state: EditorState) => { state.snapEnabled = enabled }),
  setSnapSize: (size) => set((state: EditorState) => { state.snapSize = size }),
  setPerformance: (patch) => set((state: EditorState) => { Object.assign(state.performance, patch) }),

  align: (axis) => set((state: EditorState) => {
    const object = state.objects.find((item) => item.id === state.selectedId && !item.deleted)
    if (!object) return
    object.position[axis] = 0
    touchObject(state, object.id)
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
    touchStructure(state)
    state.notice = `已添加 ${count} 个几何体并开启实例化渲染`
  }),

  loadScene: (document) => set((state: EditorState) => {
    const migrated = migrateDocument(document)
    state.name = migrated.name
    state.objects = migrated.objects
    state.baseObjects = migrated.base ?? migrated.objects
    state.revision = migrated.revision ?? 1
    state.sceneRevision += 1
    state.selectedId = liveObjects(migrated.objects)[0]?.id ?? null
    state.pendingMerge = null
    state.mergeError = null
    state.notice = migrated.version === 2 && (document as SceneDocument).version === 1
      ? '旧场景已迁移为修订格式（v2）并导入'
      : '场景 JSON 已导入'
  }),

  mergeSceneDocument: (input, fileName) => {
    let document: SceneDocument
    try {
      document = migrateDocument(input)
    } catch (error) {
      set((state: EditorState) => {
        state.mergeError = error instanceof Error ? error.message : '场景文件无效'
        state.pendingMerge = null
      })
      return
    }
    const base = document.base ?? get().baseObjects
    const result = mergeDocuments(base, get().objects, document.objects)
    if (result.conflicts.length === 0) {
      set((state: EditorState) => {
        state.objects = result.objects
        state.baseObjects = result.objects
        state.revision += 1
        state.sceneRevision += 1
        state.selectedId = liveObjects(result.objects)[0]?.id ?? null
        state.pendingMerge = null
        state.mergeError = null
        state.notice = describeMerge(result.objects)
      })
    } else {
      set((state: EditorState) => {
        state.pendingMerge = { fileName: fileName ?? '未命名文件', document, result }
        state.mergeError = null
      })
    }
  },

  applyMerge: (resolutions) => {
    const pending = get().pendingMerge
    if (!pending) return
    try {
      const applied = applyResolutions(
        pending.result.objects,
        pending.result.conflicts,
        resolutions,
        get().objects,
        pending.document.objects,
      )
      set((state: EditorState) => {
        state.objects = applied
        state.baseObjects = applied
        state.revision += 1
        state.sceneRevision += 1
        state.selectedId = liveObjects(applied)[0]?.id ?? null
        state.pendingMerge = null
        state.mergeError = null
        state.notice = describeMerge(applied)
      })
    } catch (error) {
      set((state: EditorState) => {
        state.mergeError = error instanceof Error ? error.message : '合并失败'
      })
    }
  },

  cancelMerge: () => set((state: EditorState) => {
    state.pendingMerge = null
    state.mergeError = null
    state.notice = '已取消合并，当前场景未改动'
  }),

  mergeFailed: (message) => set((state: EditorState) => {
    state.mergeError = message
    state.pendingMerge = null
  }),

  reset: () => set((state: EditorState) => {
    state.name = '产品发布会三维展台'
    state.objects = createStarterScene()
    state.baseObjects = starterBase()
    state.revision = 1
    state.sceneRevision += 1
    state.selectedId = 'hero-box'
    state.pendingMerge = null
    state.mergeError = null
    state.notice = '已恢复示例场景'
  }),

  noticeMessage: (message) => set((state: EditorState) => { state.notice = message }),
})))

function describeMerge(merged: SceneObject[]): string {
  const live = liveObjects(merged)
  const tombstones = merged.filter((object) => object.deleted).length
  return `合并完成：当前 ${live.length} 个对象，墓碑 ${tombstones} 个`
}

export function updateVector(vector: Vec3, axis: 0 | 1 | 2, value: number): Vec3 {
  const next: Vec3 = [...vector]
  next[axis] = value
  return next
}
