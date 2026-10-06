import type {
  MergeConflict,
  MergeNote,
  MergeOutcome,
  ObjectMeta,
  RevisionEntry,
  RevisionState,
  SceneSnapshot,
  Tombstone,
} from '../types/revision'
import type { SceneObject } from '../types/scene'
import { assertValidHierarchy, repairHierarchy } from './hierarchy'
import { TRACKED_FIELDS, fieldValuesEqual, fullFieldRevs, getField, newRevisionId, setField } from './revision'

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/** ancestor 是否为 head 的祖先（或相等）；entries 里查不到的修订按链条终点处理 */
export function isAncestorRev(ancestor: string, head: string, entries: Map<string, RevisionEntry>): boolean {
  const visited = new Set<string>()
  const queue = [head]
  while (queue.length > 0) {
    const id = queue.pop()!
    if (id === ancestor) return true
    if (visited.has(id)) continue
    visited.add(id)
    const entry = entries.get(id)
    if (entry) queue.push(...entry.parents)
  }
  return false
}

function collectAncestors(head: string, entries: Map<string, RevisionEntry>): Set<string> {
  const result = new Set<string>()
  const queue = [head]
  while (queue.length > 0) {
    const id = queue.pop()!
    if (result.has(id)) continue
    result.add(id)
    const entry = entries.get(id)
    if (entry) queue.push(...entry.parents)
  }
  return result
}

/**
 * 寻找三方合并的基线：双方修订历史的共同祖先中，本地仍有快照且最深（最新）的那个。
 * 找不到就返回 null，调用方按空基线合并（退化为按值比对）。
 */
export function findMergeBase(
  ours: RevisionState,
  theirs: RevisionState,
  snapshots: Record<string, SceneSnapshot>,
): { base: SceneSnapshot | null; ancestorId: string | null } {
  const entries = new Map<string, RevisionEntry>()
  for (const entry of [...ours.history, ...theirs.history]) entries.set(entry.id, entry)
  const ourAncestors = collectAncestors(ours.head, entries)
  const theirAncestors = collectAncestors(theirs.head, entries)
  const candidates = [...ourAncestors].filter((id) => theirAncestors.has(id) && snapshots[id])
  if (candidates.length === 0) return { base: null, ancestorId: null }

  const depthCache = new Map<string, number>()
  const depth = (id: string): number => {
    const cached = depthCache.get(id)
    if (cached !== undefined) return cached
    const entry = entries.get(id)
    if (!entry || entry.parents.length === 0) {
      depthCache.set(id, 0)
      return 0
    }
    const value = 1 + Math.max(...entry.parents.map(depth))
    depthCache.set(id, value)
    return value
  }
  candidates.sort((a, b) => depth(b) - depth(a))
  const ancestorId = candidates[0]
  return { base: snapshots[ancestorId], ancestorId }
}

/** 对象相对基线是否原封不动（所有追踪字段按值相等） */
function objectMatches(candidate: SceneObject, base: SceneObject): boolean {
  return TRACKED_FIELDS.every((field) => fieldValuesEqual(getField(candidate, field), getField(base, field)))
}

function cloneMeta(meta: ObjectMeta | undefined, fallbackRev: string): ObjectMeta {
  if (meta) return clone(meta)
  return { createdRev: fallbackRev, fieldRevs: fullFieldRevs(fallbackRev) }
}

/**
 * 三方合并：
 * - 只有一边改过的字段直接采用
 * - 同一对象同一字段双方都改过且值不同 → 记入 conflicts 等待裁决（暂用我方值）
 * - 一方删除、另一方没动过 → 保持删除（旧文件无法复活已删对象）
 * - 一方删除、另一方改过了 → 整对象冲突
 * 合并结果会修复悬空父级与层级环路，修复不了则抛错。
 */
export function mergeScenes(base: SceneSnapshot | null, ours: SceneSnapshot, theirs: SceneSnapshot): MergeOutcome {
  const mergeRev = newRevisionId()
  const notes: MergeNote[] = []
  const conflicts: MergeConflict[] = []
  const baseById = new Map((base?.objects ?? []).map((object) => [object.id, object]))
  const ourById = new Map(ours.objects.map((object) => [object.id, object]))
  const theirById = new Map(theirs.objects.map((object) => [object.id, object]))
  const baseMeta = base?.revision.objectMeta ?? {}
  const ourMeta = ours.revision.objectMeta
  const theirMeta = theirs.revision.objectMeta
  const ids = new Set([...baseById.keys(), ...ourById.keys(), ...theirById.keys()])
  const objects: SceneObject[] = []
  const objectMeta: Record<string, ObjectMeta> = {}
  const tombstones: Record<string, Tombstone> = { ...clone(ours.revision.tombstones), ...clone(theirs.revision.tombstones) }
  let tookOurs = 0
  let tookTheirs = 0
  let added = 0
  let deleted = 0

  for (const id of ids) {
    const baseObject = baseById.get(id) ?? null
    const ourObject = ourById.get(id) ?? null
    const theirObject = theirById.get(id) ?? null
    if (!ourObject && !theirObject) continue
    const ourTombstone = ours.revision.tombstones[id]
    const theirTombstone = theirs.revision.tombstones[id]

    if (!ourObject) {
      // 我方没有：被我方删除，或对方新增
      if (baseObject && ourTombstone) {
        if (objectMatches(theirObject!, baseObject)) {
          deleted += 1
          notes.push({ kind: 'tombstone', message: `「${theirObject!.name}」已在我方删除，未因旧文件恢复` })
        } else {
          conflicts.push({
            objectId: id,
            objectName: theirObject!.name,
            field: 'object',
            baseValue: baseObject.name,
            oursValue: null,
            theirsValue: { object: clone(theirObject!), meta: cloneMeta(theirMeta[id], mergeRev) },
          })
        }
        continue
      }
      if (ourTombstone && theirMeta[id]?.createdRev === ourTombstone.createdRev) {
        // 同一个对象（createdRev 一致）且我方已删除：旧文件不能把它带回来
        deleted += 1
        notes.push({ kind: 'tombstone', message: `「${theirObject!.name}」已在我方删除，未因旧文件恢复` })
        continue
      }
      objects.push(clone(theirObject!))
      objectMeta[id] = cloneMeta(theirMeta[id], mergeRev)
      delete tombstones[id]
      added += 1
      continue
    }

    if (!theirObject) {
      // 对方没有：被对方删除，或我方新增
      if (baseObject && theirTombstone) {
        if (objectMatches(ourObject, baseObject)) {
          deleted += 1
          notes.push({ kind: 'tombstone', message: `「${ourObject.name}」已在对方删除` })
        } else {
          conflicts.push({
            objectId: id,
            objectName: ourObject.name,
            field: 'object',
            baseValue: baseObject.name,
            oursValue: { object: clone(ourObject), meta: cloneMeta(ourMeta[id], mergeRev) },
            theirsValue: null,
          })
        }
        continue
      }
      if (theirTombstone && ourMeta[id]?.createdRev === theirTombstone.createdRev) {
        deleted += 1
        notes.push({ kind: 'tombstone', message: `「${ourObject.name}」已在对方删除` })
        continue
      }
      objects.push(clone(ourObject))
      objectMeta[id] = cloneMeta(ourMeta[id], mergeRev)
      delete tombstones[id]
      continue
    }

    // 双方都有：逐字段三方合并
    const merged = clone(ourObject)
    const mergedMeta: ObjectMeta = {
      createdRev: ourMeta[id]?.createdRev ?? theirMeta[id]?.createdRev ?? mergeRev,
      fieldRevs: { ...(ourMeta[id]?.fieldRevs ?? {}) },
    }
    for (const field of TRACKED_FIELDS) {
      const ourValue = getField(ourObject, field)
      const theirValue = getField(theirObject, field)
      if (fieldValuesEqual(ourValue, theirValue)) continue
      const baseValue = baseObject ? getField(baseObject, field) : undefined
      const baseStamp = baseMeta[id]?.fieldRevs?.[field]
      const ourChanged = baseObject
        ? ourMeta[id]?.fieldRevs?.[field] !== baseStamp || !fieldValuesEqual(ourValue, baseValue)
        : true
      const theirChanged = baseObject
        ? theirMeta[id]?.fieldRevs?.[field] !== baseStamp || !fieldValuesEqual(theirValue, baseValue)
        : true
      if (ourChanged && !theirChanged) {
        tookOurs += 1
        continue // merged 暂存的就是我方值
      }
      if (!ourChanged && theirChanged) {
        setField(merged, field, clone(theirValue))
        mergedMeta.fieldRevs[field] = theirMeta[id]?.fieldRevs?.[field] ?? mergeRev
        tookTheirs += 1
        continue
      }
      // 双方都改过（或戳值对不上的异常数据）且值不同 → 冲突，暂用我方值等裁决
      conflicts.push({
        objectId: id,
        objectName: ourObject.name,
        field,
        baseValue: baseValue ?? null,
        oursValue: ourValue ?? null,
        theirsValue: theirValue ?? null,
      })
    }
    objects.push(merged)
    objectMeta[id] = mergedMeta
    delete tombstones[id]
  }

  repairHierarchy(objects, baseById, notes, mergeRev, objectMeta)
  assertValidHierarchy(objects)
  notes.unshift({
    kind: 'auto',
    message: `自动合并：采用我方 ${tookOurs} 处、对方 ${tookTheirs} 处，新增 ${added} 个、删除 ${deleted} 个对象`,
  })
  return { objects, objectMeta, tombstones, conflicts, notes, mergeRev }
}

export function conflictKey(conflict: MergeConflict): string {
  return `${conflict.objectId}:${conflict.field}`
}

/** 把裁决结果应用到合并产物上；resolved 字段与删除都用合并修订盖章 */
export function applyResolutions(
  outcome: MergeOutcome,
  resolutions: Record<string, 'ours' | 'theirs'>,
): { objects: SceneObject[]; objectMeta: Record<string, ObjectMeta>; tombstones: Record<string, Tombstone> } {
  const objects = clone(outcome.objects)
  const objectMeta = clone(outcome.objectMeta)
  const tombstones = clone(outcome.tombstones)
  const mergeRev = outcome.mergeRev

  for (const conflict of outcome.conflicts) {
    const side = resolutions[conflictKey(conflict)] ?? 'ours'
    const value = side === 'ours' ? conflict.oursValue : conflict.theirsValue
    if (conflict.field === 'object') {
      const chosen = value as { object: SceneObject; meta?: ObjectMeta } | null
      const index = objects.findIndex((object) => object.id === conflict.objectId)
      if (!chosen) {
        if (index >= 0) objects.splice(index, 1)
        tombstones[conflict.objectId] = {
          createdRev: objectMeta[conflict.objectId]?.createdRev ?? mergeRev,
          deletedRev: mergeRev,
        }
        delete objectMeta[conflict.objectId]
      } else {
        const restored = clone(chosen.object)
        if (index >= 0) objects[index] = restored
        else objects.push(restored)
        objectMeta[conflict.objectId] = chosen.meta
          ? clone(chosen.meta)
          : { createdRev: mergeRev, fieldRevs: fullFieldRevs(mergeRev) }
        delete tombstones[conflict.objectId]
      }
      continue
    }
    const object = objects.find((item) => item.id === conflict.objectId)
    if (!object) continue
    setField(object, conflict.field, clone(value))
    const meta = objectMeta[conflict.objectId]
    if (meta) meta.fieldRevs[conflict.field] = mergeRev
  }
  return { objects, objectMeta, tombstones }
}
