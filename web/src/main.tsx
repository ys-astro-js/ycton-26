import './index.css'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { TooltipProvider } from '@/components/ui/tooltip'

import { ReviewPage } from './review/ReviewPage.tsx'
import type { ProjectId } from './review/model.ts'
import { RoomPage } from './room/RoomPage.tsx'
import { AppShell } from './shell/AppShell.tsx'

export interface ReviewSearch {
  project?: ProjectId
}

export interface RoomSearch {
  /** 리뷰나 맡기기에서 넘어올 때 강조할 할 일 ID */
  focus?: number
}

const rootRoute = createRootRoute({ component: AppShell })

export const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: (search: Record<string, unknown>): ReviewSearch => {
    const project = search.project
    return typeof project === 'string' || typeof project === 'number' ? { project: String(project) } : {}
  },
  component: ReviewPage,
})

export const roomRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/rooms/$roomId',
  validateSearch: (search: Record<string, unknown>): RoomSearch => {
    const focus = Number(search.focus)
    return Number.isInteger(focus) && focus > 0 ? { focus } : {}
  },
  component: RoomPage,
})

const router = createRouter({ routeTree: rootRoute.addChildren([reviewRoute, roomRoute]) })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
)
