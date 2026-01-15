# AI PR Review - Notas del Proyecto

## ¿Qué es?

Un bot que revisa automáticamente los Pull Requests usando Claude (la IA de Anthropic). Cuando alguien abre un PR, el bot analiza los cambios y deja comentarios sobre posibles bugs, problemas de seguridad, código duplicado, etc.

## ¿Cómo funciona?

1. Alguien abre un PR en GitHub o Bitbucket
2. Se dispara automáticamente un pipeline (GitHub Actions o Bitbucket Pipelines)
3. El pipeline ejecuta nuestro paquete npm
4. El paquete obtiene el diff del PR y se lo envía a Claude
5. Claude analiza el código y devuelve sus comentarios
6. El bot publica los comentarios en el PR

## Estructura del proyecto

Es un **monorepo** con 3 paquetes npm:

| Paquete | ¿Qué hace? |
|---------|------------|
| `core` | La lógica principal: hablar con Claude, parsear el diff, formatear comentarios |
| `github` | Sabe cómo hablar con la API de GitHub |
| `bitbucket` | Sabe cómo hablar con la API de Bitbucket |

La idea es que `core` tiene todo lo compartido, y los adaptadores (`github`, `bitbucket`) solo manejan las diferencias de cada plataforma.

## ¿Cómo se usa?

El usuario final solo necesita:

1. Copiar un archivo de workflow/pipeline a su repo
2. Configurar sus secrets (API key de Anthropic + credenciales de la plataforma)
3. Listo, cada PR se revisa automáticamente

## Diferencias entre GitHub y Bitbucket

| Aspecto | GitHub | Bitbucket |
|---------|--------|-----------|
| Pipeline | GitHub Actions | Bitbucket Pipelines |
| Autenticación | Token automático (`GITHUB_TOKEN`) | Token manual (hay que crear un API token) |
| Config file | `.github/ai-review.yml` | `.bitbucket/ai-review.yml` |

## Limitación importante de Bitbucket

Bitbucket no te deja "solicitar cambios" en tus propios PRs. Si el token es tuyo y el PR es tuyo, el bot puede comentar pero no puede marcar el PR como "necesita cambios". Para eso necesitarías una cuenta de servicio separada.

## ¿Dónde están publicados los paquetes?

En npmjs.com, son públicos:
- `@hgarcianareia/ai-pr-review-core`
- `@hgarcianareia/ai-pr-review-github`
- `@hgarcianareia/ai-pr-review-bitbucket`

## Costos

El costo es principalmente el uso de la API de Claude. Un PR chico cuesta ~$0.01-0.03, uno mediano ~$0.05-0.15.
