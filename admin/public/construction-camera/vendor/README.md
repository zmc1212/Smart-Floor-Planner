# Browser playback dependencies

- `mpegts-1.8.2.js`: unchanged copy of the previously verified local H5 baseline (`G:/workspace/向总/camera/test/h5/vendor/mpegts-1.8.2.js`); Apache-2.0, accompanying license retained.
- `hls-1.6.13.js`: `dist/hls.min.js` from the official npm package `hls.js@1.6.13`; Apache-2.0, accompanying license retained. Used for MPEG-TS HLS when MSE is available; native HLS remains the fallback.
- Primary documentation: https://github.com/video-dev/hls.js/tree/v1.6.13 and https://github.com/xqq/mpegts.js/tree/v1.8.2

Files are served locally; the player does not load scripts from third-party CDNs.
