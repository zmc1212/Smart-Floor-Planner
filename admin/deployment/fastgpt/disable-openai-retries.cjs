// Pilot-only transport boundary. FastGPT v4.17.4 constructs OpenAI clients with
// maxRetries:2. The SDK retry-count header prevents automatic model replay even
// when Next.js bundles the SDK inside server chunks.
function fenceModelFetch(originalFetch, proxyHost = 'aiproxy:3000') {
  return async function(input, init) {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    const headers = new Headers(init?.headers || input?.headers);
    const ordinal = headers.get('x-stainless-retry-count');
    if (url.host !== proxyHost || ordinal === null) return originalFetch(input, init);
    if (ordinal !== '0') {
      console.info('[xiaok-fastgpt-pilot] blocked automatic model replay');
      throw new Error('xiaok_no_automatic_model_replay');
    }
    console.info('[xiaok-fastgpt-pilot] forwarding one model request');
    const response = await originalFetch(input, init);
    if (response.ok) return response;
    const responseHeaders = new Headers(response.headers);
    responseHeaders.set('x-should-retry', 'false');
    return new Response(response.body, {status: response.status, statusText: response.statusText, headers: responseHeaders});
  };
}
globalThis.fetch = fenceModelFetch(globalThis.fetch.bind(globalThis), new URL(process.env.AIPROXY_API_ENDPOINT || 'http://aiproxy:3000').host);
module.exports = {fenceModelFetch};
