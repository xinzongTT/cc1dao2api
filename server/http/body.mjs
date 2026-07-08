export async function readJsonBody(req, maxBytes = 10 * 1024 * 1024) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new Error('Request body exceeds limit');
    }
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
