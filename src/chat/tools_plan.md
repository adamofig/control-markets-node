Polilan Platform Agentic Features Capability Report
This report outlines all the endpoints and functions available in the Polilan platform (Backend / NestJS context) that can be exposed as tools for an AI Agent. Exposing these modules allows the AI to transition from a generic chatbot to a powerful, contextual copilot capable of taking autonomous actions on behalf of the user.

1. 👤 User Identity & Context
Goal: Allow the AI to deliver highly personalized interactions by understanding who the user is, what they are learning, and their current progress.

Available Capabilities (Controllers: app-user.controller.ts, user-metadata.controller.ts)
Get User Profile & Settings: Expose tools like getUserProfile, getUserSettings to let the AI know the user's base/target languages, audio speed preferences, and auth metadata. (Currently implemented in chat.service.ts).
Get User Stats & Progress: Expose tools like getUserStats, fetch progress via user-metadata/:userId/progress-tracker.
AI Use Case: "How many points do I have?" -> AI queries stats and says "You have 450 points, keep going!"
AI Use Case: AI checks newsViewed or lessonTaken endpoints to recommend content the user hasn't seen yet.
Update Preferences: AI can trigger the api/init/user/change-language endpoint to switch the user's focus language mid-conversation.
2. 📖 Core Vocabulary & Grammar (Lexicore)
Goal: Empower the AI to act as a native language dictionary, grammar checker, and custom tutor based on Polilan's structured database.

Available Capabilities (Controllers: words.controller.ts, verbs.controller.ts, user-words.controller.ts)
Query Words & Definitions (api/word & api/lexicore-queries): Search the core Lexicore database for precise definitions, IPA pronunciation, and native explanations.
Conjugate Verbs (api/verb): Let the AI pull exact conjugation tables.
AI Use Case: "Show me the past tense of 'Comer'." -> agent pulls the real table instead of guessing.
Access User's Saved Words (api/user-word): getUserWords is available.
AI Use Case: "Quiz me on my recently saved French words." -> Agent pulls the exact words the user saved yesterday and starts a quiz session.
Fetch Learning Examples (api/learningExamples): The AI can look up high-quality contextual sentences using target vocabulary.
3. 🧠 Content Generation Factories
Goal: Let the AI autonomously build new studying material or initiate background jobs for the user.

Available Capabilities (Controllers: conversation-cards-generation.controller.ts, words-generation.controller.ts, autogeneration-lexicore.controller.ts)
Generate Conversation Cards (api/generate-conversation-cards):
AI Use Case: The user says, "I have an interview tomorrow in Spanish," and the agent triggers generate-conversation-cards/ideas or /generate, creating custom cards specifically for their upcoming scenario.
Image & Media Generation (generate-missing-data/:id, generate-image/:id):
AI Use Case: Agent sees a word has no image and dispatches a background job to generate an image or pronunciation audio for the user's custom word.
Manage Background Queues (api/bull-queues): Allow an Admin AI agent to check queue health or restart translation jobs as documented in translation_job_management_plan.md.
4. 📚 Lessons, Flashcards & Study Paths
Goal: Provide structured learning experiences driven by active conversation.

Available Capabilities (Controllers: lessons.controller.ts, flashcard-template.controller.ts)
Lesson Recommendations (api/lesson-polilan/recommendation):
AI Use Case: The AI evaluates the user's mistakes in the chat, then calls the recommendation endpoint to suggest the perfect structural lesson.
Flashcard Queries (api/flashcard-template, api/lexicore/flashcard):
AI Use Case: AI fetches available template formats and renders a visual flashcard directly inside the chat interface using Angular/Vercel AI SDK UI tools.
5. 💬 Social & Community Interactions
Goal: Connect the user with the community without leaving the chat interface.

Available Capabilities (Controllers: reaction.controller.ts, comments.controller.ts)
Read & Post Comments (api/comment):
AI Use Case: The AI summarizes what other users are saying about a tricky grammar topic, querying recent comments.
Add Reactions (api/reaction): Let the AI automatically heart/like a vocabulary list on the user's behalf if they state they love it.
6. 🛠️ Administrative & Operational Tools
Goal: Internal management performed by specialized admin-tier agents.

Available Capabilities (Controllers: admin.controller.ts, fixes-db-lexicore.controller.ts, flow-utils.controller.ts)
Database Fixes: lexicore/fixes-db and flow-utils for resolving execution states (Nodes and Flows synchronization).
Global Word Management: Add/Edit/Delete words from the global dictionary (api/admin/word).
User Management: Audit claims (/claims/:email), moderate users. Admin agents could do this over conversational slack/discord interfaces or customized dashboards.
Conclusion & Next Steps for the AI SDK
Currently, the ChatService inside src/chat/index.md is beautifully set up with the Google Gemini provider and a specific tools object containing:

getUserProfile
getUserStats
getUserSettings
getUserWords
getScore
To expand your Agentic offerings, we should consider wrapping the following functions into tools:

getLessonRecommendations(userId) - Fetches from api/lesson-polilan/recommendation.
searchDictionaryWord(word) - Fetches from api/word or api/lexicore-queries.
generateConversationTopic(scenario) - Triggers api/generate-conversation-cards/ideas.
getVerbConjugations(verb) - Fetches from api/verb.
By simply adding these to the streamText({ tools: { ... } }) block with proper Zod descriptions, Gemini will natively integrate the entirety of Polilan's ecosystem into the chat loop!