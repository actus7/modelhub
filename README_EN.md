<p align="right"><a href="README.md">Portugues</a></p>

# ModelHub

<div align="center">

![ModelHub Logo](https://img.shields.io/badge/ModelHub-AI%20Gateway-blue?style=for-the-badge)

**Unified hub for multiple AI models with OpenAI-compatible API**

[![CI](https://github.com/Geeks-Zone/modelhub/actions/workflows/ci.yml/badge.svg)](https://github.com/Geeks-Zone/modelhub/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16.2-black)](https://nextjs.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/Geeks-Zone/modelhub/pulls)

[Features](#features) |
[Installation](#installation) |
[Documentation](#documentation) |
[Contributing](#contributing) |
[License](#license)

</div>

---

## About

ModelHub is an open-source platform that unifies access to multiple AI providers (OpenAI, Anthropic, Google, Groq, Mistral, and others) through a single OpenAI-compatible API. It includes a built-in chat interface, secure credential management, and a robust authentication system.

### Features

- **Unified API Gateway** - OpenAI-compatible interface for multiple providers
- **Built-in Chat** - Modern web interface for interacting with AI models
- **Secure Authentication** - Complete system with Neon Auth
- **Credential Management** - Encrypted storage for API keys
- **Usage Dashboard** - Monitor consumption and costs in real time
- **Attachment Support** - Upload images, PDFs, and documents
- **Multi-tenant** - Support for multiple users and organizations
- **Easy Deploy** - Ready for Vercel, Docker, and other platforms
- **TypeScript** - Fully typed for better DX
- **Tested** - Test coverage with Vitest

### Supported Providers

- OpenAI (GPT-4, GPT-3.5, etc.)
- Anthropic (Claude 3.5, Claude 3, etc.)
- Google AI (Gemini Pro, Gemini Flash)
- Groq (Llama, Mixtral)
- Mistral AI
- Cohere
- HuggingFace
- OpenRouter
- Vercel AI Gateway

## Installation

### Prerequisites

- Node.js >= 22.0.0
- pnpm >= 10.0.0
- [Neon](https://neon.tech) account (serverless PostgreSQL)
- API keys for the providers you want to use

### Quick Start

```bash
# Clone the repository
git clone https://github.com/Geeks-Zone/modelhub.git
cd modelhub

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env
# Edit .env with your credentials

# Run database migrations
pnpm prisma:migrate

# Start the development server
pnpm dev
```

Visit http://localhost:3000

### Docker

```bash
docker build -t modelhub .
docker run -p 3000:3000 --env-file .env modelhub
```

### Deploy to Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/Geeks-Zone/modelhub)

## Documentation

| Document | Description |
|----------|-------------|
| [Quick Start](docs/QUICKSTART.md) | Get up and running in minutes |
| [API Reference](docs/API.md) | Complete API documentation |
| [Architecture](docs/ARCHITECTURE.md) | Technical architecture overview |
| [Deployment](docs/DEPLOYMENT.md) | Deploy guides (Vercel, Docker, VPS) |
| [Examples](docs/EXAMPLES.md) | Practical usage examples |
| [FAQ](docs/FAQ.md) | Frequently asked questions |

### API Usage

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{
    "model": "openrouter/openai/gpt-oss-20b:free",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Contributing

Contributions are very welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

1. Fork the project
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'feat: add AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md) code of conduct.

## Security

To report security vulnerabilities, see [SECURITY.md](SECURITY.md).

## License

This project is licensed under the MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgements

- [Next.js](https://nextjs.org/) - React Framework
- [Prisma](https://www.prisma.io/) - ORM
- [Neon](https://neon.tech/) - PostgreSQL Serverless
- [shadcn/ui](https://ui.shadcn.com/) - UI Components
- [Hono](https://hono.dev/) - Web Framework

---

<div align="center">

**[Back to top](#modelhub)**

Made with care by the ModelHub community

</div>
