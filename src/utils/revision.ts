import type { MaterialSpec, ObjectType, SceneDocument, SceneObject, Vec3 } from '../types/scene'
import type { FieldPath, MergeNote, ObjectMeta, RevisionState, SceneSnapshot } from '../types/revision'
import { repairHierarchy } from './hierarchy'
import { createSceneObject, createStarterScene, TYPE_LABELS, uid } from './scene'

/** 初始场景的固定修订号：所有客户端从同一份示例场景出发，天然拥有共同祖先 */
export const GENESIS_REV = 'rev-genesis'
export const MAX_HISTORY = 300
export const MAX_SNAPSHOTS = 60

export const TRACKED_FIELDS: FieldPath[] = [
  'name',
  'parentId',
  'visible',
  'position',
  'rotation',
  'scale',
  'castShadow',
  'receiveShadow',
  'material.color',
  'material.roughness',
  'material.metalness',
  'material.opacity',
  'material.wireframe',
  'intensity',
  'distance',
  'fov',
  'activeCamera',
]

export const FIELD_LABELS: Record<FieldPath, string> = {
  name: '名称',
  parentId: '父级',
  visible: '可见性',
  position: '位置',
  rotation: '旋转',
  scale: '缩放',
  castShadow: '投射阴影',
  receiveShadow: '接收阴影',
  'material.color': '材质颜色',
  'material.roughness': '粗糙度',
  'material.metalness': '金属度',
  'material.opacity': '不透明度',
  'material.wireframe': '线框模式',
  intensity: '光照强度',
  distance: '衰减距离',
  fov: '视场角',
  activeCamera: '活动相机',
}

export function getField(object: SceneObject, field: FieldPath): unknown {
  if (field.startsWith('material.')) {
    return object.material[field.slice('material.'.length) as keyof MaterialSpec]
  }
  return object[field as keyof SceneObject]
}

export function setField(object: SceneObject, field: FieldPath, value: unknown): void {
  if (field.startsWith('material.')) {
    const key = field.slice('material.'.length) as keyof MaterialSpec
    ;(object.material as unknown as Record<string, unknown>)[key] = value
    return
  }
  ;(object as unknown as Record<string, unknown>)[field] = value
}

export function fieldValuesEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, index) => item === b[index])
  }
  return a === b
}

export function newRevisionId(): string {
  return uid('rev')
}

export function fullFieldRevs(rev: string): Record<FieldPath, string> {
  return Object.fromEntries(TRACKED_FIELDS.map((field) => [field, rev])) as Record<FieldPath, string>
}

/** 初始场景的修订状态：所有客户端一致，保证首次交换文件就能找到共同祖先 */
export function genesisRevisionState(): RevisionState {
  const objectMeta: Record<string, ObjectMeta> = {}
  for (const object of createStarterScene()) {
    objectMeta[object.id] = { createdRev: GENESIS_REV, fieldRevs: fullFieldRevs(GENESIS_REV) }
  }
  return {
    head: GENESIS_REV,
    objectMeta,
    tombstones: {},
    history: [{ id: GENESIS_REV, parents: [], at: new Date().toISOString(), label: '初始场景' }],
  }
}

/** 深拷贝快照；withHistory 为 false 时不复制历史（合并基线不需要，省内存） */
export function snapshotOf(name: string, objects: SceneObject[], revision: RevisionState, withHistory = false): SceneSnapshot {
  return JSON.parse(
    JSON.stringify({ name, objects, revision: { ...revision, history: withHistory ? revision.history : [] } }),
  ) as SceneSnapshot
}

function isVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number' && Number.isFinite(item))
}

/** 把来源不明的对象数据清洗成合法 SceneObject，缺省字段按类型默认值补齐 */
function sanitizeObject(raw: unknown): SceneObject {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const type: ObjectType =
    typeof source.type === 'string' && source.type in TYPE_LABELS ? (source.type as ObjectType) : 'box'
  const fallback = createSceneObject(type)
  const vec = (value: unknown, defaultValue: Vec3): Vec3 => (isVec3(value) ? [value[0], value[1], value[2]] : [...defaultValue])
  const num = (value: unknown, defaultValue: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : defaultValue
  const bool = (value: unknown, defaultValue: boolean) => (typeof value === 'boolean' ? value : defaultValue)
  const material = (source.material && typeof source.material === 'object' ? source.material : {}) as Record<string, unknown>

  const object: SceneObject = {
    id: typeof source.id === 'string' && source.id ? source.id : uid(type),
    name: typeof source.name === 'string' && source.name ? source.name : fallback.name,
    type,
    parentId: typeof source.parentId === 'string' ? source.parentId : null,
    visible: bool(source.visible, true),
    position: vec(source.position, fallback.position),
    rotation: vec(source.rotation, fallback.rotation),
    scale: vec(source.scale, fallback.scale),
    castShadow: bool(source.castShadow, fallback.castShadow),
    receiveShadow: bool(source.receiveShadow, fallback.receiveShadow),
    material: {
      color: typeof material.color === 'string' ? material.color : fallback.material.color,
      roughness: num(material.roughness, fallback.material.roughness),
      metalness: num(material.metalness, fallback.material.metalness),
      opacity: num(material.opacity, fallback.material.opacity),
      wireframe: bool(material.wireframe, fallback.material.wireframe),
    },
  }
  if (fallback.intensity !== undefined || source.intensity !== undefined) {
    object.intensity = num(source.intensity, fallback.intensity ?? 1)
  }
  if (fallback.distance !== undefined || source.distance !== undefined) {
    object.distance = num(source.distance, fallback.distance ?? 12)
  }
  if (fallback.fov !== undefined || source.fov !== undefined) {
    object.fov = num(source.fov, fallback.fov ?? 50)
  }
  if (fallback.activeCamera !== undefined || source.activeCamera !== undefined) {
    object.activeCamera = bool(source.activeCamera, false)
  }
  return object
}

/** 清洗对象列表：id 去重、悬空父级置根、层级环路打断 */
export function sanitizeObjects(rawList: unknown[]): { objects: SceneObject[]; notes: MergeNote[] } {
  const notes: MergeNote[] = []
  const seen = new Set<string>()
  const objects = rawList.map((raw) => sanitizeObject(raw))
  for (const object of objects) {
    if (seen.has(object.id)) {
      const next = uid(object.type)
      notes.push({ kind: 'migration', message: `对象 id ${object.id} 重复，已改为 ${next}` })
      object.id = next
    }
    seen.add(object.id)
  }
  repairHierarchy(objects, null, notes, 'sanitize')
  return { objects, notes }
}

export interface MigratedDocument {
  document: SceneDocument & { revision: RevisionState }
  /** true 表示旧版文件被迁移兼容过 */
  migrated: boolean
  notes: string[]
}

/**
 * 读入场景文件并兼容旧格式：
 * - v2 且修订信息完整 → 清洗后直接使用
 * - 旧版（无修订信息）→ 补齐字段、生成迁移修订、全字段盖章后再读入
 */
export function migrateDocument(raw: unknown): MigratedDocument {
  if (!raw || typeof raw !== 'object') throw new Error('场景文件无效：不是 JSON 对象')
  const candidate = raw as Partial<SceneDocument>
  if (!Array.isArray(candidate.objects)) throw new Error('场景 JSON 缺少 objects')
  const name = typeof candidate.name === 'string' && candidate.name ? candidate.name : '未命名场景'
  const savedAt = typeof candidate.savedAt === 'string' ? candidate.savedAt : new Date().toISOString()
  const { objects, notes } = sanitizeObjects(candidate.objects)
  const revision = candidate.revision as Partial<RevisionState> | undefined

  if (
    candidate.version === 2 &&
    revision &&
    typeof revision.head === 'string' &&
    revision.objectMeta &&
    typeof revision.objectMeta === 'object' &&
    revision.tombstones &&
    typeof revision.tombstones === 'object' &&
    Array.isArray(revision.history)
  ) {
    // v2 文件：补齐缺失的字段戳（旧版本应用可能没写全）
    const objectMeta: Record<string, ObjectMeta> = {}
    for (const object of objects) {
      const existing = revision.objectMeta[object.id]
      objectMeta[object.id] = {
        createdRev: typeof existing?.createdRev === 'string' ? existing.createdRev : revision.head,
        fieldRevs: { ...(existing?.fieldRevs ?? {}) },
      }
    }
    const history = revision.history
      .filter((entry) => entry && typeof entry.id === 'string' && Array.isArray(entry.parents))
      .map((entry) => ({ id: entry.id, parents: entry.parents, at: entry.at ?? savedAt, label: entry.label ?? '修订' }))
    if (!history.some((entry) => entry.id === revision.head)) {
      history.push({ id: revision.head, parents: [], at: savedAt, label: '文件头修订' })
    }
    return {
      document: {
        version: 2,
        name,
        objects,
        savedAt,
        revision: { head: revision.head, objectMeta, tombstones: { ...revision.tombstones }, history },
      },
      migrated: false,
      notes: notes.map((note) => note.message),
    }
  }

  // 旧版文件：迁移兼容，所有字段盖上迁移修订的戳
  const rev = newRevisionId()
  const objectMeta: Record<string, ObjectMeta> = {}
  for (const object of objects) {
    objectMeta[object.id] = { createdRev: rev, fieldRevs: fullFieldRevs(rev) }
  }
  notes.unshift({ kind: 'migration', message: '旧版场景缺少修订信息，已迁移兼容' })
  return {
    document: {
      version: 2,
      name,
      objects,
      savedAt,
      revision: {
        head: rev,
        objectMeta,
        tombstones: {},
        history: [{ id: rev, parents: [], at: savedAt, label: '旧版迁移' }],
      },
    },
    migrated: true,
    notes: notes.map((note) => note.message),
  }
}
