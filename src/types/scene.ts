export type Vec3 = [number, number, number]
export type ObjectType = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus' | 'plane' | 'directionalLight' | 'pointLight' | 'spotLight' | 'camera'
export type TransformMode = 'translate' | 'rotate' | 'scale'

export interface MaterialSpec {
  color: string
  roughness: number
  metalness: number
  opacity: number
  wireframe: boolean
}

export interface SceneObject {
  id: string
  name: string
  type: ObjectType
  parentId: string | null
  visible: boolean
  position: Vec3
  rotation: Vec3
  scale: Vec3
  castShadow: boolean
  receiveShadow: boolean
  material: MaterialSpec
  intensity?: number
  distance?: number
  fov?: number
  activeCamera?: boolean
  /** 本地修订号：每次字段变更自增，用于离线编辑后的三方合并 */
  rev: number
  /** 墓碑标记：对象已被删除，合并时阻止旧文件将其带回 */
  deleted?: boolean
}

export interface SceneDocument {
  version: 1 | 2
  name: string
  objects: SceneObject[]
  savedAt: string
  /** 文档修订号，随每次结构变更自增 */
  revision?: number
  /** 共同祖先快照：离线三方合并的基准，导出时嵌入文件 */
  base?: SceneObject[]
}

export interface PerformanceSettings {
  instanceMode: boolean
  shadows: boolean
  showGrid: boolean
  pixelRatio: number
}
