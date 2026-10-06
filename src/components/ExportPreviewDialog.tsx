import { Box, Dialog, DialogContent, DialogTitle, Divider, Stack, Typography } from '@mui/material'
import { useEditorStore } from '../stores/editor'
import { useExportPreview } from '../hooks/useSceneDerived'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export default function ExportPreviewDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sceneVersion = useEditorStore((state) => state.sceneVersion)
  const structureVersion = useEditorStore((state) => state.structureVersion)
  // enabled=false 时不重算，避免对话框关闭期间白白序列化
  const preview = useExportPreview(open)

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth scroll="paper">
      <DialogTitle>导出预览</DialogTitle>
      <DialogContent dividers>
        {preview ? (
          <Stack spacing={1.2}>
            <Typography variant="caption" color="text.secondary">
              场景版本 #{sceneVersion} · 层级版本 #{structureVersion} · 修订头 {preview.head} · 层级或属性一变即失效重算
            </Typography>
            <Stack direction="row" spacing={3} flexWrap="wrap">
              <Typography variant="body2">对象：<b>{preview.objectCount}</b></Typography>
              <Typography variant="body2">JSON 大小：<b>{formatBytes(preview.bytes)}</b></Typography>
              <Typography variant="body2">
                世界包围盒：
                <b>
                  {preview.bounds ? preview.bounds.size.map((item) => item.toFixed(2)).join(' × ') : '空场景'}
                </b>
              </Typography>
              <Typography variant="body2">
                包围盒中心：
                <b>{preview.bounds ? preview.bounds.center.map((item) => item.toFixed(2)).join(' / ') : '--'}</b>
              </Typography>
            </Stack>
            <Divider />
            <Box
              component="pre"
              sx={{
                m: 0,
                p: 1.2,
                maxHeight: 380,
                overflow: 'auto',
                fontSize: 11,
                lineHeight: 1.5,
                background: '#0f172a',
                color: '#dbeafe',
                borderRadius: 1,
              }}
            >
              {preview.json.split('\n').slice(0, 80).join('\n')}
              {preview.json.split('\n').length > 80 ? '\n…' : ''}
            </Box>
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">正在计算…</Typography>
        )}
      </DialogContent>
    </Dialog>
  )
}
