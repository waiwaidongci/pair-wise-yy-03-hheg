import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { useEditorStore } from '../stores/editor'
import type { ConflictSide, MergeConflict } from '../types/revision'
import { FIELD_LABELS } from '../utils/revision'
import { conflictKey } from '../utils/merge'

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '（已删除）'
  if (Array.isArray(value)) return `(${(value as number[]).map((item) => item.toFixed(2)).join(', ')})`
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'object' && 'object' in (value as Record<string, unknown>)) {
    const object = (value as { object: { name: string } }).object
    return `保留「${object.name}」及其全部属性`
  }
  return String(value)
}

function isColorValue(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value)
}

function SideValue({ value }: { value: unknown }) {
  const text = formatValue(value)
  if (isColorValue(value)) {
    return (
      <Stack direction="row" spacing={0.6} alignItems="center" component="span">
        <Box component="span" sx={{ width: 12, height: 12, borderRadius: '3px', border: '1px solid #94a3b8', background: value }} />
        <span>{text}</span>
      </Stack>
    )
  }
  return <span>{text}</span>
}

function ConflictRow({
  conflict,
  side,
  onChange,
}: {
  conflict: MergeConflict
  side: ConflictSide
  onChange: (side: ConflictSide) => void
}) {
  const title =
    conflict.field === 'object'
      ? `「${conflict.objectName}」整对象：一方已删除，另一方有修改`
      : `「${conflict.objectName}」· ${FIELD_LABELS[conflict.field]}`
  return (
    <Box sx={{ py: 1 }}>
      <Typography variant="body2" fontWeight={700}>{title}</Typography>
      <Typography variant="caption" color="text.secondary">基线值：{formatValue(conflict.baseValue)}</Typography>
      <RadioGroup value={side} onChange={(event) => onChange(event.target.value as ConflictSide)}>
        <FormControlLabel
          value="ours"
          control={<Radio size="small" />}
          label={<Typography variant="body2" component="span">我方：<SideValue value={conflict.oursValue} /></Typography>}
        />
        <FormControlLabel
          value="theirs"
          control={<Radio size="small" />}
          label={<Typography variant="body2" component="span">对方：<SideValue value={conflict.theirsValue} /></Typography>}
        />
      </RadioGroup>
    </Box>
  )
}

export default function MergeConflictDialog() {
  const pendingMerge = useEditorStore((state) => state.pendingMerge)
  const resolveMerge = useEditorStore((state) => state.resolveMerge)
  const cancelMerge = useEditorStore((state) => state.cancelMerge)
  const [resolutions, setResolutions] = useState<Record<string, ConflictSide>>({})

  useEffect(() => {
    if (!pendingMerge) return
    const defaults: Record<string, ConflictSide> = {}
    for (const conflict of pendingMerge.outcome.conflicts) defaults[conflictKey(conflict)] = 'ours'
    setResolutions(defaults)
  }, [pendingMerge])

  if (!pendingMerge) return null
  const { conflicts, notes } = pendingMerge.outcome
  const setAll = (side: ConflictSide) => {
    const next: Record<string, ConflictSide> = {}
    for (const conflict of conflicts) next[conflictKey(conflict)] = side
    setResolutions(next)
  }

  return (
    <Dialog open maxWidth="sm" fullWidth scroll="paper">
      <DialogTitle>合并冲突裁决（{conflicts.length} 处）</DialogTitle>
      <DialogContent dividers>
        {notes.length > 0 && (
          <Alert severity="info" sx={{ mb: 1.5 }}>
            <Stack spacing={0.3}>
              {notes.map((note, index) => (
                <Typography key={index} variant="caption">{note.message}</Typography>
              ))}
            </Stack>
          </Alert>
        )}
        <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
          <Button size="small" variant="outlined" onClick={() => setAll('ours')}>全部用我方</Button>
          <Button size="small" variant="outlined" onClick={() => setAll('theirs')}>全部用对方</Button>
        </Stack>
        <Divider />
        {conflicts.map((conflict, index) => (
          <Box key={conflictKey(conflict)}>
            <ConflictRow
              conflict={conflict}
              side={resolutions[conflictKey(conflict)] ?? 'ours'}
              onChange={(side) => setResolutions((current) => ({ ...current, [conflictKey(conflict)]: side }))}
            />
            {index < conflicts.length - 1 && <Divider />}
          </Box>
        ))}
      </DialogContent>
      <DialogActions>
        <Button onClick={cancelMerge}>取消合并（保留当前场景）</Button>
        <Button variant="contained" onClick={() => resolveMerge(resolutions)}>应用裁决并合并</Button>
      </DialogActions>
    </Dialog>
  )
}
