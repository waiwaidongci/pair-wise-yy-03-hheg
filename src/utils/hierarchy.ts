import type { SceneObject } from '../types/scene'
import type { MergeNote, ObjectMeta } from '../types/revision'

/** 找出一组构成环路的对象 id；没有环路返回 null */
export function findCycleMembers(objects: SceneObject[]): string[] | null {
  const byId = new Map(objects.map((object) => [object.id, object]))
  // 0 未访问（隐式） / 1 在当前链上 / 2 已确认安全
  const mark = new Map<string, 1 | 2>()
  for (const start of objects) {
    if (mark.has(start.id)) continue
    const chain: string[] = []
    let cursor: string | null = start.id
    while (cursor) {
      const state = mark.get(cursor)
      if (state === 2) break
      if (state === 1) return chain.slice(chain.indexOf(cursor))
      mark.set(cursor, 1)
      chain.push(cursor)
      cursor = byId.get(cursor)?.parentId ?? null
    }
    for (const id of chain) mark.set(id, 2)
  }
  return null
}

/** 校验层级：id 不重复、父级存在、无环路；不满足时抛错（合并失败走保留现场路径） */
export function assertValidHierarchy(objects: SceneObject[]): void {
  const byId = new Map<string, SceneObject>()
  for (const object of objects) {
    if (byId.has(object.id)) throw new Error(`对象 id 重复：${object.id}`)
    byId.set(object.id, object)
  }
  for (const object of objects) {
    if (object.parentId && !byId.has(object.parentId)) {
      throw new Error(`「${object.name}」的父级 ${object.parentId} 不存在`)
    }
  }
  const cycle = findCycleMembers(objects)
  if (cycle) throw new Error(`层级存在环路：${cycle.join(' → ')}`)
}

function stampParent(objectMeta: Record<string, ObjectMeta> | undefined, id: string, rev: string) {
  const meta = objectMeta?.[id]
  if (meta) meta.fieldRevs.parentId = rev
}

/**
 * 修复层级问题（直接修改传入数组）：
 * - 父级指向不存在的对象 → 移到场景根节点
 * - 父子层级成环 → 优先回退相对基线被改动的那条边，其次置为根节点
 * 修复不了就抛错，由调用方保留现场。
 */
export function repairHierarchy(
  objects: SceneObject[],
  baseById: Map<string, SceneObject> | null,
  notes: MergeNote[],
  rev: string,
  objectMeta?: Record<string, ObjectMeta>,
): void {
  const ids = new Set(objects.map((object) => object.id))
  for (const object of objects) {
    if (object.parentId && !ids.has(object.parentId)) {
      notes.push({ kind: 'orphan', message: `「${object.name}」的父级已不存在，已移到场景根节点` })
      object.parentId = null
      stampParent(objectMeta, object.id, rev)
    }
  }
  const byId = () => new Map(objects.map((object) => [object.id, object]))
  for (let round = 0; round <= objects.length; round += 1) {
    const cycle = findCycleMembers(objects)
    if (!cycle) return
    const lookup = byId()
    // 优先断开“相对基线被改过”的边；都是基线原样时断开 id 最小的，保证确定性
    const targetId =
      cycle.find((id) => {
        const base = baseById?.get(id)
        return !base || base.parentId !== lookup.get(id)?.parentId
      }) ?? [...cycle].sort()[0]
    const target = lookup.get(targetId)!
    const fallback = baseById?.get(targetId)?.parentId ?? null
    target.parentId = fallback && fallback !== targetId && ids.has(fallback) ? fallback : null
    stampParent(objectMeta, targetId, rev)
    notes.push({ kind: 'cycle', message: `检测到层级环路，已断开「${target.name}」的父级链接` })
  }
  throw new Error('层级环路无法自动修复')
}
