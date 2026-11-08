// src/main/ipc/AIHandlers.js - IPC handlers for AI operations
const { ipcMain } = require('electron');

class AIHandlers {
  constructor(aiService) {
    this.aiService = aiService;
    this.registerHandlers();
    console.log('🤖 AI IPC handlers registered');
  }

  registerHandlers() {
    // Test AI connection
    ipcMain.handle('ai:test-connection', async () => {
      console.log('📡 IPC: ai:test-connection');
      try {
        return await this.aiService.testConnection();
      } catch (error) {
        console.error('❌ Error testing AI connection:', error);
        return {
          success: false,
          message: error.message
        };
      }
    });

    // Check if AI is enabled
    ipcMain.handle('ai:is-enabled', async () => {
      console.log('📡 IPC: ai:is-enabled');
      try {
        return {
          success: true,
          enabled: this.aiService.isAIEnabled()
        };
      } catch (error) {
        console.error('❌ Error checking AI status:', error);
        return {
          success: false,
          enabled: false,
          message: error.message
        };
      }
    });

    // Analyze and optimize prompt with AI
    ipcMain.handle('ai:optimize-prompt', async (event, tags, options = {}) => {
      console.log('📡 IPC: ai:optimize-prompt');
      console.log(`📝 Analyzing ${tags.length} tags (provider: ${options.provider || 'huggingface'})...`);

      try {
        // For HuggingFace, require a token. For Ollama, allow without token.
        if (options.provider !== 'ollama' && !this.aiService.isAIEnabled()) {
          return {
            success: false,
            message: 'AI is not enabled. Please enable AI and add your Hugging Face API token in Settings.'
          };
        }

        const onProgress = (data) => {
          try { if (!event.sender.isDestroyed()) event.sender.send('ai:progress', data); } catch {}
        };

        const result = await this.aiService.analyzeAndOptimizePrompt(tags, options, onProgress);
        return result;

      } catch (error) {
        console.error('❌ Error optimizing prompt:', error);
        return {
          success: false,
          message: error.message,
          userMessage: 'Failed to optimize prompt with AI. Please check your settings and try again.'
        };
      }
    });

    // Generate negative prompt with AI
    ipcMain.handle('ai:generate-negative-prompt', async (event, positiveTags, options = {}) => {
      console.log('📡 IPC: ai:generate-negative-prompt');
      
      try {
        // Check if AI is enabled
        if (!this.aiService.isAIEnabled()) {
          return {
            success: false,
            message: 'AI is not enabled. Please enable AI in Settings.'
          };
        }

        const result = await this.aiService.generateNegativePrompt(positiveTags, options);
        return result;

      } catch (error) {
        console.error('❌ Error generating negative prompt:', error);
        return {
          success: false,
          message: error.message
        };
      }
    });

    // Chat completion (general purpose)
    ipcMain.handle('ai:chat-completion', async (event, messages, options = {}) => {
      console.log('📡 IPC: ai:chat-completion');
      
      try {
        // Allow Ollama without an HF token
        if (options?.provider !== 'ollama' && !this.aiService.isAIEnabled()) {
          return {
            success: false,
            message: 'AI is not enabled. Please enable AI in Settings.'
          };
        }

        const onProgress = (data) => {
          try { if (!event.sender.isDestroyed()) event.sender.send('ai:progress', data); } catch {}
        };

        const result = await this.aiService.chatCompletion(messages, options, onProgress);
        return result;

      } catch (error) {
        console.error('❌ Error in chat completion:', error);
        return {
          success: false,
          message: error.message
        };
      }
    });

    // Get available models
    ipcMain.handle('ai:get-models', async () => {
      console.log('📡 IPC: ai:get-models');
      try {
        return {
          success: true,
          models: this.aiService.getAvailableModels()
        };
      } catch (error) {
        console.error('❌ Error getting models:', error);
        return {
          success: false,
          message: error.message
        };
      }
    });

    // List Ollama models from local instance
    ipcMain.handle('ai:list-ollama-models', async () => {
      console.log('📡 IPC: ai:list-ollama-models');
      try {
        return await this.aiService.listOllamaModels();
      } catch (error) {
        console.error('❌ Error listing Ollama models:', error);
        return { success: false, message: error.message };
      }
    });

    // Check if Ollama is reachable
    ipcMain.handle('ai:check-ollama', async () => {
      console.log('📡 IPC: ai:check-ollama');
      try {
        return await this.aiService.checkOllama();
      } catch (error) {
        console.error('❌ Error checking Ollama:', error);
        return { success: false, message: error.message };
      }
    });

    // Search HuggingFace model hub
    ipcMain.handle('ai:search-hf-models', async (event, query, limit) => {
      try {
        return await this.aiService.searchHuggingFaceModels(query, limit);
      } catch (error) {
        console.error('❌ Error searching HF models:', error);
        return { success: false, message: error.message };
      }
    });

    // Pull (download) an Ollama model — streams progress back via ai:ollama-pull-progress
    ipcMain.handle('ai:pull-ollama-model', async (event, modelName) => {
      console.log(`📡 IPC: ai:pull-ollama-model (${modelName})`);
      try {
        const onProgress = (data) => {
          try {
            if (!event.sender.isDestroyed()) event.sender.send('ai:ollama-pull-progress', data);
          } catch {}
        };
        return await this.aiService.pullOllamaModel(modelName, onProgress);
      } catch (error) {
        console.error('❌ Error pulling Ollama model:', error);
        return { success: false, message: error.message };
      }
    });
  }
}

module.exports = AIHandlers;
