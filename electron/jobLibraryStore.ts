import Database from 'better-sqlite3'
import { join } from 'node:path'
import { app } from './electronApi.js'
import { jobAgentConfigSchema } from '../src/shared/schemas.js'
import type { JobAgentConfig, SavedJobRecord, SaveJobInput } from '../src/shared/types.js'

type SavedJobRow = {
  id: string
  title: string
  salary: string | null
  meta: string | null
  jd_text: string
  source_file_name: string | null
  config_json: string
  created_at: string
  updated_at: string
}

export type JobLibraryStore = {
  listJobs: () => SavedJobRecord[]
  saveJob: (input: SaveJobInput) => SavedJobRecord
  deleteJob: (id: string) => boolean
  close: () => void
}

function nowIso(): string {
  return new Date().toISOString()
}

function normalizeText(value: string | undefined): string {
  return value?.trim() ?? ''
}

function createJobId(config: JobAgentConfig): string {
  const seed = config.id.trim() || config.title.trim() || 'job'
  const slug = seed
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'job'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function normalizeInput(input: SaveJobInput): SaveJobInput & { id: string; config: JobAgentConfig } {
  const parsedConfig = jobAgentConfigSchema.parse(input.config)
  const id = normalizeText(input.id) || normalizeText(parsedConfig.id) || createJobId(parsedConfig)
  const config = {
    ...parsedConfig,
    id,
    title: normalizeText(input.title) || parsedConfig.title,
  }
  return {
    ...input,
    id,
    config,
  }
}

function rowToRecord(row: SavedJobRow): SavedJobRecord {
  const parsedConfig = jobAgentConfigSchema.parse(JSON.parse(row.config_json))
  const config = {
    ...parsedConfig,
    id: row.id,
    title: row.title,
  }
  return {
    id: row.id,
    title: row.title,
    salary: row.salary ?? '',
    meta: row.meta ?? '',
    jdText: row.jd_text,
    sourceFileName: row.source_file_name ?? undefined,
    config,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export function getDefaultJobLibraryDbPath(): string {
  return join(app.getPath('userData'), 'job-library.sqlite3')
}

export function createJobLibraryStore(dbPath = getDefaultJobLibraryDbPath()): JobLibraryStore {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_jobs (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      salary TEXT,
      meta TEXT,
      jd_text TEXT NOT NULL,
      source_file_name TEXT,
      config_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)

  const listStatement = db.prepare(`
    SELECT id, title, salary, meta, jd_text, source_file_name, config_json, created_at, updated_at
    FROM saved_jobs
    ORDER BY updated_at DESC, title ASC
  `)
  const getStatement = db.prepare('SELECT created_at FROM saved_jobs WHERE id = ?')
  const upsertStatement = db.prepare(`
    INSERT INTO saved_jobs (
      id, title, salary, meta, jd_text, source_file_name, config_json, created_at, updated_at
    ) VALUES (
      @id, @title, @salary, @meta, @jdText, @sourceFileName, @configJson, @createdAt, @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      salary = excluded.salary,
      meta = excluded.meta,
      jd_text = excluded.jd_text,
      source_file_name = excluded.source_file_name,
      config_json = excluded.config_json,
      updated_at = excluded.updated_at
  `)
  const deleteStatement = db.prepare('DELETE FROM saved_jobs WHERE id = ?')

  return {
    listJobs: () => listStatement.all().map((row) => rowToRecord(row as SavedJobRow)),
    saveJob: (rawInput) => {
      const input = normalizeInput(rawInput)
      const existing = getStatement.get(input.id) as { created_at: string } | undefined
      const timestamp = nowIso()
      const record = {
        id: input.id,
        title: input.config.title,
        salary: normalizeText(input.salary),
        meta: normalizeText(input.meta),
        jdText: input.jdText,
        sourceFileName: input.sourceFileName?.trim() || null,
        configJson: JSON.stringify(input.config),
        createdAt: existing?.created_at ?? timestamp,
        updatedAt: timestamp,
      }
      upsertStatement.run(record)
      return rowToRecord({
        id: record.id,
        title: record.title,
        salary: record.salary,
        meta: record.meta,
        jd_text: record.jdText,
        source_file_name: record.sourceFileName,
        config_json: record.configJson,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
      })
    },
    deleteJob: (id) => deleteStatement.run(id).changes > 0,
    close: () => db.close(),
  }
}

let defaultJobLibraryStore: JobLibraryStore | undefined

function getDefaultJobLibraryStore(): JobLibraryStore {
  defaultJobLibraryStore ??= createJobLibraryStore()
  return defaultJobLibraryStore
}

export function listSavedJobs(): SavedJobRecord[] {
  return getDefaultJobLibraryStore().listJobs()
}

export function saveSavedJob(input: SaveJobInput): SavedJobRecord {
  return getDefaultJobLibraryStore().saveJob(input)
}

export function deleteSavedJob(id: string): boolean {
  return getDefaultJobLibraryStore().deleteJob(id)
}

export function closeJobLibraryStore(): void {
  defaultJobLibraryStore?.close()
  defaultJobLibraryStore = undefined
}
