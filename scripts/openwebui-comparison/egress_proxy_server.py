"""Run the unmodified Crawl4AI 0.9.2 pinning proxy in the approved Docker network."""
import asyncio
import os
from egress_proxy import PinningProxy

assert os.environ.get('CRAWL4AI_ALLOW_INTERNAL_URLS', 'false') == 'false'

async def main():
    proxy = PinningProxy(host='0.0.0.0', port=18097)
    try:
        await proxy.start()
        print('Crawl4AI 0.9.2 pinning proxy ready', flush=True)
        await asyncio.Event().wait()
    finally:
        await proxy.stop()

asyncio.run(main())
