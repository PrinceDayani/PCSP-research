# Standard State Schemas for Creative Tools

## Idea
A common, diff-friendly schema for describing scene state in tools such as After Effects, Photoshop and Blender, so deltas are comparable across tools.

## Why a separate paper
Schema design and cross-tool validation are a contribution on their own.

## Link to PCSP
PCSP deltas need a stable state shape to diff against. This defines it.

## Method sketch
- Survey what each tool's scripting API exposes.
- Propose a layered schema: project, composition, layer, property.
- Validate by converting several tools and measuring diff size.

## Closest existing work
- [aftereffects-mcp](https://github.com/Immersive-Media-Technologies/aftereffects-mcp)
- [after-effects-mcp (HeroicSwan)](https://github.com/HeroicSwan/after-effects-mcp)
- [adb-mcp](https://github.com/mikechambers/adb-mcp)
- [Shyft: MCP servers for creative tools](https://shyft.ai/blog/mcp-servers-creative-tools)
