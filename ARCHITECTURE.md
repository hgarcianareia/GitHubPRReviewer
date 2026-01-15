# Arquitectura del Proyecto - AI PR Review

## Estructura del Monorepo

```
GitHubPRReviewer/
├── packages/
│   ├── core/                    # Lógica compartida
│   │   └── src/
│   │       ├── index.js         # Exports públicos
│   │       ├── review-engine.js # Motor principal de revisión
│   │       ├── platform-adapter.js # Clase base abstracta
│   │       └── utils.js         # Utilidades (parseDiff, validaciones, etc.)
│   │
│   ├── github/                  # Adaptador para GitHub
│   │   └── src/
│   │       ├── index.js         # Export de GitHubAdapter
│   │       ├── cli.js           # Entry point: npx ai-pr-review-github
│   │       └── github-adapter.js # Implementación para GitHub API
│   │
│   └── bitbucket/               # Adaptador para Bitbucket
│       └── src/
│           ├── index.js         # Export de BitbucketAdapter
│           ├── cli.js           # Entry point: npx ai-pr-review-bitbucket
│           └── bitbucket-adapter.js # Implementación para Bitbucket API
│
├── .github/
│   └── workflows/
│       └── pr-review.yml        # Workflow de ejemplo para GitHub Actions
│
├── bitbucket-pipelines.yml      # Pipeline de ejemplo para Bitbucket
├── package.json                 # Monorepo root (npm workspaces)
└── README.md
```

## Paquetes npm Publicados

| Paquete | Descripción |
|---------|-------------|
| `@hgarcianareia/ai-pr-review-core` | Motor de revisión + utilidades |
| `@hgarcianareia/ai-pr-review-github` | Adaptador GitHub + CLI |
| `@hgarcianareia/ai-pr-review-bitbucket` | Adaptador Bitbucket + CLI |

## Flujo de Ejecución

```
┌─────────────────────────────────────────────────────────────────┐
│                    CI/CD Pipeline                                │
│  (GitHub Actions o Bitbucket Pipelines)                         │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                      CLI (cli.js)                                │
│  - Valida ANTHROPIC_API_KEY                                     │
│  - Crea el adaptador de plataforma                              │
│  - Instancia ReviewEngine                                        │
│  - Ejecuta engine.run()                                          │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                 ReviewEngine (core)                              │
│  - Carga configuración (.github/ai-review.yml)                  │
│  - Obtiene diff y archivos cambiados via adaptador              │
│  - Filtra archivos ignorados                                     │
│  - Envía diff a Claude API                                       │
│  - Parsea respuesta JSON de Claude                               │
│  - Formatea comentarios y summary                                │
│  - Llama a adaptador.postReview()                               │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│              PlatformAdapter (GitHub o Bitbucket)                │
│  - getDiff()           → Obtiene el diff del PR                 │
│  - getChangedFiles()   → Lista de archivos modificados          │
│  - getExistingComments() → Comentarios previos (evitar duplicados)│
│  - postReview()        → Publica summary + inline comments      │
│  - APPROVE / REQUEST_CHANGES                                     │
└─────────────────────────────────────────────────────────────────┘
```

## Comunicación entre Componentes

### 1. CLI → ReviewEngine
```javascript
// cli.js
const adapter = await GitHubAdapter.create();  // o BitbucketAdapter
const engine = new ReviewEngine({
  platformAdapter: adapter,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY
});
await engine.run();
```

### 2. ReviewEngine → PlatformAdapter
El ReviewEngine llama métodos del adaptador:
- `adapter.getDiff()` - Obtiene el diff
- `adapter.getChangedFiles()` - Lista de archivos
- `adapter.getFileContent(path)` - Contenido de archivos relacionados
- `adapter.postReview(summary, comments, event)` - Publica la revisión

### 3. ReviewEngine → Claude API
```javascript
// Envía prompt con el diff
const response = await anthropic.messages.create({
  model: config.model,
  messages: [{ role: 'user', content: prompt }],
  max_tokens: config.maxTokens
});
// Parsea JSON de la respuesta
const review = JSON.parse(response.content[0].text);
```

## Diferencias GitHub vs Bitbucket

### Variables de Entorno

| Variable | GitHub | Bitbucket |
|----------|--------|-----------|
| Workspace/Owner | `GITHUB_REPOSITORY_OWNER` | `BITBUCKET_WORKSPACE` |
| Repo | `GITHUB_REPOSITORY` | `BITBUCKET_REPO_SLUG` |
| PR Number | `GITHUB_EVENT_PATH` (JSON) | `BITBUCKET_PR_ID` |
| Commit SHA | `GITHUB_SHA` | `BITBUCKET_COMMIT` |
| Token | `GITHUB_TOKEN` (automático) | `BITBUCKET_API_TOKEN` (manual) |
| Email | No requerido | `BITBUCKET_API_EMAIL` (manual) |

### Autenticación API

| Aspecto | GitHub | Bitbucket |
|---------|--------|-----------|
| Tipo | Bearer token | Basic auth (email:token) |
| Token | `GITHUB_TOKEN` automático | API token manual con scopes |
| Header | `Authorization: Bearer <token>` | `Authorization: Basic <base64>` |

### API de Comentarios

| Aspecto | GitHub | Bitbucket |
|---------|--------|-----------|
| Posición | `position` (diff position) | `line` (número de línea) |
| Review States | APPROVE, REQUEST_CHANGES, COMMENT | APPROVE, REQUEST_CHANGES |
| Reacciones | Soportadas (👍👎) | No soportadas |
| Skip Label | `skip-ai-review` label | Solo via título |

### Endpoints API

**GitHub:**
```
POST /repos/{owner}/{repo}/pulls/{pr}/reviews
POST /repos/{owner}/{repo}/pulls/{pr}/comments
```

**Bitbucket:**
```
POST /repositories/{workspace}/{repo}/pullrequests/{pr}/comments
POST /repositories/{workspace}/{repo}/pullrequests/{pr}/approve
POST /repositories/{workspace}/{repo}/pullrequests/{pr}/request-changes
```

### Obtención del Diff

**GitHub:**
- El workflow hace checkout del código
- Se usa `git diff` localmente
- O se obtiene via API con header `Accept: application/vnd.github.v3.diff`

**Bitbucket:**
- El pipeline obtiene el diff via API con curl
- Requiere `-L` flag para seguir redirects (302)
- Se guarda en `pr_diff.txt` antes de ejecutar el CLI

## Configuración

Archivo de configuración por plataforma:
- GitHub: `.github/ai-review.yml`
- Bitbucket: `.bitbucket/ai-review.yml`

Ambos usan el mismo esquema de configuración (parseado por `core`).

## Limitaciones Conocidas

### Bitbucket
1. **REQUEST_CHANGES en PRs propios**: Bitbucket no permite solicitar cambios en PRs creados por el mismo usuario del token. Usar cuenta de servicio.
2. **Redirects**: Los endpoints `/diff` y `/diffstat` retornan 302. Usar `curl -L`.
3. **jq requerido**: La imagen `node:20` no incluye `jq`. Instalar con `apt-get`.

### GitHub
1. **Rate limits**: Más estrictos que Bitbucket. El código incluye retry con backoff exponencial.
2. **Diff position**: Calcular la posición en el diff es complejo (no es número de línea).

## Publicación de Paquetes

```bash
# Desde el root del monorepo
npm run publish:all   # Publica los 3 paquetes

# Individual
npm run publish:core
npm run publish:github
npm run publish:bitbucket
```

Los paquetes se publican a npmjs.com (público).
