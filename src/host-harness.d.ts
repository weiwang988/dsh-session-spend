/**
 * Host-half Context augmentation (module merge onto @deepseek-ai/cordis).
 *
 * The host services this plugin consumes — `webServer` (node route table)
 * and `credentials` (resolved secrets) — are declared by Host packages that
 * must NOT become dev dependencies of a publishable client plugin. The
 * structural shapes below are small, stable duck-typed mirrors (see the same
 * shapes in src/index.ts); the Host program's real declarations carry the
 * authority at runtime.
 */

import type {} from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** node:http route registration (owned by @deepseek-ai/dsh-host-webserver). */
    webServer: {
      register(route: {
        kind: 'exact' | 'prefix'
        path: string
        handler: (
          req: { readonly url?: string },
          res: {
            writeHead(statusCode: number, headers?: Record<string, string>): void
            end(body?: string): void
          },
        ) => void | Promise<void>
      }): () => void
    }
    /** Resolved credential lookup (owned by @deepseek-ai/dsh-credentials). */
    credentials: {
      resolve(ref: string): Promise<{ readonly value: string } | undefined>
    }
  }
}
