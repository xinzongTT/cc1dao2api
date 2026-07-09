export function KeyCreateResult({ plaintextKey }) {
  if (!plaintextKey) return null;
  return (
    <div className="key-result" role="status">
      <span>明文密钥</span>
      <code>{plaintextKey}</code>
    </div>
  );
}
