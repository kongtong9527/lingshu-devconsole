import Fastify from 'fastify'
import { registerRoutes } from './routes.js'

const PORT = Number(process.env.PORT ?? 5181)

/**
 * 插件目录不落仓相对路径（解析规则在 `plugin-service.ts` 的 `pluginsDir()`）：
 * `--plugins-dir <path>` 是显式入口，写进 env 后由解析器统一消费；
 * 未指定时按 `LINGSHU_PLUGINS_DIR` → `<cwd>/plugins`（母仓开发放符号链接）依次找。
 */
const pluginsDirArgIndex = process.argv.indexOf('--plugins-dir')
if (pluginsDirArgIndex >= 0) {
  const value = process.argv[pluginsDirArgIndex + 1]
  if (!value) {
    console.error('--plugins-dir 需要一个路径参数')
    process.exit(1)
  }
  process.env.LINGSHU_PLUGINS_DIR = value
}

const app = Fastify({ logger: true })

app.get('/api/health', async () => ({ ok: true }))
registerRoutes(app)

const start = async () => {
  try {
    await app.listen({ port: PORT, host: '127.0.0.1' })
    app.log.info(`DevConsole BFF on http://127.0.0.1:${PORT}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}
start()
