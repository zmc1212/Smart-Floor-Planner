Put your local demo images in this folder and then update:

admin/src/lib/ai/workflow-demo.ts

Recommended structure:

demo-workflows/
  urban-modern/
    source-rough.png
    direction-board.png
    base-render.png
    soft-furnishing.png
    proposal-pack.png
    lighting-scene.png
  cream-family/
    source-rough.png
    direction-board.png
    base-render.png
    soft-furnishing.png
    proposal-pack.png

After replacing the imageUrl fields in workflow-demo.ts, the demo workflow on
the AI workflow page will show your local assets directly.
