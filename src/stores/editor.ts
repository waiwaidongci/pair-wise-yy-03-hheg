import { create } from 'zustand'
import { immer } from 'zustand/middleware/immer'
import type {
  FieldPath,
  MergeOutcome,
  RevisionEntry,
  RevisionState,
  SceneSnapshot,
} from '../types/revision'
import type { ObjectType, PerformanceSettings, SceneDocument, SceneObject, TransformMode, Vec3 } from '../types/scene'
import { assertValidHierarchy, repairHierarchy } from '../utils/hierarchy'
import { applyResolutions, findMergeBase, isAncestorRev, mergeScenes } from '../utils/merge'
import {
  GENESIS_REV,
  MAX_HISTORY,
  MAX_SNAPSHOTS,
  TRACKED_FIELDS,
  fieldValuesEqual,
  fullFieldRevs,
  genesisRevisionState,
  getField,
  migrateDocument,
  newRevisionId,
  setField,
  snapshotOf,
} from '../utils/revision'
import { createSceneObject, createStarterScene, descendantsOf, uid } from '../utils/scene'

interface PendingMerge {
  outcome: MergeOutcome
  theirHead: string
  theirHistory: RevisionEntry[]
  theirName: string
}

interface MergeFailure {
  message: string
  document: SceneDocument
}

interface EditorState {
  name: string
  objects: SceneObject[]
  revision: RevisionState
  /** 按修订号保存的场景快照，作为三方合并的基线 */
  snapshots: Record<string, SceneSnapshot>
  /** 任意场景变化递增：世界包围盒、导出预览以此失效重算 */
  sceneVersion: number
  /** 层级结构（增删/换父级）变化递增 */
  structureVersion: number
  selectedId: string | null
  transformMode: TransformMode
  snapEnabled: boolean
  snapSize: number
  performance: PerformanceSettings
  notice: string
  pendingMerge: PendingMerge | null
  mergeFailure: MergeFailure | null
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
  loadScene: (raw: unknown) => void
  importDocument: (raw: unknown) => void
  mergeScene: (document: SceneDocument) => void
  resolveMerge: (resolutions: Record<string, 'ours' | 'theirs'>) => void
  cancelMerge: () => void
  retryMerge: () => void
  dismissMergeFailure: () => void
  exportDocument: () => SceneDocument
  reset: () => void
  noticeMessage: (message: string) => void
}

const MATERIAL_SUBFIELDS = ['color', 'roughness', 'metalness', 'opacity', 'wireframe'] as const

export const useEditorStore = create<EditorState>()(immer((set, get) => {
  /** 开启一个新修订：写入历史（带上父修订），推进 head，超限时保留首条（genesis）截断 */
  const pushHistory = (state: EditorState, label: string, parents?: string[], id = newRevisionId()): string => {
    state.revision.history.push({ id, parents: parents ?? [state.revision.head], at: new Date().toISOString(), label })
    if (state.revision.history.length > MAX_HISTORY) {
      state.revision.history = [state.revision.history[0], ...state.revision.history.slice(-(MAX_HISTORY - 1))]
    }
    state.revision.head = id
    return id
  }

  const stamp = (state: EditorState, id: string, fields: FieldPath[], rev: string) => {
    const meta = state.revision.objectMeta[id]
    if (!meta) return
    for (const field of fields) meta.fieldRevs[field] = rev
  }

  /** 为当前 head 留存快照；只保留最近若干份，genesis 与 head 永不淘汰 */
  const checkpoint = (state: EditorState) => {
    state.snapshots[state.revision.head] = snapshotOf(state.name, state.objects, state.revision)
    const keep = new Set([GENESIS_REV, state.revision.head])
    for (const entry of state.revision.history.slice(-MAX_SNAPSHOTS)) keep.add(entry.id)
    for (const key of Object.keys(state.snapshots)) {
      if (!keep.has(key)) delete state.snapshots[key]
    }
  }

  const touch = (state: EditorState, structural = false) => {
    state.sceneVersion += 1
    if (structural) state.structureVersion += 1
  }

  /** 合并落地：写入合并修订（双父）、并入对方历史、应用合并产物 */
  const commitMerge = (state: EditorState, outcome: MergeOutcome, theirHead: string, theirHistory: RevisionEntry[], theirName: string) => {
    pushHistory(state, '合并导入', [state.revision.head, theirHead], outcome.mergeRev)
    const known = new Set(state.revision.history.map((entry) => entry.id))
    for (const entry of theirHistory) {
      if (!known.has(entry.id)) state.revision.history.push(entry)
    }
    if (state.revision.history.length > MAX_HISTORY) {
      state.revision.history = [state.revision.history[0], ...state.revision.history.slice(-(MAX_HISTORY - 1))]
    }
    state.objects = outcome.objects
    state.revision.objectMeta = outcome.objectMeta
    state.revision.tombstones = outcome.tombstones
    if (state.selectedId && !outcome.objects.some((object) => object.id === state.selectedId)) state.selectedId = null
    state.pendingMerge = null
    state.mergeFailure = null
    touch(state, true)
    checkpoint(state)
    const auto = outcome.notes.find((note) => note.kind === 'auto')
    const renamed = theirName !== state.name ? '；场景名称保留当前版本' : ''
    state.notice = `合并完成：${auto?.message ?? '无自动合并项'}${renamed}`
  }

  /** 合并失败恢复现场：回滚到合并前快照，保留待合并文件供重试 */
  const restoreBackup = (state: EditorState, backup: SceneSnapshot, selectedId: string | null) => {
    state.name = backup.name
    state.objects = backup.objects
    state.revision = backup.revision
    state.selectedId = selectedId && backup.objects.some((object) => object.id === selectedId) ? selectedId : null
    touch(state, true)
  }

  return {
    name: '产品发布会三维展台',
    objects: createStarterScene(),
    revision: genesisRevisionState(),
    snapshots: {},
    sceneVersion: 0,
    structureVersion: 0,
    selectedId: 'hero-box',
    transformMode: 'translate',
    snapEnabled: true,
    snapSize: 0.25,
    performance: { instanceMode: false, shadows: true, showGrid: true, pixelRatio: 1.5 },
    notice: '选择物体后可使用 G / R / S 切换变换工具',
    pendingMerge: null,
    mergeFailure: null,

    select: (id) => set((state: EditorState) => { state.selectedId = id }),

    add: (type, parentId = null) => set((state: EditorState) => {
      const object = createSceneObject(type, parentId)
      const index = state.objects.filter((item) => item.parentId === parentId).length
      object.position[0] += index * 0.8
      object.position[2] += index * 0.35
      const rev = pushHistory(state, '添加对象')
      state.objects.push(object)
      state.revision.objectMeta[object.id] = { createdRev: rev, fieldRevs: fullFieldRevs(rev) }
      state.selectedId = object.id
      state.notice = `已添加${object.name}`
      touch(state, true)
      checkpoint(state)
    }),

    update: (id, patch) => set((state: EditorState) => {
      const object = state.objects.find((item) => item.id === id)
      if (!object) return
      const changed: FieldPath[] = []
      for (const [key, value] of Object.entries(patch)) {
        if (key === 'material' && value) {
          for (const sub of MATERIAL_SUBFIELDS) {
            if (!(sub in (value as object))) continue
            const field = `material.${sub}` as FieldPath
            const next = (value as unknown as Record<string, unknown>)[sub]
            if (!fieldValuesEqual(getField(object, field), next)) {
              setField(object, field, next)
              changed.push(field)
            }
          }
          continue
        }
        const field = key as FieldPath
        if (!TRACKED_FIELDS.includes(field)) continue
        if (field === 'parentId') {
          const parentId = value as string | null
          if (parentId === object.parentId) continue
          if (parentId && (parentId === id || descendantsOf(id, state.objects).has(parentId))) {
            state.notice = '无法将物体挂载到自身的子级'
            continue
          }
        }
        if (!fieldValuesEqual(getField(object, field), value)) {
          setField(object, field, value)
          changed.push(field)
        }
      }
      if (changed.length === 0) return
      const rev = pushHistory(state, '编辑属性')
      stamp(state, id, changed, rev)
      touch(state, changed.includes('parentId'))
      checkpoint(state)
    }),

    setTransform: (id, patch) => set((state: EditorState) => {
      const object = state.objects.find((item) => item.id === id)
      if (!object) return
      const changed = (['position', 'rotation', 'scale'] as FieldPath[]).filter(
        (field) => !fieldValuesEqual(getField(object, field), patch[field as 'position']),
      )
      if (changed.length === 0) return
      const rev = pushHistory(state, '变换')
      object.position = patch.position
      object.rotation = patch.rotation
      object.scale = patch.scale
      stamp(state, id, changed, rev)
      touch(state)
      checkpoint(state)
    }),

    reparent: (id, parentId) => {
      if (id === parentId || (parentId && descendantsOf(id, get().objects).has(parentId))) {
        set((state: EditorState) => { state.notice = '无法将物体挂载到自身的子级' })
        return false
      }
      set((state: EditorState) => {
        const object = state.objects.find((item) => item.id === id)
        if (!object || object.parentId === parentId) return
        const rev = pushHistory(state, '调整层级')
        object.parentId = parentId
        stamp(state, id, ['parentId'], rev)
        state.notice = parentId ? '层级关系已更新' : '已移动到场景根节点'
        touch(state, true)
        checkpoint(state)
      })
      return true
    },

    remove: (id) => set((state: EditorState) => {
      if (!state.objects.some((item) => item.id === id)) return
      const removed = descendantsOf(id, state.objects)
      removed.add(id)
      const rev = pushHistory(state, '删除对象')
      for (const removedId of removed) {
        const meta = state.revision.objectMeta[removedId]
        // 墓碑记录创建与删除修订，旧文件里的同对象无法复活
        state.revision.tombstones[removedId] = { createdRev: meta?.createdRev ?? rev, deletedRev: rev }
        delete state.revision.objectMeta[removedId]
      }
      state.objects = state.objects.filter((item) => !removed.has(item.id))
      if (state.selectedId && removed.has(state.selectedId)) state.selectedId = null
      state.notice = `已删除 ${removed.size} 个对象`
      touch(state, true)
      checkpoint(state)
    }),

    duplicate: (id) => set((state: EditorState) => {
      const source = state.objects.find((item) => item.id === id)
      if (!source) return
      const rev = pushHistory(state, '复制对象')
      const copy = JSON.parse(JSON.stringify(source)) as SceneObject
      copy.id = uid(source.type)
      copy.name = `${source.name} 副本`
      copy.position[0] += 0.8
      state.objects.push(copy)
      state.revision.objectMeta[copy.id] = { createdRev: rev, fieldRevs: fullFieldRevs(rev) }
      state.selectedId = copy.id
      state.notice = '已复制物体'
      touch(state, true)
      checkpoint(state)
    }),

    setTransformMode: (mode) => set((state: EditorState) => { state.transformMode = mode }),
    setSnapEnabled: (enabled) => set((state: EditorState) => { state.snapEnabled = enabled }),
    setSnapSize: (size) => set((state: EditorState) => { state.snapSize = size }),
    setPerformance: (patch) => set((state: EditorState) => { Object.assign(state.performance, patch) }),

    align: (axis) => set((state: EditorState) => {
      const object = state.objects.find((item) => item.id === state.selectedId)
      if (!object || object.position[axis] === 0) return
      const rev = pushHistory(state, '对齐')
      object.position[axis] = 0
      stamp(state, object.id, ['position'], rev)
      state.notice = `已沿 ${['X', 'Y', 'Z'][axis]} 轴对齐到原点`
      touch(state)
      checkpoint(state)
    }),

    addStressObjects: (count = 240) => set((state: EditorState) => {
      const rev = pushHistory(state, '压力测试')
      for (let index = 0; index < count; index += 1) {
        const type: ObjectType = index % 3 === 0 ? 'box' : index % 3 === 1 ? 'sphere' : 'cylinder'
        const object = createSceneObject(type)
        const grid = 20
        object.name = `压力测试 ${index + 1}`
        object.position = [((index % grid) - grid / 2) * 0.75, 0.35 + Math.floor(index / (grid * grid)) * 0.7, (Math.floor(index / grid) % grid - grid / 2) * 0.75]
        object.scale = [0.25, 0.25, 0.25]
        object.material.color = ['#3b82f6', '#14b8a6', '#f59e0b', '#ef4444'][index % 4]
        state.objects.push(object)
        state.revision.objectMeta[object.id] = { createdRev: rev, fieldRevs: fullFieldRevs(rev) }
      }
      state.performance.instanceMode = true
      state.notice = `已添加 ${count} 个几何体并开启实例化渲染`
      touch(state, true)
      checkpoint(state)
    }),

    loadScene: (raw) => set((state: EditorState) => {
      const { document, migrated } = migrateDocument(raw)
      state.name = document.name
      state.objects = document.objects
      state.revision = document.revision
      state.selectedId = document.objects[0]?.id ?? null
      state.snapshots = {}
      state.pendingMerge = null
      state.mergeFailure = null
      touch(state, true)
      checkpoint(state)
      state.notice = migrated ? '旧版场景已迁移兼容' : '场景 JSON 已导入'
    }),

    importDocument: (raw) => {
      try {
        const { document, migrated } = migrateDocument(raw)
        if (migrated) {
          // 旧文件没有修订信息，无法三方合并：迁移兼容后直接读入
          get().loadScene(document)
          set((state: EditorState) => { state.notice = '旧版场景缺少修订信息，已迁移兼容后导入' })
          return
        }
        get().mergeScene(document)
      } catch (error) {
        set((state: EditorState) => {
          state.notice = error instanceof Error ? error.message : '场景文件无效'
        })
      }
    },

    mergeScene: (document) => {
      const state = get()
      const backup = snapshotOf(state.name, state.objects, state.revision, true)
      const backupSelection = state.selectedId
      try {
        if (!document.revision) throw new Error('场景文件缺少修订信息，无法合并')
        const theirRevision = document.revision
        const entries = new Map<string, RevisionEntry>()
        for (const entry of [...state.revision.history, ...theirRevision.history]) entries.set(entry.id, entry)
        const ourHead = state.revision.head
        const theirHead = theirRevision.head

        if (theirHead === ourHead || isAncestorRev(theirHead, ourHead, entries)) {
          set((draft: EditorState) => { draft.notice = '文件版本不新于当前场景，无需合并' })
          return
        }

        if (isAncestorRev(ourHead, theirHead, entries)) {
          // 对方在我们版本之上继续开发：直接快进
          set((draft: EditorState) => {
            draft.name = document.name
            draft.objects = JSON.parse(JSON.stringify(document.objects)) as SceneObject[]
            const known = new Set(draft.revision.history.map((entry) => entry.id))
            const mergedHistory = [...draft.revision.history, ...theirRevision.history.filter((entry) => !known.has(entry.id))]
            const capped = mergedHistory.length > MAX_HISTORY
              ? [mergedHistory[0], ...mergedHistory.slice(-(MAX_HISTORY - 1))]
              : mergedHistory
            draft.revision = { ...JSON.parse(JSON.stringify(theirRevision)) as RevisionState, history: capped }
            if (draft.selectedId && !draft.objects.some((object) => object.id === draft.selectedId)) draft.selectedId = null
            draft.mergeFailure = null
            touch(draft, true)
            checkpoint(draft)
            draft.notice = '已快进到文件中的较新版本'
          })
          return
        }

        const oursSnapshot = snapshotOf(state.name, state.objects, state.revision)
        const { base } = findMergeBase(state.revision, theirRevision, state.snapshots)
        const outcome = mergeScenes(base, oursSnapshot, {
          name: document.name,
          objects: document.objects,
          revision: theirRevision,
        })
        if (!base) outcome.notes.unshift({ kind: 'baseline', message: '未找到共同祖先，已按空基线合并' })

        if (outcome.conflicts.length > 0) {
          // 有冲突先不落地，等裁决；当前场景保持原样
          set((draft: EditorState) => {
            draft.pendingMerge = { outcome, theirHead, theirHistory: theirRevision.history, theirName: document.name }
            draft.notice = `合并有 ${outcome.conflicts.length} 处冲突，请逐条裁决`
          })
          return
        }
        set((draft: EditorState) => commitMerge(draft, outcome, theirHead, theirRevision.history, document.name))
      } catch (error) {
        const message = error instanceof Error ? error.message : '合并过程出错'
        set((draft: EditorState) => {
          restoreBackup(draft, backup, backupSelection)
          draft.pendingMerge = null
          draft.mergeFailure = { message, document }
          draft.notice = `合并失败：${message}。当前场景未受影响，可重试。`
        })
      }
    },

    resolveMerge: (resolutions) => {
      const pending = get().pendingMerge
      if (!pending) return
      const state = get()
      const backup = snapshotOf(state.name, state.objects, state.revision, true)
      const backupSelection = state.selectedId
      try {
        const resolved = applyResolutions(pending.outcome, resolutions)
        const notes = [...pending.outcome.notes]
        // 裁决可能改变 parentId，重新修复并校验层级
        repairHierarchy(resolved.objects, null, notes, pending.outcome.mergeRev, resolved.objectMeta)
        assertValidHierarchy(resolved.objects)
        const outcome: MergeOutcome = { ...pending.outcome, ...resolved, notes }
        set((draft: EditorState) => {
          commitMerge(draft, outcome, pending.theirHead, pending.theirHistory, pending.theirName)
          draft.notice = `合并完成：已裁决 ${pending.outcome.conflicts.length} 处冲突`
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : '应用裁决出错'
        set((draft: EditorState) => {
          restoreBackup(draft, backup, backupSelection)
          draft.notice = `应用裁决失败：${message}。现场已保留，请重新裁决。`
        })
      }
    },

    cancelMerge: () => set((state: EditorState) => {
      state.pendingMerge = null
      state.notice = '已取消合并，当前场景未改动'
    }),

    retryMerge: () => {
      const failure = get().mergeFailure
      if (!failure) return
      set((state: EditorState) => { state.mergeFailure = null })
      get().mergeScene(failure.document)
    },

    dismissMergeFailure: () => set((state: EditorState) => { state.mergeFailure = null }),

    exportDocument: () => {
      const state = get()
      return {
        version: 2,
        name: state.name,
        objects: JSON.parse(JSON.stringify(state.objects)) as SceneObject[],
        savedAt: new Date().toISOString(),
        revision: JSON.parse(JSON.stringify(state.revision)) as RevisionState,
      }
    },

    reset: () => set((state: EditorState) => {
      state.name = '产品发布会三维展台'
      state.objects = createStarterScene()
      state.revision = genesisRevisionState()
      state.snapshots = {}
      state.selectedId = 'hero-box'
      state.pendingMerge = null
      state.mergeFailure = null
      touch(state, true)
      checkpoint(state)
      state.notice = '已恢复示例场景'
    }),

    noticeMessage: (message) => set((state: EditorState) => { state.notice = message }),
  }
}))

export function updateVector(vector: Vec3, axis: 0 | 1 | 2, value: number): Vec3 {
  const next: Vec3 = [...vector]
  next[axis] = value
  return next
}
