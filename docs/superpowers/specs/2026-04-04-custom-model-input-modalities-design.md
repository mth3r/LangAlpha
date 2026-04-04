# Custom Model Input Modalities

Allow users to declare input modalities (text, image, pdf) for custom models so that vision-capable local models (e.g., llava on Ollama) can receive image and PDF attachments.

## Problem

`models.json` defines `input_modalities` for every system model. Custom models stored in user preferences have no modality field and always default to `["text"]`. This means image/PDF attachments are never sent natively to custom models, even when the underlying model supports them.

## Design

### Allowed values

`text`, `image`, `pdf` — matching the existing `models.json` vocabulary. `text` is always implicitly present (cannot be removed). `video` exists in models.json for Gemini but is excluded from the custom model UI since no local provider supports it today.

### Data model

Add an optional `input_modalities` field to custom model entries in user preferences.

**Frontend type** (`web/src/components/model/types.ts`):

```typescript
interface CustomModelEntry {
  name: string;
  model_id: string;
  provider: string;
  parameters?: Record<string, unknown>;
  extra_body?: Record<string, unknown>;
  input_modalities?: string[];  // e.g., ["text", "image", "pdf"]
}
```

**Backend persistence**: stored in `user_preferences.other_preference.custom_models[].input_modalities` (existing JSONB column, no migration needed).

**Default**: `["text"]` when the field is omitted or absent. This preserves backward compatibility — existing custom models without the field behave exactly as before.

### Backend validation

In `src/server/app/users.py`, inside the custom models validation block (~line 338):

- If `input_modalities` is present, validate it is a `list` of strings.
- Each value must be in `{"text", "image", "pdf"}`.
- Ensure `"text"` is always included (add it if missing, or reject if explicitly excluded — adding it silently is simpler).
- Empty list is invalid.

### Backend resolution

Currently `get_input_modalities(model_name)` in `src/llms/llm.py` (line 691) only checks `models.json`. Change:

Add an optional `custom_modalities` override parameter:

```python
def get_input_modalities(
    model_name: str,
    custom_modalities: list[str] | None = None,
) -> list[str]:
    if custom_modalities is not None:
        return custom_modalities
    return LLM.get_model_config().get_input_modalities(model_name)
```

The caller is responsible for looking up custom model modalities from the resolved config and passing them in.

### Config threading

Add `input_modalities: list[str] | None = None` to `AgentConfig` (`src/ptc_agent/config/agent.py`). In `resolve_llm_config()` (`src/server/handlers/chat/llm_config.py`, ~line 325), when the effective model is a custom model, extract `cm.get("input_modalities")` from the already-loaded custom model config and set it on the config object. This avoids redundant DB queries in the workflow.

### Workflow integration

Both `ptc_workflow.py` (line 322) and `flash_workflow.py` (line 243) read `config.input_modalities` and pass it to `get_input_modalities()`:

```python
modalities = get_input_modalities(effective_model, custom_modalities=config.input_modalities) if effective_model else ["text"]
```

When `config.input_modalities` is `None` (system models, or custom models without the field), `get_input_modalities` falls back to the existing `models.json` lookup.

### Middleware integration

`MultimodalMiddleware` (`src/ptc_agent/agent/middleware/file_operations/multimodal.py`) has a second multimodal gate that strips image/PDF content blocks from historical messages during agent tool execution (lines 228, 276). It calls `get_input_modalities(self.model_name)` which would miss custom model modalities.

Fix: add `custom_modalities: list[str] | None = None` parameter to `MultimodalMiddleware.__init__`. Pass it through to both `get_input_modalities()` call sites. Wire it from the agent constructor at `agent.py:410`:

```python
MultimodalMiddleware(sandbox=sandbox, model_name=self.config.llm.name, custom_modalities=self.config.input_modalities)
```

### UI data preservation

Multiple UI components rebuild `custom_models` entries from scratch, dropping unknown fields. To prevent `input_modalities` from being silently erased on edit:

- `Settings.tsx:510` — spread original entry before overriding: `{...existingEntry, name: ..., model_id: ..., provider: ...}`
- `UserConfigPanel.tsx:469` — same spread pattern
- `ModelPickStep.tsx:214` — same for newly synthesized entries; preserve existing entries via spread

### Frontend UI

In `ConnectStep.tsx`, add modality toggle chips in both flows:

**Manual model entry** (line ~717): After the model name/ID inputs, add a "Capabilities" row with toggle chips.

**Discovered models** (line ~670): Each model in the discovered list gets per-model modality toggles. State is tracked as `Map<string, string[]>` keyed by model ID. When the user selects a model, its modality defaults to `["text"]`. Toggling Image/PDF updates that model's entry.

Toggle chip behavior:
- **Text** — always on, non-interactive (greyed out / checked)
- **Image** — toggleable, off by default
- **PDF** — toggleable, off by default

The chips map directly to the `input_modalities` array. When saving, only include `input_modalities` in the entry if the user enabled image or pdf (omit the field entirely if text-only, keeping payloads minimal).

### API surface

No new endpoints. The existing `PUT /api/v1/users/me/preferences` endpoint already handles `custom_models` — the new field flows through the existing JSONB column.

The `GET /api/v1/models` response's `model_metadata` map does not currently include `input_modalities` for any model. This is unchanged — the frontend does not need modality info for display purposes (badges show access tier, not capabilities). The modality data is consumed server-side only, in the multimodal filter.

## Files to change

| File | Change |
|---|---|
| `web/src/components/model/types.ts` | Add `input_modalities?: string[]` to `CustomModelEntry` and `CustomModelFormState` |
| `web/src/pages/Setup/steps/ConnectStep.tsx` | Add per-model capability toggle chips to both manual and discovered model flows |
| `web/src/pages/Settings/Settings.tsx` | Preserve `input_modalities` on custom model edit (spread original entry) |
| `web/src/pages/Dashboard/components/UserConfigPanel.tsx` | Same spread preservation |
| `web/src/pages/Setup/steps/ModelPickStep.tsx` | Same spread preservation for starred models |
| `src/server/app/users.py` | Validate `input_modalities` in custom models validation block |
| `src/llms/llm.py` | Add `custom_modalities` parameter to `get_input_modalities()` |
| `src/ptc_agent/config/agent.py` | Add `input_modalities: list[str] \| None = None` to `AgentConfig` |
| `src/server/handlers/chat/llm_config.py` | Thread custom model modalities onto resolved config |
| `src/server/handlers/chat/ptc_workflow.py` | Pass `config.input_modalities` to `get_input_modalities()` |
| `src/server/handlers/chat/flash_workflow.py` | Same as ptc_workflow |
| `src/ptc_agent/agent/middleware/file_operations/multimodal.py` | Accept and use `custom_modalities` in both gates |
| `src/ptc_agent/agent/agent.py` | Wire `config.input_modalities` to `MultimodalMiddleware` constructor |
| `tests/unit/llms/test_input_modalities.py` | Test custom_modalities override |
| `tests/unit/server/app/test_preferences_validation.py` | Test input_modalities validation |

## Out of scope

- Auto-detection of model capabilities from provider APIs (future enhancement)
- `video` modality for custom models
- Exposing `input_modalities` in the `/api/v1/models` response metadata
- Modality display in model selector UI (badges etc.)
