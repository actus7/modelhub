import { PUTER_DEFAULT_MODEL, PUTER_MODELS } from '@/lib/puter-models'
import { createProviderApp, jsonErrorResponse } from '../lib/provider-core'

const app = createProviderApp({
  providerId: 'puter',
  basePath: '/puter',
  models: PUTER_MODELS,
  defaultModel: PUTER_DEFAULT_MODEL,
  chat: async () =>
    jsonErrorResponse(
      400,
      'Puter Xiaomi MiMo usa a sessao Puter do navegador. Use o chat web do ModelHub para este provider.',
    ),
})

export { PUTER_MODELS }
export default app.fetch
