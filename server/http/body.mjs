export async function readJsonBody(req, maxBytes = 10 * 1024 * 1024) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      const tooLarge = new Error('Request body exceeds limit');
      tooLarge.code = 'body_too_large';
      throw tooLarge;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch (error) {
    const invalidJson = new Error('Invalid JSON body');
    invalidJson.code = 'invalid_json';
    invalidJson.cause = error;
    throw invalidJson;
  }
}
