import { useMemo } from 'react'
import { useEditorStore } from '../stores/editor'
import { buildExportPreview, computeWorldBounds, type ExportPreview, type WorldBounds } from '../utils/derived'

/**
 * 场景派生数据统一走这里：依赖 sceneVersion 作为失效令牌。
 * 对象层级或属性一变化，store 会递增 sceneVersion（结构变化另递增 structureVersion），
 * 于是世界包围盒与导出预览自动失效并重算。
 */
export function useWorldBounds(): WorldBounds | null {
  const sceneVersion = useEditorStore((state) => state.sceneVersion)
  return useMemo(() => computeWorldBounds(useEditorStore.getState().objects), [sceneVersion])
}

export function useExportPreview(enabled: boolean): ExportPreview | null {
  const sceneVersion = useEditorStore((state) => state.sceneVersion)
  return useMemo(() => {
    if (!enabled) return null
    const state = useEditorStore.getState()
    return buildExportPreview(state.name, state.objects, state.revision)
  }, [enabled, sceneVersion])
}
