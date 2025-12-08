# Control Markets - Persona-Based AI Agent Backend

This repository contains the backend for **Control Markets**, a powerful open-source platform for creating and managing persona-based AI agents to automate marketing and content generation workflows.

## 🎯 About the Project

Control Markets allows you to build AI agents with distinct personalities, psychological profiles, and communication patterns. These agents go beyond simple chatbots; they embody your brand, automate tasks, analyze market trends, and even generate engaging video content for platforms like TikTok.

### ✨ Key Features

* **Persona-Based Agents**: Create agents with unique names, personalities, voices, and communication styles.
* **AI-Powered Tasks**: Automate content generation, social media workflows, and other repetitive tasks.
* **Market Monitoring**: Analyze trends and social networks to gain a competitive edge.
* **Viral Video Generation**: Automatically create engaging short-form videos.
* **Extensible & Customizable**: Built with a modular architecture using NestJS, allowing you to adapt the platform to your specific needs by adding custom nodes, integrations, and agent behaviors.

### 🤔 Why Open Source?

I believe in the power of community-driven innovation. By open-sourcing this project, I aim to provide a transparent, customizable, and collaborative platform for developers and marketers to build the future of AI automation.

## 🚀 Getting Started

### Prerequisites

* [Node.js](https://nodejs.org/) (v18 or later recommended)
* [pnpm](https://pnpm.io/) (or npm/yarn)
* Access to various API keys for services you want to integrate (e.g., OpenAI, Google Cloud, Notion).

### Installation

1. **Clone the repository:**

   ```bash
   git clone https://github.com/adamofig/control-markets-node.git
   cd control-markets-node
   ```
1. **Install dependencies:**

   ```bash
   pnpm install
   or 
   npm install --force // since there is a library deprecated i'll remove in the future. 
   ```
1. **Configure environment variables:**

   - Rename `.env.example` to `.env`.
   - Fill in the necessary API keys and configuration values for the services you intend to use.
1. **Run the application:**

   ```bash
   npm run start:dev
   ```

   The application will be running in watch mode at `http://localhost:3000`.

### Development Scripts

* `npm run start`: Start the application.
* `npm run start:dev`: Start in watch mode for development.
* `npm run start:debug`: Start in debug mode.
* `npm run build`: Build the project for production.
* `npm run format`: Format the code with Prettier.
* `npm run lint`: Lint the code with ESLint.
* `npm run test`: Run tests.

## 🏗️ Architecture

This project is built with [NestJS](https://nestjs.com/), a progressive Node.js framework for building efficient and scalable server-side applications. It leverages a modular architecture, making it easy to extend and maintain.

Key technologies used:

* **Framework**: NestJS with Fastify
* **Database**: MongoDB (via Mongoose)
* **AI Integrations**: OpenAI, Google Vertex AI, Groq, Ollama
* **Cloud Services**: Google Cloud, Firebase
* **Other Tools**: Playwright for web scraping, Minio for object storage, and various other libraries for specific integrations.

## 🤝 Contributing

Contributions are welcome! The project is designed to be easy to understand and modify. If you have ideas for improvements or new features, feel free to open an issue or submit a pull request.

## 📄 License

Unfortunelly i haven't decide yet. 