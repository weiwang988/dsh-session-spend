/**
 * Host-half Context augmentation (module merge onto @deepseek-ai/cordis).
 *
 * The host services this plugin consumes — `webServer` (node route table),
 * `credentials` (resolved secrets), and the optional `settings` section
 * installer — are declared by Host packages that must NOT become dev
 * dependencies of a publishable client plugin. The structural shapes below
 * are small, stable duck-typed mirrors (see the same shapes in src/index.ts);
 * the Host program's real declarations carry the authority at runtime.
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
    /** Optional settings-section provider (owned by @deepseek-ai/dsh-settings). */
    settings?: {
      installSection(
        owner: unknown,
        namespace: string,
        schema: unknown,
        entry: unknown,
        hooks: {
          setSource(current: () => unknown): void
          onChange(): void
        },
      ): void
    }
  }
}
