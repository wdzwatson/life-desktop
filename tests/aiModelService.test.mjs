import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import { AIModelService } from '../electron/ai/modelService.ts'
import { DEFAULT_MODEL_CATALOG, initializeAISchema } from '../electron/ai/schema.ts'

function createDb() {
  const db = new Database(':memory:')
  initializeAISchema(db)
  db.prepare(`
    INSERT INTO ai_providers (
      name, protocol, base_url, capabilities_json, text_model, text_models_json,
      image_model, image_models_json, enabled, is_default_text, is_default_image
    ) VALUES ('Primary', 'openai_compatible', 'https://api.example.test/v1',
      '["text","image"]', 'alpha', '["alpha","beta"]', 'image-1', '["image-1","image-2"]', 1, 1, 1)
  `).run()
  db.prepare(`
    INSERT INTO ai_providers (
      name, protocol, base_url, capabilities_json, video_model, video_models_json, enabled, is_default_video
    ) VALUES ('Motion', 'xai', 'https://video.example.test/v1', '["video"]', 'video-1', '["video-1","video-2"]', 1, 1)
  `).run()
  for (const [name, capabilities] of [
    ['alpha', ['text', 'image']], ['beta', ['text']], ['image-1', ['image']], ['image-2', ['image']], ['video-1', ['video']], ['video-2', ['video']],
  ]) db.prepare('INSERT INTO ai_model_catalog (name, capabilities_json) VALUES (?, ?)').run(name, JSON.stringify(capabilities))
  return db
}

test('model service keeps a global catalog and creates one managed chat profile per selected text model', () => {
  const db = createDb()
  const service = new AIModelService(db)
  const models = service.list()
  const expectedModels = [
    ...DEFAULT_MODEL_CATALOG,
    { name: 'alpha', capabilities: ['text', 'image'] },
    { name: 'beta', capabilities: ['text'] },
    { name: 'image-1', capabilities: ['image'] },
    { name: 'image-2', capabilities: ['image'] },
    { name: 'video-1', capabilities: ['video'] },
    { name: 'video-2', capabilities: ['video'] },
  ].sort((left, right) => left.name.localeCompare(right.name))
  assert.deepEqual(models.map((model) => [model.capabilities, model.name]), [
    ...expectedModels.map((model) => [model.capabilities, model.name]),
  ])
  service.syncManagedAgents()
  const agents = db.prepare(`
    SELECT text_model, image_provider_id, video_provider_id, is_default, managed_model_key
    FROM ai_agents ORDER BY text_model
  `).all()
  assert.equal(agents.length, 2)
  assert.deepEqual(agents.map((agent) => [agent.text_model, agent.image_provider_id, agent.video_provider_id]), [
    ['alpha', 1, 2],
    ['beta', 1, 2],
  ])
  assert.equal(agents.find((agent) => agent.text_model === 'alpha').is_default, 1)
  assert.ok(agents.every((agent) => agent.managed_model_key))
  db.close()
})

test('the global model catalog stays alphabetically flat across capabilities', () => {
  const db = createDb()
  db.prepare('INSERT INTO ai_model_catalog (name, capabilities_json) VALUES (?, ?)')
    .run('aardvark-video', '["video"]')
  db.prepare('INSERT INTO ai_model_catalog (name, capabilities_json) VALUES (?, ?)')
    .run('zulu-text', '["text"]')

  const models = new AIModelService(db).list()
  assert.equal(models[0].name, 'aardvark-video')
  assert.equal(models.at(-1).name, 'zulu-text')
  assert.equal(models.filter((model) => model.name === 'alpha').length, 1)
  db.close()
})

test('model categories are stored independently from capabilities', () => {
  const db = createDb()
  const service = new AIModelService(db)
  const created = service.create({ name: 'claude-sonnet-4', category: 'claude', capabilities: ['text'] })
  assert.equal(created.category, 'claude')
  assert.equal(service.update(created.id, { name: created.name, category: 'anthropic', capabilities: ['text'] }).category, 'anthropic')
  db.close()
})

test('model synchronization removes stale managed profiles while preserving conversation snapshots', () => {
  const db = createDb()
  const service = new AIModelService(db)
  const beta = service.listRuntimeProfiles().find((model) => model.model === 'beta')
  db.prepare(`
    INSERT INTO ai_conversations (title, agent_id, agent_snapshot_json)
    VALUES ('History', ?, '{"providers":{"text":{"model":"beta"}}}')
  `).run(beta.agentId)
  db.prepare(`
    UPDATE ai_providers SET text_models_json = '["alpha"]', text_model = 'alpha' WHERE id = 1
  `).run()
  service.syncManagedAgents()
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM ai_agents WHERE text_model = 'beta'").get().count, 0)
  const conversation = db.prepare('SELECT agent_id, agent_snapshot_json FROM ai_conversations').get()
  assert.equal(conversation.agent_id, null)
  assert.match(conversation.agent_snapshot_json, /beta/)
  db.close()
})

test('editing a catalog model updates selected provider references without binding the catalog entry', () => {
  const db = createDb()
  const service = new AIModelService(db)
  const image = service.list().find((model) => model.name === 'image-1')
  service.update(image.id, { name: 'image-primary', capabilities: ['image', 'video'] })
  const provider = db.prepare('SELECT image_model, image_models_json FROM ai_providers WHERE id = 1').get()
  assert.equal(provider.image_model, 'image-primary')
  assert.equal(provider.image_models_json, '["image-primary","image-2"]')
  assert.deepEqual(service.list().find((model) => model.id === image.id).name, 'image-primary')
  db.close()
})

test('model capabilities can be combined but referenced capabilities cannot be removed', () => {
  const db = createDb()
  const service = new AIModelService(db)
  const alpha = service.list().find((model) => model.name === 'alpha')
  assert.deepEqual(alpha.capabilities, ['text', 'image'])
  assert.throws(
    () => service.update(alpha.id, { name: 'alpha', capabilities: ['image'] }),
    /before removing its capability/,
  )
  service.update(alpha.id, { name: 'alpha', capabilities: ['text', 'image', 'video'] })
  assert.deepEqual(service.list().find((model) => model.id === alpha.id).capabilities, ['text', 'image', 'video'])
  db.close()
})
