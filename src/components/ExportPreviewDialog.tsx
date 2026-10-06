import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { CloudDownloadOutlined } from '@mui/icons-material'
import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import type { SceneDocument } from '../types/scene'
import { useEditorStore } from '../stores/editor'
import { computeWorldBounds, liveObjects } from '../utils/scene'

function formatBounds(document: SceneDocument): string {
  const bounds = computeWorldBounds(document.objects)
  if (!bounds) return '空场景'
  const size = new THREE.Vector3()
  bounds.getSize(size)
  return `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m`
}

export default function ExportPreviewDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const name = useEditorStore((state) => state.name)
  const objects = useEditorStore((state) => state.objects)
  const baseObjects = useEditorStore((state) => state.baseObjects)
  const revision = useEditorStore((state) => state.revision)
  const sceneRevision = useEditorStore((state) => state.sceneRevision)
  const [savedAt, setSavedAt] = useState(() => new Date().toISOString())
  useEffect(() => { if (open) setSavedAt(new Date().toISOString()) }, [open])

  const document = useMemo<SceneDocument>(() => ({
    version: 2,
    name,
    objects,
    savedAt,
    revision,
    base: baseObjects,
  }), [name, objects, baseObjects, revision, savedAt, sceneRevision])

  const json = useMemo(() => JSON.stringify(document, null, 2), [document])
  const liveCount = liveObjects(objects).length
  const tombstoneCount = objects.length - liveCount
  const boundsText = useMemo(() => formatBounds(document), [document, sceneRevision])

  function download() {
    const stamp = new Date().toISOString()
    const blob = new Blob([JSON.stringify({ ...document, savedAt: stamp }, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = window.document.createElement('a')
    anchor.href = url
    anchor.download = `${name}.scene.json`
    anchor.click()
    URL.revokeObjectURL(url)
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>导出预览</DialogTitle>
      <DialogContent>
        <Stack direction="row" spacing={2} sx={{ mb: 1.5, flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="body2">格式：v2（含修订与共同祖先）</Typography>
          <Typography variant="body2">文档修订：R{revision}</Typography>
          <Typography variant="body2">存活对象：{liveCount}</Typography>
          <Typography variant="body2">墓碑：{tombstoneCount}</Typography>
          <Typography variant="body2">世界包围盒：{boundsText}</Typography>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          层级或对象变化时，包围盒与本预览会随结构修订自动失效重算。
        </Typography>
        <TextField
          value={json}
          multiline
          fullWidth
          minRows={10}
          maxRows={20}
          slotProps={{
            input: {
              readOnly: true,
              sx: { fontFamily: 'monospace', fontSize: 12 },
            },
          }}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>关闭</Button>
        <Button variant="contained" startIcon={<CloudDownloadOutlined />} onClick={download}>下载 JSON</Button>
      </DialogActions>
    </Dialog>
  )
}
