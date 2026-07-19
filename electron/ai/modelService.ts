import type Database from 'better-sqlite3'
import { AIServiceError } from './types'

export type AIModelCapability = 'text' | 'image' | 'video'

export type AIModelCatalogItem = {
  id: number
  name: string
  category: string
  capabilities: AIModelCapability[]
  createdAt: string
  updatedAt: string
}

export type AIModelRuntimeProfile = {
  key: string
  providerId: number
  providerName: string
  model: string
  enabled: boolean
  isDefault: boolean
  agentId?: number
  providers?: { text: number; image?: number; video?: number }
}

type ProviderRow = {
  id: number
  name: string
  text_model: string | null
  text_models_json: string
  image_model: string | null
  image_models_json: string
  video_model: string | null
  video_models_json: string
  enabled: number
  is_default_text: number
  is_default_image: number
  is_default_video: number
}

type ManagedAgentRow = {
  id: number
  managed_model_key: string
  text_provider_id: number
  text_model: string | null
  image_provider_id: number | null
  video_provider_id: number | null
  configuration_status: 'ready' | 'incomplete'
}

function parseArray(value: string, fallback: string | null = null) {
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      const values = [...new Set(parsed.filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim()).filter(Boolean))]
      if (values.length > 0) return values
    }
  } catch {
    // Legacy malformed values fall back to the selected model.
  }
  return fallback ? [fallback] : []
}

function modelKey(providerId: number, model: string) {
  return `${providerId}:text:${model}`
}

function requireModelName(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) {
    throw new AIServiceError({ code: 'invalid_input', message: 'Invalid model name.', retryable: false })
  }
  return value.trim()
}

function requireModelCategory(value: unknown) {
  if (typeof value !== 'string') {
    throw new AIServiceError({ code: 'invalid_input', message: 'Invalid model category.', retryable: false })
  }
  const normalized = value.trim().toLocaleLowerCase()
  if (!normalized || normalized.length > 60 || /[\0\r\n]/.test(normalized)) {
    throw new AIServiceError({ code: 'invalid_input', message: 'Invalid model category.', retryable: false })
  }
  return normalized
}

function requireCapabilities(value: unknown, legacyValue?: unknown): AIModelCapability[] {
  const source = Array.isArray(value) ? value : (legacyValue === undefined ? [] : [legacyValue])
  const capabilities = [...new Set(source)]
  if (capabilities.length === 0 || capabilities.some((item) => item !== 'text' && item !== 'image' && item !== 'video')) {
    throw new AIServiceError({ code: 'invalid_input', message: 'Invalid model capabilities.', retryable: false })
  }
  return capabilities as AIModelCapability[]
}

export class AIModelService {
  constructor(private readonly db: Database.Database) {
    this.db.pragma('foreign_keys = ON')
  }

  list(): AIModelCatalogItem[] {
    const models = this.db.prepare(`
      SELECT id, name, category, capabilities_json, created_at, updated_at
      FROM ai_model_catalog
      ORDER BY name COLLATE NOCASE, id
    `).all().map((row: any) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      capabilities: requireCapabilities(parseArray(row.capabilities_json)),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }))
    return models
  }

  create(value: unknown) {
    const input = this.parseInput(value)
    try {
      const result = this.db.prepare(`
        INSERT INTO ai_model_catalog (name, category, capabilities_json) VALUES (?, ?, ?)
      `).run(input.name, input.category, JSON.stringify(input.capabilities))
      return this.get(Number(result.lastInsertRowid))
    } catch (error) {
      throw this.mapError(error)
    }
  }

  update(id: number, value: unknown) {
    const current = this.get(id)
    const input = this.parseInput(value)
    const removedCapabilities = current.capabilities.filter((capability) => !input.capabilities.includes(capability))
    if (removedCapabilities.length > 0) {
      const references = this.providerReferences(current, removedCapabilities)
      if (references.length > 0) {
        throw new AIServiceError({
          code: 'configuration_incomplete',
          message: `Remove this model from: ${references.join(', ')} before removing its capability.`,
          retryable: false,
        })
      }
    }
    try {
      this.db.transaction(() => {
        this.db.prepare(`
          UPDATE ai_model_catalog SET name = ?, category = ?, capabilities_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
        `).run(input.name, input.category, JSON.stringify(input.capabilities), id)
        if (current.name !== input.name) {
          this.renameProviderReferences(current, input)
        }
      })()
      return this.get(id)
    } catch (error) {
      throw this.mapError(error)
    }
  }

  delete(id: number) {
    const model = this.get(id)
    const references = this.providerReferences(model)
    if (references.length > 0) {
      throw new AIServiceError({
        code: 'configuration_incomplete',
        message: `Model is still selected by: ${references.join(', ')}.`,
        retryable: false,
      })
    }
    this.db.prepare('DELETE FROM ai_model_catalog WHERE id = ?').run(id)
    return true
  }

  listRuntimeProfiles(): AIModelRuntimeProfile[] {
    this.syncManagedAgents()
    const providers = this.providers()
    const agents = this.db.prepare(`
      SELECT id, managed_model_key, text_provider_id, text_model, image_provider_id,
        video_provider_id, configuration_status
      FROM ai_agents WHERE managed_model_key IS NOT NULL
    `).all() as ManagedAgentRow[]
    const agentsByKey = new Map(agents.map((agent) => [agent.managed_model_key, agent]))
    return providers.flatMap((provider) => this.modelsFor(provider, 'text').map((model) => {
      const key = modelKey(provider.id, model)
      const agent = agentsByKey.get(key)
      return {
        key,
        providerId: provider.id,
        providerName: provider.name,
        model,
        enabled: Boolean(provider.enabled) && agent?.configuration_status === 'ready',
        isDefault: Boolean(provider.is_default_text) && provider.text_model === model,
        agentId: agent?.id,
        providers: agent ? {
          text: agent.text_provider_id,
          ...(agent.image_provider_id ? { image: agent.image_provider_id } : {}),
          ...(agent.video_provider_id ? { video: agent.video_provider_id } : {}),
        } : undefined,
      }
    })).sort((left, right) => Number(right.isDefault) - Number(left.isDefault)
      || left.providerName.localeCompare(right.providerName) || left.model.localeCompare(right.model))
  }

  syncManagedAgents() {
    const providers = this.providers()
    const imageProvider = providers.find((provider) => provider.enabled && provider.is_default_image && provider.image_model)
      ?? providers.find((provider) => provider.enabled && provider.image_model)
    const videoProvider = providers.find((provider) => provider.enabled && provider.is_default_video && provider.video_model)
      ?? providers.find((provider) => provider.enabled && provider.video_model)
    const desired = providers.flatMap((provider) => this.modelsFor(provider, 'text').map((model) => ({
      key: modelKey(provider.id, model), provider, model,
    })))
    const desiredKeys = new Set(desired.map((item) => item.key))

    this.db.transaction(() => {
      const current = this.db.prepare(`
        SELECT id, managed_model_key, text_provider_id, text_model, image_provider_id,
          video_provider_id, configuration_status
        FROM ai_agents WHERE managed_model_key IS NOT NULL
      `).all() as ManagedAgentRow[]
      const currentByKey = new Map(current.map((agent) => [agent.managed_model_key, agent]))
      for (const item of desired) {
        const existing = currentByKey.get(item.key)
        const enabled = Boolean(item.provider.enabled)
        if (existing) {
          this.db.prepare(`
            UPDATE ai_agents SET text_provider_id = ?, text_model = ?, image_provider_id = ?,
              video_provider_id = ?, enabled = ?, configuration_status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `).run(item.provider.id, item.model, imageProvider?.id ?? null, videoProvider?.id ?? null,
            enabled ? 1 : 0, enabled ? 'ready' : 'incomplete', existing.id)
        } else {
          this.db.prepare(`
            INSERT INTO ai_agents (
              name, description, system_prompt, text_provider_id, text_model, image_provider_id,
              video_provider_id, model_params_json, context_json, allowed_tools_json,
              blocked_tools_json, tool_approval_mode, max_tool_calls, enabled, is_default,
              managed_model_key, configuration_status
            ) VALUES (?, ?, '', ?, ?, ?, ?, '{}', '{"maxMessages":50}', '[]', '[]',
              'confirm_risky', 8, ?, 0, ?, ?)
          `).run(this.availableAgentName(`${item.model} · ${item.provider.name}`),
            `Managed model profile for ${item.provider.name}.`, item.provider.id, item.model,
            imageProvider?.id ?? null, videoProvider?.id ?? null, enabled ? 1 : 0,
            item.key, enabled ? 'ready' : 'incomplete')
        }
      }
      for (const agent of current) {
        if (!desiredKeys.has(agent.managed_model_key)) this.db.prepare('DELETE FROM ai_agents WHERE id = ?').run(agent.id)
      }
      const preferred = desired.find((item) => item.provider.enabled && item.provider.is_default_text && item.provider.text_model === item.model)
        ?? desired.find((item) => item.provider.enabled)
      if (preferred) {
        this.db.prepare('UPDATE ai_agents SET is_default = 0 WHERE is_default = 1').run()
        this.db.prepare('UPDATE ai_agents SET is_default = 1 WHERE managed_model_key = ?').run(preferred.key)
      }
    })()
    return this.listRuntimeProfilesUnsafe()
  }

  private listRuntimeProfilesUnsafe() {
    return true
  }

  private get(id: number): AIModelCatalogItem {
    if (!Number.isInteger(id) || id < 1) throw new AIServiceError({ code: 'invalid_input', message: 'Invalid model ID.', retryable: false })
    const row = this.db.prepare(`
      SELECT id, name, category, capabilities_json, created_at, updated_at FROM ai_model_catalog WHERE id = ?
    `).get(id) as any
    if (!row) throw new AIServiceError({ code: 'not_found', message: 'Model was not found.', retryable: false })
    return { id: row.id, name: row.name, category: row.category, capabilities: requireCapabilities(parseArray(row.capabilities_json)), createdAt: row.created_at, updatedAt: row.updated_at }
  }

  private parseInput(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new AIServiceError({ code: 'invalid_input', message: 'Invalid model input.', retryable: false })
    }
    const input = value as Record<string, unknown>
    return {
      name: requireModelName(input.name),
      category: requireModelCategory(input.category ?? 'other'),
      capabilities: requireCapabilities(input.capabilities, input.capability),
    }
  }

  private providers() {
    return this.db.prepare(`
      SELECT id, name, text_model, text_models_json, image_model, image_models_json,
        video_model, video_models_json, enabled, is_default_text, is_default_image, is_default_video
      FROM ai_providers ORDER BY name COLLATE NOCASE, id
    `).all() as ProviderRow[]
  }

  private modelsFor(provider: ProviderRow, capability: AIModelCapability) {
    const field = `${capability}_models_json` as const
    const fallback = provider[`${capability}_model` as keyof ProviderRow] as string | null
    return parseArray(provider[field as keyof ProviderRow] as string, fallback)
  }

  private providerReferences(model: AIModelCatalogItem, capabilities = model.capabilities) {
    return [...new Set(this.providers().filter((provider) => capabilities.some(
      (capability) => this.modelsFor(provider, capability).includes(model.name),
    )).map((provider) => provider.name))]
  }

  private renameProviderReferences(current: AIModelCatalogItem, next: { name: string }) {
    const providers = this.providers()
    for (const provider of providers) {
      for (const capability of current.capabilities) {
        const existing = this.modelsFor(provider, capability)
        if (!existing.includes(current.name)) continue
        const models = existing.map((model) => model === current.name ? next.name : model)
        const field = `${capability}_models_json`
        const defaultField = `${capability}_model`
        const currentDefault = provider[defaultField as keyof ProviderRow] as string | null
        const nextDefault = currentDefault === current.name ? next.name : currentDefault
        this.db.prepare(`UPDATE ai_providers SET ${field} = ?, ${defaultField} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .run(JSON.stringify(models), nextDefault, provider.id)
      }
    }
  }

  private availableAgentName(base: string) {
    let candidate = base
    let suffix = 2
    while (this.db.prepare('SELECT 1 FROM ai_agents WHERE name = ? COLLATE NOCASE').get(candidate)) candidate = `${base} ${suffix++}`
    return candidate
  }

  private mapError(error: unknown): AIServiceError {
    if (error instanceof AIServiceError) return error
    if (/UNIQUE constraint failed: ai_model_catalog\.name/i.test(String(error))) {
      return new AIServiceError({ code: 'invalid_input', message: 'A model with this name already exists.', retryable: false })
    }
    return new AIServiceError({ code: 'storage_error', message: 'Model could not be saved.', retryable: true })
  }
}
