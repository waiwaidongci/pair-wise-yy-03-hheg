import type { SceneObject } from './scene'

/** 参与合并追踪的对象字段路径（对象、父子层级、材质都在此列） */
export type FieldPath =
  | 'name'
  | 'parentId'
  | 'visible'
  | 'position'
  | 'rotation'
  | 'scale'
  | 'castShadow'
  | 'receiveShadow'
  | 'material.color'
  | 'material.roughness'
  | 'material.metalness'
  | 'material.opacity'
  | 'material.wireframe'
  | 'intensity'
  | 'distance'
  | 'fov'
  | 'activeCamera'

export interface ObjectMeta {
  /** 对象创建时的修订号：区分“旧文件里的同一对象”与“恰好同 id 的新对象” */
  createdRev: string
  /** 每个字段最后一次被哪个修订修改 */
  fieldRevs: Partial<Record<FieldPath, string>>
}

/** 删除墓碑：阻止旧文件把已删除对象带回来 */
export interface Tombstone {
  createdRev: string
  deletedRev: string
}

export interface RevisionEntry {
  id: string
  parents: string[]
  at: string
  label: string
}

export interface RevisionState {
  head: string
  objectMeta: Record<string, ObjectMeta>
  tombstones: Record<string, Tombstone>
  history: RevisionEntry[]
}

/** 某一修订上的场景快照，作为三方合并的基线 */
export interface SceneSnapshot {
  name: string
  objects: SceneObject[]
  revision: RevisionState
}

export type ConflictSide = 'ours' | 'theirs'

export interface MergeConflict {
  objectId: string
  objectName: string
  /** 'object' 表示整对象冲突（一方删除、一方修改） */
  field: FieldPath | 'object'
  baseValue: unknown
  oursValue: unknown
  theirsValue: unknown
}

export interface MergeNote {
  kind: 'auto' | 'cycle' | 'orphan' | 'tombstone' | 'migration' | 'baseline'
  message: string
}

export interface MergeOutcome {
  objects: SceneObject[]
  objectMeta: Record<string, ObjectMeta>
  tombstones: Record<string, Tombstone>
  conflicts: MergeConflict[]
  notes: MergeNote[]
  /** 本次合并产生的修订号，冲突裁决与环路修复都用它盖章 */
  mergeRev: string
}
