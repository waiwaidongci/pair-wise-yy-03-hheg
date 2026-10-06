import {
  AppBar,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Slider,
  Snackbar,
  Stack,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  CloudDownloadOutlined,
  CloudSyncOutlined,
  CloudUploadOutlined,
  OpenWithOutlined,
  RotateRightOutlined,
  SaveOutlined,
  ScaleOutlined,
  SpeedOutlined,
  UndoOutlined,
} from '@mui/icons-material'
import { useEffect, useMemo, useState } from 'react'
import HierarchyPanel from '../components/HierarchyPanel'
import InspectorPanel from '../components/InspectorPanel'
import SceneViewport from '../components/SceneViewport'
import MergeDialog from '../components/MergeDialog'
import ExportPreviewDialog from '../components/ExportPreviewDialog'
import { useEditorStore } from '../stores/editor'
import type { SceneDocument, TransformMode } from '../types/scene'
import { computeWorldBounds, liveObjects } from '../utils/scene'

export default function EditorView() {
  const store = useEditorStore()
  const selectedObject = store.objects.find((item) => item.id === store.selectedId && !item.deleted)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [mergeFile, setMergeFile] = useState<File | null>(null)
  const liveCount = liveObjects(store.objects).length
  const bounds = useMemo(() => computeWorldBounds(store.objects), [store.objects, store.sceneRevision])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.matches('input, textarea')) return
      if (event.key.toLowerCase() === 'g') store.setTransformMode('translate')
      if (event.key.toLowerCase() === 'r') store.setTransformMode('rotate')
      if (event.key.toLowerCase() === 's') store.setTransformMode('scale')
      if ((event.key === 'Delete' || event.key === 'Backspace') && store.selectedId) store.remove(store.selectedId)
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        exportScene()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  function buildDocument(): SceneDocument {
    return {
      version: 2,
      name: store.name,
      objects: store.objects,
      savedAt: new Date().toISOString(),
      revision: store.revision,
      base: store.baseObjects,
    }
  }

  function exportScene() {
    const document = buildDocument()
    const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = window.document.createElement('a')
    anchor.href = url
    anchor.download = `${store.name}.scene.json`
    anchor.click()
    URL.revokeObjectURL(url)
    store.noticeMessage('场景 JSON 已保存（v2 修订格式）')
  }

  async function importScene(file: File) {
    try {
      const document = JSON.parse(await file.text()) as SceneDocument
      if (!Array.isArray(document.objects)) throw new Error('场景 JSON 缺少 objects')
      store.loadScene(document)
    } catch (error) {
      store.noticeMessage(error instanceof Error ? error.message : '场景文件无效')
    }
  }

  async function mergeScene(file: File) {
    setMergeFile(file)
    try {
      const document = JSON.parse(await file.text())
      store.mergeSceneDocument(document, file.name)
    } catch (error) {
      store.mergeFailed(error instanceof Error ? error.message : '场景文件无效')
    }
  }

  function retryMerge() {
    if (mergeFile) mergeScene(mergeFile)
  }

  const modes: Array<{ value: TransformMode; label: string; icon: React.ReactNode }> = [
    { value: 'translate', label: '移动', icon: <OpenWithOutlined /> },
    { value: 'rotate', label: '旋转', icon: <RotateRightOutlined /> },
    { value: 'scale', label: '缩放', icon: <ScaleOutlined /> },
  ]

  return (
    <Box className="app-shell">
      <AppBar position="static" color="inherit" elevation={0} className="topbar">
        <Toolbar variant="dense" sx={{ gap: 1.5 }}>
          <Box className="brand-mark">SF</Box>
          <Box sx={{ minWidth: 170 }}>
            <Typography variant="subtitle1" fontWeight={800}>SceneForge</Typography>
            <Typography variant="caption" color="text.secondary">三维场景编辑器</Typography>
          </Box>
          <Button variant="outlined" size="small" onClick={() => store.setPerformance({ instanceMode: !store.performance.instanceMode })}>
            {store.performance.instanceMode ? '实例模式：开' : '实例模式：关'}
          </Button>
          <Button variant="outlined" size="small" startIcon={<SpeedOutlined />} onClick={() => store.addStressObjects(240)}>添加 240 个物体</Button>
          <Stack direction="row" spacing={0.5}>
            {modes.map((mode) => (
              <Tooltip key={mode.value} title={mode.label}>
                <Button
                  size="small"
                  variant={store.transformMode === mode.value ? 'contained' : 'outlined'}
                  startIcon={mode.icon}
                  onClick={() => store.setTransformMode(mode.value)}
                >
                  {mode.label}
                </Button>
              </Tooltip>
            ))}
          </Stack>
          <FormControlLabel
            control={<Checkbox size="small" checked={store.snapEnabled} onChange={(event) => store.setSnapEnabled(event.target.checked)} />}
            label="吸附"
          />
          <Box sx={{ width: 110 }}>
            <Typography variant="caption">步长 {store.snapSize}</Typography>
            <Slider size="small" min={0.1} max={1} step={0.05} value={store.snapSize} onChange={(_, value) => store.setSnapSize(value as number)} />
          </Box>
          <Box sx={{ flex: 1 }} />
          <Button size="small" startIcon={<UndoOutlined />} onClick={store.reset}>重置</Button>
          <Button size="small" component="label" startIcon={<CloudUploadOutlined />}>
            导入
            <input hidden type="file" accept=".json" onChange={(event) => event.target.files?.[0] && importScene(event.target.files[0])} />
          </Button>
          <Tooltip title="与当前场景做离线三方合并：只改一边直接采用，同字段双方都改则冲突裁决，删除不回退">
            <Button size="small" component="label" startIcon={<CloudSyncOutlined />}>
              导入合并
              <input hidden type="file" accept=".json" onChange={(event) => event.target.files?.[0] && mergeScene(event.target.files[0])} />
            </Button>
          </Tooltip>
          <Button size="small" startIcon={<CloudDownloadOutlined />} onClick={() => setPreviewOpen(true)}>导出预览</Button>
          <Button size="small" variant="contained" startIcon={<SaveOutlined />} onClick={exportScene}>保存场景</Button>
        </Toolbar>
      </AppBar>
      <main className="editor-grid">
        <HierarchyPanel />
        <SceneViewport />
        <InspectorPanel />
      </main>
      <div className="statusbar">
        <span>{selectedObject ? `已选择：${selectedObject.name}` : '未选择对象'}</span>
        <span>对象 {liveCount} · 修订 R{store.revision} · 位置 {selectedObject?.position.map((item) => item.toFixed(2)).join(' / ') ?? '--'}</span>
        <span>
          世界包围盒{' '}
          {bounds
            ? `${(bounds.max.x - bounds.min.x).toFixed(2)} × ${(bounds.max.y - bounds.min.y).toFixed(2)} × ${(bounds.max.z - bounds.min.z).toFixed(2)}`
            : '--'}
        </span>
        <span>{store.performance.instanceMode ? 'InstancedMesh 批量渲染' : '独立对象渲染'}</span>
      </div>
      <Snackbar open={Boolean(store.notice)} autoHideDuration={2600} onClose={() => store.noticeMessage('')} message={store.notice} />
      <MergeDialog onRetry={retryMerge} />
      <ExportPreviewDialog open={previewOpen} onClose={() => setPreviewOpen(false)} />
    </Box>
  )
}
