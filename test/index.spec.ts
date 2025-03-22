// test/index.spec.ts
import { env, createExecutionContext, waitOnExecutionContext, SELF } from 'cloudflare:test'
import { describe, it, expect, vi } from 'vitest'
import worker from '../src/index'

// For now, you'll need to do something like this to get a correctly-typed
// `Request` to pass to `worker.fetch()`.
const IncomingRequest = Request<unknown, IncomingRequestCfProperties>

describe('GitHub Stars Graph worker', () => {
	it('serves the form HTML on the home page', async () => {
		const request = new IncomingRequest('http://example.com/')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(200)
		expect(response.headers.get('Content-Type')).toBe('text/html;charset=UTF-8')

		const text = await response.text()
		expect(text).toContain('<title>GitHub Stars Graph</title>')
		expect(text).toContain('<form action="/stars" method="get">')
	})

	it('requires owner and repo parameters for stars endpoint', async () => {
		const request = new IncomingRequest('http://example.com/stars')
		const ctx = createExecutionContext()
		const response = await worker.fetch(request, env, ctx)
		await waitOnExecutionContext(ctx)

		expect(response.status).toBe(400)
		expect(await response.text()).toBe('Owner and repo parameters are required')
	})

	it('fetches and displays stars graph when parameters are provided', async () => {
		// Save original fetch function
		const originalFetch = global.fetch

		// Create a proper mock for the fetch function
		global.fetch = vi.fn((url, options) => {
			// Only mock the GitHub API call, pass everything else to original fetch
			if (url.toString().includes('api.github.com')) {
				return Promise.resolve({
					ok: true,
					status: 200,
					json: () =>
						Promise.resolve([
							{ starredAt: '2022-01-01T10:00:00Z' },
							{ starredAt: '2022-01-01T12:00:00Z' },
							{ starredAt: '2022-01-02T15:00:00Z' },
						]),
				})
			}
			return originalFetch(url, options)
		})

		try {
			const request = new IncomingRequest('http://example.com/stars?owner=cloudflare&repo=workers-sdk')
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(200)
			expect(response.headers.get('Content-Type')).toBe('text/html;charset=UTF-8')

			const text = await response.text()
			expect(text).toContain('<title>GitHub Stars - cloudflare/workers-sdk</title>')
			expect(text).toContain('Total Stars: 3')
			expect(text).toContain('const timeData = ')
			expect(text).toContain('"2022-01-01"') // Check date is present in chart data

			// Verify GitHub API was called with correct URL
			expect(fetch).toHaveBeenCalledWith(
				'https://api.github.com/repos/cloudflare/workers-sdk/stargazers?page=1&per_page=100',
				expect.objectContaining({
					headers: expect.any(Headers),
				}),
			)
		} finally {
			// Restore original fetch
			global.fetch = originalFetch
		}
	})

	it('handles API errors gracefully', async () => {
		// Save original fetch function
		const originalFetch = global.fetch

		// Create a proper mock for the fetch function
		global.fetch = vi.fn((url, options) => {
			// Only mock the GitHub API call, pass everything else to original fetch
			if (url.toString().includes('api.github.com')) {
				return Promise.resolve({
					ok: false,
					status: 404,
				})
			}
			return originalFetch(url, options)
		})

		try {
			const request = new IncomingRequest('http://example.com/stars?owner=cloudflare&repo=nonexistent')
			const ctx = createExecutionContext()
			const response = await worker.fetch(request, env, ctx)
			await waitOnExecutionContext(ctx)

			expect(response.status).toBe(500)
			expect(await response.text()).toContain('Error: GitHub API error: 404')
		} finally {
			// Restore original fetch
			global.fetch = originalFetch
		}
	})
})
