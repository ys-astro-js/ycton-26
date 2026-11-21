import path from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 개발 중에는 /api를 오케스트레이션 서버로 넘깁니다. 서버는 허용한 Origin만 받으므로,
// 개발 서버 포트가 바뀌어도 막히지 않게 프록시 요청에서 Origin을 지웁니다.
const apiTarget = process.env.AFK_API_URL ?? 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, './src') },
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.PORT ?? process.env.AFK_WEB_PORT ?? 5173),
    proxy: {
      '/api': {
        target: apiTarget,
        configure: (proxy) => {
          proxy.on('proxyReq', (request) => request.removeHeader('origin'))
        },
      },
    },
  },
})
