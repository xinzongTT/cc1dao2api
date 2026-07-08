export function KeyCreateResult({ plaintextKey }) {
  if (!plaintextKey) return null;
  return (
    <div className="key-result" role="status">
      <span>Plaintext key</span>
      <code>{plaintextKey}</code>
    </div>
  );
}
