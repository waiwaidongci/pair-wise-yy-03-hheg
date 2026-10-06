import {
  Box,
  Button,
  Checkbox,
  Divider,
  FormControlLabel,
  MenuItem,
  Slider,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { AlignHorizontalCenter, ContentCopyOutlined, DeleteOutline } from '@mui/icons-material'
import { useMemo } from 'react'
import type { SceneObject, Vec3 } from '../types/scene'
import { useEditorStore } from '../stores/editor'
import { TYPE_LABELS, descendantsOf } from '../utils/scene'

function VectorEditor({ label, value, onChange }: { label: string; value: Vec3; onChange: (value: Vec3) => void }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Stack direction="row" spacing={0.6} sx={{ mt: 0.4 }}>
        {value.map((item, axis) => (
          <TextField
            key={axis}
            size="small"
            type="number"
            value={Number(item.toFixed(3))}
            inputProps={{ step: 0.1, 'aria-label': `${label}-${axis}` }}
            onChange={(event) => {
              const next: Vec3 = [...value]
              next[axis] = Number(event.target.value)
              onChange(next)
            }}
          />
        ))}
      </Stack>
    </Box>
  )
}

export default function InspectorPanel() {
  const object = useEditorStore((state) => state.objects.find((item) => item.id === state.selectedId))
  const objects = useEditorStore((state) => state.objects)
  const update = useEditorStore((state) => state.update)
  const remove = useEditorStore((state) => state.remove)
  const duplicate = useEditorStore((state) => state.duplicate)
  const align = useEditorStore((state) => state.align)
  const reparent = useEditorStore((state) => state.reparent)
  const invalidParents = useMemo(
    () => (object ? new Set([object.id, ...descendantsOf(object.id, objects)]) : new Set<string>()),
    [object, objects],
  )
  if (!object) {
    return <aside className="panel inspector-panel"><Typography variant="subtitle2">属性检查器</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>在层级树或视口中选择对象。</Typography></aside>
  }

  const patch = (value: Partial<SceneObject>) => update(object.id, value)
  return (
    <aside className="panel inspector-panel">
      <div className="panel-heading"><div><Typography variant="subtitle2">属性检查器</Typography><Typography variant="caption" color="text.secondary">{TYPE_LABELS[object.type]} · {object.id}</Typography></div></div>
      <Stack spacing={1.2}>
        <TextField label="对象名称" size="small" value={object.name} onChange={(event) => patch({ name: event.target.value })} />
        <TextField select label="父级对象" size="small" value={object.parentId ?? ''} onChange={(event) => reparent(object.id, event.target.value || null)}>
          <MenuItem value="">场景根节点</MenuItem>
          {objects.filter((item) => !invalidParents.has(item.id)).map((item) => <MenuItem key={item.id} value={item.id}>{item.name}</MenuItem>)}
        </TextField>
        <VectorEditor label="位置 Position" value={object.position} onChange={(position) => patch({ position })} />
        <VectorEditor label="旋转 Rotation" value={object.rotation} onChange={(rotation) => patch({ rotation })} />
        <VectorEditor label="缩放 Scale" value={object.scale} onChange={(scale) => patch({ scale })} />
        <Stack direction="row" spacing={0.6}>
          {[0, 1, 2].map((axis) => (
            <Tooltip key={axis} title={`对齐 ${['X', 'Y', 'Z'][axis]} 轴`}>
              <Button size="small" variant="outlined" startIcon={<AlignHorizontalCenter />} onClick={() => align(axis as 0 | 1 | 2)}>{['X', 'Y', 'Z'][axis]}</Button>
            </Tooltip>
          ))}
        </Stack>
      </Stack>
      <Divider sx={{ my: 1.6 }} />
      <Typography variant="subtitle2" sx={{ mb: 1 }}>外观与阴影</Typography>
      <Stack spacing={1}>
        <TextField label="颜色" type="color" size="small" value={object.material.color} onChange={(event) => patch({ material: { ...object.material, color: event.target.value } })} />
        <Box><Typography variant="caption">粗糙度 {object.material.roughness.toFixed(2)}</Typography><Slider size="small" min={0} max={1} step={0.01} value={object.material.roughness} onChange={(_, value) => patch({ material: { ...object.material, roughness: value as number } })} /></Box>
        <Box><Typography variant="caption">金属度 {object.material.metalness.toFixed(2)}</Typography><Slider size="small" min={0} max={1} step={0.01} value={object.material.metalness} onChange={(_, value) => patch({ material: { ...object.material, metalness: value as number } })} /></Box>
        <Box><Typography variant="caption">不透明度 {object.material.opacity.toFixed(2)}</Typography><Slider size="small" min={0.05} max={1} step={0.01} value={object.material.opacity} onChange={(_, value) => patch({ material: { ...object.material, opacity: value as number } })} /></Box>
        <FormControlLabel control={<Checkbox size="small" checked={object.material.wireframe} onChange={(event) => patch({ material: { ...object.material, wireframe: event.target.checked } })} />} label="线框模式" />
        <FormControlLabel control={<Checkbox size="small" checked={object.castShadow} onChange={(event) => patch({ castShadow: event.target.checked })} />} label="投射阴影" />
        <FormControlLabel control={<Checkbox size="small" checked={object.receiveShadow} onChange={(event) => patch({ receiveShadow: event.target.checked })} />} label="接收阴影" />
        {object.type.includes('Light') && (
          <>
            <Typography variant="caption">光照强度 {object.intensity ?? 1}</Typography>
            <Slider size="small" min={0} max={8} step={0.1} value={object.intensity ?? 1} onChange={(_, value) => patch({ intensity: value as number })} />
          </>
        )}
        {object.type === 'camera' && (
          <FormControlLabel control={<Checkbox size="small" checked={object.activeCamera} onChange={(event) => patch({ activeCamera: event.target.checked })} />} label="设为活动相机" />
        )}
      </Stack>
      <Divider sx={{ my: 1.6 }} />
      <Stack direction="row" spacing={1}>
        <Button fullWidth variant="outlined" startIcon={<ContentCopyOutlined />} onClick={() => duplicate(object.id)}>复制</Button>
        <Button fullWidth color="error" variant="outlined" startIcon={<DeleteOutline />} onClick={() => remove(object.id)}>删除</Button>
      </Stack>
    </aside>
  )
}
