import BlogRequest from "./types/blog-type"
import CommentRequest from "./types/comment-type"

export interface Env {
  blog_db: D1Database
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
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
        WHERE COALESCE(is_deleted, 0) = 0
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
    // GET SINGLE POST
    // =========================
    if (request.method === "GET" && url.pathname.startsWith("/posts/")) {

      const postId = Number(url.pathname.split("/")[2])

      if (!Number.isInteger(postId) || postId <= 0) {
        return json({ error: "post id required" }, 400)
      }

      const result = await env.blog_db.prepare(
        `SELECT * FROM posts
        WHERE id = ? AND COALESCE(is_deleted, 0) = 0
        LIMIT 1`
      )
        .bind(postId)
        .first()

      if (!result) {
        return json({ error: "Post not found" }, 404)
      }

      return json(result)
    }

    // =========================
    // CREATE POST
    // =========================
    if (request.method === "POST" && url.pathname === "/posts") {

      const data = await readRequestBody(request)
      const title = asString(data.title)
      const body = asString(data.body)
      const image_url = asString(data.image_url)
      const author = asString(data.author)
      const username = asString(data.username)
      const expaId = asNumber(data.expa_id)

      if (!title) {
        return json({ error: "Title required" }, 400)
      }

      if (!Number.isInteger(expaId)) {
        return json({ error: "Login required" }, 400)
      }

      await env.blog_db.prepare(
        `INSERT INTO posts (title, body, image_url, author, username, expa_id, is_deleted)
        VALUES (?, ?, ?, ?, ?, ?, 0)`
      )
        .bind(
          title,
          body || null,
          image_url || null,
          author || username || "Anonymous",
          username || author || "Anonymous",
          expaId
        )
        .run()

      // ✅ Optional now (since page 0 isn't cached anyway)
      const firstPageUrl = `${url.origin}/posts?page=0`
      await caches.default.delete(new Request(firstPageUrl))

      return json({ success: true })
    }

    // =========================
    // GET COMMENTS
    // =========================
    if (request.method === "GET" && url.pathname === "/comments") {

      const postId = Number(url.searchParams.get("post_id"))

      if (!Number.isInteger(postId) || postId <= 0) {
        return json({ error: "post_id is required" }, 400)
      }

      const { results } = await env.blog_db.prepare(
        `SELECT * FROM comments
        WHERE post_id = ? AND COALESCE(is_deleted, 0) = 0
        ORDER BY created_at ASC`
      )
        .bind(postId)
        .all()

      return json(results)
    }

    // =========================
    // CREATE COMMENT
    // =========================
    if (request.method === "POST" && url.pathname === "/comments") {

      const data = await readRequestBody(request)
      const postId = asNumber(data.post_id)
      const expaId = asNumber(data.expa_id)
      const username = asString(data.username)
      const body = asString(data.body)

      if (!Number.isInteger(postId) || postId <= 0) {
        return json({ error: "post_id required" }, 400)
      }

      if (!Number.isInteger(expaId)) {
        return json({ error: "Login required" }, 400)
      }

      if (!username) {
        return json({ error: "username required" }, 400)
      }

      if (!body) {
        return json({ error: "body required" }, 400)
      }

      await env.blog_db.prepare(
        `INSERT INTO comments (post_id, expa_id, username, body, updated_at, is_deleted)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, 0)`
      )
        .bind(
          postId,
          expaId,
          username,
          body
        )
        .run()

      return json({ success: true })
    }

    // =========================
    // EDIT COMMENT
    // =========================
    if (request.method === "PUT" && url.pathname.startsWith("/comments/")) {

      const commentId = Number(url.pathname.split("/")[2])

      if (!Number.isInteger(commentId) || commentId <= 0) {
        return json({ error: "comment id required" }, 400)
      }

      const data = await readRequestBody(request)
      const body = asString(data.body)

      if (!body) {
        return json({ error: "body required" }, 400)
      }

      await env.blog_db.prepare(
        `UPDATE comments
        SET body = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND COALESCE(is_deleted, 0) = 0`
      )
        .bind(body, commentId)
        .run()

      return json({ success: true })
    }

    // =========================
    // DELETE COMMENT
    // =========================
    if (request.method === "DELETE" && url.pathname.startsWith("/comments/")) {

      const commentId = Number(url.pathname.split("/")[2])

      if (!Number.isInteger(commentId) || commentId <= 0) {
        return json({ error: "comment id required" }, 400)
      }

      await env.blog_db.prepare(
        `UPDATE comments
        SET is_deleted = 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?`
      )
        .bind(commentId)
        .run()

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

async function readRequestBody(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") || ""

  try {
    if (contentType.includes("application/json")) {
      const data = await request.json()
      return isRecord(data) ? data : {}
    }

    if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const formData = await request.formData()
      return Object.fromEntries(formData.entries())
    }

    const text = await request.text()
    if (!text.trim()) {
      return {}
    }

    try {
      const data = JSON.parse(text)
      return isRecord(data) ? data : {}
    } catch {
      return Object.fromEntries(new URLSearchParams(text).entries())
    }
  } catch {
    return {}
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  return ""
}

function asNumber(value: unknown): number {
  if (typeof value === "number") return value
  if (typeof value === "string" && value.trim()) return Number(value)
  return NaN
}