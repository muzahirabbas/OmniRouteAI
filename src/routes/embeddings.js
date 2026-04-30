export async function embeddingRoutes(app) {
  app.post('/v1/embeddings', {
    schema: {
      body: {
        type: 'object',
        required: ['input', 'model'],
        properties: {
          input: {
            oneOf: [
              { type: 'string' },
              { type: 'array', items: { type: 'string' } }
            ]
          },
          model: { type: 'string' },
          encoding_format: { type: 'string', enum: ['float', 'base64'], default: 'float' },
          dimensions: { type: 'integer' },
          user: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { input, model, encoding_format = 'float', dimensions, user } = request.body;
    
    const inputs = Array.isArray(input) ? input : [input];
    
    return reply.code(501).send({
      error: {
        message: 'Embeddings endpoint not yet implemented. This requires adding embedding adapter support for providers like OpenAI, Cohere, etc.',
        type: 'not_implemented_error',
        code: 'not_implemented'
      }
    });
  });
}