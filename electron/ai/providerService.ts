import type Database from 'better-sqlite3'
import type { AICredentialService } from './credentialService'
import { AIServiceError, type AIProviderCapability, type AIProviderConfigInput } from './types'
import { parseAIProviderConfigInput } from './validation'

type CredentialStore = Pick<AICredentialService, 'create' | 'replace' | 'reveal' | 'delete'>

type ProviderRow = {
  id: number
  name: string
  protocol: AIProviderConfigInput['protocol']
  base_url: string
  credential_ref: string | null
  default_headers_json: string
  request_body_json: string
  capabilities_json: string
  text_model: string | null
  text_models_json: string
  image_model: string | null
  image_models_json: string
  video_model: string | null
  video_models_json: string
  timeout_ms: number
  allow_local_network: number
  enabled: number
  is_default_text: number
  is_default_image: number
  is_default_video: number
  connection_status: 'untested' | 'testing' | 'connected' | 'failed'
  last_tested_at: string | null
  last_success_at: string | null
  created_at: string
  updated_at: string
}

type ProviderCredentialBundle = {
  apiKey?: string
  headers: Record<string, string>
}

export type AIProviderSummary = {
  id: number
  name: string
  protocol: AIProviderConfigInput['protocol']
  baseUrl: string
  credentialConfigured: boolean
  headerNames: string[]
  requestBody: Record<string, unknown>
  capabilities: AIProviderCapability[]
  models: AIProviderConfigInput['models']
  timeoutMs: number
  allowLocalNetwork: boolean
  enabled: boolean
  defaults: { text: boolean; image: boolean; video: boolean }
  connectionStatus: ProviderRow['connection_status']
  lastTestedAt: string | null
  lastSuccessAt: string | null
  createdAt: string
  updatedAt: string
}

export type AIProviderListFilters = {
  search?: string
  protocol?: AIProviderConfigInput['protocol']
  capability?: AIProviderCapability
  enabled?: boolean
}

export type AIProviderDependency = {
  agentId: number
  agentName: string
  usages: Array<'text' | 'image' | 'video'>
}

function serviceError(
  code: 'invalid_input' | 'not_found' | 'configuration_incomplete' | 'storage_error',
  message: string,
  retryable = false,
) {
  return new AIServiceError({ code, message, retryable })
}

function parseJsonArray<T>(value: string, fallback: T[] = []) {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as T[]) : fallback
  } catch {
    return fallback
  }
}

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function toSummary(row: ProviderRow): AIProviderSummary {
  const textOptions = parseJsonArray<string>(row.text_models_json)
  const imageOptions = parseJsonArray<string>(row.image_models_json)
  const videoOptions = parseJsonArray<string>(row.video_models_json)
  const normalizedTextOptions = textOptions.length > 0
    ? textOptions
    : (row.text_model ? [row.text_model] : [])
  return {
    id: row.id,
    name: row.name,
    protocol: row.protocol,
    baseUrl: row.base_url,
    credentialConfigured: Boolean(row.credential_ref),
    headerNames: parseJsonArray<string>(row.default_headers_json),
    requestBody: parseJsonObject(row.request_body_json),
    capabilities: parseJsonArray<AIProviderCapability>(row.capabilities_json),
    models: {
      text: row.text_model ?? undefined,
      textOptions: normalizedTextOptions,
      image: row.image_model ?? undefined,
      imageOptions: imageOptions.length > 0 ? imageOptions : (row.image_model ? [row.image_model] : []),
      video: row.video_model ?? undefined,
      videoOptions: videoOptions.length > 0 ? videoOptions : (row.video_model ? [row.video_model] : []),
    },
    timeoutMs: row.timeout_ms,
    allowLocalNetwork: Boolean(row.allow_local_network),
    enabled: Boolean(row.enabled),
    defaults: {
      text: Boolean(row.is_default_text),
      image: Boolean(row.is_default_image),
      video: Boolean(row.is_default_video),
    },
    connectionStatus: row.connection_status,
    lastTestedAt: row.last_tested_at,
    lastSuccessAt: row.last_success_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function serializeCredentialBundle(bundle: ProviderCredentialBundle) {
  return JSON.stringify(bundle)
}

function deserializeCredentialBundle(value: string): ProviderCredentialBundle {
  try {
    const parsed = JSON.parse(value) as Partial<ProviderCredentialBundle>
    return {
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : undefined,
      headers:
        parsed.headers && typeof parsed.headers === 'object' && !Array.isArray(parsed.headers)
          ? (parsed.headers as Record<string, string>)
          : {},
    }
  } catch {
    throw serviceError('storage_error', 'AI provider credentials are corrupt.')
  }
}

export class AIProviderService {
  constructor(
    private readonly db: Database.Database,
    private readonly credentials: CredentialStore,
  ) {
    this.db.pragma('foreign_keys = ON')
  }

  list(filters: AIProviderListFilters = {}) {
    const rows = this.db.prepare('SELECT * FROM ai_providers ORDER BY name COLLATE NOCASE, id').all() as ProviderRow[]
    const search = filters.search?.trim().toLocaleLowerCase()
    return rows.map(toSummary).filter((provider) => {
      if (search && !`${provider.name} ${provider.baseUrl}`.toLocaleLowerCase().includes(search)) return false
      if (filters.protocol && provider.protocol !== filters.protocol) return false
      if (filters.capability && !provider.capabilities.includes(filters.capability)) return false
      if (filters.enabled !== undefined && provider.enabled !== filters.enabled) return false
      return true
    })
  }

  get(id: number) {
    return toSummary(this.requireRow(id))
  }

  create(value: unknown) {
    const input = parseAIProviderConfigInput(value)
    const bundle: ProviderCredentialBundle = { apiKey: input.apiKey, headers: input.defaultHeaders }
    const credentialRef = this.createCredentialIfNeeded(bundle)
    try {
      const result = this.db
        .prepare(
          `
          INSERT INTO ai_providers (
            name, protocol, base_url, credential_ref, default_headers_json, request_body_json,
            capabilities_json, text_model, text_models_json, image_model, image_models_json,
            video_model, video_models_json, timeout_ms, allow_local_network, enabled
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          input.name,
          input.protocol,
          input.baseUrl,
          credentialRef,
          JSON.stringify(Object.keys(input.defaultHeaders).sort()),
          JSON.stringify(input.requestBody),
          JSON.stringify(input.capabilities),
          input.models.text ?? null,
          JSON.stringify(input.models.textOptions ?? []),
          input.models.image ?? null,
          JSON.stringify(input.models.imageOptions ?? []),
          input.models.video ?? null,
          JSON.stringify(input.models.videoOptions ?? []),
          input.timeoutMs,
          input.allowLocalNetwork ? 1 : 0,
          input.enabled ? 1 : 0,
        )
      return this.get(Number(result.lastInsertRowid))
    } catch (error) {
      if (credentialRef) this.credentials.delete(credentialRef)
      throw this.mapDbError(error)
    }
  }

  update(id: number, value: unknown, options: { preserveHeaders?: boolean } = {}) {
    const row = this.requireRow(id)
    const input = parseAIProviderConfigInput(value)
    const oldBundle = row.credential_ref ? this.readCredential(row.credential_ref) : { headers: {} }
    const nextBundle: ProviderCredentialBundle = {
      apiKey: input.apiKey ?? oldBundle.apiKey,
      headers: options.preserveHeaders ? oldBundle.headers : input.defaultHeaders,
    }
    let createdRef: string | null = null
    let replacedOldSecret: string | null = null
    let nextRef = row.credential_ref
    try {
      if (this.bundleHasSecrets(nextBundle)) {
        const serialized = serializeCredentialBundle(nextBundle)
        if (nextRef) {
          replacedOldSecret = serializeCredentialBundle(oldBundle)
          this.credentials.replace(nextRef, serialized)
        } else {
          createdRef = this.credentials.create(serialized)
          nextRef = createdRef
        }
      } else {
        nextRef = null
      }

      this.db.transaction(() => {
        this.db
          .prepare(
            `
            UPDATE ai_providers SET
              name = ?, protocol = ?, base_url = ?, credential_ref = ?,
              default_headers_json = ?, request_body_json = ?, capabilities_json = ?,
              text_model = ?, text_models_json = ?, image_model = ?, image_models_json = ?,
              video_model = ?, video_models_json = ?, timeout_ms = ?,
              allow_local_network = ?, enabled = ?,
              is_default_text = CASE WHEN ? THEN is_default_text ELSE 0 END,
              is_default_image = CASE WHEN ? THEN is_default_image ELSE 0 END,
              is_default_video = CASE WHEN ? THEN is_default_video ELSE 0 END,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
          )
          .run(
            input.name,
            input.protocol,
            input.baseUrl,
            nextRef,
            JSON.stringify(Object.keys(nextBundle.headers).sort()),
            JSON.stringify(input.requestBody),
            JSON.stringify(input.capabilities),
            input.models.text ?? null,
            JSON.stringify(input.models.textOptions ?? []),
            input.models.image ?? null,
            JSON.stringify(input.models.imageOptions ?? []),
            input.models.video ?? null,
            JSON.stringify(input.models.videoOptions ?? []),
            input.timeoutMs,
            input.allowLocalNetwork ? 1 : 0,
            input.enabled ? 1 : 0,
            input.capabilities.includes('text') && Boolean(input.models.text) ? 1 : 0,
            input.capabilities.includes('image') && Boolean(input.models.image) ? 1 : 0,
            input.capabilities.includes('video') && Boolean(input.models.video) ? 1 : 0,
            id,
          )
        if (!input.enabled) this.markDependentAgentsIncomplete(id)
      })()
    } catch (error) {
      if (createdRef) this.credentials.delete(createdRef)
      if (row.credential_ref && replacedOldSecret !== null) {
        this.credentials.replace(row.credential_ref, replacedOldSecret)
      }
      throw this.mapDbError(error)
    }
    if (row.credential_ref && !nextRef) this.credentials.delete(row.credential_ref)
    return this.get(id)
  }

  removeCredential(id: number) {
    const row = this.requireRow(id)
    if (!row.credential_ref) return this.get(id)
    this.db.prepare('UPDATE ai_providers SET credential_ref = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id)
    this.credentials.delete(row.credential_ref)
    return this.get(id)
  }

  copy(id: number, requestedName?: string) {
    const row = this.requireRow(id)
    const summary = toSummary(row)
    const bundle = row.credential_ref ? this.readCredential(row.credential_ref) : { headers: {} }
    const name = requestedName?.trim() || this.nextCopyName(summary.name)
    return this.create({
      name,
      protocol: summary.protocol,
      baseUrl: summary.baseUrl,
      apiKey: bundle.apiKey,
      defaultHeaders: bundle.headers,
      requestBody: summary.requestBody,
      capabilities: summary.capabilities,
      models: summary.models,
      timeoutMs: summary.timeoutMs,
      allowLocalNetwork: summary.allowLocalNetwork,
      enabled: false,
    })
  }

  setEnabled(id: number, enabled: boolean) {
    this.requireRow(id)
    this.db.transaction(() => {
      this.db
        .prepare(
          `
          UPDATE ai_providers SET
            enabled = ?,
            is_default_text = CASE WHEN ? THEN is_default_text ELSE 0 END,
            is_default_image = CASE WHEN ? THEN is_default_image ELSE 0 END,
            is_default_video = CASE WHEN ? THEN is_default_video ELSE 0 END,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
          `,
        )
        .run(enabled ? 1 : 0, enabled ? 1 : 0, enabled ? 1 : 0, enabled ? 1 : 0, id)
      if (!enabled) this.markDependentAgentsIncomplete(id)
    })()
    return { provider: this.get(id), dependencies: this.getDependencies(id) }
  }

  setDefault(id: number, capability: 'text' | 'image' | 'video') {
    if (!['text', 'image', 'video'].includes(capability)) {
      throw serviceError('invalid_input', 'Invalid default provider capability.')
    }
    const provider = this.get(id)
    if (!provider.enabled || !provider.capabilities.includes(capability) || !provider.models[capability]) {
      throw serviceError('configuration_incomplete', `Provider cannot be the default ${capability} provider.`)
    }
    const column = `is_default_${capability}`
    this.db.transaction(() => {
      this.db.prepare(`UPDATE ai_providers SET ${column} = 0 WHERE ${column} = 1`).run()
      this.db.prepare(`UPDATE ai_providers SET ${column} = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id)
    })()
    return this.get(id)
  }

  recordConnectionStatus(
    id: number,
    status: ProviderRow['connection_status'],
    testedAt = new Date().toISOString(),
  ) {
    this.requireRow(id)
    this.db
      .prepare(
        `
        UPDATE ai_providers SET
          connection_status = ?, last_tested_at = ?,
          last_success_at = CASE WHEN ? = 'connected' THEN ? ELSE last_success_at END,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
      )
      .run(status, testedAt, status, testedAt, id)
    return this.get(id)
  }

  getCredentialBundle(id: number) {
    const row = this.requireRow(id)
    return row.credential_ref ? this.readCredential(row.credential_ref) : { headers: {} }
  }

  getDependencies(id: number): AIProviderDependency[] {
    this.requireRow(id)
    const rows = this.db
      .prepare(
        `
        SELECT id, name, text_provider_id, image_provider_id, video_provider_id
        FROM ai_agents
        WHERE text_provider_id = ? OR image_provider_id = ? OR video_provider_id = ?
        ORDER BY name COLLATE NOCASE, id
        `,
      )
      .all(id, id, id) as Array<{
      id: number
      name: string
      text_provider_id: number
      image_provider_id: number | null
      video_provider_id: number | null
    }>
    return rows.map((agent) => ({
      agentId: agent.id,
      agentName: agent.name,
      usages: [
        ...(agent.text_provider_id === id ? (['text'] as const) : []),
        ...(agent.image_provider_id === id ? (['image'] as const) : []),
        ...(agent.video_provider_id === id ? (['video'] as const) : []),
      ],
    }))
  }

  delete(id: number) {
    const row = this.requireRow(id)
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE ai_agents SET image_provider_id = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE image_provider_id = ?
      `).run(id)
      this.db.prepare(`
        UPDATE ai_agents SET video_provider_id = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE video_provider_id = ?
      `).run(id)
      this.db.prepare(`
        DELETE FROM ai_agents WHERE text_provider_id = ?
      `).run(id)
      this.db.prepare('DELETE FROM ai_providers WHERE id = ?').run(id)
    })()
    if (row.credential_ref) this.credentials.delete(row.credential_ref)
    return true
  }

  private requireRow(id: number) {
    if (!Number.isInteger(id) || id < 1) throw serviceError('invalid_input', 'Invalid AI provider ID.')
    const row = this.db.prepare('SELECT * FROM ai_providers WHERE id = ?').get(id) as ProviderRow | undefined
    if (!row) throw serviceError('not_found', 'AI provider was not found.')
    return row
  }

  private createCredentialIfNeeded(bundle: ProviderCredentialBundle) {
    return this.bundleHasSecrets(bundle) ? this.credentials.create(serializeCredentialBundle(bundle)) : null
  }

  private bundleHasSecrets(bundle: ProviderCredentialBundle) {
    return Boolean(bundle.apiKey) || Object.keys(bundle.headers).length > 0
  }

  private readCredential(ref: string) {
    return deserializeCredentialBundle(this.credentials.reveal(ref))
  }

  private markDependentAgentsIncomplete(providerId: number) {
    this.db
      .prepare(
        `
        UPDATE ai_agents SET configuration_status = 'incomplete', updated_at = CURRENT_TIMESTAMP
        WHERE text_provider_id = ? OR image_provider_id = ? OR video_provider_id = ?
        `,
      )
      .run(providerId, providerId, providerId)
  }

  private nextCopyName(name: string) {
    const base = `${name} Copy`
    let candidate = base
    let suffix = 2
    while (this.db.prepare('SELECT 1 FROM ai_providers WHERE name = ? COLLATE NOCASE').get(candidate)) {
      candidate = `${base} ${suffix++}`
    }
    return candidate
  }

  private mapDbError(error: unknown) {
    if (error instanceof AIServiceError) return error
    const message = error instanceof Error ? error.message : String(error)
    if (/UNIQUE constraint failed: ai_providers\.name/i.test(message)) {
      return serviceError('invalid_input', 'An AI provider with this name already exists.')
    }
    return serviceError('storage_error', 'AI provider configuration could not be saved.', true)
  }
}
