import './index.css'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { TooltipProvider } from '@/components/ui/tooltip'

import { ReviewPage } from './review/ReviewPage.tsx'
import type { ProjectId } from './review/sampleData.ts'

const PROJECT_IDS: ProjectId[] = ['afk-web', 'payments-api', 'docs-site']

export interface ReviewSearch {
  project?: ProjectId
}

const rootRoute = createRootRoute()

export const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: (search: Record<string, unknown>): ReviewSearch => {
    const project = search.project
    return PROJECT_IDS.includes(project as ProjectId) ? { project: project as ProjectId } : {}
  },
  component: ReviewPage,
})

const router = createRouter({ routeTree: rootRoute.addChildren([reviewRoute]) })

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
