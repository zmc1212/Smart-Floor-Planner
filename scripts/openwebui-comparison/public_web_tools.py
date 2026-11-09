"""
title: Mature domestic search and browser reader
version: 1.0.0
description: Stock Open WebUI/SearXNG and isolated Crawl4AI 0.9.2; no custom HTML parser.
"""
import hashlib
import json
import re
import time
from urllib.parse import quote, urlsplit, urlunsplit
import httpx
from fastapi import Request
from open_webui.models.config import Config
from open_webui.models.users import UserModel
from open_webui.retrieval.web.utils import validate_url
from open_webui.routers.retrieval import search_web as configured_search


class Tools:
    def __init__(self):
        self._states = {}

    def _state(self, metadata):
        key = (metadata or {}).get('chat_id', ''), (metadata or {}).get('message_id', '')
        now = time.monotonic()
        self._states = {k: v for k, v in self._states.items() if now-v['at'] < 1200}
        return self._states.setdefault(key, {'at': now, 'searches': set(), 'urls': set(), 'digests': set()})

    def _error(self, code, **extra):
        return json.dumps({'error': code, **extra}, ensure_ascii=False)

    def _canonical(self, value):
        p = urlsplit(value)
        if p.scheme not in ('http', 'https') or not p.hostname or p.username or p.password:
            raise ValueError('Only public HTTP(S) URLs without credentials')
        return urlunsplit((p.scheme.lower(), p.netloc.lower(), quote(p.path or '/', safe="/%:@!$&'()*+,;=-._~"), p.query, ''))

    async def search_web(self, query: str, count: int = 10, __request__: Request = None,
                         __user__: dict = None, __metadata__: dict = None) -> str:
        """Search configured domestic free SearXNG engines; snippets are discovery only.
        Read relevant actual links with fetch_url; never guess manufacturer URLs.
        :param query: Public topic only; exclude personal, enterprise and project identifiers.
        :param count: Maximum candidates, up to 10.
        """
        state = self._state(__metadata__)
        normalized = re.sub(r'\s+', ' ', query.strip().casefold())
        if normalized in state['searches']:
            return self._error('duplicate_search', action='Use existing results or state the gap.')
        if len(state['searches']) >= 3:
            return self._error('search_budget_exhausted', action='Answer with existing evidence and gaps.')
        state['searches'].add(normalized)
        try:
            results = await configured_search(__request__, await Config.get('web.search.engine'), query,
                                             UserModel(**__user__) if __user__ else None)
            unique, seen = [], set()
            for item in results or []:
                url = self._canonical(item.link)
                if url not in seen:
                    seen.add(url)
                    unique.append({'title': item.title, 'link': url, 'snippet': item.snippet})
            return json.dumps({'status': 'discovery_only', 'results': unique[:max(1,min(count,10))],
                               'remaining_searches': 3-len(state['searches'])}, ensure_ascii=False)
        except Exception as exc:
            return self._error(type(exc).__name__, detail=str(exc)[:500])

    async def fetch_url(self, url: str, goal: str = '', __request__: Request = None,
                        __metadata__: dict = None) -> str:
        """Read actual public page links through Crawl4AI's browser and return Markdown/real links.
        PDFs use pypdf. TLS verification and upstream DNS-pinning/redirect SSRF guards stay on.
        Navigation, snippets, empty/blocked/error pages do not establish technical requirements.
        Follow returned real links; at most 6 distinct reads per response; no repeated failed URL.
        :param url: An actual search result or actual page link, never an invented path.
        :param goal: Public topic to read, excluding private enterprise/project information.
        """
        state = self._state(__metadata__)
        try:
            url = self._canonical(url)
            validate_url(url)
            if url in state['urls']:
                return self._error('duplicate_url', url=url, action='Use existing links or state the gap.')
            if len(state['urls']) >= 6:
                return self._error('page_budget_exhausted', action='Answer with existing evidence and gaps.')
            state['urls'].add(url)
            async with httpx.AsyncClient(timeout=52, trust_env=False) as client:
                response = await client.post('http://host.docker.internal:18096/read', headers={'Host': '127.0.0.1:18094'}, json={'url': url, 'goal': goal})
                page = response.json()
                response.raise_for_status()
            if page.get('error'):
                return self._error(page['error'], url=url, detail=page.get('detail',''), action='Use another actual link or state the gap; do not retry.')
            assert page.get('tls_verification') is True
            digest = page['sha256']
            if digest in state['digests']:
                return self._error('duplicate_content', url=page['url'], links=page.get('links',[]))
            state['digests'].add(digest)
            if page['body_chars'] < 250:
                return self._error('insufficient_page_body', url=page['url'], title=page['title'], links=page.get('links',[]), action='Follow an actual relevant link; this does not prove technical requirements.')
            # Only this server-side reader receipt is eligible for continuation.
            # The Filter signs the full body before saving it in stock sources.
            if __metadata__ is not None:
                __metadata__.setdefault('verified_web_pages', {})[url] = page
            return ('# '+page['title']+'\n\n'+page['text']+'\n\nSource URL: '+page['url']+
                    '\nReader: '+page['reader']+'\nBody SHA256: '+digest+
                    '\nRemaining page reads: '+str(6-len(state['urls']))+
                    '\nActual page links (not yet read):\n'+json.dumps(page.get('links',[]),ensure_ascii=False))
        except Exception as exc:
            return self._error(type(exc).__name__, url=url, detail=str(exc)[:500], action='Use another actual link or explain the source gap; keep TLS/SSRF on.')
