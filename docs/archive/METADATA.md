# Metadata Editor

The metadata sidebar (press `M` or click the toolbar button) provides structured editing across 8 tabs:

| Tab | Contents |
|-----|----------|
| **Project** | Title, ID, description (with markdown and image support), tags, license, relationships, version history |
| **Provenance** | Capture date/device/serial, operator/ORCID, location, processing software list, processing notes, convention hints |
| **Archival Record** | Dublin Core / Smithsonian EDAN fields: title, identifiers (accession, SIRIS, URI), creation details, physical description, provenance, rights, geographic and temporal coverage |
| **Quality** | Quality tier (Metrology/Reference/Visualization), accuracy grade, capture resolution, alignment error, scale verification, data quality notes, read-only asset statistics |
| **Material** | PBR workflow (metal/roughness or specular/glossiness), color space, normal map space, occlusion packing |
| **Preservation** | PRONOM format registry IDs, significant properties checklist, rendering requirements and notes |
| **Assets** | Per-asset metadata: created by, tool version, source notes, and archival role (primary/derived) for splat, mesh, and point cloud |
| **Integrity** | SHA-256 hash algorithm, manifest hash, per-asset hashes, toggle for including integrity data in exports. Displays a warning when HTTPS is unavailable. |

## Field Validation

Structured metadata fields are validated on blur with inline error indicators:
- **ORCID**: format `0000-0000-0000-000X`
- **Coordinates**: numeric latitude/longitude within valid ranges
- **Dates**: ISO 8601 format
- **PRONOM IDs**: format `fmt/000` or `x-fmt/000`

Validation is advisory — it highlights problems but does not block export.

All metadata is saved into the archive's `manifest.json` on export.
