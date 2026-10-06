import { CssBaseline, ThemeProvider, createTheme } from '@mui/material'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'

const theme = createTheme({
  palette: { mode: 'light', primary: { main: '#2563eb' }, background: { default: '#eef2f7' } },
  shape: { borderRadius: 7 },
  typography: { fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif' },
})

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <RouterProvider router={router} />
    </ThemeProvider>
  )
}
