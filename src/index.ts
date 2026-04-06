import BlogRequest from "./types/blog-type"

export interface Env {
  blog_db: D1Database
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {

    const url = new URL(request.url)

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS })
    }

    // =========================
    // GET POSTS (WITH CACHE)
    // =========================
    if (request.method === "GET" && url.pathname === "/posts") {

      const cache = caches.default
      const page = Number(url.searchParams.get("page") || 0)
      const cacheKey = new Request(request.url)

      // ✅ Only use cache for page > 0
      if (page !== 0) {
        const cached = await cache.match(cacheKey)
        if (cached) return addCors(cached)
      }

      const limit = 25
      const offset = page * limit

      const { results } = await env.blog_db.prepare(
        `SELECT * FROM posts
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`
      )
        .bind(limit, offset)
        .all()

      const response = new Response(JSON.stringify(results), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=60"
        }
      })

      // ✅ Cache only older pages
      if (page !== 0) {
        ctx.waitUntil(cache.put(cacheKey, response.clone()))
      }

      return addCors(response)
    }

    // =========================
    // CREATE POST
    // =========================
    if (request.method === "POST" && url.pathname === "/posts") {

      const data: BlogRequest = await request.json()
      const { title, body, author } = data

      if (!title) {
        return json({ error: "Title required" }, 400)
      }

      await env.blog_db.prepare(
        `INSERT INTO posts (title, body, author)
        VALUES (?, ?, ?)`
      )
        .bind(
          title,
          body || null,
          author || null
        )
        .run()

      // ✅ Optional now (since page 0 isn't cached anyway)
      const firstPageUrl = `${url.origin}/posts?page=0`
      await caches.default.delete(new Request(firstPageUrl))

      return json({ success: true })
    }

    return new Response("Not found", { status: 404 })
  }
}

// =========================
// Helpers
// =========================

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS
    }
  })
}

function addCors(response: Response) {
  const headers = new Headers(response.headers)

  Object.entries(CORS_HEADERS).forEach(([k, v]) => {
    headers.set(k, v)
  })

  return new Response(response.body, {
    status: response.status,
    headers
  })
}