import Database from "bun:sqlite";
import { mkdirSync } from "fs";

mkdirSync("./data", { recursive: true });

const db = new Database(process.env.DATABASE_URL || "./data/tasks.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT DEFAULT '',
    deadline TEXT,
    priority TEXT DEFAULT 'medium',
    status TEXT DEFAULT 'todo',
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;
  const method = req.method;

  // ── API ──────────────────────────────────────────────────────────────────
  if (pathname === "/api/tasks") {
    if (method === "GET") {
      const tasks = db
        .query(
          `SELECT * FROM tasks
           ORDER BY
             CASE WHEN status = 'done' THEN 1 ELSE 0 END,
             CASE WHEN deadline IS NULL OR deadline = '' THEN 1 ELSE 0 END,
             deadline ASC,
             created_at DESC`
        )
        .all();
      return json(tasks);
    }
    if (method === "POST") {
      const body = (await req.json()) as Record<string, string>;
      const stmt = db.prepare(
        "INSERT INTO tasks (title, description, deadline, priority, status) VALUES (?, ?, ?, ?, ?)"
      );
      const result = stmt.run(
        body.title,
        body.description ?? "",
        body.deadline || null,
        body.priority ?? "medium",
        body.status ?? "todo"
      );
      const task = db
        .query("SELECT * FROM tasks WHERE id = ?")
        .get(result.lastInsertRowid);
      return json(task, 201);
    }
  }

  const taskMatch = pathname.match(/^\/api\/tasks\/(\d+)$/);
  if (taskMatch) {
    const id = parseInt(taskMatch[1]);
    if (method === "PATCH") {
      const body = (await req.json()) as Record<string, string>;
      const allowed = ["title", "description", "deadline", "priority", "status"];
      const fields = Object.keys(body).filter((k) => allowed.includes(k));
      if (fields.length === 0) return json({ error: "No valid fields" }, 400);
      const sets = fields.map((f) => `${f} = ?`).join(", ");
      const values = fields.map((f) => (body[f] === "" && f === "deadline" ? null : body[f]));
      db.prepare(`UPDATE tasks SET ${sets} WHERE id = ?`).run(...values, id);
      const task = db.query("SELECT * FROM tasks WHERE id = ?").get(id);
      return json(task);
    }
    if (method === "DELETE") {
      db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
      return json({ success: true });
    }
  }

  if (pathname === "/api/digest" && method === "GET") {
    const today = new Date().toISOString().split("T")[0];
    const week = new Date(Date.now() + 7 * 86_400_000).toISOString().split("T")[0];
    const overdue = db
      .query(
        `SELECT * FROM tasks WHERE deadline IS NOT NULL AND deadline != '' AND deadline < ? AND status != 'done' ORDER BY deadline`
      )
      .all(today) as Record<string, unknown>[];
    const dueToday = db
      .query(`SELECT * FROM tasks WHERE deadline = ? AND status != 'done'`)
      .all(today) as Record<string, unknown>[];
    const dueSoon = db
      .query(
        `SELECT * FROM tasks WHERE deadline > ? AND deadline <= ? AND status != 'done' ORDER BY deadline`
      )
      .all(today, week) as Record<string, unknown>[];
    const allTasks = db.query("SELECT * FROM tasks").all() as Record<string, unknown>[];
    const stats = {
      total: allTasks.length,
      todo: allTasks.filter((t) => t.status === "todo").length,
      inProgress: allTasks.filter((t) => t.status === "in-progress").length,
      done: allTasks.filter((t) => t.status === "done").length,
    };
    return json({ overdue, dueToday, dueSoon, stats, generatedAt: new Date().toISOString() });
  }

  // ── Static files ─────────────────────────────────────────────────────────
  const publicDir = `${import.meta.dir}/public`;
  const filePath = pathname === "/" ? "/index.html" : pathname;
  const file = Bun.file(`${publicDir}${filePath}`);
  if (await file.exists()) return new Response(file);

  return new Response(Bun.file(`${publicDir}/index.html`));
}

export default { port: process.env.PORT ?? 3000, fetch: handleRequest };
