"""
title: Stock research discovery and remaining-step control
version: 2.0.0
description: Stock multi-query discovery, signed source continuation and pixel-derived typed measurements.
"""
import json
import re
import os
import hmac
import hashlib
import copy
import httpx
from fastapi import Request
from open_webui.models.chats import Chats
from open_webui.models.config import Config
from open_webui.models.users import UserModel
from open_webui.routers.tasks import generate_queries
from open_webui.routers.retrieval import search_web


class Filter:
    def _signature(self, user_id, chat_id, source_id, document):
        key = os.environ.get('WEBUI_SECRET_KEY') or os.environ.get('OPENAI_API_KEY')
        if not key:
            raise RuntimeError('No server signing key')
        payload = json.dumps([user_id, chat_id, source_id, document], ensure_ascii=False, separators=(',', ':'))
        return hmac.new(key.encode(), payload.encode(), hashlib.sha256).hexdigest()

    def _verified_sources(self, sources, user_id, chat_id):
        accepted = []
        for source in sources or []:
            docs, metas = [], []
            for doc, meta in zip(source.get('document', []), source.get('metadata', [])):
                sid = meta.get('source') or source.get('source', {}).get('id')
                sig = meta.get('reader_signature', '')
                if isinstance(sid, str) and sid.startswith(('https://', 'http://')) and isinstance(doc, str):
                    expected = self._signature(user_id, chat_id, sid, doc)
                    if isinstance(sig, str) and hmac.compare_digest(sig, expected):
                        docs.append(doc)
                        metas.append(meta)
            if docs:
                accepted.append({**copy.deepcopy(source), 'document': docs, 'metadata': metas})
        return accepted

    async def _history_sources(self, metadata, user):
        # Resolve ownership and branch using server records, never caller sources.
        chat_id = metadata.get('chat_id')
        chat = await Chats.get_chat_by_id_and_user_id(chat_id, user['id']) if chat_id else None
        if not chat:
            return []
        messages = await Chats.get_messages_map_by_chat_id(chat_id) or {}
        cursor = metadata.get('message_id')
        chain, visited = [], set()
        while cursor and cursor not in visited and len(visited) < 100:
            visited.add(cursor)
            message = messages.get(cursor) or {}
            if message.get('role') == 'assistant' and cursor != metadata.get('message_id'):
                chain.insert(0, message)
            cursor = message.get('parentId')
        sources, seen = [], set()
        for message in chain:
            for source in self._verified_sources(message.get('sources'), user['id'], chat_id):
                sid = source['metadata'][0]['source']
                if sid not in seen:
                    seen.add(sid)
                    sources.append(source)
        return sources

    def _last_user(self, messages):
        for index in range(len(messages)-1, -1, -1):
            if messages[index].get('role') == 'user':
                content = messages[index].get('content', '')
                if isinstance(content, list):
                    content = '\n'.join(x.get('text', '') for x in content if x.get('type') == 'text')
                return index, content
        return -1, ''

    async def inlet(self, body: dict, __request__: Request, __user__: dict, __metadata__: dict = None) -> dict:
        # Original middleware explicitly supports this trusted per-request cap.
        # Manufacturer discovery can require several genuine navigation pages;
        # a separate request hook reserves the final answer before this cap.
        __request__.state.max_tool_call_iterations = 12
        if __metadata__ is not None:
            # These keys are receipts created only during this server request.
            __metadata__['verified_web_pages'] = {}
            __metadata__['continuation_sources'] = await self._history_sources(__metadata__, __user__)
            __metadata__['continuation_applied'] = False
            __metadata__['pixel_measurements_applied'] = False
        index, question = self._last_user(body.get('messages', []))
        # A discovery step for an explicit request to search the public web.
        # No brand translations, manufacturer URLs or technical answers are stored here.
        if not re.search(r'查一下|联网|搜索|网上|公开说明', question):
            return body
        if re.search(r'不(?:用|必|要|需要).{0,4}(?:联网|搜索|网上)', question):
            return body
        prior_metadata = getattr(__request__.state, 'metadata', None)
        user = UserModel(**__user__)
        try:
            response = await generate_queries(__request__, {
                'model': body['model'], 'messages': [{'role': 'user', 'content': question}],
                'type': 'web_search', 'chat_id': (__metadata__ or {}).get('chat_id'),
            }, user)
            if hasattr(response, 'status_code'):
                if response.status_code >= 400:
                    raise RuntimeError('Original query generation failed: '+str(response.status_code))
                response = json.loads(response.body)
            if 'queries' in response:
                queries = response['queries']
            else:
                text = response['choices'][0]['message']['content']
                match = re.search(r'\{.*\}', text, re.S)
                queries = json.loads(match.group(0) if match else text).get('queries', [])
            if not isinstance(queries, list) or not queries or not all(isinstance(q, str) for q in queries):
                return body
            # Execute the query generator's alternatives, preserving provenance.
            # This is stock multi-query retrieval, not brand/URL substitution.
            candidates, seen, executed = [], set(), []
            for query in list(dict.fromkeys(queries))[:3]:
                results = await search_web(__request__, await Config.get('web.search.engine'), query, user)
                executed.append(query)
                for r in (results or [])[:10]:
                    if r.link not in seen:
                        seen.add(r.link)
                        candidates.append({'title': r.title, 'link': r.link, 'snippet': r.snippet, 'query': query})
            discovery = {'queries': executed, 'candidates': candidates[:24],
                         'status': 'discovery_only_not_page_evidence'}
            body['messages'].insert(0, {'role': 'system', 'content':
                '原版查询生成器和国内搜索已执行以下发现步骤。先核对用户所指名称与候选品牌/网站，不能凭记忆替换目标。'
                '先读取候选中的品牌官网；经销商/问答页不能替代厂家的安装说明。官网有地区门户时沿真实地区链接继续；'
                '再沿安装/下载/技术文档链接读取原文。以下只是候选，不能作为技术条款或已满足条件的依据。\n'+
                json.dumps(discovery, ensure_ascii=False)})
            if __metadata__ is not None:
                __metadata__['stock_discovery'] = discovery
            return body
        finally:
            __request__.state.metadata = prior_metadata

    async def request(self, body: dict, __metadata__: dict = None, __request__: Request = None,
                      __user__: dict = None) -> dict:
        if (body.get('metadata') or {}).get('task'):
            return body
        messages = body.get('messages', [])
        metadata = __metadata__ if __metadata__ is not None else body.get('metadata', {})
        if not metadata.get('continuation_applied'):
            from open_webui.utils.middleware import apply_source_context_to_messages
            current = metadata.get('sources', [])
            seen = {m.get('source') for s in current for m in s.get('metadata', [])}
            carried = [s for s in metadata.get('continuation_sources', []) if s['metadata'][0]['source'] not in seen]
            if carried:
                metadata['sources'] = current + carried
                # Rebuild with the exact stock catalog builder, including full
                # previous bodies. Native continuations reuse this same catalog.
                body['messages'] = await apply_source_context_to_messages(
                    __request__, messages, metadata['sources'], metadata.get('base_user_prompt', ''))
            metadata['continuation_applied'] = True
        if not metadata.get('pixel_measurements_applied'):
            receipts, seen_images = [], set()
            for message in body.get('messages', []):
                content = message.get('content')
                if not isinstance(content, list):
                    continue
                for part in content:
                    uri = (part.get('image_url') or {}).get('url', '') if part.get('type') == 'image_url' else ''
                    if not uri.startswith('data:image/') or uri in seen_images:
                        continue
                    seen_images.add(uri)
                    async with httpx.AsyncClient(timeout=45, trust_env=False) as client:
                        response = await client.post('http://host.docker.internal:18096/ocr',
                            headers={'Host': '127.0.0.1:18094'}, json={'image': uri})
                        response.raise_for_status()
                        receipts.append(response.json())
            if receipts:
                metadata['pixel_measurements'] = receipts
                body['messages'].insert(0, {'role': 'system', 'content':
                    '以下是本轮原始像素经本地 RapidOCR 得到的文字框和测量标注，不是人工答案。'
                    '保留原图继续判断空间关系。dimensions 只证明标注数值和单位；'
                    'dimension_type=unspecified 时必须说尺寸性质未明确，不能称净尺寸、净开间或据此给净面积。'
                    '不得从图形比例补出实际尺寸或把未审核草图变成现场事实。\n'+json.dumps(receipts, ensure_ascii=False)})
            metadata['pixel_measurements_applied'] = True
        index, _ = self._last_user(messages)
        completed = sum(1 for message in messages[index+1:] if message.get('role') == 'tool')
        if completed >= 9:
            # This hook runs for every native continuation (middleware.py), before inference.
            # Reserve the final inference for answering; do not wait for a seventh tool iteration error.
            for key in ('tools', 'tool_choice', 'parallel_tool_calls'):
                body.pop(key, None)
            body['messages'].insert(0, {'role': 'system', 'content':
                '本轮网页研究预算已经结束，工具已收回。现在必须根据已读真实依据回答用户，并明确未取得的原文、身份或适用条件。'
                '不要伪称查证成功，不把其他品牌或空页当作目标厂家。'})
        return body

    async def outlet(self, body: dict, __metadata__: dict = None, __user__: dict = None) -> dict:
        metadata = __metadata__ or {}
        chat_id, message_id = metadata.get('chat_id'), metadata.get('message_id')
        if not chat_id or not message_id or not __user__:
            return body
        chat = await Chats.get_chat_by_id_and_user_id(chat_id, __user__['id'])
        if not chat:
            return body
        answer = await Chats.get_message_by_id_and_message_id(chat_id, message_id) or {}
        sources = copy.deepcopy(metadata.get('sources', []))
        seen = {m.get('source') for s in sources for m in s.get('metadata', [])}
        for source in answer.get('sources', []):
            sid = next((m.get('source') for m in source.get('metadata', []) if m.get('source')), None)
            if sid not in seen:
                seen.add(sid)
                sources.append(copy.deepcopy(source))
        pages = metadata.get('verified_web_pages', {})
        for source in sources:
            for i, meta in enumerate(source.get('metadata', [])):
                sid = meta.get('source') or source.get('source', {}).get('id')
                page = pages.get(sid)
                if page:
                    doc = '# '+page['title']+'\n\n'+page['text']+'\n\nSource URL: '+page['url']
                    source['document'][i] = doc
                    meta.update(reader_sha256=page['sha256'], reader_final_url=page['url'],
                                reader_signature=self._signature(__user__['id'], chat_id, sid, doc))
        # Stock outlet persists content changes only. Save the supported source
        # field explicitly, then send its normal outlet payload to the UI.
        await Chats.upsert_message_to_chat_by_id_and_message_id(chat_id, message_id, {'sources': sources}, touch=False)
        for message in body.get('messages', []):
            if message.get('id') == message_id:
                message['sources'] = sources
        return body
