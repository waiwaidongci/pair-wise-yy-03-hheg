import type { MaterialSpec, SceneObject, Vec3 } from '../types/scene'

/**
 * 离线三方合并引擎。
 *
 * 合并基准为共同祖先 base，本地场景 ours 与导入文件 theirs 分别是
 * base 之后的两条离线修订线：
 * - 只有一边改过的叶子字段直接采用；
 * - 同一对象同一字段双方都改过且不一致 → 列入冲突裁决；
 * - 任一方删除的对象保留墓碑，旧文件无法将其带回；
 * - 合并结果的层级关系不允许出现环路。
 */

export interface FieldConflict {
  kind: 'field'
  objectId: string
  objectName: string
  /** 叶子字段路径，如 position.0 / material.color */
  path: string
  label: string
  baseValue: unknown
  oursValue: unknown
  theirsValue: unknown
}

export interface ModifyDeleteConflict {
  kind: 'modify-delete'
  objectId: string
  objectName: string
  deletedBy: 'ours' | 'theirs'
  modifiedBy: 'ours' | 'theirs'
}

export interface CycleConflict {
  kind: 'cycle'
  /** 成环的对象 id 链（末对象的父级指向首对象） */
  cycle: string[]
}

export type Conflict = FieldConflict | ModifyDeleteConflict | CycleConflict

export interface MergeResult {
  objects: SceneObject[]
  conflicts: Conflict[]
}

export interface ResolutionMap {
  /** 字段级裁决，键为 `${objectId}:${path}`，默认采用本地 */
  fields: Record<string, 'ours' | 'theirs'>
  /** 修改/删除冲突裁决，键为 objectId */
  delete: Record<string, 'delete' | 'resurrect'>
  /** 环路裁决 */
  cycle?: 'ours' | 'theirs' | 'break'
}

export const emptyResolutions = (): ResolutionMap => ({ fields: {}, delete: {}, cycle: undefined })

// ---- 叶子字段定义 ----

const SCALAR_LEAVES: Array<{ key: keyof SceneObject; label: string }> = [
  { key: 'name', label: '名称' },
  { key: 'type', label: '类型' },
  { key: 'parentId', label: '父级对象' },
  { key: 'visible', label: '可见性' },
  { key: 'castShadow', label: '投射阴影' },
  { key: 'receiveShadow', label: '接收阴影' },
  { key: 'intensity', label: '光照强度' },
  { key: 'distance', label: '光照距离' },
  { key: 'fov', label: '视野 FOV' },
  { key: 'activeCamera', label: '活动相机' },
]

const VEC_LEAVES: Array<{ key: keyof SceneObject; label: string }> = [
  { key: 'position', label: '位置' },
  { key: 'rotation', label: '旋转' },
  { key: 'scale', label: '缩放' },
]

const MATERIAL_LEAVES: Array<{ key: keyof MaterialSpec; label: string }> = [
  { key: 'color', label: '材质颜色' },
  { key: 'roughness', label: '粗糙度' },
  { key: 'metalness', label: '金属度' },
  { key: 'opacity', label: '不透明度' },
  { key: 'wireframe', label: '线框模式' },
]

const AXIS_LABELS = ['X', 'Y', 'Z']

export interface LeafDef {
  path: string
  label: string
}

export function allLeaves(): LeafDef[] {
  const leaves: LeafDef[] = []
  for (const { key, label } of SCALAR_LEAVES) leaves.push({ path: key, label })
  for (const { key, label } of VEC_LEAVES) {
    for (let axis = 0; axis < 3; axis += 1) leaves.push({ path: `${key}.${axis}`, label: `${label} ${AXIS_LABELS[axis]}` })
  }
  for (const { key, label } of MATERIAL_LEAVES) leaves.push({ path: `material.${key}`, label })
  return leaves
}

export function getLeaf(object: SceneObject, path: string): unknown {
  const [head, tail] = path.split('.')
  if (head === 'material') return object.material[tail as keyof MaterialSpec]
  if (head === 'position' || head === 'rotation' || head === 'scale') {
    return (object[head] as Vec3)[Number(tail)]
  }
  return object[head as keyof SceneObject]
}

export function setLeaf(object: SceneObject, path: string, value: unknown): void {
  const [head, tail] = path.split('.')
  if (head === 'material') {
    object.material[tail as keyof MaterialSpec] = value as never
  } else if (head === 'position' || head === 'rotation' || head === 'scale') {
    ;(object[head] as Vec3)[Number(tail)] = value as number
  } else {
    ;(object as unknown as Record<string, unknown>)[head] = value
  }
}

function leafEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b) ? true : a === b
  return a === b
}

function cloneObject(object: SceneObject): SceneObject {
  return JSON.parse(JSON.stringify(object)) as SceneObject
}

function tombstone(id: string, rev: number): SceneObject {
  return {
    id,
    name: '',
    type: 'box',
    parentId: null,
    visible: false,
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
    castShadow: false,
    receiveShadow: false,
    material: { color: '#000000', roughness: 1, metalness: 0, opacity: 1, wireframe: false },
    rev,
    deleted: true,
  }
}

function changedLeaves(base: SceneObject, side: SceneObject): string[] {
  const changed: string[] = []
  for (const leaf of allLeaves()) {
    if (!leafEqual(getLeaf(base, leaf.path), getLeaf(side, leaf.path))) changed.push(leaf.path)
  }
  return changed
}

// ---- 环路检测 ----

/** 返回成环的对象 id 链，无环时返回 null */
export function findCycle(objects: SceneObject[]): string[] | null {
  const byId = new Map(objects.map((object) => [object.id, object]))
  for (const start of objects) {
    const seen = new Map<string, number>()
    const chain: string[] = []
    let current: string | null = start.id
    while (current) {
      if (seen.has(current)) return chain.slice(seen.get(current)!)
      seen.set(current, chain.length)
      chain.push(current)
      current = byId.get(current)?.parentId ?? null
    }
  }
  return null
}

// ---- 三方合并 ----

function mergeLiveObject(
  base: SceneObject,
  ours: SceneObject,
  theirs: SceneObject,
): { object: SceneObject; conflicts: FieldConflict[] } {
  const object = cloneObject(ours)
  object.deleted = false
  object.rev = Math.max(ours.rev, theirs.rev) + 1
  const conflicts: FieldConflict[] = []
  for (const leaf of allLeaves()) {
    const baseValue = getLeaf(base, leaf.path)
    const oursValue = getLeaf(ours, leaf.path)
    const theirsValue = getLeaf(theirs, leaf.path)
    const oursChanged = !leafEqual(baseValue, oursValue)
    const theirsChanged = !leafEqual(baseValue, theirsValue)
    if (oursChanged && theirsChanged) {
      if (leafEqual(oursValue, theirsValue)) {
        setLeaf(object, leaf.path, theirsValue)
      } else {
        conflicts.push({
          kind: 'field',
          objectId: object.id,
          objectName: object.name,
          path: leaf.path,
          label: leaf.label,
          baseValue,
          oursValue,
          theirsValue,
        })
      }
    } else if (theirsChanged) {
      setLeaf(object, leaf.path, theirsValue)
    }
  }
  return { object, conflicts }
}

/** 双方都新增了同一 id（base 中不存在） */
function mergeAddAdd(ours: SceneObject, theirs: SceneObject): { object: SceneObject; conflicts: FieldConflict[] } {
  const object = cloneObject(ours)
  object.deleted = false
  object.rev = Math.max(ours.rev, theirs.rev) + 1
  const conflicts: FieldConflict[] = []
  for (const leaf of allLeaves()) {
    const oursValue = getLeaf(ours, leaf.path)
    const theirsValue = getLeaf(theirs, leaf.path)
    if (!leafEqual(oursValue, theirsValue)) {
      conflicts.push({
        kind: 'field',
        objectId: object.id,
        objectName: object.name,
        path: leaf.path,
        label: leaf.label,
        baseValue: undefined,
        oursValue,
        theirsValue,
      })
    }
  }
  return { object, conflicts }
}

export function mergeDocuments(base: SceneObject[], ours: SceneObject[], theirs: SceneObject[]): MergeResult {
  const baseMap = new Map(base.map((object) => [object.id, object]))
  const oursMap = new Map(ours.map((object) => [object.id, object]))
  const theirsMap = new Map(theirs.map((object) => [object.id, object]))
  const ids = new Set<string>([...baseMap.keys(), ...oursMap.keys(), ...theirsMap.keys()])
  const merged: SceneObject[] = []
  const conflicts: Conflict[] = []

  for (const id of ids) {
    const baseObject = baseMap.get(id)
    const oursObject = oursMap.get(id)
    const theirsObject = theirsMap.get(id)
    const baseLive = baseObject !== undefined && baseObject.deleted !== true
    const oursLive = oursObject !== undefined && oursObject.deleted !== true
    const theirsLive = theirsObject !== undefined && theirsObject.deleted !== true

    if (!baseLive) {
      // 共同祖先中不存在：新增 / 新增冲突 / 双方墓碑
      if (oursLive && theirsLive && oursObject && theirsObject) {
        const result = mergeAddAdd(oursObject, theirsObject)
        merged.push(result.object)
        conflicts.push(...result.conflicts)
      } else if (oursLive && oursObject) {
        merged.push(cloneObject(oursObject))
      } else if (theirsLive && theirsObject) {
        merged.push(cloneObject(theirsObject))
      } else if (oursObject?.deleted || theirsObject?.deleted) {
        merged.push(tombstone(id, Math.max(oursObject?.rev ?? 0, theirsObject?.rev ?? 0)))
      }
      continue
    }

    if (!oursLive && !theirsLive) {
      merged.push(tombstone(id, Math.max(oursObject?.rev ?? baseObject.rev, theirsObject?.rev ?? baseObject.rev)))
      continue
    }

    if (!oursLive && theirsLive && theirsObject) {
      // 本地删除、文件方仍存活：文件方改过则构成 修改/删除 冲突
      if (changedLeaves(baseObject, theirsObject).length > 0) {
        conflicts.push({
          kind: 'modify-delete',
          objectId: id,
          objectName: theirsObject.name,
          deletedBy: 'ours',
          modifiedBy: 'theirs',
        })
        merged.push(cloneObject(theirsObject))
      } else {
        merged.push(tombstone(id, Math.max(oursObject?.rev ?? baseObject.rev, theirsObject.rev)))
      }
      continue
    }

    if (oursLive && !theirsLive && oursObject) {
      // 文件方删除、本地仍存活：本地改过则构成 修改/删除 冲突
      if (changedLeaves(baseObject, oursObject).length > 0) {
        conflicts.push({
          kind: 'modify-delete',
          objectId: id,
          objectName: oursObject.name,
          deletedBy: 'theirs',
          modifiedBy: 'ours',
        })
        merged.push(cloneObject(oursObject))
      } else {
        merged.push(tombstone(id, Math.max(oursObject.rev, theirsObject?.rev ?? baseObject.rev)))
      }
      continue
    }

    if (baseObject && oursObject && theirsObject) {
      const result = mergeLiveObject(baseObject, oursObject, theirsObject)
      merged.push(result.object)
      conflicts.push(...result.conflicts)
    }
  }

  const cycle = findCycle(merged.filter((object) => !object.deleted))
  if (cycle) conflicts.push({ kind: 'cycle', cycle })
  return { objects: merged, conflicts }
}

// ---- 应用裁决 ----

export function applyResolutions(
  merged: SceneObject[],
  conflicts: Conflict[],
  resolutions: ResolutionMap,
  ours: SceneObject[],
  theirs: SceneObject[],
): SceneObject[] {
  const result = merged.map((object) => cloneObject(object))
  const byId = new Map(result.map((object) => [object.id, object]))
  const oursMap = new Map(ours.map((object) => [object.id, object]))
  const theirsMap = new Map(theirs.map((object) => [object.id, object]))

  for (const conflict of conflicts) {
    if (conflict.kind === 'field') {
      if (resolutions.fields[`${conflict.objectId}:${conflict.path}`] === 'theirs') {
        const object = byId.get(conflict.objectId)
        if (object) setLeaf(object, conflict.path, conflict.theirsValue)
      }
    } else if (conflict.kind === 'modify-delete') {
      const object = byId.get(conflict.objectId)
      if (!object) continue
      const resolution = resolutions.delete[conflict.objectId]
      if (resolution === 'resurrect') {
        const modified = conflict.deletedBy === 'ours' ? theirsMap.get(conflict.objectId) : oursMap.get(conflict.objectId)
        if (modified) {
          const index = result.findIndex((item) => item.id === conflict.objectId)
          if (index >= 0) result[index] = cloneObject(modified)
        }
      } else if (resolution === 'delete') {
        object.deleted = true
      }
    } else if (conflict.kind === 'cycle') {
      const cycleResolution = resolutions.cycle
      if (cycleResolution === 'break') {
        const object = byId.get(conflict.cycle[conflict.cycle.length - 1])
        if (object) object.parentId = null
      } else if (cycleResolution === 'ours' || cycleResolution === 'theirs') {
        const side = cycleResolution === 'ours' ? oursMap : theirsMap
        for (const id of conflict.cycle) {
          const object = byId.get(id)
          const sideObject = side.get(id)
          if (object && sideObject) object.parentId = sideObject.parentId
        }
      }
    }
  }

  const remainingCycle = findCycle(result.filter((object) => !object.deleted))
  if (remainingCycle) throw new Error(`合并后仍存在层级环路：${remainingCycle.join(' → ')}`)
  return result
}
